// Pure logic for the live feed, kept free of Worker APIs so it can be tested in Node.

export type Inn = { team: string; r: number; w: number; o: number; label: string };
export type Bat = { name: string; r: number; b: number; f4: number; s6: number; out: boolean; how: string };
export type Bowl = { name: string; o: number; m: number; r: number; w: number; wd: number; nb: number };
export type Card = { fetchedAt: string; inn: number; batting: Bat[]; bowling: Bowl[]; allInns: { label: string; batting: Bat[]; bowling: Bowl[] }[] };
export type Market = { fetchedAt: string; books: number; fair: Record<string, number>; margin: number; start?: string };
export type LiveMatch = {
  id: string; name: string; series: string; fmt: 'T20' | 'ODI' | 'TEST'; gender: 'male' | 'female';
  teams: [string, string]; short: Record<string, string>; venue: string; start: string; status: string;
  started: boolean; ended: boolean; innings: Inn[]; toss?: { winner: string; choice: string };
  card?: Card; market?: Market; endedAt?: string;
};
export type Upcoming = { key: string; fmt: string; start: string; teams: [string, string] };
export type Budget = {
  day: string; hitsToday: number; hitsLimit: number; month: string; oddsRemaining: number | null; oddsToday: number;
  lastScores: number; lastCard: Record<string, number>; lastOdds: Record<string, number>; lastEvents: number;
  cardInnings: Record<string, number>; errors: string[];
};

export const FMT: Record<string, LiveMatch['fmt']> = { t20: 'T20', odi: 'ODI', test: 'TEST' };
export const ODDS_KEY: Record<string, string> = { T20: 'cricket_international_t20', ODI: 'cricket_odi', TEST: 'cricket_test_match' };
const MIN = 60_000;

// Team names in the feed use "X Women"; the model stores women's teams by country name.
export const baseTeam = (t: string) => t.replace(/\s+Women$/i, '').trim();
export const isWomen = (name: string, teams: string[]) => /\bwomen\b/i.test(name) || teams.some((t) => /\bwomen$/i.test(t));
const NOT_SENIOR = /\b(A|XI|Emerging|U-?19|Under[- ]19|U-?23|Development|Academy|Invitation|President'?s|Board)\b/;

// A senior international: Test, ODI or T20I format, and both sides are national teams we know.
export function isInternational(name: string, teams: string[], fmt: string | undefined, known: Record<string, Record<string, unknown>> | null) {
  if (!fmt || !FMT[fmt]) return false;
  if (teams.length !== 2 || teams.some((t) => NOT_SENIOR.test(t))) return false;
  if (/warm-?up|tour match|practice|unofficial/i.test(name)) return false;
  if (!known) return true;
  const g = isWomen(name, teams) ? 'female' : 'male';
  return teams.every((t) => !!known[g]?.[baseTeam(t)]);
}

export function parseOvers(o: number | string) {
  const [a, b] = String(o).split('.');
  return (+a || 0) * 6 + Math.min(+(b || 0), 5);
}

export function normalize(raw: any[], known: Record<string, Record<string, unknown>> | null): LiveMatch[] {
  const out: LiveMatch[] = [];
  for (const m of raw ?? []) {
    const teams = (m.teams ?? []) as string[];
    if (!isInternational(m.name ?? '', teams, m.matchType, known)) continue;
    const short: Record<string, string> = {};
    for (const t of m.teamInfo ?? []) short[t.name] = t.shortname;
    const innings: Inn[] = (m.score ?? []).map((s: any) => {
      const label = String(s.inning ?? '');
      const team = teams.find((t) => label.toLowerCase().startsWith(t.toLowerCase())) ?? label.replace(/\s+Inning.*$/i, '');
      return { team, r: +s.r || 0, w: +s.w || 0, o: +s.o || 0, label };
    });
    out.push({
      id: String(m.id), name: String(m.name ?? ''), series: String(m.name ?? '').split(',').slice(2).join(',').trim(),
      fmt: FMT[m.matchType], gender: isWomen(m.name ?? '', teams) ? 'female' : 'male', teams: [teams[0], teams[1]], short,
      venue: String(m.venue ?? ''), start: String(m.dateTimeGMT ?? m.date ?? ''), status: String(m.status ?? ''),
      started: !!m.matchStarted, ended: !!m.matchEnded, innings,
    });
  }
  return out;
}

const batRow = (x: any): Bat => {
  const how = String(x['dismissal-text'] ?? '').trim();
  const out = !!how && !/^(not out|batting|retired not out)$/i.test(how);
  return { name: x.batsman?.name ?? '', r: +x.r || 0, b: +x.b || 0, f4: +x['4s'] || 0, s6: +x['6s'] || 0, out, how };
};
const bowlRow = (x: any): Bowl => ({ name: x.bowler?.name ?? '', o: +x.o || 0, m: +x.m || 0, r: +x.r || 0, w: +x.w || 0, wd: +x.wd || 0, nb: +x.nb || 0 });

export function parseCard(data: any, now: Date): Card | undefined {
  const sc = data?.scorecard;
  if (!Array.isArray(sc) || !sc.length) return undefined;
  const allInns = sc.map((i: any) => ({ label: String(i.inning ?? ''), batting: (i.batting ?? []).map(batRow), bowling: (i.bowling ?? []).map(bowlRow) }));
  const last = allInns[allInns.length - 1];
  return { fetchedAt: now.toISOString(), inn: allInns.length, batting: last.batting, bowling: last.bowling, allInns };
}

// Market odds with the bookmaker margin taken out. Names of bookmakers are deliberately dropped.
export function fairMarket(ev: any, now: Date): Market | undefined {
  const books = (ev?.bookmakers ?? []).map((b: any) => b.markets?.find((k: any) => k.key === 'h2h')?.outcomes ?? []).filter((o: any[]) => o.length >= 2);
  if (!books.length) return undefined;
  const names = [...new Set(books.flat().map((o: any) => o.name))] as string[];
  const avg: Record<string, number> = {};
  for (const n of names) {
    const ps = books.map((o: any[]) => o.find((x) => x.name === n)?.price).filter((p: number) => p > 1);
    if (ps.length) avg[n] = ps.reduce((a: number, b: number) => a + 1 / b, 0) / ps.length; // mean implied probability
  }
  const tot = Object.values(avg).reduce((a, b) => a + b, 0);
  if (!tot) return undefined;
  const fair: Record<string, number> = {};
  for (const [n, p] of Object.entries(avg)) fair[n] = +(p / tot).toFixed(4);
  return { fetchedAt: now.toISOString(), books: books.length, fair, margin: +(tot - 1).toFixed(4), start: ev.commence_time };
}

const norm = (s: string) => baseTeam(s).toLowerCase().replace(/[^a-z]/g, '');
export function matchEvent(m: LiveMatch, events: any[]) {
  const a = norm(m.teams[0]), b = norm(m.teams[1]);
  const day = Date.parse(m.start);
  return events.find((e) => {
    const h = norm(e.home_team ?? ''), w = norm(e.away_team ?? '');
    const same = (h === a && w === b) || (h === b && w === a);
    return same && (!Number.isFinite(day) || Math.abs(Date.parse(e.commence_time) - day) < 6 * 86400_000);
  });
}

// ---------- call budget ----------
export function freshBudget(now: Date, b?: Budget): Budget {
  const day = now.toISOString().slice(0, 10), month = now.toISOString().slice(0, 7);
  const base: Budget = b ?? { day, hitsToday: 0, hitsLimit: 100, month, oddsRemaining: null, oddsToday: 0, lastScores: 0, lastCard: {}, lastOdds: {}, lastEvents: 0, cardInnings: {}, errors: [] };
  if (base.day !== day) Object.assign(base, { day, hitsToday: 0, oddsToday: 0 });
  if (base.month !== month) Object.assign(base, { month, oddsRemaining: null });
  return base;
}

// Score checks: every 15 minutes while an international is live or about to start, hourly otherwise,
// and never so often that the day's calls run out before midnight (UTC, when the free plan resets).
export function scoreInterval(b: Budget, now: Date, live: number, soon: boolean) {
  const left = b.hitsLimit - b.hitsToday - 4; // keep a few spare
  if (left <= 0) return Infinity;
  const minsLeft = (Date.parse(b.day + 'T23:59:59Z') - now.getTime()) / MIN;
  const want = live > 0 || soon ? 15 : 60;
  const reserveForCards = live > 0 ? 20 : 0; // leave room for two scorecards
  const spread = minsLeft / Math.max(1, left - reserveForCards);
  return Math.max(want, Math.min(60, spread)) * MIN;
}

// Scorecards cost 10 calls. Fetch one for at most two live matches: when a new innings starts,
// or every 2 hours, and only while enough calls are left for the day's score checks.
export function cardsToFetch(b: Budget, now: Date, live: LiveMatch[]) {
  const left = b.hitsLimit - b.hitsToday;
  const minsLeft = (Date.parse(b.day + 'T23:59:59Z') - now.getTime()) / MIN;
  const scoreNeed = Math.ceil(minsLeft / 15) * Math.min(1, live.length) + 4;
  const picks: string[] = [];
  const ranked = [...live].sort((x, y) => priority(y) - priority(x)).slice(0, 2);
  for (const m of ranked) {
    if (left - picks.length * 10 - 10 < Math.min(scoreNeed, 40)) break;
    const last = b.lastCard[m.id] ?? 0;
    const newInnings = (b.cardInnings[m.id] ?? 0) !== m.innings.length;
    if (newInnings && now.getTime() - last > 20 * MIN) picks.push(m.id);
    else if (now.getTime() - last > 120 * MIN) picks.push(m.id);
  }
  return picks;
}
const BIG = new Set(['India', 'Australia', 'England', 'Pakistan', 'South Africa', 'New Zealand', 'Sri Lanka', 'West Indies', 'Bangladesh', 'Afghanistan', 'Ireland', 'Zimbabwe']);
export const priority = (m: LiveMatch) => m.teams.filter((t) => BIG.has(baseTeam(t))).length * 10 + (m.fmt === 'TEST' ? 0 : 2) + (m.gender === 'male' ? 1 : 0);

// Odds credits: spread what is left of the month across the remaining days; per format, at most every 2 hours
// while it is live, plus once before the start.
export function oddsToFetch(b: Budget, now: Date, live: LiveMatch[], upcoming: Upcoming[]) {
  const daysLeft = Math.max(1, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime() - now.getTime()) / 86400_000;
  const remaining = b.oddsRemaining ?? 500;
  const today = Math.max(1, Math.floor(remaining / Math.ceil(daysLeft)));
  if (b.oddsToday >= today || remaining <= 5) return [];
  const keys = new Set<string>();
  for (const m of live) if (!m.ended && now.getTime() - (b.lastOdds[ODDS_KEY[m.fmt]] ?? 0) > 120 * MIN) keys.add(ODDS_KEY[m.fmt]);
  for (const u of upcoming) {
    const t = Date.parse(u.start) - now.getTime();
    if (t > 0 && t < 12 * 3600_000 && now.getTime() - (b.lastOdds[u.key] ?? 0) > 6 * 3600_000) keys.add(u.key);
  }
  return [...keys].slice(0, Math.max(0, today - b.oddsToday));
}
