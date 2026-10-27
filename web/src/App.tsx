import React, { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Search } from './components/Search';
import { Loader } from './components/ui';
import { PREVIEW, useData } from './lib/data';
import { useSettings } from './lib/settings';
import { useBoards } from './lib/pins';
import { dateShort } from './lib/fmt';
// Pages load on first visit. After a deploy, an open tab can ask for a page file that no longer exists:
// reload once to pick up the new site instead of showing a blank page.
function page<T extends { default: React.ComponentType<any> }>(load: () => Promise<T>) {
  return lazy(() => load().catch((e) => {
    const key = 'cfg.reloaded';
    try { if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); location.reload(); return new Promise<T>(() => {}); } } catch { /* storage blocked */ }
    throw e;
  }));
}
const Home = page(() => import('./pages/Home'));
const Player = page(() => import('./pages/Player'));
const Players = page(() => import('./pages/Players'));
const Compare = page(() => import('./pages/Compare'));
const Team = page(() => import('./pages/Team'));
const Teams = page(() => import('./pages/Teams'));
const League = page(() => import('./pages/League'));
const Leagues = page(() => import('./pages/Leagues'));
const Match = page(() => import('./pages/Match'));
const Matches = page(() => import('./pages/Matches'));
const Explorer = page(() => import('./pages/Explorer'));
const Methodology = page(() => import('./pages/Methodology'));
const Pinboard = page(() => import('./pages/Pinboard'));
const Live = page(() => import('./pages/Live'));
const Venue = page(() => import('./pages/Venue'));
const Venues = page(() => import('./pages/Venues'));
const Records = page(() => import('./pages/Records'));
const H2H = page(() => import('./pages/H2H'));
const Play = page(() => import('./pages/Play'));

const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const NAV: [string, string, ReactNode][] = [
  ['/', 'Overview', I('M3 12l9-8 9 8M5 10v10h14V10')],
  ['/players', 'Players', I('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1-4 4.5-6 8-6s7 2 8 6')],
  ['/live', 'Live predictions', I('M3 17l5-5 4 4 8-9M14 7h6v6')],
  ['/compare', 'Compare', I('M8 4v16M16 4v16M3 9h5M16 15h5M3 15h5M16 9h5')],
  ['/teams', 'Teams', I('M4 21V7l8-4 8 4v14M9 21v-6h6v6')],
  ['/competitions', 'Competitions', I('M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3')],
  ['/matches', 'Matches', I('M4 5h16v14H4zM4 10h16M9 5v14')],
  ['/venues', 'Grounds', I('M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z')],
  ['/records', 'Records', I('M6 3h12v4a6 6 0 01-12 0V3zM9 21h6M12 13v8')],
  ['/h2h', 'Head to head', I('M7 7h10M7 7l3-3M7 7l3 3M17 17H7M17 17l-3-3M17 17l-3 3')],
  ['/play', 'Card battle', I('M5 4h9l5 5v11H5zM14 4v5h5')],
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

const CRUMB: Record<string, string> = { '': 'Overview', player: 'Player', players: 'Players', compare: 'Compare', live: 'Live predictions', predictor: 'Live predictions', team: 'Team', teams: 'Teams',
  league: 'Competition', competitions: 'Competitions', venue: 'Ground', venues: 'Grounds', records: 'Records', h2h: 'Head to head', play: 'Card battle', match: 'Match', matches: 'Matches', explore: 'Explorer', pinboard: 'My pinboard', methodology: 'Methodology' };

export default function App() {
  const loc = useLocation();
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const meta = useData<any>('meta.json').data; // small, and the player and match pages need it anyway
  const boards = useBoards();
  const pins = boards.reduce((a, b) => a + b.pins.length, 0);
  useEffect(() => { window.scrollTo(0, 0); setOpen(false); }, [loc.pathname]);
  const seg = loc.pathname.split('/')[1] ?? '';
  const dark = s.theme === 'dark';

  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Sidebar">
        <Link to="/" className="brand" aria-label="cricforgeek home"><Ball /><span>cric<b>for</b>geek</span></Link>
        <Search />
        <nav className="side-nav" aria-label="Main">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>{icon}{label}{to === '/pinboard' && pins > 0 && <span className="count">{pins}</span>}{to === '/live' && <span className="live-dot" aria-hidden="true" style={{ marginLeft: 'auto' }} />}</NavLink>
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
        </header>
        <main className="page" key={loc.pathname}>
          <Suspense fallback={<Loader text="Loading page" />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/players" element={<Players />} />
            <Route path="/player/:id" element={<Player />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/live" element={<Live />} />
            <Route path="/predictor" element={<Navigate to="/live" replace />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/team/:key" element={<Team />} />
            <Route path="/competitions" element={<Leagues />} />
            <Route path="/leagues" element={<Navigate to="/competitions" replace />} />
            <Route path="/league/:key" element={<League />} />
            <Route path="/matches" element={<Matches />} />
            <Route path="/match/:id" element={<Match />} />
            <Route path="/venues" element={<Venues />} />
            <Route path="/venue/:key" element={<Venue />} />
            <Route path="/records" element={<Records />} />
            <Route path="/h2h" element={<H2H />} />
            <Route path="/play" element={<Play />} />
            <Route path="/tests" element={<Navigate to="/" replace />} />
            <Route path="/explore" element={<Explorer />} />
            <Route path="/explorer" element={<Navigate to="/explore" replace />} />
            <Route path="/pinboard" element={<Pinboard />} />
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<div className="empty">Page not found. <Link className="link" to="/">Go to the overview</Link></div>} />
          </Routes>
          </Suspense>
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
