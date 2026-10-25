import { useMemo, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { FAM_LABEL } from '../lib/labels';
import { dateShort, n0, overs } from '../lib/fmt';
import { ErrorBox, Loader, MiniSearch, MiniSelect, Panel } from '../components/ui';

// [id, date, comp, comp label, team1, team2, winner, result, by runs, by wkts, venue, top level, international, [[team, runs, wkts, balls]...]]
type Row = [string, string, string, string, string, string, string | null, string, number | null, number | null, string, boolean, boolean, [string, number, number, number][]];

export default function Matches() {
  usePageMeta('Matches');
  const s = useSettings();
  const { data, error } = useData<Row[]>(`matches/index-${s.fmt}-${s.gender}.json`);
  const [q, setQ] = useState('');
  const [comp, setComp] = useState('all');
  const [shown, setShown] = useState(40);
  const comps = useMemo(() => {
    const m = new Map<string, [string, number]>();
    for (const r of data ?? []) m.set(r[2], [r[3], (m.get(r[2])?.[1] ?? 0) + 1]);
    return [...m.entries()].sort((a, b) => b[1][1] - a[1][1]);
  }, [data]);
  const rows = useMemo(() => (data ?? []).filter((r) => (s.level === 'all' || (s.level === 'top' ? r[11] : r[12]))
    && (comp === 'all' || r[2] === comp) && (!q || (r[4] + ' ' + r[5] + ' ' + r[10]).toLowerCase().includes(q.toLowerCase()))), [data, s.level, comp, q]);
  if (error) return <ErrorBox error={error === 'Not found' ? `No ${FAM_LABEL[s.fmt]} matches for this selection.` : error} />;
  if (!data) return <Loader text="Loading matches" />;
  const res = (r: Row) => (r[6] ? `${r[6]} won${r[8] ? ` by ${r[8]} runs` : r[9] ? ` by ${r[9]} wkts` : ''}` : r[7] === 'draw' ? 'Drawn' : r[7] === 'tie' ? 'Tied' : 'No result');
  // group consecutive innings by team so Tests show "245 & 180/4"
  const teamLine = (r: Row, t: string) => r[13].filter((x) => x[0] === t).map((x) => `${x[1]}${x[2] < 10 ? `/${x[2]}` : ''}`).join(' & ');
  const ovs = (r: Row, t: string) => { const x = r[13].filter((y) => y[0] === t); return x.length === 1 ? ` (${overs(x[0][3])})` : ''; };
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Results · {FAM_LABEL[s.fmt]} · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Matches</h1>
          <p className="lede">The latest {n0(data.length)} {FAM_LABEL[s.fmt]} matches with ball-by-ball records. Open any match for the full scorecard, worm, win probability and turning points.</p>
        </div>
      </section>
      <Panel flush tools={<>
        <MiniSearch value={q} onChange={setQ} placeholder="Team or venue" />
        <MiniSelect label="Competition" value={comp} onChange={setComp} options={[['all', 'All'], ...comps.map(([k, v]) => [k, `${v[0]} (${v[1]})`] as [string, string])]} />
      </>}>
        <div style={{ height: 14 }} />
        {rows.slice(0, shown).map((r) => (
          <Link key={r[0]} to={`/match/${r[0]}`} className="mrow">
            <span className="stack" style={{ gap: 2 }}><span className="d">{dateShort(r[1])}</span><span className="muted" style={{ fontSize: 11 }}>{r[3]}</span></span>
            <span className="tm">
              <span className={r[6] === r[4] ? 'w' : ''}>{r[4]}</span><b>{teamLine(r, r[4])}<small className="muted">{ovs(r, r[4])}</small></b>
              <span className={r[6] === r[5] ? 'w' : ''}>{r[5]}</span><b>{teamLine(r, r[5])}<small className="muted">{ovs(r, r[5])}</small></b>
            </span>
            <span className="res">{res(r)}<div className="muted" style={{ fontSize: 11 }}>{r[10]}</div></span>
          </Link>
        ))}
        {!rows.length && <div className="empty">No matches with these filters. Try "Everything" in the sidebar.</div>}
        {rows.length > shown && <div className="more-row"><button className="btn" onClick={() => setShown(shown + 40)}>Show more ({rows.length - shown} left)</button></div>}
      </Panel>
    </>
  );
}
