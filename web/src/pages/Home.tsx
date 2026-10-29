import { useMemo, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { FMTS, LEVELS, useSettings } from '../lib/settings';
import { MULTI, PHASES } from '../lib/labels';
import { d1, d2, dateShort, n0, signed } from '../lib/fmt';
import { Dumbbell, ErrorBox, Legend, Loader, Lollipop, Mini, MiniSelect, Panel, RankList, SectionHead, Seg, SERIES, ScrollTabs, JumpLinks } from '../components/ui';
import { HBars, LineChart, WagonMix } from '../components/charts';
import { OnThisDay } from '../components/OnThisDay';
import { Table } from '../components/Table';
import Tests from './Tests';
import { Board as Scoreboard, SbCell } from '../components/Scoreboard';
import { ViewBar } from '../components/ViewBar';
import { useFullName } from '../lib/names';

type Stats = { b: number; r: number; o?: number; w?: number; imp: number; wpa: number; xr: number; t: string };
type Row = [string, string, number, Stats];
export type Board = { key: string; metric: string; title: string; desc: string; window: string; kind: 'bat' | 'bowl'; unit: string; min_balls: number; order?: string; rows: Row[] };
type Breakout = [string, string, number, number, number, number, number, string];
type Pulse = { m: number; rpo: number; rpw: number; dot: number; six_pm: number; four_pm: number; bpw: number; pace_share: number; n_dot: number; n_r13: number; n_four: number; n_six: number; n_faced: number };
type Scope = { fmt: string; boards: Board[]; breakouts: { bat: Breakout[]; bowl: Breakout[] }; pulse: { now: Pulse; prev: Pulse; all: Pulse };
  years: { year: number; m: number; rpo: number; rpw: number; dot: number; six_pm: number }[]; phases: { year: number; phase: number; rpo: number; bpw: number }[];
  chase: { comp: string; label: string; chase_win: number; n: number }[]; comps: { comp: string; m: number; last: string }[] };
type HomeIdx = { scopes: { key: string; fmt: string; gender: string; level: string; level_label: string; matches: number }[]; cut365: string; data_to: string;
  trend: { comp: string; year: number; rpo: number; six_pm: number; four_pm: number; dot_pct: number; bpw: number }[] };

const BAT_LIM = ['bat_imp', 'bat_runs', 'bat_avg', 'bat_sr', 'hardest_out', 'pp_sr', 'death_sr', 'pace_sr', 'spin_sr', 'bat_wpa'];
const BOWL_LIM = ['bowl_imp', 'bowl_wkts', 'bowl_avg', 'bowl_econ', 'bowl_sr', 'pp_econ', 'death_econ', 'bowl_wpa'];
const BAT_MD = ['bat_imp', 'bat_runs', 'bat_avg', 'hardest_out', 'bat_sr', 'newball_avg', 'inn4_bat', 'pace_sr', 'spin_sr'];
const BOWL_MD = ['bowl_imp', 'bowl_wkts', 'bowl_avg', 'bowl_sr', 'bowl_econ', 'newball_wkts', 'inn4_bowl'];
const SHORT: Record<string, string> = {
  bat_imp: 'Impact', bat_runs: 'Runs', bat_avg: 'Average', bat_sr: 'Strike rate', hardest_out: 'Balls/out', pp_sr: 'Powerplay', death_sr: 'Death', pace_sr: 'v Pace',
  spin_sr: 'v Spin', bat_wpa: 'Win prob.', bowl_imp: 'Impact', bowl_wkts: 'Wickets', bowl_avg: 'Average', bowl_econ: 'Economy', bowl_sr: 'Strike rate',
  pp_econ: 'Powerplay', death_econ: 'Death', bowl_wpa: 'Win prob.', newball_avg: 'New ball', inn4_bat: '4th innings', newball_wkts: 'New ball', inn4_bowl: '4th innings',
};

export const fmtBoard = (b: Pick<Board, 'metric' | 'unit'>, v: number) => {
  switch (b.unit) {
    case 'runs': return signed(v, 0);
    case 'wins': return signed(v, 2);
    case 'count': return n0(v);
    case 'sr': return d1(v);
    case 'avg': return d2(v);
    case 'econ': return d2(v);
    case 'bpd': return d1(v);
    default: return d1(v);
  }
};
const UNIT: Record<string, string> = { runs: 'runs vs average', wins: 'wins added', count: 'total', sr: 'runs per 100 balls', avg: 'runs per wicket', econ: 'runs per over', bpd: 'balls per wicket' };
const unitText = (b: Board) => (b.metric === 'full_straight' || b.metric === 'corridor' ? 'per 1,000 balls' : UNIT[b.unit] ?? '');
const baseOf = (_b: Board) => 0;
// bar length: share of the best value; for lower-is-better boards the best is the smallest
const barVal = (b: Board, v: number, best: number) => (b.order === 'asc' ? best / Math.max(v, 1e-9) : v);
const metaOf = (b: Board, s: Stats) => (b.kind === 'bat'
  ? `${s.t} · ${n0(s.r)} runs · ${n0(s.b)} balls`
  : `${s.t} · ${n0(s.w)} wkts · ${n0(s.b)} balls`);

// One leaderboard with a tab per metric, its own filters, and a list / table switch
function Leaders({ boards, keys, kind, scopeLabel }: { boards: Map<string, Board>; keys: string[]; kind: 'bat' | 'bowl'; scopeLabel: string }) {
  const fullName = useFullName();
  const avail = keys.filter((k) => boards.get(k)?.rows.length);
  const [tab, setTab] = useState(avail[0] ?? '');
  const [top, setTop] = useState<'10' | '25' | '50'>('10');
  const [mult, setMult] = useState<'1' | '2' | '4'>('1');
  const [team, setTeam] = useState('all');
  const [view, setView] = useState<'list' | 'table'>('list');
  const b = boards.get(avail.includes(tab) ? tab : avail[0]);
  const teams = useMemo(() => (b ? [...new Set(b.rows.map((r) => r[3].t).filter(Boolean))].sort() : []), [b]);
  if (!b) return <Panel title={kind === 'bat' ? 'Batting leaders' : 'Bowling leaders'}><div className="empty">No leaderboard for this selection.</div></Panel>;
  const minB = b.min_balls * +mult;
  const rows = b.rows.filter((r) => (team === 'all' || r[3].t === team) && (!b.min_balls || (r[3].b ?? 0) >= minB)).slice(0, +top);
  return (
    <Panel flush title={kind === 'bat' ? 'Batting leaders' : 'Bowling leaders'} sub={b.desc}
      pin={{ id: `board:${scopeLabel}:${b.key}`, title: `${b.title}`, ctx: scopeLabel, href: '/', rows: rows.slice(0, 5).map((r) => ({ l: r[1], v: fmtBoard(b, r[2]),
        w: barVal(b, r[2], rows[0][2]) / Math.max(1e-9, barVal(b, rows[0][2], rows[0][2])), href: `/player/${r[0]}` })) }}>
      <ScrollTabs style={{ padding: '0 14px' }}>
        {avail.map((k) => <button key={k} role="tab" aria-selected={k === b.key.split(':')[0]} onClick={() => { setTab(k); setTeam('all'); }}>{SHORT[k] ?? k}</button>)}
      </ScrollTabs>
      <div className="mini-bar" role="toolbar" style={{ padding: '14px 22px' }}>
        <Mini label="Show" value={top} onChange={setTop} options={[['10', '10'], ['25', '25'], ['50', '50']]} />
        {b.min_balls > 0 && <Mini label="Min balls" value={mult} onChange={setMult} options={[['1', n0(b.min_balls)], ['2', n0(b.min_balls * 2)], ['4', n0(b.min_balls * 4)]]} />}
        <MiniSelect label="Team" value={team} onChange={setTeam} options={[['all', 'All teams'], ...teams.map((t) => [t, t] as [string, string])]} />
        <span className="spacer" />
        <Mini label="View" value={view} onChange={setView} options={[['list', 'Ranked'], ['table', 'Table']]} />
      </div>
      {view === 'list'
        ? <RankList unit={unitText(b)} base={baseOf(b)} rows={rows.map((r) => ({ id: r[0], name: r[1], meta: metaOf(b, r[3]), value: barVal(b, r[2], rows[0]?.[2] ?? 1), text: fmtBoard(b, r[2]), href: `/player/${r[0]}` }))} />
        : <Table rank rows={rows} cols={[
            { key: 'n', label: kind === 'bat' ? 'Batter' : 'Bowler', left: true, sortable: false, get: (r: Row) => r[1], fmt: (v, r: Row) => <Link className="link" to={`/player/${r[0]}`}>{fullName(r[0], v)}</Link> },
            { key: 't', label: 'Team', left: true, get: (r: Row) => r[3].t },
            { key: 'v', label: SHORT[b.metric] ?? 'Value', get: (r: Row) => r[2], fmt: (v) => <b>{fmtBoard(b, v)}</b> },
            { key: 'b', label: 'Balls', get: (r: Row) => r[3].b, fmt: n0 },
            ...(kind === 'bat'
              ? [{ key: 'r', label: 'Runs', get: (r: Row) => r[3].r, fmt: n0 }, { key: 'o', label: 'Outs', get: (r: Row) => r[3].o },
                 { key: 'avg', label: 'Avg', get: (r: Row) => r[3].r / Math.max(r[3].o ?? 0, 1), fmt: d1 }, { key: 'sr', label: 'SR', get: (r: Row) => (100 * r[3].r) / r[3].b, fmt: d1 }]
              : [{ key: 'w', label: 'Wkts', get: (r: Row) => r[3].w }, { key: 'e', label: 'Econ', get: (r: Row) => (6 * r[3].r) / r[3].b, fmt: d2 },
                 { key: 'avg', label: 'Avg', get: (r: Row) => r[3].r / Math.max(r[3].w ?? 0, 1), fmt: d1 }]),
            { key: 'imp', label: 'Impact', get: (r: Row) => r[3].imp, fmt: (v) => signed(v, 0) },
          ]} />}
      {b.min_balls > 0 && <div className="panel-foot">Minimum {n0(minB)} balls.</div>}
    </Panel>
  );
}

// Change against the previous 365 days, as board text and a tone
function delta(now: number, prev: number, fmt: (v: number) => string, invert?: boolean): [string, 'up' | 'down' | 'flat'] {
  if (!isFinite(now) || !isFinite(prev) || !prev) return ['no previous year', 'flat'];
  const d = now - prev, up = d > 0;
  const tone = Math.abs(d / prev) < 0.01 ? 'flat' : (up !== !!invert ? 'up' : 'down');
  return [`${up ? '▲' : d < 0 ? '▼' : '■'} ${fmt(Math.abs(d))} on last year`, tone];
}


export default function Home() {
  usePageMeta('cricforgeek: ball-by-ball cricket stats for geeks', true);
  const s = useSettings();
  const idx = useData<HomeIdx>('home.json');
  const scopes = idx.data?.scopes ?? [];
  const want = `${s.fmt}-${s.gender}-${s.level}`;
  const fallback = scopes.find((x) => x.key === want) ?? ['top', 'intl', 'all'].map((l) => scopes.find((x) => x.key === `${s.fmt}-${s.gender}-${l}`)).find(Boolean);
  const { data, error } = useData<Scope>(fallback ? `home/${fallback.key}.json` : null);
  const [win, setWin] = useState<'365' | 'all'>('365');
  const [boKind, setBoKind] = useState<'bat' | 'bowl'>('bat');
  const [clKind, setClKind] = useState<'bat' | 'bowl'>('bat');
  const [ym, setYm] = useState<'rpo' | 'rpw' | 'dot' | 'six_pm'>('rpo');
  const [pm, setPm] = useState<'rpo' | 'bpw'>('rpo');
  const [zone, setZone] = useState<'full_straight' | 'corridor'>('full_straight');
  const [leagues, setLeagues] = useState<string[]>(['ipl', 'bbl', 'psl', 't20-blast']);
  const [tm, setTm] = useState<'rpo' | 'six_pm' | 'dot_pct' | 'bpw'>('rpo');
  const [cmin, setCmin] = useState<'30' | '100' | '250'>('30');

  const boards = useMemo(() => {
    const m = new Map<string, Board>();
    for (const b of data?.boards ?? []) if (b.window === win) m.set(b.metric, b);
    return m;
  }, [data, win]);

  if (idx.error) return <ErrorBox error={idx.error} />;
  if (idx.data && !fallback) {
    return <><ViewBar level /><div className="notice">There is not enough {s.gender === 'female' ? "women's" : "men's"} {FMTS.find((f) => f.k === s.fmt)?.l} cricket in the data for an overview yet. Pick another format or Men above.</div></>;
  }
  if (error) return <><ViewBar level /><ErrorBox error={error} /></>;
  if (!data || !idx.data || !fallback) return <Loader text="Loading overview" />;

  const multi = MULTI(s.fmt);
  const fl = FMTS.find((f) => f.k === s.fmt)!;
  const g = s.gender === 'male' ? "Men's" : "Women's";
  const scopeLabel = `${fl.l} · ${s.gender === 'male' ? 'Men' : 'Women'} · ${fallback.level_label}`;
  const P = data.pulse;
  const share = (p: Pulse) => [p.n_dot, p.n_r13, p.n_four, p.n_six].map((v) => (100 * v) / Math.max(1, p.n_faced));
  const prevShare = share(P.prev);
  const years = data.years.filter((y) => y.m >= (multi ? 5 : 10));
  const phaseYears = [...new Set(data.phases.map((p) => p.year))].filter((y) => years.some((x) => x.year === y)).sort();
  const phNames = PHASES[s.fmt] ?? PHASES.T20;
  const YM: Record<string, [string, (v: number) => string]> = { rpo: ['Runs per over', d2], rpw: ['Runs per wicket', d1], dot: ['Dot-ball %', (v) => `${d1(v)}%`], six_pm: ['Sixes per match', d1] };
  const bo = (data.breakouts[boKind] ?? []).slice(0, 10);
  const clutch = boards.get(clKind === 'bat' ? 'clutch' : 'clutch_bowl');
  const zb = boards.get(zone);
  const inScope = new Set(data.comps.map((c) => c.comp));
  const trendComps = [...new Set(idx.data.trend.map((t) => t.comp))].filter((c) => inScope.has(c));
  const tyears = [...new Set(idx.data.trend.filter((t) => leagues.includes(t.comp)).map((t) => t.year))].sort();
  const TM: Record<string, [string, (v: number) => string]> = { rpo: ['Runs per over', d2], six_pm: ['Sixes per match', d1], dot_pct: ['Dot-ball %', (v) => `${d1(v)}%`], bpw: ['Balls per wicket', d1] };
  const compName = (c: string) => data.chase.find((x) => x.comp === c)?.label ?? c.toUpperCase().replace(/-/g, ' ');
  // short codes (IPL, BBL) read best as they are; longer keys get the competition's own name
  const lgName = (c: string) => (!c.includes('-') && c.length <= 5 ? c.toUpperCase() : compName(c));
  const chase = data.chase.filter((c) => c.n >= +cmin);

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Overview · {fallback.level_label}</div>
          <h1>{g} {fl.l} cricket</h1>
          <p className="lede">{n0(fallback.matches)} matches with ball-by-ball records, adjusted for era, phase and wickets in hand.
            Data to {dateShort(idx.data.data_to)}. Change format, men or women and level just below.</p>
        </div>
        <Seg label="Time window" value={win} onChange={setWin} options={[['365', 'Last 365 days'], ['all', 'All time']]} />
      </section>
      <ViewBar level />
      {fallback.key !== want && <div className="notice info">No {LEVELS.find((l) => l[0] === s.level)?.[1].toLowerCase()} data for this format, so this shows {fallback.level_label.toLowerCase()}.</div>}

      {(() => {
        const cells: [string, string, [string, 'up' | 'down' | 'flat']][] = [
          ['Matches', n0(P.now.m), [`${n0(P.all.m)} all time`, 'flat']],
          ['Runs / over', d2(P.now.rpo), delta(P.now.rpo, P.prev.rpo, d2)],
          ['Runs / wkt', d1(P.now.rpw), delta(P.now.rpw, P.prev.rpw, d1)],
          ['Dot balls', `${d1(P.now.dot)}%`, delta(P.now.dot, P.prev.dot, (v) => d1(v) + ' pts', true)],
          multi ? ['Balls / wkt', d1(P.now.bpw), delta(P.now.bpw, P.prev.bpw, d1)] : ['Sixes / match', d1(P.now.six_pm), delta(P.now.six_pm, P.prev.six_pm, d1)],
          ['Wickets to pace', `${d1(P.now.pace_share)}%`, delta(P.now.pace_share, P.prev.pace_share, (v) => d1(v) + ' pts')],
        ];
        return (
          <Scoreboard key={fallback.key} plate={`${fl.l} · ${s.gender === 'male' ? 'Men' : 'Women'} · last 365 days`}>
            <div className="sb-grid">
              {cells.map(([l, v, [sub, tone]], i) => <SbCell key={l} label={l} value={v} sub={sub} tone={tone} delay={i * 140} />)}
            </div>
          </Scoreboard>
        );
      })()}

      <OnThisDay />
      <JumpLinks items={[['leaders', 'Leaders'], ['movers', 'Movers'], ['game', "How it's played"], ...(s.fmt === 'T20' && s.gender === 'male' ? [['trends', 'League trends'] as [string, string]] : []), ...(s.fmt === 'TEST' ? [['testlab', 'Test match lab'] as [string, string]] : [])]} />

      <SectionHead id="leaders" title="Leaders" sub={`${win === '365' ? 'Last 365 days' : 'All time'}. Every number is adjusted for the situation it came in. Tap a name for the full profile.`} />
      <div className="grid g2">
        <Leaders key={`bat-${win}-${fallback.key}`} boards={boards} keys={multi ? BAT_MD : BAT_LIM} kind="bat" scopeLabel={scopeLabel} />
        <Leaders key={`bowl-${win}-${fallback.key}`} boards={boards} keys={multi ? BOWL_MD : BOWL_LIM} kind="bowl" scopeLabel={scopeLabel} />
      </div>

      <SectionHead id="movers" title="Movers and pressure" sub="Who is improving fastest, and who delivers when the result is on the line." />
      <div className="grid g2">
        <Panel flush title="Breakouts" sub="Impact per 100 balls: the last 365 days against the two years before."
          tools={<Mini label="Role" value={boKind} onChange={setBoKind} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />}
          pin={bo.length ? { id: `breakouts:${fallback.key}:${boKind}`, title: `Breakouts · ${boKind === 'bat' ? 'batting' : 'bowling'}`, ctx: scopeLabel, href: '/',
            rows: bo.slice(0, 5).map((r) => ({ l: r[1], v: signed(r[4], 1), w: r[4] / Math.max(1e-9, bo[0][4]), href: `/player/${r[0]}` })) } : null}
          foot={<Legend items={[{ label: 'Two years before', color: 'var(--muted)', kind: 'dot' }, { label: 'Last 365 days', color: 'var(--accent)', kind: 'dot' }]} />}>
          <Dumbbell fmt={(v) => d1(v)} thenLabel="Before" nowLabel="Last 365 days"
            rows={bo.map((r) => ({ id: r[0], name: r[1], meta: `${r[7] ?? ''} · ${n0(r[5])} balls this year`, then: r[3], now: r[2], href: `/player/${r[0]}` }))} />
        </Panel>
        {!multi && clutch ? (
          <Panel flush title={clKind === 'bat' ? 'Clutch batting' : 'Clutch bowling'} sub="Impact on high-leverage balls only: the moments where win probability swings most."
            tools={<Mini label="Role" value={clKind} onChange={setClKind} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />}
            pin={{ id: `clutch:${fallback.key}:${clKind}:${win}`, title: clKind === 'bat' ? 'Clutch batting' : 'Clutch bowling', ctx: scopeLabel, href: '/',
              rows: clutch.rows.slice(0, 5).map((r) => ({ l: r[1], v: signed(r[2], 0), w: r[2] / Math.max(1e-9, clutch.rows[0][2]), href: `/player/${r[0]}` })) }}
            foot="Leverage ≥ 1.5: balls where the win chance typically moves at least 1.5 times more than an average ball.">
            <Lollipop fmt={(v) => signed(v, 0)} rows={clutch.rows.slice(0, 10).map((r) => ({ id: r[0], name: r[1], meta: `${r[3].t} · ${n0(r[3].b)} high-leverage balls`,
              value: r[2], sub: `${signed(r[3].wpa, 2)} wins`, href: `/player/${r[0]}` }))} />
          </Panel>
        ) : zb ? (
          <Panel flush title="Vulnerability" sub={zone === 'full_straight' ? 'How often they are bowled or LBW (inferred zones). Shorter gap between dismissals = easier to beat on the stumps.' : 'How often they nick off in the corridor outside off (inferred zones). Shorter gap = more vulnerable.'}
            tools={<Mini label="Zone" value={zone} onChange={setZone} options={[['full_straight', 'Full & straight'], ['corridor', 'Corridor']]} />}>
            <Lollipop fmt={(v) => `1 in ${n0(1000 / v)} balls`} rows={zb.rows.slice(0, 10).map((r) => ({ id: r[0], name: r[1], meta: `${r[3].t} · ${n0(r[3].b)} balls`, value: r[2], href: `/player/${r[0]}` }))} />
          </Panel>
        ) : null}
      </div>

      <SectionHead id="game" title="How the game is played" sub={`${g} ${fl.l} cricket, ball by ball.`} />
      <div className="grid g2">
        <Panel title="Scoring mix" sub="What happens to each ball faced in the last 365 days. Small numbers show the change from the year before.">
          <WagonMix aria="Scoring mix of balls faced" compare={prevShare} parts={[
            { label: 'Dot balls', value: P.now.n_dot, color: 'var(--neutral)' },
            { label: '1, 2 or 3 runs', value: P.now.n_r13, color: 'var(--s1)' },
            { label: 'Fours', value: P.now.n_four, color: 'var(--s4)' },
            { label: 'Sixes', value: P.now.n_six, color: 'var(--s2)' },
          ]} />
        </Panel>
        <Panel title="Year by year" sub={YM[ym][0]} tools={<Mini label="Metric" value={ym} onChange={setYm} options={Object.entries(YM).map(([k, v]) => [k as typeof ym, v[0]])} />}
          pin={{ id: `years:${fallback.key}:${ym}`, title: `${YM[ym][0]} by year`, ctx: scopeLabel, href: '/', rows: years.slice(-5).reverse().map((y) => ({ l: String(y.year), v: YM[ym][1]((y as any)[ym]),
            w: (y as any)[ym] / Math.max(...years.map((x) => (x as any)[ym])) })) }}>
          <LineChart key={ym} aria={`${YM[ym][0]} by year`} labels={years.map((y) => String(y.year))} fmt={YM[ym][1]} height={240}
            series={[{ name: YM[ym][0], color: 'var(--s1)', wash: true, values: years.map((y) => (y as any)[ym]) }]} />
        </Panel>
      </div>
      <div className="grid g2">
        <Panel title="By phase of the innings" sub={pm === 'rpo' ? 'Runs per over in each phase, by year.' : 'Balls per wicket in each phase, by year.'}
          tools={<Mini label="Metric" value={pm} onChange={setPm} options={[['rpo', 'Run rate'], ['bpw', 'Balls per wicket']]} />}>
          <Legend items={phNames.map((p, i) => ({ label: p, color: SERIES[i] }))} />
          <LineChart key={pm} aria="Phase trends" labels={phaseYears.map(String)} fmt={pm === 'rpo' ? d2 : d1} height={240}
            series={[0, 1, 2].map((ph) => ({ name: phNames[ph].split(' (')[0], color: SERIES[ph],
              values: phaseYears.map((y) => (data.phases.find((p) => p.year === y && p.phase === ph) as any)?.[pm] ?? null) }))} />
        </Panel>
        {!multi && data.chase.length > 0 ? (
          <Panel title="Chasing advantage" sub="Share of decided matches won by the side batting second."
            tools={<Mini label="Min matches" value={cmin} onChange={setCmin} options={[['30', '30'], ['100', '100'], ['250', '250']]} />}>
            <HBars base={0.5} refLabel="even" fmt={(v) => `${(v * 100).toFixed(0)}%`} max={0.75}
              rows={chase.slice(0, 12).map((c) => ({ label: c.label, value: c.chase_win, note: `${n0(c.n)} matches` }))} />
          </Panel>
        ) : data.comps.length <= 1 ? null : (
          <Panel flush title="Competitions in this view" sub="Where these matches come from.">
            {data.comps.slice(0, 10).map((c) => (
              <Link key={c.comp} className="list-row" to={`/league/${c.comp}`}>
                <span className="t">{compName(c.comp)}</span><span className="v">{n0(c.m)} <small className="muted">matches</small></span>
              </Link>
            ))}
          </Panel>
        )}
      </div>

      {s.fmt === 'T20' && s.gender === 'male' && (
        <Panel id="trends" title="League trends" sub="Pick up to four leagues and a metric."
          tools={<Mini label="Metric" value={tm} onChange={setTm} options={Object.entries(TM).map(([k, v]) => [k as typeof tm, v[0]])} />}>
          <div className="chips">{trendComps.map((c) => (
            <button key={c} className="chip" aria-pressed={leagues.includes(c)}
              onClick={() => setLeagues(leagues.includes(c) ? leagues.filter((x) => x !== c) : leagues.length >= 4 ? [...leagues.slice(1), c] : [...leagues, c])}>
              {lgName(c)}</button>))}</div>
          <Legend items={leagues.map((c, i) => ({ label: lgName(c), color: SERIES[i] }))} />
          <LineChart aria={`${TM[tm][0]} by year`} labels={tyears.map(String)} fmt={TM[tm][1]} height={260}
            series={leagues.map((c, i) => ({ name: lgName(c), color: SERIES[i],
              values: tyears.map((y) => (idx.data!.trend.find((t) => t.comp === c && t.year === y) as any)?.[tm] ?? null) }))} />
        </Panel>
      )}


      {s.fmt === 'TEST' && <Tests key={s.gender} gender={s.gender} />}
    </>
  );
}
