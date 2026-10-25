import { useEffect, useMemo, useRef } from 'react';
import { BASE_URL, useData } from '../lib/data';
import { buildCard } from '../lib/card';
import { mountCard } from '../lib/cardfx';
import '../card.css';

// The player card: shown for players with a free-licence photo (top teams for now). Tap to reveal the stats.
export function usePlayerCard(p: any, fk: string) {
  const photos = useData<Record<string, string>>('photos/index.json');
  return useMemo(() => (p && fk && photos.data && p.id in photos.data ? buildCard(p, fk, photos.data[p.id], `${BASE_URL}photos/${p.id}.webp`) : null), [p, fk, photos.data]);
}

export default function PlayerCard({ card, back = false, hint = true }: { card: NonNullable<ReturnType<typeof usePlayerCard>>; back?: boolean; hint?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) mountCard(ref.current, card, back); }, [card.id, card.fmt, back]); // eslint-disable-line
  return (
    <div className="pcard">
      <div className="stage" ref={ref} />
      {hint && <div className="pcard-hint">{back ? 'Tap to turn it over' : 'Tap the card to reveal all the stats'}</div>}
    </div>
  );
}
