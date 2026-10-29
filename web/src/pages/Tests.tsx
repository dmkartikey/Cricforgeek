import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { d1, n0, pct, signed } from '../lib/fmt';
import { CountUp, ErrorBox, Legend, Loader, Mini, MiniSelect, Panel, SectionHead, Tiles } from '../components/ui';
import { Columns, HBars, LineChart } from '../components/charts';
import { Table } from '../components/Table';
import { useFullName } from '../lib/names';

type T = {
  yearly: { year: number; p: number; dec: number; d: number; t: number; hw: number; aw: number; rpw: number; rpo: number; pace_share: number; dot_pct: number }[];
  innings: { year: number; inn: number; n: number; runs: number; overs: number; allout: number; decl: number }[];
  toss: { year: number; bat: number; field: number; tw: number; tl: number; p: number }[];
  home: { team: string; hp: number; hw: number; hl: number; ap: number; aw: number; al: number }[];
  age: { bucket: number; rpo: number; bpw: number; pace_share: number; balls: number }[];
  hosts: { host: string; m: number; rpw: number; pace_share: number; rpo: number; d: number; hw: number; aw: number; avg1: number }[];
  leaders: Record<'bat' | 'bowl', Record<string, [string, string, Record<string, number>][]>>;
  chases: [string, number, string, string, number, number, number, string, string][];
  follow: [string, number, string, string, string | null, string][];
};

const ERAS: [string, string, number, number][] = [['all', 'All years', 0, 9999], ['2001', '2001–10', 2001, 2010], ['2011', '2011–20', 2011, 2020], ['2021', '2021 on', 2021, 9999]];
const inEra = (era: string, y: number) => { const e = ERAS.find((x) => x[0] === era)!; return y >= e[2] && y <= e[3]; };
const eraOpts = ERAS.map((e) => [e[0], e[1]] as [string, string]);
const BANDS: [string, number, number][] = [['< 150', 0, 149], ['150–199', 150, 199], ['200–249', 200, 249], ['250–299', 250, 299], ['300–349', 300, 349], ['350+', 350, 9999]];
const INN_NAME = ['', '1st innings', '2nd innings', '3rd innings', '4th innings'];

export default function Tests({ gender: g }: { gender: 'male' | 'female' }) {
  const fullName = useFullName();
  const { data: t, error } = useData<T>(`tests/${g}.json`);
  const [era, setEra] = useState('all');
  const [ym, setYm] = useState<'res' | 'rpw' | 'pace' | 'dot'>('res');
  const [im, setIm] = useState<'runs' | 'overs' | 'allout' | 'decl'>('runs');
  const [iEra, setIEra] = useState('all');
  const [cEra, setCEra] = useState('all');
  const [cTeam, setCTeam] = useState('all');
  const [hSort, setHSort] = useState<'hp' | 'hwp' | 'gap'>('hp');
  const [am, setAm] = useState<'rpo' | 'bpw' | 'pace'>('bpw');
  const [hm, setHm] = useState<'pace_share' | 'rpw' | 'd' | 'avg1'>('pace_share');
  const [li, setLi] = useState('4');
  const [lr, setLr] = useState<'bat' | 'bowl'>('bat');
  const [fEra, setFEra] = useState('all');

  const sum = useMemo(() => {
    if (!t) return null;
    const ys = t.yearly.filter((y) => inEra(era, y.year));
    const s = ys.reduce((a, y) => ({ p: a.p + y.p, d: a.d + y.d, hw: a.hw + y.hw, aw: a.aw + y.aw, rpw: a.rpw + y.rpw * y.p }), { p: 0, d: 0, hw: 0, aw: 0, rpw: 0 });
    return { ...s, rpw: s.rpw / Math.max(1, s.p), first: ys[0]?.year, last: ys[ys.length - 1]?.year };
  }, [t, era]);

  if (error) return <ErrorBox error={error} />;
  if (!t || !sum) return <Loader text="Loading Test cricket" />;
  const yr = t.yearly.filter((y) => y.p >= 5); // skip near-empty years (e.g. 2001 has one Test)
  const years = yr.map((y) => String(y.year));
  const toss = t.toss.filter((x) => x.p >= 5);

  // innings by number
  const innAgg = [1, 2, 3, 4].map((k) => {
    const rows = t.innings.filter((x) => x.inn === k && inEra(iEra, x.year));
    const n = rows.reduce((a, x) => a + x.n, 0);
    return { k, n, runs: rows.reduce((a, x) => a + x.runs * x.n, 0) / Math.max(1, n), overs: rows.reduce((a, x) => a + x.overs * x.n, 0) / Math.max(1, n),
      allout: rows.reduce((a, x) => a + x.allout, 0) / Math.max(1, n), decl: rows.reduce((a, x) => a + x.decl, 0) / Math.max(1, n) };
  });
  const IM: Record<string, [string, (v: number) => string]> = { runs: ['Average score', n0], overs: ['Average overs batted', d1], allout: ['Bowled out', (v) => pct(v, 0)], decl: ['Declared', (v) => pct(v, 0)] };

  // chases
  const chaseTeams = [...new Set(t.chases.map((c) => c[2]))].sort();
  const ch = t.chases.filter((c) => inEra(cEra, c[1]) && (cTeam === 'all' || c[2] === cTeam));
  const bands = BANDS.map(([l, lo, hi]) => {
    const r = ch.filter((c) => c[4] >= lo && c[4] <= hi);
    return { l, n: r.length, won: r.filter((c) => c[7] === 'won').length, lost: r.filter((c) => c[7] === 'lost').length, draw: r.filter((c) => c[7] !== 'won' && c[7] !== 'lost').length };
  });
  const bestChases = ch.filter((c) => c[7] === 'won').sort((a, b) => b[4] - a[4]).slice(0, 10);

  // follow-ons
  const fo = t.follow.filter((f) => inEra(fEra, f[1]));
  const foWon = fo.filter((f) => f[4] === f[2]).length, foTurn = fo.filter((f) => f[4] === f[3]);

  const home = [...t.home].map((h) => ({ ...h, hwp: h.hw / Math.max(1, h.hp), awp: h.aw / Math.max(1, h.ap) }))
    .sort((a, b) => (hSort === 'hp' ? b.hp + b.ap - a.hp - a.ap : hSort === 'hwp' ? b.hwp - a.hwp : (b.hwp - b.awp) - (a.hwp - a.awp)));
  const ageLabel = (b: number) => (b >= 13 ? '130+' : `${b * 10}–${b * 10 + 9}`);
  const HM: Record<string, [string, (v: number) => string, number]> = {
    pace_share: ['Share of wickets to pace', (v) => pct(v, 0), 0.65], rpw: ['Runs per wicket', d1, sum.rpw], d: ['Draw %', (v) => pct(v, 0), sum.d / Math.max(1, sum.p)], avg1: ['Avg 1st-innings score', n0, 330] };
  const hostVal = (h: T['hosts'][number]) => (hm === 'd' ? h.d / Math.max(1, h.m) : (h as any)[hm]);
  const lead = t.leaders?.[lr]?.[li] ?? [];

  return (
    <>
      <SectionHead id="testlab" title="The Test match lab" sub={`Every ${g === 'male' ? "men's" : "women's"} Test with ball-by-ball records since ${t.yearly[0]?.year}: fourth-innings chases, follow-ons,
            declarations, the toss, home advantage, the ageing ball and how conditions change from country to country.`} />

      <Panel tools={<Mini label="Era" value={era} onChange={setEra} options={eraOpts} />} title="At a glance" sub={`${sum.first}–${sum.last}`}>
        <Tiles items={[
          { l: 'Tests', v: <CountUp value={sum.p} format={n0} /> },
          { l: 'Draws', v: pct(sum.d / Math.max(1, sum.p), 0), h: `${n0(sum.d)} matches` },
          { l: 'Home wins', v: pct(sum.hw / Math.max(1, sum.p), 0) },
          { l: 'Away wins', v: pct(sum.aw / Math.max(1, sum.p), 0) },
          { l: 'Runs per wicket', v: d1(sum.rpw) },
        ]} />
      </Panel>

      <Panel title="Year by year" sub="How Test cricket has changed since 2001. Years with fewer than 5 Tests are left out."
        tools={<Mini label="Show" value={ym} onChange={setYm} options={[['res', 'Results'], ['rpw', 'Runs / wicket'], ['pace', 'Pace share'], ['dot', 'Dot %']]} />}>
        {ym === 'res' ? <>
          <Legend items={[{ label: 'Home win %', color: 'var(--s1)' }, { label: 'Away win %', color: 'var(--s2)' }, { label: 'Draw %', color: 'var(--s3)' }]} />
          <LineChart aria="Test results by year" labels={years} yMin={0} yMax={80} fmt={(v) => `${Math.round(v)}%`} height={260} series={[
            { name: 'Home win %', color: 'var(--s1)', values: yr.map((y) => (100 * y.hw) / y.p) },
            { name: 'Away win %', color: 'var(--s2)', values: yr.map((y) => (100 * y.aw) / y.p) },
            { name: 'Draw %', color: 'var(--s3)', values: yr.map((y) => (100 * y.d) / y.p) }]} />
        </> : (
          <LineChart key={ym} aria="Test trend by year" labels={years} height={260}
            fmt={ym === 'rpw' ? d1 : (v) => `${Math.round(v)}%`}
            series={[{ name: ym === 'rpw' ? 'Runs per wicket' : ym === 'pace' ? 'Pace share of wickets' : 'Dot-ball %', color: 'var(--s1)', wash: true,
              values: yr.map((y) => (ym === 'rpw' ? y.rpw : ym === 'pace' ? 100 * y.pace_share : y.dot_pct)) }]} />
        )}
      </Panel>

      <div className="grid g2">
        <Panel title="Innings by innings" sub="How each innings of a Test plays out."
          tools={<>
            <Mini label="Metric" value={im} onChange={setIm} options={Object.entries(IM).map(([k, v]) => [k as typeof im, v[0].replace('Average ', 'Avg ')])} />
            <Mini label="Era" value={iEra} onChange={setIEra} options={eraOpts} />
          </>}>
          <Columns key={im + iEra} aria="Innings comparison" fmt={IM[im][1]} highlightMax={false} height={230}
            data={innAgg.map((x) => ({ label: INN_NAME[x.k], value: (x as any)[im], extra: [{ label: 'Innings', value: n0(x.n) }, { label: 'Avg score', value: n0(x.runs) }, { label: 'Bowled out', value: pct(x.allout, 0) }] }))} />
        </Panel>
        <Panel title="The ageing ball" sub="By overs into the innings. The second new ball is due at 80 overs."
          tools={<Mini label="Metric" value={am} onChange={setAm} options={[['bpw', 'Balls / wicket'], ['rpo', 'Runs / over'], ['pace', 'Pace share']]} />}>
          <Columns key={am} aria="Ball age" height={230} highlightMax={false} fmt={am === 'pace' ? (v) => `${Math.round(v)}%` : d1}
            data={t.age.map((a) => ({ label: ageLabel(a.bucket).split('–')[0], title: `Overs ${ageLabel(a.bucket)}`,
              value: am === 'bpw' ? a.bpw : am === 'rpo' ? a.rpo : 100 * a.pace_share,
              color: a.bucket === 8 ? 'var(--s2)' : undefined,
              extra: [{ label: 'Runs / over', value: d1(a.rpo) }, { label: 'Balls / wicket', value: d1(a.bpw) }, { label: 'Pace share', value: pct(a.pace_share, 0) }] }))} />
          <div className="muted" style={{ fontSize: 12 }}>Amber bar = overs 80–89, when most teams take the second new ball.</div>
        </Panel>
      </div>

      <Panel title="Fourth-innings chases" sub="What happens when a side bats last needing a target."
        tools={<>
          <Mini label="Era" value={cEra} onChange={setCEra} options={eraOpts} />
          <MiniSelect label="Chasing team" value={cTeam} onChange={setCTeam} options={[['all', 'All teams'], ...chaseTeams.map((x) => [x, x] as [string, string])]} />
        </>}>
        <div className="chase-grid stagger" key={cEra + cTeam}>
          {bands.map((b) => (
            <div key={b.l} className="chase-cell">
              <span className="muted" style={{ fontSize: 12 }}>Target {b.l}</span>
              <span className="v">{b.n ? pct(b.won / b.n, 0) : '–'}</span>
              <div className="stackbar" aria-label={`${b.won} won, ${b.draw} drawn, ${b.lost} lost`}>
                <i style={{ flex: b.won || 0.0001, background: 'var(--good)' }} />
                <i style={{ flex: b.draw || 0.0001, background: 'var(--s3)' }} />
                <i style={{ flex: b.lost || 0.0001, background: 'var(--bad)' }} />
              </div>
              <span className="muted" style={{ fontSize: 11 }}>{b.won} won · {b.draw} drawn · {b.lost} lost</span>
            </div>
          ))}
        </div>
        <Legend items={[{ label: 'Chasing side won', color: 'var(--good)', kind: 'box' }, { label: 'Drawn', color: 'var(--s3)', kind: 'box' }, { label: 'Lost', color: 'var(--bad)', kind: 'box' }]} />
        <h3>Highest successful chases</h3>
        <Table rows={bestChases} empty="No successful chases with these filters." cols={[
          { key: 'tgt', label: 'Target', get: (c: any) => c[4], sortable: false },
          { key: 'tm', label: 'Chasing', left: true, get: (c: any) => c[2], fmt: (v, c: any) => <Link to={`/match/${c[0]}`}>{v} v {c[3]}</Link>, sortable: false },
          { key: 'w', label: 'Won by', get: (c: any) => `${10 - c[6]} wkts`, sortable: false },
          { key: 'y', label: 'Year', get: (c: any) => c[1], sortable: false },
          { key: 'v', label: 'Venue', left: true, get: (c: any) => c[8], sortable: false },
        ]} />
      </Panel>

      <div className="grid g2">
        <Panel title="Follow-ons" sub="When the side batting second falls well short and is sent straight back in."
          tools={<Mini label="Era" value={fEra} onChange={setFEra} options={eraOpts} />}>
          <Tiles items={[
            { l: 'Follow-ons', v: n0(fo.length) },
            { l: 'Enforcer won', v: pct(foWon / Math.max(1, fo.length), 0) },
            { l: 'Turned around', v: n0(foTurn.length), h: 'side following on won' },
          ]} />
          {foTurn.length > 0 && <div className="stack" style={{ gap: 6 }}>
            <h3>Turnarounds</h3>
            {foTurn.map((f) => <Link key={f[0]} to={`/match/${f[0]}`} className="tag" style={{ width: 'fit-content' }}>{f[3]} beat {f[2]} after following on, {f[1]}</Link>)}
          </div>}
        </Panel>
        <Panel title="The toss" sub="What captains choose, and whether winning the toss wins the match.">
          <Legend items={[{ label: 'Chose to bat', color: 'var(--s1)' }, { label: 'Toss winner won the match', color: 'var(--s2)' }, { label: '50%', kind: 'dash' }]} />
          <LineChart aria="Toss decisions by year" labels={toss.map((x) => String(x.year))} yMin={0} yMax={100} refLine={50} fmt={(v) => `${Math.round(v)}%`} series={[
            { name: 'Chose to bat', color: 'var(--s1)', values: toss.map((x) => (100 * x.bat) / Math.max(1, x.bat + x.field)) },
            { name: 'Toss winner won', color: 'var(--s2)', values: toss.map((x) => (100 * x.tw) / Math.max(1, x.p)) }]} />
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="Home advantage" flush sub="Host = the side that plays most international cricket at that ground."
          tools={<Mini label="Sort" value={hSort} onChange={setHSort} options={[['hp', 'Most Tests'], ['hwp', 'Home win %'], ['gap', 'Biggest gap']]} />}>
          <Table key={hSort} rows={home} cols={[
            { key: 't', label: 'Team', left: true, get: (x: any) => x.team, sortable: false },
            { key: 'hp', label: 'Home P', get: (x: any) => x.hp, sortable: false },
            { key: 'hwp', label: 'Home win %', get: (x: any) => x.hwp, fmt: (v) => pct(v, 0), sortable: false },
            { key: 'ap', label: 'Away P', get: (x: any) => x.ap, sortable: false },
            { key: 'awp', label: 'Away win %', get: (x: any) => x.awp, fmt: (v) => pct(v, 0), sortable: false },
            { key: 'gap', label: 'Gap', get: (x: any) => x.hwp - x.awp, fmt: (v) => signed(v * 100, 0), sortable: false },
          ]} />
        </Panel>
        <Panel title="Conditions by country" sub="Tests hosted in each country."
          tools={<Mini label="Metric" value={hm} onChange={setHm} options={[['pace_share', 'Pace share'], ['rpw', 'Runs / wkt'], ['d', 'Draw %'], ['avg1', '1st inns']]} />}>
          <HBars key={hm} fmt={HM[hm][1]} base={HM[hm][2]} refLabel={hm === 'pace_share' ? 'reference' : 'overall'}
            rows={[...t.hosts].sort((a, b) => hostVal(b) - hostVal(a)).map((h) => ({ label: h.host, value: hostVal(h), note: `${n0(h.m)} Tests`,
              tipRows: [{ label: 'Pace share', value: pct(h.pace_share, 0) }, { label: 'Runs / wicket', value: d1(h.rpw) }, { label: 'Home wins', value: n0(h.hw) }, { label: 'Draws', value: n0(h.d) }] }))} />
        </Panel>
      </div>

      <Panel title="Innings specialists" sub="Highest impact in each innings of a Test, all years."
        tools={<>
          <Mini label="Innings" value={li} onChange={setLi} options={[['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']]} />
          <Mini label="Role" value={lr} onChange={setLr} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />
        </>}>
        <div className="lb stagger" key={li + lr}>
          {lead.map((x, i) => (
            <Link key={x[0]} to={`/player/${x[0]}`} className={`lb-row ${i === 0 ? 'first' : ''}`}>
              <span className="lb-rank">{i + 1}</span><span className="lb-name">{fullName(x[0], x[1])}</span>
              <span className="lb-val">{signed(x[2].imp, 0)}</span>
              <span className="lb-meta">{lr === 'bat' ? `${n0(x[2].r)} runs · ${n0(x[2].i)} inns · avg ${d1(x[2].r / Math.max(1, x[2].o))}` : `${n0(x[2].w)} wkts · ${n0(x[2].i)} inns · avg ${d1(x[2].r / Math.max(1, x[2].w))}`}</span>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
