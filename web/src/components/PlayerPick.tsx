import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { fullName, searchPlayers, type PlayerRow } from '../lib/nameSearch';
import { MiniSearch } from './ui';

/** Search box that picks one player (any gender unless one is given). */
export function PlayerPick({ onPick, placeholder = 'Find a player', gender }: { onPick: (id: string, row: PlayerRow) => void; placeholder?: string; gender?: string }) {
  const idx = useData<any>('search.json').data;
  const [q, setQ] = useState('');
  const hits = useMemo(() => (!idx || q.trim().length < 2 ? [] : searchPlayers(idx.players, q, 8, (p: PlayerRow) => !gender || p[3] === gender)), [idx, q, gender]);
  return (
    <div className="stack" style={{ gap: 6, position: 'relative' }}>
      <MiniSearch value={q} onChange={setQ} placeholder={placeholder} />
      {hits.length > 0 && (
        <div className="search-pop" style={{ top: 34, width: '100%' }}>
          {hits.map((p) => (
            <a key={p[0]} href="#" onClick={(e) => { e.preventDefault(); onPick(p[0], p); setQ(''); }}><span>{fullName(p) || p[1]}</span><small>{p[1]} · {p[4]} · {p[5]}–{p[6]}</small></a>
          ))}
        </div>
      )}
    </div>
  );
}
