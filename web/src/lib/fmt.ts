// Numbers use one style everywhere: international thousands separators (11,715,797), whatever the phone's language.
import { ok } from './stats';

export const n0 = (v: unknown) => (ok(v) ? Math.round(v).toLocaleString('en-GB') : '–');
export const d1 = (v: unknown) => (ok(v) ? v.toFixed(1) : '–');
export const d2 = (v: unknown) => (ok(v) ? v.toFixed(2) : '–');
export const d3 = (v: unknown) => (ok(v) ? v.toFixed(3) : '–');
export const pct = (v: unknown, dp = 1) => (ok(v) ? (v * 100).toFixed(dp) + '%' : '–');
export const signed = (v: unknown, dp = 1) => (ok(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '–');
export const plus = (v: unknown) => (ok(v) ? Math.round(v).toString() : '–');
export const overs = (balls: unknown, bpo = 6) => (ok(balls) ? Math.floor(balls / bpo) + (balls % bpo ? '.' + (balls % bpo) : '') : '–');
export const compact = (v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'K' : String(Math.round(v * 100) / 100));
export const dateShort = (s?: string) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase();
