// The player's career across every format: a strip of format tiles that also works as the format filter,
// and an "All formats" view that sets the formats side by side.
import { useMemo, useState } from 'react';
import { bat, bowl } from '../lib/stats';
import { d1, d2, n0 } from '../lib/fmt';
import { FAM_LABEL } from '../lib/labels';
import { Mini, Panel } from './ui';
import { LineChart } from './charts';
import { Board, SbCell } from './Scoreboard';

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

/** One tile per format plus "All formats". Picking a tile changes the format the rest of the page shows. */
export function FormatStrip({ p, fks, fk, setFk }: { p: any; fks: string[]; fk: string; setFk: (k: string) => void }) {
  const list = sortFks(fks);
  const tot = list.reduce((a, k) => { const s = p.summary[k]; a.r += s.bat?.r ?? 0; a.w += s.bowl?.w ?? 0; a.i += Math.max(s.bat?.i ?? 0, s.bowl?.i ?? 0); return a; }, { r: 0, w: 0, i: 0 });
  return (
    <div className="fmt-strip" role="tablist" aria-label="Format">
      <button type="button" role="tab" aria-selected={fk === 'all'} className="fs-tile all" onClick={() => setFk('all')}>
        <span className="fs-name">All formats</span>
        <span className="fs-big">{n0(tot.r)}<small> runs</small></span>
        <span className="fs-line">{n0(tot.w)} wkts · {list.length} formats</span>
      </button>
      {list.map((k) => {
        const s = p.summary[k], b = s.bat?.b ? bat(s.bat) : null, w = s.bowl?.b ? bowl(s.bowl) : null;
        const mainBowl = (s.bowl?.b ?? 0) > (s.bat?.b ?? 0) * 1.2;
        const intl = intlOf(p, k);
        const intlN = Math.max(intl?.bat?.i ?? 0, intl?.bowl?.i ?? 0);
        return (
          <button key={k} type="button" role="tab" aria-selected={fk === k} className="fs-tile" onClick={() => setFk(k)}>
            <span className="fs-name">{fkLabel(k)}</span>
            {mainBowl && w ? <span className="fs-big">{n0(w.w)}<small> wkts</small></span> : <span className="fs-big">{n0(b?.r ?? 0)}<small> runs</small></span>}
            <span className="fs-line">{mainBowl && w ? `avg ${d1(w.avg)} · econ ${d2(w.econ)}` : b ? `avg ${d1(b.avg)} · SR ${d1(b.sr)}` : '–'}</span>
            {intlN > 0 && INTL_LABEL[k.split('-')[0]] && <span className="fs-intl">{intlN} inns in {INTL_LABEL[k.split('-')[0]]}</span>}
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
                      <td>{b ? b.c100 ?? 0 : '–'}</td><td>{b ? b.hs ?? '–' : '–'}</td>
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
