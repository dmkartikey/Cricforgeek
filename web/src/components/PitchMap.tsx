import { useMemo, useState } from 'react';
import { divColor, inkOn, seqColor, seqGradient, useTip } from './charts';
import { DCAT, PHASES } from '../lib/labels';
import { Mini } from './ui';

type Prior = { label: string; confidence: number; length: number[]; line: number[] };
export type ZoneCfg = { lengths: string[]; lines: string[]; categories: Record<string, Prior>; outcomes: Record<string, Prior>; vector: string[] };
type Vec = number[];

const CATS = ['bowled', 'lbw', 'keeper', 'stumped', 'cab', 'field', 'hitwicket'];

type Mode = 'danger' | 'share' | 'runs' | 'dots';

// Turn raw counts into a 5 (length) x 4 (line) grid of index values (1 = baseline) and shares.
function grid(v: Vec, base: Vec, cfg: ZoneCfg, mode: Mode) {
  const at = (x: Vec, k: string) => x[cfg.vector.indexOf(k)] ?? 0;
  const balls = at(v, 'balls'), bb = Math.max(1, at(base, 'balls'));
  const L = cfg.lengths.length, N = cfg.lines.length;
  const obs = Array.from({ length: L }, () => Array(N).fill(0));
  const exp = Array.from({ length: L }, () => Array(N).fill(0));
  const add = (p: Prior, o: number, e: number) => {
    for (let i = 0; i < L; i++) for (let j = 0; j < N; j++) {
      const w = p.length[i] * p.line[j] * p.confidence;
      obs[i][j] += o * w; exp[i][j] += e * w;
    }
  };
  if (mode === 'danger' || mode === 'share') {
    for (const c of CATS) add(cfg.categories[c], at(v, c), (at(base, c) / bb) * balls);
  } else if (mode === 'runs') {
    const runsOf = (x: Vec) => ({ four: 4 * at(x, 'four'), six: 6 * at(x, 'six'), r13: Math.max(0, at(x, 'runs') - 4 * at(x, 'four') - 6 * at(x, 'six')) });
    const ro = runsOf(v), rb = runsOf(base);
    for (const o of ['r13', 'four', 'six'] as const) add(cfg.outcomes[o], ro[o], (rb[o] / bb) * balls);
  } else {
    add(cfg.outcomes.dot, at(v, 'dot'), (at(base, 'dot') / bb) * balls);
  }
  const k = mode === 'danger' || mode === 'share' ? 0.6 : 6;
  const idx = obs.map((row, i) => row.map((o, j) => (o + k) / (exp[i][j] + k)));
  const tot = obs.flat().reduce((a, b) => a + b, 0);
  const share = obs.map((row) => row.map((o) => (tot ? o / tot : 0)));
  const outs = CATS.reduce((a, c) => a + at(v, c), 0);
  const expOuts = CATS.reduce((a, c) => a + (at(base, c) / bb) * balls, 0);
  const evidence = CATS.reduce((a, c) => a + at(v, c) * cfg.categories[c].confidence, 0);
  return { idx, share, balls, outs, expOuts, conf: Math.min(1, evidence / 25),
    cats: CATS.map((c) => ({ c, o: at(v, c), e: (at(base, c) / bb) * balls })),
    outcomes: { dot: at(v, 'dot'), r13: at(v, 'r13'), four: at(v, 'four'), six: at(v, 'six'), runs: at(v, 'runs') },
    baseOut: { sr: (100 * at(base, 'runs')) / bb, dot: at(base, 'dot') / bb, bnd: (at(base, 'four') + at(base, 'six')) / bb } };
}

export function PitchMap({ role, zc, base, cfg, fam, hand, btype, compact }: {
  role: 'bat' | 'bowl'; zc: Record<string, Vec>; base: Record<string, Vec>; cfg: ZoneCfg; fam: string;
  hand?: string | null; btype?: string | null; compact?: boolean;
}) {
  const bat = role === 'bat';
  const [split, setSplit] = useState('all');
  const [phase, setPhase] = useState('all');
  const [mode, setMode] = useState<Mode>(bat ? 'danger' : 'share');
  const [rel, setRel] = useState<'avg' | 'own'>('own');
  const { tip, show, hide } = useTip();
  const [hov, setHov] = useState<string | null>(null);

  const splits: [string, string][] = bat
    ? [['all', 'All'], ['pace', 'Pace'], ['spin', 'Spin']]
    : [['all', 'All'], ['R', 'vs RHB'], ['L', 'vs LHB']];
  const avail = (s: string, p: string) => !!zc[`${s}|${p}`];
  const sp = avail(split, phase) ? split : 'all';
  const ph = avail(sp, phase) ? phase : 'all';
  const vec = zc[`${sp}|${ph}`];
  const baseKey = bat ? `${sp}|${ph}` : `${btype ?? 'all'}|${sp}|${ph}`;
  const bvec = base[baseKey] ?? base[bat ? `all|${ph}` : `all|${sp}|${ph}`];

  const g = useMemo(() => (vec && bvec ? grid(vec, bvec, cfg, mode) : null), [vec, bvec, cfg, mode]);
  if (!vec || !bvec || !g) return <div className="empty">Not enough balls for a pitch map yet.</div>;

  const overall = (g.outs + 0.6) / (g.expOuts + 0.6);
  const val = (i: number, j: number) => (mode === 'share' ? g.share[i][j] : mode === 'danger' && rel === 'own' ? g.idx[i][j] / overall : g.idx[i][j]);
  const maxShare = Math.max(...g.share.flat(), 1e-9);
  const color = (v: number) => (mode === 'share' ? seqColor(v / maxShare) : divColor(mode === 'dots' && !bat ? v : v));
  // Mirror columns for left-handers (and for a bowler's map vs left-handers)
  const lefty = bat ? hand === 'lhb' : sp === 'L';
  const cols = lefty ? [3, 2, 1, 0] : [0, 1, 2, 3];

  // perspective pitch geometry: batter's end at the top
  const W = 460, H = 500, top = 82, bot = 456, wTop = 170, wBot = 300, cx = 268;
  const yAt = (f: number) => top + (bot - top) * f;
  const halfW = (y: number) => (wTop + (wBot - wTop) * ((y - top) / (bot - top))) / 2;
  const rows = 5, ncol = 4;
  const rowF = [0, 0.14, 0.33, 0.58, 0.79, 1]; // yorker band is narrow, short band is long
  const poly = (i: number, c: number) => {
    const y0 = yAt(rowF[i]), y1 = yAt(rowF[i + 1]);
    const x = (y: number, k: number) => cx - halfW(y) + (2 * halfW(y) * k) / ncol;
    const pts = [[x(y0, c), y0], [x(y0, c + 1), y0], [x(y1, c + 1), y1], [x(y1, c), y1]];
    return { pts: pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' '), cxm: (x(y0, c) + x(y1, c + 1)) / 2, cym: (y0 + y1) / 2 };
  };
  const cells = Array.from({ length: rows }, (_, i) => cols.map((j, c) => ({ i, j, c, v: val(i, j), s: g.share[i][j], ...poly(i, c) }))).flat();
  const ranked = [...cells].sort((a, b) => b.v - a.v);
  const hot = new Set(ranked.slice(0, 3).map((x) => `${x.i}-${x.j}`));
  // marginal profiles
  const lenProf = cfg.lengths.map((_, i) => cols.reduce((a, j) => a + g.share[i][j], 0));
  const lineProf = cols.map((j) => g.share.reduce((a, row) => a + row[j], 0));
  const maxL = Math.max(...lenProf, 1e-9), maxN = Math.max(...lineProf, 1e-9);

  const modeOpts: [Mode, string][] = bat
    ? [['danger', 'Danger'], ['share', 'Where out'], ['runs', 'Scoring'], ['dots', 'Dot balls']]
    : [['share', 'Wickets'], ['danger', 'Wicket rate'], ['runs', 'Runs leaked'], ['dots', 'Dot balls']];
  const legend = mode === 'share'
    ? [bat ? 'few dismissals' : 'few wickets', '', bat ? 'most dismissals' : 'most wickets']
    : mode === 'danger' ? (bat ? ['safer', 'average', 'more dangerous'] : ['fewer wickets', 'average', 'more wickets'])
      : mode === 'runs' ? (bat ? ['scores less', 'average', 'scores more'] : ['tight', 'average', 'expensive'])
        : ['fewer dots', 'average', 'more dots'];
  const phases = PHASES[fam] ?? PHASES.T20;
  const lineName = (j: number) => cfg.lines[j];
  // relative to average, in plain percent: +18% = 18% more than an average batter would show here
  const valFmt = (v: number) => (mode === 'share' ? `${(v * 100).toFixed(0)}%` : `${v >= 1 ? '+' : '−'}${Math.abs((v - 1) * 100).toFixed(0)}%`);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="mini-bar" role="toolbar">
        <Mini label="Show" value={mode} onChange={setMode} options={modeOpts} />
        <Mini label={bat ? 'Bowler' : 'Batter'} value={sp} onChange={setSplit} options={splits.filter(([k]) => avail(k, 'all'))} />
        <Mini label="Phase" value={ph} onChange={setPhase}
          options={[['all', 'All'], ...(['0', '1', '2'].filter((k) => avail(sp, k)).map((k) => [k, phases[+k].split(' (')[0]] as [string, string]))]} />
        {mode === 'danger' && bat && <Mini label="Compare" value={rel} onChange={setRel} options={[['avg', 'Vs average'], ['own', 'Own game']]} />}
      </div>
      <div className={`pitch-wrap ${compact ? 'compact' : ''}`}>
        <div className="pitch-stage">
          <svg className="chart pitch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Inferred pitch map" onPointerLeave={hide}>
            <defs>
              <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--turf-2)" /><stop offset="1" stopColor="var(--turf)" />
              </linearGradient>
            </defs>
            <polygon points={`${cx - wTop / 2 - 26},${top - 46} ${cx + wTop / 2 + 26},${top - 46} ${cx + wBot / 2 + 34},${bot + 24} ${cx - wBot / 2 - 34},${bot + 24}`}
              fill="url(#turf)" stroke="var(--line)" />
            {/* batting crease and stumps */}
            <line x1={cx - wTop / 2 - 20} x2={cx + wTop / 2 + 20} y1={top - 6} y2={top - 6} stroke="var(--line-2)" strokeWidth={1.5} />
            <line x1={cx - wTop / 2 + 8} x2={cx - wTop / 2 + 8} y1={top - 40} y2={top - 6} stroke="var(--line-2)" />
            <line x1={cx + wTop / 2 - 8} x2={cx + wTop / 2 - 8} y1={top - 40} y2={top - 6} stroke="var(--line-2)" />
            {(() => {
              const sx = cx - wTop / 2 + (wTop * ((lefty ? 1 : 2) + 0.5)) / 4;
              return [-6, 0, 6].map((d) => <rect key={d} x={sx + d - 1.5} y={top - 34} width={3} height={26} rx={1.5} fill="var(--text-2)" />);
            })()}
            {cells.map((c) => {
              const isHot = hot.has(`${c.i}-${c.j}`);
              return (
                <g key={`${c.i}-${c.j}`} className="cell" style={{ animationDelay: `${c.i * 70 + c.c * 30}ms` }}
                  onPointerEnter={() => setHov(`${c.i}-${c.j}`)} onPointerLeave={() => setHov(null)}
                  onPointerMove={(e) => show({ x: e.clientX, y: e.clientY, title: `${cfg.lengths[c.i]} · ${lineName(c.j)}`, rows: [
                    { label: mode === 'share' ? 'Share' : 'vs average', value: valFmt(c.v) },
                    ...(mode !== 'share' ? [{ label: bat ? 'Share of dismissals' : 'Share of wickets', value: `${(c.s * 100).toFixed(1)}%` }] : []),
                  ] })}>
                  <polygon className="fill" points={c.pts} fill={color(c.v)} stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" />
                  {isHot && <polygon points={c.pts} fill="none" stroke="var(--text)" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />}
                  <text x={c.cxm} y={c.cym + 4} textAnchor="middle" className="cell-val" style={{ fill: inkOn(color(c.v)) }}>{c.v < 0.005 && mode === 'share' ? '–' : valFmt(c.v)}</text>
                </g>
              );
            })}
            {cfg.lengths.map((l, i) => {
              const y = (yAt(rowF[i]) + yAt(rowF[i + 1])) / 2;
              return <text key={l} x={cx - halfW(y) - 42} y={y + 4} textAnchor="end" style={{ fontSize: 11 }}>{l}</text>;
            })}
            {cols.map((j, c) => {
              const x = cx - wBot / 2 + (wBot * (c + 0.5)) / 4;
              return <text key={j} x={x} y={bot + 17} textAnchor="middle" style={{ fontSize: 10 }}>{['Wide off', 'Corridor', 'Stumps', 'Leg'][j]}</text>;
            })}
            {hov && (() => {
              const c = cells.find((x) => `${x.i}-${x.j}` === hov);
              if (!c) return null;
              const sx = cx - wTop / 2 + (wTop * ((lefty ? 1 : 2) + 0.5)) / 4;
              const d = `M${cx + 40},${H - 14} Q${(cx + 40 + c.cxm) / 2},${c.cym + 40} ${c.cxm},${c.cym} Q${(c.cxm + sx) / 2},${(c.cym + top) / 2 - 30} ${sx},${top - 20}`;
              return (
                <g key={hov} pointerEvents="none">
                  <path className="arc" pathLength={1} d={d} fill="none" stroke="var(--red)" strokeWidth={2} strokeDasharray="1" strokeLinecap="round" />
                  <circle cx={c.cxm} cy={c.cym} r={5} fill="var(--red)" stroke="var(--surface)" strokeWidth={1.5} />
                </g>
              );
            })()}
            <text x={cx} y={H - 8} textAnchor="middle" style={{ fontSize: 10 }}>bowler's end ↓</text>
          </svg>
          <div className="stack" style={{ gap: 4 }}>
            <div className="scale" style={{ background: mode === 'share' ? seqGradient() : `linear-gradient(90deg, ${divColor(0.5)}, ${divColor(1)}, ${divColor(2)})` }} />
            <div className="row muted" style={{ justifyContent: 'space-between', fontSize: 11 }}>{legend.map((l, i) => <span key={i}>{l}</span>)}</div>
          </div>
        </div>
        <div className="stack" style={{ gap: 18 }}>
          <div className="notice info">
            <b>Inferred, not tracked.</b> Free data has no ball-tracking, so this is worked out from {bat ? 'how this batter gets out and scores' : 'how this bowler takes wickets and concedes runs'},
            compared with the average {bat ? 'batter' : `${btype ?? ''} bowler`} in the same format{ph !== 'all' ? ' and phase' : ''}.
            {mode === 'danger' || mode === 'share'
              ? <> Confidence <b className="mono">{Math.round(g.conf * 100)}%</b>{g.conf < 0.4 ? ' (low: too few dismissals).' : '.'}</>
              : <> Scoring and dot-ball zones are lower-confidence than dismissal zones.</>}
          </div>
          <div className="grid g2" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 6 }}>
              <h3>Length profile</h3>
              {cfg.lengths.map((l, i) => (
                <div key={l} className="prof-row"><span>{l}</span><i style={{ width: `${(lenProf[i] / maxL) * 100}%` }} className="sweep" /><b className="mono">{(lenProf[i] * 100).toFixed(0)}%</b></div>
              ))}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h3>Line profile</h3>
              {cols.map((j, c) => (
                <div key={j} className="prof-row"><span>{lineName(j)}</span><i style={{ width: `${(lineProf[c] / maxN) * 100}%` }} className="sweep" /><b className="mono">{(lineProf[c] * 100).toFixed(0)}%</b></div>
              ))}
            </div>
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Hot zones</h3>
            {ranked.slice(0, 3).map((c, n) => (
              <div key={`${c.i}-${c.j}`} className="hot-row">
                <span className="hot-rank">{n + 1}</span>
                <span>{cfg.lengths[c.i]}, {lineName(c.j).toLowerCase()}</span>
                <b className="mono">{valFmt(c.v)}</b>
              </div>
            ))}
          </div>
          {(mode === 'danger' || mode === 'share') ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th scope="col">{bat ? 'How out' : 'How taken'}</th><th scope="col">{bat ? 'Outs' : 'Wkts'}</th><th scope="col">Expected</th><th scope="col">vs expected</th></tr></thead>
                <tbody>
                  {g.cats.filter((x) => x.o > 0 || x.e >= 1).map((x) => {
                    const ix = (x.o + 0.6) / (x.e + 0.6);
                    const good = bat ? ix <= 0.8 : ix >= 1.25, bad = bat ? ix >= 1.25 : ix <= 0.8;
                    return <tr key={x.c}><td>{DCAT[x.c] ?? x.c}</td><td>{x.o}</td><td>{x.e.toFixed(1)}</td><td className={good ? 'pos' : bad ? 'neg' : ''}>{ix >= 1 ? '+' : '−'}{Math.abs((ix - 1) * 100).toFixed(0)}%</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tiles">
              <div className="tile"><span className="v">{(100 * g.outcomes.runs / g.balls).toFixed(1)}</span><span className="l">{bat ? 'Strike rate' : 'Runs / 100 balls'}</span><span className="h">avg {g.baseOut.sr.toFixed(1)}</span></div>
              <div className="tile"><span className="v">{((g.outcomes.dot / g.balls) * 100).toFixed(1)}%</span><span className="l">Dot balls</span><span className="h">avg {(g.baseOut.dot * 100).toFixed(1)}%</span></div>
              <div className="tile"><span className="v">{(((g.outcomes.four + g.outcomes.six) / g.balls) * 100).toFixed(1)}%</span><span className="l">Boundary %</span><span className="h">avg {(g.baseOut.bnd * 100).toFixed(1)}%</span></div>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12 }}>
            {g.outs} {bat ? 'dismissals' : 'wickets'} in {g.balls.toLocaleString()} balls{lefty ? ' · mirrored for a left-hander' : ''} · viewed from the bowler's end.
          </div>
        </div>
      </div>
      {tip}
    </div>
  );
}
