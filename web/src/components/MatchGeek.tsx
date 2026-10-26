// Match page panels for the geek features: the turning point, partnerships along the innings with the pressure
// before each wicket, estimated Test sessions, and the chase against a DLS-style par score.
import { Link } from 'react-router-dom';
import { d1, n0, overs, signed } from '../lib/fmt';
import { useData } from '../lib/data';
import { GLOSSARY, parScore } from '../lib/geek';
import { InfoTip, Legend, Panel } from './ui';
import { LineChart } from './charts';

type Nm = (p: string) => string;

/** The biggest single-ball swing, plus the winner's lowest point in the match. */
export function TurningCallout({ m, team, nm }: { m: any; team: (k: number) => string; nm: Nm }) {
  const i = m.info, bpo = i.balls_per_over ?? 6;
  const mo: any[] = m.moments ?? [];
  if (!mo.length) return null;
  const top = [...mo].sort((a, b) => Math.abs(b[8]) - Math.abs(a[8]))[0];
  const ovs: any[] = (m.overs ?? []).filter((o: any) => o[0] <= 2 && o[5] != null);
  let low: { v: number; inn: number; over: number } | null = null;
  if (i.winner) for (const o of ovs) {
    const v = team(o[0]) === i.winner ? o[5] : 1 - o[5];
    if (!low || v < low.v) low = { v, inn: o[0], over: o[1] };
  }
  const batSide = team(top[0]);
  const ball = `${top[1]}.${((top[2] - 1) % bpo) + 1}`;
  const what = top[6] === 'run out' ? `${nm(top[7] || top[3])} run out` : top[6] ? `${nm(top[4])} had ${nm(top[3])} ${top[6]}` : `${nm(top[3])} took ${top[5]} off ${nm(top[4])}`;
  const pct = (v: number) => (v < 0.01 ? 'under 1%' : `${Math.round(v * 100)}%`);
  return (
    <div className={`turning fade-in${low && low.v < 0.35 ? '' : ' single'}`}>
      <div className="tp-main">
        <span className="eyebrow">The turning point</span>
        <b>{what}</b>
        <span>{batSide} · over {ball} · win chance {pct(top[9])} → {pct(Math.min(1, Math.max(0, top[9] + top[8])))} for {batSide} <span className={top[8] > 0 ? 'pos' : 'neg'}>({signed(top[8] * 100, 0)} pts)</span></span>
      </div>
      {low && low.v < 0.35 && (
        <div className="tp-low">
          <span className="eyebrow">{low.v < 0.15 ? 'Great escape' : 'Low point'}</span>
          <b>{i.winner} were down to {pct(low.v)}</b>
          <span>after over {low.over + 1} of the {low.inn === 1 ? 'first' : 'second'} innings, and still won.</span>
        </div>
      )}
    </div>
  );
}

/** Partnerships laid along the innings: width = balls, height = runs. Wicket marks show the pressure before them. */
export function PartnershipTrack({ ps, fow, nm, bpo }: { ps: any[]; fow: any[]; nm: Nm; bpo: number }) {
  const total = ps.reduce((a, p) => a + (p[3] || 0), 0);
  if (!total || ps.length < 2) return null;
  const max = Math.max(...ps.map((p) => p[2]), 1);
  const pressured = fow.filter((f) => f[5] != null);
  return (
    <div className="ptrack">
      <div className="pt-bars" role="img" aria-label="Partnerships along the innings: width is balls faced, height is runs">
        {ps.map((p, n) => (
          <div key={p[1]} className={`pt-col${fow.some((q) => q[1] === p[1]) ? ' out' : ''}`} style={{ width: `${(p[3] / total) * 100}%` }}
            title={`${p[1]}${['st', 'nd', 'rd'][p[1] - 1] ?? 'th'} wicket: ${p[2]} off ${p[3]} balls (${p[4] ? nm(p[4]) : ''}${p[7] ? ` & ${nm(p[7])}` : ''})`}>
            {p[3] / total > 0.06 && <span className="pt-lab" style={{ bottom: `calc(${Math.max(3, (p[2] / max) * 100)}% + 2px)` }}>{p[2]}</span>}
            <i className="grow-bar" style={{ height: `${Math.max(3, (p[2] / max) * 100)}%`, background: n % 2 ? 'var(--s2)' : 'var(--s1)' }} />
          </div>
        ))}
      </div>
      <div className="pt-axis"><span>Start</span><span>Width = balls, height = runs · dashed line = wicket</span><span>{overs(total, bpo)} overs</span></div>
      {pressured.length > 0 && (
        <div className="pressure">
          <div className="pr-head">Pressure before each wicket <InfoTip text={GLOSSARY.pressure} /></div>
          <div className="pr-list">
            {pressured.map((f) => (
              <div key={f[1]} className="pr-item" title={`${f[5]} dots in the previous 12 balls; ${f[6]} balls since the last boundary`}>
                <span className="pr-w">{f[1]}-{f[2]}</span>
                <span className="pr-n">{f[4] ? nm(f[4]) : ''}</span>
                <span className="pr-dots" aria-label={`${f[5]} dots in 12`}>{Array.from({ length: 12 }, (_, k) => <i key={k} className={k < f[5] ? 'on' : ''} />)}</span>
                <span className="pr-s mono">{f[6]}<small> since 4/6</small></span>
              </div>
            ))}
          </div>
          {(() => {
            const avg = pressured.reduce((a, f) => a + f[5], 0) / pressured.length;
            const hi = pressured.filter((f) => f[5] >= 8).length;
            return <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Average {d1(avg)} dots in the 12 balls before a wicket{hi ? `; ${hi} wicket${hi > 1 ? 's' : ''} came after 8 or more` : ''}.</div>;
          })()}
        </div>
      )}
    </div>
  );
}

/** Test sessions estimated at 30 overs each: who batted, the score, and who came out on top. */
export function Sessions({ m }: { m: any }) {
  const rows: any[] = m.sessions ?? [];
  if (!rows.length) return null;
  const i = m.info;
  const other = (t: string) => (t === i.team1 ? i.team2 : i.team1);
  const cells = new Map<string, any[]>();
  for (const r of rows) { const k = `${r[0]}-${r[1]}`; cells.set(k, [...(cells.get(k) ?? []), r]); }
  const days = [...new Set(rows.map((r) => r[0]))].sort((a, b) => a - b);
  const verdict = (rs: any[]) => {
    // runs minus 30 per wicket for each batting side: a rough "who won the session"
    const net = new Map<string, number>();
    for (const r of rs) {
      net.set(r[2], (net.get(r[2]) ?? 0) + r[3] - 30 * r[4]);
      net.set(other(r[2]), (net.get(other(r[2])) ?? 0) - (r[3] - 30 * r[4]));
    }
    const [best, v] = [...net.entries()].sort((a, b) => b[1] - a[1])[0];
    return v > 20 ? best : null;
  };
  const tally = new Map<string, number>();
  for (const rs of cells.values()) { const v = verdict(rs); tally.set(v ?? 'Even', (tally.get(v ?? 'Even') ?? 0) + 1); }
  return (
    <Panel title={<>Session by session <span className="est-badge">Estimated</span> <InfoTip text={GLOSSARY.sessions} /></>}
      sub={`Who won each session: ${[...tally.entries()].map(([k, n]) => `${k} ${n}`).join(' · ')}. A session goes to the side ahead by more than 20 runs, counting each wicket as 30 runs.`} flush>
      <div className="tbl-wrap">
        <table className="tbl sessions">
          <thead><tr><th scope="col">Day</th><th scope="col">Morning</th><th scope="col">Afternoon</th><th scope="col">Evening</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td><b>{d}</b></td>
                {[1, 2, 3].map((sN) => {
                  const rs = cells.get(`${d}-${sN}`);
                  if (!rs) return <td key={sN} className="muted">–</td>;
                  const v = verdict(rs);
                  return (
                    <td key={sN} className={v ? (v === i.team1 ? 'ses a' : 'ses b') : 'ses'}>
                      {rs.map((r) => <div key={r[2] + r[6]}><span className="muted">{r[2]}</span> <b className="mono">{r[3]}/{r[4]}</b> <small className="muted">({overs(r[5])} ov)</small></div>)}
                      <span className="ses-v">{v ?? 'Even'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** The chase against a DLS-style par score, over by over. */
export function ParChase({ m, team }: { m: any; team: (k: number) => string }) {
  const i = m.info;
  const key = `${i.fmt}-${i.gender}`;
  const { data: par } = useData<any>(i.fmt === 'ODI' || i.fmt === 'T20' ? 'par.json' : null);
  const tab = par?.[key];
  const ovs2: any[] = (m.overs ?? []).filter((o: any) => o[0] === 2);
  const first = m.extras?.['1']?.[4];
  const quota = tab ? Math.min(tab.overs, i.overs || tab.overs) : 0;
  if (!tab || i.method || !ovs2.length || first == null || (i.balls_per_over ?? 6) !== 6) return null;
  let wk = 0;
  const pts = ovs2.map((o) => { wk += o[3]; return { over: o[1] + 1, score: o[4], wk, par: parScore(tab.re, quota, first, o[1] + 1, Math.min(wk, 10)) }; });
  const diff = pts.map((p) => p.score - p.par);
  const best = Math.max(...diff), worst = Math.min(...diff);
  const end = pts[pts.length - 1];
  const chaser = team(2);
  return (
    <Panel title={<>Chase v par <InfoTip text={GLOSSARY.par} /></>}
      sub={`${chaser}'s score against the par score for the overs and wickets used, chasing ${first + 1}. Above the par line = ahead if play had stopped.`}
      foot={<>Most ahead: {signed(best, 0)} runs · most behind: {signed(worst, 0)} runs · after over {end.over}: {end.score}/{end.wk} against a par of {n0(end.par)}.</>}>
      <Legend items={[{ label: `${chaser} score`, color: 'var(--s1)' }, { label: 'Par', color: 'var(--muted)', kind: 'dash' }]} />
      <LineChart aria="Chase against par" labels={pts.map((p) => String(p.over))} fmt={n0}
        series={[{ name: `${chaser} score`, color: 'var(--s1)', values: pts.map((p) => p.score) }, { name: 'Par', color: 'var(--muted)', dashed: true, values: pts.map((p) => Math.round(p.par)) }]} />
    </Panel>
  );
}

export const VenueLink = ({ m }: { m: any }) => (m.vkey ? <Link className="link" to={`/venue/${m.vkey}`}>{m.info.venue}</Link> : <>{m.info.venue}</>);
