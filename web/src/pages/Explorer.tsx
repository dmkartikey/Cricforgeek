import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PREVIEW, useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { bat, bowl } from '../lib/stats';
import { d1, d2, n0, pct, plus, signed } from '../lib/fmt';
import { famKeyLabel, MULTI } from '../lib/labels';
import { ErrorBox, Loader, Panel, Seg } from '../components/ui';
import { Col, Table } from '../components/Table';

const FKS = ['TEST-male', 'TEST-female', 'ODI-male', 'ODI-female', 'T20-male', 'T20-female', 'FC-male', 'LA-male', 'LA-female', 'HUN-male', 'HUN-female'];
const yearOf = (s: string) => +String(s).slice(0, 4);

export default function Explorer() {
  const st = useSettings();
  const [fk, setFk] = useState(FKS.includes(`${st.fmt}-${st.gender}`) ? `${st.fmt}-${st.gender}` : 'T20-male');
  const [disc, setDisc] = useState<'bat' | 'bowl'>('bat');
  const [by, setBy] = useState<'player' | 'season' | 'comp'>('player');
  const [comps, setComps] = useState<string[]>([]);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(9999);
  const [minB, setMinB] = useState(300);
  const ex = useData<any>(`explorer/${fk}.json`);
  const search = useData<any>('search.json');
  const meta = useData<any>('meta.json').data;
  const names = useMemo(() => new Map<string, string>((search.data?.players ?? []).map((p: any) => [p[0], p[1]])), [search.data]);
  const compLabel = useMemo(() => new Map<string, string>((meta?.comps ?? []).map((c: any) => [c.key, c.label])), [meta]);

  const idx = useMemo(() => Object.fromEntries((ex.data?.cols ?? []).map((c: string, i: number) => [c, i])), [ex.data]);
  const compList = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ex.data?.rows ?? []) m.set(r[1], (m.get(r[1]) ?? 0) + (r[idx.bb] ?? 0) + (r[idx.wb] ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }, [ex.data, idx]);
  const years = useMemo(() => {
    const ys = (ex.data?.rows ?? []).map((r: any) => yearOf(r[2]));
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [2000, 2026];
  }, [ex.data]);

  const rows = useMemo(() => {
    if (!ex.data) return [];
    const agg = new Map<string, any>();
    const p = disc === 'bat' ? 'b' : 'w';
    const keys = disc === 'bat' ? ['bi', 'br', 'bb', 'bo', 'f4', 's6', 'bd', 'bxr', 'bxo', 'bimp', 'bwpa'] : ['wi', 'wb', 'wr', 'ww', 'wd', 'wxr', 'wxw', 'wimp', 'wwpa'];
    for (const r of ex.data.rows) {
      if (comps.length && !comps.includes(r[1])) continue;
      const y = yearOf(r[2]);
      if (y < from || y > to) continue;
      if (r[idx[p === 'b' ? 'bb' : 'wb']] == null) continue;
      const k = by === 'player' ? r[0] : by === 'season' ? `${r[0]}|${r[2]}` : `${r[0]}|${r[1]}`;
      const a = agg.get(k) ?? { player: r[0], season: by === 'season' ? r[2] : '', comp: by === 'comp' ? r[1] : '', ...Object.fromEntries(keys.map((x) => [x, 0])) };
      for (const x of keys) a[x] += r[idx[x]] ?? 0;
      agg.set(k, a);
    }
    const out: any[] = [];
    for (const a of agg.values()) {
      if (disc === 'bat') {
        if (a.bb < minB) continue;
        out.push({ ...a, ...bat({ i: a.bi, r: a.br, b: a.bb, o: a.bo, f4: a.f4, s6: a.s6, d: a.bd, xr: a.bxr, xo: a.bxo, imp: a.bimp, wpa: a.bwpa }) });
      } else {
        if (a.wb < minB) continue;
        out.push({ ...a, ...bowl({ i: a.wi, b: a.wb, r: a.wr, w: a.ww, d: a.wd, xr: a.wxr, xw: a.wxw, imp: a.wimp, wpa: a.wwpa }) });
      }
    }
    return out;
  }, [ex.data, idx, disc, by, comps, from, to, minB]);

  const limited = !MULTI(fk.split('-')[0]);
  const who: Col<any> = { key: 'n', label: 'Player', left: true, get: (x) => names.get(x.player) ?? x.player,
    fmt: (v, x) => <><Link to={`/player/${x.player}`}>{v}</Link>{x.season && <span className="muted"> · {x.season}</span>}{x.comp && <span className="muted"> · {compLabel.get(x.comp) ?? x.comp}</span>}</> };
  const batCols: Col<any>[] = [who,
    { key: 'i', label: 'Inns', get: (x) => x.i }, { key: 'r', label: 'Runs', get: (x) => x.r, fmt: n0 }, { key: 'b', label: 'Balls', get: (x) => x.b, fmt: n0 },
    { key: 'avg', label: 'Avg', get: (x) => x.avg, fmt: d1 }, { key: 'sr', label: 'SR', get: (x) => x.sr, fmt: d1 },
    { key: 'srPlus', label: 'SR+', get: (x) => x.srPlus, fmt: plus, title: 'Strike rate vs expected, 100 = average' },
    { key: 'avgPlus', label: 'Avg+', get: (x) => x.avgPlus, fmt: plus },
    { key: 'imp', label: 'Impact', get: (x) => x.imp, fmt: (v) => signed(v, 0) },
    { key: 'imp100', label: 'Imp/100', get: (x) => x.imp100, fmt: (v) => signed(v, 2) },
    ...(limited ? [{ key: 'wpa', label: 'WPA', get: (x: any) => x.wpa, fmt: (v: any) => signed(v, 2) }] : []),
    { key: 'bnd', label: 'Bdry %', get: (x) => x.bnd, fmt: (v) => pct(v) }, { key: 'dotp', label: 'Dot %', get: (x) => x.dotp, fmt: (v) => pct(v), desc: false }];
  const bowlCols: Col<any>[] = [who,
    { key: 'i', label: 'Inns', get: (x) => x.i }, { key: 'w', label: 'Wkts', get: (x) => x.w }, { key: 'b', label: 'Balls', get: (x) => x.b, fmt: n0 },
    { key: 'econ', label: 'Econ', get: (x) => x.econ, fmt: d2, desc: false }, { key: 'avg', label: 'Avg', get: (x) => x.avg, fmt: d1, desc: false },
    { key: 'econPlus', label: 'Econ+', get: (x) => x.econPlus, fmt: plus }, { key: 'wktPlus', label: 'Wkts+', get: (x) => x.wktPlus, fmt: plus },
    { key: 'imp', label: 'Impact', get: (x) => x.imp, fmt: (v) => signed(v, 0) },
    { key: 'imp100', label: 'Imp/100', get: (x) => x.imp100, fmt: (v) => signed(v, 2) },
    ...(limited ? [{ key: 'wpa', label: 'WPA', get: (x: any) => x.wpa, fmt: (v: any) => signed(v, 2) }] : []),
    { key: 'dotp', label: 'Dot %', get: (x) => x.dotp, fmt: (v) => pct(v) }];
  const cols = disc === 'bat' ? batCols : bowlCols;

  const download = () => {
    const head = ['player', 'name', 'season', 'competition', ...cols.slice(1).map((c) => c.label)];
    const lines = rows.map((r) => [r.player, names.get(r.player) ?? '', r.season, r.comp, ...cols.slice(1).map((c) => { const v = c.get(r); return typeof v === 'number' && isFinite(v) ? +v.toFixed(3) : ''; })]);
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `cricforgeek-${fk}-${disc}.csv`;
    a.click();
  };

  return (
    <>
      <section className="fade-in stack">
        <div className="eyebrow">Query builder</div>
        <h1>Explorer</h1>
        <p className="sub" style={{ maxWidth: 720 }}>Filter by format, competitions and years, then sort by any metric. Everything runs in your browser.</p>
      </section>
      <Panel>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
          <label className="field">Format
            <select className="input" value={fk} onChange={(e) => { setFk(e.target.value); setComps([]); setFrom(0); setTo(9999); }}>
              {FKS.map((k) => <option key={k} value={k}>{famKeyLabel(k)}</option>)}
            </select>
          </label>
          <Seg label="Discipline" value={disc} onChange={setDisc} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />
          <Seg label="Group by" value={by} onChange={setBy} options={[['player', 'Career'], ['season', 'Season'], ['comp', 'Competition']]} />
          <label className="field">From
            <select className="input" value={Math.max(from, years[0])} onChange={(e) => setFrom(+e.target.value)}>
              {Array.from({ length: years[1] - years[0] + 1 }, (_, n) => years[0] + n).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">To
            <select className="input" value={Math.min(to, years[1])} onChange={(e) => setTo(+e.target.value)}>
              {Array.from({ length: years[1] - years[0] + 1 }, (_, n) => years[0] + n).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">Min balls
            <input className="input" type="number" min={0} step={50} value={minB} onChange={(e) => setMinB(Math.max(0, +e.target.value || 0))} style={{ width: 100 }} />
          </label>
          {!PREVIEW && <button className="btn" onClick={download} disabled={!rows.length}>Download CSV</button>}
        </div>
        <div className="chips" role="group" aria-label="Competitions">
          <button className="chip" aria-pressed={!comps.length} onClick={() => setComps([])}>All competitions</button>
          {compList.slice(0, 30).map((c) => (
            <button key={c} className="chip" aria-pressed={comps.includes(c)} onClick={() => setComps(comps.includes(c) ? comps.filter((x) => x !== c) : [...comps, c])}>{compLabel.get(c) ?? c}</button>
          ))}
        </div>
      </Panel>
      {ex.error && <ErrorBox error={ex.error} />}
      {!ex.data ? <Loader text="Loading explorer data" /> : (
        <Panel flush title={`${n0(rows.length)} results`} sub="Click a column to sort.">
          <Table key={`${disc}-${by}`} rows={rows} cols={cols} sort="imp" rank limit={50} empty="No players match. Lower the minimum balls or widen the years." />
        </Panel>
      )}
    </>
  );
}
