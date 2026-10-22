import { ReactNode, useEffect, useRef, useState } from 'react';
import { PREVIEW } from '../lib/data';

export function Panel({ title, sub, right, children, flush, className = '', eyebrow, tools }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; flush?: boolean; className?: string;
  eyebrow?: ReactNode; tools?: ReactNode;
}) {
  return (
    <section className={`panel fade-in ${flush ? 'flush' : ''} ${className}`}>
      {(title || right || eyebrow) && (
        <div className="panel-head">
          <div className="panel-title">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {tools && <div className="mini-bar" role="toolbar">{tools}</div>}
      {children}
    </section>
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

// Animated number: counts up from 0 when it first appears or when the value changes
export function CountUp({ value, format, duration = 900 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [v, setV] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !isFinite(value)) { setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(v)}</>;
}

export function Tiles({ items }: { items: { l: string; v: ReactNode; h?: ReactNode; hot?: boolean; tip?: string }[] }) {
  return (
    <div className="tiles stagger">
      {items.map((t) => (
        <div className={`tile ${t.hot ? 'hot' : ''}`} key={t.l} title={t.tip}>
          <span className="v">{t.v}</span>
          <span className="l">{t.l}</span>
          {t.h && <span className="h">{t.h}</span>}
        </div>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
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
    <div className="skeleton" aria-live="polite">
      <div className="sk sk-title" /><div className="sk sk-line" /><div className="sk sk-line short" />
      <div className="sk-grid"><div className="sk sk-card" /><div className="sk sk-card" /><div className="sk sk-card" /></div>
      <span className="sr">{text}</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: string }) {
  const nf = PREVIEW ? 'This page is not in the preview edition (it includes match pages from 2022 onwards).' : 'Nothing here. The link may be out of date.';
  return <div className="notice">{error === 'Not found' ? nf : error}</div>;
}

export function Legend({ items }: { items: { label: string; color?: string; kind?: 'line' | 'box' | 'dash' }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className={i.kind === 'dash' ? 'key-dash' : i.kind === 'box' ? 'key-box' : 'key-line'} style={i.kind === 'dash' ? undefined : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
