import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { useSettings } from '../lib/settings';
import { d2, dateShort, n0, overs } from '../lib/fmt';
import { ErrorBox, JumpLinks, Loader, Panel, SectionHead, Seg } from '../components/ui';
import { Table, type Col } from '../components/Table';

// records/{fmt}-{gender}[-fm].json: lists of rows (column order noted on each table below) and a names map.
function T({ title, sub, rows, cols, id }: { title: string; sub?: string; rows?: any[]; cols: Col<any>[]; id?: string }) {
  return rows?.length ? <Panel id={id} flush title={title} sub={sub}><Table rows={rows} cols={cols} /></Panel> : null;
}

const FMTS: [string, string][] = [['TEST', 'Tests'], ['ODI', 'ODIs'], ['T20', 'T20Is']];

export default function Records() {
  usePageMeta('Cricket records and oddities');
  const st = useSettings();
  const [fmt, setFmt] = useState<string>(['TEST', 'ODI', 'T20'].includes(st.fmt) ? st.fmt : 'ODI');
  const [g, setG] = useState<string>(st.gender);
  const [fm, setFm] = useState<'fm' | 'all'>('fm');
  const { data: R, error } = useData<any>(`records/${fmt}-${g}${fm === 'fm' ? '-fm' : ''}.json`);
  const nm = (p: string) => R?.names?.[p] ?? p;
  const P = (p: string) => <Link to={`/player/${p}`}>{nm(p)}</Link>;
  const M = (id: string, text: string) => <Link to={`/match/${id}`}>{text}</Link>;
  const D: Col<any> = { key: 'd', label: 'Date', left: true, get: (x) => x[1], fmt: (v) => dateShort(String(v)) };
  const multi = fmt === 'TEST';
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Records</div>
          <h1>Records and oddities</h1>
          <p className="lede">The biggest chases, the narrowest wins, the fastest fifties and hundreds, the most ducks, the longest vigils and the great escapes, from every international with ball-by-ball records{R ? ` (${n0(R.matches)} matches)` : ''}.</p>
        </div>
        <div className="row">
          <Seg label="Format" value={fmt} onChange={setFmt} options={FMTS} />
          <Seg label="Cricket" value={g} onChange={setG} options={[['male', 'Men'], ['female', 'Women']]} />
          <Seg label="Teams" value={fm} onChange={setFm} options={[['fm', 'Full members'], ['all', 'All teams']]} />
        </div>
      </section>
      {!R ? <Loader text="Loading records" /> : (
        <>
          <JumpLinks items={[['results', 'Results'], ['batting', 'Batting'], ['bowling', 'Bowling'], ['odd', 'Oddities']]} />
          <SectionHead id="results" title="Results" sub="Chases, defences and the closest finishes." />
          <div className="grid g2">
            <T title={multi ? 'Highest fourth-innings chases' : 'Highest successful chases'} rows={R.chases} cols={[
              { key: 't', label: 'Team', left: true, get: (x) => x[2], fmt: (v, x) => M(x[0], v) }, { key: 'o', label: 'Against', left: true, get: (x) => x[3] },
              { key: 'r', label: 'Score', get: (x) => x[4], fmt: (_, x) => `${x[4]}/${x[5]}` }, D]} />
            {!multi && <T title="Lowest totals defended" sub="Full innings only; rain-adjusted results left out." rows={R.defended} cols={[
              { key: 't', label: 'Team', left: true, get: (x) => x[2], fmt: (v, x) => M(x[0], v) }, { key: 'o', label: 'Against', left: true, get: (x) => x[3] },
              { key: 'r', label: 'Score', get: (x) => x[4], fmt: (_, x) => `${x[4]}${x[5] < 10 ? `/${x[5]}` : ''}` }, D]} />}
            <T title="Narrowest wins by runs" rows={R.narrow_runs} cols={[
              { key: 't', label: 'Winner', left: true, get: (x) => x[2], fmt: (v, x) => M(x[0], v) }, { key: 'o', label: 'Beat', left: true, get: (x) => x[3] },
              { key: 'm', label: 'Margin', get: (x) => x[4], fmt: (v) => `${v} run${v === 1 ? '' : 's'}` }, D]} />
            <T title="Narrowest wins by wickets" sub={multi ? undefined : 'Ties broken by fewest balls to spare.'} rows={R.narrow_wkts} cols={[
              { key: 't', label: 'Winner', left: true, get: (x) => x[2], fmt: (v, x) => M(x[0], v) }, { key: 'o', label: 'Beat', left: true, get: (x) => x[3] },
              { key: 'm', label: 'Margin', get: (x) => x[4], fmt: (v, x) => `${v} wkt${v === 1 ? '' : 's'}${!multi && x[5] != null ? `, ${x[5]} ball${x[5] === 1 ? '' : 's'} left` : ''}` }, D]} />
            {!multi && <T title="Great escapes" sub="Winners whose chance of winning fell lowest during the match." rows={R.comebacks} cols={[
              { key: 't', label: 'Winner', left: true, get: (x) => x[2], fmt: (v, x) => M(x[0], v) }, { key: 'o', label: 'Beat', left: true, get: (x) => x[3] },
              { key: 'l', label: 'Low point', get: (x) => x[4], fmt: (v, x) => `${v < 0.01 ? '<1' : Math.round(v * 100)}% (inns ${x[5]}, over ${x[6] + 1})` }, D]} />}
            <T title="Ties" rows={R.ties} cols={[
              { key: 'm', label: 'Match', left: true, get: (x) => `${x[2]} v ${x[3]}`, fmt: (v, x) => M(x[0], v) }, { key: 'v', label: 'Ground', left: true, get: (x) => x[4] }, D]} />
          </div>

          <SectionHead id="batting" title="Batting" sub="Big scores, fast scores and long stays." />
          <div className="grid g2">
            <T title="Highest scores" rows={R.top_scores} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 'r', label: 'Runs', get: (x) => x[5], fmt: (v, x) => M(x[0], `${v}${x[7] ? '' : '*'} (${x[6]})`) }, D]} />
            <T title="Fastest fifties" sub="Balls faced to reach 50." rows={R.fast50} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) },
              { key: 'b', label: 'Balls', get: (x) => x[3], fmt: (v, x) => M(x[0], String(v)) }, D]} />
            <T title="Fastest hundreds" sub="Balls faced to reach 100." rows={R.fast100} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) },
              { key: 'b', label: 'Balls', get: (x) => x[3], fmt: (v, x) => M(x[0], String(v)) }, D]} />
            <T title="Highest partnerships" rows={R.partnerships} cols={[
              { key: 'p', label: 'Pair', left: true, get: (x) => `${nm(x[7])} & ${nm(x[8])}`, fmt: (v, x) => M(x[0], v) }, { key: 'w', label: 'Wkt', get: (x) => x[3] },
              { key: 'r', label: 'Runs', get: (x) => x[5], fmt: (v, x) => `${v} (${x[6]})` }, D]} />
            <T title="Most sixes in an innings" rows={R.sixes} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 's', label: 'Sixes', get: (x) => x[5], fmt: (v, x) => M(x[0], `${v} in ${x[6]} (${x[7]})`) }, D]} />
          </div>

          <SectionHead id="bowling" title="Bowling" sub="The best figures, the tightest spells and the most expensive days." />
          <div className="grid g2">
            <T title="Best figures" rows={R.best_bowling} cols={[
              { key: 'p', label: 'Bowler', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 'f', label: 'Figures', get: (x) => x[5], fmt: (_, x) => M(x[0], `${x[5]}/${x[6]} (${overs(x[7])})`) }, D]} />
            {!multi && <T title="Tightest spells" sub={fmt === 'T20' ? 'Four overs or more.' : 'Ten overs or more.'} rows={R.econ} cols={[
              { key: 'p', label: 'Bowler', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 'e', label: 'Econ', get: (x) => (6 * x[6]) / x[5], fmt: (v, x) => M(x[0], `${d2(v)} (${x[7]}/${x[6]})`) }, D]} />}
            <T title="Most expensive" rows={R.expensive} cols={[
              { key: 'p', label: 'Bowler', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 'r', label: 'Figures', get: (x) => x[6], fmt: (_, x) => M(x[0], `${x[7]}/${x[6]} (${overs(x[5])})`) }, D]} />
          </div>

          <SectionHead id="odd" title="Oddities" sub="The records nobody wants, and the ones that take patience." />
          <div className="grid g2">
            <T title="Most ducks" sub="Golden = out first ball." rows={R.ducks} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[0]), fmt: (_, x) => P(x[0]) },
              { key: 'd', label: 'Ducks', get: (x) => x[1] }, { key: 'g', label: 'Golden', get: (x) => x[2] }, { key: 'i', label: 'Inns', get: (x) => x[3] }]} />
            <T title="Longest innings" sub="Most balls faced in one innings." rows={R.longest} cols={[
              { key: 'p', label: 'Batter', left: true, get: (x) => nm(x[2]), fmt: (_, x) => P(x[2]) }, { key: 'o', label: 'Against', left: true, get: (x) => x[4] },
              { key: 'b', label: 'Balls', get: (x) => x[6], fmt: (v, x) => M(x[0], `${v} (${x[5]}${x[7] ? '' : '*'})`) }, D]} />
          </div>
        </>
      )}
    </>
  );
}
