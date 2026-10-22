import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { Chips, ErrorBox, Legend, Loader, Panel, Seg, SERIES } from '../components/ui';
import { HBars, LineChart } from '../components/charts';
import { d1, d2, dateShort, n0, plus, signed } from '../lib/fmt';

type Board = { key: string; metric: string; title: string; desc: string; scope: string; scope_label: string; window: string;
  kind: 'bat' | 'bowl'; unit: string; min_balls: number; rows: [string, string, number, Record<string, number>][] };
type Home = { boards: Board[]; moments: any[]; trend: { comp: string; year: number; rpo: number; six_pm: number }[];
  chase: { comp: string; chase_win: number; n: number }[]; cut365: string; data_to: string; scopes: [string, string, string][] };

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

const COMP_NAME: Record<string, string> = { ipl: 'IPL', bbl: 'BBL', psl: 'PSL', 't20-blast': 'T20 Blast', cpl: 'CPL',
  'men-t20i': "Men's T20Is", sa20: 'SA20', 'hundred-men': 'The Hundred' };

export function BoardCard({ b, limit = 10 }: { b: Board; limit?: number }) {
  const vals = b.rows.map((r) => Math.abs(r[2]));
  const max = Math.max(...vals, 1e-9);
  const inverse = b.metric === 'full_straight' || b.metric === 'corridor';
  return (
    <Panel flush title={b.title} sub={b.desc} eyebrow={`${b.scope_label} · ${b.window === '365' ? 'last 365 days' : 'all time'}${b.min_balls ? ` · min ${b.min_balls} balls` : ''}`}>
      <div className="lb">
        {b.rows.slice(0, limit).map((r, i) => (
          <Link className={`lb-row ${i === 0 ? 'first' : ''}`} key={r[0]} to={`/player/${r[0]}`}>
            <span className="lb-rank">{String(i + 1).padStart(2, '0')}</span>
            <span className="lb-name">{r[1]}</span>
            <span className="lb-val">{fmtBoard(b.metric, r[2])}</span>
            <span className="lb-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (Math.abs(r[2]) / max) * 100)}%`,
              background: inverse ? 'linear-gradient(90deg, var(--s2), var(--accent-2))' : undefined }} /></span>
          </Link>
        ))}
        {!b.rows.length && <div className="empty">Nobody qualifies yet.</div>}
      </div>
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

  const byKey = useMemo(() => new Map((data?.boards ?? []).map((b) => [b.key, b])), [data]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading insights" />;
  const get = (m: string, s: string, w: string) => byKey.get(`${m}:${s}:${w}`);
  const top = (m: string, s: string, w = '365') => get(m, s, w)?.rows[0];

  const insights = [
    { b: get('bat_imp', 't20-men', '365'), say: (r: any) => <>added <b className="mono">{signed(r[2], 0)}</b> runs above an average batter in the same situations in men's T20 over the last year. Nobody added more.</> },
    { b: get('bowl_imp', 'test-men', '365'), say: (r: any) => <>saved <b className="mono">{signed(r[2], 0)}</b> runs against an average Test bowler in the last year, counting the run value of every wicket.</> },
    { b: get('clutch', 't20-men', '365'), say: (r: any) => <>is the most clutch batter in men's T20: <b className="mono">{signed(r[2], 0)}</b> runs of impact on the balls where the result was most on the line.</> },
    { b: get('full_straight', 'test-men', 'all'), say: (r: any) => <>is out bowled or LBW <b className="mono">{d2(r[2])}</b> times per 1,000 balls in Tests, the most of any batter with 2,000+ balls faced. Full and straight is the plan.</> },
  ].filter((x) => x.b && x.b.rows.length);

  const scopeOpts = data.scopes.map((s) => [s[0], s[1]] as [string, string]);
  const scopeFam = data.scopes.find((s) => s[0] === scope)?.[2];
  const groupBoards = (GROUPS.find((g) => g[0] === group)?.[2] ?? []).map((m) => get(m, scope, win)).filter(Boolean) as Board[];

  const years = [...new Set(data.trend.filter((t) => leagues.includes(t.comp)).map((t) => t.year))].sort();
  const series = leagues.map((c, i) => ({ name: COMP_NAME[c] ?? c, color: SERIES[i],
    values: years.map((y) => data.trend.find((t) => t.comp === c && t.year === y)?.rpo ?? null) }));
  const allLeagues = [...new Set(data.trend.map((t) => t.comp))];

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
          <div className="kpis">
            <div className="kpi"><span className="v">{n0(meta.counts.matches)}</span><span className="l">Matches</span></div>
            <div className="kpi"><span className="v">{(meta.counts.balls / 1e6).toFixed(1)}M</span><span className="l">Balls</span></div>
            <div className="kpi"><span className="v">{n0(meta.counts.players)}</span><span className="l">Players</span></div>
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

      <Panel title="Leaderboards" sub="Deep metrics, adjusted for situation and era. Tap a name for the full profile."
        right={<Seg label="Time window" value={win} onChange={setWin} options={[['365', 'Last 365 days'], ['all', 'All time']]} />}>
        <Chips label="Competition" value={scope} onChange={setScope} options={scopeOpts} />
        <div className="tabs" role="tablist">
          {GROUPS.filter((g) => scopeFam !== 'MD' || g[0] !== 'wp' && g[0] !== 'phase').map((g) => (
            <button key={g[0]} role="tab" aria-selected={group === g[0]} onClick={() => setGroup(g[0])}>{g[1]}</button>
          ))}
        </div>
        <div className="grid g3">
          {groupBoards.map((b) => <BoardCard key={b.key} b={b} />)}
        </div>
        {group === 'zones' && <div className="notice info">Vulnerability boards are inferred from dismissal types (bowled, LBW, caught behind), not ball-tracking. See the methodology page.</div>}
        {!top('bat_imp', scope, win) && <div className="empty">No data for this window.</div>}
      </Panel>

      <div className="grid g2">
        <Panel title="Biggest swings of the last year" sub="Single balls that moved win probability the most.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Ball</th><th scope="col">Match</th><th scope="col">Swing</th></tr></thead>
              <tbody>
                {data.moments.slice(0, 12).map((m) => (
                  <tr key={`${m.match_id}-${m.inn}-${m.over}-${m.legal_no}-${m.batter}`}>
                    <td className="txt">
                      <Link to={`/player/${m.batter}`}>{m.batter_name}</Link> <span className="muted">v</span> <Link to={`/player/${m.bowler}`}>{m.bowler_name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{m.wkt_kind ? `Wicket (${m.wkt_kind})` : `${m.r_tot} run${m.r_tot === 1 ? '' : 's'}`} · over {m.over + 1}, inns {m.inn}</div>
                    </td>
                    <td className="txt"><Link to={`/match/${m.match_id}`}>{m.bat_team} v {m.bowl_team}</Link><div className="muted" style={{ fontSize: 12 }}>{m.comp_label} · {dateShort(m.date)}</div></td>
                    <td className={m.dwp > 0 ? 'pos' : 'neg'}>{signed(m.dwp * 100, 0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Chasing advantage by league" sub="Share of decided limited-overs matches won by the chasing side. Line at 50%.">
          <HBars base={0.5} refLabel="even" fmt={(v) => `${(v * 100).toFixed(1)}%`} max={0.7}
            rows={data.chase.slice(0, 14).map((c) => ({ label: meta?.comps.find((x: any) => x.key === c.comp)?.label ?? c.comp, value: c.chase_win, note: `${n0(c.n)} matches` }))} />
        </Panel>
      </div>

      <Panel title="Scoring inflation" sub="Runs per over by year. Pick up to four leagues."
        right={<div className="chips">{allLeagues.map((c) => (
          <button key={c} className="chip" aria-pressed={leagues.includes(c)}
            onClick={() => setLeagues(leagues.includes(c) ? leagues.filter((x) => x !== c) : leagues.length >= 4 ? [...leagues.slice(1), c] : [...leagues, c])}>
            {COMP_NAME[c] ?? c}</button>))}</div>}>
        <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />
        <LineChart aria="Runs per over by year" labels={years.map(String)} series={series} fmt={d1} />
      </Panel>
    </>
  );
}
