import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { Chips, CountUp, ErrorBox, Legend, Loader, Mini, MiniSelect, Panel, Seg, SERIES } from '../components/ui';
import { HBars, LineChart } from '../components/charts';
import { d1, d2, n0, plus, signed } from '../lib/fmt';

type Row = [string, string, number, Record<string, any>];
type Board = { key: string; metric: string; title: string; desc: string; scope: string; scope_label: string; window: string;
  kind: 'bat' | 'bowl'; unit: string; min_balls: number; rows: Row[] };
type Breakout = [string, string, number, number, number, number, number, string];
type Home = { boards: Board[]; breakouts: Record<string, { bat: Breakout[]; bowl: Breakout[] }>;
  trend: { comp: string; year: number; rpo: number; six_pm: number; four_pm: number; dot_pct: number; bpw: number }[];
  chase: { comp: string; label: string; fam: string; gender: string; chase_win: number; n: number }[];
  cut365: string; data_to: string; scopes: [string, string, string][] };

const GROUPS: [string, string, string[]][] = [
  ['impact', 'Impact', ['bat_imp', 'bowl_imp', 'bat_srplus', 'bowl_econplus', 'bat_avgplus', 'hardest_out']],
  ['wp', 'Win probability', ['bat_wpa', 'bowl_wpa', 'clutch']],
  ['phase', 'Phases', ['death_srplus', 'pp_econplus', 'death_econplus']],
  ['match', 'Pace & spin', ['pace_srplus', 'spin_srplus']],
  ['zones', 'Vulnerability', ['full_straight', 'corridor']],
];

export const fmtBoard = (metric: string, v: number) => {
  if (metric.endsWith('_imp') || metric === 'clutch') return signed(v, 1);
  if (metric.endsWith('_wpa')) return signed(v, 2);
  if (metric === 'full_straight' || metric === 'corridor') return d2(v);
  return plus(v);
};

const COMP_NAME: Record<string, string> = { ipl: 'IPL', bbl: 'BBL', psl: 'PSL', 't20-blast': 'T20 Blast', cpl: 'CPL', 'men-t20i': "Men's T20Is",
  sa20: 'SA20', 'hundred-men': 'The Hundred', wpl: 'WPL', wbbl: 'WBBL', 'women-t20i': "Women's T20Is", smat: 'SMAT', bpl: 'BPL',
  lpl: 'LPL', ilt20: 'ILT20', mlc: 'MLC', 'super-smash': 'Super Smash' };

export function BoardCard({ b }: { b: Board }) {
  const [top, setTop] = useState<'10' | '25'>('10');
  const [mult, setMult] = useState<'1' | '2' | '4'>('1');
  const [team, setTeam] = useState('all');
  const ballsKey = 'b';
  const teams = useMemo(() => [...new Set(b.rows.map((r) => r[3].t).filter(Boolean))].sort() as string[], [b]);
  const minB = b.min_balls * +mult;
  const rows = b.rows.filter((r) => (team === 'all' || r[3].t === team) && (!b.min_balls || (r[3][ballsKey] ?? 0) >= minB));
  const shown = rows.slice(0, +top);
  const max = Math.max(...shown.map((r) => Math.abs(r[2])), 1e-9);
  const inverse = b.metric === 'full_straight' || b.metric === 'corridor';
  return (
    <Panel flush title={b.title} sub={b.desc} eyebrow={`${b.scope_label} · ${b.window === '365' ? 'last 365 days' : 'all time'}`}
      tools={<>
        <Mini label="Show" value={top} onChange={setTop} options={[['10', 'Top 10'], ['25', 'Top 25']]} />
        {b.min_balls > 0 && <Mini label="Min balls" value={mult} onChange={setMult} options={[['1', n0(b.min_balls)], ['2', n0(b.min_balls * 2)], ['4', n0(b.min_balls * 4)]]} />}
        <MiniSelect label="Team" value={team} onChange={setTeam} options={[['all', 'All teams'], ...teams.map((t) => [t, t] as [string, string])]} />
      </>}>
      <div className="lb stagger" key={`${top}-${mult}-${team}`}>
        {shown.map((r, i) => (
          <Link className={`lb-row ${i === 0 ? 'first' : ''}`} key={r[0]} to={`/player/${r[0]}`}>
            <span className="lb-rank">{i + 1}</span>
            <span className="lb-name">{r[1]}</span>
            <span className="lb-val">{fmtBoard(b.metric, r[2])}</span>
            <span className="lb-meta">{r[3].t}{r[3].b ? ` · ${n0(r[3].b)} balls` : ''}</span>
            <span className="lb-bar" aria-hidden="true"><i className="sweep" style={{ width: `${Math.max(3, (Math.abs(r[2]) / max) * 100)}%`,
              background: inverse ? 'linear-gradient(90deg, var(--s2), var(--accent-2))' : undefined }} /></span>
          </Link>
        ))}
        {!shown.length && <div className="empty">Nobody qualifies with these filters.</div>}
      </div>
    </Panel>
  );
}

function Breakouts({ data, scopes }: { data: Home['breakouts']; scopes: [string, string, string][] }) {
  const [scope, setScope] = useState('t20-men');
  const [kind, setKind] = useState<'bat' | 'bowl'>('bat');
  const rows = data[scope]?.[kind] ?? [];
  const lo = Math.min(0, ...rows.flatMap((r) => [r[2], r[3]])), hi = Math.max(1, ...rows.flatMap((r) => [r[2], r[3]]));
  const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <Panel flush title="Breakout players" sub="Biggest rise in impact per 100 balls: the last 365 days compared with the two years before."
      tools={<>
        <Mini label="Role" value={kind} onChange={setKind} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />
        <MiniSelect label="Cricket" value={scope} onChange={setScope} options={scopes.map((s) => [s[0], s[1]])} />
      </>}>
      <div className="stagger" key={scope + kind}>
        {rows.slice(0, 10).map((r, i) => (
          <Link key={r[0]} to={`/player/${r[0]}`} className="bo-row">
            <span className="lb-rank">{i + 1}</span>
            <span className="lb-name">{r[1]}<div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{r[7]} · {n0(r[5])} balls this year</div></span>
            <span className="bo-track" title={`${signed(r[3], 1)} → ${signed(r[2], 1)} per 100 balls`}>
              <span style={{ left: pos(Math.min(r[2], r[3])), width: `calc(${pos(Math.max(r[2], r[3]))} - ${pos(Math.min(r[2], r[3]))})` }} />
              <i style={{ left: pos(r[3]), background: 'var(--text-2)' }} />
              <i style={{ left: pos(r[2]), background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
            </span>
            <span className="delta">{signed(r[4], 1)}</span>
          </Link>
        ))}
        {!rows.length && <div className="empty">No breakouts with enough balls in both periods.</div>}
      </div>
      <div className="muted" style={{ padding: '10px 22px 16px', fontSize: 12 }}>Grey tick = the two years before, cyan = last 365 days. Numbers are impact per 100 balls.</div>
    </Panel>
  );
}

export default function Home() {
  const { data, error } = useData<Home>('home.json');
  const meta = useData<any>('meta.json').data;
  const [scope, setScope] = useState('t20-men');
  const [win, setWin] = useState<'365' | 'all'>('365');
  const [group, setGroup] = useState('impact');
  const [leagues, setLeagues] = useState<string[]>(['ipl', 'bbl', 'psl', 't20-blast']);
  const [tm, setTm] = useState<'rpo' | 'six_pm' | 'four_pm' | 'dot_pct' | 'bpw'>('rpo');
  const [cf, setCf] = useState('T20');
  const [cg, setCg] = useState('all');
  const [cmin, setCmin] = useState<'40' | '100' | '250'>('40');

  const byKey = useMemo(() => new Map((data?.boards ?? []).map((b) => [b.key, b])), [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading insights" />;
  const get = (m: string, s: string, w: string) => byKey.get(`${m}:${s}:${w}`);

  const insights = [
    { b: get('bat_imp', 't20-men', '365'), say: (r: Row) => <>added <b className="mono">{signed(r[2], 0)}</b> runs above an average batter in the same situations in men's T20 over the last year. Nobody added more.</> },
    { b: get('bowl_imp', 'test-men', '365'), say: (r: Row) => <>saved <b className="mono">{signed(r[2], 0)}</b> runs against an average Test bowler in the last year, counting the run value of every wicket.</> },
    { b: get('clutch', 't20-men', '365'), say: (r: Row) => <>is the most clutch batter in men's T20: <b className="mono">{signed(r[2], 0)}</b> runs of impact on the balls where the result was most on the line.</> },
    { b: get('full_straight', 'test-men', 'all'), say: (r: Row) => <>is out bowled or LBW <b className="mono">{d2(r[2])}</b> times per 1,000 balls in Tests, the most of any batter with 2,000+ balls faced. Full and straight is the plan.</> },
  ].filter((x) => x.b && x.b.rows.length);

  const scopeOpts = data.scopes.map((s) => [s[0], s[1]] as [string, string]);
  const scopeFam = data.scopes.find((s) => s[0] === scope)?.[2];
  const groupBoards = (GROUPS.find((g) => g[0] === group)?.[2] ?? []).map((m) => get(m, scope, win)).filter(Boolean) as Board[];

  const years = [...new Set(data.trend.filter((t) => leagues.includes(t.comp)).map((t) => t.year))].sort();
  const series = leagues.map((c, i) => ({ name: COMP_NAME[c] ?? c, color: SERIES[i],
    values: years.map((y) => (data.trend.find((t) => t.comp === c && t.year === y) as any)?.[tm] ?? null) }));
  const allLeagues = [...new Set(data.trend.map((t) => t.comp))];
  const TM: Record<string, [string, (v: number) => string]> = {
    rpo: ['Runs per over', d1], six_pm: ['Sixes per match', d1], four_pm: ['Fours per match', d1], dot_pct: ['Dot-ball %', (v) => `${d1(v)}%`], bpw: ['Balls per wicket', d1] };
  const chase = data.chase.filter((c) => c.fam === cf && (cg === 'all' || c.gender === cg) && c.n >= +cmin);

  return (
    <>
      <section className="hero fade-in">
        <div>
          <div className="eyebrow">Ball-by-ball cricket intelligence</div>
          <h1 style={{ marginTop: 10 }}>Every ball, <span className="glow">in context.</span></h1>
          <p className="lede">Impact, win probability, matchups and inferred pitch-zone weaknesses for {meta ? n0(meta.comps.length) : '…'} competitions,
            adjusted for era, format, over and wickets in hand. Updated nightly from Cricsheet.</p>
        </div>
        {meta && (
          <div className="kpis stagger">
            <div className="kpi"><span className="v"><CountUp value={meta.counts.matches} format={n0} /></span><span className="l">Matches</span></div>
            <div className="kpi"><span className="v"><CountUp value={meta.counts.balls / 1e6} format={(v) => `${v.toFixed(1)}M`} /></span><span className="l">Balls</span></div>
            <div className="kpi"><span className="v"><CountUp value={meta.counts.players} format={n0} /></span><span className="l">Players</span></div>
          </div>
        )}
      </section>

      <div className="grid g3">
        {insights.map(({ b, say }) => {
          const r = b!.rows[0];
          return (
            <Panel key={b!.key} className="insight" eyebrow={`${b!.title} · ${b!.scope_label}`}>
              <Link to={`/player/${r[0]}`} className="who" style={{ color: 'var(--text)' }}>{r[1]}</Link>
              <p className="sub">{say(r)}</p>
              <div className="row muted" style={{ fontSize: 12 }}>
                Runner-up: {b!.rows[1] ? <Link to={`/player/${b!.rows[1][0]}`}>{b!.rows[1][1]}</Link> : '–'} ({b!.rows[1] ? fmtBoard(b!.metric, b!.rows[1][2]) : ''})
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Leaderboards" sub="Deep metrics, adjusted for situation and era. Each board has its own filters. Tap a name for the full profile."
        right={<Seg label="Time window" value={win} onChange={setWin} options={[['365', 'Last 365 days'], ['all', 'All time']]} />}>
        <Chips label="Competition" value={scope} onChange={setScope} options={scopeOpts} />
        <div className="tabs" role="tablist">
          {GROUPS.filter((g) => scopeFam !== 'MD' || (g[0] !== 'wp' && g[0] !== 'phase')).map((g) => (
            <button key={g[0]} role="tab" aria-selected={group === g[0]} onClick={() => setGroup(g[0])}>{g[1]}</button>
          ))}
        </div>
        <div className="grid g3">
          {groupBoards.map((b) => <BoardCard key={b.key} b={b} />)}
        </div>
        {group === 'zones' && <div className="notice info">Vulnerability boards are inferred from dismissal types (bowled, LBW, caught behind), not ball-tracking. See the methodology page.</div>}
        {!groupBoards.length && <div className="empty">No data for this window.</div>}
      </Panel>

      <div className="grid g2">
        <Breakouts data={data.breakouts} scopes={data.scopes} />
        <Panel title="Chasing advantage by league" sub="Share of decided matches won by the side batting second."
          tools={<>
            <Mini label="Format" value={cf} onChange={setCf} options={[['T20', 'T20'], ['ODI', 'One-day'], ['HUN', 'Hundred']]} />
            <Mini label="Gender" value={cg} onChange={setCg} options={[['all', 'All'], ['male', 'Men'], ['female', 'Women']]} />
            <Mini label="Min matches" value={cmin} onChange={setCmin} options={[['40', '40'], ['100', '100'], ['250', '250']]} />
          </>}>
          <HBars base={0.5} refLabel="even" fmt={(v) => `${(v * 100).toFixed(1)}%`} max={0.75}
            rows={chase.slice(0, 14).map((c) => ({ label: c.label, value: c.chase_win, note: `${n0(c.n)} matches` }))} />
          {!chase.length && <div className="empty">No league has that many decided matches.</div>}
        </Panel>
      </div>

      <Panel title="How the game is changing" sub="League trends by year. Pick a metric and up to four leagues."
        tools={<Mini label="Metric" value={tm} onChange={setTm} options={Object.entries(TM).map(([k, v]) => [k as typeof tm, v[0]])} />}>
        <div className="chips">{allLeagues.map((c) => (
          <button key={c} className="chip" aria-pressed={leagues.includes(c)}
            onClick={() => setLeagues(leagues.includes(c) ? leagues.filter((x) => x !== c) : leagues.length >= 4 ? [...leagues.slice(1), c] : [...leagues, c])}>
            {COMP_NAME[c] ?? c}</button>))}</div>
        <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
        <LineChart aria={`${TM[tm][0]} by year`} labels={years.map(String)} series={series} fmt={TM[tm][1]} height={260} />
      </Panel>
    </>
  );
}
