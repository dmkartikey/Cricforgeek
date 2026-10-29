// The view filters (format, men or women, level) shown on the pages that use them, instead of in the sidebar.
// The choice is still remembered across pages.
import { DEFAULT_VIEW, FMTS, LEVELS, useSettings, type Fmt } from '../lib/settings';

export function ViewBar({ level = false, formats, gender = true, note }: { level?: boolean; formats?: Fmt[]; gender?: boolean; note?: string }) {
  const s = useSettings();
  const list = FMTS.filter((f) => !formats || formats.includes(f.k));
  return (
    <div className="viewbar fade-in" role="toolbar" aria-label="View">
      <div className="vb-fmts" role="group" aria-label="Format">
        {list.map((f) => (
          <button key={f.k} type="button" aria-pressed={s.fmt === f.k} onClick={() => s.set({ fmt: f.k })}>
            <b>{f.l}</b><small>{f.s}</small>
          </button>
        ))}
      </div>
      <div className="vb-right">
        {gender && (
          <div className="seg" role="group" aria-label="Men or women">
            <button type="button" aria-pressed={s.gender === 'male'} onClick={() => s.set({ gender: 'male' })}>Men</button>
            <button type="button" aria-pressed={s.gender === 'female'} onClick={() => s.set({ gender: 'female' })}>Women</button>
          </div>
        )}
        {level && (
          <select className="input vb-level" aria-label="Level" value={s.level} onChange={(e) => s.set({ level: e.target.value as any })}>
            {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
      </div>
      {(s.fmt !== DEFAULT_VIEW.fmt || s.gender !== DEFAULT_VIEW.gender || (level && s.level !== DEFAULT_VIEW.level)) && (
        // the choice is remembered across pages, so say what's showing and offer a one-tap way back
        <div className="vb-chip" role="status">
          Showing <b>{FMTS.find((f) => f.k === s.fmt)?.l} · {s.gender === 'male' ? 'Men' : 'Women'}{level && s.level !== 'top' ? ` · ${LEVELS.find(([k]) => k === s.level)?.[1]}` : ''}</b>
          <button type="button" onClick={() => s.set({ ...DEFAULT_VIEW })} aria-label="Reset to T20, men">Reset ✕</button>
        </div>
      )}
      {note && <div className="vb-note">{note}</div>}
    </div>
  );
}
