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
export type Series = { name: string; color: string; values: (number | null)[]; dashed?: boolean; wash?: boolean };

export function LineChart({ labels, series, fmt = (v) => compact(v), height = 220, yMin, yMax, refLine, refLabel, aria, xFmt }: {
  labels: string[]; series: Series[]; fmt?: (v: number) => string; height?: number; yMin?: number; yMax?: number;
  refLine?: number; refLabel?: string; aria: string; xFmt?: (l: string, i: number) => string;
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
  const every = Math.max(1, Math.ceil(labels.length / Math.max(3, Math.floor(W / 80))));
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
            <line x1={L} x2={W - R} y1={y(refLine)} y2={y(refLine)} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="4 4" opacity={0.6} />
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
              {s.wash && <path d={ar(pts) ?? ''} fill={s.color} opacity={0.1} />}
              <path d={gen(pts) ?? ''} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={s.dashed ? '5 4' : undefined} />
              {last && !s.dashed && <circle cx={x(last[0])} cy={y(last[1] as number)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--text-2)" strokeWidth={1} opacity={0.5} />
            {series.map((s) => ok(s.values[hover]) && (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        )}
        {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
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
  const H = height, L = 40, R = 8, T = 18, B = 26;
  const { tip, show, hide } = useTip();
  const [hi, setHi] = useState<number | null>(null);
  const vals = data.map((d) => d.value).filter(ok) as number[];
  const [lo, top] = niceDomain(Math.min(0, ...vals), Math.max(1, ...vals, refLine ?? 0));
  const x = scaleBand<number>().domain(data.map((_, i) => i)).range([L, W - R]).paddingInner(0.25);
  const y = scaleLinear().domain([lo, top]).range([H - B, T]);
  const bw = Math.min(24, x.bandwidth());
  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(W / 56))));
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
              {ok(v) && h > 0 && <path d={path} fill={d.color ?? color} opacity={hi == null || hi === i ? 1 : 0.55} />}
              {marks && ok(marks[i]) && (marks[i] as number) > 0 && (
                <g>{Array.from({ length: marks[i] as number }).map((_, k) => (
                  <circle key={k} cx={cx} cy={yv - 8 - k * 9} r={4} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} />
                ))}</g>
              )}
              {(i === maxI || i === data.length - 1) && ok(v) && !marks && (
                <text x={cx} y={up ? yv - 6 : yv + 14} textAnchor="middle" className="label-strong">{fmt(v)}</text>
              )}
              <rect x={x(i)} y={T} width={x.bandwidth()} height={H - T - B} fill="transparent"
                onPointerMove={(e) => { setHi(i); show({ x: e.clientX, y: e.clientY, title: d.title ?? d.label,
                  rows: [{ label: 'Value', value: ok(v) ? fmt(v) : '–' }, ...(d.extra ?? [])] }); }} />
              {(i % every === 0 || i === data.length - 1) && <text x={cx} y={H - 8} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
        <line className="axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      </svg>
      {tip}
    </div>
  );
}

// ---------- horizontal bars against a reference (e.g. SR+ vs 100) ----------
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
            <div style={{ position: 'absolute', left: `${(refV / max) * 100}%`, top: -4, bottom: -4, width: 1, background: 'var(--text-2)', opacity: 0.6 }} />
            {ok(r.value) && <div className="pct-fill" style={{ width: `${Math.max(1, Math.min(100, (r.value / max) * 100))}%`,
              background: r.value >= refV ? 'var(--s1)' : 'var(--div-mid)' }} />}
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
  const color = (p: number) => (p >= 90 ? 'linear-gradient(90deg, var(--s1), var(--accent))' : p >= 50 ? 'var(--s1)' : 'var(--div-mid)');
  return (
    <div className="pct">
      {items.map((i) => (
        <div className="pct-row" key={i.label} title={i.tip}>
          <div className="lab">{i.label}<small>{i.value}</small></div>
          <div className="pct-track">
            {i.pct != null && <div className="pct-fill" style={{ width: `${Math.max(2, i.pct)}%`, background: color(i.pct),
              boxShadow: i.pct >= 90 ? '0 0 14px rgba(94,231,255,.45)' : undefined }} />}
          </div>
          <div className="pct-val">{i.pct ?? '–'}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- diverging colour for index values (1 = average) ----------
export function divColor(v: number) {
  // log-scale around 1; clamp at 0.5x and 2x
  const t = Math.max(-1, Math.min(1, Math.log2(v)));
  const mix = (a: number[], b: number[], k: number) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const neg = [12, 156, 203], mid = [56, 58, 69], pos = [226, 80, 143];
  const c = t < 0 ? mix(mid, neg, -t) : mix(mid, pos, t);
  return `rgb(${c.join(',')})`;
}

export function ChartBox({ children, legend, foot }: { children: ReactNode; legend?: ReactNode; foot?: ReactNode }) {
  return <div className="stack">{legend}{children}{foot && <div className="muted" style={{ fontSize: 12 }}>{foot}</div>}</div>;
}

