import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePageMeta } from '../lib/meta';

import { d1, d2, dateShort, n0, overs, signed } from '../lib/fmt';
import { FAM_LABEL, MULTI } from '../lib/labels';
import { ErrorBox, Legend, Loader, Mini, Panel, SectionHead, SERIES } from '../components/ui';
import { Columns, LineChart } from '../components/charts';
import { Table } from '../components/Table';
import { Board, Flap } from '../components/Scoreboard';
import { ParChase, PartnershipTrack, Sessions, TurningCallout, VenueLink } from '../components/MatchGeek';
import { useFullName } from '../lib/names';

// bat:  [inn, player, runs, balls, 4s, 6s, kind, bowler, impact, wpa, team, fielder, pos]
// bowl: [inn, player, balls, runs, wkts, dots, wides, noballs, impact, wpa, maidens]
type Bat = [number, string, number, number, number, number, string | null, string | null, number, number, string, string | null, number];
type Bowl = [number, string, number, number, number, number, number, number, number, number, number];

const teamKey = (team: string, gender: string) => team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + (gender === 'female' ? '-women' : '');

function howOut(b: Bat, nm: (p: string) => string) {
  const [kind, bowler, fielder] = [b[6], b[7] ? nm(b[7]) : '', b[11] ? nm(b[11]) : ''];
  if (!kind) return 'not out';
  switch (kind) {
    case 'bowled': return `b ${bowler}`;
    case 'lbw': return `lbw b ${bowler}`;
    case 'caught': return !fielder ? `caught b ${bowler}` : fielder !== bowler ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
    case 'caught and bowled': return `c & b ${bowler}`;
    case 'stumped': return `st ${fielder || '?'} b ${bowler}`;
    case 'run out': return fielder ? `run out (${fielder})` : 'run out';
    case 'hit wicket': return `hit wicket b ${bowler}`;
    default: return kind;
  }
}

export default function Match() {
  const fullName = useFullName();
  const { id } = useParams();
  const { data: m, error } = useData<any>(`matches/${id}.json`);
  const [inn, setInn] = useState(1);
  usePageMeta(m ? `${m.info.team1} v ${m.info.team2}, ${m.comp_label ?? ''} ${m.info.season ?? ''}`.trim() : null);
  const [wm, setWm] = useState<'cum' | 'rr'>('cum');
  const [wpSide, setWpSide] = useState<'1' | '2'>('1');
  const [tpType, setTpType] = useState<'all' | 'w' | 'r'>('all');
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loader text="Loading match" />;

  const i = m.info, nm = (p: string) => fullName(p, m.names[p] ?? p.replace(/^~/, ''));
  const bpo = i.balls_per_over ?? 6;
  const ovs: any[] = m.overs;
  const bats: Bat[] = m.bat, bowls: Bowl[] = m.bowl;
  const innings = [...new Set([...ovs.map((o) => o[0]), ...Object.keys(m.extras ?? {}).map(Number)])].sort((a, b) => a - b) as number[];
  const team = (k: number) => bats.find((b) => b[0] === k)?.[10] ?? (k % 2 ? i.team1 : i.team2);
  const colorOf = (t: string) => (t === i.team1 ? SERIES[0] : SERIES[1]);
  const ex = (k: number): number[] => m.extras?.[String(k)] ?? [0, 0, 0, 0, 0, 0, 0];
  const multi = MULTI(i.fmt ?? i.family);
  const result = i.winner ? `${i.winner} won${i.by_runs ? ` by ${i.by_runs} run${i.by_runs === 1 ? '' : 's'}` : i.by_wkts ? ` by ${i.by_wkts} wicket${i.by_wkts === 1 ? '' : 's'}` : ''}${i.method ? ` (${i.method})` : ''}`
    : i.result === 'draw' ? 'Match drawn' : i.result === 'tie' ? 'Match tied' : 'No result';
  const sel = innings.includes(inn) ? inn : innings[0];
  const bat = bats.filter((b) => b[0] === sel).sort((a, b) => a[12] - b[12]);
  const bowl = bowls.filter((b) => b[0] === sel);
  const e = ex(sel);
  const dnb: string[] = (m.dnb ?? []).find((d: any) => d[0] === sel)?.[1] ?? [];
  const fow = (m.fow ?? []).filter((f: any) => f[0] === sel);
  const ps = (m.partnerships ?? []).filter((p: any) => p[0] === sel);
  const psMax = Math.max(...ps.map((p: any) => p[2]), 1);
  const topR = Math.max(...bat.map((b) => b[2]), 0);
  const topW = Math.max(...bowl.map((b) => b[4]), 0);
  const maxOv = Math.max(...innings.map((k) => ovs.filter((o) => o[0] === k).length), 0);

  // win probability from the first-innings batting side's view, over by over across both innings
  const wpSeries: (number | null)[] = [], wpLabels: string[] = [];
  if (!multi) for (const o of ovs.filter((x) => x[0] <= 2)) {
    if (o[5] == null) continue;
    wpSeries.push(100 * (o[0] === 1 ? o[5] : 1 - o[5]));
    wpLabels.push(`Inns ${o[0]} · over ${o[1] + 1}`);
  }
  const moments = (m.moments ?? []).filter((x: any) => tpType === 'all' || (tpType === 'w' ? !!x[6] : !x[6]));
  const ballLabel = (o: number, legal: number) => `${o}.${((legal - 1) % bpo) + 1}`;

  return (
    <>
      <section className="match-head fade-in">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow"><Link to={`/league/${i.comp}`}>{m.comp_label}</Link> · {FAM_LABEL[i.fmt] ?? i.family} · {i.season} · {dateShort(i.date)}</div>
          <h1>
            <Link to={`/team/${i.team1_key ?? teamKey(i.team1, i.gender)}`}>{i.team1}</Link> <span className="muted" style={{ fontWeight: 400 }}>v</span>{' '}
            <Link to={`/team/${i.team2_key ?? teamKey(i.team2, i.gender)}`}>{i.team2}</Link>
          </h1>
          <div className="sub">{i.event ? `${i.event} · ` : ''}<VenueLink m={m} />{i.city ? `, ${i.city}` : ''} · Toss: {i.toss_winner}, chose to {i.toss_decision}</div>
        </div>
      </section>

      <Board plate={`${m.comp_label ?? 'Scoreboard'} · ${i.venue ?? ''}`.slice(0, 70)}
        foot={<><span>{result.toUpperCase()}</span>{i.pom && <span>Player of the match: <Link to={`/player/${i.pom}`}>{nm(i.pom)}</Link></span>}</>}>
        <div className="sb-score">
          <span className="hd">Batting</span><span className="hd">Total</span><span className="hd">Wkts</span><span className="hd">Overs</span><span className="hd rr">Run rate</span>
          {innings.map((k, n) => {
            const x = ex(k), t = team(k);
            const won = i.winner === t && k === innings.filter((q) => team(q) === t).slice(-1)[0];
            const d = n * 600;
            return [
              <span key={k + 't'} className="tm"><span>{t}</span>{innings.length > 2 && <small>{Math.ceil(k / 2) === 1 ? '1st' : '2nd'}</small>}{won && <i className="won">WON</i>}</span>,
              <span key={k + 'r'} className="cv main"><Flap text={String(x[4])} delay={d} /></span>,
              <span key={k + 'w'} className="cv"><Flap text={String(x[6])} delay={d + 250} /></span>,
              <span key={k + 'o'} className="cv"><Flap text={overs(x[5], bpo)} delay={d + 380} /></span>,
              <span key={k + 'rr'} className="cv rr"><Flap text={x[5] ? d2((x[4] * bpo) / x[5]) : '0.00'} delay={d + 500} /></span>,
            ];
          })}
        </div>
      </Board>

      <TurningCallout m={m} team={team} nm={nm} />

      <div>
        <div className="inn-tabs" role="tablist" aria-label="Innings">
          {innings.map((k) => {
            const x = ex(k);
            return (
              <button key={k} role="tab" aria-selected={k === sel} onClick={() => setInn(k)}>
                <small>{multi ? `Innings ${k}` : k === 1 ? 'First innings' : k === 2 ? 'Second innings' : `Super over ${k - 2}`}</small>
                <span style={{ fontWeight: 600 }}>{team(k)}</span>
                <b>{x[4]}/{x[6]}</b>
              </button>
            );
          })}
        </div>
        <div className="card fade-in" key={sel}>
          <div className="card-sec sc-scroll">
            <h3>Batting</h3>
            <table className="sc">
              <thead><tr>
                <th scope="col">Batter</th><th scope="col" className="left hide-sm">Dismissal</th><th scope="col">R</th><th scope="col">B</th>
                <th scope="col">4s</th><th scope="col">6s</th><th scope="col">SR</th><th scope="col" className="hide-sm" title="Runs added above an average batter in the same situations">Impact</th>
                {!multi && <th scope="col" className="hide-sm" title="Win probability added">WPA</th>}
              </tr></thead>
              <tbody>
                {bat.map((b) => (
                  <tr key={b[1]} className={`${b[6] ? '' : 'notout'} ${b[2] === topR && topR > 0 ? 'hi' : ''}`}>
                    <td className="name"><Link to={`/player/${b[1]}`}>{nm(b[1])}</Link><span className="how-m">{howOut(b, nm)}</span></td>
                    <td className="how">{howOut(b, nm)}</td>
                    <td className="b-r">{b[2]}</td><td>{b[3]}</td><td>{b[4]}</td><td>{b[5]}</td>
                    <td>{b[3] ? d1((100 * b[2]) / b[3]) : '–'}</td>
                    <td className={`hide-sm ${b[8] > 0 ? 'pos' : b[8] < 0 ? 'neg' : ''}`}>{signed(b[8], 1)}</td>
                    {!multi && <td className="hide-sm">{signed(b[9] * 100, 1)}%</td>}
                  </tr>
                ))}
                <tr className="sum">
                  <td>Extras</td><td className="how keep">{`wd ${e[0]}, nb ${e[1]}, b ${e[2]}, lb ${e[3]}${e[7] ? `, pen ${e[7]}` : ''}`}</td>
                  <td className="b-r"><b>{e[0] + e[1] + e[2] + e[3] + (e[7] ?? 0)}</b></td><td colSpan={multi ? 5 : 6} />
                </tr>
                <tr className="total">
                  <td>Total</td><td className="how keep" style={{ color: 'var(--text-2)' }}>{e[6] >= 10 ? 'all out' : `${e[6]} wickets`} · {overs(e[5], bpo)} overs · RR {e[5] ? d2((e[4] * bpo) / e[5]) : '–'}</td>
                  <td className="b-r"><span className="big">{e[4]}{e[6] < 10 ? `/${e[6]}` : ''}</span></td><td colSpan={multi ? 5 : 6} />
                </tr>
              </tbody>
            </table>
            {dnb.length > 0 && <div className="dnb"><b>Did not bat</b>{dnb.map((p, n) => <span key={p}>{n ? ', ' : ''}<Link className="link" to={`/player/${p}`}>{nm(p)}</Link></span>)}</div>}
          </div>

          {fow.length > 0 && (
            <div className="card-sec">
              <h3>Fall of wickets</h3>
              <div className="fow">
                {fow.map((f: any) => <span key={f[1]}><b>{f[1]}-{f[2]}</b>{f[4] ? nm(f[4]) : ''}, {overs(f[3], bpo)} ov</span>)}
              </div>
            </div>
          )}

          <div className="card-sec sc-scroll">
            <h3>Bowling</h3>
            <table className="sc">
              <thead><tr>
                <th scope="col">Bowler</th><th scope="col">O</th><th scope="col">M</th><th scope="col">R</th><th scope="col">W</th><th scope="col">Econ</th>
                <th scope="col" className="hide-sm">0s</th><th scope="col" className="hide-sm">Wd</th><th scope="col" className="hide-sm">Nb</th>
                <th scope="col" className="hide-sm" title="Runs saved against an average bowler, counting wicket value">Impact</th>
                {!multi && <th scope="col" className="hide-sm">WPA</th>}
              </tr></thead>
              <tbody>
                {bowl.map((b) => (
                  <tr key={b[1]} className={b[4] === topW && topW > 0 ? 'hi' : ''}>
                    <td className="name"><Link to={`/player/${b[1]}`}>{nm(b[1])}</Link></td>
                    <td>{overs(b[2], bpo)}</td><td>{b[10] ?? 0}</td><td>{b[3]}</td><td className="b-r">{b[4]}</td>
                    <td>{b[2] ? d2((b[3] * bpo) / b[2]) : '–'}</td>
                    <td className="hide-sm">{b[5]}</td><td className="hide-sm">{b[6]}</td><td className="hide-sm">{b[7]}</td>
                    <td className={`hide-sm ${b[8] > 0 ? 'pos' : b[8] < 0 ? 'neg' : ''}`}>{signed(b[8], 1)}</td>
                    {!multi && <td className="hide-sm">{signed(b[9] * 100, 1)}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ps.length > 0 && (
            <div className="card-sec">
              <h3>Partnerships</h3>
              <div style={{ paddingBottom: 10 }}>
                {ps.map((p: any) => {
                  const [r1, r2] = [p[5] ?? 0, p[8] ?? 0];
                  const w = (p[2] / psMax) * 100, other = Math.max(0, p[2] - r1 - r2);
                  return (
                    <div key={p[1]} className="pship">
                      <span className="w">{p[1]}{p[1] === 1 ? 'st' : p[1] === 2 ? 'nd' : p[1] === 3 ? 'rd' : 'th'}</span>
                      <span className="l">{p[4] ? nm(p[4]) : ''} <span className="mono muted">{r1} ({p[6] ?? 0})</span></span>
                      <span className="bar" title={`${p[2]} runs off ${p[3]} balls`} style={{ justifyContent: 'center' }}>
                        <span style={{ display: 'flex', width: `${Math.max(w, 4)}%` }} className="sweep">
                          <i className="a" style={{ width: `${(r1 / Math.max(1, p[2])) * 100}%` }} />
                          <i className="x" style={{ width: `${(other / Math.max(1, p[2])) * 100}%` }} />
                          <i className="b" style={{ width: `${(r2 / Math.max(1, p[2])) * 100}%` }} />
                        </span>
                        <em>{p[2]} <span className="muted" style={{ fontWeight: 400 }}>({p[3]})</span></em>
                      </span>
                      <span className="r"><span className="mono muted">{r2} ({p[9] ?? 0})</span> {p[7] ? nm(p[7]) : ''}</span>
                    </div>
                  );
                })}
              </div>
              <PartnershipTrack ps={ps} fow={fow} nm={nm} bpo={bpo} />
            </div>
          )}
        </div>
      </div>

      <Panel title="Over by over" sub={`${team(sel)}: runs in each over. Stumps mark the overs where wickets fell.`}>
        <Columns key={sel} aria="Runs per over" fmt={n0} highlightMax={false} height={220}
          marks={ovs.filter((o) => o[0] === sel).map((o) => o[3])}
          data={ovs.filter((o) => o[0] === sel).map((o) => ({ label: String(o[1] + 1), title: `Over ${o[1] + 1}`, value: o[2], color: colorOf(team(sel)),
            extra: [{ label: 'Wickets', value: n0(o[3]) }, { label: 'Score', value: n0(o[4]) }] }))} />
      </Panel>

      <SectionHead title="How the match unfolded" />
      <div className="grid g2">
        <Panel title="Worm" sub={wm === 'cum' ? 'Runs by the end of each over.' : 'Run rate so far, by over.'}
          tools={<Mini label="Show" value={wm} onChange={setWm} options={[['cum', 'Runs'], ['rr', 'Run rate']]} />}>
          <Legend items={innings.slice(0, 4).map((k, n) => ({ label: `${team(k)}${innings.length > 2 ? ` (${k})` : ''}`, color: SERIES[n] }))} />
          <LineChart key={wm} aria="Runs by over" labels={Array.from({ length: maxOv }, (_, n) => String(n + 1))} fmt={wm === 'cum' ? n0 : d1}
            series={innings.slice(0, 4).map((k, n) => ({ name: `${team(k)}${innings.length > 2 ? ` (${k})` : ''}`, color: SERIES[n], values: Array.from({ length: maxOv }, (_, o) => {
              const sc = ovs.find((x) => x[0] === k && x[1] === o)?.[4];
              return sc == null ? null : wm === 'cum' ? sc : sc / (o + 1); }) }))} />
        </Panel>
        {!multi && wpSeries.length > 0 ? (
          <Panel title="Win probability" sub={`${team(+wpSide)}'s chance of winning at the end of each over. Over numbers restart in the second innings.`}
            tools={<Mini label="For" value={wpSide} onChange={setWpSide} options={[['1', team(1)], ['2', team(2)]]} />}>
            <LineChart key={wpSide} aria="Win probability by over" labels={wpLabels} yMin={0} yMax={100} refLine={50} fmt={(v) => `${Math.round(v)}%`}
              breaks={wpLabels.findIndex((l) => l.startsWith('Inns 2')) > 0 ? [{ at: wpLabels.findIndex((l) => l.startsWith('Inns 2')) - 0.5, label: '2nd innings' }] : undefined}
              xFmt={(l) => l.split('over ')[1]} series={[{ name: `${team(+wpSide)} win %`, color: colorOf(team(+wpSide)), wash: true,
                values: wpSide === '1' ? wpSeries : wpSeries.map((v) => (v == null ? null : 100 - v)) }]} />
          </Panel>
        ) : <Panel title="Win probability" sub="Not modelled for multi-day cricket yet: draws make it a three-way outcome." />}
      </div>
      {!multi && <ParChase m={m} team={team} />}
      {multi && <Sessions m={m} />}
      {m.moments.length > 0 && (
        <Panel title="Turning points" sub="The balls that moved win probability the most. Swing is from the batting side's point of view." flush
          tools={<Mini label="Type" value={tpType} onChange={setTpType} options={[['all', 'All'], ['w', 'Wickets'], ['r', 'Runs']]} />}>
          <Table rows={moments} sort="sw" empty="No turning points with these filters." cols={[
            { key: 'b', label: 'Ball', left: true, sortable: false, get: (x: any) => `${x[0]}.${x[1]}.${x[2]}`, fmt: (_, x: any) => `${team(x[0])} · ${ballLabel(x[1], x[2])}` },
            { key: 'w', label: 'What happened', left: true, sortable: false, get: (x: any) => x[3],
              fmt: (_, x: any) => <><Link className="link" to={`/player/${x[4]}`}>{nm(x[4])}</Link> to <Link className="link" to={`/player/${x[3]}`}>{nm(x[3])}</Link>: {x[6] ? <b>wicket ({x[6]})</b> : `${x[5]} run${x[5] === 1 ? '' : 's'}`}</> },
            { key: 'wp', label: 'Win % before', get: (x: any) => x[9], fmt: (v) => `${Math.round(v * 100)}%` },
            { key: 'sw', label: 'Swing', get: (x: any) => Math.abs(x[8]), fmt: (_, x: any) => <span className={x[8] > 0 ? 'pos' : 'neg'}>{signed(x[8] * 100, 1)} pts</span> },
          ]} />
        </Panel>
      )}
    </>
  );
}
