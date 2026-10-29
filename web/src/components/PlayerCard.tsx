import { useEffect, useMemo, useRef } from 'react';
import { useData, photoUrl } from '../lib/data';
import { buildCard } from '../lib/card';
import { mountCard } from '../lib/cardfx';
import '../card.css';

// The player card, for every player: their photo when there's a free-licence one, else their initials. Tap to reveal the stats.
export function usePlayerCard(p: any, fk: string) {
  // one of 16 small shards of the photo list (by the first character of the player id)
  const photos = useData<Record<string, string>>(p?.id ? `photos/index-${String(p.id)[0]}.json` : null);
  const ready = !photos.loading;  // wait for the list, so a photo doesn't pop in late
  return useMemo(() => {
    if (!p || !fk || !ready) return null;
    const has = !!photos.data && p.id in photos.data;
    return buildCard(p, fk, has ? photos.data![p.id] : '', has ? photoUrl(p.id) : null);
  }, [p, fk, ready, photos.data]);
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
