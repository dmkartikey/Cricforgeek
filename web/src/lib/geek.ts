// Shared helpers for the geek features: glossary, rolling form, milestones, par scores, era baselines,
// home/away regions and the "newer matches not yet in the stats" check.
import { useMemo } from 'react';
import { useData } from './data';
import { FULL_MEMBERS, useLive, type LiveMatch } from './live';

/** Plain-English definitions shown behind the (i) buttons and on the card meters. */
export const GLOSSARY: Record<string, string> = {
  imp: 'Impact: runs added compared with an average player in exactly the same situations (same phase, wickets down, format and era). +50 means 50 runs better than average over the career.',
  imp100: 'Impact per 100 balls: the same impact figure scaled to 100 balls, so short and long careers compare fairly. Positive is better than average.',
  wpa: "Win probability added: how much a player's balls moved their side's chance of winning. +1.00 is one whole win added over the career. Limited-overs only.",
  rae: 'Runs above average: runs scored minus the runs an average batter would score from the same balls in the same situations.',
  saved: 'Runs saved v average: runs an average bowler would concede from the same balls, minus the runs this bowler actually conceded.',
  adj: 'Context-adjusted average: each innings is weighted by how hard the opposition was to score against that year and how easy the ground is. 40 against a strong attack on a tough pitch counts for more than 40 against a weak one on a road.',
  adjBowl: 'Context-adjusted bowling average: runs conceded are discounted against strong batting sides and at high-scoring grounds, and counted up against weak ones. Lower is better.',
  conv: 'Conversion: the share of 50-plus scores turned into hundreds. Hundreds ÷ (fifties + hundreds).',
  rating: 'Card rating: a weighted mix of percentiles against every qualified player in the same format. The weights change by format and role: Test batters lean on the adjusted average, T20 batters on strike rate and impact, Test bowlers on average and strike rate, T20 bowlers on economy.',
  par: "Par score: what the chasing side needs at this point to be level if play stopped now, using the same idea as Duckworth-Lewis-Stern (runs scaled by the overs and wickets used). It uses cricforgeek's own resource table built from every recorded match, not the official ICC table, so it can differ by a few runs.",
  pressure: 'Pressure: dot balls in the 12 deliveries before the wicket, and legal balls since the last four or six. More dots and a longer wait for a boundary usually come before a wicket.',
  sessions: 'Estimated sessions: Cricsheet does not record when each day or session ended, so this assumes 90 overs a day and 30 a session. Rain, early finishes and slow over rates shift the real days.',
  zones: 'Estimated zones: free data has no ball-tracking, so these maps are inferred from how a player gets out and scores, not measured from where the ball pitched.',
};

/** Rolling average over the last n innings (runs per dismissal), null until n innings have been played. */
export function rolling(inns: number[][], n: number, kind: 'bat' | 'bowl') {
  const out: (number | null)[] = [];
  for (let i = 0; i < inns.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    const w = inns.slice(i - n + 1, i + 1);
    if (kind === 'bat') {
      const r = w.reduce((a, x) => a + x[1], 0), o = w.reduce((a, x) => a + x[3], 0);
      out.push(o ? r / o : null);
    } else {
      const r = w.reduce((a, x) => a + x[2], 0), wk = w.reduce((a, x) => a + x[3], 0);
      out.push(wk ? r / wk : null);
    }
  }
  return out;
}

const STEPS: Record<string, { r: number[]; w: number[] }> = {
  TEST: { r: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000], w: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800] },
  ODI: { r: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000], w: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500] },
  T20: { r: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000], w: [25, 50, 75, 100, 125, 150, 175, 200] },
};
/** Next round-number milestone in internationals, if the player is close enough for it to be interesting. */
export function milestones(p: any, fk: string) {
  const [fam, g] = fk.split('-');
  const st = STEPS[fam];
  if (!st) return [];
  const intl = (p.comps ?? []).filter((c: any) => c.fam === fam && c.g === g && /^(men|women)-/.test(c.comp));
  const runs = intl.reduce((a: number, c: any) => a + (c.bat?.r ?? 0), 0), wkts = intl.reduce((a: number, c: any) => a + (c.bowl?.w ?? 0), 0);
  const out: { kind: 'runs' | 'wkts'; have: number; next: number; need: number }[] = [];
  const nextR = st.r.find((x) => x > runs), nextW = st.w.find((x) => x > wkts);
  if (nextR && runs >= nextR * 0.75 && runs > 0) out.push({ kind: 'runs', have: runs, next: nextR, need: nextR - runs });
  if (nextW && wkts >= nextW * 0.7 && wkts > 0) out.push({ kind: 'wkts', have: wkts, next: nextW, need: nextW - wkts });
  return out;
}

/** Hundreds ÷ (fifties + hundreds). */
export const conversion = (c50?: number, c100?: number) => ((c50 ?? 0) + (c100 ?? 0) ? (c100 ?? 0) / ((c50 ?? 0) + (c100 ?? 0)) : NaN);

/** Par for a chase after `oversDone` overs with `wkts` down: first-innings score scaled by resources used. */
export function parScore(re: number[][], quota: number, first: number, oversDone: number, wkts: number) {
  const full = re[0]?.[quota];
  if (!full || wkts > 9) return wkts > 9 ? first : NaN;
  const left = Math.max(0, quota - oversDone);
  const remain = re[wkts]?.[left] ?? 0;
  return first * (1 - remain / full);
}

export const SENA = new Set(['South Africa', 'England', 'New Zealand', 'Australia']);
export const ASIA = new Set(['India', 'Pakistan', 'Sri Lanka', 'Bangladesh', 'Afghanistan', 'United Arab Emirates', 'Nepal', 'Oman', 'Hong Kong']);
export const region = (host: string) => (SENA.has(host) ? 'SENA (SA, Eng, NZ, Aus)' : ASIA.has(host) ? 'Asia and the UAE' : host === 'West Indies' ? 'West Indies' : host === 'unknown' ? 'Unknown' : 'Elsewhere');

/** Era baseline (all matches in this format) weighted by the balls a player faced or bowled each year. */
export function eraBaseline(eras: any, fk: string, years: [string, number][], idx: 1 | 2 | 3 | 4) {
  const rows: any[] = eras?.[fk] ?? [];
  const by = new Map(rows.map((r) => [String(r[0]), r]));
  let tot = 0, wsum = 0;
  for (const [y, b] of years) { const r = by.get(y); if (r && r[idx] != null) { tot += r[idx] * b; wsum += b; } }
  return wsum ? tot / wsum : NaN;
}

type Done = { id: string; name: string; fmt: LiveMatch['fmt']; gender: string; teams: [string, string]; start: string; status: string };
const base = (t: string) => t.replace(/\s+Women$/i, '');

/** Internationals the live feed has seen for this player's national side since the nightly data ends. */
export function useNewer(p: any, fk: string) {
  const meta = useData<any>('meta.json').data;
  const { data: done } = useLive<Done[]>('/done', 600_000);
  return useMemo(() => {
    if (!p || !meta) return null;
    const [fam, g] = fk.split('-');
    const nat = (p.teams ?? []).find((t: any) => t[1] === g && FULL_MEMBERS.has(base(String(t[0]))));
    const to: string = meta.data_to;
    const lastYear = nat ? +nat[3] : 0;
    const newer = !nat || !done || lastYear < +to.slice(0, 4) - 1 ? [] : done.filter((d) => d.start.slice(0, 10) > to && d.fmt === fam && (d.gender ?? 'male') === g && d.teams.some((t) => base(t) === base(nat[0])));
    return { to, team: nat ? base(nat[0]) : null, newer: newer.sort((a, b) => b.start.localeCompare(a.start)) };
  }, [p, fk, meta, done]);
}
