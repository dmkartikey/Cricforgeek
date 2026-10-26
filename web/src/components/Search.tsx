import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { load } from '../lib/data';
import { fullName, searchPlayers, type PlayerRow } from '../lib/nameSearch';

type SearchIdx = {
  players: PlayerRow[];
  teams: [string, string, string, number][];
  comps: [string, string, string, number][];
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function Search() {
  const [idx, setIdx] = useState<SearchIdx | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !/input|textarea|select/i.test(t.tagName)) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ensure = () => { if (!idx) load<SearchIdx>('search.json').then(setIdx).catch(() => null); };

  const results = useMemo(() => {
    if (!idx || q.trim().length < 2) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (s: string) => { const n = norm(s); return words.every((w) => n.includes(w)); };
    const out: { href: string; label: string; meta: string; group: string }[] = [];
    for (const p of searchPlayers(idx.players, q, 10)) {
      const full = fullName(p);
      out.push({ href: `/player/${p[0]}`, label: full && norm(full) !== norm(p[1]) ? `${full} (${p[1]})` : p[1], meta: `${p[3] === 'female' ? 'Women · ' : ''}${p[4]} · ${p[5]}–${p[6]}`, group: 'Players' });
    }
    let t = 0;
    for (const x of idx.teams) { if (t >= 5) break; if (hit(x[1])) { t++; out.push({ href: `/team/${x[0]}`, label: x[1] + (x[2] === 'female' ? ' (women)' : ''), meta: `${x[3]} matches`, group: 'Teams' }); } }
    let c = 0;
    for (const x of idx.comps) { if (c >= 5) break; if (hit(x[1] + ' ' + x[2])) { c++; out.push({ href: `/league/${x[0]}`, label: x[1], meta: x[2], group: 'Competitions' }); } }
    return out;
  }, [idx, q]);

  const go = (href: string) => { setOpen(false); setQ(''); input.current?.blur(); nav(href); };

  return (
    <div className="search">
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input ref={input} value={q} placeholder="Search players, teams…" aria-label="Search"
        onFocus={() => { ensure(); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setHl(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(results.length - 1, h + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)); }
          if (e.key === 'Enter' && results[hl]) go(results[hl].href);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }} />
      {!q && <kbd>/</kbd>}
      {open && q.trim().length >= 2 && (
        <div className="search-pop" role="listbox">
          {!idx && <div className="empty-row muted">Loading index…</div>}
          {idx && !results.length && <div className="empty-row muted">No match.</div>}
          {results.map((r, i) => (
            <div key={r.href}>
              {(i === 0 || results[i - 1].group !== r.group) && <div className="search-group">{r.group}</div>}
              <Link to={r.href} className={i === hl ? 'hl' : ''} onMouseDown={(e) => { e.preventDefault(); go(r.href); }}>
                <span>{r.label}</span><small>{r.meta}</small>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
