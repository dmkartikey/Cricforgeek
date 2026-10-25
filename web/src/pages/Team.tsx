import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { usePageMeta } from '../lib/meta';

import { d1, d2, dateShort, n0, pct, signed } from '../lib/fmt';
import { BGRP, DCAT, FAM_LABEL, MULTI, PHASES, POS } from '../lib/labels';
import { ErrorBox, Legend, Loader, Mini, MiniSelect, Panel, RankList, SectionHead, Seg } from '../components/ui';
import { Butterfly, Columns, HBars, LineChart } from '../components/charts';
import { Table } from '../components/Table';
import { Board, SbCell } from '../components/Scoreboard';

const ORDER = ['TEST', 'ODI', 'T20', 'FC', 'LA', 'HUN'];
const pretty = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export default function Team() {
  const { key } = useParams();
  const st = useSettings();
  const { data: t, error } = useData<any>(`teams/${key}.json`);
  const meta = useData<any>('meta.json').data;
  usePageMeta(t ? `${t.name}${t.gender === 'female' ? ' (women)' : ''} cricket team stats` : null);
  const compFam = useMemo(() => new Map<string, string>((meta?.comps ?? []).map((c: any) => [c.key, c.fam])), [meta]);
  const fams = useMemo(() => (t ? Object.keys(t.fams).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)) : []), [t]);
  const [fam, setFam] = useState('');
  useEffect(() => { if (fams.length) setFam(fams.includes(st.fmt) ? st.fmt : [...fams].sort((a, b) => t.fams[b].p - t.fams[a].p)[0]); }, [fams]); // eslint-disable-line
  const [comp, setComp] = useState('');
  const [sm, setSm] = useState<'win' | 'rr' | 'rpw'>('win');
  const [pm, setPm] = useState<'rr' | 'bpw'>('rr');
  const [posM, setPosM] = useState<'avg' | 'sr' | 'share'>('avg');
  const [hmin, setHmin] = useState<'2' | '10' | '25'>('2');
  const [hsort, setHsort] = useState<'p' | 'wp'>('p');
  const [tot, setTot] = useState<'high' | 'low'>('high');
  const [bw, setBw] = useState<'runs' | 'wkts'>('runs');
  const [vmin, setVmin] = useState<'3' | '10'>('3');
  const [rres, setRres] = useState<'all' | 'W' | 'L'>('all');
  const [lb, setLb] = useState<'bat' | 'bowl' | 'caps'>('bat');

  const famComps: any[] = useMemo(() => (t?.comps ?? []).filter((c: any) => !compFam.size || compFam.get(c[0]) === fam), [t, fam, compFam]);
  useEffect(() => { if (famComps.length) setComp(famComps[0][0]); }, [famComps]);
  if (error) return <ErrorBox error={error} />;
  if (!t || !fam) return <Loader text="Loading team" />;

  const f = t.fams[fam] ?? {};
  const multi = MULTI(fam);
  const recentAll: any[] = (t.recent ?? []).filter((x: any) => !compFam.size || compFam.get(x[1]) === fam);
  const compsAll: any[] = t.comps ?? [];
  const famRow = famComps.reduce((a, c) => ({ p: a.p + c[2], w: a.w + c[3], l: a.l + c[4], t: a.t + c[5], nr: a.nr + c[6] }), { p: 0, w: 0, l: 0, t: 0, nr: 0 });
  const span = famComps.length ? `${famComps.map((c) => c[7]).sort()[0].slice(0, 4)}–${famComps.map((c) => c[8]).sort().slice(-1)[0].slice(0, 4)}` : '';
  const form = recentAll.slice(0, 12).reverse();

  // seasons for the selected competition
  const seasons = (t.seasons ?? []).filter((s: any) => s[0] === comp && s[2] >= (multi ? 2 : 3));
  const rr = new Map<string, any>((t.season_rr ?? []).filter((s: any) => s[1] === comp).map((s: any) => [s[2], s]));
  const sLabels = seasons.map((s: any) => s[1]);
  const series = sm === 'win'
    ? [{ name: 'Win % (3-season rolling)', color: 'var(--s1)', wash: true, values: seasons.map((_: any, i: number) => {
        const win = seasons.slice(Math.max(0, i - 1), i + 2);
        const w = win.reduce((t: number, x: any) => t + x[3], 0), d = win.reduce((t: number, x: any) => t + x[3] + x[4], 0);
        return d ? (100 * w) / d : null; }) }]
    : sm === 'rr'
      ? [{ name: 'Run rate (batting)', color: 'var(--s1)', values: sLabels.map((k: string) => { const x = rr.get(k); return x && x[4] ? (6 * x[3]) / x[4] : null; }) },
         { name: 'Run rate conceded', color: 'var(--s2)', values: sLabels.map((k: string) => { const x = rr.get(k); return x && x[7] ? (6 * x[6]) / x[7] : null; }) }]
      : [{ name: 'Runs per wicket (batting)', color: 'var(--s1)', values: sLabels.map((k: string) => { const x = rr.get(k); return x && x[5] ? x[3] / x[5] : null; }) },
         { name: 'Runs per wicket (bowling)', color: 'var(--s2)', values: sLabels.map((k: string) => { const x = rr.get(k); return x && x[8] ? x[6] / x[8] : null; }) }];

  const ph: any[] = [...(t.phase?.[fam] ?? [])].sort((a: any, b: any) => a[0] - b[0]);
  const phN = PHASES[fam] ?? PHASES.T20;
  const pos: any[] = [...(t.positions?.[fam] ?? [])].sort((a: any, b: any) => a[0] - b[0]);
  const posTot = pos.reduce((a, x) => a + x[1], 0);
  const vs: any[] = (t.vs_type?.[fam] ?? []).filter((x: any) => x[0] !== 'unknown');
  const att: any[] = (t.attack?.[fam] ?? []).filter((x: any) => x[0] !== 'unknown');
  const attW = att.reduce((a, x) => a + x[1], 0);
  const how: any[] = [...(t.how_out?.[fam] ?? [])].sort((a: any, b: any) => b[1] - a[1]);
  const howTot = how.reduce((a, x) => a + x[1], 0);
  const h2h = (t.h2h ?? []).filter((x: any) => x[1] >= +hmin).sort((a: any, b: any) => (hsort === 'p' ? b[1] - a[1] : b[2] / Math.max(1, b[2] + b[3]) - a[2] / Math.max(1, a[2] + a[3])));
  const totals: any[] = t.totals?.[fam]?.[tot] ?? [];
  const wins: any[] = t.big_wins?.[fam]?.[bw] ?? [];
  const venues: any[] = (t.venues?.[fam] ?? []).filter((v: any) => v[2] >= +vmin);
  const recent = recentAll.filter((x: any) => rres === 'all' || x[3] === rres);
  const bpo = 6;

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Team · {t.gender === 'female' ? 'Women' : 'Men'}{span ? ` · ${span}` : ''}</div>
          <h1>{t.name}</h1>
          <div className="chips">
            {famComps.slice(0, 6).map((c) => <Link key={c[0]} className="tag" to={`/league/${c[0]}`}>{c[1]} <span className="mono muted">{c[2]}</span></Link>)}
          </div>
        </div>
        {fams.length > 1 && <Seg label="Format" value={fam} onChange={setFam} options={fams.map((k) => [k, FAM_LABEL[k] ?? k])} />}
      </section>

      <Board key={fam} plate={`${t.name} · ${FAM_LABEL[fam]} record`}
        foot={form.length > 0 ? <span className="row" style={{ gap: 10 }}>FORM
          <span className="form board-form">{form.map((x: any) => <Link key={x[5]} to={`/match/${x[5]}`} className={x[3] === 'W' ? 'W' : x[3] === 'L' ? 'L' : 'D'} title={`${dateShort(x[0])} v ${x[2]}: ${x[3]} ${x[4] ?? ''}`}>{x[3]}</Link>)}</span>
          <small style={{ color: 'var(--board-dim)' }}>oldest → latest</small></span> : undefined}>
        <div className="sb-grid">
          <SbCell label="Played" value={n0(f.p)} sub={span} delay={0} />
          <SbCell label="Won" value={n0(f.w)} sub={`${n0(famRow.l)} lost`} delay={140} />
          <SbCell label="Win %" value={pct(f.w / Math.max(1, f.w + famRow.l), 0)} sub="decided matches" tone="up" delay={280} />
          <SbCell label="Bat first" value={pct(f.bf_w / Math.max(1, f.bf_p), 0)} sub={`won ${f.bf_w} of ${f.bf_p}`} delay={420} />
          <SbCell label="Chasing" value={pct(f.ch_w / Math.max(1, f.ch_p), 0)} sub={`won ${f.ch_w} of ${f.ch_p}`} delay={560} />
          <SbCell label="Won toss, won" value={pct(f.toss_won_match / Math.max(1, f.toss_w), 0)} sub={`chose to bat ${pct(f.toss_bat / Math.max(1, f.toss_w), 0)}`} delay={700} />
        </div>
      </Board>

      <SectionHead title="Results over time" />
      <div className="grid wide-l">
        <Panel title="Season by season" sub={sm === 'win' ? 'Win % of decided matches, smoothed over three seasons.' : sm === 'rr' ? 'Runs per over, batting and bowling.' : 'Runs per wicket, batting and bowling.'}
          tools={<>
            <Mini label="Show" value={sm} onChange={setSm} options={[['win', 'Win %'], ['rr', 'Run rate'], ['rpw', 'Runs/wkt']]} />
            <MiniSelect label="In" value={comp} onChange={setComp} options={famComps.map((c) => [c[0], c[1]] as [string, string])} />
          </>}>
          {sm !== 'win' && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
          {seasons.length > 1 ? <LineChart key={sm + comp} aria="By season" labels={sLabels} refLine={sm === 'win' ? 50 : undefined} yMin={sm === 'win' ? 0 : undefined} yMax={sm === 'win' ? 100 : undefined}
            fmt={sm === 'win' ? (v) => `${Math.round(v)}%` : d1} series={series} height={250} />
            : <div className="empty">Needs at least two seasons in this competition.</div>}
        </Panel>
        <Panel flush title="Head to head" sub="All formats."
          tools={<>
            <Mini label="Min" value={hmin} onChange={setHmin} options={[['2', '2'], ['10', '10'], ['25', '25']]} />
            <Mini label="Sort" value={hsort} onChange={setHsort} options={[['p', 'Played'], ['wp', 'Win %']]} />
          </>}>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {h2h.slice(0, 25).map((x: any) => (
              <div key={x[0]} className="list-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 110px 48px' }}>
                <span className="t" style={{ fontWeight: 500 }}>{x[0]}<div className="m">{x[1]} played · {x[2]}–{x[3]}</div></span>
                <div className="wl-bar" title={`${x[2]} won, ${x[3]} lost`}><i style={{ width: `${(100 * x[2]) / x[1]}%`, background: 'var(--accent)' }} /><i style={{ width: `${(100 * (x[1] - x[2] - x[3])) / x[1]}%`, background: 'var(--line-2)' }} /><i style={{ width: `${(100 * x[3]) / x[1]}%`, background: 'var(--red)' }} /></div>
                <span className="v">{pct(x[2] / Math.max(1, x[2] + x[3]), 0)}</span>
              </div>
            ))}
            {!h2h.length && <div className="empty">No opponents with that many matches.</div>}
          </div>
        </Panel>
      </div>

      <SectionHead title="How they play" sub={`${FAM_LABEL[fam]} cricket, ball by ball.`} />
      <div className="grid g2">
        {ph.length === 3 && (
          <Panel title="By phase" sub={pm === 'rr' ? 'Runs per over scored (left) and conceded (right).' : 'Balls per wicket lost (left) and taken (right).'}
            tools={<Mini label="Show" value={pm} onChange={setPm} options={[['rr', 'Run rate'], ['bpw', 'Balls per wicket']]} />}>
            <Butterfly key={pm} fmt={pm === 'rr' ? d2 : d1} left={{ name: 'Batting', color: 'var(--s1)' }} right={{ name: 'Bowling', color: 'var(--s2)' }}
              rows={ph.map((x) => ({ label: phN[x[0]].split(' (')[0], a: pm === 'rr' ? (bpo * x[1]) / x[2] : x[2] / Math.max(1, x[3]), b: pm === 'rr' ? (bpo * x[4]) / x[5] : x[5] / Math.max(1, x[6]) }))} />
            <div className="muted" style={{ fontSize: 12 }}>{phN.join(' · ')}</div>
          </Panel>
        )}
        <Panel title="Batting order" sub={posM === 'avg' ? 'Average by position.' : posM === 'sr' ? 'Strike rate by position.' : 'Share of all runs scored.'}
          tools={<Mini label="Show" value={posM} onChange={setPosM} options={[['avg', 'Average'], ['sr', 'Strike rate'], ['share', 'Share']]} />}>
          <Columns key={posM} aria="By batting position" fmt={posM === 'share' ? (v) => `${v.toFixed(0)}%` : d1} highlightMax height={210}
            data={pos.map((x) => ({ label: x[0] >= 11 ? '11' : String(x[0]), title: POS(String(Math.min(9, x[0]))).replace('9+', String(x[0])),
              value: posM === 'avg' ? x[1] / Math.max(1, x[3]) : posM === 'sr' ? (100 * x[1]) / Math.max(1, x[2]) : (100 * x[1]) / Math.max(1, posTot),
              extra: [{ label: 'Runs', value: n0(x[1]) }, { label: 'Innings', value: n0(x[4]) }, { label: 'Outs', value: n0(x[3]) }] }))} />
        </Panel>
      </div>
      <div className="grid g3">
        <Panel title="Batting v pace and spin" sub="Strike rate against each. The dark line is their overall strike rate.">
          <HBars fmt={d1} refLabel="overall" base={(100 * vs.reduce((a, x) => a + x[1], 0)) / Math.max(1, vs.reduce((a, x) => a + x[2], 0))} rows={vs.map((x) => ({ label: `v ${x[0]}`, value: (100 * x[1]) / Math.max(1, x[2]), note: `avg ${d1(x[1] / Math.max(1, x[3]))} · ${n0(x[1])} runs` }))} />
        </Panel>
        <Panel title="Their attack" sub="Where the wickets come from.">
          <div className="stackbar" aria-hidden="true">{att.map((x, n) => <i key={x[0]} style={{ width: `${(100 * x[1]) / Math.max(1, attW)}%`, background: n ? 'var(--s2)' : 'var(--s1)' }} />)}</div>
          <div className="stack" style={{ gap: 8 }}>
            {att.map((x, n) => (
              <div key={x[0]} className="kv">
                <span className="row" style={{ gap: 8 }}><i className="key-box" style={{ background: n ? 'var(--s2)' : 'var(--s1)' }} />{pretty(x[0])}: {pct(x[1] / Math.max(1, attW), 0)} of wickets</span>
                <b>econ {d2((6 * x[3]) / Math.max(1, x[2]))} · SR {d1(x[2] / Math.max(1, x[1]))}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="How their batters get out" sub={`${n0(howTot)} dismissals.`}>
          <HBars base={0} refLabel="zero" fmt={(v) => `${(v * 100).toFixed(0)}%`} max={Math.max(0.05, ...how.map((x) => x[1] / Math.max(1, howTot))) * 1.1}
            rows={how.map((x) => ({ label: DCAT[x[0]] ?? x[0], value: x[1] / Math.max(1, howTot), note: `${n0(x[1])}` }))} />
        </Panel>
      </div>

      <SectionHead title="People" />
      <Panel flush title={lb === 'bat' ? 'Top batters by impact' : lb === 'bowl' ? 'Top bowlers by impact' : 'Most appearances'}
        sub={lb === 'caps' ? `${FAM_LABEL[fam]} matches played for ${t.name}.` : 'Runs added for this team above an average player in the same situations.'}
        tools={<Mini label="List" value={lb} onChange={setLb} options={[['bat', 'Batting'], ['bowl', 'Bowling'], ['caps', 'Appearances']]} />}>
        <div className="grid g2" style={{ gap: 0 }}>
          <RankList key={lb} unit={lb === 'caps' ? 'matches' : 'runs of impact'}
            rows={(lb === 'bat' ? t.top_bat?.[fam] ?? [] : lb === 'bowl' ? t.top_bowl?.[fam] ?? [] : t.caps?.[fam] ?? []).slice(0, 8).map((x: any) => ({
              id: x[0], name: x[1], href: `/player/${x[0]}`,
              value: lb === 'caps' ? x[2] : x[4], text: lb === 'caps' ? n0(x[2]) : signed(x[4], 0),
              meta: lb === 'bat' ? `${n0(x[2])} runs · avg ${d1(x[2] / Math.max(1, x[6]))} · SR ${d1((100 * x[2]) / Math.max(1, x[3]))}`
                : lb === 'bowl' ? `${n0(x[2])} wkts · econ ${d2((6 * x[6]) / Math.max(1, x[3]))} · avg ${d1(x[6] / Math.max(1, x[2]))}` : `${x[3]}–${x[4]}` }))} />
          <Table key={'t' + lb} rank limit={15} rows={(lb === 'bat' ? t.top_bat?.[fam] ?? [] : lb === 'bowl' ? t.top_bowl?.[fam] ?? [] : t.caps?.[fam] ?? [])} cols={lb === 'bat' ? [
            { key: 'n', label: 'Batter', left: true, sortable: false, get: (x: any) => x[1], fmt: (v, x: any) => <Link className="link" to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (x: any) => x[5] }, { key: 'r', label: 'Runs', get: (x: any) => x[2], fmt: n0 },
            { key: 'a', label: 'Avg', get: (x: any) => x[2] / Math.max(1, x[6]), fmt: d1 }, { key: 'sr', label: 'SR', get: (x: any) => (100 * x[2]) / Math.max(1, x[3]), fmt: d1 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[4], fmt: (v) => signed(v, 0) },
          ] : lb === 'bowl' ? [
            { key: 'n', label: 'Bowler', left: true, sortable: false, get: (x: any) => x[1], fmt: (v, x: any) => <Link className="link" to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (x: any) => x[5] }, { key: 'w', label: 'Wkts', get: (x: any) => x[2] },
            { key: 'e', label: 'Econ', get: (x: any) => (6 * x[6]) / Math.max(1, x[3]), fmt: d2 }, { key: 'a', label: 'Avg', get: (x: any) => x[6] / Math.max(1, x[2]), fmt: d1 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[4], fmt: (v) => signed(v, 0) },
          ] : [
            { key: 'n', label: 'Player', left: true, sortable: false, get: (x: any) => x[1], fmt: (v, x: any) => <Link className="link" to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'm', label: 'Matches', get: (x: any) => x[2] }, { key: 's', label: 'Span', get: (x: any) => `${x[3]}–${x[4]}`, sortable: false },
          ]} />
        </div>
      </Panel>

      <SectionHead title="Records" />
      <div className="grid g3">
        <Panel flush title={tot === 'high' ? 'Highest totals' : 'Lowest totals'} tools={<Mini label="Show" value={tot} onChange={setTot} options={[['high', 'Highest'], ['low', 'Lowest']]} />}>
          {totals.map((x) => (
            <Link key={x[0] + x[6]} className="list-row" to={`/match/${x[0]}`}>
              <span className="t" style={{ fontWeight: 500 }}>v {x[1]}<div className="m">{x[5]}{multi ? ` · innings ${x[6]}` : ''}</div></span>
              <span className="v">{x[2]}{x[3] < 10 ? `/${x[3]}` : ''} <small className="muted">({Math.floor(x[4] / 6)}.{x[4] % 6} ov)</small></span>
            </Link>
          ))}
          {!totals.length && <div className="empty">No totals yet.</div>}
        </Panel>
        <Panel flush title="Biggest wins" tools={<Mini label="By" value={bw} onChange={setBw} options={[['runs', 'Runs'], ['wkts', 'Wickets']]} />}>
          {wins.map((x) => (
            <Link key={x[0]} className="list-row" to={`/match/${x[0]}`}>
              <span className="t" style={{ fontWeight: 500 }}>v {x[1]}<div className="m">{dateShort(x[2])}</div></span>
              <span className="v">{x[3]} {bw === 'runs' ? 'runs' : 'wkts'}</span>
            </Link>
          ))}
          {!wins.length && <div className="empty">No wins yet.</div>}
        </Panel>
        <Panel flush title="Venues" sub="Where they play most." tools={<Mini label="Min" value={vmin} onChange={setVmin} options={[['3', '3'], ['10', '10']]} />}>
          {venues.slice(0, 10).map((v) => (
            <div key={v[0]} className="list-row" style={{ gridTemplateColumns: 'minmax(0,1fr) 80px 44px' }}>
              <span className="t" style={{ fontWeight: 500 }}>{v[0]}<div className="m">{v[1] ?? ''} · {v[2]} played</div></span>
              <div className="wl-bar"><i style={{ width: `${(100 * v[3]) / v[2]}%`, background: 'var(--accent)' }} /><i style={{ width: `${(100 * (v[2] - v[3] - v[4])) / v[2]}%`, background: 'var(--line-2)' }} /><i style={{ width: `${(100 * v[4]) / v[2]}%`, background: 'var(--red)' }} /></div>
              <span className="v">{pct(v[3] / Math.max(1, v[3] + v[4]), 0)}</span>
            </div>
          ))}
          {!venues.length && <div className="empty">No venue with that many matches.</div>}
        </Panel>
      </div>

      <div className="grid wide-l">
        <Panel flush title="Recent results" tools={<Mini label="Result" value={rres} onChange={setRres} options={[['all', 'All'], ['W', 'Wins'], ['L', 'Losses']]} />}>
          <Table rows={recent} limit={12} empty="No results with these filters." cols={[
            { key: 'd', label: 'Date', left: true, get: (x: any) => x[0], fmt: (v, x: any) => <Link className="link" to={`/match/${x[5]}`}>{dateShort(v)}</Link> },
            { key: 'o', label: 'Opponent', left: true, get: (x: any) => x[2] },
            { key: 'c', label: 'Competition', left: true, get: (x: any) => compsAll.find((c) => c[0] === x[1])?.[1] ?? x[1] },
            { key: 'res', label: 'Result', get: (x: any) => x[3], fmt: (v) => <span className={`tag ${v === 'W' ? 'accent' : v === 'L' ? 'red' : ''}`}>{v}</span> },
            { key: 'm', label: 'Margin', get: (x: any) => x[4] },
          ]} />
        </Panel>
        <Panel flush title="All competitions" sub="Every format.">
          <Table rows={compsAll} sort="p" limit={10} cols={[
            { key: 'n', label: 'Competition', left: true, get: (c: any) => c[1], fmt: (v, c: any) => <Link className="link" to={`/league/${c[0]}`}>{v}</Link> },
            { key: 'p', label: 'P', get: (c: any) => c[2] }, { key: 'w', label: 'W', get: (c: any) => c[3] }, { key: 'l', label: 'L', get: (c: any) => c[4] },
            { key: 'wp', label: 'Win %', get: (c: any) => c[3] / Math.max(1, c[3] + c[4]), fmt: (v) => pct(v, 0) },
          ]} />
        </Panel>
      </div>
      {vs.length === 0 && <div className="muted" style={{ fontSize: 12 }}>Bowling-style data is missing for some players, so pace and spin splits can be incomplete. {BGRP.unknown}.</div>}
    </>
  );
}
