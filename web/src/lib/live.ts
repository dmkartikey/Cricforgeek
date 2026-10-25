import { useEffect, useState } from 'react';
import { load } from './data';
import { batFactor, bowlFactor, LimData, MdData } from './predict';
import { baseTeam, dataKey, type LiveMatch } from './winline';
export * from './winline';

// The live feed is served by the cricforgeek-live Cloudflare Worker.
export const LIVE_API = (import.meta.env.VITE_LIVE_API as string | undefined) ?? 'https://cricforgeek-live.dmkartikey.workers.dev';

// Fetch a live endpoint and refresh it every minute while the page is open.
export function useLive<T>(path: string | null, every = 60_000) {
  const [state, setState] = useState<{ data: T | null; error: string | null; at: number }>({ data: null, error: null, at: 0 });
  useEffect(() => {
    if (!path) return;
    let live = true, timer: ReturnType<typeof setTimeout>;
    const go = async () => {
      try {
        const r = await fetch(LIVE_API + path, { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error(`The live feed answered ${r.status}`);
        const data = (await r.json()) as T;
        if (live) setState({ data, error: null, at: Date.now() });
      } catch (e) {
        if (live) setState((s) => ({ ...s, error: s.data ? null : 'The live feed is not reachable right now. It will retry every minute.' }));
      }
      if (live && document.visibilityState !== 'hidden') timer = setTimeout(go, every);
      else if (live) timer = setTimeout(go, every * 5);
    };
    go();
    return () => { live = false; clearTimeout(timer); };
  }, [path, every]);
  return state;
}

export function ago(iso?: string) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}

// ---------- names in the feed -> our player records ----------
type SearchIdx = { players: [string, string, string, string, string, number, number, number, string][] };
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s-]/g, '').trim();

export function findPlayer(idx: SearchIdx | null, fullName: string, team: string, gender: string) {
  if (!idx || !fullName) return null;
  const words = plain(fullName).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const last = words[words.length - 1], first = words[0][0];
  const t = baseTeam(team);
  let best: { id: string; name: string; score: number } | null = null;
  for (const p of idx.players) {
    if (p[3] !== gender) continue;
    const pw = plain(p[1]).split(/\s+/);
    const fw = plain(p[2]).split(/\s+/);
    const lastHit = pw[pw.length - 1] === last || fw[fw.length - 1] === last;
    if (!lastHit) continue;
    let score = 1;
    if (plain(p[2]) === plain(fullName) || plain(p[1]) === plain(fullName)) score += 5;
    if (pw[0]?.[0] === first || fw[0]?.[0] === first) score += 2;
    if (p[4] === t) score += 3;
    score += Math.min(2, (p[6] - 2015) / 5); // recently active
    if (!best || score > best.score) best = { id: p[0], name: p[1], score };
  }
  return best && best.score >= 4 ? best : null;
}

export type PlayerFx = { id?: string; name: string; rf: number; wf: number; n: number };
// Load each player's record in this format and turn it into run and wicket factors.
export async function playerFactors(idx: SearchIdx | null, names: { name: string; team: string }[], fk: string, gender: string, role: 'bat' | 'bowl') {
  const out: Record<string, PlayerFx> = {};
  await Promise.all(names.map(async ({ name, team }) => {
    const hit = findPlayer(idx, name, team, gender);
    if (!hit) { out[name] = { name, rf: 1, wf: 1, n: 0 }; return; }
    try {
      const p = await load<any>(`players/${hit.id}.json`);
      const f = role === 'bat' ? batFactor(p.summary?.[fk]?.bat) : bowlFactor(p.summary?.[fk]?.bowl);
      out[name] = { id: hit.id, name, ...f };
    } catch { out[name] = { id: hit.id, name, rf: 1, wf: 1, n: 0 }; }
  }));
  return out;
}

export const modelPath = (m: LiveMatch) => `predict/${dataKey(m)}.json`;
export type ModelData = LimData | MdData;
