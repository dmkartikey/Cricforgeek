import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { load } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { d1, n0, pct, signed } from '../lib/fmt';
import { famKeyLabel } from '../lib/labels';
import { kindsText } from '../components/PlayerGeek';
import { PlayerPick } from '../components/PlayerPick';
import { Loader, Panel } from '../components/ui';
import { Board, SbCell } from '../components/Scoreboard';

// Matchup rows (both players' files): [other id, other name, balls, runs, outs, dots, 4s, 6s, expected runs, impact, {dismissal kind: n}]
// Each player file keeps their 25 most-faced opponents per format, so the pair is looked up from both sides.
type Mu = [string, string, number, number, number, number, number, number, number, number, Record<string, number>?];

export default function H2H() {
  const [sp, setSp] = useSearchParams();
  const batId = sp.get('bat') ?? '', bowlId = sp.get('bowl') ?? '';
  const [bat, setBat] = useState<any>(null), [bowl, setBowl] = useState<any>(null);
  usePageMeta(bat && bowl ? `${bat.name} v ${bowl.name}: head to head` : 'Batter v bowler head to head');
  useEffect(() => { setBat(null); if (batId) load<any>(`players/${batId}.json`).then(setBat).catch(() => setBat(false)); }, [batId]);
  useEffect(() => { setBowl(null); if (bowlId) load<any>(`players/${bowlId}.json`).then(setBowl).catch(() => setBowl(false)); }, [bowlId]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };

  const pairs: { fk: string; row: Mu }[] = [];
  if (bat && bowl) {
    const fks = new Set([...Object.keys(bat.matchups ?? {}), ...Object.keys(bowl.matchups ?? {})]);
    for (const fk of fks) {
      const row = (bat.matchups?.[fk]?.bat ?? []).find((x: Mu) => x[0] === bowlId) ?? (bowl.matchups?.[fk]?.bowl ?? []).find((x: Mu) => x[0] === batId);
      if (row) pairs.push({ fk, row });
    }
    pairs.sort((a, b) => b.row[2] - a.row[2]);
  }
  const suggest: Mu[] = bat && !bowlId ? Object.values<any>(bat.matchups ?? {}).flatMap((m) => m.bat ?? []).sort((a: Mu, b: Mu) => b[2] - a[2]).slice(0, 10) : [];

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Head to head</div>
          <h1>{bat && bowl ? <><Link to={`/player/${batId}`}>{bat.name}</Link> <span className="muted" style={{ fontWeight: 400 }}>v</span> <Link to={`/player/${bowlId}`}>{bowl.name}</Link></> : 'Batter v bowler'}</h1>
          <p className="lede">Every ball one batter has faced from one bowler: runs, strike rate, how often he got them and how.</p>
        </div>
      </section>
      <div className="grid g2">
        <Panel title="Batter" sub={bat ? bat.name : 'Pick a batter'}><PlayerPick placeholder="Find a batter" onPick={(id) => set('bat', id)} /></Panel>
        <Panel title="Bowler" sub={bowl ? bowl.name : 'Pick a bowler'}><PlayerPick placeholder="Find a bowler" onPick={(id) => set('bowl', id)} /></Panel>
      </div>
      {suggest.length > 0 && (
        <Panel title={`Bowlers ${bat.name} has faced most`} sub="Tap one for the full head to head.">
          <div className="chips">{suggest.map((x) => <button key={x[0]} type="button" className="chip" onClick={() => set('bowl', x[0])}>{x[1]} <span className="muted mono">{x[2]} balls</span></button>)}</div>
        </Panel>
      )}
      {batId && bowlId && (bat === null || bowl === null) && <Loader text="Loading both players" />}
      {bat && bowl && !pairs.length && <div className="notice">No meetings found. Each player's file keeps their 25 most-faced opponents per format, so short head-to-heads may be missing.</div>}
      {pairs.map(({ fk, row: x }) => {
        const sr = (100 * x[3]) / x[2], avg = x[4] ? x[3] / x[4] : NaN;
        const career = bat.summary?.[fk]?.bat;
        const csr = career?.b ? (100 * career.r) / career.b : NaN, cavg = career?.o ? career.r / career.o : NaN;
        const edge = x[3] - x[8];
        const verdict = x[2] < 30 ? 'Too few balls to call' : edge > 0.08 * x[2] ? `Edge: ${bat.name}` : edge < -0.08 * x[2] ? `Edge: ${bowl.name}` : 'Even contest';
        return (
          <div key={fk} className="stack fade-in" style={{ gap: 12 }}>
            <Board plate={`${famKeyLabel(fk)} · ${verdict}`}>
              <div className="sb-grid">
                <SbCell label="Balls" value={n0(x[2])} />
                <SbCell label="Runs" value={n0(x[3])} sub={`${x[6]} fours · ${x[7]} sixes`} delay={120} />
                <SbCell label="Dismissals" value={n0(x[4])} sub={kindsText(x[10])} delay={240} />
                <SbCell label="Strike rate" value={d1(sr)} sub={`career ${d1(csr)}`} tone={sr > csr * 1.05 ? 'up' : sr < csr * 0.95 ? 'down' : 'flat'} delay={360} />
                <SbCell label="Average" value={d1(avg)} sub={`career ${d1(cavg)}`} tone={avg > cavg * 1.05 ? 'up' : avg < cavg * 0.95 ? 'down' : 'flat'} delay={480} />
                <SbCell label="Dot balls" value={pct(x[5] / x[2], 0)} sub={`runs v expected ${signed(edge, 0)}`} delay={600} />
              </div>
            </Board>
          </div>
        );
      })}
    </>
  );
}
