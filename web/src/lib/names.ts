import { useCallback } from 'react';
import { useData } from './data';

// Players' everyday full names ("Virat Kohli" for the scorecard-style "V Kohli"), from names.json, which the nightly
// build writes from Wikidata. Players without one keep their scorecard name.
const EMPTY: Record<string, string> = {};

export function useFullName() {
  const names = useData<Record<string, string>>('names.json').data ?? EMPTY;
  return useCallback((id: string | null | undefined, fallback: string) => (id && names[id]) || fallback, [names]);
}
