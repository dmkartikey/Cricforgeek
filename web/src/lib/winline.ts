// Pure model helpers shared by the Live page and the nightly track-record script (no React here).
import { chaseCurve, hash, LimData, mdProbs, MdData, mean, Player, quantile, simLimited, simMd } from './predict';

export type Inn = { team: string; r: number; w: number; o: number; label: string };
export type Bat = { name: string; r: number; b: number; f4: number; s6: number; out: boolean; how: string };
export type Bowl = { name: string; o: number; m: number; r: number; w: number; wd: number; nb: number };
export type Card = { fetchedAt: string; inn: number; batting: Bat[]; bowling: Bowl[]; allInns: { label: string; batting: Bat[]; bowling: Bowl[] }[] };
export type Market = { fetchedAt: string; books: number; fair: Record<string, number>; margin: number; start?: string };
export type LiveMatch = {
  id: string; name: string; series: string; fmt: 'T20' | 'ODI' | 'TEST'; gender: 'male' | 'female'; teams: [string, string];
  short: Record<string, string>; venue: string; start: string; status: string; started: boolean; ended: boolean; innings: Inn[];
  toss?: { winner: string; choice: string }; card?: Card; market?: Market; endedAt?: string;
};
export type Upcoming = { key: string; fmt: string; start: string; teams: [string, string]; market?: Market };
export type LiveDoc = { updated: string; checked: string; nextCheck: string; matches: LiveMatch[]; upcoming: Upcoming[] };
export type Snap = { t: string; s: [number, number, number][]; st: string; mk?: Record<string, number> };

export const baseTeam = (t: string) => t.replace(/\s+Women$/i, '').trim();
export const ballsOf = (o: number) => { const [a, b] = String(o).split('.'); return (+a || 0) * 6 + Math.min(+(b || 0), 5); };
export const dataKey = (m: Pick<LiveMatch, 'fmt' | 'gender'>) => `${m.fmt}-${m.gender}`;
export const FULL_BALLS: Record<string, number> = { T20: 120, ODI: 300 };

// ---------- the match state the model needs ----------
export type LimState = { kind: 'limited'; inn: 1 | 2; batting: string; bowling: string; score: number; wkts: number; balls: number; total: number; target?: number };
export type MdState = { kind: 'multi'; inn: number; batting: string; bowling: string; score: number; wkts: number; ballsInn: number; lead: number; oversUsed: number; target?: number };

export function stateOf(m: LiveMatch): LimState | MdState | null {
  const inns = m.innings;
  if (!inns.length) return null;
  const cur = inns[inns.length - 1];
  const other = m.teams.find((t) => t !== cur.team) ?? m.teams[1];
  if (m.fmt !== 'TEST') {
    const k = Math.min(inns.length, 2) as 1 | 2;
    const c = inns[k - 1];
    const total = FULL_BALLS[m.fmt];
    return { kind: 'limited', inn: k, batting: c.team, bowling: m.teams.find((t) => t !== c.team) ?? other, score: c.r, wkts: Math.min(c.w, 9),
      balls: Math.min(ballsOf(c.o), total - 1), total, target: k === 2 ? inns[0].r + 1 : undefined };
  }
  const mine = inns.filter((i) => i.team === cur.team).reduce((a, i) => a + i.r, 0);
  const theirs = inns.filter((i) => i.team !== cur.team).reduce((a, i) => a + i.r, 0);
  const used = inns.reduce((a, i) => a + ballsOf(i.o) / 6, 0);
  return { kind: 'multi', inn: Math.min(inns.length, 4), batting: cur.team, bowling: other, score: cur.r, wkts: Math.min(cur.w, 9), ballsInn: ballsOf(cur.o),
    lead: mine - theirs, oversUsed: used, target: inns.length === 4 ? theirs - (mine - cur.r) + 1 : undefined };
}

export const P = (name: string): Player => ({ name, rf: 1, wf: 1, runs: 0, balls: 0 });
export const TEST_CAP: Record<string, number> = { male: 450, female: 400 };

// ---------- context factors for a live international ----------
export function contextFx(d: LimData | MdData, m: LiveMatch, bat: string, bowl: string) {
  const half = (x?: number) => Math.pow(x ?? 1, 0.5);
  const tb = d.team_bat[baseTeam(bat)], tw = d.team_bowl[baseTeam(bowl)];
  const vk = venueKey(d, m.venue);
  const v = vk ? d.venues[vk] : undefined;
  let phr = [1, 1, 1], phw = [1, 1, 1], eraLabel = '';
  const lim = d as LimData;
  if (lim.comps) {
    const ck = `${m.gender === 'male' ? 'men' : 'women'}-${m.fmt === 'T20' ? 't20i' : 'odi'}`;
    const comp = lim.comps[ck];
    const ys = comp ? Object.keys(comp.years).sort() : [];
    if (comp && ys.length) { const cy = comp.years[ys[ys.length - 1]]; phr = cy.map((x) => x[0]); phw = cy.map((x) => x[1]); eraLabel = `${comp.label} ${ys[ys.length - 1]}`; }
    else { const y = Object.keys(lim.era).sort().slice(-1)[0]; const e = lim.era_ph?.[y]; if (e) { phr = e.map((x) => x[0]); phw = e.map((x) => x[1]); } eraLabel = `all cricket ${y}`; }
  } else {
    const y = Object.keys(d.era).sort().slice(-1)[0]; const e = d.era[y]; if (e) { phr = [e[0], e[0], e[0]]; phw = [e[1], e[1], e[1]]; } eraLabel = `Test cricket ${y}`;
  }
  const rows: [string, string, number, number][] = [
    ['Scoring level', eraLabel, NaN, NaN],
    ['Batting side', bat, half(tb?.[0]), half(tb?.[1])],
    ['Bowling side', bowl, half(tw?.[0]), half(tw?.[1])],
    ['Ground', v?.[3] ?? `${m.venue} (no record)`, half(v?.[0]), half(v?.[1])],
  ];
  return { rf: half(tb?.[0]) * half(tw?.[0]) * half(v?.[0]), wf: half(tb?.[1]) * half(tw?.[1]) * half(v?.[1]), phr, phw, rows };
}
const vnorm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
function venueKey(d: LimData | MdData, venue: string) {
  const name = vnorm(venue.split(',')[0]);
  if (!name) return undefined;
  let best: string | undefined, n = 0;
  for (const [k, v] of Object.entries(d.venues)) {
    const vn = vnorm(String(v[3]));
    if ((vn.includes(name) || name.includes(vn)) && v[2] > n) { best = k; n = v[2]; }
  }
  return best;
}

// Quick win chances for a match state: { team: p, Draw?: p }. Used on list cards, momentum and the track record.
export function quickWin(d: LimData | MdData, m: LiveMatch, n = 500): Record<string, number> | null {
  const st = stateOf(m);
  if (!d || !st) return null;
  const fx = contextFx(d, m, st.batting, st.bowling);
  if (st.kind === 'limited' && (d as LimData).kind === 'limited') {
    const base = { totalBalls: st.total, striker: P('A'), nonStriker: P('B'), next: [], bowlers: [], maxBowlerBalls: st.total / 5, rf: fx.rf, wf: fx.wf, phr: fx.phr, phw: fx.phw };
    const sim = simLimited(d as LimData, { ...base, inn: st.inn, score: st.score, wkts: st.wkts, balls: st.balls, target: st.target }, n, hash(m.id + st.score + ':' + st.wkts), false);
    if (st.inn === 2) return { [st.batting]: mean(sim.won), [st.bowling]: 1 - mean(sim.won) };
    const fx2 = contextFx(d, m, st.bowling, st.batting);
    const curve = chaseCurve(d as LimData, { ...base, rf: fx2.rf, wf: fx2.wf, phr: fx2.phr, phw: fx2.phw }, quantile(sim.final, 0.05), quantile(sim.final, 0.95), 160, 7);
    const w = mean(sim.final.map((x) => 1 - curve(x)));
    return { [st.batting]: w, [st.bowling]: 1 - w };
  }
  if (st.kind === 'multi') {
    const ol = Math.max(0, TEST_CAP[m.gender] - st.oversUsed);
    let p = mdProbs(d as MdData, st.inn, st.lead, 10 - st.wkts, ol, (6 * st.score) / Math.max(st.ballsInn, 6));
    if (st.inn === 4) {
      // in the chase, blend in a simulation of the rest of the innings (same as the match page)
      const sim = simMd(d as MdData, { score: st.score, wkts: st.wkts, ballsInInnings: st.ballsInn, ballsLeftInMatch: Math.round(ol * 6 * 0.85), target: st.target,
        striker: P('A'), nonStriker: P('B'), next: [], bowlers: [], rf: fx.rf, wf: fx.wf }, Math.round(n * 1.5), hash(m.id + JSON.stringify(m.innings)));
      p = p.map((q, i) => 0.75 * q + 0.25 * mean(sim.result.map((x) => (x === i ? 1 : 0)))) as typeof p;
    }
    return { [st.batting]: p[0], Draw: p[1], [st.bowling]: p[2] };
  }
  return null;
}
