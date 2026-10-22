import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { d1, dateShort, n0, overs, signed } from '../lib/fmt';
import { ErrorBox, Legend, Loader, Panel, Seg, SERIES } from '../components/ui';
import { Columns, LineChart } from '../components/charts';
import { Table } from '../components/Table';

const howOut = (kind: string | null, bowler: string) => {
  if (!kind) return 'not out';
  const k: Record<string, string> = { bowled: 'b', lbw: 'lbw b', caught: 'c … b', 'caught and bowled': 'c & b', stumped: 'st … b', 'hit wicket': 'hit wicket b' };
  return k[kind] && bowler ? `${k[kind]} ${bowler}` : kind;
};

export default function Match() {
  const { id } = useParams();
  const { data: m, error } = useData<any>(`matches/${id}.json`);
  const [inn, setInn] = useState('1');
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loader text="Loading match" />;
  const i = m.info, nm = (p: string) => m.names[p] ?? p;
  const ovs: any[] = m.overs;
  const innings = [...new Set(ovs.map((o) => o[0]))] as number[];
  const team = (k: number) => m.bat.find((b: any) => b[0] === k)?.[10] ?? (k % 2 ? i.team1 : i.team2);
  const totals = innings.map((k) => {
    const rows = ovs.filter((o) => o[0] === k);
    const lastRow = rows[rows.length - 1];
    return { k, team: team(k), score: lastRow?.[4] ?? 0, wkts: rows.reduce((a, o) => a + o[3], 0), overs: rows.length };
  });
  const limited = i.family !== 'MD';
  const maxOv = Math.max(...innings.map((k) => ovs.filter((o) => o[0] === k).length), 0);
  const result = i.winner ? `${i.winner} won${i.by_runs ? ` by ${i.by_runs} runs` : i.by_wkts ? ` by ${i.by_wkts} wickets` : ''}${i.method ? ` (${i.method})` : ''}`
    : i.result === 'draw' ? 'Match drawn' : i.result === 'tie' ? 'Match tied' : 'No result';
  // win probability from the first-innings batting side's view, over by over across both innings
  const wpSeries: (number | null)[] = [], wpLabels: string[] = [];
  if (limited) for (const o of ovs.filter((x) => x[0] <= 2)) {
    if (o[5] == null) continue;
    wpSeries.push(100 * (o[0] === 1 ? o[5] : 1 - o[5]));
    wpLabels.push(`Inns ${o[0]} · over ${o[1] + 1}`);
  }
  const sel = +inn;
  const bat = m.bat.filter((b: any) => b[0] === sel), bowl = m.bowl.filter((b: any) => b[0] === sel);
  return (
    <>
      <section className="fade-in stack" style={{ gap: 8 }}>
        <div className="eyebrow"><Link to={`/league/${i.comp}`}>{m.comp_label}</Link> · {i.season} · {dateShort(i.date)}</div>
        <h1>{i.team1} <span className="muted">v</span> {i.team2}</h1>
        <div className="sub">{i.venue}{i.city ? `, ${i.city}` : ''} · Toss: {i.toss_winner} chose to {i.toss_decision}</div>
        <div className="row" style={{ marginTop: 6 }}>
          {totals.map((t) => (
            <div key={t.k} className="panel" style={{ padding: '10px 14px', gap: 2 }}>
              <span className="muted" style={{ fontSize: 12 }}>{t.team}{innings.length > 2 ? ` · inns ${t.k}` : ''}</span>
              <span className="score-big">{t.score}/{t.wkts} <span className="muted" style={{ fontSize: 13 }}>({t.overs} ov)</span></span>
            </div>
          ))}
          <span className="tag accent" style={{ height: 28, fontSize: 13 }}>{result}</span>
        </div>
      </section>
      <div className="grid g2">
        <Panel title="Worm" sub="Cumulative runs by over.">
          <Legend items={innings.slice(0, 4).map((k, n) => ({ label: `${team(k)}${innings.length > 2 ? ` (${k})` : ''}`, color: SERIES[n] }))} />
          <LineChart aria="Cumulative runs by over" labels={Array.from({ length: maxOv }, (_, n) => String(n + 1))} fmt={n0}
            series={innings.slice(0, 4).map((k, n) => ({ name: team(k), color: SERIES[n], values: Array.from({ length: maxOv }, (_, o) => ovs.find((x) => x[0] === k && x[1] === o)?.[4] ?? null) }))} />
        </Panel>
        {limited && wpSeries.length > 0 ? (
          <Panel title="Win probability" sub={`${i.team1 === team(1) ? i.team1 : team(1)}'s chance of winning, end of each over.`}>
            <LineChart aria="Win probability by over" labels={wpLabels} yMin={0} yMax={100} refLine={50} fmt={(v) => `${Math.round(v)}%`}
              xFmt={(l) => l.split('over ')[1]} series={[{ name: `${team(1)} win %`, color: 'var(--s1)', wash: true, values: wpSeries }]} />
          </Panel>
        ) : <Panel title="Win probability" sub="Not modelled for multi-day cricket yet (draws make it a three-way outcome)." />}
      </div>
      <Panel title="Scorecard" right={<Seg label="Innings" value={inn} onChange={setInn} options={innings.map((k) => [String(k), `${team(k)}${innings.length > 2 ? ` (${k})` : ''}`])} />}>
        <Columns aria="Runs per over" fmt={n0} highlightMax={false}
          marks={ovs.filter((o) => o[0] === sel).map((o) => o[3])}
          data={ovs.filter((o) => o[0] === sel).map((o) => ({ label: String(o[1] + 1), title: `Over ${o[1] + 1}`, value: o[2],
            extra: [{ label: 'Wickets', value: n0(o[3]) }, { label: 'Score', value: n0(o[4]) }] }))} />
        <div className="muted" style={{ fontSize: 12 }}>Manhattan: runs per over, dots = wickets.</div>
        <div className="grid g2">
          <Table rows={bat} cols={[
            { key: 'p', label: 'Batter', left: true, get: (x: any) => nm(x[1]), sortable: false,
              fmt: (v, x: any) => <><Link to={`/player/${x[1]}`}>{v}</Link><div className="muted" style={{ fontSize: 11 }}>{howOut(x[6], x[7] ? nm(x[7]) : '')}</div></> },
            { key: 'r', label: 'R', get: (x: any) => x[2] }, { key: 'b', label: 'B', get: (x: any) => x[3] },
            { key: 'f', label: '4s/6s', get: (x: any) => `${x[4]}/${x[5]}`, sortable: false },
            { key: 'sr', label: 'SR', get: (x: any) => (x[3] ? (100 * x[2]) / x[3] : NaN), fmt: d1 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[8], fmt: (v) => <span className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>{signed(v, 1)}</span> },
            ...(limited ? [{ key: 'wpa', label: 'WPA', get: (x: any) => x[9], fmt: (v: any) => signed(v * 100, 1) + '%' }] : []),
          ]} />
          <Table rows={bowl} cols={[
            { key: 'p', label: 'Bowler', left: true, get: (x: any) => nm(x[1]), sortable: false, fmt: (v, x: any) => <Link to={`/player/${x[1]}`}>{v}</Link> },
            { key: 'o', label: 'O', get: (x: any) => x[2], fmt: (v) => overs(v, i.balls_per_over) },
            { key: 'r', label: 'R', get: (x: any) => x[3] }, { key: 'w', label: 'W', get: (x: any) => x[4] },
            { key: 'e', label: 'Econ', get: (x: any) => (x[2] ? (6 * x[3]) / x[2] : NaN), fmt: d1 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[8], fmt: (v) => <span className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>{signed(v, 1)}</span> },
            ...(limited ? [{ key: 'wpa', label: 'WPA', get: (x: any) => x[9], fmt: (v: any) => signed(v * 100, 1) + '%' }] : []),
          ]} />
        </div>
      </Panel>
      {m.moments.length > 0 && (
        <Panel title="Turning points" sub="The balls that moved the win probability most." flush>
          <Table rows={m.moments} sort="sw" cols={[
            { key: 'b', label: 'Ball', left: true, get: (x: any) => `${x[0]}.${x[1]}.${x[2]}`, fmt: (_, x: any) => `Inns ${x[0]} · ${x[1]}.${x[2] % 6 || 6}`, sortable: false },
            { key: 'w', label: 'What happened', left: true, sortable: false, get: (x: any) => x[3],
              fmt: (_, x: any) => <><Link to={`/player/${x[3]}`}>{nm(x[3])}</Link> v <Link to={`/player/${x[4]}`}>{nm(x[4])}</Link>: {x[6] ? <b>wicket ({x[6]})</b> : `${x[5]} run${x[5] === 1 ? '' : 's'}`}</> },
            { key: 'wp', label: 'Before', get: (x: any) => x[9], fmt: (v) => `${Math.round(v * 100)}%` },
            { key: 'sw', label: 'Swing', get: (x: any) => Math.abs(x[8]), fmt: (_, x: any) => <span className={x[8] > 0 ? 'pos' : 'neg'}>{signed(x[8] * 100, 1)}%</span> },
          ]} />
          <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>Swing is from the batting side's point of view.</div>
        </Panel>
      )}
    </>
  );
}
