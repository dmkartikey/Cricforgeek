// Situation predictor engine. Runs entirely in the browser from the tables in data/predict/*.json.
// Limited overs: Monte Carlo, ball by ball, from real outcome rates for the same balls left, wickets and
// required rate, tilted by team, venue, era, level and player factors.
// Multi-day: a multinomial logistic model for win / draw / loss, plus a simulation of the current innings.

export type Vec = number[]; // n, p_wide, wide_runs, p_nb, nb_runs, then legal: W, 0, 1, 2, 3, 4, 6
export type Factor = [number, number, number]; // run factor, wicket factor, balls
export type LimData = {
  kind: 'limited'; fam: string; gender: string; full: number; pr_edges: number[]; need_step: number; score_step: number;
  cells: Record<string, Vec>; era: Record<string, Factor>; era_ph: Record<string, [number, number][]>; level: Record<string, Factor>;
  comps: Record<string, { label: string; years: Record<string, Factor[]> }>;
  team_bat: Record<string, Factor>; team_bowl: Record<string, Factor>;
  venues: Record<string, [number, number, number, string, string | null, number | null, number | null, number | null]>;
  chase: [number, number, number, number, number, number, Example[]][];
  first: [number, number, number, number, number, number, number, number, number, number, Example[]][];
  balls: number; matches: number; data_to: string;
};
export type MdData = {
  kind: 'multi'; fmt: string; gender: string; cap: number; features: string[]; models: Record<string, number[][]>;
  calib: { inn: number; n: number; log_loss: number; accuracy: number }[];
  cells: Record<string, Vec>; era: Record<string, Factor>; team_bat: Record<string, Factor>; team_bowl: Record<string, Factor>;
  venues: Record<string, [number, number, number, string, string | null]>;
  hist4: [number, number, number, number, number, number, Example[]][]; hist: [number, number, number, number, number, number, number][];
  states: number; matches: number; data_to: string;
};
export type Example = [string, string, string, string, string, number?];

export type Player = { id?: string; name: string; rf: number; wf: number; runs?: number; balls?: number; ballsLeft?: number };

// ---------- seeded random ----------
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

const RUNS = [0, 1, 2, 3, 4, 6];

// Legal-ball distribution with wickets scaled by g and runs tilted so their mean scales by f.
// Returns cumulative probabilities over [W, 0, 1, 2, 3, 4, 6].
const tiltCache = new Map<string, number[]>();
function legalCdf(v: Vec, key: string, f: number, g: number) {
  const ck = `${key}|${f.toFixed(2)}|${g.toFixed(2)}`;
  const hit = tiltCache.get(ck);
  if (hit) return hit;
  const qW = Math.min(0.6, v[5] * g);
  const base = RUNS.map((_, i) => v[6 + i]);
  const tot = base.reduce((a, b) => a + b, 0) || 1;
  const p = base.map((x) => x / tot);
  const mean0 = p.reduce((a, x, i) => a + x * RUNS[i], 0);
  const goal = mean0 * f;
  let th = 0;
  for (let it = 0; it < 12; it++) {
    const w = p.map((x, i) => x * Math.exp(th * RUNS[i]));
    const z = w.reduce((a, b) => a + b, 0);
    const m = w.reduce((a, x, i) => a + x * RUNS[i], 0) / z;
    const v2 = w.reduce((a, x, i) => a + x * RUNS[i] * RUNS[i], 0) / z - m * m;
    if (Math.abs(m - goal) < 1e-4 || v2 <= 1e-9) break;
    th += (goal - m) / v2;
    th = Math.max(-3, Math.min(3, th));
  }
  const w = p.map((x, i) => x * Math.exp(th * RUNS[i]));
  const z = w.reduce((a, b) => a + b, 0);
  const out = [qW];
  let c = qW;
  for (const x of w) { c += (1 - qW) * (x / z); out.push(c); }
  if (tiltCache.size > 50000) tiltCache.clear();
  tiltCache.set(ck, out);
  return out;
}

// ---------- limited overs ----------
export type LimInput = {
  inn: 1 | 2; score: number; wkts: number; balls: number; totalBalls: number; target?: number;
  striker: Player; nonStriker: Player; next: Player[]; bowlers: Player[]; maxBowlerBalls: number;
  rf: number; wf: number; // combined context factors for the batting side
  phr?: number[]; phw?: number[]; // competition scoring level for the start, middle and end of the innings
  lastBowler?: string;
};
type BatOut = { runs: number; balls: number; out: boolean };
export type LimSim = {
  final: number[]; wkts: number[]; won: number[]; worm: number[][]; ballsUsed: number[];
  batters: Record<string, BatOut[]>; bowlers: Record<string, { r: number; w: number; b: number }[]>;
  nextOver: { r: number; w: number; bnd: number }[];
  // for betting markets: sixes from here, runs until the next wicket, who takes it, best score by a batter not yet in
  sixes: number[]; r2w: number[]; nwb: (string | null)[]; topNew: number[];
};

function cellFor(d: LimData, inn: number, left: number, wk: number, need?: number) {
  const br = Math.min(Math.ceil(left / 6), 50);
  let pr = -1;
  if (inn === 2 && need != null && need > 0) {
    const rrr = (6 * need) / Math.max(left, 1);
    pr = d.pr_edges.findIndex((e) => rrr < e);
    if (pr < 0) pr = d.pr_edges.length;
  }
  const k = `${inn}|${br}|${wk}|${pr}`;
  const v = d.cells[k] ?? d.cells[`${inn}|${br}|${wk}|-1`] ?? d.cells[`1|${br}|${wk}|-1`];
  return { v, key: d.cells[k] ? k : `${inn}|${br}|${wk}|-1` };
}

function overPlan(bowlers: Player[], oversLeft: number, maxBalls: number, r: () => number, last?: string) {
  // named bowlers' remaining overs, the rest by "other bowlers"; no bowler twice in a row where avoidable
  const pool: (Player | null)[] = [];
  for (const b of bowlers) for (let i = 0; i < Math.floor(Math.min(b.ballsLeft ?? maxBalls, maxBalls) / 6); i++) pool.push(b);
  while (pool.length < oversLeft) pool.push(null);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const plan = pool.slice(0, oversLeft);
  for (let i = 0; i < plan.length; i++) {
    const prev = i === 0 ? last : plan[i - 1]?.name;
    if (plan[i] && prev && plan[i]!.name === prev) {
      const j = plan.findIndex((x, n) => n > i && (!x || x.name !== prev) && (n + 1 >= plan.length || plan[n + 1]?.name !== plan[i]!.name));
      if (j > 0) [plan[i], plan[j]] = [plan[j], plan[i]];
    }
  }
  return plan;
}

export function simLimited(d: LimData, s: LimInput, n: number, seed: number, track = true): LimSim {
  const r = rng(seed);
  const res: LimSim = { final: [], wkts: [], won: [], worm: [], ballsUsed: [], batters: {}, bowlers: {}, nextOver: [], sixes: [], r2w: [], nwb: [], topNew: [] };
  const trackB = track ? [s.striker.name, s.nonStriker.name] : [];
  for (const nm of trackB) res.batters[nm] = [];
  if (track) for (const b of s.bowlers) res.bowlers[b.name] = [];
  const oversLeft = Math.ceil((s.totalBalls - s.balls) / 6);
  for (let it = 0; it < n; it++) {
    let score = s.score, wk = s.wkts, balls = s.balls;
    let st: Player & BatOut = { ...s.striker, runs: s.striker.runs ?? 0, balls: s.striker.balls ?? 0, out: false };
    let ns: Player & BatOut = { ...s.nonStriker, runs: s.nonStriker.runs ?? 0, balls: s.nonStriker.balls ?? 0, out: false };
    const outs: Record<string, BatOut> = {};
    let ni = 0;
    const plan = overPlan(s.bowlers, oversLeft, s.maxBowlerBalls, r, s.lastBowler);
    const figs: Record<string, { r: number; w: number; b: number }> = {};
    const worm: number[] = [];
    let ov = 0, inOver = (balls % 6);
    let bw = plan[0];
    let nx = { r: 0, w: 0, bnd: 0 }, nxDone = false, nxBalls = 0;
    let six = 0, r2w = NaN, nwb: string | null = null, firstW = false;
    const fresh = new Set<string>();
    while (wk < 10 && balls < s.totalBalls && !(s.inn === 2 && s.target != null && score >= s.target)) {
      const left = s.totalBalls - balls;
      const { v, key } = cellFor(d, s.inn, left, wk, s.target != null ? s.target - score : undefined);
      const brr = Math.ceil(left / 6), third = Math.ceil(d.full / 6) / 3, ph = brr > 2 * third ? 0 : brr > third ? 1 : 2;
      const f = s.rf * (s.phr?.[ph] ?? 1) * st.rf * (bw ? bw.rf : 1), g = s.wf * (s.phw?.[ph] ?? 1) * st.wf * (bw ? bw.wf : 1);
      const u = r();
      let runs = 0, legal = true, wicket = false, bnd = false;
      if (u < v[1]) { legal = false; runs = 1 + (r() < Math.max(0, v[2] - 1) / 4 ? 4 : 0); }
      else if (u < v[1] + v[3]) {
        legal = false;
        const cdf = legalCdf(v, key, f, 0);
        const x = r(); let i = 1; while (i < cdf.length - 1 && x > cdf[i]) i++;
        runs = 1 + RUNS[i - 1]; st.runs += RUNS[i - 1]; bnd = RUNS[i - 1] >= 4; if (RUNS[i - 1] === 6) six++;
      } else {
        const cdf = legalCdf(v, key, f, g);
        const x = r();
        if (x < cdf[0]) wicket = true;
        else { let i = 1; while (i < cdf.length - 1 && x > cdf[i]) i++; runs = RUNS[i - 1]; bnd = runs >= 4; if (runs === 6) six++; }
        st.balls++;
        if (!wicket) st.runs += runs;
      }
      score += runs;
      const nm = bw ? bw.name : null;
      if (nm) { const fg = (figs[nm] ??= { r: 0, w: 0, b: 0 }); fg.r += runs; if (legal) fg.b++; if (wicket) fg.w++; }
      if (!nxDone) { nx.r += runs; if (wicket) nx.w++; if (bnd) nx.bnd++; }
      if (wicket && !firstW) { firstW = true; r2w = score - s.score; nwb = nm; }
      if (wicket) {
        wk++;
        st.out = true; outs[st.name] = { runs: st.runs, balls: st.balls, out: true };
        const nb = s.next[ni++];
        st = { name: nb?.name ?? `Batter ${wk + 2}`, id: nb?.id, rf: nb?.rf ?? 1, wf: nb?.wf ?? 1, runs: 0, balls: 0, out: false };
        fresh.add(st.name);
      } else if (runs % 2 === 1 && legal) { const t = st; st = ns; ns = t; }
      if (legal) {
        balls++; inOver++; nxBalls++;
        if (nxBalls >= 6 - (s.balls % 6) && !nxDone) nxDone = true;
        if (inOver >= 6) {
          inOver = 0; ov++;
          worm.push(score);
          const t = st; st = ns; ns = t;
          bw = plan[ov] ?? null;
        }
      }
    }
    if (inOver > 0 || worm.length === 0) worm.push(score);
    outs[st.name] ??= { runs: st.runs, balls: st.balls, out: false };
    outs[ns.name] ??= { runs: ns.runs, balls: ns.balls, out: false };
    res.final.push(score); res.wkts.push(wk); res.worm.push(worm); res.ballsUsed.push(balls);
    res.won.push(s.inn === 2 && s.target != null ? (score >= s.target ? 1 : score === s.target - 1 ? 0.5 : 0) : NaN);
    res.nextOver.push(nx);
    res.sixes.push(six); res.r2w.push(r2w); res.nwb.push(nwb);
    let tn = 0; for (const nm of fresh) tn = Math.max(tn, outs[nm]?.runs ?? 0); res.topNew.push(tn);
    if (track) {
      for (const nm of trackB) res.batters[nm].push(outs[nm] ?? { runs: 0, balls: 0, out: false });
      for (const b of s.bowlers) res.bowlers[b.name].push(figs[b.name] ?? { r: 0, w: 0, b: 0 });
    }
  }
  return res;
}

// P(chasing side wins | target) on a grid, for first-innings win probability
export function chaseCurve(d: LimData, base: Omit<LimInput, 'inn' | 'score' | 'wkts' | 'balls' | 'target'>, lo: number, hi: number, n: number, seed: number,
  pitch: (target: number) => number = () => 1) {
  const step = Math.max(2, Math.round((hi - lo) / 14));
  const pts: [number, number][] = [];
  for (let t = Math.max(1, lo - step); t <= hi + step; t += step) {
    const sim = simLimited(d, { ...base, rf: base.rf * pitch(t + 1), inn: 2, score: 0, wkts: 0, balls: 0, target: t + 1 }, n, seed + t, false);
    pts.push([t, sim.won.reduce((a, b) => a + b, 0) / n]);
  }
  // keep it monotone (higher totals are never easier to chase)
  for (let i = 1; i < pts.length; i++) pts[i][1] = Math.min(pts[i][1], pts[i - 1][1]);
  return (total: number) => {
    if (total <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (total <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + ((y1 - y0) * (total - x0)) / (x1 - x0); }
    }
    return pts[pts.length - 1][1];
  };
}

export const quantile = (arr: number[], q: number) => {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// ---------- multi-day ----------
export function mdFeatures(lead: number, wih: number, ol: number, rr: number) {
  const L = Math.max(-6, Math.min(6, lead / 100)), k = Math.max(0, Math.min(1, wih / 10));
  const o = Math.max(0, Math.min(6, ol / 90)), r = Math.max(0, Math.min(3, rr / 4));
  return [1, L, (Math.sign(L) * L * L) / 6, k, o, L * o, k * o, L * k, r, Math.exp(-o)];
}
export function mdProbs(d: MdData, inn: number, lead: number, wih: number, ol: number, rr: number): [number, number, number] {
  const W = d.models[String(inn)] ?? d.models['4'];
  const x = mdFeatures(lead, wih, ol, rr);
  const z = [0, 1, 2].map((c) => x.reduce((a, xi, i) => a + xi * W[i][c], 0));
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const t = e[0] + e[1] + e[2];
  return [e[0] / t, e[1] / t, e[2] / t];
}

export type MdInput = { score: number; wkts: number; ballsInInnings: number; ballsLeftInMatch: number; target?: number;
  striker: Player; nonStriker: Player; next: Player[]; bowlers: Player[]; rf: number; wf: number };

// Bat on until all out, the target is reached (4th innings) or the match runs out of overs.
export function simMd(d: MdData, s: MdInput, n: number, seed: number) {
  const r = rng(seed);
  const out = { final: [] as number[], wkts: [] as number[], balls: [] as number[], result: [] as number[], batters: {} as Record<string, BatOut[]> };
  for (const nm of [s.striker.name, s.nonStriker.name]) out.batters[nm] = [];
  for (let it = 0; it < n; it++) {
    let score = s.score, wk = s.wkts, b = 0;
    let st: Player & BatOut = { ...s.striker, runs: s.striker.runs ?? 0, balls: s.striker.balls ?? 0, out: false };
    let ns: Player & BatOut = { ...s.nonStriker, runs: s.nonStriker.runs ?? 0, balls: s.nonStriker.balls ?? 0, out: false };
    const outs: Record<string, BatOut> = {};
    let ni = 0;
    const bws = s.bowlers.length ? s.bowlers : [{ name: '', rf: 1, wf: 1 }];
    let bw = bws[0];
    while (wk < 10 && b < s.ballsLeftInMatch && !(s.target != null && score >= s.target)) {
      const age = Math.floor((((s.ballsInInnings + b) / 6) % 80) / 10);
      const key = `${age}|${wk}`;
      const v = d.cells[key] ?? d.cells[`0|${wk}`];
      const f = s.rf * st.rf * bw.rf, g = s.wf * st.wf * bw.wf;
      const u = r();
      let runs = 0, legal = true, wicket = false;
      if (u < v[1] + v[3]) { legal = false; runs = 1; }
      else {
        const cdf = legalCdf(v, 'md' + key, f, g);
        const x = r();
        if (x < cdf[0]) wicket = true; else { let i = 1; while (i < cdf.length - 1 && x > cdf[i]) i++; runs = RUNS[i - 1]; }
        st.balls++; if (!wicket) st.runs += runs;
      }
      score += runs;
      if (wicket) {
        wk++; outs[st.name] = { runs: st.runs, balls: st.balls, out: true };
        const nb = s.next[ni++];
        st = { name: nb?.name ?? `Batter ${wk + 2}`, rf: nb?.rf ?? 1, wf: nb?.wf ?? 1, runs: 0, balls: 0, out: false };
      } else if (runs % 2 === 1 && legal) { const t = st; st = ns; ns = t; }
      if (legal) { b++; if (b % 6 === 0) { const t = st; st = ns; ns = t; bw = bws[Math.floor(r() * bws.length)]; } }
    }
    outs[st.name] ??= { runs: st.runs, balls: st.balls, out: false };
    outs[ns.name] ??= { runs: ns.runs, balls: ns.balls, out: false };
    out.final.push(score); out.wkts.push(wk); out.balls.push(b);
    // 4th innings: 0 win, 1 draw, 2 loss for the batting side
    out.result.push(s.target != null ? (score >= s.target ? 0 : wk >= 10 ? 2 : 1) : (wk >= 10 ? 2 : 1));
    for (const nm of [s.striker.name, s.nonStriker.name]) out.batters[nm].push(outs[nm]);
  }
  return out;
}

// ---------- player factors from a profile ----------
export function batFactor(sum: any): { rf: number; wf: number; n: number } {
  if (!sum || !sum.b || !sum.xr) return { rf: 1, wf: 1, n: 0 };
  const kr = 150 * (sum.xr / sum.b), ko = 150 * ((sum.xo ?? 0) / sum.b);
  return { rf: (sum.r + kr) / (sum.xr + kr), wf: ko > 0 ? ((sum.o ?? 0) + ko) / ((sum.xo ?? 0) + ko) : 1, n: sum.b };
}
export function bowlFactor(sum: any): { rf: number; wf: number; n: number } {
  if (!sum || !sum.b || !sum.xr) return { rf: 1, wf: 1, n: 0 };
  const kr = 150 * (sum.xr / sum.b), kw = 150 * ((sum.xw ?? 0) / sum.b);
  return { rf: (sum.r + kr) / (sum.xr + kr), wf: kw > 0 ? ((sum.w ?? 0) + kw) / ((sum.xw ?? 0) + kw) : 1, n: sum.b };
}

// A big target says the pitch is good for batting. Strength tuned on real chases (see Methodology).
export const PITCH_ALPHA: Record<string, number> = { male: 0.4, female: 0.2 };
export const CALIB: Record<string, { rmse: number; n: number }> = { 'T20-male': { rmse: 4.1, n: 50 }, 'ODI-male': { rmse: 5.4, n: 50 } };
// Teams and venues get half weight: on real chases they added little once the competition was known.
export const TEAM_WEIGHT = 0.5;
