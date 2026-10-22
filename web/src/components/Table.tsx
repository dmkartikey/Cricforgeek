import { ReactNode, useMemo, useState } from 'react';

export type Col<R> = {
  key: string; label: string; get: (r: R) => number | string | null | undefined;
  fmt?: (v: any, r: R) => ReactNode; left?: boolean; sortable?: boolean; title?: string; desc?: boolean;
};

export function Table<R>({ cols, rows, sort, limit, rank, empty = 'No data.' }: {
  cols: Col<R>[]; rows: R[]; sort?: string; limit?: number; rank?: boolean; empty?: string;
}) {
  const [key, setKey] = useState(sort ?? '');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [shown, setShown] = useState(limit ?? 1e9);
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === key);
    if (!c) return rows;
    const val = (r: R) => { const v = c.get(r); return typeof v === 'number' ? (isFinite(v) ? v : null) : v ?? null; };
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const o = typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
      return dir === 'desc' ? -o : o;
    });
  }, [rows, cols, key, dir]);
  if (!rows.length) return <div className="empty">{empty}</div>;
  const click = (c: Col<R>) => {
    if (c.sortable === false) return;
    if (c.key === key) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setKey(c.key); setDir(c.desc === false ? 'asc' : 'desc'); }
  };
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {rank && <th className="rank" scope="col">#</th>}
            {cols.map((c) => (
              <th key={c.key} scope="col" title={c.title} className={`${c.sortable === false ? '' : 'sortable'} ${c.left ? 'left' : ''}`}
                aria-sort={c.key === key ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}
                onClick={() => click(c)} tabIndex={c.sortable === false ? undefined : 0}
                onKeyDown={(e) => { if (e.key === 'Enter') click(c); }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, shown).map((r, i) => (
            <tr key={i}>
              {rank && <td className="rank">{i + 1}</td>}
              {cols.map((c) => {
                const v = c.get(r);
                return <td key={c.key} className={c.left ? 'txt left' : ''}>{c.fmt ? c.fmt(v, r) : v ?? '–'}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown && (
        <div style={{ padding: 12 }}><button className="btn" onClick={() => setShown(shown + (limit ?? 25))}>Show more ({sorted.length - shown} left)</button></div>
      )}
    </div>
  );
}
