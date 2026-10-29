import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { FULL_MEMBERS } from '../lib/live';
import { Panel } from './ui';
import { useFullName } from '../lib/names';

// onthisday/{MM}.json: {days: {"MM-DD": items}, names}. Items:
// ["bat", year, player, runs, balls, out, team, opp, fmt, gender, match]
// ["bowl", year, player, wkts, runs, balls, team, opp, fmt, gender, match]
// ["close", year, team1, team2, winner, result, by_runs, by_wkts, fmt, gender, match]
const F: Record<string, string> = { TEST: 'Test', ODI: 'ODI', T20: 'T20I' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function OnThisDay() {
  const fullName = useFullName();
  const [off, setOff] = useState(0);
  const d = new Date(Date.now() + off * 86_400_000);
  const mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  const { data } = useData<any>(`onthisday/${mm}.json`);
  const items: any[] = data?.days?.[`${mm}-${dd}`] ?? [];
  const nm = (p: string) => fullName(p, data?.names?.[p] ?? p);
  const fl = (x: any) => `${x[9] === 'female' ? "Women's " : ''}${F[x[8]] ?? x[8]}`;
  // matches between full members first, then newest first
  const fm = (x: any) => (x[0] === 'close' ? [x[2], x[3]] : [x[6], x[7]]).every((t: string) => FULL_MEMBERS.has(t));
  const shown = [...items].sort((a, b) => Number(fm(b)) - Number(fm(a)) || b[1] - a[1]).slice(0, 7);
  return (
    <Panel title={`On this day · ${+dd} ${MONTHS[+mm - 1]}`} sub="Hundreds, five-fors and thrillers in internationals that started on this date."
      right={<div className="row" style={{ gap: 4 }}>
        <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => setOff(off - 1)}>‹</button>
        {off !== 0 && <button type="button" className="chip" onClick={() => setOff(0)}>Today</button>}
        <button type="button" className="icon-btn" aria-label="Next day" onClick={() => setOff(off + 1)}>›</button>
      </div>}>
      {!data ? <div className="empty">Loading…</div> : !shown.length ? <div className="empty">Nothing big on this date in the recorded matches. Try the next day.</div> : (
        <ul className="otd">
          {shown.map((x, i) => (
            <li key={i}>
              <span className="otd-y mono">{x[1]}</span>
              {x[0] === 'bat' && <span><Link to={`/player/${x[2]}`}>{nm(x[2])}</Link> made <Link className="link" to={`/match/${x[10]}`}><b>{x[3]}{x[5] ? '' : '*'}</b></Link> off {x[4]} for {x[6]} v {x[7]} <span className="muted">({fl(x)})</span></span>}
              {x[0] === 'bowl' && <span><Link to={`/player/${x[2]}`}>{nm(x[2])}</Link> took <Link className="link" to={`/match/${x[10]}`}><b>{x[3]}/{x[4]}</b></Link> for {x[6]} v {x[7]} <span className="muted">({fl(x)})</span></span>}
              {x[0] === 'close' && <span><Link className="link" to={`/match/${x[10]}`}>{x[2]} v {x[3]}</Link>: {x[5] === 'tie' ? <b>tied</b> : <>{x[4]} won by <b>{x[6] ? `${x[6]} run${x[6] === 1 ? '' : 's'}` : `${x[7]} wicket`}</b></>} <span className="muted">({fl(x)})</span></span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
