import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PREVIEW } from '../lib/data';
import { addPin, isPinned, Pin, removePin, useBoards } from '../lib/pins';
import { ok } from '../lib/stats';

type PinSpec = Omit<Pin, 'at'> | null | undefined;

export function Panel({ title, sub, right, children, flush, className = '', eyebrow, tools, foot, pin, id }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; flush?: boolean; className?: string;
  eyebrow?: ReactNode; tools?: ReactNode; foot?: ReactNode; pin?: PinSpec; id?: string;
}) {
  return (
    <section id={id} className={`panel fade-in ${flush ? 'flush' : ''} ${className}`}>
      {(title || right || eyebrow || pin) && (
        <div className="panel-head">
          <div className="panel-title">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {(right || pin) && <div className="panel-actions">{right}{pin && <PinButton pin={pin} />}</div>}
        </div>
      )}
      {tools && <div className="mini-bar" role="toolbar">{tools}</div>}
      {children}
      {foot && <div className="panel-foot">{foot}</div>}
    </section>
  );
}

export function PinButton({ pin }: { pin: Omit<Pin, 'at'> }) {
  const boards = useBoards();
  const on = isPinned(boards, pin.id);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 1800); return () => clearTimeout(t); }, [toast]);
  return (
    <>
      <button type="button" className="icon-btn" aria-pressed={on} title={on ? 'Unpin from your board' : 'Pin to your board'}
        aria-label={on ? 'Unpin' : 'Pin to board'}
        onClick={() => { if (on) { removePin(pin.id); setToast('Removed from your pinboard'); } else { addPin(pin); setToast('Pinned. Find it under My pinboard.'); } }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M9 3h6l-1 6 4 4H6l4-4-1-6zM12 13v8" />
        </svg>
      </button>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

// Small in-card filter: a compact segmented control
export function Mini<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  if (options.length < 2) return null;
  return (
    <div className="mini" role="group" aria-label={label}>
      <span className="mini-label">{label}</span>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function MiniSelect({ value, options, onChange, label }: {
  value: string; options: [string, string][]; onChange: (v: string) => void; label: string;
}) {
  if (options.length < 2) return null;
  return (
    <label className="mini mini-select">
      <span className="mini-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

export function MiniSearch({ value, onChange, placeholder = 'Filter' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="mini mini-search">
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Animated number: counts up when it first appears or when the value changes
export function CountUp({ value, format, duration = 800 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [v, setV] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (reduced() || !isFinite(value)) { setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setV(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(v)}</>;
}

// Scoreboard-style flip: each character drops in, staggered left to right
export function Flip({ text }: { text: string }) {
  return (
    <span className="flip" aria-label={text} key={text}>
      {text.split('').map((c, i) => <span key={i} className="fd" aria-hidden="true" style={{ animationDelay: `${i * 45}ms` }}>{c}</span>)}
    </span>
  );
}

export function Tiles({ items }: { items: { l: string; v: ReactNode; h?: ReactNode; hot?: boolean; tip?: string }[] }) {
  return (
    <div className="tiles">
      {items.map((t) => (
        <div className={`tile ${t.hot ? 'hot' : ''}`} key={t.l} title={t.tip}>
          <span className="l">{t.l}</span>
          <span className="v">{t.v}</span>
          {t.h && <span className="h">{t.h}</span>}
        </div>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, full }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string; full?: boolean;
}) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className="chip" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

export function Loader({ text = 'Loading' }: { text?: string }) {
  return (
    <div className="ball-loader" aria-live="polite">
      <div className="lane" aria-hidden="true"><span className="ball" /><span className="stumps"><i /><i /><i /></span></div>
      <span>{text}…</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  const nf = PREVIEW ? 'This page is not in the preview edition (it includes match pages from 2022 onwards).' : 'Nothing here. The link may be out of date.';
  return <div className="notice">{error === 'Not found' ? nf : error}</div>;
}

export function Legend({ items }: { items: { label: string; color?: string; kind?: 'line' | 'box' | 'dash' | 'dot' }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.kind === 'dash' ? 'key-dash' : i.kind === 'box' ? 'key-box' : i.kind === 'dot' ? 'key-dot' : 'key-line'} style={i.kind === 'dash' ? undefined : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

// ---------- ranked list: leader callout + ranked bars ----------
export type RankRow = { id: string; name: string; meta?: string; value: number; text: string; href?: string };

export function RankList({ rows, unit, lead = true, base = 0 }: { rows: RankRow[]; unit?: string; lead?: boolean; base?: number }) {
  if (!rows.length) return <div className="empty">Nobody qualifies with these filters.</div>;
  const ext = Math.max(...rows.map((r) => Math.abs(r.value - base)), 1e-9);
  const first = rows[0];
  const rest = lead ? rows.slice(1) : rows;
  return (
    <div className="rl">
      {lead && (
        <Link className="rl-lead" to={first.href ?? '#'}>
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="eyebrow">No. 1</span>
            <span className="who">{first.name}</span>
            {first.meta && <span className="meta">{first.meta}</span>}
          </span>
          <span className="stack" style={{ gap: 2 }}>
            <span className="val">{first.text}</span>
            {unit && <span className="unit">{unit}</span>}
          </span>
        </Link>
      )}
      <div className="stagger" key={rows.map((r) => r.id).join()}>
        {rest.map((r, i) => {
          const n = lead ? i + 2 : i + 1;
          return (
            <Link key={r.id + i} className={`rl-row ${n <= 3 ? 'podium' : ''}`} to={r.href ?? '#'}>
              <span className="rl-rank">{n}</span>
              <span className="rl-who"><b>{r.name}</b>{r.meta && <small>{r.meta}</small>}</span>
              <span className="rl-bar" aria-hidden="true"><i className="sweep" style={{ width: `${Math.max(2, (Math.abs(r.value - base) / ext) * 100)}%` }} /></span>
              <span className="rl-val">{r.text}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------- dumbbell: before -> after for each row ----------
export function Dumbbell({ rows, fmt, thenLabel, nowLabel }: {
  rows: { id: string; name: string; meta?: string; then: number; now: number; href?: string }[];
  fmt: (v: number) => string; thenLabel: string; nowLabel: string;
}) {
  if (!rows.length) return <div className="empty">Nobody has enough balls in both periods.</div>;
  const rawLo = Math.min(0, ...rows.flatMap((r) => [r.then, r.now])), rawHi = Math.max(0, ...rows.flatMap((r) => [r.then, r.now]));
  // round the ends out to a tidy step so the axis reads −60 · 0 · +60, not −55.9 · 0 · 54.4
  const span = rawHi - rawLo || 1, step = span > 200 ? 50 : span > 80 ? 20 : span > 30 ? 10 : span > 8 ? 5 : 1;
  const lo = Math.floor(rawLo / step) * step, hi = Math.ceil(rawHi / step) * step;
  const pos = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  return (
    <div>
      <div className="db-axis" aria-hidden="true">
        <span />
        <span className="db-scale" style={{ position: 'relative', height: 14 }}>
          <span style={{ position: 'absolute', left: 0 }}>{lo < 0 ? fmt(lo) : ''}</span>
          <span style={{ position: 'absolute', left: `${pos(0)}%`, transform: 'translateX(-50%)' }}>0</span>
          <span style={{ position: 'absolute', right: 0 }}>{fmt(hi)}</span>
        </span>
        <span style={{ textAlign: 'right' }}>change</span>
      </div>
      {rows.map((r) => {
        const a = pos(Math.min(r.then, r.now)), b = pos(Math.max(r.then, r.now));
        return (
          <Link key={r.id} to={r.href ?? '#'} className="db-row" title={`${thenLabel}: ${fmt(r.then)} → ${nowLabel}: ${fmt(r.now)}`}>
            <span className="rl-who"><b>{r.name}</b>{r.meta && <small>{r.meta}</small>}</span>
            <span className="db-track">
              <span className="zero" style={{ left: `${pos(0)}%` }} />
              <span className="seg-l" style={{ left: `${a}%`, width: `${b - a}%` }} />
              <span className="dot then" style={{ left: `${pos(r.then)}%` }} />
              <span className="dot now" style={{ left: `${pos(r.now)}%` }} />
            </span>
            <span className="db-delta">{(r.now - r.then >= 0 ? '+' : '−') + fmt(Math.abs(r.now - r.then))}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------- lollipop: one value per row, stick from zero ----------
export function Lollipop({ rows, fmt }: { rows: { id: string; name: string; meta?: string; value: number; sub?: string; href?: string }[]; fmt: (v: number) => string }) {
  if (!rows.length) return <div className="empty">Nobody qualifies with these filters.</div>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div className="rl stagger" key={rows.map((r) => r.id).join()}>
      {rows.map((r, i) => (
        <Link key={r.id} className={`rl-row ${i < 3 ? 'podium' : ''}`} to={r.href ?? '#'}>
          <span className="rl-rank">{i + 1}</span>
          <span className="rl-who"><b>{r.name}</b>{r.meta && <small>{r.meta}</small>}</span>
          <span className="rl-lol" style={{ position: 'relative', height: 14 }} aria-hidden="true">
            <span className="sweep" style={{ position: 'absolute', left: 0, top: 6, height: 2, width: `${(Math.abs(r.value) / max) * 100}%`, background: 'var(--line-2)' }} />
            <span style={{ position: 'absolute', top: 1, left: `calc(${(Math.abs(r.value) / max) * 100}% - 6px)`, width: 12, height: 12, borderRadius: '50%',
              background: i < 3 ? 'var(--accent)' : 'var(--s1)', border: '2px solid var(--surface)' }} />
          </span>
          <span className="rl-val">{fmt(r.value)}{r.sub && <small className="muted" style={{ display: 'block', fontSize: 10.5, fontWeight: 400 }}>{r.sub}</small>}</span>
        </Link>
      ))}
    </div>
  );
}

// ---------- side drawer ----------
export function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Breakdown'}>
        <div className="drawer-head">
          <div className="stack" style={{ gap: 4 }}><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

// Section heading used between groups of panels
export function SectionHead({ title, sub, right, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="section-h" id={id}>
      <div className="stack" style={{ gap: 4 }}><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
      {right}
    </div>
  );
}

export const nz = (v: unknown, d = 0) => (ok(v) ? v : d);

// A tab row that scrolls sideways when it doesn't fit, with a fade and an arrow so hidden tabs are discoverable.
export function ScrollTabs({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ l: false, r: false, o: false });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = () => setMore({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4, o: el.scrollWidth > el.clientWidth + 4 });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd); ro.observe(el);
    // keep the selected tab in view, without scrolling the page itself
    const sel = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (sel && sel.offsetLeft + sel.offsetWidth > el.clientWidth) { el.scrollLeft = sel.offsetLeft - 40; upd(); }
    return () => { el.removeEventListener('scroll', upd); ro.disconnect(); };
  }, []);
  const nudge = (d: number) => ref.current?.scrollBy({ left: d * 160, behavior: 'smooth' });
  return (
    <div className={`tabs-wrap${more.o ? ' over' : ''}${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>
      <div ref={ref} className="tabs" role="tablist" style={style}>{children}</div>
      {more.l && <button className="tabs-arrow l" aria-label="Show earlier tabs" onClick={() => nudge(-1)}>‹</button>}
      {more.r && <button className="tabs-arrow r" aria-label="Show more tabs" onClick={() => nudge(1)}>›</button>}
    </div>
  );
}

// In-page jump links for long pages. Scrolls without touching the URL (the router owns it).
export function JumpLinks({ items }: { items: [string, string][] }) {
  return (
    <nav className="jump" aria-label="On this page">
      <span className="mini-label">On this page</span>
      {items.map(([id, label]) => (
        <button key={id} className="chip" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}</button>
      ))}
    </nav>
  );
}
