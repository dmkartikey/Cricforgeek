import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePageMeta } from '../lib/meta';
import { BASE_URL, useData } from '../lib/data';
import { fullName, norm, searchPlayers, type PlayerRow } from '../lib/nameSearch';
import { useSettings } from '../lib/settings';
import { FAM_LABEL } from '../lib/labels';
import { initials, n0, signed } from '../lib/fmt';
import { flagCode, flagUrl, badgeColour } from '../lib/teamflags';
import { ErrorBox, Loader, Mini, Panel, Seg, TeamMark } from '../components/ui';
import { Table } from '../components/Table';
import { ViewBar } from '../components/ViewBar';

// search.json players: [id, name, register name, gender, main team, from, to, matches, formats, full names]
type Row = PlayerRow;
type BoardRow = [string, string, number, { b?: number; r?: number; w?: number; o?: number; imp?: number; t?: string }];
const FAM_SHORT: Record<string, string> = { TEST: 'Test', FC: 'FC', ODI: 'ODI', LA: 'List A', T20: 'T20', HUN: '100', MD: 'MD' };
// team colours for the initials circles when there's no photo
const TEAM_COLOUR: Record<string, string> = { India: '#1F5AA6', Australia: '#C9A227', England: '#1D3A6E', 'South Africa': '#1E7B4F', 'New Zealand': '#2A2D33',
  Pakistan: '#1C6B3A', 'Sri Lanka': '#1C4E9E', 'West Indies': '#7A1F35', Bangladesh: '#127A52', Afghanistan: '#1F57A6', Zimbabwe: '#B8322E', Ireland: '#2C8A4A' };
const teamColour = (t: string) => TEAM_COLOUR[t.replace(/ Women$/, '')] ?? badgeColour(t);
const TEAMS = ['India', 'Australia', 'England', 'South Africa', 'New Zealand', 'Pakistan', 'Sri Lanka', 'West Indies', 'Bangladesh', 'Afghanistan', 'Zimbabwe', 'Ireland'];

function Avatar({ id, name, team, photo, size = 56 }: { id: string; name: string; team: string; photo: boolean; size?: number }) {
  const code = flagCode(team);
  return (
    <span className="pt-av" style={{ width: size, height: size, ['--tc' as string]: teamColour(team) }}>
      {photo ? <img src={`${BASE_URL}photos/${id}.webp`} alt="" loading="lazy" decoding="async" /> : <b>{initials(name)}</b>}
      {code && <img className="pt-flag" src={flagUrl(code)} alt="" loading="lazy" />}
    </span>
  );
}

/** A player tile for the grid: photo or initials, full name, team, span, formats and matches. */
function Tile({ p, photo, fmt }: { p: Row; photo: boolean; fmt: string }) {
  const full = fullName(p);
  return (
    <Link to={`/player/${p[0]}`} className="ptile">
      <Avatar id={p[0]} name={full || p[1]} team={p[4]} photo={photo} />
      <span className="pt-body">
        <b className="pt-name">{full || p[1]}</b>
        <span className="pt-sub">{full && full !== p[1] ? `${p[1]} · ` : ''}{p[4]}</span>
        <span className="pt-tags">
          {p[8].split(',').map((f) => <i key={f} className={f === fmt ? 'on' : ''} title={FAM_LABEL[f] ?? f}>{FAM_SHORT[f] ?? f}</i>)}
        </span>
      </span>
      <span className="pt-meta"><b>{n0(p[7])}</b><small>matches</small><small>{p[5]}–{String(p[6]).slice(2)}</small></span>
    </Link>
  );
}

/** A horizontal row of featured players from one leaderboard. */
function Rail({ title, sub, rows, photos, stat, to, names }: { title: string; sub: string; rows: BoardRow[]; photos: Record<string, string>; stat: (r: BoardRow) => [string, string]; to?: string; names: Map<string, string> }) {
  if (!rows.length) return null;
  return (
    <section className="rail fade-in">
      <div className="rail-head"><div><h2>{title}</h2><p>{sub}</p></div>{to && <Link className="link" to={to}>Full leaderboard →</Link>}</div>
      <div className="rail-row">
        {rows.slice(0, 12).map((r, i) => {
          const [big, small] = stat(r);
          const team = r[3]?.t ?? '';
          return (
            <Link key={r[0]} to={`/player/${r[0]}`} className={`rcard${photos[r[0]] ? ' has-photo' : ''}`}>
              <span className="rc-rank">{i + 1}</span>
              <span className="rc-photo">
                {photos[r[0]] ? <img src={`${BASE_URL}photos/${r[0]}.webp`} alt="" loading="lazy" decoding="async" /> : <b style={{ background: teamColour(team) }}>{initials(names.get(r[0]) || r[1])}</b>}
              </span>
              <span className="rc-band">
                <b className="rc-name" title={r[1]}>{names.get(r[0]) || r[1]}</b>
                <span className="rc-team">{team && <TeamMark name={team} size={12} />}{team}</span>
                <span className="rc-stat"><b>{big}</b><small>{small}</small></span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function Players() {
  const s = useSettings();
  const { data, error } = useData<{ players: Row[] }>('search.json');
  const photos = useData<Record<string, string>>('photos/index.json').data ?? {};
  const homeIdx = useData<any>('home.json').data;
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  usePageMeta('Players');
  const [scope, setScope] = useState<'fmt' | 'any'>('fmt');
  const [active, setActive] = useState<'all' | 'now'>('now');
  const [team, setTeam] = useState(sp.get('team') ?? '');
  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [shown, setShown] = useState(36);
  // leaderboards for the rails: this format and gender, full members and big leagues where available
  const scopeKey = useMemo(() => {
    const keys: string[] = (homeIdx?.scopes ?? []).map((x: any) => x.key);
    return ['top', 'intl', 'all'].map((l) => `${s.fmt}-${s.gender}-${l}`).find((k) => keys.includes(k)) ?? null;
  }, [homeIdx, s.fmt, s.gender]);
  const home = useData<any>(scopeKey ? `home/${scopeKey}.json` : null).data;
  const names = useMemo(() => new Map((data?.players ?? []).map((p) => [p[0], fullName(p)] as [string, string]).filter((x) => x[1])), [data]);
  const board = (key: string): BoardRow[] => home?.boards?.find((b: any) => b.key === key)?.rows ?? [];

  const rows = useMemo(() => {
    if (!data) return [];
    const cur = new Date().getFullYear() - 1;
    const keep = (p: Row) => p[3] === s.gender && (scope === 'any' || p[8].split(',').includes(s.fmt)) && (active === 'all' || p[6] >= cur) && (!team || p[4] === team);
    if (!norm(q)) return data.players.filter(keep).sort((a, b) => b[7] - a[7]);
    const byName = searchPlayers(data.players, q, 300, keep);
    if (byName.length) return byName;
    return data.players.filter((p) => keep(p) && norm(p[4]).includes(norm(q)));
  }, [data, q, s.gender, s.fmt, scope, active, team]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loader text="Loading players" />;
  const total = data.players.filter((p) => p[3] === s.gender).length;
  const browsing = !norm(q) && !team;
  const fl = FAM_LABEL[s.fmt];
  const pickTeam = (t: string) => { setTeam(t === team ? '' : t); setShown(36); const n = new URLSearchParams(sp); if (t && t !== team) n.set('team', t); else n.delete('team'); setSp(n, { replace: true }); };

  return (
    <>
      <section className="players-hero fade-in">
        <div className="ph-text">
          <div className="eyebrow">Directory · {s.gender === 'male' ? 'Men' : 'Women'}</div>
          <h1>Players</h1>
          <p className="lede">{n0(total)} cricketers with ball-by-ball records. Search by name (full names work, so do typos), or by team.</p>
        </div>
        <label className="ph-search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(36); }} placeholder="Try “virat kohli”, “bumrah” or “Pakistan”" aria-label="Search players" />
          {q && <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQ('')}>×</button>}
        </label>
        <div className="ph-teams" role="group" aria-label="Team">
          {TEAMS.map((t) => (
            <button key={t} type="button" aria-pressed={team === t} onClick={() => pickTeam(t)} title={t}>
              <TeamMark name={t} size={16} /><span>{t}</span>
            </button>
          ))}
        </div>
      </section>
      <ViewBar />

      {browsing && home && (
        <>
          <Rail title="In form" sub={`Biggest batting impact in ${fl} cricket over the last 365 days.`} rows={board('bat_imp:365')} photos={photos} names={names}
            stat={(r) => [signed(r[2], 0), `impact · ${n0(r[3]?.r)} runs`]} to="/#leaders" />
          <Rail title="Taking wickets" sub={`Most wickets in ${fl} cricket over the last 365 days.`} rows={board('bowl_wkts:365')} photos={photos} names={names}
            stat={(r) => [n0(r[2]), `wickets · ${n0(r[3]?.b)} balls`]} to="/#leaders" />
          <Rail title="When it matters" sub="Best batting on the balls where the result swings most, last 365 days." rows={board('clutch:365')} photos={photos} names={names}
            stat={(r) => [signed(r[2], 0), 'runs above average under pressure']} />
        </>
      )}

      <Panel flush title={team ? `${team} players` : norm(q) ? `Results for “${q}”` : 'Browse every player'}
        sub={`${n0(rows.length)} players${scope === 'fmt' ? ` who have played ${fl}` : ''}${active === 'now' ? ', active in the last two years' : ''}. Most matches first.`}
        tools={<>
          <Mini label="Format" value={scope} onChange={setScope} options={[['fmt', fl], ['any', 'Any']]} />
          <Mini label="Active" value={active} onChange={setActive} options={[['now', 'Recently'], ['all', 'Ever']]} />
          {team && <button type="button" className="chip" aria-pressed="true" onClick={() => pickTeam(team)}>{team} ×</button>}
          <span style={{ marginLeft: 'auto' }}><Seg label="View" value={view} onChange={setView} options={[['grid', 'Cards'], ['table', 'Table']]} /></span>
        </>}>
        {!rows.length ? <div className="empty">No players match. Try fewer letters, or switch Active to “Ever”.</div>
          : view === 'grid' ? (
            <div className="ptile-wrap">
              <div className="ptile-grid">{rows.slice(0, shown).map((p) => <Tile key={p[0]} p={p} photo={!!photos[p[0]]} fmt={s.fmt} />)}</div>
              {rows.length > shown && <button type="button" className="btn" onClick={() => setShown(shown + 48)}>Show more ({n0(rows.length - shown)} left)</button>}
            </div>
          ) : (
            <Table key={q + scope + active + team} rank rows={rows} sort="m" limit={50} cols={[
              { key: 'n', label: 'Player', left: true, get: (p: Row) => fullName(p) || p[1], fmt: (v, p: Row) => <><Link className="link" to={`/player/${p[0]}`}>{v}</Link>{v !== p[1] && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{p[1]}</span>}</> },
              { key: 't', label: 'Main team', left: true, get: (p: Row) => p[4] },
              { key: 'f', label: 'Formats', left: true, sortable: false, get: (p: Row) => p[8], fmt: (v: string) => <span className="row fmt-tags" style={{ gap: 4 }}>{v.split(',').map((f) => <span key={f} title={FAM_LABEL[f] ?? f} className={`tag ${f === s.fmt ? 'accent' : ''}`}>{FAM_SHORT[f] ?? f}</span>)}</span> },
              { key: 's', label: 'Span', get: (p: Row) => p[5], fmt: (_, p: Row) => `${p[5]}–${p[6]}` },
              { key: 'm', label: 'Matches', get: (p: Row) => p[7], fmt: n0 },
            ]} />
          )}
      </Panel>
      <div className="muted" style={{ fontSize: 12 }}>Want two players side by side? <Link className="link" to="/compare">Compare players</Link> or <Link className="link" to="/h2h">see a batter v bowler head to head</Link>.</div>
    </>
  );
}

