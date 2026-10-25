import { ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Search } from './components/Search';
import { PREVIEW, useData } from './lib/data';
import { FMTS, LEVELS, useSettings } from './lib/settings';
import { useBoards } from './lib/pins';
import { dateShort } from './lib/fmt';
import Home from './pages/Home';
import Player from './pages/Player';
import Players from './pages/Players';
import Compare from './pages/Compare';
import Team from './pages/Team';
import Teams from './pages/Teams';
import League from './pages/League';
import Leagues from './pages/Leagues';
import Match from './pages/Match';
import Matches from './pages/Matches';
import Explorer from './pages/Explorer';
import Methodology from './pages/Methodology';
import Pinboard from './pages/Pinboard';

const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const NAV: [string, string, ReactNode][] = [
  ['/', 'Overview', I('M3 12l9-8 9 8M5 10v10h14V10')],
  ['/players', 'Players', I('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4.5-6 8-6s7 2 8 6')],
  ['/compare', 'Compare', I('M8 4v16M16 4v16M3 9h5M16 15h5M3 15h5M16 9h5')],
  ['/teams', 'Teams', I('M4 21V7l8-4 8 4v14M9 21v-6h6v6')],
  ['/competitions', 'Competitions', I('M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3')],
  ['/matches', 'Matches', I('M4 5h16v14H4zM4 10h16M9 5v14')],
  ['/explore', 'Explorer', I('M4 6h16M7 12h10M10 18h4')],
  ['/pinboard', 'My pinboard', I('M9 3h6l-1 6 4 4H6l4-4-1-6zM12 13v8')],
  ['/methodology', 'Methodology', I('M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v.01M11 12h1v5h1')],
];

function Ball() {
  return (
    <svg className="brand-ball" viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="11" fill="var(--red)" />
      <g className="seam"><path d="M6.5 6.5c3.6 3.6 3.6 9.4 0 13M19.5 6.5c-3.6 3.6-3.6 9.4 0 13" fill="none" stroke="#fff" strokeWidth="1.3" strokeDasharray="1.6 1.6" opacity=".9" /></g>
    </svg>
  );
}

const CRUMB: Record<string, string> = { '': 'Overview', player: 'Player', players: 'Players', compare: 'Compare', team: 'Team', teams: 'Teams',
  league: 'Competition', competitions: 'Competitions', match: 'Match', matches: 'Matches', explore: 'Explorer', pinboard: 'My pinboard', methodology: 'Methodology' };

export default function App() {
  const loc = useLocation();
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const meta = useData<any>('home.json').data;
  const boards = useBoards();
  const pins = boards.reduce((a, b) => a + b.pins.length, 0);
  useEffect(() => { window.scrollTo(0, 0); setOpen(false); }, [loc.pathname]);
  const seg = loc.pathname.split('/')[1] ?? '';
  const fmtLabel = FMTS.find((f) => f.k === s.fmt)?.l;
  const dark = s.theme === 'dark';

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Sidebar">
        <Link to="/" className="brand" aria-label="cricforgeek home"><Ball /><span>cric<b>for</b>geek</span></Link>
        <Search />
        <div className="side-sec">
          <span className="side-label">Format</span>
          <div className="fmt-grid" role="group" aria-label="Format">
            {FMTS.map((f) => (
              <button key={f.k} type="button" aria-pressed={s.fmt === f.k} onClick={() => s.set({ fmt: f.k })}>{f.l}<small>{f.s}</small></button>
            ))}
          </div>
        </div>
        <div className="side-sec">
          <span className="side-label">Cricket</span>
          <div className="seg full" role="group" aria-label="Gender">
            <button type="button" aria-pressed={s.gender === 'male'} onClick={() => s.set({ gender: 'male' })}>Men</button>
            <button type="button" aria-pressed={s.gender === 'female'} onClick={() => s.set({ gender: 'female' })}>Women</button>
          </div>
          <select className="input" aria-label="Level" value={s.level} onChange={(e) => s.set({ level: e.target.value as any })}>
            {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <nav className="side-nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>{icon}{label}{to === '/pinboard' && pins > 0 && <span className="count">{pins}</span>}</NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="row">
            <span>Theme</span>
            <div className="seg" role="group" aria-label="Theme">
              <button type="button" aria-pressed={!dark} onClick={() => s.set({ theme: 'light' })}>Light</button>
              <button type="button" aria-pressed={dark} onClick={() => s.set({ theme: 'dark' })}>Dark</button>
            </div>
          </div>
          {meta && <span>Data to <b className="mono" style={{ color: 'var(--text-2)' }}>{dateShort(meta.data_to)}</b> · nightly from <a className="link" href="https://cricsheet.org" target="_blank" rel="noopener noreferrer">Cricsheet</a></span>}
        </div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>cricforgeek</span><i>/</i><b>{CRUMB[seg] ?? 'Page'}</b>
          </nav>
          <span className="spacer" />
          <span className="ctx-pill"><b>{fmtLabel}</b>· {s.gender === 'male' ? 'Men' : 'Women'}</span>
          <span className="ctx-pill hide-sm">{LEVELS.find((l) => l[0] === s.level)?.[1]}</span>
        </header>
        <main className="page" key={loc.pathname}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/players" element={<Players />} />
            <Route path="/player/:id" element={<Player />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/team/:key" element={<Team />} />
            <Route path="/competitions" element={<Leagues />} />
            <Route path="/leagues" element={<Navigate to="/competitions" replace />} />
            <Route path="/league/:key" element={<League />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/match/:id" element={<Match />} />
            <Route path="/tests" element={<Navigate to="/" replace />} />
            <Route path="/explore" element={<Explorer />} />
            <Route path="/pinboard" element={<Pinboard />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<div className="empty">Page not found. <Link className="link" to="/">Go to the overview</Link></div>} />
          </Routes>
        </main>
        <footer className="footer">
          Ball-by-ball data from <a href="https://cricsheet.org" target="_blank" rel="noopener noreferrer">Cricsheet</a> (ODC-By licence).
          Models and inferred zones are cricforgeek's own and explained on the <Link to="/methodology">methodology</Link> page.
          {PREVIEW && ' Preview edition: match pages cover 2022 onwards.'}
        </footer>
      </div>
    </div>
  );
}
