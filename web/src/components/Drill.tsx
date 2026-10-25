import { bat, bowl, batSplit, bowlSplit, ok, SplitRow } from '../lib/stats';
import { d1, d2, n0, pct, signed } from '../lib/fmt';
import { BGRP, INN, LEV, MULTI, PHASES } from '../lib/labels';
import { Drawer, PinButton } from './ui';
import { HBars } from './charts';

export type DrillMetric = { key: string; label: string; fmt: (v: number) => string };

export const BAT_METRICS: DrillMetric[] = [
  { key: 'r', label: 'Runs', fmt: n0 }, { key: 'avg', label: 'Average', fmt: d2 }, { key: 'sr', label: 'Strike rate', fmt: d1 },
  { key: 'bpd', label: 'Balls per dismissal', fmt: d1 }, { key: 'imp', label: 'Impact', fmt: (v) => signed(v, 0) },
  { key: 'imp100', label: 'Impact / 100 balls', fmt: (v) => signed(v, 2) }, { key: 'wpa', label: 'Win prob. added', fmt: (v) => signed(v, 2) },
  { key: 'bnd', label: 'Boundary %', fmt: (v) => pct(v) }, { key: 'dotp', label: 'Dot %', fmt: (v) => pct(v) },
];
export const BOWL_METRICS: DrillMetric[] = [
  { key: 'w', label: 'Wickets', fmt: n0 }, { key: 'econ', label: 'Economy', fmt: d2 }, { key: 'avg', label: 'Average', fmt: d1 },
  { key: 'sr', label: 'Strike rate', fmt: d1 }, { key: 'saved', label: 'Runs saved v average', fmt: (v) => signed(v, 0) },
  { key: 'imp', label: 'Impact', fmt: (v) => signed(v, 0) }, { key: 'imp100', label: 'Impact / 100 balls', fmt: (v) => signed(v, 2) },
  { key: 'wpa', label: 'Win prob. added', fmt: (v) => signed(v, 2) }, { key: 'dotp', label: 'Dot %', fmt: (v) => pct(v) },
];
const pretty = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// For a career number, show it broken down by every split we have, each with its own pin.
export function Drill({ p, fk, role, metric, onClose, name }: { p: any; fk: string; role: 'bat' | 'bowl'; metric: DrillMetric; onClose: () => void; name: string }) {
  const fam = fk.split('-')[0];
  const sp = p.splits?.[fk]?.[role] ?? {};
  const career: any = role === 'bat' ? bat(p.summary[fk].bat) : bowl(p.summary[fk].bowl);
  const conv = role === 'bat' ? batSplit : bowlSplit;
  const minB = role === 'bat' ? 30 : 36;
  const k = metric.key;
  const counting = ['r', 'w', 'imp', 'wpa', 'saved'].includes(k);
  const dims: [string, string, (key: string) => string][] = [
    ['phase', 'Phase of the innings', (x) => (PHASES[fam] ?? PHASES.T20)[+x] ?? x],
    ...(role === 'bat' ? [['type', 'Pace or spin', (x: string) => (x === 'pace' ? 'v Pace' : x === 'spin' ? 'v Spin' : 'Style unknown')], ['vs', 'Bowling style', (x: string) => BGRP[x] ?? x]] as [string, string, (k: string) => string][]
      : [['hand', 'Batter hand', (x: string) => (x === 'R' ? 'v Right-handers' : x === 'L' ? 'v Left-handers' : 'Hand unknown')]] as [string, string, (k: string) => string][]),
    ['inn', 'Innings', (x) => INN[x] ?? x],
    ...(!MULTI(fam) ? [['lev', 'Leverage', (x: string) => LEV[x] ?? x]] as [string, string, (k: string) => string][] : []),
    ['year', 'Year', (x) => x],
  ];
  // opposition and venue rows have a shorter layout: bat [k, inns, runs, balls, outs, imp]; bowl [k, inns, wkts, balls, runs, imp]
  const short = (row: any[]) => (role === 'bat'
    ? { r: row[2], b: row[3], avg: row[4] ? row[2] / row[4] : NaN, sr: row[3] ? (100 * row[2]) / row[3] : NaN, imp: row[5], imp100: row[3] ? (100 * row[5]) / row[3] : NaN }
    : { w: row[2], b: row[3], econ: row[3] ? (6 * row[4]) / row[3] : NaN, avg: row[2] ? row[4] / row[2] : NaN, sr: row[2] ? row[3] / row[2] : NaN, imp: row[5], imp100: row[3] ? (100 * row[5]) / row[3] : NaN });
  const shortOk = ['r', 'w', 'avg', 'sr', 'econ', 'imp', 'imp100'].includes(k);

  const section = (id: string, title: string, rows: { label: string; v: number; b: number }[]) => {
    const valid = rows.filter((r) => ok(r.v));
    if (!valid.length) return null;
    const max = Math.max(...valid.map((r) => Math.abs(r.v)), 1e-9);
    return (
      <div key={id} className="card-sec" style={{ paddingBottom: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: '14px 22px 8px' }}>
          <h3>{title}</h3>
          <PinButton pin={{ id: `drill:${p.id}:${fk}:${role}:${k}:${id}`, title: `${name} · ${metric.label} by ${title.toLowerCase()}`, ctx: fk.replace('-', ' · '), href: `/player/${p.id}`,
            rows: valid.slice(0, 6).map((r) => ({ l: r.label, v: metric.fmt(r.v), w: Math.abs(r.v) / max })) }} />
        </div>
        <div style={{ padding: '0 22px' }}>
          <HBars fmt={metric.fmt} base={counting ? 0 : career[k]} refLabel={counting ? 'zero' : 'career'} max={counting ? max * 1.05 : undefined}
            rows={valid.map((r) => ({ label: r.label, value: r.v, note: `${n0(r.b)} balls` }))} />
        </div>
      </div>
    );
  };

  return (
    <Drawer title={`${metric.label}: ${ok(career[k]) ? metric.fmt(career[k]) : '–'}`} sub={`${name} · broken down by every split. Splits with fewer than ${minB} balls are hidden.`} onClose={onClose}>
      {dims.map(([dim, title, lab]) => {
        let rows = ((sp[dim] ?? []) as SplitRow[]).map((r) => ({ label: lab(String(r[0])), v: (conv(r) as any)[k] as number, b: r[1] as number, key: String(r[0]) }))
          .filter((r) => r.b >= minB && r.key !== 'unknown');
        if (dim === 'year') rows = rows.sort((a, b) => a.key.localeCompare(b.key));
        else if (dim === 'phase' || dim === 'inn') rows = rows.sort((a, b) => a.key.localeCompare(b.key));
        else rows = rows.sort((a, b) => b.b - a.b);
        return section(dim, title, rows);
      })}
      {shortOk && ['opp', 'venue'].map((dim) => section(dim, dim === 'opp' ? 'Opposition' : 'Venue',
        ((sp[dim] ?? []) as any[]).map((r) => ({ label: dim === 'venue' ? pretty(r[0]) : r[0], v: (short(r) as any)[k], b: r[3] })).filter((r) => r.b >= minB).sort((a, b) => b.b - a.b).slice(0, 12)))}
    </Drawer>
  );
}
