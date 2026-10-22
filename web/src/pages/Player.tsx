import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { bat, bowl, batSplit, bowlSplit, SplitRow } from '../lib/stats';
import { d1, d2, initials, n0, overs, pct, plus, signed, dateShort } from '../lib/fmt';
import { BGRP, famKeyLabel, INN, LEV, PHASES, POS, STYLE } from '../lib/labels';
import { ErrorBox, Legend, Loader, Panel, Seg, Tiles } from '../components/ui';
import { Columns, HBars, LineChart, PctBars } from '../components/charts';
import { PitchMap, Zone } from '../components/PitchMap';
import { Table } from '../components/Table';

const pretty = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function Player() {
  const { id } = useParams();
  const { data: p, error } = useData<any>(`players/${id}.json`);
  const [fk, setFk] = useState<string>('');
  const [role, setRole] = useState<'bat' | 'bowl'>('bat');
  const fks = useMemo(() => {
    if (!p) return [];
    return Object.entries<any>(p.summary)
      .map(([k, s]) => [k, (s.bat?.b ?? 0) + (s.bowl?.b ?? 0)] as [string, number])
      .sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  }, [p]);
  useEffect(() => {
    if (!p || !fks.length) return;
    const k = fks[0];
    setFk(k);
    const s = p.summary[k];
    setRole((s.bowl?.b ?? 0) > (s.bat?.b ?? 0) * 1.2 ? 'bowl' : 'bat');
  }, [p, fks]);

  if (error) return <ErrorBox error={error} />;
  if (!p || !fk) return <Loader text="Loading player" />;
  const s = p.summary[fk] ?? {};
  const fam = fk.split('-')[0];
  const hasBat = (s.bat?.b ?? 0) > 0, hasBowl = (s.bowl?.b ?? 0) > 0;
  const r = role === 'bowl' && !hasBowl ? 'bat' : role === 'bat' && !hasBat ? 'bowl' : role;
  const teams: any[] = p.teams ?? [];

  return (
    <>
      <section className="player-head fade-in">
        <div className="row" style={{ gap: 18, alignItems: 'center' }}>
          <div className="avatar" aria-hidden="true">{initials(p.name)}</div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">Player profile</div>
            <h1>{p.name}</h1>
            <div className="sub">{[p.full !== p.name ? p.full : null, STYLE[p.bat], STYLE[p.bowl]].filter(Boolean).join(' · ') || 'Style not recorded'}</div>
            <div className="chips">
              {teams.slice(0, 6).map((t) => (
                <Link key={t[0] + t[1]} className="tag" to={`/team/${teamKey(t[0], t[1])}`}>{t[0]} <span className="muted mono">{t[2]}–{t[3]}</span></Link>
              ))}
            </div>
          </div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          {fks.length > 1 && <Seg label="Format" value={fk} onChange={setFk} options={fks.map((k) => [k, famKeyLabel(k)])} />}
          {hasBat && hasBowl && <Seg label="Discipline" value={r} onChange={setRole} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />}
        </div>
      </section>
      {r === 'bat' ? <Batting p={p} fk={fk} fam={fam} /> : <Bowling p={p} fk={fk} fam={fam} />}
    </>
  );
}

const teamKey = (team: string, gender: string) => team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + (gender === 'female' ? '-women' : '');

function Batting({ p, fk, fam }: { p: any; fk: string; fam: string }) {
  const s = bat(p.summary[fk].bat);
  const sp = p.splits?.[fk]?.bat ?? {};
  const pc = p.pct?.[fk];
  const limited = fam !== 'MD';
  const [ztype, setZtype] = useState<'all' | 'pace' | 'spin'>('all');
  const zones = p.zones?.[fk] ?? {};
  const zone: Zone | undefined = zones[ztype] ?? zones.all;
  const years = (sp.year ?? []).map(batSplit).sort((a: any, b: any) => +a.k - +b.k);
  const entry = p.entry?.[fk];
  const comps = p.comps.filter((c: any) => `${c.fam}-${c.g}` === fk && c.bat);
  const mus = p.matchups?.[fk]?.bat ?? [];
  const recent = (p.recent?.bat ?? []).filter((x: any) => comps.some((c: any) => c.comp === x[1]));

  return (
    <>
      <Tiles items={[
        { l: 'Runs', v: n0(s.r), h: `${n0(s.i)} inns` },
        { l: 'Average', v: d2(s.avg), h: `${n0(s.o)} outs` },
        { l: 'Strike rate', v: d1(s.sr), h: `${n0(s.b)} balls` },
        { l: 'SR+', v: plus(s.srPlus), hot: s.srPlus >= 115, tip: 'Strike rate vs an average batter in the same situations. 100 = average.' },
        { l: 'Average+', v: plus(s.avgPlus), hot: s.avgPlus >= 120, tip: 'Runs per dismissal vs expected. 100 = average.' },
        { l: 'Impact', v: signed(s.imp, 0), h: `${signed(s.imp100, 2)} / 100 balls`, hot: (s.imp ?? 0) > 0, tip: 'Runs added above an average batter, counting the run cost of getting out.' },
        ...(limited ? [{ l: 'Win prob. added', v: signed(s.wpa, 2), h: 'wins', tip: 'Sum of win-probability swings on balls faced.' }] : []),
        { l: '50s / 100s', v: `${s.c50 ?? 0} / ${s.c100 ?? 0}`, h: `HS ${s.hs ?? '–'}` },
        { l: 'Boundary %', v: pct(s.bnd), h: `${n0(s.f4)} 4s · ${n0(s.s6)} 6s` },
        { l: 'Dot %', v: pct(s.dotp) },
      ]} />

      <div className="grid g2">
        <Panel title="Percentiles" sub={pc?.bat ? `Career, among ${n0(pc.n_bat)} qualified batters in ${famKeyLabel(fk).toLowerCase()} cricket.` : 'Not enough balls faced to rank yet.'}>
          {pc?.bat && <PctBars items={[
            { label: 'SR+', pct: pc.bat.sr_plus, value: plus(s.srPlus) },
            { label: 'Average+', pct: pc.bat.avg_plus, value: plus(s.avgPlus) },
            { label: 'Impact / 100 balls', pct: pc.bat.imp100, value: signed(s.imp100, 2) },
            ...(limited ? [{ label: 'WPA / 100 balls', pct: pc.bat.wpa100, value: signed(s.wpa100, 3) }] : []),
            { label: 'Boundary rate', pct: pc.bat.bnd, value: pct(s.bnd) },
            { label: 'Dot-ball avoidance', pct: pc.bat.dotp, value: pct(s.dotp) },
          ]} />}
        </Panel>
        <Panel title="By competition" flush>
          <Table rows={comps} sort="r" cols={[
            { key: 'c', label: 'Competition', left: true, get: (c: any) => c.label, fmt: (v, c: any) => <Link to={`/league/${c.comp}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (c: any) => c.bat.i },
            { key: 'r', label: 'Runs', get: (c: any) => c.bat.r, fmt: n0 },
            { key: 'avg', label: 'Avg', get: (c: any) => bat(c.bat).avg, fmt: d1 },
            { key: 'sr', label: 'SR', get: (c: any) => bat(c.bat).sr, fmt: d1 },
            { key: 'srp', label: 'SR+', get: (c: any) => bat(c.bat).srPlus, fmt: plus },
            { key: 'imp', label: 'Impact', get: (c: any) => c.bat.imp, fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
      </div>

      {years.length > 1 && (
        <div className="grid g2">
          <Panel title="Runs by year">
            <Columns aria="Runs by year" data={years.map((y: any) => ({ label: `'${y.k.slice(2)}`, title: y.k, value: y.r,
              extra: [{ label: 'Balls', value: n0(y.b) }, { label: 'SR+', value: plus(y.srPlus) }, { label: 'Impact', value: signed(y.imp, 0) }] }))} fmt={n0} />
          </Panel>
          <Panel title="SR+ and Average+ by year" sub="100 = average batter in the same situations and era.">
            <Legend items={[{ label: 'SR+', color: 'var(--s1)' }, { label: 'Average+', color: 'var(--s2)' }, { label: 'Average (100)', kind: 'dash' }]} />
            <LineChart aria="SR+ and Average+ by year" labels={years.map((y: any) => y.k)} refLine={100} fmt={(v) => Math.round(v).toString()}
              series={[{ name: 'SR+', color: 'var(--s1)', values: years.map((y: any) => (y.b >= 60 ? y.srPlus : null)) },
                       { name: 'Average+', color: 'var(--s2)', values: years.map((y: any) => (y.o >= 3 ? y.avgPlus : null)) }]} />
          </Panel>
        </div>
      )}

      <div className="grid g2">
        <Panel title="Phase of the innings" sub="SR+ in each phase. Tap or hover a bar for raw numbers.">
          <HBars fmt={plus} rows={(sp.phase ?? []).map(batSplit).sort((a: any, b: any) => +a.k - +b.k).map((x: any) => ({
            label: PHASES[fam][+x.k], value: x.b >= 20 ? x.srPlus : null, note: `${n0(x.r)} runs · ${n0(x.b)} balls · SR ${d1(x.sr)}`,
            tipRows: [{ label: 'Avg', value: d1(x.avg) }, { label: 'Impact', value: signed(x.imp, 0) }, { label: 'Dot %', value: pct(x.dotp) }] }))} />
        </Panel>
        <Panel title="Against bowling types" sub="SR+ against each bowling style. Survival+ (in tooltip) = balls per dismissal vs expected.">
          <HBars fmt={plus} rows={(sp.vs ?? []).map(batSplit).filter((x: any) => x.k !== 'unknown' && x.b >= 30).sort((a: any, b: any) => b.b - a.b).map((x: any) => ({
            label: BGRP[x.k] ?? x.k, value: x.srPlus, note: `${n0(x.r)} off ${n0(x.b)} · ${n0(x.o)} outs`,
            tipRows: [{ label: 'SR', value: d1(x.sr) }, { label: 'Avg', value: d1(x.avg) }, { label: 'Survival+', value: plus(100 * (x.xo / Math.max(x.o, 1))) }, { label: 'Impact', value: signed(x.imp, 0) }] }))} />
        </Panel>
      </div>

      {zone && (
        <Panel title="Inferred pitch zones" sub="Where the danger lies, worked out from dismissal types against the format's baseline."
          right={<Seg label="Bowler type" value={ztype} onChange={setZtype} options={[['all', 'All'], ['pace', 'Pace'], ['spin', 'Spin']].filter(([k]) => zones[k]) as any} />}>
          <PitchMap zone={zone} hand={p.bat} />
        </Panel>
      )}

      <div className="grid g3">
        <Panel title="Batting position" flush>
          <Table rows={sp.pos ?? []} sort="i" cols={[
            { key: 'k', label: 'Position', left: true, get: (x: any) => +x[0], fmt: (v) => POS(String(v)) },
            { key: 'i', label: 'Inns', get: (x: any) => x[1] },
            { key: 'r', label: 'Runs', get: (x: any) => x[2], fmt: n0 },
            { key: 'avg', label: 'Avg', get: (x: any) => (x[4] ? x[2] / x[4] : NaN), fmt: d1 },
            { key: 'srp', label: 'SR+', get: (x: any) => (x[5] ? (100 * x[2]) / x[5] : NaN), fmt: plus },
          ]} />
        </Panel>
        <Panel title="Innings & leverage" flush>
          <Table rows={[...(sp.inn ?? []).map((x: SplitRow) => ['inn', x] as const), ...(limited ? (sp.lev ?? []).map((x: SplitRow) => ['lev', x] as const) : [])]}
            cols={[
              { key: 'k', label: 'Split', left: true, get: ([t, x]: any) => (t === 'inn' ? INN[x[0]] : LEV[x[0]]), sortable: false },
              { key: 'b', label: 'Balls', get: ([, x]: any) => x[1], fmt: n0, sortable: false },
              { key: 'sr', label: 'SR', get: ([, x]: any) => batSplit(x).sr, fmt: d1, sortable: false },
              { key: 'srp', label: 'SR+', get: ([, x]: any) => batSplit(x).srPlus, fmt: plus, sortable: false },
              { key: 'imp', label: 'Impact', get: ([, x]: any) => x[9], fmt: (v) => signed(v, 0), sortable: false },
            ]} />
          {limited && <div className="muted" style={{ padding: '10px 16px', fontSize: 12 }}>High leverage = balls where the win chance typically swings 1.5× more than usual.</div>}
        </Panel>
        <Panel title="Entry point" sub="When they usually walk in.">
          {entry ? <Tiles items={[
            { l: 'Avg over in', v: d1(entry.over_in) },
            { l: 'Wickets down', v: d2(entry.wk_in) },
            { l: 'Team score', v: d1(entry.score_in) },
            { l: 'Innings', v: n0(entry.n) },
          ]} /> : <div className="empty">No data.</div>}
        </Panel>
      </div>

      {recent.length > 0 && (
        <Panel title={`Last ${recent.length} innings`} sub="Runs per innings, oldest to newest. Hover for details.">
          <Columns aria="Recent innings" fmt={n0} highlightMax data={recent.map((x: any) => ({
            label: dateShort(x[0]).split(' ').slice(1).join(' '), title: `${dateShort(x[0])} v ${x[2]}`, value: x[3],
            extra: [{ label: 'Balls', value: n0(x[4]) }, { label: 'Out', value: x[5] ? 'yes' : 'not out' }, { label: 'Impact', value: signed(x[6], 1) }] }))} />
          <div className="row" style={{ fontSize: 12 }}>
            {recent.slice(-6).reverse().map((x: any) => <Link key={x[8]} className="tag" to={`/match/${x[8]}`}>{x[3]}{x[5] ? '' : '*'} v {x[2]}</Link>)}
          </div>
        </Panel>
      )}

      <div className="grid g2">
        <Panel title="Head to head: bowlers" sub="Most-faced bowlers in this format." flush>
          <Table rows={mus} sort="b" limit={10} cols={[
            { key: 'n', label: 'Bowler', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'b', label: 'Balls', get: (x: any) => x[2] },
            { key: 'r', label: 'Runs', get: (x: any) => x[3] },
            { key: 'o', label: 'Outs', get: (x: any) => x[4] },
            { key: 'sr', label: 'SR', get: (x: any) => (100 * x[3]) / x[2], fmt: d1 },
            { key: 'srp', label: 'SR+', get: (x: any) => (x[8] ? (100 * x[3]) / x[8] : NaN), fmt: plus },
            { key: 'imp', label: 'Impact', get: (x: any) => x[9], fmt: (v) => signed(v, 1) },
          ]} />
        </Panel>
        <Panel title="Opponents & venues" flush>
          <Table rows={[...(p.splits?.[fk]?.bat?.opp ?? []).map((x: any) => ['Opp', ...x]), ...(p.splits?.[fk]?.bat?.venue ?? []).map((x: any) => ['Venue', ...x])]}
            sort="r" limit={12} cols={[
              { key: 'k', label: 'Against / at', left: true, get: (x: any) => (x[0] === 'Venue' ? pretty(x[1]) : x[1]), fmt: (v, x: any) => <>{v} <span className="muted" style={{ fontSize: 11 }}>{x[0] === 'Venue' ? 'venue' : ''}</span></> },
              { key: 'i', label: 'Inns', get: (x: any) => x[2] },
              { key: 'r', label: 'Runs', get: (x: any) => x[3], fmt: n0 },
              { key: 'avg', label: 'Avg', get: (x: any) => (x[5] ? x[3] / x[5] : NaN), fmt: d1 },
              { key: 'sr', label: 'SR', get: (x: any) => (x[4] ? (100 * x[3]) / x[4] : NaN), fmt: d1 },
              { key: 'imp', label: 'Impact', get: (x: any) => x[6], fmt: (v) => signed(v, 0) },
            ]} />
        </Panel>
      </div>
    </>
  );
}

function Bowling({ p, fk, fam }: { p: any; fk: string; fam: string }) {
  const s = bowl(p.summary[fk].bowl);
  const sp = p.splits?.[fk]?.bowl ?? {};
  const pc = p.pct?.[fk];
  const limited = fam !== 'MD';
  const years = (sp.year ?? []).map(bowlSplit).sort((a: any, b: any) => +a.k - +b.k);
  const comps = p.comps.filter((c: any) => `${c.fam}-${c.g}` === fk && c.bowl);
  const mus = p.matchups?.[fk]?.bowl ?? [];
  const recent = (p.recent?.bowl ?? []).filter((x: any) => comps.some((c: any) => c.comp === x[1]));
  return (
    <>
      <Tiles items={[
        { l: 'Wickets', v: n0(s.w), h: `${n0(s.i)} inns` },
        { l: 'Economy', v: d2(s.econ), h: `${overs(s.b)} overs` },
        { l: 'Average', v: d1(s.avg) },
        { l: 'Strike rate', v: d1(s.sr), h: 'balls / wkt' },
        { l: 'Economy+', v: plus(s.econPlus), hot: s.econPlus >= 110, tip: 'Expected runs conceded / actual. 100 = average.' },
        { l: 'Wickets+', v: plus(s.wktPlus), hot: s.wktPlus >= 115, tip: 'Wickets vs expected for the same overs and situations.' },
        { l: 'Impact', v: signed(s.imp, 0), h: `${signed(s.imp100, 2)} / 100 balls`, hot: (s.imp ?? 0) > 0 },
        ...(limited ? [{ l: 'Win prob. added', v: signed(s.wpa, 2), h: 'wins' }] : []),
        { l: 'Best', v: s.best ?? '–', h: `${s.w3 ?? 0}×3w · ${s.w5 ?? 0}×5w` },
        { l: 'Dot %', v: pct(s.dotp) },
      ]} />
      <div className="grid g2">
        <Panel title="Percentiles" sub={pc?.bowl ? `Career, among ${n0(pc.n_bowl)} qualified bowlers in ${famKeyLabel(fk).toLowerCase()} cricket.` : 'Not enough balls bowled to rank yet.'}>
          {pc?.bowl && <PctBars items={[
            { label: 'Economy+', pct: pc.bowl.econ_plus, value: plus(s.econPlus) },
            { label: 'Wickets+', pct: pc.bowl.wkt_plus, value: plus(s.wktPlus) },
            { label: 'Impact / 100 balls', pct: pc.bowl.imp100, value: signed(s.imp100, 2) },
            ...(limited ? [{ label: 'WPA / 100 balls', pct: pc.bowl.wpa100, value: signed(s.wpa100, 3) }] : []),
            { label: 'Dot-ball rate', pct: pc.bowl.dotp, value: pct(s.dotp) },
          ]} />}
        </Panel>
        <Panel title="By competition" flush>
          <Table rows={comps} sort="w" cols={[
            { key: 'c', label: 'Competition', left: true, get: (c: any) => c.label, fmt: (v, c: any) => <Link to={`/league/${c.comp}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (c: any) => c.bowl.i },
            { key: 'w', label: 'Wkts', get: (c: any) => c.bowl.w },
            { key: 'e', label: 'Econ', get: (c: any) => bowl(c.bowl).econ, fmt: d2 },
            { key: 'ep', label: 'Econ+', get: (c: any) => bowl(c.bowl).econPlus, fmt: plus },
            { key: 'imp', label: 'Impact', get: (c: any) => c.bowl.imp, fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
      </div>
      {years.length > 1 && (
        <div className="grid g2">
          <Panel title="Wickets by year">
            <Columns aria="Wickets by year" fmt={n0} data={years.map((y: any) => ({ label: `'${y.k.slice(2)}`, title: y.k, value: y.w,
              extra: [{ label: 'Overs', value: overs(y.b) }, { label: 'Econ', value: d2(y.econ) }, { label: 'Impact', value: signed(y.imp, 0) }] }))} />
          </Panel>
          <Panel title="Economy+ and Wickets+ by year" sub="100 = average bowler in the same situations and era.">
            <Legend items={[{ label: 'Economy+', color: 'var(--s1)' }, { label: 'Wickets+', color: 'var(--s2)' }, { label: 'Average (100)', kind: 'dash' }]} />
            <LineChart aria="Economy+ and Wickets+ by year" labels={years.map((y: any) => y.k)} refLine={100} fmt={(v) => Math.round(v).toString()}
              series={[{ name: 'Economy+', color: 'var(--s1)', values: years.map((y: any) => (y.b >= 60 ? y.econPlus : null)) },
                       { name: 'Wickets+', color: 'var(--s2)', values: years.map((y: any) => (y.b >= 120 ? y.wktPlus : null)) }]} />
          </Panel>
        </div>
      )}
      <div className="grid g2">
        <Panel title="Phase of the innings" sub="Economy+ in each phase (higher is tighter).">
          <HBars fmt={plus} rows={(sp.phase ?? []).map(bowlSplit).sort((a: any, b: any) => +a.k - +b.k).map((x: any) => ({
            label: PHASES[fam][+x.k], value: x.b >= 24 ? x.econPlus : null, note: `${overs(x.b)} ov · ${n0(x.w)} wkts · econ ${d2(x.econ)}`,
            tipRows: [{ label: 'Wickets+', value: plus(x.wktPlus) }, { label: 'Impact', value: signed(x.imp, 0) }, { label: 'Dot %', value: pct(x.dotp) }] }))} />
        </Panel>
        <Panel title="Right- vs left-handers" sub="Economy+ against each batting hand.">
          <HBars fmt={plus} rows={(sp.hand ?? []).map(bowlSplit).filter((x: any) => x.k !== 'unknown').map((x: any) => ({
            label: x.k === 'R' ? 'vs right-handers' : 'vs left-handers', value: x.econPlus, note: `${overs(x.b)} ov · ${n0(x.w)} wkts`,
            tipRows: [{ label: 'Econ', value: d2(x.econ) }, { label: 'Wickets+', value: plus(x.wktPlus) }, { label: 'Avg', value: d1(x.avg) }] }))} />
          {limited && (sp.lev ?? []).length > 0 && (
            <Table rows={sp.lev} cols={[
              { key: 'k', label: 'Leverage', left: true, get: (x: any) => LEV[x[0]], sortable: false },
              { key: 'b', label: 'Overs', get: (x: any) => x[1], fmt: (v) => overs(v), sortable: false },
              { key: 'e', label: 'Econ+', get: (x: any) => bowlSplit(x).econPlus, fmt: plus, sortable: false },
              { key: 'w', label: 'Wkts', get: (x: any) => x[3], sortable: false },
              { key: 'imp', label: 'Impact', get: (x: any) => x[9], fmt: (v) => signed(v, 0), sortable: false },
            ]} />
          )}
        </Panel>
      </div>
      {recent.length > 0 && (
        <Panel title={`Last ${recent.length} bowling innings`} sub="Wickets per innings (bars) with economy in the tooltip.">
          <Columns aria="Recent bowling" fmt={n0} highlightMax={false} data={recent.map((x: any) => ({
            label: dateShort(x[0]).split(' ').slice(1).join(' '), title: `${dateShort(x[0])} v ${x[2]}`, value: x[5],
            extra: [{ label: 'Figures', value: `${x[5]}/${x[4]} (${overs(x[3])})` }, { label: 'Impact', value: signed(x[6], 1) }] }))} />
        </Panel>
      )}
      <div className="grid g2">
        <Panel title="Head to head: batters" sub="Most-bowled-to batters in this format." flush>
          <Table rows={mus} sort="b" limit={10} cols={[
            { key: 'n', label: 'Batter', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'b', label: 'Balls', get: (x: any) => x[2] },
            { key: 'r', label: 'Runs', get: (x: any) => x[3] },
            { key: 'o', label: 'Wkts', get: (x: any) => x[4] },
            { key: 'sr', label: 'Batter SR', get: (x: any) => (100 * x[3]) / x[2], fmt: d1 },
            { key: 'dot', label: 'Dot %', get: (x: any) => x[5] / x[2], fmt: (v) => pct(v, 0) },
          ]} />
        </Panel>
        <Panel title="Opponents & venues" flush>
          <Table rows={[...(sp.opp ?? []).map((x: any) => ['Opp', ...x]), ...(sp.venue ?? []).map((x: any) => ['Venue', ...x])]} sort="w" limit={12} cols={[
            { key: 'k', label: 'Against / at', left: true, get: (x: any) => (x[0] === 'Venue' ? pretty(x[1]) : x[1]) },
            { key: 'i', label: 'Inns', get: (x: any) => x[2] },
            { key: 'w', label: 'Wkts', get: (x: any) => x[3] },
            { key: 'e', label: 'Econ', get: (x: any) => (x[4] ? (6 * x[5]) / x[4] : NaN), fmt: d2 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[6], fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
      </div>
    </>
  );
}

