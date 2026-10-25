import { useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { useData } from '../lib/data';
import { dateShort, n0, pct } from '../lib/fmt';
import { ErrorBox, Legend, Loader, Panel, Seg } from '../components/ui';
import { LineChart } from '../components/charts';

export default function Methodology() {
  usePageMeta('Methodology');
  const { data: meta, error } = useData<any>('meta.json');
  const [cal, setCal] = useState('T20-male');
  if (error) return <ErrorBox error={error} />;
  if (!meta) return <Loader />;
  const m = meta.models;
  const calib: any[] = m.wp_calibration?.[cal] ?? [];
  const re = m.run_expectancy?.T20 ?? {};
  const z = meta.zones;
  return (
    <>
      <section className="fade-in stack">
        <div className="eyebrow">How it works</div>
        <h1>Methodology</h1>
        <p className="sub" style={{ maxWidth: 760 }}>
          Every number on cricforgeek is built from Cricsheet's ball-by-ball records ({n0(meta.counts.matches)} matches, {n0(meta.counts.balls)} balls,
          data to {dateShort(meta.data_to)}). The pipeline runs every night, rebuilds every model from scratch and publishes static files. Last build: {meta.built.replace('T', ' ')} UTC.
        </p>
      </section>
      <div className="grid g2">
        <Panel title="1 · Expected outcome of every ball">
          <p className="sub">For each ball we look up what an average batter and bowler produce in the same <b>format, gender, innings, over</b> and <b>wickets down</b>, then scale it to the
            scoring level of that <b>competition and season</b> (so a 2025 IPL strike rate is judged against 2025 IPL, not 2009). That gives expected runs, expected
            chance of dismissal and expected wicket chance for the bowler.</p>
          <p className="sub">The site shows plain averages, strike rates and economy rates. The expected-runs model sits behind <b>Impact</b> and <b>runs above average</b>:
            the runs a player scored (or saved) beyond what an average player would have managed in exactly the same overs, wickets and era.</p>
        </Panel>
        <Panel title="2 · Impact (runs added)">
          <p className="sub">Impact is runs above expected, minus the run cost of getting out above the expected number of dismissals. In limited-overs cricket the cost of a wicket
            comes from a run-expectancy table: how many more runs a side usually scores with this many balls and wickets left. Losing a wicket in the 2nd over costs far more than in the 20th.
            In multi-day cricket a wicket is worth that season's runs per wicket.</p>
          <p className="sub">Bowling impact mirrors it: runs saved against expected plus the run value of wickets above expected.</p>
        </Panel>
      </div>
      <div className="grid g2">
        <Panel title="3 · Win probability" sub="Logistic models fitted per format and gender on every completed limited-overs match.">
          <p className="sub">First innings: projected total (score + expected runs still to come) against the competition-season's par score. Chase: runs needed compared with
            the runs expected from the balls and wickets left. <b>WPA</b> credits each ball's change in win probability to the batter (and the opposite to the bowler; byes, leg-byes and run-outs
            are not charged to the bowler). Leverage = how much the win chance typically moves in that state; "clutch" boards only count balls at 1.5× normal leverage or more.</p>
          <Seg label="Model" value={cal} onChange={setCal} options={Object.keys(m.wp_calibration ?? {}).map((k) => [k, `${k.split('-')[0]} · ${k.endsWith('-female') ? 'women' : 'men'}`])} />
          <Legend items={[{ label: 'Actual win rate', color: 'var(--s1)' }, { label: 'Predicted', kind: 'dash' }]} />
          <LineChart aria="Win probability calibration" labels={calib.map((c) => `${Math.round(c.pred * 100)}%`)} yMin={0} yMax={100} fmt={(v) => `${Math.round(v)}%`}
            series={[{ name: 'Actual', color: 'var(--s1)', values: calib.map((c) => c.actual * 100) },
                     { name: 'Predicted', color: 'var(--text-2)', dashed: true, values: calib.map((c) => c.pred * 100) }]} />
          <div className="muted" style={{ fontSize: 12 }}>Chase model calibration by predicted decile. Log loss {m.wp_logloss?.[cal]}. Lines that overlap mean the model is honest.</div>
        </Panel>
        <Panel title="Run expectancy · men's T20" sub="Expected runs still to come, by overs left (columns) and wickets down (rows).">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Wkts</th>{[20, 16, 12, 8, 4, 1].map((o) => <th key={o} scope="col">{o} ov</th>)}</tr></thead>
              <tbody>
                {Object.keys(re).slice(0, 10).map((w) => (
                  <tr key={w}><td>{w}</td>{[20, 16, 12, 8, 4, 1].map((o) => <td key={o}>{re[w][o]?.toFixed?.(0) ?? '–'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel title="4 · Inferred pitch zones" sub={meta.zones_about}>
        <div className="notice">Cricsheet has no ball-tracking (no line, length, speed or movement). Pitch maps here are inferred from how batters get out, shown with a confidence score,
          and should be read as scouting hints rather than measurements. If ball-tracking data becomes available, it can replace these weights directly.</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Dismissal</th><th scope="col">Confidence</th>{z.lengths.map((l: string) => <th key={l} scope="col">{l}</th>)}<th scope="col">Main line</th></tr></thead>
            <tbody>
              {Object.entries<any>(z.categories).map(([k, c]) => (
                <tr key={k}>
                  <td>{c.label}</td><td>{pct(c.confidence, 0)}</td>
                  {c.length.map((v: number, i: number) => <td key={i} style={{ background: `rgba(12, 156, 203, ${Math.min(0.85, v * 1.6)})`, color: 'var(--text)' }}>{pct(v, 0)}</td>)}
                  <td className="txt">{z.lines[c.line.indexOf(Math.max(...c.line))]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Scoring and dot-ball zones</h3>
        <p className="sub">{meta.zones_about_runs ?? 'Scoring zones spread each scoring outcome over the lengths and lines it usually comes from.'}</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Outcome</th><th scope="col">Confidence</th>{z.lengths.map((l: string) => <th key={l} scope="col">{l}</th>)}<th scope="col">Main line</th></tr></thead>
            <tbody>
              {Object.entries<any>(z.outcomes ?? {}).map(([k, c]) => (
                <tr key={k}>
                  <td>{c.label}</td><td>{pct(c.confidence, 0)}</td>
                  {c.length.map((v: number, i: number) => <td key={i} style={{ background: `rgba(226, 80, 143, ${Math.min(0.85, v * 1.6)})`, color: 'var(--text)' }}>{pct(v, 0)}</td>)}
                  <td className="txt">{z.lines[c.line.indexOf(Math.max(...c.line))]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">Bowling maps work the same way from the other end: a bowler's wickets, runs conceded and dot balls are compared with the average bowler of the same
          type (pace or spin) against the same batting hand and in the same phase. Every pitch map can be filtered by phase, and by bowler type (batting) or batter hand (bowling).</p>
        <p className="sub">A batter's map compares their dismissal mix with the average batter in the same format against the same bowler type (pace or spin). "Within their own game"
          divides by the batter's overall dismissal rate, so it shows where their wickets cluster even if they rarely get out. Caught-behind needs the wicketkeeper, who isn't
          marked in the data: we take the fielder who made a stumping in that match, or the side's regular stumper that season.</p>
      </Panel>
      <div className="grid g2">
        <Panel title="6 · Live predictions">
          <p className="sub"><b>Where live data comes from.</b> A small background service checks live international scores from CricketData.org about every
            15 minutes while a match is on (hourly otherwise), fetches full scorecards for up to two matches at each new innings and every two hours, and takes
            market odds from The Odds API a few times a day, averaged across bookmakers with their margin removed. No bookmaker is named or linked. The model then
            runs in your browser, so every number on the page is recomputed from the latest score.</p>
          <p className="sub"><b>Limited overs.</b> The predictor plays out the rest of the match ball by ball, a few thousand times. Each ball is drawn from what really happened
            on balls with the same balls left (in blocks of six), wickets down and, when chasing, the required run rate. Thin cells are blended with broader ones.
            Run and wicket rates are then scaled by the competition and season (separately for the start, middle and end of an innings), by the two teams and the ground
            (at half weight), and by the batters and bowlers you name, from their records in that format. With no competition chosen, a big target is also read as a sign of a good batting pitch.</p>
          <p className="sub"><b>How well it works.</b> On 300 real chase situations from the IPL, BBL, T20 Blast and PSL (2021 to 2026), predicted chances matched what happened:
            situations given about 30% were won 31% of the time, about 50% → 56%, about 93% → 96%. Across all men's T20 and ODI chases, the average gap to the real result rate was 4 and 5 points.</p>
          <p className="sub"><b>Tests and first-class.</b> A model trained on every past Test state, one per innings, gives win, draw and loss chances from the lead, wickets in hand,
            overs left in the match and the run rate. It picks the eventual result 53% of the time in the first innings, rising to 80% in the fourth. In a fourth-innings chase it is
            blended with a simulation of the chase that uses the teams and players. Declarations, weather and day-night games are not modelled.</p>
        </Panel>
        <Panel title="5 · Coverage & caveats">
          <ul className="sub" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            <li>Bowling and batting styles are known for {pct(meta.style_coverage, 0)} of deliveries. Pace/spin splits leave out the rest.</li>
            <li>First-class coverage is limited to what Cricsheet has: County Championship, Sheffield Shield, Plunket Shield, Sri Lanka's Major League and Tests. No Ranji Trophy yet.</li>
            <li>Rain-affected (DLS) matches use the revised target but are left out when fitting the win model.</li>
            <li>Win probability is not modelled for multi-day cricket yet.</li>
            <li>Test cricket has ball-by-ball records from December 2001. Older Tests are not included, so all-time records here mean "since 2001".</li>
            <li>In the Test lab, the home side is the team that plays most international cricket at that ground, so neutral venues (such as the UAE for Pakistan) count as home.</li>
            <li>Super overs are excluded from player stats.</li>
          </ul>
        </Panel>
        <Panel title="Open source">
          <p className="sub">The pipeline (Python + DuckDB) and this site (React + D3) live in one repository. Data: Cricsheet, ODC Attribution licence. Model weights and the pitch-zone
            mapping are plain files in the repo and can be edited and rebuilt.</p>
        </Panel>
      </div>
    </>
  );
}
