import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation, Link } from 'react-router-dom';
import { Search } from './components/Search';
import Home from './pages/Home';
import Player from './pages/Player';
import Team from './pages/Team';
import League from './pages/League';
import Leagues from './pages/Leagues';
import Match from './pages/Match';
import Explorer from './pages/Explorer';
import Methodology from './pages/Methodology';

export default function App() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand" aria-label="cricforgeek home">
            <span className="brand-mark" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7" stroke="#5ee7ff" strokeWidth="2.2" /><path d="M7 10c3 1.6 7 1.6 10 0M7 14c3-1.6 7-1.6 10 0" stroke="#ff6fb1" strokeWidth="1.5" /></svg>
            </span>
            cric<b>for</b>geek
          </Link>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Insights</NavLink>
            <NavLink to="/leagues">Leagues</NavLink>
            <NavLink to="/explore">Explorer</NavLink>
            <NavLink to="/methodology">Methodology</NavLink>
          </nav>
          <div className="spacer" />
          <Search />
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/team/:key" element={<Team />} />
          <Route path="/league/:key" element={<League />} />
          <Route path="/leagues" element={<Leagues />} />
          <Route path="/match/:id" element={<Match />} />
          <Route path="/explore" element={<Explorer />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="*" element={<div className="empty">Page not found. <Link to="/">Go home</Link></div>} />
        </Routes>
      </main>
      <footer className="footer">
        Ball-by-ball data from <a href="https://cricsheet.org" target="_blank" rel="noopener noreferrer">Cricsheet</a> (ODC-By licence).
        All models and inferred zones are cricforgeek's own and explained on the <Link to="/methodology">methodology</Link> page.
      </footer>
    </>
  );
}
