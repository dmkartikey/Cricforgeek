// Player page panels for the geek features: data freshness, milestones, rolling form, how they get out,
// home and away, and the "how did they get him" text for head-to-head rows.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { d1, d2, dateShort, n0, pct } from '../lib/fmt';
import { useData } from '../lib/data';
import { DCAT } from '../lib/labels';
import { GLOSSARY, milestones, region, rolling, useNewer } from '../lib/geek';
import { InfoTip, Mini, Panel } from './ui';
import { LineChart } from './charts';
import { Table } from './Table';
import { coverageOf } from '../lib/coverage';

const KIND_SHORT: Record<string, string> = { b: 'bowled', l: 'lbw', k: 'caught behind', c: 'caught', cb: 'c & b', s: 'stumped', h: 'hit wicket' };
const KIND_TINY: Record<string, string> = { b: 'b', l: 'lbw', k: 'ct bh', c: 'ct', cb: 'c&b', s: 'st', h: 'hw' };
/** "2 bowled · 1 lbw" from the pipeline's {b: 2, l: 1}. */
export const kindsText = (k?: Record<string, number>, tiny = false) =>
  !k || !Object.keys(k).length ? '–' : Object.entries(k).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${n} ${(tiny ? KIND_TINY : KIND_SHORT)[x] ?? x}`).join(tiny ? ' ' : ' · ');

export function FreshLine({ p, fk }: { p: any; fk: string }) {
  const f = useNewer(p, fk);
  if (!f) return null;
  return (
    <div className="fresh-line">
      <span className="dot" aria-hidden="true" />
      <span>Stats to <b>{dateShort(f.to)}</b>
        {f.newer.length > 0 && <> · {f.newer.length} newer {f.team} {f.newer.length === 1 ? 'match is' : 'matches are'} not in these numbers yet:{' '}
          {f.newer.slice(0, 3).map((m, i) => <span key={m.id}>{i ? ', ' : ''}<Link className="link" to="/matches">{m.teams.map((t) => t.replace(/\s+Women$/i, '')).join(' v ')} ({dateShort(m.start.slice(0, 10))})</Link></span>)}
        </>}
      </span>
      <InfoTip text="These numbers come from Cricsheet's ball-by-ball files, which usually arrive a few days after each match. Newer results show on the Matches and Live pages first and join the player stats once Cricsheet publishes them." label="About data freshness" />
    </div>
  );
}

export function MilestoneChips({ p, fk }: { p: any; fk: string }) {
  const ms = milestones(p, fk);
  const last = (p.teams ?? []).reduce((a: number, t: any) => Math.max(a, +t[3] || 0), 0);
  if (!ms.length || last < new Date().getFullYear() - 1) return null;
  const fmt = fk.startsWith('TEST') ? 'Test' : fk.startsWith('ODI') ? 'ODI' : 'T20I';
  return (
    <div className="chips milestones">
      {ms.map((m) => (
        <span key={m.kind} className="tag milestone" title="Counted from internationals with ball-by-ball records on Cricsheet; a few early or missing matches can leave it short of the official total.">
          <b>{n0(m.need)}</b> {m.kind === 'runs' ? 'runs' : 'wickets'} from {n0(m.next)} {fmt} {m.kind === 'runs' ? 'runs' : 'wickets'}
        </span>
      ))}
    </div>
  );
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function RollingForm({ p, fk, role }: { p: any; fk: string; role: 'bat' | 'bowl' }) {
  const inns: number[][] = p.inns?.[fk]?.[role] ?? [];
  const [n, setN] = useState<'10' | '20'>('10');
  const vals = useMemo(() => rolling(inns, +n, role), [inns, n, role]);
  const s = p.summary?.[fk]?.[role];
  if (inns.length < 15 || !s) return null;
  const career = role === 'bat' ? s.r / Math.max(s.o, 1) : s.r / Math.max(s.w, 1);
  const labels = inns.map((x) => `${String(x[0]).slice(0, 4)}-${String(x[0]).slice(4, 6)}-${String(x[0]).slice(6, 8)}`);
  const ok = vals.filter((v) => v != null) as number[];
  const peakI = role === 'bat' ? vals.indexOf(Math.max(...ok)) : vals.indexOf(Math.min(...ok));
  return (
    <Panel title="Rolling form" sub={role === 'bat'
      ? `Batting average over the previous ${n} innings, across the whole career. Dashed line = career average (${d1(career)}).`
      : `Bowling average over the previous ${n} innings (lower is better). Dashed line = career average (${d1(career)}).`}
      tools={<Mini label="Window" value={n} onChange={setN} options={[['10', '10 innings'], ['20', '20 innings']]} />}
      foot={peakI >= 0 ? <>Best stretch ended {dateShort(labels[peakI])}: {d1(vals[peakI])} over {n} innings.</> : undefined}>
      <LineChart key={n + role} aria="Rolling average" labels={labels} xFmt={(l) => `${MON[+l.slice(5, 7) - 1]} '${l.slice(2, 4)}`} fmt={d1} refLine={career} refLabel="career" height={220}
        series={[{ name: `${n}-innings average`, color: role === 'bat' ? 'var(--s1)' : 'var(--s2)', values: vals }]} />
    </Panel>
  );
}

const TYPE_LABEL: Record<string, string> = { pace: 'Pace', spin: 'Spin', unknown: 'Style unknown', '-': '' };
export function HowOut({ p, fk, role }: { p: any; fk: string; role: 'bat' | 'bowl' }) {
  const rows: [string, string, number][] = p.splits?.[fk]?.[role]?.how ?? [];
  const total = rows.reduce((a, r) => a + r[2], 0);
  if (total < 5) return null;
  const by = new Map<string, { n: number; parts: Record<string, number> }>();
  for (const [k, t, n] of rows) {
    const e = by.get(k) ?? { n: 0, parts: {} };
    e.n += n; e.parts[t] = (e.parts[t] ?? 0) + n; by.set(k, e);
  }
  const list = [...by.entries()].sort((a, b) => b[1].n - a[1].n);
  const max = list[0][1].n;
  const parts = role === 'bat' ? ['pace', 'spin', 'unknown'] : ['R', 'L', 'unknown'];
  const pl: Record<string, string> = role === 'bat' ? TYPE_LABEL : { R: 'Right-handers', L: 'Left-handers', unknown: 'Hand unknown' };
  const col: Record<string, string> = { pace: 'var(--s1)', spin: 'var(--s2)', R: 'var(--s1)', L: 'var(--s2)', unknown: 'var(--neutral)', '-': 'var(--s3)' };
  const top = list[0];
  return (
    <Panel title={role === 'bat' ? 'How they get out' : 'How the wickets come'}
      sub={role === 'bat' ? `${n0(total)} dismissals, split by the type of bowler who took them.` : `${n0(total)} wickets, split by the batter's hand.`}
      foot={<>{DCAT[top[0]] ?? top[0]} is the most common: {pct(top[1].n / total, 0)} of all {role === 'bat' ? 'dismissals' : 'wickets'}.</>}>
      <div className="legend" style={{ marginBottom: 8 }}>
        {parts.map((k) => <span key={k}><i style={{ background: col[k] }} />{pl[k]}</span>)}
      </div>
      <div className="howout">
        {list.map(([k, e]) => (
          <div key={k} className="ho-row" title={Object.entries(e.parts).map(([t, n]) => `${pl[t] || (t === '-' ? 'Run out' : t)}: ${n}`).join(' · ')}>
            <span className="ho-l">{DCAT[k] ?? k}</span>
            <span className="ho-bar"><span className="sweep" style={{ width: `${(e.n / max) * 100}%` }}>
              {Object.entries(e.parts).sort((a, b) => parts.indexOf(a[0]) - parts.indexOf(b[0])).map(([t, n]) => <i key={t} style={{ width: `${(n / e.n) * 100}%`, background: col[t] ?? 'var(--neutral)' }} />)}
            </span></span>
            <span className="ho-v mono">{e.n} <small>{pct(e.n / total, 0)}</small></span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function HomeAway({ p, fk, role }: { p: any; fk: string; role: 'bat' | 'bowl' }) {
  const sp = p.splits?.[fk]?.[role] ?? {};
  const [view, setView] = useState<'ha' | 'reg' | 'host'>('ha');
  const ha: any[] = sp.ha ?? [], host: any[] = sp.host ?? [];
  if (!ha.length) return null;
  const regs = new Map<string, number[]>();
  for (const r of host) {
    const k = region(r[0]); const e = regs.get(k) ?? Array(r.length - 1).fill(0);
    for (let i = 1; i < r.length; i++) e[i - 1] += +r[i] || 0;
    regs.set(k, e);
  }
  const rows = view === 'ha' ? ha.filter((r) => r[0] !== 'unknown') : view === 'reg' ? [...regs.entries()].map(([k, v]) => [k, ...v]) : host.filter((r) => r[0] !== 'unknown');
  const label: Record<string, string> = { home: 'Home', away: 'Away', neutral: 'Neutral venues' };
  // bat rows: [k, inns, runs, balls, outs, impact, 50s, 100s]; bowl rows: [k, inns, wkts, balls, runs, impact]
  return (
    <Panel flush title="Home and away" sub="Internationals only. Home = the side that plays most internationals at the ground."
      tools={<Mini label="By" value={view} onChange={setView} options={[['ha', 'Home / away'], ['reg', 'Region'], ['host', 'Country']]} />}>
      <Table key={view + role} rows={rows} sort="i" cols={role === 'bat' ? [
        { key: 'k', label: view === 'ha' ? 'Where' : view === 'reg' ? 'Region' : 'Country', left: true, get: (r: any) => label[r[0]] ?? r[0] },
        { key: 'i', label: 'Inns', get: (r: any) => r[1] },
        { key: 'r', label: 'Runs', get: (r: any) => r[2], fmt: n0 },
        { key: 'avg', label: 'Avg', get: (r: any) => (r[4] ? r[2] / r[4] : NaN), fmt: d1 },
        { key: 'sr', label: 'SR', get: (r: any) => (r[3] ? (100 * r[2]) / r[3] : NaN), fmt: d1 },
        { key: 'h', label: '100s', get: (r: any) => r[7] },
      ] : [
        { key: 'k', label: view === 'ha' ? 'Where' : view === 'reg' ? 'Region' : 'Country', left: true, get: (r: any) => label[r[0]] ?? r[0] },
        { key: 'i', label: 'Inns', get: (r: any) => r[1] },
        { key: 'w', label: 'Wkts', get: (r: any) => r[2] },
        { key: 'avg', label: 'Avg', get: (r: any) => (r[2] ? r[4] / r[2] : NaN), fmt: d1 },
        { key: 'e', label: 'Econ', get: (r: any) => (r[3] ? (6 * r[4]) / r[3] : NaN), fmt: d2 },
      ]} />
    </Panel>
  );
}

export const Tip = ({ k }: { k: keyof typeof GLOSSARY }) => <InfoTip text={GLOSSARY[k]} />;

/** Cricsheet doesn't have every international. When it is missing a noticeable share of the matches from this
 *  player's years in a format, say so, with a rough count of how many of their matches that could be. */
export function CoverageNote({ p, fk }: { p: any; fk: string }) {
  const cov = useData<any>('coverage.json').data;
  const c = coverageOf(p, fk, cov);
  const [fam, g] = fk.split('-');
  const afg = !!cov && (cov.absent_teams ?? []).includes('Afghanistan') && fam !== 'TEST' && g === 'male' && !!c;
  if (!c || (!c.partial && c.share >= 0.97 && !afg)) return null;
  const fl = fam === 'TEST' ? 'Tests' : fam === 'ODI' ? 'ODIs' : 'T20Is';
  return (
    <div className={`notice cov-note${c.partial ? ' partial' : ''}`}>
      {c.partial && <b className="cov-badge">{c.label}</b>}{' '}
      {c.before && <>Cricsheet's ball-by-ball {g === 'female' ? "women's " : ''}{fl} begin in {c.start}, so anything this player did before then isn't counted. </>}
      {!c.before && c.share < 0.97 && <>Cricsheet has {Math.round(c.share * 100)}% of the {g === 'female' ? "women's " : ''}{fl} played in {c.from}–{c.to}, so these totals may be short of the official record{c.missing >= 1 ? ` (roughly ${c.missing} innings could be missing)` : ''}. </>}
      {afg && <>Matches against Afghanistan aren't in Cricsheet at all. </>}
      Every match that is here is counted exactly. <Link className="link" to="/methodology#coverage">How complete the data is</Link>
    </div>
  );
}
