import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { d2, dateShort, n0, pct, signed } from '../lib/fmt';
import { FAM_LABEL, PHASES } from '../lib/labels';
import { ErrorBox, Legend, Loader, Panel, Seg, Tiles } from '../components/ui';
import { HBars, LineChart } from '../components/charts';
import { Table } from '../components/Table';

export default function Team() {
  const { key } = useParams();
  const { data: t, error } = useData<any>(`teams/${key}.json`);
  const fams = useMemo(() => (t ? Object.entries<any>(t.fams).sort((a, b) => b[1].p - a[1].p).map((x) => x[0]) : []), [t]);
  const [fam, setFam] = useState('');
  useEffect(() => { if (fams.length) setFam(fams[0]); }, [fams]);
  const comps: any[] = t?.comps ?? [];
  const [comp, setComp] = useState('');
  useEffect(() => { if (comps.length) setComp(comps[0][0]); }, [t]); // eslint-disable-line
  if (error) return <ErrorBox error={error} />;
  if (!t || !fam) return <Loader text="Loading team" />;
  const f = t.fams[fam] ?? {};
  const ph: any[] = (t.phase?.[fam] ?? []).sort((a: any, b: any) => a[0] - b[0]);
  const seasons = t.seasons.filter((s: any) => s[0] === comp);
  return (
    <>
      <section className="player-head fade-in">
        <div className="stack" style={{ gap: 6 }}>
          <div className="eyebrow">Team · {t.gender === 'female' ? 'Women' : 'Men'}</div>
          <h1>{t.name}</h1>
          <div className="chips">
            {comps.slice(0, 8).map((c) => <Link key={c[0]} className="tag" to={`/league/${c[0]}`}>{c[1]} <span className="mono muted">{c[2]}</span></Link>)}
          </div>
        </div>
        {fams.length > 1 && <Seg label="Format" value={fam} onChange={setFam} options={fams.map((k) => [k, FAM_LABEL[k]])} />}
      </section>
      <Tiles items={[
        { l: 'Played', v: n0(f.p) }, { l: 'Won', v: n0(f.w) }, { l: 'Win %', v: pct(f.w / f.p, 0) },
        { l: 'Bat first win %', v: pct(f.bf_w / f.bf_p, 0), h: `${f.bf_w}/${f.bf_p}` },
        { l: 'Chasing win %', v: pct(f.ch_w / f.ch_p, 0), h: `${f.ch_w}/${f.ch_p}` },
        { l: 'Toss won', v: n0(f.toss_w), h: `chose to bat ${pct(f.toss_bat / f.toss_w, 0)}` },
        { l: 'Win % after toss win', v: pct(f.toss_won_match / f.toss_w, 0) },
      ]} />
      <div className="grid g2">
        <Panel title="Competitions" flush>
          <Table rows={comps} sort="p" cols={[
            { key: 'n', label: 'Competition', left: true, get: (c: any) => c[1], fmt: (v, c: any) => <Link to={`/league/${c[0]}`}>{v}</Link> },
            { key: 'p', label: 'P', get: (c: any) => c[2] }, { key: 'w', label: 'W', get: (c: any) => c[3] }, { key: 'l', label: 'L', get: (c: any) => c[4] },
            { key: 't', label: 'T', get: (c: any) => c[5] }, { key: 'nr', label: 'D/NR', get: (c: any) => c[6] },
            { key: 'wp', label: 'Win %', get: (c: any) => c[3] / Math.max(1, c[3] + c[4]), fmt: (v) => pct(v, 0) },
            { key: 'span', label: 'Span', get: (c: any) => `${c[7].slice(0, 4)}–${c[8].slice(0, 4)}` },
          ]} />
        </Panel>
        <Panel title="Win % by season" right={comps.length > 1 && (
          <select className="input" value={comp} onChange={(e) => setComp(e.target.value)} aria-label="Competition">
            {comps.map((c) => <option key={c[0]} value={c[0]}>{c[1]}</option>)}
          </select>)}>
          <Legend items={[{ label: 'Win % (decided matches)', color: 'var(--s1)' }, { label: '50%', kind: 'dash' }]} />
          <LineChart aria="Win percentage by season" labels={seasons.map((s: any) => s[1])} refLine={50} yMin={0} yMax={100}
            fmt={(v) => `${Math.round(v)}%`} series={[{ name: 'Win %', color: 'var(--s1)', wash: true,
              values: seasons.map((s: any) => (s[3] + s[4] ? (100 * s[3]) / (s[3] + s[4]) : null)) }]} />
        </Panel>
      </div>
      {ph.length === 3 && (
        <Panel title="Run rate by phase" sub={`Batting vs bowling, ${FAM_LABEL[fam]} cricket. Runs per over.`}>
          <div className="grid g2">
            <HBars base={ph.reduce((a, x) => a + x[4], 0) / ph.reduce((a, x) => a + x[5], 0) * 6} refLabel="their bowling average" fmt={d2}
              rows={ph.map((x) => ({ label: `${PHASES[fam][x[0]]} · batting`, value: (6 * x[1]) / x[2], note: `${n0(x[3])} wkts lost` }))} />
            <HBars base={ph.reduce((a, x) => a + x[1], 0) / ph.reduce((a, x) => a + x[2], 0) * 6} refLabel="their batting average" fmt={d2}
              rows={ph.map((x) => ({ label: `${PHASES[fam][x[0]]} · conceded`, value: (6 * x[4]) / x[5], note: `${n0(x[6])} wkts taken` }))} />
          </div>
        </Panel>
      )}
      <div className="grid g3">
        <Panel title="Top batters by impact" flush>
          <Table rows={t.top_bat?.[fam] ?? []} sort="imp" cols={[
            { key: 'n', label: 'Batter', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'r', label: 'Runs', get: (x: any) => x[2], fmt: n0 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[4], fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
        <Panel title="Top bowlers by impact" flush>
          <Table rows={t.top_bowl?.[fam] ?? []} sort="imp" cols={[
            { key: 'n', label: 'Bowler', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'w', label: 'Wkts', get: (x: any) => x[2] },
            { key: 'imp', label: 'Impact', get: (x: any) => x[4], fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
        <Panel title="Head to head" flush>
          <Table rows={t.h2h ?? []} sort="p" limit={12} cols={[
            { key: 'o', label: 'Opponent', left: true, get: (x: any) => x[0] },
            { key: 'p', label: 'P', get: (x: any) => x[1] }, { key: 'w', label: 'W', get: (x: any) => x[2] }, { key: 'l', label: 'L', get: (x: any) => x[3] },
            { key: 'wp', label: 'Win %', get: (x: any) => x[2] / Math.max(1, x[2] + x[3]), fmt: (v) => pct(v, 0) },
          ]} />
        </Panel>
      </div>
      <Panel title="Recent results" flush>
        <Table rows={t.recent ?? []} limit={15} cols={[
          { key: 'd', label: 'Date', left: true, get: (x: any) => x[0], fmt: (v, x: any) => <Link to={`/match/${x[5]}`}>{dateShort(v)}</Link> },
          { key: 'o', label: 'Opponent', left: true, get: (x: any) => x[2] },
          { key: 'res', label: 'Result', get: (x: any) => x[3], fmt: (v) => <span className={v === 'W' ? 'pos' : v === 'L' ? 'neg' : ''}>{v}</span> },
          { key: 'm', label: 'Margin', get: (x: any) => x[4] },
        ]} />
      </Panel>
    </>
  );
}
