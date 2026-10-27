import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { load } from '../lib/data';
import { dateShort, overs } from '../lib/fmt';
import { isFullMember, useLive, type LiveMatch } from '../lib/live';

// The latest internationals between top teams (the 12 full members), men's and women's, every format, newest first.
// Ball-by-ball matches come from the nightly data; newer results come from the live feed until the data catches up.

type Inn = { team: string; r: number; w: number; o: string };
type Item = {
  key: string; date: string; fmt: 'TEST' | 'ODI' | 'T20'; gender: 'male' | 'female'; teams: [string, string]; innings: Inn[];
  result: string; winner: string | null; venue?: string; comp?: string; matchId?: string; liveId?: string;
};
type Done = { id: string; name: string; fmt: LiveMatch['fmt']; gender: string; teams: [string, string]; start: string; status: string; winner: string | null; innings: LiveMatch['innings'] };
type Row = [string, string, string, string, string, string, string | null, string, number | null, number | null, string, boolean, boolean, [string, number, number, number][]];

const KEYS = [['T20', 'male'], ['ODI', 'male'], ['TEST', 'male'], ['T20', 'female'], ['ODI', 'female'], ['TEST', 'female']] as const;
const FMT: Record<string, string> = { T20: 'T20I', ODI: 'ODI', TEST: 'Test' };
const base = (t: string) => t.replace(/\s+Women$/i, '');
const sameTeams = (a: [string, string], b: [string, string]) => [base(a[0]), base(a[1])].sort().join('|') === [base(b[0]), base(b[1])].sort().join('|');

function fromRow(r: Row, fmt: Item['fmt'], gender: Item['gender']): Item {
  const result = r[6] ? `${r[6]} won${r[8] ? ` by ${r[8]} runs` : r[9] ? ` by ${r[9]} wkts` : ''}` : r[7] === 'draw' ? 'Match drawn' : r[7] === 'tie' ? 'Match tied' : 'No result';
  return { key: `m${r[0]}`, date: r[1], fmt, gender, teams: [r[4], r[5]], innings: r[13].map((x) => ({ team: x[0], r: x[1], w: x[2], o: overs(x[3]) })),
    result, winner: r[6], venue: r[10], comp: r[3], matchId: r[0] };
}

export default function LatestStrip() {
  const [rows, setRows] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'male' | 'female' | 'TEST' | 'ODI' | 'T20'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const { data: done } = useLive<Done[]>('/done', 300_000);
  useEffect(() => {
    let live = true;
    Promise.all(KEYS.map(([f, g]) => load<Row[]>(`matches/index-${f}-${g}.json`).then((rs) => rs.filter((r) => r[12] && isFullMember(r[4]) && isFullMember(r[5])).slice(0, 40).map((r) => fromRow(r, f, g))).catch(() => [] as Item[])))
      .then((all) => live && setRows(all.flat()));
    return () => { live = false; };
  }, []);
  const items = useMemo(() => {
    const known = rows ?? [];
    const feed: Item[] = (done ?? []).filter((d) => d.teams.every(isFullMember))
      .map((d) => ({ key: `l${d.id}`, date: d.start.slice(0, 10), fmt: d.fmt, gender: d.gender as Item['gender'], teams: d.teams,
        innings: d.innings.map((i) => ({ team: i.team, r: i.r, w: i.w, o: String(i.o) })), result: d.status, winner: d.winner,
        comp: d.name.split(',').slice(1).join(',').trim(), liveId: d.id }))
      // skip feed results the ball-by-ball data already has (same teams, format and day)
      .filter((f) => !known.some((k) => k.fmt === f.fmt && k.date === f.date && sameTeams(k.teams, f.teams)));
    return [...feed, ...known].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  }, [rows, done]);
  const shown = items.filter((i) => filter === 'all' || i.gender === filter || i.fmt === filter);
  const sel = shown.find((i) => i.key === open) ?? null;
  if (!rows) return <div className="latest-strip loading" aria-busy="true" />;
  if (!items.length) return null;
  const line = (i: Item, t: string) => i.innings.filter((x) => x.team === t);
  return (
    <section className="latest" aria-labelledby="latest-h">
      <div className="latest-head">
        <div><h2 id="latest-h">Latest from the top teams</h2><p>Internationals between the 12 full members, newest first. Tap a match for the details.</p></div>
        <div className="latest-filters" role="group" aria-label="Filter">
          {([['all', 'All'], ['male', 'Men'], ['female', 'Women'], ['TEST', 'Tests'], ['ODI', 'ODIs'], ['T20', 'T20Is']] as const).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={filter === k} onClick={() => { setFilter(k); setOpen(null); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="latest-strip" role="list">
        {shown.map((i) => (
          <button key={i.key} role="listitem" className={`lm${open === i.key ? ' on' : ''}`} onClick={() => setOpen(open === i.key ? null : i.key)} aria-expanded={open === i.key}>
            <span className="lm-top"><span>{dateShort(i.date)}</span><span className="lm-fmt">{FMT[i.fmt]}{i.gender === 'female' ? ' · W' : ''}</span></span>
            {i.teams.map((t) => (
              <span key={t} className={`lm-row${i.winner === t ? ' w' : ''}`}><span className="lm-t">{base(t)}</span>
                <b>{line(i, t).map((x) => `${x.r}${x.w < 10 ? `/${x.w}` : ''}`).join(' & ') || '–'}</b></span>
            ))}
            <span className="lm-res">{i.result}</span>
            {i.liveId && <span className="lm-new">New</span>}
          </button>
        ))}
      </div>
      {sel && (
        <div className="latest-detail fade-in">
          <div className="ld-head">
            <div><span className="ld-eb">{FMT[sel.fmt]}{sel.gender === 'female' ? " · Women's" : ''} · {dateShort(sel.date)}{sel.comp ? ` · ${sel.comp}` : ''}</span>
              <h3>{base(sel.teams[0])} v {base(sel.teams[1])}</h3><p>{sel.result}{sel.venue ? ` · ${sel.venue}` : ''}</p></div>
            <button className="btn" onClick={() => setOpen(null)} aria-label="Close details">Close</button>
          </div>
          <table className="tbl ld-tbl">
            <thead><tr><th scope="col">Innings</th><th scope="col">Team</th><th scope="col">Score</th><th scope="col">Overs</th></tr></thead>
            <tbody>{sel.innings.map((x, n) => <tr key={n}><td>{n + 1}</td><td>{x.team}</td><td><b>{x.r}{x.w < 10 ? `/${x.w}` : ''}</b></td><td>{x.o}</td></tr>)}</tbody>
          </table>
          <div className="ld-actions">
            {sel.matchId ? <Link className="btn primary" to={`/match/${sel.matchId}`}>Full scorecard, worm and win probability</Link>
              : <span className="muted">The full ball-by-ball scorecard appears here once Cricsheet publishes this match, usually within a few days.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
