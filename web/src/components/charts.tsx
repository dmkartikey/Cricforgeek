import { ReactNode, useEffect, useRef, useState } from 'react';
import { scaleLinear, scaleBand } from 'd3-scale';
import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
import { ok } from '../lib/stats';
import { compact } from '../lib/fmt';

// ---------- tooltip ----------
type Tip = { x: number; y: number; title?: string; rows: { label: string; value: string; color?: string }[] } | null;

export function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const node = tip ? (
    <div className="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 290), top: Math.max(8, tip.y - 12) }} role="status">
      {tip.title && <div className="t-title">{tip.title}</div>}
      {tip.rows.map((r) => (
        <div className="t-row" key={r.label}>
          <span>{r.color && <i className="key-line" style={{ background: r.color }} />}{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  ) : null;
  return { tip: node, show: setTip, hide: () => setTip(null) };
}

// Measure the container so text stays at its real pixel size on any screen width.
export function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => { const cw = Math.round(e[0].contentRect.width); if (cw > 0) setW(cw); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

const niceDomain = (lo: number, hi: number) => scaleLinear().domain([lo, hi]).nice(4).domain() as [number, number];

// ---------- line chart with crosshair ----------
export type Series = { name: string; color: string; values: (number | null)[]; dashed?: boolean; wash?: boolean; weak?: boolean[] };

// Which x-axis labels to draw: spaced by the widest label so none collide, always the last one,
// and the regular label just before the last is dropped if it would sit on top of it.
function axisKeep(labels: string[], plotW: number) {
  const n = labels.length;
  const longest = Math.max(1, ...labels.map((l) => String(l ?? '').length));
  const slot = longest * 6.6 + 14; // ~11px mono/sans axis text
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / slot))));
  return (i: number) => i === n - 1 || (i % every === 0 && n - 1 - i >= Math.ceil(every * 0.75));
}

export function LineChart({ labels, series, fmt = (v) => compact(v), height = 220, yMin, yMax, refLine, refLabel, aria, xFmt, breaks }: {
  labels: string[]; series: Series[]; fmt?: (v: number) => string; height?: number; yMin?: number; yMax?: number;
  refLine?: number; refLabel?: string; aria: string; xFmt?: (l: string, i: number) => string;
  breaks?: { at: number; label: string }[]; // vertical dividers, e.g. the innings break
}) {
  const { ref: box, w: W } = useWidth();
  const H = height, L = 44, R = 14, T = 14, B = 26;
  const { tip, show, hide } = useTip();
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const all = series.flatMap((s) => s.values.filter(ok)) as number[];
  if (refLine != null) all.push(refLine);
  const [lo, hi] = niceDomain(yMin ?? Math.min(...all, 0 < Math.min(...all) ? Math.min(...all) * 0.9 : Math.min(...all)), yMax ?? Math.max(...all));
  const x = scaleLinear().domain([0, Math.max(labels.length - 1, 1)]).range([L, W - R]);
  const y = scaleLinear().domain([lo, hi]).range([H - B, T]);
  const ticks = y.ticks(4);
  const keep = axisKeep(labels.map((l, i) => String(xFmt ? xFmt(l, i) : l)), W - L - R);
  const onMove = (e: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(labels.length - 1, Math.round(x.invert(px))));
    setHover(i);
    show({ x: e.clientX, y: e.clientY, title: labels[i],
      rows: series.map((s) => ({ label: s.name, value: ok(s.values[i]) ? fmt(s.values[i] as number) : '–', color: s.color })) });
  };
  if (!all.length) return <div className="empty">No data.</div>;
  return (
    <div ref={box}>
      <svg ref={svg} className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}
        onPointerMove={onMove} onPointerLeave={() => { setHover(null); hide(); }}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {refLine != null && (
          <g>
            <line x1={L} x2={W - R} y1={y(refLine)} y2={y(refLine)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" />
            {refLabel && <text x={W - R} y={y(refLine) - 5} textAnchor="end">{refLabel}</text>}
          </g>
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => [i, v] as [number, number | null]);
          const gen = d3line<[number, number | null]>().defined((d) => ok(d[1])).x((d) => x(d[0])).y((d) => y(d[1] as number)).curve(curveMonotoneX);
          const ar = d3area<[number, number | null]>().defined((d) => ok(d[1])).x((d) => x(d[0])).y0(y(Math.max(lo, 0))).y1((d) => y(d[1] as number)).curve(curveMonotoneX);
          const last = [...pts].reverse().find((p) => ok(p[1]));
          return (
            <g key={s.name}>
              {/* a filled area only makes sense when the axis starts at zero */}
              {s.wash && lo <= 0 && <path className="wash" d={ar(pts) ?? ''} fill={s.color} fillOpacity={0.12} />}
              <path key={s.values.join(',')} className={s.dashed ? undefined : 'draw'} pathLength={s.dashed ? undefined : 1}
                d={gen(pts) ?? ''} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined} />
              {last && !s.dashed && <circle cx={x(last[0])} cy={y(last[1] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
              {/* small samples: hollow rings so a spike from a handful of balls doesn't read as a trend */}
              {s.weak && pts.map(([i, v]) => s.weak![i] && ok(v) && (
                <circle key={`w${i}`} cx={x(i)} cy={y(v as number)} r={3.5} fill="var(--surface)" stroke={s.color} strokeWidth={1.5} />
              ))}
            </g>
          );
        })}
        {breaks?.map((b) => (
          <g key={b.at}>
            <line x1={x(b.at)} x2={x(b.at)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="3 3" />
            <text x={x(b.at) + 5} y={T + 10} className="label-strong">{b.label}</text>
          </g>
        ))}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--text-2)" strokeWidth={1} opacity={0.5} />
            {series.map((s) => ok(s.values[hover]) && (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
        {labels.map((l, i) => keep(i) && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{xFmt ? xFmt(l, i) : l}</text>
        ))}
        <line className="axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
      </svg>
      {tip}
    </div>
  );
}

// ---------- vertical columns ----------
export function Columns({ data, fmt = (v) => compact(v), height = 200, aria, color = 'var(--s1)', highlightMax = true, refLine, marks }: {
  data: { label: string; value: number | null; title?: string; extra?: { label: string; value: string }[]; color?: string }[];
  fmt?: (v: number) => string; height?: number; aria: string; color?: string; highlightMax?: boolean; refLine?: number;
  marks?: (number | null)[];
}) {
  const { ref: box, w: W } = useWidth();
  const H = height, L = 40, R = 8, T = marks ? 34 : 18, B = 26;
  const { tip, show, hide } = useTip();
  const [hi, setHi] = useState<number | null>(null);
  const vals = data.map((d) => d.value).filter(ok) as number[];
  const [lo, top] = niceDomain(Math.min(0, ...vals), Math.max(1, ...vals, refLine ?? 0));
  const x = scaleBand<number>().domain(data.map((_, i) => i)).range([L, W - R]).paddingInner(0.25);
  const y = scaleLinear().domain([lo, top]).range([H - B, T]);
  const bw = Math.min(24, x.bandwidth());
  const keep = axisKeep(data.map((d) => String(d.label ?? '')), W - L - R);
  const maxI = highlightMax && vals.length ? data.findIndex((d) => d.value === Math.max(...vals)) : -1;
  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} onPointerLeave={() => { hide(); setHi(null); }}>
        {y.ticks(4).map((t) => (
          <g key={t}>
            <line className="gridline" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {refLine != null && <line x1={L} x2={W - R} y1={y(refLine)} y2={y(refLine)} stroke="var(--text-2)" strokeDasharray="4 4" opacity={0.6} />}
        {data.map((d, i) => {
          const cx = (x(i) ?? 0) + x.bandwidth() / 2;
          const v = d.value;
          const y0 = y(0);
          const yv = ok(v) ? y(v) : y0;
          const h = Math.abs(y0 - yv);
          const up = (v ?? 0) >= 0;
          const r = Math.min(4, h, bw / 2);
          const path = up
            ? `M${cx - bw / 2},${y0} V${yv + r} Q${cx - bw / 2},${yv} ${cx - bw / 2 + r},${yv} H${cx + bw / 2 - r} Q${cx + bw / 2},${yv} ${cx + bw / 2},${yv + r} V${y0} Z`
            : `M${cx - bw / 2},${y0} V${yv - r} Q${cx - bw / 2},${yv} ${cx - bw / 2 + r},${yv} H${cx + bw / 2 - r} Q${cx + bw / 2},${yv} ${cx + bw / 2},${yv - r} V${y0} Z`;
          return (
            <g key={i}>
              {ok(v) && h > 0 && <path key={`${v}`} className={up ? 'grow' : 'grow-down'} style={{ animationDelay: `${Math.min(i * 18, 500)}ms` }}
                d={path} fill={d.color ?? color} opacity={hi == null || hi === i ? 1 : 0.55} />}
              {marks && ok(marks[i]) && (marks[i] as number) > 0 && (
                <g>{Array.from({ length: marks[i] as number }).map((_, k) => (
                  // position on the outer group, animation on the inner one: a CSS transform would replace the SVG one
                  <g key={k} transform={`translate(${cx - 5}, ${yv - 14 - k * 13})`}><g className="bails" style={{ animationDelay: `${300 + Math.min(i * 18, 500) + k * 60}ms` }}>
                    <rect x={0} y={3} width={1.8} height={8} fill="var(--red)" /><rect x={4.1} y={3} width={1.8} height={8} fill="var(--red)" /><rect x={8.2} y={3} width={1.8} height={8} fill="var(--red)" />
                    <rect x={-0.5} y={0.5} width={5.5} height={1.6} rx={0.8} fill="var(--red)" transform="rotate(-14 2 1)" /><rect x={5} y={0.5} width={5.5} height={1.6} rx={0.8} fill="var(--red)" transform="rotate(12 8 1)" />
                  </g></g>
                ))}</g>
              )}
              {(i === maxI || i === data.length - 1) && ok(v) && !marks && (
                <text x={cx} y={up ? yv - 6 : yv + 14} textAnchor="middle" className="label-strong">{fmt(v)}</text>
              )}
              <rect x={x(i)} y={T} width={x.bandwidth()} height={H - T - B} fill="transparent"
                onPointerMove={(e) => { setHi(i); show({ x: e.clientX, y: e.clientY, title: d.title ?? d.label,
                  rows: [{ label: 'Value', value: ok(v) ? fmt(v) : '–' }, ...(d.extra ?? [])] }); }} />
              {keep(i) && <text x={cx} y={H - 8} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        <line className="axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      </svg>
      {tip}
    </div>
  );
}

// ---------- horizontal bars against a reference (e.g. phase strike rate vs career) ----------
export function HBars({ rows, fmt, base: refV = 100, refLabel = 'average', max: maxV }: {
  rows: { label: string; value: number | null; note?: string; tipRows?: { label: string; value: string }[] }[];
  fmt: (v: number) => string; base?: number; refLabel?: string; max?: number;
}) {
  const { tip, show, hide } = useTip();
  const vals = rows.map((r) => r.value).filter(ok) as number[];
  const max = maxV ?? Math.max(refV * 1.3, ...vals) * 1.05;
  return (
    <div className="pct" onPointerLeave={hide}>
      {rows.map((r) => (
        <div className="pct-row" key={r.label}
          onPointerMove={(e) => show({ x: e.clientX, y: e.clientY, title: r.label,
            rows: [{ label: 'Value', value: ok(r.value) ? fmt(r.value) : '–' }, ...(r.tipRows ?? [])] })}>
          <div className="lab">{r.label}{r.note && <small>{r.note}</small>}</div>
          <div className="pct-track" style={{ ['--ref' as string]: `${(refV / max) * 100}%` }}>
            <div style={{ position: 'absolute', left: `${(refV / max) * 100}%`, top: -4, bottom: -4, width: 2, background: 'var(--text)', opacity: 0.55, zIndex: 1 }} />
            {ok(r.value) && <div className="pct-fill sweep" style={{ width: `${Math.max(1, Math.min(100, (r.value / max) * 100))}%`,
              background: r.value >= refV ? 'var(--s1)' : 'var(--neutral)' }} />}
          </div>
          <div className="pct-val">{ok(r.value) ? fmt(r.value) : '–'}</div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11 }}>Vertical line = {refLabel} ({fmt(refV)}).</div>
      {tip}
    </div>
  );
}

// ---------- percentile bars ----------
export function PctBars({ items }: { items: { label: string; pct: number | null | undefined; value: string; tip?: string }[] }) {
  const color = (p: number) => (p >= 90 ? 'var(--gold)' : p >= 50 ? 'var(--s1)' : 'var(--neutral)');
  return (
    <div className="pct">
      {items.map((i) => (
        <div className="pct-row" key={i.label} title={i.tip}>
          <div className="lab">{i.label}<small>{i.value}</small></div>
          <div className="pct-track">
            <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--line-2)' }} />
            {i.pct != null && <div className="pct-fill sweep" style={{ width: `${Math.max(2, i.pct)}%`, background: color(i.pct) }} />}
          </div>
          <div className="pct-val">{i.pct ?? '–'}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- theme-aware colour scales ----------
export const isDark = () => {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
};
const mix = (a: number[], b: number[], k: number) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
const rgb = (c: number[]) => `rgb(${c.join(',')})`;

// diverging colour for index values (1 = average): slate blue = lower, ball red = higher. Log scale, clamped at 0.5x and 2x.
export function divColor(v: number) {
  const t = Math.max(-1, Math.min(1, Math.log2(v)));
  const d = isDark();
  const neg = d ? [92, 134, 216] : [50, 102, 192], mid = d ? [29, 42, 35] : [236, 231, 220], pos = d ? [240, 100, 95] : [179, 38, 47];
  return rgb(t < 0 ? mix(mid, neg, -t) : mix(mid, pos, t));
}

// sequential pitch-green scale for shares (0 = surface, 1 = darkest / brightest)
export function seqColor(t: number) {
  const k = Math.max(0, Math.min(1, t));
  const d = isDark();
  const a = d ? [23, 36, 29] : [241, 238, 228], b = d ? [39, 160, 122] : [19, 128, 90], c = d ? [170, 230, 200] : [10, 61, 43];
  return rgb(k < 0.7 ? mix(a, b, k / 0.7) : mix(b, c, (k - 0.7) / 0.3));
}
export const seqGradient = () => `linear-gradient(90deg, ${seqColor(0)}, ${seqColor(0.7)}, ${seqColor(1)})`;

// readable label colour on top of an rgb() fill
export function inkOn(fill: string) {
  const m = fill.match(/\d+/g);
  if (!m) return 'var(--text)';
  const [r, g, b] = m.map(Number);
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.56 ? '#0B1726' : '#FFFFFF';
}

export function ChartBox({ children, legend, foot }: { children: ReactNode; legend?: ReactNode; foot?: ReactNode }) {
  return <div className="stack">{legend}{children}{foot && <div className="muted" style={{ fontSize: 12 }}>{foot}</div>}</div>;
}


// ---------- grouped horizontal bars: several series per row ----------
export function MultiBars({ rows, series, fmt, base, baseLabel }: {
  rows: { label: string; note?: string; values: (number | null)[] }[];
  series: { name: string; color: string }[]; fmt: (v: number) => string; base?: number; baseLabel?: string;
}) {
  const { tip, show, hide } = useTip();
  const vals = rows.flatMap((r) => r.values).filter(ok) as number[];
  if (!vals.length) return <div className="empty">No data.</div>;
  const max = Math.max(...vals, base ?? 0) * 1.08;
  return (
    <div className="pct" onPointerLeave={hide}>
      {rows.map((r) => (
        <div className="pct-row" key={r.label} style={{ alignItems: 'start' }}
          onPointerMove={(e) => show({ x: e.clientX, y: e.clientY, title: r.label, rows: series.map((s, i) => ({ label: s.name, value: ok(r.values[i]) ? fmt(r.values[i] as number) : '–', color: s.color })) })}>
          <div className="lab" style={{ paddingTop: 1 }}>{r.label}{r.note && <small>{r.note}</small>}</div>
          <div className="stack" style={{ gap: 3, position: 'relative' }}>
            {base != null && <div style={{ position: 'absolute', left: `${(base / max) * 100}%`, top: -3, bottom: -3, width: 1.5, background: 'var(--text)', opacity: 0.5, zIndex: 1 }} />}
            {series.map((s, i) => (
              <div key={s.name} className="pct-track" style={{ height: 8, background: 'transparent' }}>
                {ok(r.values[i]) && <div className="pct-fill sweep" style={{ width: `${Math.max(1, ((r.values[i] as number) / max) * 100)}%`, background: s.color, animationDelay: `${i * 60}ms` }} />}
              </div>
            ))}
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {series.map((s, i) => <span key={s.name} className="mono" style={{ fontSize: 11, lineHeight: '11px', textAlign: 'right', color: 'var(--text-2)' }}>{ok(r.values[i]) ? fmt(r.values[i] as number) : '–'}</span>)}
          </div>
        </div>
      ))}
      {base != null && <div className="muted" style={{ fontSize: 11 }}>Dark line = {baseLabel ?? 'average'} ({fmt(base)}).</div>}
      {tip}
    </div>
  );
}

// ---------- scatter ----------
export function Scatter({ points, xLabel, yLabel, fmtX, fmtY, refX, refY, aria, height = 300, minSpan = 0, diagonal }: {
  points: { label: string; x: number; y: number; color: string; r?: number; href?: string }[];
  xLabel: string; yLabel: string; fmtX: (v: number) => string; fmtY: (v: number) => string; refX?: number; refY?: number; aria: string; height?: number;
  minSpan?: number; // smallest axis range, so two close points don't sit on a zoomed-in axis with odd ticks
  diagonal?: string; // draw the x = y line with this label
}) {
  const { ref: box, w: W } = useWidth();
  const { tip, show, hide } = useTip();
  const H = height, L = 64, R = 16, T = 14, B = 40;
  const pts = points.filter((p) => ok(p.x) && ok(p.y));
  if (!pts.length) return <div className="empty">Not enough balls to plot.</div>;
  const xs = pts.map((p) => p.x).concat(refX ?? []), ys = pts.map((p) => p.y).concat(refY ?? []);
  const pad = (lo: number, hi: number) => {
    const d = (hi - lo) || Math.abs(hi) * 0.2 || 1;
    let a = lo - d * 0.18, b = hi + d * 0.18;
    if (b - a < minSpan) { const m = (a + b) / 2; a = m - minSpan / 2; b = m + minSpan / 2; }
    return [a, b];
  };
  let [x0, x1] = niceDomain(...(pad(Math.min(...xs), Math.max(...xs)) as [number, number]));
  let [y0, y1] = niceDomain(...(pad(Math.min(...ys), Math.max(...ys)) as [number, number]));
  if (diagonal) { const lo = Math.min(x0, y0), hi = Math.max(x1, y1); x0 = y0 = lo; x1 = y1 = hi; } // same scale on both axes
  const x = scaleLinear().domain([x0, x1]).range([L, W - R]);
  const y = scaleLinear().domain([y0, y1]).range([H - B, T]);
  return (
    <div ref={box}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} onPointerLeave={hide}>
        {y.ticks(4).map((t) => <g key={t}><line className="gridline" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text x={L - 8} y={y(t) + 4} textAnchor="end">{fmtY(t)}</text></g>)}
        {x.ticks(5).map((t) => <text key={t} x={x(t)} y={H - B + 16} textAnchor="middle">{fmtX(t)}</text>)}
        {refX != null && <line x1={x(refX)} x2={x(refX)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="4 4" />}
        {refY != null && <line x1={L} x2={W - R} y1={y(refY)} y2={y(refY)} stroke="var(--muted)" strokeDasharray="4 4" />}
        {diagonal && <g><line x1={x(x0)} y1={y(x0)} x2={x(x1)} y2={y(x1)} stroke="var(--muted)" strokeDasharray="4 4" />
          <text x={x(x1) - 6} y={y(x1) + 14} textAnchor="end" className="muted" style={{ fontSize: 11 }}>{diagonal}</text></g>}
        <line className="axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="label-ink">{xLabel}</text>
        <text x={12} y={(T + H - B) / 2} textAnchor="middle" className="label-ink" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{yLabel}</text>
        {pts.map((p, i) => (
          <g key={p.label + i} onPointerMove={(e) => show({ x: e.clientX, y: e.clientY, title: p.label, rows: [{ label: xLabel, value: fmtX(p.x) }, { label: yLabel, value: fmtY(p.y) }] })}>
            <circle className="fade-in" cx={x(p.x)} cy={y(p.y)} r={p.r ?? 7} fill={p.color} stroke="var(--surface)" strokeWidth={2} style={{ animationDelay: `${i * 80}ms` }} />
            <text x={x(p.x) + (p.r ?? 7) + 5} y={y(p.y) + 4} className="label-strong" style={{ fontSize: 11.5 }}>{p.label}</text>
          </g>
        ))}
      </svg>
      {tip}
    </div>
  );
}

// ---------- wagon wheel: scoring mix as spokes around a field ----------
// What happens in every 100 balls: a 10 x 10 grid, one square per ball, easier to compare than pie slices.
export function WagonMix({ parts, compare, aria }: {
  parts: { label: string; value: number; color: string }[]; compare?: number[]; aria: string;
}) {
  const tot = parts.reduce((a, p) => a + p.value, 0) || 1;
  const shares = parts.map((p) => (p.value / tot) * 100);
  // largest-remainder rounding so the squares add up to exactly 100
  const cells = shares.map(Math.floor);
  const order = shares.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0]);
  for (let k = 0; cells.reduce((a, v) => a + v, 0) < 100; k++) cells[order[k % order.length][1]]++;
  const grid: number[] = cells.flatMap((n, i) => Array(n).fill(i));
  const S = 10, G = 2.2;
  return (
    <div className="row" style={{ gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg className="chart ball-grid" viewBox={`0 0 ${10 * (S + G)} ${10 * (S + G)}`} role="img" aria-label={`${aria}: ${parts.map((p, i) => `${p.label} ${shares[i].toFixed(1)}%`).join(', ')}`}
        style={{ width: 200, maxWidth: '100%', flex: '0 0 auto' }}>
        {grid.map((pi, n) => (
          <rect key={n} className="fade-in" x={(n % 10) * (S + G)} y={Math.floor(n / 10) * (S + G)} width={S} height={S} rx={2.2}
            fill={parts[pi].color} style={{ animationDelay: `${Math.min(n * 6, 600)}ms` }} />
        ))}
      </svg>
      <div className="stack" style={{ gap: 8, flex: '1 1 160px', minWidth: 160 }}>
        <span className="muted" style={{ fontSize: 12 }}>Every 100 balls</span>
        {parts.map((p, i) => (
          <div key={p.label} className="kv">
            <span className="row" style={{ gap: 8 }}><i className="key-box" style={{ background: p.color }} />{p.label}</span>
            <b>{shares[i].toFixed(1)}%{ok(compare?.[i]) && <small className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>{shares[i] - (compare![i] as number) >= 0 ? '+' : '−'}{Math.abs(shares[i] - (compare![i] as number)).toFixed(1)}</small>}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- two-sided bars (e.g. runs scored vs conceded by phase) ----------
export function Butterfly({ rows, left, right, fmt }: {
  rows: { label: string; a: number | null; b: number | null }[]; left: { name: string; color: string }; right: { name: string; color: string }; fmt: (v: number) => string;
}) {
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]).filter(ok) as number[], 1e-9);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row muted" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>{left.name}</span><span>{right.name}</span></div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr) 120px minmax(0,1fr) 48px', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <b className="mono" style={{ textAlign: 'right' }}>{ok(r.a) ? fmt(r.a) : '–'}</b>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{ok(r.a) && <i className="sweep" style={{ display: 'block', height: 12, width: `${(r.a / max) * 100}%`, background: left.color, borderRadius: '2px 0 0 2px', transformOrigin: '100% 50%' }} />}</div>
          <span style={{ textAlign: 'center', color: 'var(--text-2)', fontSize: 12 }}>{r.label}</span>
          <div>{ok(r.b) && <i className="sweep" style={{ display: 'block', height: 12, width: `${(r.b / max) * 100}%`, background: right.color, borderRadius: '0 2px 2px 0' }} />}</div>
          <b className="mono">{ok(r.b) ? fmt(r.b) : '–'}</b>
        </div>
      ))}
    </div>
  );
}
