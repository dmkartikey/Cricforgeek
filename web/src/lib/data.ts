import { useEffect, useState } from 'react';

export const BASE_URL = import.meta.env.BASE_URL + 'data/';
// Player photo address. The version matches the framing version in pipeline/scripts/photos.py (V): when every photo is
// re-made, bumping it makes browsers fetch the new files instead of showing the copies they saved before.
export const PHOTO_V = 'v4';
export const photoUrl = (id: string) => `${BASE_URL}photos/${id}.webp?${PHOTO_V}`;
const BASE = BASE_URL;
const cache = new Map<string, Promise<unknown>>();

// Preview builds (VITE_PREVIEW=1) read bundled "shard" files instead of one file per page,
// for hosts that cap the number of files. Shard = string hash of the key, mod the shard count.
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1';
const SHARDS: Record<string, number> = { players: 160, teams: 32, matches: 96, comps: 16 };
export const shardOf = (key: string, n: number) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h % n;
};

export function load<T = unknown>(path: string): Promise<T> {
  const m = PREVIEW ? path.match(/^(players|teams|matches|comps)\/(.+)\.json$/) : null;
  if (m && m[2] !== 'index') {
    const [, kind, key] = m;
    return loadRaw<Record<string, T>>(`shards/${kind}/s${shardOf(key, SHARDS[kind])}.json`).then((o) => {
      if (!(key in o)) throw new Error('Not found');
      return o[key];
    });
  }
  return loadRaw<T>(path);
}

function loadRaw<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `Could not load data (${r.status})`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export function useData<T = any>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null, error: null, loading: !!path,
  });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load<T>(path)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((e: Error) => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
  }, [path]);
  return state;
}
