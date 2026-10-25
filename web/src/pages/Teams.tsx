import { useMemo, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { FAM_LABEL } from '../lib/labels';
import { n0, pct } from '../lib/fmt';
import { ErrorBox, Loader, Mini, MiniSearch, Panel } from '../components/ui';

// teams/index.json: [key, name, gender, {format: [played, won]}]
type Row = [string, string, string, Record<string, [number, number]>];
const FULL = ['Afghanistan', 'Australia', 'Bangladesh', 'England', 'India', 'Ireland', 'New Zealand', 'Pakistan', 'South Africa', 'Sri Lanka', 'West Indies', 'Zimbabwe'];

export default function Teams() {
  usePageMeta('Teams');
  const s = useSettings();
  const { data, error } = useData<Row[]>('teams/index.json');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'p' | 'wp'>('p');
  const [min, setMin] = useState<'5' | '25' | '100'>('5');
  const rows = useMemo(() => (data ?? [])
    .filter((t) => t[2] === s.gender && (t[3][s.fmt]?.[0] ?? 0) >= +min && (!q || t[1].toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (sort === 'p' ? b[3][s.fmt][0] - a[3][s.fmt][0] : b[3][s.fmt][1] / b[3][s.fmt][0] - a[3][s.fmt][1] / a[3][s.fmt][0])), [data, s.gender, s.fmt, q, sort, min]);
  const [shown, setShown] = useState(48);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading teams" />;
  const strip = (n: string) => n.replace(/ Women$/, '');
  const full = rows.filter((t) => FULL.includes(strip(t[1])));
  const other = rows.filter((t) => !FULL.includes(strip(t[1])));
  const Card = ({ t }: { t: Row }) => {
    const [p, w] = t[3][s.fmt];
    const others = Object.entries(t[3]).filter(([k]) => k !== s.fmt).sort((a, b) => b[1][0] - a[1][0]);
    return (
      <Link to={`/team/${t[0]}`} className="idx-card">
        <span className="t">{t[1]}</span>
        <span className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: 13 }}>{n0(p)} played · {n0(w)} won</span>
          <b className="mono" style={{ color: 'var(--accent)' }}>{pct(w / p, 0)}</b>
        </span>
        <span className="wl-bar"><i style={{ width: `${(100 * w) / p}%`, background: 'var(--accent)' }} /></span>
        {others.length > 0 && <span className="m">Also {others.slice(0, 3).map(([k, v]) => `${FAM_LABEL[k] ?? k} (${v[0]})`).join(' · ')}</span>}
      </Link>
    );
  };
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Directory · {FAM_LABEL[s.fmt]} · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Teams</h1>
          <p className="lede">{n0(rows.length)} teams with at least {min} {FAM_LABEL[s.fmt]} matches. Win % counts every match played, including draws and no results.</p>
        </div>
      </section>
      <Panel tools={<>
        <MiniSearch value={q} onChange={setQ} placeholder="Find a team" />
        <Mini label="Sort" value={sort} onChange={setSort} options={[['p', 'Most played'], ['wp', 'Win %']]} />
        <Mini label="Min matches" value={min} onChange={setMin} options={[['5', '5'], ['25', '25'], ['100', '100']]} />
      </>} />
      {full.length > 0 && (
        <>
          <h3>Full members</h3>
          <div className="grid g4 stagger">{full.map((t) => <Card key={t[0]} t={t} />)}</div>
        </>
      )}
      {other.length > 0 && (
        <>
          <h3>{full.length ? 'Other teams' : 'Teams'}</h3>
          <div className="grid g4">{other.slice(0, shown).map((t) => <Card key={t[0]} t={t} />)}</div>
          {other.length > shown && <div><button className="btn" onClick={() => setShown(shown + 48)}>Show more ({other.length - shown} left)</button></div>}
        </>
      )}
      {!rows.length && <div className="empty">No teams match.</div>}
    </>
  );
}
