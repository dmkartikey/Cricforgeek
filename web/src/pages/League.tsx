import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { d1, d2, dateShort, n0, pct, signed } from '../lib/fmt';
import { MULTI, PHASES, TIER } from '../lib/labels';
import { ErrorBox, Legend, Loader, Mini, MiniSearch, MiniSelect, Panel, SERIES, Tiles } from '../components/ui';
import { Columns, LineChart } from '../components/charts';
import { Table } from '../components/Table';
import { useFullName } from '../lib/names';

const LEADERS: [string, string, (v: any) => string][] = [
  ['bat_runs', 'Most runs', (v) => n0(v.r)], ['bat_imp', 'Batting impact', (v) => signed(v.imp, 0)],
  ['bat_wpa', 'Batting WPA', (v) => signed(v.wpa, 2)], ['bowl_wkts', 'Most wickets', (v) => n0(v.w)],
  ['bowl_imp', 'Bowling impact', (v) => signed(v.imp, 0)], ['bowl_wpa', 'Bowling WPA', (v) => signed(v.wpa, 2)],
];

export default function League() {
  const fullName = useFullName();
  const { key } = useParams();
  const { data: c, error } = useData<any>(`comps/${key}.json`);
  usePageMeta(c ? `${c.meta.label} stats and records` : null);
  const [season, setSeason] = useState('all');
  const [tab, setTab] = useState<'overview' | 'records' | 'matches'>('overview');
  const [phm, setPhm] = useState<'rpo' | 'bpw'>('rpo');
  const [fim, setFim] = useState<'avg1' | 'dot' | 'bnd'>('avg1');
  const [smooth, setSmooth] = useState<'1' | '3'>('1');
  const [bm, setBm] = useState<'s6' | 'f4'>('s6');
  const [ltop, setLtop] = useState<'5' | '10'>('5');
  const [vmin, setVmin] = useState<'3' | '10' | '25'>('3');
  const [ssort, setSsort] = useState<'w' | 'nrr'>('w');
  const [mq, setMq] = useState('');
  useEffect(() => { setSeason('all'); setTab('overview'); }, [key]);
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loader text="Loading league" />;
  const m = c.meta;
  const fam = m.fam;
  const limited = !MULTI(fam);
  const trends: any[] = c.trends ?? [];
  const seasons = trends.map((t) => t.season);
  const last = trends[trends.length - 1] ?? {};
  const lead = c.leaders?.[season] ?? {};
  const stand = season !== 'all' ? (c.standings?.[season] ?? []) : [];
  const ph = PHASES[fam];
  const matches = (c.matches ?? []).filter((x: any) => season === 'all' || x[2] === season);
  return (
    <>
      <section className="player-head fade-in">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">{m.country} · {TIER[m.tier] ?? m.tier}{m.gender === 'female' ? ' · Women' : ''}</div>
          <h1>{m.label}</h1>
          <div className="row">
            <span className="tag accent">Ball by ball: {n0(m.ball_by_ball)} of {n0(m.matches)} matches</span>
            <span className="tag">{m.from.slice(0, 4)}–{m.to.slice(0, 4)}</span>
            <span className="tag">{m.seasons} seasons</span>
          </div>
        </div>
        <label className="field">Season
          <select className="input" value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="all">All seasons</option>
            {[...seasons].reverse().map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </section>
      <div className="tabs" role="tablist">
        {(['overview', 'records', 'matches'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'overview' && (
        <>
          <Tiles items={[
            { l: `Runs per over (${last.season ?? ''})`, v: d2((6 * last.r) / last.b) },
            { l: 'Sixes per match', v: d1(last.s6 / last.m) },
            { l: 'Avg 1st innings', v: n0(last.avg1) },
            ...(limited ? [{ l: 'Chasing win %', v: pct(last.cw / last.dec, 0) }] : []),
            { l: 'Dot ball %', v: pct(last.dots / last.faced, 1) },
            { l: 'Balls per wicket', v: d1(last.b / last.wk) },
          ]} />
          {trends.length > 1 && (
            <div className="grid g2">
              <Panel title="Phases of the innings" sub={phm === 'rpo' ? 'Runs per over each season.' : 'Balls per wicket each season.'}
                tools={<Mini label="Metric" value={phm} onChange={setPhm} options={[['rpo', 'Run rate'], ['bpw', 'Balls / wicket']]} />}>
                <Legend items={ph.map((l, i) => ({ label: l, color: SERIES[i] }))} />
                <LineChart key={phm} aria="Phase trends by season" labels={seasons} fmt={d1}
                  series={[0, 1, 2].map((k) => ({ name: ph[k], color: SERIES[k], values: trends.map((t) => (!t[`b${k}`] ? null : phm === 'rpo' ? (6 * t[`r${k}`]) / t[`b${k}`] : t[`w${k}`] ? t[`b${k}`] / t[`w${k}`] : null)) }))} />
              </Panel>
              <Panel title={fim === 'avg1' ? (limited ? 'Average first-innings total' : 'Average first-innings score') : fim === 'dot' ? 'Dot-ball %' : 'Boundary-ball %'} sub="Each season."
                tools={<Mini label="Metric" value={fim} onChange={setFim} options={[['avg1', '1st inns'], ['dot', 'Dot %'], ['bnd', 'Boundary %']]} />}>
                <Columns key={fim} aria="Season metric" fmt={fim === 'avg1' ? n0 : (v) => `${d1(v)}%`} data={trends.map((t) => ({ label: String(t.season).slice(-5), title: String(t.season),
                  value: fim === 'avg1' ? t.avg1 : fim === 'dot' ? (100 * t.dots) / t.faced : (100 * (t.bnd ?? 0)) / t.faced,
                  extra: [{ label: 'Matches', value: n0(t.m) }, { label: 'Sixes / match', value: d1(t.s6 / t.m) }] }))} />
              </Panel>
              {limited && (
                <Panel title="Chasing win %" sub="Share of decided matches won by the side batting second."
                  tools={<Mini label="Smoothing" value={smooth} onChange={setSmooth} options={[['1', 'Each season'], ['3', '3-season average']]} />}>
                  <LineChart key={smooth} aria="Chasing win percentage" labels={seasons} refLine={50} yMin={0} yMax={100} fmt={(v) => `${Math.round(v)}%`}
                    series={[{ name: 'Chasing win %', color: 'var(--s2)', wash: true, values: trends.map((_, i) => {
                      const w = trends.slice(Math.max(0, i - (+smooth - 1)), i + 1);
                      const dec = w.reduce((a, t) => a + (t.dec ?? 0), 0);
                      return dec ? (100 * w.reduce((a, t) => a + (t.cw ?? 0), 0)) / dec : null; }) }]} />
                </Panel>
              )}
              <Panel title="Boundaries" sub={`${bm === 's6' ? 'Sixes' : 'Fours'} per match each season.`}
                tools={<Mini label="Show" value={bm} onChange={setBm} options={[['s6', 'Sixes'], ['f4', 'Fours']]} />}>
                <Columns key={bm} aria="Boundaries per match" fmt={d1} color="var(--s4)" data={trends.map((t) => ({ label: String(t.season).slice(-5), title: String(t.season), value: t[bm] / t.m,
                  extra: [{ label: 'Fours / match', value: d1(t.f4 / t.m) }, { label: 'Sixes / match', value: d1(t.s6 / t.m) }] }))} />
              </Panel>
            </div>
          )}
          {season !== 'all' && stand.length > 0 && (
            <Panel title={`Table · ${season}`} sub={limited ? 'Net run rate counts an all-out innings as the full quota of overs.' : undefined} flush
              tools={limited ? <Mini label="Sort" value={ssort} onChange={setSsort} options={[['w', 'Wins'], ['nrr', 'Net run rate']]} /> : undefined}>
              <Table key={ssort} rows={stand} sort={ssort} cols={[
                { key: 't', label: 'Team', left: true, get: (x: any) => x[0] },
                { key: 'p', label: 'P', get: (x: any) => x[1] }, { key: 'w', label: 'W', get: (x: any) => x[2] },
                { key: 'l', label: 'L', get: (x: any) => x[3] }, { key: 'nr', label: 'Other', get: (x: any) => x[4] },
                ...(limited ? [{ key: 'nrr', label: 'NRR', get: (x: any) => x[5], fmt: (v: any) => signed(v, 3) }] : []),
              ]} />
            </Panel>
          )}
          <Panel title={`Leaders · ${season === 'all' ? 'all seasons' : season}`}
            tools={<>
              <Mini label="Show" value={ltop} onChange={setLtop} options={[['5', 'Top 5'], ['10', 'Top 10']]} />
              <MiniSelect label="Season" value={season} onChange={setSeason} options={[['all', 'All seasons'], ...[...seasons].reverse().map((x) => [String(x), String(x)] as [string, string])]} />
            </>}>
            <div className="grid g3">
              {LEADERS.filter(([k]) => limited || !k.endsWith('wpa')).map(([k, label, f]) => (
                <div key={k} className="stack" style={{ gap: 0 }}>
                  <h3 style={{ marginBottom: 6 }}>{label}</h3>
                  {(lead[k] ?? []).slice(0, +ltop).map((x: any, i: number) => (
                    <Link key={x[0]} to={`/player/${x[0]}`} className="lb-row" style={{ padding: '7px 0' }}>
                      <span className="lb-rank">{i + 1}</span><span className="lb-name">{fullName(x[0], x[1])}</span><span className="lb-val">{f(x[2])}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Venues" sub="Grounds and how they play." flush
            tools={<Mini label="Min matches" value={vmin} onChange={setVmin} options={[['3', '3'], ['10', '10'], ['25', '25']]} />}>
            <Table rows={(c.venues ?? []).filter((x: any) => x[2] >= +vmin)} sort="n" limit={15} cols={[
              { key: 'v', label: 'Venue', left: true, get: (x: any) => x[0], fmt: (v, x: any) => <>{v}<div className="muted" style={{ fontSize: 11 }}>{x[1]}</div></> },
              { key: 'n', label: 'Matches', get: (x: any) => x[2] },
              { key: 'a', label: 'Avg 1st inns', get: (x: any) => x[3], fmt: n0 },
              ...(limited ? [{ key: 'c', label: 'Chase win %', get: (x: any) => (x[5] ? x[4] / x[5] : NaN), fmt: (v: any) => pct(v, 0) }] : []),
              { key: 'p', label: 'Pace share of wkts', get: (x: any) => x[6], fmt: (v) => pct(v, 0), title: 'Share of bowler wickets taken by pace (where style is known)' },
            ]} />
          </Panel>
        </>
      )}
      {tab === 'records' && <Records c={c} />}
      {tab === 'matches' && (
        <Panel title="Matches" flush tools={<MiniSearch value={mq} onChange={setMq} placeholder="Filter by team or venue" />}>
          <Table rows={matches.filter((x: any) => !mq || `${x[3]} ${x[4]} ${x[9]}`.toLowerCase().includes(mq.toLowerCase()))} limit={30} cols={[
            { key: 'd', label: 'Date', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/match/${x[0]}`}>{dateShort(v)}</Link> },
            { key: 'teams', label: 'Teams', left: true, get: (x: any) => `${x[3]} v ${x[4]}` },
            { key: 'res', label: 'Result', left: true, get: (x: any) => (x[5] ? `${x[5]} won${x[7] ? ` by ${x[7]} runs` : x[8] ? ` by ${x[8]} wkts` : ''}` : x[6]) },
            { key: 'v', label: 'Venue', left: true, get: (x: any) => x[9] },
          ]} />
        </Panel>
      )}
    </>
  );
}

function Records({ c }: { c: any }) {
  const fullName = useFullName();
  const [rs, setRs] = useState('all');
  const seasons = (c.trends ?? []).map((t: any) => String(t.season));
  const keep = (x: any) => rs === 'all' || seasons.slice(-(+rs)).includes(String(x.season));
  const r0 = c.records ?? {};
  const r = Object.fromEntries(Object.entries<any[]>(r0).map(([k, v]) => [k, v.filter(keep)]));
  const team = (x: any) => <Link to={`/match/${x.match_id}`}>{x.bat} v {x.bowl}</Link>;
  const ply = (x: any) => <Link to={`/player/${x.player}`}>{fullName(x.player, x.name)}</Link>;
  return (
    <div className="stack" style={{ gap: 22 }}>
    <div className="mini-bar"><Mini label="Seasons" value={rs} onChange={setRs} options={[['all', 'All time'], ['5', 'Last 5'], ['3', 'Last 3'], ['1', 'Latest']]} />
      <span className="muted" style={{ fontSize: 12 }}>Records lists hold each competition's top 10, so short windows may show fewer rows.</span></div>
    <div className="grid g2">
      <Panel title="Highest totals" flush><Table rows={r.high_totals ?? []} cols={[
        { key: 't', label: 'Match', left: true, get: (x: any) => x.bat, fmt: (_, x) => team(x) },
        { key: 's', label: 'Score', get: (x: any) => x.runs, fmt: (v, x: any) => `${v}/${x.wkts}` }, { key: 'y', label: 'Season', get: (x: any) => x.season }]} /></Panel>
      <Panel title="Lowest all-out totals" flush><Table rows={r.low_totals ?? []} cols={[
        { key: 't', label: 'Match', left: true, get: (x: any) => x.bat, fmt: (_, x) => team(x) },
        { key: 's', label: 'Score', get: (x: any) => x.runs }, { key: 'y', label: 'Season', get: (x: any) => x.season }]} /></Panel>
      <Panel title="Highest individual scores" flush><Table rows={r.high_scores ?? []} cols={[
        { key: 'p', label: 'Batter', left: true, get: (x: any) => x.name, fmt: (_, x) => ply(x) },
        { key: 'r', label: 'Runs', get: (x: any) => x.runs, fmt: (v, x: any) => `${v}${x.is_out ? '' : '*'}` }, { key: 'b', label: 'Balls', get: (x: any) => x.balls },
        { key: 'o', label: 'Opponent', left: true, get: (x: any) => x.opp, fmt: (v, x: any) => <Link to={`/match/${x.match_id}`}>{v}</Link> }]} /></Panel>
      <Panel title="Best bowling" flush><Table rows={r.best_bowling ?? []} cols={[
        { key: 'p', label: 'Bowler', left: true, get: (x: any) => x.name, fmt: (_, x) => ply(x) },
        { key: 'f', label: 'Figures', get: (x: any) => x.wkts, fmt: (v, x: any) => `${v}/${x.runs}` },
        { key: 'o', label: 'Opponent', left: true, get: (x: any) => x.opp, fmt: (v, x: any) => <Link to={`/match/${x.match_id}`}>{v}</Link> }]} /></Panel>
      <Panel title="Highest-impact innings" sub="Runs added above an average batter, counting the cost of getting out." flush className="span-all"><Table rows={r.top_impact_inns ?? []} cols={[
        { key: 'p', label: 'Batter', left: true, get: (x: any) => x.name, fmt: (_, x) => ply(x) },
        { key: 'r', label: 'Runs', get: (x: any) => x.runs }, { key: 'b', label: 'Balls', get: (x: any) => x.balls },
        { key: 'i', label: 'Impact', get: (x: any) => x.imp, fmt: (v) => signed(v, 1) },
        { key: 'o', label: 'Opponent', left: true, get: (x: any) => x.opp, fmt: (v, x: any) => <Link to={`/match/${x.match_id}`}>{v}</Link> },
        { key: 'y', label: 'Season', get: (x: any) => x.season }]} /></Panel>
    </div>
    </div>
  );
}

