import { ReactNode } from 'react';
import { PREVIEW } from '../lib/data';

export function Panel({ title, sub, right, children, flush, className = '', eyebrow }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; flush?: boolean; className?: string; eyebrow?: ReactNode;
}) {
  return (
    <section className={`panel fade-in ${flush ? 'flush' : ''} ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tiles({ items }: { items: { l: string; v: ReactNode; h?: ReactNode; hot?: boolean; tip?: string }[] }) {
  return (
    <div className="tiles">
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
  return <div className="loader"><i aria-hidden="true" />{text}</div>;
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
