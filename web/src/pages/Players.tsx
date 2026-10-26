import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/meta';

import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { norm, searchPlayers, type PlayerRow } from '../lib/nameSearch';
import { useSettings } from '../lib/settings';
import { FAM_LABEL } from '../lib/labels';
import { n0 } from '../lib/fmt';
import { ErrorBox, Loader, Mini, MiniSearch, Panel } from '../components/ui';
import { Table } from '../components/Table';

// search.json players: [id, name, register name, gender, main team, from, to, matches, formats, full names]
type Row = PlayerRow;
// short tags keep the formats column narrow enough for phones; the full name is in the tooltip
const FAM_SHORT: Record<string, string> = { TEST: 'Test', FC: 'FC', ODI: 'ODI', LA: 'List A', T20: 'T20', HUN: '100', MD: 'MD' };

export default function Players() {
  const s = useSettings();
  const { data, error } = useData<{ players: Row[] }>('search.json');
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  usePageMeta('Players');
  const [scope, setScope] = useState<'fmt' | 'any'>('fmt');
  const [active, setActive] = useState<'all' | 'now'>('now');
  const rows = useMemo(() => {
    if (!data) return [];
    const cur = new Date().getFullYear() - 1;
    const keep = (p: Row) => p[3] === s.gender && (scope === 'any' || p[8].split(',').includes(s.fmt)) && (active === 'all' || p[6] >= cur);
    if (!norm(q)) return data.players.filter(keep);
    // names first (full names, short names, typos); a team name lists that team's players
    const byName = searchPlayers(data.players, q, 300, keep);
    if (byName.length) return byName;
    return data.players.filter((p) => keep(p) && norm(p[4]).includes(norm(q)));
  }, [data, q, s.gender, s.fmt, scope, active]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading players" />;
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Directory · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Players</h1>
          <p className="lede">{n0(rows.length)} players{scope === 'fmt' ? ` who have played ${FAM_LABEL[s.fmt]} cricket` : ''}{active === 'now' ? ', active in the last two years' : ''}. Sorted by matches in the data.</p>
        </div>
        <Link className="btn" to="/compare">Compare players →</Link>
      </section>
      <Panel flush tools={<>
        <MiniSearch value={q} onChange={setQ} placeholder="Name or team" />
        <Mini label="Format" value={scope} onChange={setScope} options={[['fmt', FAM_LABEL[s.fmt]], ['any', 'Any']]} />
        <Mini label="Active" value={active} onChange={setActive} options={[['now', 'Recently'], ['all', 'Ever']]} />
      </>}>
        <div style={{ height: 14 }} />
        <Table key={q + scope + active} rank rows={rows} sort="m" limit={50} cols={[
          { key: 'n', label: 'Player', left: true, get: (p: Row) => p[1], fmt: (v, p: Row) => <><Link className="link" to={`/player/${p[0]}`}>{v}</Link>{p[2] !== p[1] && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{p[2]}</span>}</> },
          { key: 't', label: 'Main team', left: true, get: (p: Row) => p[4] },
          { key: 'f', label: 'Formats', left: true, sortable: false, get: (p: Row) => p[8], fmt: (v: string) => <span className="row fmt-tags" style={{ gap: 4 }}>{v.split(',').map((f) => <span key={f} title={FAM_LABEL[f] ?? f} className={`tag ${f === s.fmt ? 'accent' : ''}`}>{FAM_SHORT[f] ?? f}</span>)}</span> },
          { key: 's', label: 'Span', get: (p: Row) => p[5], fmt: (_, p: Row) => `${p[5]}–${p[6]}` },
          { key: 'm', label: 'Matches', get: (p: Row) => p[7], fmt: n0 },
        ]} />
      </Panel>
    </>
  );
}
