import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { useSettings } from '../lib/settings';
import { d1, d2, dateShort, n0, overs, pct } from '../lib/fmt';
import { famKeyLabel, MULTI, PHASES } from '../lib/labels';
import { GLOSSARY } from '../lib/geek';
import { ErrorBox, InfoTip, Loader, Panel, SectionHead, Seg } from '../components/ui';
import { Columns, HBars } from '../components/charts';
import { Table } from '../components/Table';
import { Board, SbCell } from '../components/Scoreboard';
import { useFullName } from '../lib/names';

// venues/{key}.json: info, recent matches, and per format-gender: sum (results, toss, first-innings scores),
// inns (by innings number), type (pace/spin wickets), phase (limited overs), days (estimated Test days),
// bat/bowl leaders, highest totals and best chases.
export default function Venue() {
  const fullName = useFullName();
  const { key } = useParams();
  const { data: v, error } = useData<any>(`venues/${key}.json`);
  const st = useSettings();
  usePageMeta(v ? `${v.name}${v.city ? `, ${v.city}` : ''}: ground records and pitch` : null);
  const fks = useMemo(() => (v ? Object.entries<any>(v.fmts).filter(([, f]) => f.sum).sort((a, b) => b[1].sum.n - a[1].sum.n).map(([k]) => k) : []), [v]);
  const [pick, setPick] = useState('');
  if (error) return <ErrorBox error={error === 'Not found' ? 'No ground with that name has five or more recorded matches.' : error} />;
  if (!v) return <Loader text="Loading ground" />;
  const want = `${st.fmt}-${st.gender}`;
  const fk = fks.includes(pick) ? pick : fks.includes(want) ? want : fks[0];
  const f = v.fmts[fk] ?? {};
  const s = f.sum ?? {};
  const fam = fk?.split('-')[0] ?? 'T20';
  const multi = MULTI(fam);
  const decided = (s.bf_w ?? 0) + (s.ch_w ?? 0);
  const types: any[] = (f.type ?? []).filter((t: any) => t[0] !== 'unknown');
  const tw = types.reduce((a, t) => a + t[1], 0);
  const days: any[] = f.days ?? [];
  const inns: any[] = f.inns ?? [];

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow"><Link to="/venues">Grounds</Link> · {v.host ?? 'Ground'}</div>
          <h1>{v.name}</h1>
          <p className="lede">{v.city ? `${v.city} · ` : ''}{n0(v.n)} recorded matches, {v.from?.slice(0, 4)}–{v.to?.slice(0, 4)}. How the pitch plays, what wins the toss, and who has done best here.</p>
        </div>
        {fks.length > 1 && <Seg label="Format" value={fk} onChange={setPick} options={fks.map((k) => [k, famKeyLabel(k)])} />}
      </section>

      <Board plate={`${v.name} · ${famKeyLabel(fk)}`}>
        <div className="sb-grid">
          <SbCell label="Matches" value={n0(s.n)} sub={`${dateShort(s.f)} – ${dateShort(s.l)}`} />
          <SbCell label="Avg 1st innings" value={d1(s.avg1)} sub={`par (median) ${n0(s.med1)}`} delay={140} />
          <SbCell label={multi ? 'Avg 2nd innings' : 'Avg 2nd innings'} value={d1(s.avg2)} delay={280} />
          <SbCell label="Batting first wins" value={decided ? pct(s.bf_w / decided, 0) : '–'} sub={`${s.bf_w ?? 0} of ${decided} decided`} delay={420} />
          {multi ? <SbCell label="Draws" value={s.n ? pct((s.d ?? 0) / s.n, 0) : '–'} sub={`${s.d ?? 0} drawn`} delay={560} />
            : <SbCell label="Chasing wins" value={decided ? pct(s.ch_w / decided, 0) : '–'} sub={`${s.ch_w ?? 0} of ${decided}`} delay={560} />}
          <SbCell label="Wickets to pace" value={tw ? pct((types.find((t) => t[0] === 'pace')?.[1] ?? 0) / tw, 0) : '–'} sub="of wickets with a known style" delay={700} />
        </div>
      </Board>

      <SectionHead title="Toss and conditions" sub="What captains choose here, whether it works, and how the pitch treats pace and spin." />
      <div className="grid g3">
        <Panel title="The toss" sub={`${s.toss_bat ?? 0} chose to bat, ${s.toss_field ?? 0} to field.`}
          foot={<>Toss winners won {s.n ? pct((s.toss_won ?? 0) / Math.max(1, decided + (s.t ?? 0)), 0) : '–'} of decided matches.</>}>
          <HBars fmt={(x) => pct(x, 0)} base={0.5} refLabel="a coin flip" max={1} rows={[
            { label: 'Chose to bat, then won', value: s.toss_bat ? s.toss_bat_won / s.toss_bat : null, note: `${s.toss_bat_won ?? 0} of ${s.toss_bat ?? 0}` },
            { label: 'Chose to field, then won', value: s.toss_field ? s.toss_field_won / s.toss_field : null, note: `${s.toss_field_won ?? 0} of ${s.toss_field ?? 0}` },
          ]} />
        </Panel>
        <Panel title="Pace v spin" sub="Wickets, economy and balls per wicket by bowling type.">
          {types.length ? <Table rows={types} cols={[
            { key: 't', label: 'Type', left: true, get: (t: any) => (t[0] === 'pace' ? 'Pace' : 'Spin') },
            { key: 'w', label: 'Wkts', get: (t: any) => t[1] },
            { key: 'sh', label: 'Share', get: (t: any) => t[1] / Math.max(tw, 1), fmt: (x) => pct(x, 0) },
            { key: 'e', label: 'Econ', get: (t: any) => (6 * t[3]) / Math.max(t[2], 1), fmt: d2 },
            { key: 'sr', label: 'Balls/wkt', get: (t: any) => t[2] / Math.max(t[1], 1), fmt: d1 },
          ]} /> : <div className="empty">Bowling styles not recorded.</div>}
        </Panel>
        {multi ? (
          <Panel title="By innings" sub="Average score and runs per wicket in each innings of the match.">
            <Columns aria="Average score by innings" fmt={n0} data={inns.map((x) => ({ label: ['1st', '2nd', '3rd', '4th'][x[0] - 1], title: `Innings ${x[0]}`, value: x[2],
              extra: [{ label: 'Innings', value: n0(x[1]) }, { label: 'Runs per wicket', value: d1(x[3]) }] }))} />
          </Panel>
        ) : (
          <Panel title="By phase" sub="Runs per over and wickets per match in each phase.">
            <Columns aria="Run rate by phase" fmt={d2} highlightMax={false} data={(f.phase ?? []).map((x: any) => ({ label: (PHASES[fam] ?? PHASES.T20)[x[0]].split(' (')[0], title: (PHASES[fam] ?? PHASES.T20)[x[0]], value: (6 * x[2]) / Math.max(x[3], 1),
              extra: [{ label: 'Wickets per match', value: d1(x[4] / Math.max(x[1], 1)) }, { label: 'Overs', value: overs(x[3]) }] }))} />
          </Panel>
        )}
      </div>

      {multi && days.length > 1 && (
        <Panel title={<>How the pitch changes, day by day <span className="est-badge">Estimated</span> <InfoTip text={GLOSSARY.sessions} /></>}
          sub="Runs per wicket and the share of wickets to pace on each day. Days are estimated at 90 overs each.">
          <div className="grid g2">
            <Columns aria="Runs per wicket by day" fmt={d1} highlightMax={false} data={days.map((d) => ({ label: `Day ${d[0]}`, title: `Day ${d[0]}`, value: d[1] / Math.max(d[3], 1),
              extra: [{ label: 'Run rate', value: d2((6 * d[1]) / Math.max(d[2], 1)) }, { label: 'Wickets', value: n0(d[3]) }] }))} />
            <Columns aria="Pace share of wickets by day" fmt={(x) => pct(x, 0)} highlightMax={false} color="var(--s2)" data={days.map((d) => ({ label: `Day ${d[0]}`, title: `Day ${d[0]}: wickets to pace`, value: d[5] ? d[4] / d[5] : null }))} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Left: runs per wicket (lower = harder to bat). Right: share of wickets taken by pace; a falling share usually means the pitch is turning.</div>
        </Panel>
      )}

      <SectionHead title="Who does well here" sub="Most runs and wickets at this ground in this format." />
      <div className="grid g2">
        <Panel flush title="Top batters">
          <Table rows={f.bat ?? []} sort="r" cols={[
            { key: 'n', label: 'Batter', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{fullName(x[0], v)}</Link> },
            { key: 'i', label: 'Inns', get: (x: any) => x[2] },
            { key: 'r', label: 'Runs', get: (x: any) => x[3], fmt: n0 },
            { key: 'a', label: 'Avg', get: (x: any) => (x[5] ? x[3] / x[5] : NaN), fmt: d1 },
            { key: 'sr', label: 'SR', get: (x: any) => (x[4] ? (100 * x[3]) / x[4] : NaN), fmt: d1 },
            { key: 'hs', label: 'HS', get: (x: any) => x[6] },
          ]} />
        </Panel>
        <Panel flush title="Top bowlers">
          <Table rows={f.bowl ?? []} sort="w" cols={[
            { key: 'n', label: 'Bowler', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{fullName(x[0], v)}</Link> },
            { key: 'i', label: 'Inns', get: (x: any) => x[2] },
            { key: 'w', label: 'Wkts', get: (x: any) => x[3] },
            { key: 'a', label: 'Avg', get: (x: any) => (x[3] ? x[5] / x[3] : NaN), fmt: d1 },
            { key: 'e', label: 'Econ', get: (x: any) => (x[4] ? (6 * x[5]) / x[4] : NaN), fmt: d2 },
          ]} />
        </Panel>
      </div>
      <div className="grid g2">
        <Panel flush title="Highest totals">
          <Table rows={f.high ?? []} sort="r" cols={[
            { key: 't', label: 'Team', left: true, get: (x: any) => x[2], fmt: (v, x: any) => <Link to={`/match/${x[0]}`}>{v}</Link> },
            { key: 'o', label: 'Against', left: true, get: (x: any) => x[3] },
            { key: 'r', label: 'Score', get: (x: any) => x[4], fmt: (_, x: any) => `${x[4]}${x[5] < 10 ? `/${x[5]}` : ''}` },
            { key: 'd', label: 'Date', get: (x: any) => x[7], fmt: (v) => dateShort(String(v)) },
          ]} />
        </Panel>
        <Panel flush title="Best chases" sub={multi ? 'Highest successful fourth-innings chases.' : 'Highest successful chases.'}>
          {(f.chase ?? []).length ? <Table rows={f.chase} sort="r" cols={[
            { key: 't', label: 'Team', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/match/${x[0]}`}>{v}</Link> },
            { key: 'o', label: 'Against', left: true, get: (x: any) => x[2] },
            { key: 'r', label: 'Score', get: (x: any) => x[3], fmt: (_, x: any) => `${x[3]}/${x[4]}` },
            { key: 'd', label: 'Date', get: (x: any) => x[5], fmt: (v) => dateShort(String(v)) },
          ]} /> : <div className="empty">No successful chases recorded.</div>}
        </Panel>
      </div>
      <Panel flush title="Recent matches here">
        <Table rows={v.recent ?? []} cols={[
          { key: 'd', label: 'Date', left: true, get: (x: any) => x[1], fmt: (v) => dateShort(String(v)) },
          { key: 'm', label: 'Match', left: true, get: (x: any) => `${x[4]} v ${x[5]}`, fmt: (val, x: any) => <Link to={`/match/${x[0]}`}>{val}</Link> },
          { key: 'f', label: 'Format', left: true, get: (x: any) => famKeyLabel(`${x[2]}-${x[3]}`) },
          { key: 'r', label: 'Result', left: true, get: (x: any) => (x[6] ? `${x[6]} won${x[8] ? ` by ${x[8]} runs` : x[9] ? ` by ${x[9]} wkts` : ''}` : x[7] === 'draw' ? 'Drawn' : x[7] === 'tie' ? 'Tied' : 'No result') },
        ]} />
      </Panel>
    </>
  );
}
