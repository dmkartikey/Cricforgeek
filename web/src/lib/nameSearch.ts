// Player name search shared by the search box, the Players page and Compare.
// A player matches when every word typed is the start of a word in one of their names: the scorecard name
// ("V Kohli"), the register name, or the full names and aliases added nightly ("Virat Kohli"). So "virat kohli",
// "kohli virat", "vir koh" and "v kohli" all find him. If nothing matches, words of 4+ letters may be one typo off.

// search.json player row: [id, name, register name, gender, main team, from, to, matches, formats, full names "A|B"]
export type PlayerRow = [string, string, string, string, string, number, number, number, string, string?];

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const cache = new WeakMap<PlayerRow, { tokens: string[]; names: string[]; initials: string }>();
function index(p: PlayerRow) {
  let c = cache.get(p);
  if (!c) {
    const names = [p[1], p[2], ...(p[9] ? p[9].split('|') : [])].filter(Boolean).map(norm);
    // scorecard names lead with initials ("JE Root"): "joe" can then match the J when no full name is known
    const first = String(p[1]).split(' ');
    const initials = first.length > 1 && /^[A-Z]{1,3}$/.test(first[0]) ? first[0].toLowerCase() : '';
    c = { names, initials, tokens: [...new Set(names.join(' ').split(' ').filter(Boolean))] };
    cache.set(p, c);
  }
  return c;
}

function within1(a: string, b: string) {
  // one insertion, deletion, substitution, or two neighbouring letters swapped ("kholi" for "kohli")
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].map((ch, k) => (ch !== b[k] ? k : -1)).filter((k) => k >= 0);
    if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  }
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Score a player for a query (0 = no match). Higher is better. */
export function scorePlayer(p: PlayerRow, query: string, fuzzy = false): number {
  const q = norm(query);
  if (!q) return 0;
  const words = q.split(' ');
  const { tokens, names, initials } = index(p);
  let viaInitial = 0;
  for (const [k, w] of words.entries()) {
    const ok = tokens.some((t) => t.startsWith(w) || (fuzzy && w.length >= 4 && (within1(w, t) || within1(w, t.slice(0, w.length)))));
    if (ok) continue;
    // a first name against the initials ("joe" for the J in "JE Root"): never the last word, which is the surname
    if (initials && k < words.length - 1 && w.length >= 2 && initials.includes(w[0])) { viaInitial++; continue; }
    return 0;
  }
  if (viaInitial && viaInitial === words.length) return 0;
  let score = viaInitial ? -10 : 1;
  if (names.includes(q)) score += 100;                       // exact name ("virat kohli")
  else if (names.some((n) => n.startsWith(q))) score += 40;  // name starts with the query
  if (words.every((w) => tokens.includes(w))) score += 20;   // whole words, not just prefixes
  return Math.max(0.5, score + Math.min(15, Math.log2(1 + (p[7] || 0)) * 1.5)); // well-known players first
}

/** The best matches for a query, falling back to one-typo matching when nothing matches exactly. */
export function searchPlayers(rows: PlayerRow[], query: string, limit = 10, keep: (p: PlayerRow) => boolean = () => true) {
  const run = (fuzzy: boolean) => rows.filter(keep).map((p) => [p, scorePlayer(p, query, fuzzy)] as const).filter((x) => x[1] > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, limit).map((x) => x[0]);
  const exact = run(false);
  return exact.length ? exact : run(true);
}

/** The full name to show next to the scorecard name, when it adds something. */
export const fullName = (p: PlayerRow) => (p[9] ? p[9].split('|')[0] : p[2] !== p[1] ? p[2] : '');
