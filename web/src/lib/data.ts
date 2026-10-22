import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL + 'data/';
const cache = new Map<string, Promise<unknown>>();

export function load<T = unknown>(path: string): Promise<T> {
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
