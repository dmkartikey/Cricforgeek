import { useEffect, useMemo, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link, useSearchParams } from 'react-router-dom';
import { load, useData } from '../lib/data';
import { fullName, searchPlayers, type PlayerRow } from '../lib/nameSearch';
import { useSettings } from '../lib/settings';
import { bat, bowl, batSplit, bowlSplit, ok, SplitRow } from '../lib/stats';
import { d1, d2, n0, pct, signed } from '../lib/fmt';
import { FAM_LABEL, MULTI, PHASES } from '../lib/labels';
import { Legend, Mini, MiniSearch, Panel, SectionHead, Seg, SERIES } from '../components/ui';
import { LineChart, MultiBars, Scatter } from '../components/charts';
import { PitchMap } from '../components/PitchMap';

type P = any;

function sumRows(rows: SplitRow[]) {
  const out = Array(11).fill(0) as number[];
  for (const r of rows) for (let k = 1; k < r.length; k++) out[k] += (r[k] as number) ?? 0;
  return ['all', ...out.slice(1)] as SplitRow;
}

function Picker({ onPick, exclude }: { onPick: (id: string) => void; exclude: string[] }) {
  const s = useSettings();
  const idx = useData<any>('search.json').data;
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    if (!idx || q.trim().length < 2) return [];
    return searchPlayers(idx.players, q, 8, (p: PlayerRow) => p[3] === s.gender && !exclude.includes(p[0]));
  }, [idx, q, s.gender, exclude]);
  return (
    <div className="stack" style={{ gap: 6, position: 'relative' }}>
      <MiniSearch value={q} onChange={setQ} placeholder="Add a player" />
      {hits.length > 0 && (
        <div className="search-pop" style={{ top: 34, width: '100%' }}>
          {hits.map((p: any) => (
            <a key={p[0]} href="#" onClick={(e) => { e.preventDefault(); onPick(p[0]); setQ(''); }}><span>{fullName(p) || p[1]}</span><small>{p[1]} · {p[4]} · {p[5]}–{p[6]}</small></a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Compare() {
  usePageMeta('Compare players');
  const s = useSettings();
  const [sp, setSp] = useSearchParams();
  const ids = (sp.get('p') ?? '').split(',').filter(Boolean).slice(0, 4);
  const [players, setPlayers] = useState<Record<string, P>>({});
  const [role, setRole] = useState<'bat' | 'bowl'>((sp.get('r') as any) === 'bowl' ? 'bowl' : 'bat');
  const [mode, setMode] = useState<'career' | 'same'>('career');
  const [lm, setLm] = useState<string>('avg');
  const [cum, setCum] = useState<'year' | 'cum'>('year');
  const meta = useData<any>('meta.json').data;
  const zbase = useData<any>('zbase.json').data;
  const fk = `${s.fmt}-${s.gender}`;
  const multi = MULTI(s.fmt);

  useEffect(() => {
    for (const id of ids) if (!players[id]) load<P>(`players/${id}.json`).then((p) => setPlayers((o) => ({ ...o, [id]: p }))).catch(() => null);
  }, [ids.join()]); // eslint-disable-line
  const setIds = (next: string[]) => { const n = new URLSearchParams(sp); n.set('p', next.join(',')); setSp(n, { replace: true }); };

  const list = ids.map((id, i) => ({ id, p: players[id], color: SERIES[i] })).filter((x) => x.p);
  const has = list.filter((x) => (x.p.summary?.[fk]?.[role]?.b ?? 0) > 0);
  const missing = list.filter((x) => !has.includes(x));

  // years every selected player was active in (for same-period mode)
  const yearRows = (p: P) => (p.splits?.[fk]?.[role]?.year ?? []) as SplitRow[];
  const common = useMemo(() => {
    if (has.length < 2) return null;
    const sets = has.map((x) => new Set(yearRows(x.p).filter((r) => (r[1] as number) >= 30).map((r) => String(r[0]))));
    return [...sets[0]].filter((y) => sets.every((st) => st.has(y))).sort();
  }, [has.map((x) => x.id).join(), fk, role]); // eslint-disable-line
  const same = mode === 'same' && common && common.length > 0;

  const summary = (p: P) => {
    if (same) {
      const rows = yearRows(p).filter((r) => common!.includes(String(r[0])));
      const agg = sumRows(rows);
      return role === 'bat' ? batSplit(agg) : bowlSplit(agg);
    }
    return role === 'bat' ? bat(p.summary[fk].bat) : bowl(p.summary[fk].bowl);
  };
  const sums = has.map((x) => ({ ...x, s: summary(x.p) as any }));

  const METRICS: [string, string, (v: number) => string, boolean][] = role === 'bat'
    ? [['r', 'Runs', n0, true], ['b', 'Balls', n0, true], ['avg', 'Average', d2, true], ['sr', 'Strike rate', d1, true], ['bpd', 'Balls per dismissal', d1, true],
       ['rae', 'Runs above average', (v) => signed(v, 0), true], ['imp', 'Impact', (v) => signed(v, 0), true], ['imp100', 'Impact / 100 balls', (v) => signed(v, 2), true],
       ...(!multi ? [['wpa', 'Win prob. added', (v: number) => signed(v, 2), true] as [string, string, (v: number) => string, boolean]] : []),
       ['bnd', 'Boundary %', (v) => pct(v), true], ['dotp', 'Dot %', (v) => pct(v), false]]
    : [['w', 'Wickets', n0, true], ['b', 'Balls', n0, true], ['econ', 'Economy', d2, false], ['avg', 'Average', d1, false], ['sr', 'Strike rate', d1, false],
       ['saved', 'Runs saved v average', (v) => signed(v, 0), true], ['imp', 'Impact', (v) => signed(v, 0), true],
       ['imp100', 'Impact / 100 balls', (v) => signed(v, 2), true], ['dotp', 'Dot %', (v) => pct(v), true]];

  // yearly overlay
  const LM: Record<string, [string, (v: number) => string, (y: any) => number | null, number?]> = role === 'bat'
    ? { avg: ['Average', d1, (y) => (y.o >= 3 ? y.avg : null)], sr: ['Strike rate', d1, (y) => (y.b >= 60 ? y.sr : null)], r: ['Runs', n0, (y) => y.r], imp: ['Impact', (v) => signed(v, 0), (y) => y.imp] }
    : { econ: ['Economy', d2, (y) => (y.b >= 60 ? y.econ : null)], avg: ['Average', d1, (y) => (y.b >= 120 && y.w >= 2 ? y.avg : null)], w: ['Wickets', n0, (y) => y.w], imp: ['Impact', (v) => signed(v, 0), (y) => y.imp] };
  const lmKey = LM[lm] ? lm : Object.keys(LM)[0];
  const yearsAll = [...new Set(has.flatMap((x) => yearRows(x.p).map((r) => String(r[0]))))].filter((y) => !same || common!.includes(y)).sort();
  const lines = has.map((x) => {
    const m = new Map(yearRows(x.p).map((r) => [String(r[0]), role === 'bat' ? batSplit(r) : bowlSplit(r)]));
    let run = 0;
    // a year with few balls is drawn as a hollow ring: too small a sample to read as a trend
    const weak = yearsAll.map((y) => { const v: any = m.get(y); return !!v && (role === 'bat' ? (v.b ?? 0) < 150 : (v.b ?? 0) < 120); });
    return { name: x.p.name, color: x.color, weak: cum === 'cum' ? undefined : weak, values: yearsAll.map((y) => {
      const v = m.get(y); const val = v ? LM[lmKey][2](v) : null;
      if (cum === 'cum' && (lmKey === 'r' || lmKey === 'w' || lmKey === 'imp')) { run += (v ? (LM[lmKey][2](v) ?? 0) : 0); return run; }
      return val;
    }) };
  });

  // phase bars
  const phN = PHASES[s.fmt] ?? PHASES.T20;
  const phaseVal = (p: P, k: string) => {
    const row = (p.splits?.[fk]?.[role]?.phase ?? []).find((r: SplitRow) => String(r[0]) === k);
    if (!row || (row[1] as number) < 24) return null;
    return role === 'bat' ? batSplit(row).sr : bowlSplit(row).econ;
  };
  // pace v spin scatter
  const typeVal = (p: P, t: string) => {
    const rows: SplitRow[] = role === 'bat' ? (p.splits?.[fk]?.bat?.type ?? []) : [];
    const row = rows.find((r) => r[0] === t);
    return row && (row[1] as number) >= 60 ? batSplit(row).sr : NaN;
  };
  // common opponents
  const oppKey = role === 'bat' ? (r: any) => ({ k: r[0], i: r[1], a: r[4] ? r[2] / r[4] : NaN, sr: r[3] ? (100 * r[2]) / r[3] : NaN, n: r[2] })
    : (r: any) => ({ k: r[0], i: r[1], a: r[2] ? r[4] / r[2] : NaN, sr: r[3] ? (6 * r[4]) / r[3] : NaN, n: r[2] });
  const opps = has.map((x) => new Map(((x.p.splits?.[fk]?.[role]?.opp ?? []) as any[]).map((r) => [r[0], oppKey(r)])));
  const commonOpp = has.length >= 2 ? [...opps[0].keys()].filter((k) => opps.every((m) => (m.get(k)?.i ?? 0) >= 2)) : [];
  commonOpp.sort((a, b) => opps.reduce((t, m) => t + (m.get(b)?.i ?? 0), 0) - opps.reduce((t, m) => t + (m.get(a)?.i ?? 0), 0));

  const cfg = meta?.zones, zb = zbase?.[fk];

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Compare · {FAM_LABEL[s.fmt]} · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Player comparison</h1>
          <p className="lede">Up to four players, overlaid on the same charts. Same-period mode keeps only the years when all of them were playing, so eras do not flatter anyone.</p>
        </div>
        <div className="row">
          <Seg label="Discipline" value={role} onChange={setRole} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />
          <Seg label="Period" value={mode} onChange={setMode} options={[['career', 'Whole careers'], ['same', 'Same years']]} />
        </div>
      </section>

      <div className="cmp-slots">
        {ids.map((id, i) => {
          const p = players[id];
          const sm = p?.summary?.[fk]?.[role];
          return (
            <div key={id} className="cmp-slot fade-in" style={{ ['--c' as string]: SERIES[i] }}>
              <button type="button" className="icon-btn x" aria-label="Remove" onClick={() => setIds(ids.filter((x) => x !== id))}>×</button>
              <Link className="t" to={`/player/${id}`}>{p?.name ?? '…'}</Link>
              <span className="muted" style={{ fontSize: 12 }}>{p?.teams?.[0]?.[0] ?? ''}</span>
              <span className="mono" style={{ fontSize: 12 }}>{sm ? (role === 'bat' ? `${n0(sm.r)} runs · ${n0(sm.b)} balls` : `${n0(sm.w)} wkts · ${n0(sm.b)} balls`) : p ? `No ${FAM_LABEL[s.fmt]} ${role === 'bat' ? 'batting' : 'bowling'}` : ''}</span>
            </div>
          );
        })}
        {ids.length < 4 && (
          <div className="cmp-slot add"><span className="eyebrow">Add player {ids.length + 1}</span><Picker exclude={ids} onPick={(id) => setIds([...ids, id])} /></div>
        )}
      </div>

      {ids.length === 0 && (
        <div className="notice info">Search for a player above to start. Try <Link className="link" to="/compare?p=ba607b88,740742ef">Kohli and Rohit Sharma</Link>{' '}
          or <Link className="link" to="/compare?p=462411b3,9d430b40&r=bowl">Bumrah and Narine</Link>.</div>
      )}
      {missing.length > 0 && <div className="notice">{missing.map((x) => x.p.name).join(', ')} {missing.length > 1 ? 'have' : 'has'} no {FAM_LABEL[s.fmt]} {role === 'bat' ? 'batting' : 'bowling'} in the data. Change the format in the sidebar.</div>}
      {mode === 'same' && has.length >= 2 && (!common || !common.length) && <div className="notice">These players never shared a season with 30+ balls each, so this shows whole careers.</div>}
      {same && <div className="notice info">Same years: {common![0]}–{common![common!.length - 1]} ({common!.length} seasons). Summary, table and yearly chart use only those years. Phase, pace/spin and pitch maps cover whole careers.</div>}

      {has.length >= 1 && (
        <>
          <Panel flush title="Head to head numbers" sub={same ? 'Shared seasons only.' : 'Whole careers in this format.'}>
            <div className="tbl-wrap">
              <table className="tbl cmp-table">
                <thead><tr><th scope="col">Metric</th>{sums.map((x) => <th key={x.id} scope="col" style={{ color: x.color }}>{x.p.name}</th>)}</tr></thead>
                <tbody>
                  {METRICS.map(([k, label, f, hi]) => {
                    const vals = sums.map((x) => x.s[k]).filter(ok) as number[];
                    const best = vals.length > 1 ? (hi ? Math.max(...vals) : Math.min(...vals)) : NaN;
                    return (
                      <tr key={k}><td>{label}</td>{sums.map((x) => <td key={x.id}><span className={x.s[k] === best && k !== 'b' ? 'lead' : ''}>{ok(x.s[k]) ? f(x.s[k]) : '–'}</span></td>)}</tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="panel-foot">Green marks the best value in each row.</div>
          </Panel>

          <Panel title="Year by year" sub={LM[lmKey][0]}
            tools={<>
              <Mini label="Metric" value={lmKey} onChange={setLm} options={Object.entries(LM).map(([k, v]) => [k, v[0]] as [string, string])} />
              {['r', 'w', 'imp'].includes(lmKey) && <Mini label="As" value={cum} onChange={setCum} options={[['year', 'Per year'], ['cum', 'Running total']]} />}
            </>}>
            <Legend items={lines.map((l) => ({ label: l.name, color: l.color }))} />
            <LineChart key={lmKey + cum + role + mode} aria="Comparison by year" labels={yearsAll} series={lines} fmt={LM[lmKey][1]} height={280} />
            {cum !== 'cum' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Hollow rings mark years with too few balls to rely on.</div>}
          </Panel>

          <div className="grid g2">
            <Panel title="By phase" sub={role === 'bat' ? 'Strike rate in each phase.' : 'Economy in each phase. Lower is better.'}>
              <Legend items={has.map((x) => ({ label: x.p.name, color: x.color, kind: 'box' }))} />
              <MultiBars fmt={role === 'bat' ? d1 : d2} series={has.map((x) => ({ name: x.p.name, color: x.color }))}
                rows={['0', '1', '2'].map((k) => ({ label: phN[+k].split(' (')[0], note: phN[+k].match(/\((.*)\)/)?.[1], values: has.map((x) => phaseVal(x.p, k)) }))} />
            </Panel>
            {role === 'bat' ? (
              <Panel title="Pace v spin" sub="Strike rate against each. Above the dashed line = quicker against spin; below = quicker against pace.">
                <Scatter aria="Strike rate against pace and spin" xLabel="Strike rate v pace" yLabel="Strike rate v spin" fmtX={n0} fmtY={n0} minSpan={30} diagonal="Same against both"
                  points={has.map((x) => ({ label: x.p.name, x: typeVal(x.p, 'pace'), y: typeVal(x.p, 'spin'), color: x.color }))} />
              </Panel>
            ) : (
              <Panel title="Right- and left-handers" sub="Economy against each hand. Lower is better.">
                <MultiBars fmt={d2} series={has.map((x) => ({ name: x.p.name, color: x.color }))}
                  rows={[['R', 'v right-handers'], ['L', 'v left-handers']].map(([k, l]) => ({ label: l, values: has.map((x) => {
                    const r = (x.p.splits?.[fk]?.bowl?.hand ?? []).find((q: SplitRow) => q[0] === k);
                    return r && r[1] >= 24 ? bowlSplit(r).econ : null; }) }))} />
              </Panel>
            )}
          </div>

          {cfg && zb && (
            <>
              <SectionHead title="Pitch maps side by side" sub="Inferred zones. Each map has its own filters." />
              <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${has.length > 2 ? 300 : 380}px), 1fr))` }}>
                {has.map((x) => {
                  const z = x.p.zc?.[fk]?.[role];
                  return (
                    <Panel key={x.id} title={<span style={{ color: x.color }}>{x.p.name}</span>}>
                      {z && Object.keys(z).length ? <PitchMap compact role={role} zc={z} base={role === 'bat' ? zb.bat : zb.bowl} cfg={cfg} fam={s.fmt} hand={x.p.bat} btype={x.p.btype} />
                        : <div className="empty">Not enough balls for a pitch map.</div>}
                    </Panel>
                  );
                })}
              </div>
            </>
          )}

          {commonOpp.length > 0 && (
            <Panel flush title="Against the same opponents" sub={role === 'bat' ? 'Average and strike rate against teams they have all faced at least twice.' : 'Average and economy against teams they have all bowled at at least twice.'}>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th scope="col">Opponent</th>{has.map((x) => <th key={x.id} scope="col" style={{ color: x.color }}>{x.p.name}</th>)}</tr></thead>
                  <tbody>
                    {commonOpp.slice(0, 12).map((k) => (
                      <tr key={k}><td>{k}</td>{opps.map((m, i) => { const v = m.get(k)!; return <td key={i}>{d1(v.a)} <span className="muted">· {role === 'bat' ? `SR ${d1(v.sr)}` : `econ ${d2(v.sr)}`} · {v.i} inns</span></td>; })}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
