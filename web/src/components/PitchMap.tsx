import { useState } from 'react';
import { divColor, useTip } from './charts';
import { DCAT } from '../lib/labels';
import { Seg } from './ui';

export type Zone = {
  balls: number; outs: number; conf: number;
  cats: Record<string, [number, number, number]>; // [observed, index, expected]
  grid: number[][]; share: number[][];
};

const LENGTHS = ['Yorker', 'Full', 'Good', 'Back of length', 'Short'];
const LINES = ['Wide outside off', 'Off-stump corridor', 'Stumps', 'Leg side'];

export function PitchMap({ zone, hand }: { zone: Zone; hand?: string | null }) {
  const [mode, setMode] = useState<'rel' | 'abs'>('rel');
  const { tip, show, hide } = useTip();
  const expOuts = Object.values(zone.cats).reduce((a, c) => a + (c[2] || 0), 0);
  const overall = (zone.outs + 2) / (expOuts + 2);
  const lefty = hand === 'lhb';
  const cols = lefty ? [3, 2, 1, 0] : [0, 1, 2, 3];
  const val = (i: number, j: number) => (mode === 'rel' ? zone.grid[i][j] / overall : zone.grid[i][j]);
  const W = 300, H = 430, px = 92, top = 46, bottom = 46, cw = (W - px - 12) / 4, ch = (H - top - bottom) / 5;
  const cells = LENGTHS.flatMap((_, i) => cols.map((j, cx) => ({ i, j, cx, v: val(i, j), s: zone.share[i][j] })));
  const topCells = [...cells].sort((a, b) => b.v - a.v).slice(0, 3);
  const lowConf = zone.conf < 0.4;
  return (
    <div className="pitch-wrap">
      <div className="stack">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Inferred pitch map of dismissal risk" onPointerLeave={hide}>
          <rect x={px - 10} y={10} width={W - px - 2} height={H - 20} rx={10} fill="#141a2c" stroke="var(--line)" />
          {/* crease + stumps at the batter's end */}
          <line x1={px - 10} x2={W - 12} y1={top - 8} y2={top - 8} stroke="#3a4668" strokeWidth={1.5} />
          {[-6, 0, 6].map((d) => <rect key={d} x={px + cw * (lefty ? 1 : 2) + cw / 2 + d - 1.5} y={18} width={3} height={18} rx={1.5} fill="var(--text-2)" />)}
          {cells.map((c) => (
            <g key={`${c.i}-${c.j}`}>
              <rect x={px + c.cx * cw + 1} y={top + c.i * ch + 1} width={cw - 2} height={ch - 2} rx={5}
                fill={divColor(c.v)} opacity={lowConf ? 0.6 : 1}
                onPointerMove={(e) => show({ x: e.clientX, y: e.clientY, title: `${LENGTHS[c.i]} · ${LINES[c.j]}`,
                  rows: [{ label: mode === 'rel' ? 'Risk vs their own average' : 'Risk vs average batter', value: `${c.v.toFixed(2)}×` },
                         { label: 'Share of dismissals', value: `${(c.s * 100).toFixed(1)}%` }] })} />
              <text x={px + c.cx * cw + cw / 2} y={top + c.i * ch + ch / 2 + 4} textAnchor="middle"
                style={{ fill: 'var(--text)', fontWeight: 700, pointerEvents: 'none' }}>{c.v.toFixed(2)}</text>
            </g>
          ))}
          {LENGTHS.map((l, i) => (
            <text key={l} x={px - 16} y={top + i * ch + ch / 2 + 4} textAnchor="end">{l}</text>
          ))}
          {cols.map((j, cx) => (
            <text key={j} x={px + cx * cw + cw / 2} y={H - 26} textAnchor="middle" style={{ fontSize: 9 }}>
              {['Wide off', 'Corridor', 'Stumps', 'Leg'][j]}
            </text>
          ))}
          <text x={px + (W - px - 12) / 2} y={H - 12} textAnchor="middle" style={{ fontSize: 10 }}>bowler's end ↓</text>
        </svg>
        <div className="stack" style={{ gap: 4 }}>
          <div className="scale" />
          <div className="row muted" style={{ justifyContent: 'space-between', fontSize: 11 }}>
            <span>safer (0.5×)</span><span>average (1×)</span><span>more dangerous (2×)</span>
          </div>
        </div>
      </div>
      <div className="stack">
        <Seg label="Compare with" value={mode} onChange={setMode}
          options={[['rel', 'Within their own game'], ['abs', 'Vs average batter']]} />
        <div className="notice info">
          <b>Inferred, not tracked.</b> Free ball-by-ball data has no ball-tracking, so this map is worked out from
          <i> how</i> this batter gets out (bowled, LBW, edges to the keeper, stumpings and so on) against what an average batter in
          the same format gives up. Confidence: <b className="mono">{Math.round(zone.conf * 100)}%</b>
          {lowConf ? ' (low, too few dismissals to read much into this).' : '.'}
        </div>
        <div>
          <h3 style={{ marginBottom: 8 }}>Hot zones</h3>
          {topCells.map((c) => (
            <div key={`${c.i}-${c.j}`} className="row" style={{ justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid var(--line)' }}>
              <span>{LENGTHS[c.i]}, {LINES[c.j].toLowerCase()}</span>
              <b className="mono">{c.v.toFixed(2)}×</b>
            </div>
          ))}
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">How out</th><th scope="col">Outs</th><th scope="col">Expected</th><th scope="col" title="Observed vs expected for an average batter facing the same number of balls">Index</th></tr></thead>
            <tbody>
              {Object.entries(zone.cats).filter(([, c]) => c[0] > 0 || c[2] >= 1).map(([k, c]) => (
                <tr key={k}>
                  <td>{DCAT[k] ?? k}</td><td>{c[0]}</td><td>{c[2].toFixed(1)}</td>
                  <td className={c[1] >= 1.25 ? 'neg' : c[1] <= 0.8 ? 'pos' : ''}>{c[1].toFixed(2)}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>{zone.outs} dismissals in {zone.balls.toLocaleString()} balls. {hand === 'lhb' ? 'Mirrored for a left-hander. ' : ''}Viewed from the bowler's end.</div>
      </div>
      {tip}
    </div>
  );
}
