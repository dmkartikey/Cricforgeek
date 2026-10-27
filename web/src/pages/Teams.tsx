import { useMemo, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useSettings } from '../lib/settings';
import { FAM_LABEL } from '../lib/labels';
import { flagCode } from '../lib/teamflags';
import { n0, pct } from '../lib/fmt';
import { Chips, ErrorBox, Loader, Mini, MiniSearch, Panel, TeamMark } from '../components/ui';
import { ViewBar } from '../components/ViewBar';

// teams/index.json: [key, name, gender, {format: [played, won]}, {nat, c: [[compKey, label]], last}]
// (the 5th field arrived later; without it, a team counts as national when its name has a flag)
type Extra = { nat?: number; c?: [string, string][]; last?: string };
type Row = [string, string, string, Record<string, [number, number]>, Extra?];
const FULL = ['Afghanistan', 'Australia', 'Bangladesh', 'England', 'India', 'Ireland', 'New Zealand', 'Pakistan', 'South Africa', 'Sri Lanka', 'West Indies', 'Zimbabwe'];
const strip = (n: string) => n.replace(/ Women$/, '');
const isNational = (t: Row) => (t[4]?.nat != null ? t[4].nat === 1 : !!flagCode(t[1]) || strip(t[1]) === 'West Indies');

export default function Teams() {
  usePageMeta('Teams');
  const s = useSettings();
  const { data, error } = useData<Row[]>('teams/index.json');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'p' | 'wp'>('p');
  const [min, setMin] = useState<'5' | '25' | '100'>('5');
  const [show, setShow] = useState<'all' | 'intl' | 'dom'>('all');
  const [leaguesShown, setLeaguesShown] = useState(8);
  const [assocShown, setAssocShown] = useState(24);

  const rows = useMemo(() => (data ?? [])
    .filter((t) => t[2] === s.gender && (t[3][s.fmt]?.[0] ?? 0) >= +min && (!q || t[1].toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (sort === 'p' ? b[3][s.fmt][0] - a[3][s.fmt][0] : b[3][s.fmt][1] / b[3][s.fmt][0] - a[3][s.fmt][1] / a[3][s.fmt][0])), [data, s.gender, s.fmt, q, sort, min]);

  const { full, assoc, leagues } = useMemo(() => {
    const nat = rows.filter(isNational);
    const full = nat.filter((t) => FULL.includes(strip(t[1])));
    const assoc = nat.filter((t) => !FULL.includes(strip(t[1])));
    const groups = new Map<string, { key: string; label: string; teams: Row[]; p: number }>();
    for (const t of rows) {
      if (isNational(t)) continue;
      const [key, label] = t[4]?.c?.[0] ?? ['', 'Other teams'];
      const g = groups.get(key) ?? { key, label, teams: [], p: 0 };
      g.teams.push(t); g.p += t[3][s.fmt][0];
      groups.set(key, g);
    }
    // biggest leagues first; the catch-all group goes last
    const leagues = [...groups.values()].sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.p - a.p));
    return { full, assoc, leagues };
  }, [rows, s.fmt]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading teams" />;
  const fmtLabel = FAM_LABEL[s.fmt];
  const domCount = leagues.reduce((a, g) => a + g.teams.length, 0);
  const showIntl = show !== 'dom' && full.length + assoc.length > 0;
  const showDom = show !== 'intl' && domCount > 0;

  const rec = (t: Row) => t[3][s.fmt];
  const FullCard = ({ t }: { t: Row }) => {
    const [p, w] = rec(t);
    const others = Object.entries(t[3]).filter(([k]) => k !== s.fmt).sort((a, b) => b[1][0] - a[1][0]);
    return (
      <Link to={`/team/${t[0]}`} className="nat-card">
        <TeamMark name={t[1]} size={30} />
        <span className="nat-main">
          <span className="t">{strip(t[1])}</span>
          <span className="m">{n0(p)} played · {n0(w)} won{others.length ? ` · also ${others.slice(0, 2).map(([k]) => FAM_LABEL[k] ?? k).join(', ')}` : ''}</span>
        </span>
        <span className="nat-pct">{pct(w / p, 0)}</span>
        <span className="wl-bar"><i style={{ width: `${(100 * w) / p}%`, background: 'var(--accent)' }} /></span>
      </Link>
    );
  };
  const TeamRow = ({ t, national }: { t: Row; national?: boolean }) => {
    const [p, w] = rec(t);
    return (
      <Link to={`/team/${t[0]}`} className="team-row">
        <TeamMark name={t[1]} national={national} size={24} />
        <span className="t">{strip(t[1])}</span>
        <span className="p mono">{n0(p)}</span>
        <span className="wl-bar"><i style={{ width: `${(100 * w) / p}%`, background: 'var(--accent)' }} /></span>
        <span className="v mono">{pct(w / p, 0)}</span>
      </Link>
    );
  };

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Directory · {fmtLabel} · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Teams</h1>
          <p className="lede">{n0(rows.length)} teams with at least {min} {fmtLabel} matches: national sides first, then every domestic and franchise team grouped by its league.
            Win % counts every match played, including draws and no results.</p>
        </div>
      </section>
      <ViewBar />
      <Panel tools={<>
        <MiniSearch value={q} onChange={setQ} placeholder="Find a team" />
        <Mini label="Sort" value={sort} onChange={setSort} options={[['p', 'Most played'], ['wp', 'Win %']]} />
        <Mini label="Min matches" value={min} onChange={setMin} options={[['5', '5'], ['25', '25'], ['100', '100']]} />
      </>}>
        <Chips label="Show" value={show} onChange={setShow} options={[['all', 'All teams'], ['intl', `National sides (${full.length + assoc.length})`], ['dom', `Domestic & franchise (${domCount})`]]} />
      </Panel>

      {showIntl && (
        <section className="stack" style={{ gap: 14 }}>
          <div className="team-sec-h"><h2>National sides</h2><span className="muted">{fmtLabel} · flag shows the country</span></div>
          {full.length > 0 && (<>
            <h3>Full members</h3>
            <div className="nat-grid stagger">{full.map((t) => <FullCard key={t[0]} t={t} />)}</div>
          </>)}
          {assoc.length > 0 && (<>
            <h3>Associate members and others</h3>
            <Panel flush>
              <div className="team-rows two">
                <div className="team-row head" aria-hidden="true"><span /><span>Team</span><span className="p">Played</span><span /><span className="v">Win %</span></div>
                {assoc.slice(0, assocShown).map((t) => <TeamRow key={t[0]} t={t} national />)}
              </div>
              {assoc.length > assocShown && <div className="panel-foot"><button className="btn" onClick={() => setAssocShown(assocShown + 48)}>Show more ({assoc.length - assocShown} left)</button></div>}
            </Panel>
          </>)}
        </section>
      )}

      {showDom && (
        <section className="stack" style={{ gap: 14 }}>
          <div className="team-sec-h"><h2>Domestic and franchise teams</h2><span className="muted">Grouped by the league each team plays most</span></div>
          <div className="league-grid">
            {leagues.slice(0, leaguesShown).map((g) => (
              <Panel key={g.key || 'other'} flush title={g.key ? <Link className="link-quiet" to={`/league/${g.key}`}>{g.label}</Link> : g.label}
                sub={`${g.teams.length} team${g.teams.length === 1 ? '' : 's'} · ${n0(g.p)} ${fmtLabel} matches`}>
                <div className="team-rows">
                  {g.teams.map((t) => <TeamRow key={t[0]} t={t} national={false} />)}
                </div>
              </Panel>
            ))}
          </div>
          {leagues.length > leaguesShown && <div><button className="btn" onClick={() => setLeaguesShown(leagues.length)}>Show all {leagues.length} leagues</button></div>}
        </section>
      )}
      {!rows.length && <div className="empty">No teams match.</div>}
    </>
  );
}
