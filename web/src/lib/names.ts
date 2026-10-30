import { useCallback, useEffect, useState } from 'react';
import { load } from './data';

// Players' everyday full names ("Virat Kohli" for the scorecard-style "V Kohli"), written nightly from Wikidata in
// 16 small pieces by the first character of the player id (names/0.json … names/f.json). A page fetches only the
// pieces for the players it shows. Until a piece arrives (or for players without one) the scorecard name is used.
const shards: Record<string, Record<string, string>> = {};
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function fetchShard(h: string) {
  if (shards[h] || pending.has(h)) return;
  pending.add(h);
  load<Record<string, string>>(`names/${h}.json`)
    .catch(() => ({}))
    .then((d) => { shards[h] = d; pending.delete(h); version++; listeners.forEach((f) => f()); });
}

export function useFullName() {
  const [v, setV] = useState(version);
  useEffect(() => {
    const f = () => setV(version);
    listeners.add(f);
    if (v !== version) f();
    return () => { listeners.delete(f); };
  }, []); // eslint-disable-line
  return useCallback((id: string | null | undefined, fallback: string) => {
    if (!id) return fallback;
    const d = shards[id[0]];
    if (!d) { fetchShard(id[0]); return fallback; }
    return d[id] || fallback;
  }, [v]); // eslint-disable-line
}
