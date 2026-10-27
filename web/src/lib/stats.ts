// Derived metrics from the raw sums written by the pipeline.

export type BatSums = { i?: number; r?: number; b?: number; o?: number; f4?: number; s6?: number; d?: number;
  xr?: number; xo?: number; imp?: number; wpa?: number; c50?: number; c100?: number; hs?: number; hs_no?: boolean };
export type BowlSums = { i?: number; b?: number; r?: number; w?: number; d?: number; f4?: number; s6?: number;
  xr?: number; xw?: number; imp?: number; wpa?: number; w3?: number; w5?: number; best?: string };

const div = (a?: number, b?: number) => (a != null && b ? a / b : NaN);

export function bat(s: BatSums) {
  const avg = div(s.r, s.o), sr = 100 * div(s.r, s.b);
  const xavg = div(s.xr, s.xo);
  return {
    ...s, avg, sr,
    srPlus: 100 * div(s.r, s.xr),
    avgPlus: 100 * div(avg, xavg),
    imp100: 100 * div(s.imp, s.b),
    wpa100: 100 * div(s.wpa, s.b),
    bnd: div((s.f4 ?? 0) + (s.s6 ?? 0), s.b),
    dotp: div(s.d, s.b),
    bpd: div(s.b, s.o),
    bpb: div(s.b, (s.f4 ?? 0) + (s.s6 ?? 0)),
    rae: (s.r ?? 0) - (s.xr ?? 0),
  };
}

export function bowl(s: BowlSums) {
  return {
    ...s,
    econ: 6 * div(s.r, s.b), avg: div(s.r, s.w), sr: div(s.b, s.w),
    econPlus: 100 * div(s.xr, s.r),
    wktPlus: 100 * div(s.w, s.xw),
    imp100: 100 * div(s.imp, s.b),
    wpa100: 100 * div(s.wpa, s.b),
    dotp: div(s.d, s.b),
    saved: (s.xr ?? 0) - (s.r ?? 0),
  };
}

// split rows from the pipeline
// bat:  [k, b, r, o, f4, s6, d, xr, xo, imp, wpa]
// bowl: [k, b, r, w, d, f4, s6, xr, xw, imp, wpa]
export type SplitRow = (string | number | null)[];
export const batSplit = (row: SplitRow) => {
  const [k, b, r, o, f4, s6, d, xr, xo, imp, wpa] = row as [string, ...number[]];
  return { k, ...bat({ b, r, o, f4, s6, d, xr, xo, imp, wpa }) };
};
export const bowlSplit = (row: SplitRow) => {
  const [k, b, r, w, d, f4, s6, xr, xw, imp, wpa] = row as [string, ...number[]];
  return { k, ...bowl({ b, r, w, d, f4, s6, xr, xw, imp, wpa }) };
};

export const ok = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
