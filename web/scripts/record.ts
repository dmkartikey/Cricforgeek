// Nightly track record for the Live page. For every finished international the Worker kept, re-run the
// same model the page uses at each score check and compare with the result. Writes data/live/record.json.
// Usage: node record.mjs <data dir> [live api]. Exits quietly (keeping the old file) if the feed is unreachable.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { quickWin, dataKey, type LiveMatch, type Snap } from '../src/lib/winline';
import type { LimData, MdData } from '../src/lib/predict';

type Done = { id: string; name: string; fmt: LiveMatch['fmt']; gender: LiveMatch['gender']; teams: [string, string]; start: string; status: string;
  winner: string | null; innings: LiveMatch['innings']; ended: string };

const dataDir = process.argv[2] ?? 'public/data';
const api = process.argv[3] ?? process.env.LIVE_API ?? 'https://cricforgeek-live.dmkartikey.workers.dev';
const outFile = join(dataDir, 'live', 'record.json');

async function get<T>(path: string): Promise<T> {
  const r = await fetch(api + path, { headers: { accept: 'application/json', origin: 'https://cricforgeek.site' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return (await r.json()) as T;
}

const models: Record<string, LimData | MdData | null> = {};
const model = (k: string) => {
  if (!(k in models)) { const f = join(dataDir, 'predict', `${k}.json`); models[k] = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; }
  return models[k];
};

async function main() {
  let done: Done[];
  try { done = await get<Done[]>('/done'); } catch (e) { console.log(`record: live feed not reachable (${(e as Error).message}); keeping the old file`); return; }
  const usable = (done ?? []).filter((d) => d.winner && d.winner !== 'Tie');
  type Pt = { p: number; won: number };
  const fav: Pt[] = [], brier: number[] = [], half: number[] = [];
  const matches: { id: string; name: string; fmt: string; winner: string; halfway: number; points: number }[] = [];
  for (const d of usable) {
    const mdl = model(dataKey(d));
    if (!mdl) continue;
    let hist: Snap[] = [];
    try { hist = (await get<{ history: Snap[] }>(`/match?id=${encodeURIComponent(d.id)}`)).history ?? []; } catch { continue; }
    const pts: { probs: Record<string, number> }[] = [];
    for (const h of hist) {
      const innings = h.s.map((x, i) => ({ team: d.innings[i]?.team ?? '', r: x[0], w: x[1], o: x[2], label: '' }));
      if (!innings.length || innings.some((i) => !i.team)) continue;
      const m = { id: d.id, name: d.name, series: '', fmt: d.fmt, gender: d.gender, teams: d.teams, short: {}, venue: '', start: d.start, status: '', started: true, ended: false, innings } as LiveMatch;
      const probs = quickWin(mdl, m, 300);
      if (probs) pts.push({ probs });
    }
    if (!pts.length) continue;
    for (const { probs } of pts) {
      const [k, p] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
      fav.push({ p, won: k === d.winner ? 1 : 0 });
      // multi-outcome Brier, halved so two outcomes read on the usual 0 to 0.25 coin-flip scale
      const outs = Object.keys(probs);
      brier.push(outs.reduce((a, o) => a + (probs[o] - (o === d.winner ? 1 : 0)) ** 2, 0) / 2);
    }
    const mid = pts[Math.floor(pts.length / 2)].probs;
    const midFav = Object.entries(mid).sort((a, b) => b[1] - a[1])[0][0];
    half.push(midFav === d.winner ? 1 : 0);
    matches.push({ id: d.id, name: d.name, fmt: d.fmt, winner: d.winner!, halfway: mid[d.winner!] ?? 0, points: pts.length });
  }
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const bins = [[30, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 101]];
  const calib = bins.map(([lo, hi]) => {
    const inBin = fav.filter((f) => f.p * 100 >= lo && f.p * 100 < hi);
    return { bin: `${lo}–${Math.min(hi, 100)}%`, n: inBin.length, rate: avg(inBin.map((f) => f.won)) };
  }).filter((c) => c.n > 0);
  const rec = {
    updated: new Date().toISOString(),
    since: usable.length ? usable[usable.length - 1].start : null,
    matches,
    summary: { n: half.length, halfway: avg(half), brier: avg(brier), points: fav.length, calib },
  };
  mkdirSync(join(dataDir, 'live'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(rec));
  console.log(`record: ${matches.length} matches, ${fav.length} predictions, Brier ${rec.summary.brier.toFixed(3)}`);
}

main().catch((e) => { console.log(`record: skipped (${(e as Error).message})`); });
