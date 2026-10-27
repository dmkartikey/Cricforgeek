// The player's career across every format: a strip of format tiles that also works as the format filter,
// and an "All formats" view that sets the formats side by side.
import { useMemo, useState } from 'react';
import { bat, bowl } from '../lib/stats';
import { d1, d2, n0 } from '../lib/fmt';
import { FAM_LABEL } from '../lib/labels';
import { Mini, Panel } from './ui';
import { LineChart } from './charts';
import { Board, SbCell } from './Scoreboard';
import { weightedRating } from '../lib/card';

const ORDER = ['TEST', 'ODI', 'T20', 'FC', 'LA', 'HUN'];
const INTL: Record<string, string> = { TEST: 'test', ODI: 'odi', T20: 't20i' };
const INTL_LABEL: Record<string, string> = { TEST: 'Tests', ODI: 'ODIs', T20: 'T20Is' };
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--gold)', 'var(--neutral)'];

export const fkLabel = (fk: string) => {
  const [f, g] = fk.split('-');
  return `${g === 'female' ? "Women's " : ''}${f === 'T20' ? 'T20' : FAM_LABEL[f] ?? f}`;
};

/** Internationals within a format: summed from the player's competitions. */
function intlOf(p: any, fk: string) {
  const [f, g] = fk.split('-');
  const key = INTL[f];
  if (!key) return null;
  const c = (p.comps ?? []).find((x: any) => x.comp === `${g === 'female' ? 'women' : 'men'}-${key}`);
  return c ? { bat: c.bat, bowl: c.bowl } : null;
}

export function sortFks(fks: string[]) {
  return [...fks].sort((a, b) => ORDER.indexOf(a.split('-')[0]) - ORDER.indexOf(b.split('-')[0]) || a.localeCompare(b));
}

// Runs (or wickets) by year in one format, oldest first.
function yearSeries(p: any, k: string, kind: 'bat' | 'bowl') {
  const rows: any[] = p.splits?.[k]?.[kind]?.year ?? [];
  return rows.map((r) => [String(r[0]), kind === 'bat' ? r[2] : r[3]] as [string, number]).sort((x, y) => x[0].localeCompare(y[0]));
}

function Spark({ v }: { v: number[] }) {
  v = v.map((x) => (Number.isFinite(x) ? x : 0));
  if (v.length < 2) return <span className="fs-spark empty" />;
  const top = Math.max(...v), max = Math.max(top, 1), W = 100, H = 24;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 2 - (y / max) * (H - 4)]);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const pk = Math.max(0, v.indexOf(top));
  return (
    <svg className="fs-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="a" d={`${d} L${W},${H} L0,${H} Z`} />
      <path className="l" d={d} vectorEffect="non-scaling-stroke" />
      <circle className="pk" cx={pts[pk][0]} cy={pts[pk][1]} r="1.8" />
    </svg>
  );
}

const ballOf = (f: string) => (f === 'TEST' || f === 'FC' ? 'red' : 'white');

/** One tile per format plus "All formats". Picking a tile changes the format the rest of the page shows. */
export function FormatStrip({ p, fks, fk, setFk }: { p: any; fks: string[]; fk: string; setFk: (k: string) => void }) {
  const list = sortFks(fks);
  const tot = list.reduce((a, k) => { const s = p.summary[k]; a.r += s.bat?.r ?? 0; a.w += s.bowl?.w ?? 0; a.bb += s.bat?.b ?? 0; a.wb += s.bowl?.b ?? 0; return a; }, { r: 0, w: 0, bb: 0, wb: 0 });
  const bowler = tot.wb > tot.bb * 1.2;
  const yrs = list.flatMap((k) => [...yearSeries(p, k, 'bat'), ...yearSeries(p, k, 'bowl')].map((x) => +x[0]));
  const span = yrs.length ? `${Math.min(...yrs)}–${String(Math.max(...yrs)).slice(2)}` : '';
  const share = list.map((k, i) => ({ k, r: (bowler ? p.summary[k].bowl?.w : p.summary[k].bat?.r) ?? 0, c: COLORS[i % COLORS.length] })).filter((x) => x.r > 0);
  const totMain = bowler ? tot.w : tot.r;
  return (
    <div className="fmt-strip" role="tablist" aria-label="Format">
      <button type="button" role="tab" aria-selected={fk === 'all'} className="fs-tile all" onClick={() => setFk('all')}>
        <span className="fs-top"><span className="fs-ball all" aria-hidden="true"><i /><i /><i /></span><span className="fs-name">All formats</span><span className="fs-span">{span}</span></span>
        <span className="fs-mid"><span className="fs-big">{n0(totMain)}<small>{bowler ? 'wkts' : 'runs'}</small></span></span>
        <span className="fs-stats"><span><i>{bowler ? 'Runs' : 'Wkts'}</i><b>{n0(bowler ? tot.r : tot.w)}</b></span><span><i>Formats</i><b>{list.length}</b></span></span>
        {totMain > 0 && (
          <span className="fs-share" title={share.map((x) => `${fkLabel(x.k)}: ${n0(x.r)}`).join(' · ')}>
            {share.map((x) => <i key={x.k} style={{ width: `${(100 * x.r) / totMain}%`, background: x.c }} />)}
          </span>
        )}
        <span className="fs-foot">{share.slice(0, 3).map((x) => <span key={x.k}><em style={{ background: x.c }} />{fkLabel(x.k)} {Math.round((100 * x.r) / Math.max(totMain, 1))}%</span>)}</span>
      </button>
      {list.map((k) => {
        const s = p.summary[k], b = s.bat?.b ? bat(s.bat) : null, w = s.bowl?.b ? bowl(s.bowl) : null;
        const f = k.split('-')[0];
        const kind: 'bat' | 'bowl' = (s.bowl?.b ?? 0) > (s.bat?.b ?? 0) * 1.2 && w ? 'bowl' : 'bat';
        const ys = yearSeries(p, k, kind);
        const pc = p.pct?.[k]?.[kind];
        const rating = pc ? Math.round(weightedRating(pc, f, kind)) : null;
        const intl = intlOf(p, k);
        const intlN = Math.max(intl?.bat?.i ?? 0, intl?.bowl?.i ?? 0), allN = Math.max(s.bat?.i ?? 0, s.bowl?.i ?? 0);
        const stats: [string, string][] = kind === 'bowl' && w
          ? [['Avg', d1(w.avg)], ['Econ', d2(w.econ)], ['Best', w.w ? w.best ?? '–' : '–']]
          : [['Avg', b ? d1(b.avg) : '–'], ['SR', b ? d1(b.sr) : '–'], ['100s', String(b?.c100 ?? 0)]];
        return (
          <button key={k} type="button" role="tab" aria-selected={fk === k} className="fs-tile" onClick={() => setFk(k)}>
            <span className="fs-top">
              <span className={`fs-ball ${ballOf(f)}`} aria-hidden="true" />
              <span className="fs-name">{fkLabel(k)}</span>
              <span className="fs-span">{ys.length ? `${ys[0][0]}–${ys[ys.length - 1][0].slice(2)}` : ''}</span>
            </span>
            <span className="fs-mid">
              <span className="fs-big">{kind === 'bowl' ? n0(w!.w) : n0(b?.r ?? 0)}<small>{kind === 'bowl' ? 'wkts' : 'runs'}</small></span>
              {rating != null && <span className="fs-rate" title="Rating in this format: a weighted mix of percentiles against every qualified player, as on the card">{rating}</span>}
            </span>
            <span className="fs-stats">{stats.map(([l, v]) => <span key={l}><i>{l}</i><b>{v}</b></span>)}</span>
            <Spark v={ys.map((x) => x[1])} />
            <span className="fs-foot">
              {intlN > 0 && INTL_LABEL[f] ? <><span className="fs-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * intlN) / Math.max(allN, 1))}%` }} /></span>
                {intlN === allN ? `All ${allN} inns in ${INTL_LABEL[f]}` : `${intlN} of ${allN} inns in ${INTL_LABEL[f]}`}</>
                : <>{allN} innings · domestic</>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Every format side by side: totals, a table, runs or wickets by year per format, and percentiles by format. */
export function OverallView({ p, fks, setFk }: { p: any; fks: string[]; setFk: (k: string) => void }) {
  const list = sortFks(fks);
  const [kind, setKind] = useState<'bat' | 'bowl'>(() => {
    const r = list.reduce((a, k) => a + (p.summary[k].bat?.b ?? 0), 0), w = list.reduce((a, k) => a + (p.summary[k].bowl?.b ?? 0), 0);
    return w > r * 1.2 ? 'bowl' : 'bat';
  });
  const sums = list.map((k) => ({ k, s: p.summary[k], b: p.summary[k].bat?.b ? bat(p.summary[k].bat) : null, w: p.summary[k].bowl?.b ? bowl(p.summary[k].bowl) : null, intl: intlOf(p, k) }));
  const T = sums.reduce((a, x) => ({ r: a.r + (x.b?.r ?? 0), w: a.w + (x.w?.w ?? 0), c100: a.c100 + (x.b?.c100 ?? 0), w5: a.w5 + (x.w?.w5 ?? 0),
    ir: a.ir + (x.intl?.bat?.r ?? 0), iw: a.iw + (x.intl?.bowl?.w ?? 0), inns: a.inns + Math.max(x.b?.i ?? 0, x.w?.i ?? 0) }), { r: 0, w: 0, c100: 0, w5: 0, ir: 0, iw: 0, inns: 0 });
  // runs (or wickets) by year in each format
  const chart = useMemo(() => {
    const yrs = new Set<string>();
    const per = list.map((k) => {
      const rows: any[] = p.splits?.[k]?.[kind]?.year ?? [];
      const m = new Map(rows.map((r) => [String(r[0]), kind === 'bat' ? r[2] : r[3]]));
      m.forEach((_, y) => yrs.add(y));
      return { k, m };
    }).filter((x) => x.m.size);
    const labels = [...yrs].sort();
    return { labels, series: per.slice(0, 6).map((x, i) => ({ name: fkLabel(x.k), color: COLORS[i], values: labels.map((y) => (x.m.get(y) as number) ?? null) })) };
  }, [p, kind, list.join()]); // eslint-disable-line
  const PM: [string, string][] = kind === 'bat' ? [['avg', 'Avg'], ['adj', 'Adj avg'], ['sr', 'SR'], ['imp100', 'Impact'], ['bnd', '4s & 6s'], ['dotp', 'Dots']]
    : [['econ', 'Econ'], ['bavg', 'Avg'], ['adj', 'Adj avg'], ['bsr', 'SR'], ['imp100', 'Impact'], ['dotp', 'Dots']];
  const pcs = list.map((k) => ({ k, pc: p.pct?.[k]?.[kind] })).filter((x) => x.pc);
  const heat = (v: number) => `color-mix(in srgb, var(--s1) ${Math.round(12 + (v / 100) * 78)}%, var(--surface))`;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Board plate={`${p.name} · every format`}>
        <div className="sb-grid">
          <SbCell label="Runs" value={n0(T.r)} sub={`${n0(T.ir)} in internationals`} />
          <SbCell label="Wickets" value={n0(T.w)} sub={`${n0(T.iw)} in internationals`} delay={140} />
          <SbCell label="Innings" value={n0(T.inns)} sub="batting or bowling" delay={280} />
          <SbCell label="Hundreds" value={n0(T.c100)} delay={420} />
          <SbCell label="Five-fors" value={n0(T.w5)} delay={560} />
          <SbCell label="Formats" value={String(list.length)} sub={list.map((k) => fkLabel(k)).join(' · ').slice(0, 60)} delay={700} />
        </div>
      </Board>

      <Panel flush title="Format by format" sub="Tap a row to open that format. Internationals are shown under each format where they exist.">
        <div className="tbl-wrap">
          <table className="tbl ov-tbl">
            <thead><tr><th scope="col" className="left">Format</th><th scope="col">Inns</th><th scope="col">Runs</th><th scope="col">Avg</th><th scope="col">SR</th>
              <th scope="col">100s</th><th scope="col">HS</th><th scope="col" className="sep">Wkts</th><th scope="col">Avg</th><th scope="col">Econ</th><th scope="col">Best</th></tr></thead>
            <tbody>
              {sums.flatMap((x) => {
                const row = (label: string, bs: any, ws: any, sub = false) => {
                  const b = bs?.b ? bat(bs) : null, w = ws?.b ? bowl(ws) : null;
                  return (
                    <tr key={x.k + label} className={sub ? 'fr-sub' : 'fr-main'} onClick={() => setFk(x.k)} tabIndex={sub ? -1 : 0} onKeyDown={(e) => { if (e.key === 'Enter') setFk(x.k); }}>
                      <td className="left">{sub ? <span className="muted">↳ {label}</span> : <b>{label}</b>}</td>
                      <td>{n0(b?.i ?? w?.i)}</td><td>{b ? n0(b.r) : '–'}</td><td>{b ? d1(b.avg) : '–'}</td><td>{b ? d1(b.sr) : '–'}</td>
                      <td>{b ? b.c100 ?? 0 : '–'}</td><td>{b ? (b.hs != null ? `${b.hs}${b.hs_no ? '*' : ''}` : '–') : '–'}</td>
                      <td className="sep">{w ? n0(w.w) : '–'}</td><td>{w ? d1(w.avg) : '–'}</td><td>{w ? d2(w.econ) : '–'}</td><td>{w && w.w ? w.best ?? '–' : '–'}</td>
                    </tr>
                  );
                };
                const out = [row(fkLabel(x.k), x.s.bat, x.s.bowl)];
                const f = x.k.split('-')[0];
                if (x.intl && INTL_LABEL[f] && (x.intl.bat?.b ?? 0) + (x.intl.bowl?.b ?? 0) < (x.s.bat?.b ?? 0) + (x.s.bowl?.b ?? 0)) out.push(row(INTL_LABEL[f], x.intl.bat, x.intl.bowl, true));
                return out;
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="bento">
        <Panel className="span-7" title={kind === 'bat' ? 'Runs by year, every format' : 'Wickets by year, every format'} sub="One line per format."
          tools={<Mini label="Show" value={kind} onChange={setKind} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />}>
          {chart.labels.length > 1 ? <LineChart key={kind} aria="By year and format" labels={chart.labels} series={chart.series} fmt={n0} height={240} />
            : <div className="empty">Not enough years yet.</div>}
          <div className="legend" style={{ marginTop: 6 }}>{chart.series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
        </Panel>
        <Panel className="span-5" title="Percentiles by format" sub={`Among qualified ${kind === 'bat' ? 'batters' : 'bowlers'} in each format. Darker = higher.`}>
          {pcs.length ? (
            <div className="heat" style={{ gridTemplateColumns: `minmax(90px, 1.3fr) repeat(${PM.length}, minmax(0, 1fr))` }}>
              <span />{PM.map(([, l]) => <span key={l} className="heat-h">{l}</span>)}
              {pcs.map(({ k, pc }) => [
                <button key={k} type="button" className="heat-r" onClick={() => setFk(k)}>{fkLabel(k)}</button>,
                ...PM.map(([m]) => <span key={k + m} className="heat-c" style={{ background: pc[m] != null ? heat(pc[m]) : 'var(--sunk)' }} title={`${fkLabel(k)} · ${m}: ${pc[m] ?? '–'}`}>{pc[m] ?? '–'}</span>),
              ])}
            </div>
          ) : <div className="empty">Not enough balls in any format to rank yet.</div>}
        </Panel>
      </div>
    </div>
  );
}
