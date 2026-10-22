import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { d1, d2, dateShort, n0, pct, signed } from '../lib/fmt';
import { PHASES, TIER } from '../lib/labels';
import { ErrorBox, Legend, Loader, Panel, SERIES, Tiles } from '../components/ui';
import { Columns, LineChart } from '../components/charts';
import { Table } from '../components/Table';

const LEADERS: [string, string, (v: any) => string][] = [
  ['bat_runs', 'Most runs', (v) => n0(v.r)], ['bat_imp', 'Batting impact', (v) => signed(v.imp, 0)],
  ['bat_wpa', 'Batting WPA', (v) => signed(v.wpa, 2)], ['bowl_wkts', 'Most wickets', (v) => n0(v.w)],
  ['bowl_imp', 'Bowling impact', (v) => signed(v.imp, 0)], ['bowl_wpa', 'Bowling WPA', (v) => signed(v.wpa, 2)],
];

export default function League() {
  const { key } = useParams();
  const { data: c, error } = useData<any>(`comps/${key}.json`);
  const [season, setSeason] = useState('all');
  const [tab, setTab] = useState<'overview' | 'records' | 'matches'>('overview');
  useEffect(() => { setSeason('all'); setTab('overview'); }, [key]);
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loader text="Loading league" />;
  const m = c.meta;
  const fam = m.fam;
  const limited = fam !== 'MD';
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
              <Panel title="Scoring rate by phase" sub="Runs per over each season.">
                <Legend items={ph.map((l, i) => ({ label: l, color: SERIES[i] }))} />
                <LineChart aria="Runs per over by phase and season" labels={seasons} fmt={d1}
                  series={[0, 1, 2].map((k) => ({ name: ph[k], color: SERIES[k], values: trends.map((t) => (t[`b${k}`] ? (6 * t[`r${k}`]) / t[`b${k}`] : null)) }))} />
              </Panel>
              <Panel title={limited ? 'Average first-innings total' : 'Average first-innings score'} sub="Each season.">
                <Columns aria="Average first innings score by season" fmt={n0} data={trends.map((t) => ({ label: String(t.season).slice(-5), title: String(t.season), value: t.avg1,
                  extra: [{ label: 'Matches', value: n0(t.m) }, { label: 'Sixes / match', value: d1(t.s6 / t.m) }] }))} />
              </Panel>
              {limited && (
                <Panel title="Chasing win %" sub="Share of decided matches won by the side batting second.">
                  <LineChart aria="Chasing win percentage" labels={seasons} refLine={50} yMin={0} yMax={100} fmt={(v) => `${Math.round(v)}%`}
                    series={[{ name: 'Chasing win %', color: 'var(--s2)', wash: true, values: trends.map((t) => (t.dec ? (100 * t.cw) / t.dec : null)) }]} />
                </Panel>
              )}
              <Panel title="Boundary rate" sub="Sixes per match each season.">
                <Columns aria="Sixes per match" fmt={d1} color="var(--s4)" data={trends.map((t) => ({ label: String(t.season).slice(-5), title: String(t.season), value: t.s6 / t.m,
                  extra: [{ label: 'Fours / match', value: d1(t.f4 / t.m) }] }))} />
              </Panel>
            </div>
          )}
          {season !== 'all' && stand.length > 0 && (
            <Panel title={`Table · ${season}`} sub={limited ? 'Net run rate counts an all-out innings as the full quota of overs.' : undefined} flush>
              <Table rows={stand} sort="w" cols={[
                { key: 't', label: 'Team', left: true, get: (x: any) => x[0] },
                { key: 'p', label: 'P', get: (x: any) => x[1] }, { key: 'w', label: 'W', get: (x: any) => x[2] },
                { key: 'l', label: 'L', get: (x: any) => x[3] }, { key: 'nr', label: 'Other', get: (x: any) => x[4] },
                ...(limited ? [{ key: 'nrr', label: 'NRR', get: (x: any) => x[5], fmt: (v: any) => signed(v, 3) }] : []),
              ]} />
            </Panel>
          )}
          <Panel title={`Leaders · ${season === 'all' ? 'all seasons' : season}`}>
            <div className="grid g3">
              {LEADERS.filter(([k]) => limited || !k.endsWith('wpa')).map(([k, label, f]) => (
                <div key={k} className="stack" style={{ gap: 0 }}>
                  <h3 style={{ marginBottom: 6 }}>{label}</h3>
                  {(lead[k] ?? []).map((x: any, i: number) => (
                    <Link key={x[0]} to={`/player/${x[0]}`} className="lb-row" style={{ padding: '7px 0' }}>
                      <span className="lb-rank">{i + 1}</span><span className="lb-name">{x[1]}</span><span className="lb-val">{f(x[2])}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Venues" sub="Grounds with three or more matches." flush>
            <Table rows={c.venues ?? []} sort="n" limit={15} cols={[
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
        <Panel title="Matches" flush>
          <Table rows={matches} limit={30} cols={[
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
  const r = c.records ?? {};
  const team = (x: any) => <Link to={`/match/${x.match_id}`}>{x.bat} v {x.bowl}</Link>;
  const ply = (x: any) => <Link to={`/player/${x.player}`}>{x.name}</Link>;
  return (
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
  );
}

