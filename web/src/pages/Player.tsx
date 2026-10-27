import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import PlayerCard, { usePlayerCard } from '../components/PlayerCard';
import type { CardData } from '../lib/card';
import { bat, bowl, batSplit, bowlSplit } from '../lib/stats';
import { d1, d2, initials, n0, overs, pct, plus, signed, dateShort } from '../lib/fmt';
import { BGRP, famKeyLabel, INN, LEV, MULTI, PHASES, POS, STYLE } from '../lib/labels';
import { ErrorBox, InfoTip, Legend, Loader, Mini, MiniSearch, MiniSelect, Panel, Seg, Tiles } from '../components/ui';
import { FormatStrip, OverallView } from '../components/PlayerOverview';
import { FreshLine, HomeAway, HowOut, kindsText, MilestoneChips, RollingForm } from '../components/PlayerGeek';
import { conversion, GLOSSARY } from '../lib/geek';
import { shareCard } from '../lib/sharecard';
import { useSettings } from '../lib/settings';
import { usePageMeta } from '../lib/meta';

import { BAT_METRICS, BOWL_METRICS, Drill, DrillMetric } from '../components/Drill';
import { ReactNode } from 'react';
import { Board, Flap } from '../components/Scoreboard';

type BandItem = { l: string; v: string; h?: string; k?: string; tip?: string };
function StatBand({ hero, groups, metrics, onDrill, plate }: { plate: string; hero: BandItem[]; groups: { t: string; items: BandItem[] }[]; metrics: DrillMetric[]; onDrill: (m: DrillMetric) => void }) {
  const m = (k?: string) => metrics.find((x) => x.key === k);
  const val = (it: BandItem): ReactNode => (m(it.k) ? <button type="button" className="kv" onClick={() => onDrill(m(it.k)!)} title="Break this number down"><span>{it.l}</span><b>{it.v}</b></button>
    : <div className="kv"><span>{it.l}</span><b>{it.v}</b></div>);
  const boardEl = (
      <Board plate={plate}>
      <div className="sb-hero">
        {hero.map((h, i) => {
          const inner = <><span className="sb-label">{h.l}</span><Flap text={h.v} delay={i * 220} />{h.h && <span className="sb-sub">{h.h}</span>}</>;
          return m(h.k)
            ? <button key={h.l} type="button" className="sb-cell big" onClick={() => onDrill(m(h.k)!)} title="Break this number down">{inner}</button>
            : <div key={h.l} className="sb-cell big">{inner}</div>;
        })}
      </div>
    </Board>
  );
  const groupsEl = (
    <div className="band-groups">
      {groups.map((g) => (
        <div key={g.t} className="band-group">
          <h3>{g.t}</h3>
          {g.items.map((it) => <div key={it.l} className={it.tip ? 'kv-tip' : undefined}>{val(it)}{it.tip && <InfoTip text={it.tip} label={`What is ${it.l}?`} />}</div>)}
        </div>
      ))}
    </div>
  );
  return (
    <div className="band with-board fade-in">
      {boardEl}
      {groupsEl}
    </div>
  );
}
import { Columns, HBars, LineChart, PctBars } from '../components/charts';
import { PitchMap } from '../components/PitchMap';
import { Table } from '../components/Table';

const pretty = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const teamKey = (team: string, gender: string) => team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + (gender === 'female' ? '-women' : '');
const phaseShort = (fam: string, k: string) => (PHASES[fam] ?? PHASES.T20)[+k].split(' (')[0];

export default function Player() {
  const { id } = useParams();
  const { data: p, error } = useData<any>(`players/${id}.json`);
  const st = useSettings();
  usePageMeta(p ? `${p.name} stats` : null);
  const meta = useData<any>('meta.json').data;
  const zbase = useData<any>('zbase.json').data;
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
    const want = `${st.fmt}-${st.gender}`;
    const k = fks.includes(want) ? want : fks[0];
    setFk(k);
    const s = p.summary[k];
    setRole((s.bowl?.b ?? 0) > (s.bat?.b ?? 0) * 1.2 ? 'bowl' : 'bat');
  }, [p, fks]);

  const [sp, setSp] = useSearchParams();
  const tabRaw = (sp.get('tab') ?? 'summary') as Tab;
  const setTab = (t: Tab) => { const n = new URLSearchParams(sp); if (t === 'summary') n.delete('tab'); else n.set('tab', t); setSp(n, { replace: true }); };
  const all = fk === 'all';
  const viewFk = all ? fks[0] ?? '' : fk; // the card and hero use the main format in the all-formats view
  const card = usePlayerCard(p, viewFk);
  if (error) return <ErrorBox error={error} />;
  if (!p || !fk) return <Loader text="Loading player" />;
  const s = p.summary[viewFk] ?? {};
  const fam = viewFk.split('-')[0];
  const hasBat = (s.bat?.b ?? 0) > 0, hasBowl = (s.bowl?.b ?? 0) > 0;
  const r = role === 'bowl' && !hasBowl ? 'bat' : role === 'bat' && !hasBat ? 'bowl' : role;
  const teams: any[] = p.teams ?? [];
  const tabs: [Tab, string][] = [['summary', 'Summary'], ['form', 'Form'], ['scoring', r === 'bat' ? 'Scoring' : 'Wickets'], ['dismissals', r === 'bat' ? 'Dismissals' : 'How they take wickets'],
    ['matchups', 'Matchups'], ...(r === 'bat' ? [['role', 'Role in the side'] as [Tab, string]] : [])];
  const tab: Tab = tabs.some((t) => t[0] === tabRaw) ? tabRaw : 'summary';
  const ctx = { p, fk: viewFk, fam, cfg: meta?.zones, zb: zbase?.[viewFk], card, tab };

  const body = (
    <>
      <section className={`player-head fade-in${card ? ' has-card hero' : ''}`}>
        {card && <div className="hero-card"><PlayerCard card={card} /></div>}
        <div className="row hero-id" style={{ gap: 18, alignItems: 'center' }}>
          {!card && <div className="avatar" aria-hidden="true">{initials(p.name)}</div>}
          <div className="stack" style={{ gap: 6 }}>
            <div className="eyebrow">Player profile</div>
            <h1>{p.name}</h1>
            <div className="sub">{[p.full !== p.name ? p.full : null, STYLE[p.bat], STYLE[p.bowl]].filter(Boolean).join(' · ') || 'Style not recorded'}</div>
            <div className="chips">
              {teams.slice(0, 6).map((t) => (
                <Link key={t[0] + t[1]} className="tag" to={`/team/${teamKey(t[0], t[1])}`}>{t[0]} <span className="muted mono">{t[2]}–{t[3]}</span></Link>
              ))}
            </div>
            <MilestoneChips p={p} fk={viewFk} />
            <FreshLine p={p} fk={viewFk} />
          </div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end' }}>
          <div className="row">
            <Link className="btn" to={`/compare?p=${p.id}${r === 'bowl' ? '&r=bowl' : ''}`}>Compare</Link>
            {card && <ShareBtn card={card} />}
          </div>
        </div>
        {card && <HeroForm p={p} fk={viewFk} role={r} />}
      </section>
      <FormatStrip p={p} fks={fks} fk={fk} setFk={setFk} />
      {all ? <OverallView p={p} fks={fks} setFk={setFk} /> : (
        <>
          <div className="ptabs" role="tablist" aria-label="Sections">
            <div className="ptabs-list">
              {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {hasBat && hasBowl && <Seg label="Discipline" value={r} onChange={setRole} options={[['bat', 'Batting'], ['bowl', 'Bowling']]} />}
          </div>
          <div className="player-body" key={fk + r + tab}>{r === 'bat' ? <Batting key={fk + 'bat'} {...ctx} /> : <Bowling key={fk + 'bowl'} {...ctx} />}</div>
        </>
      )}
    </>
  );
  return body;
}

type Tab = 'summary' | 'form' | 'scoring' | 'dismissals' | 'matchups' | 'role';
type Ctx = { p: any; fk: string; fam: string; cfg: any; zb: any; card?: CardData | null; tab: Tab };

// Balls per dismissal against each bowling style: lower = that style gets them out more often.
function WhoGetsThem({ rows }: { rows: any[] }) {
  const list = rows.map(batSplit).filter((x: any) => x.k !== 'unknown' && x.b >= 60 && x.o >= 2).sort((a: any, b: any) => a.bpd - b.bpd);
  if (list.length < 2) return <Panel title="Who gets them out" sub="Not enough dismissals against known bowling styles yet." />;
  const all = list.reduce((a: any, x: any) => ({ b: a.b + x.b, o: a.o + x.o }), { b: 0, o: 0 });
  return (
    <Panel title="Who gets them out" sub="Balls per dismissal against each bowling style. Shorter = more dangerous to them."
      foot={<>Most at risk against {BGRP[list[0].k] ?? list[0].k}: out every {d1(list[0].bpd)} balls.</>}>
      <HBars fmt={d1} base={all.b / Math.max(all.o, 1)} refLabel="all bowling" rows={list.map((x: any) => ({ label: BGRP[x.k] ?? x.k, value: x.bpd, note: `${n0(x.o)} outs in ${n0(x.b)} balls`,
        tipRows: [{ label: 'Average', value: d1(x.avg) }, { label: 'SR', value: d1(x.sr) }] }))} />
    </Panel>
  );
}
// Balls per wicket against right- and left-handers.
function WhoTheyGet({ rows }: { rows: any[] }) {
  const list = rows.map(bowlSplit).filter((x: any) => x.k !== 'unknown' && x.b >= 60);
  if (!list.length) return <Panel title="Who they get out" sub="Not enough balls against known batting hands yet." />;
  const all = list.reduce((a: any, x: any) => ({ b: a.b + x.b, w: a.w + x.w }), { b: 0, w: 0 });
  return (
    <Panel title="Who they get out" sub="Balls per wicket against right- and left-handers. Shorter = more dangerous.">
      <HBars fmt={d1} base={all.b / Math.max(all.w, 1)} refLabel="all batters" rows={list.map((x: any) => ({ label: x.k === 'R' ? 'Right-handers' : 'Left-handers', value: x.sr,
        note: `${n0(x.w)} wkts in ${n0(x.b)} balls`, tipRows: [{ label: 'Economy', value: d2(x.econ) }, { label: 'Average', value: d1(x.avg) }] }))} />
    </Panel>
  );
}

function ShareBtn({ card }: { card: CardData }) {
  const [st, setSt] = useState('');
  return (
    <button type="button" className="btn" title="Save or share this player's card as an image"
      onClick={async () => { setSt('…'); const r = await shareCard(card); setSt(r === 'downloaded' ? 'Saved' : r === 'shared' ? 'Shared' : ''); setTimeout(() => setSt(''), 2000); }}>
      {st || 'Share card'}
    </button>
  );
}

// Year series from either the format-wide year split or one competition's seasons
function useYears(p: any, fk: string, role: 'bat' | 'bowl', comp: string) {
  return useMemo(() => {
    if (comp === 'all') {
      const sp = p.splits?.[fk]?.[role]?.year ?? [];
      return (role === 'bat' ? sp.map(batSplit) : sp.map(bowlSplit)).sort((a: any, b: any) => +a.k - +b.k);
    }
    const rows: any[] = p.seasons?.[comp] ?? [];
    return rows.filter((x) => (role === 'bat' ? x[2] : x[7])).map((x) => role === 'bat'
      ? { k: String(x[0]), ...bat({ r: x[1], b: x[2], o: x[3], imp: x[4], wpa: x[5], xr: x[11], xo: x[12] }) }
      : { k: String(x[0]), ...bowl({ w: x[6], b: x[7], r: x[8], imp: x[9], wpa: x[10], xr: x[13], xw: x[14] }) });
  }, [p, fk, role, comp]);
}
const yLabel = (k: string) => (/^\d{4}$/.test(k) ? `'${k.slice(2)}` : k.replace(/^20(\d\d)\/(\d\d)$/, '$1/$2'));

function Batting({ p, fk, fam, cfg, zb, card, tab }: Ctx) {
  const s = bat(p.summary[fk].bat);
  const adjAvg = p.summary[fk].bat.adj_r != null && s.o ? p.summary[fk].bat.adj_r / s.o : null;
  const sp = p.splits?.[fk]?.bat ?? {};
  const unknownShare = (() => { const v = sp.vs ?? []; const t = v.reduce((a: number, x: any) => a + (x[1] ?? 0), 0); const u = v.find((x: any) => x[0] === 'unknown')?.[1] ?? 0; return t ? u / t : 0; })();
  const pc = p.pct?.[fk];
  const limited = !MULTI(fam);
  const [drill, setDrill] = useState<DrillMetric | null>(null);
  const comps = p.comps.filter((c: any) => `${c.fam}-${c.g}` === fk && c.bat);
  const compOpts: [string, string][] = [['all', 'All competitions'], ...comps.map((c: any) => [c.comp, c.label] as [string, string])];
  const [yc, setYc] = useState('all');
  const [ym, setYm] = useState<'r' | 'imp' | 'sr'>('r');
  const [pc2, setPc2] = useState('all');
  const [phT, setPhT] = useState('all');
  const [phM, setPhM] = useState<'sr' | 'avg' | 'bnd'>('sr');
  const [vsP, setVsP] = useState('all');
  const [vsSort, setVsSort] = useState<'b' | 'sr'>('b');
  const [minInn, setMinInn] = useState<'1' | '5' | '20'>('1');
  const [ilv, setIlv] = useState<'inn' | 'lev'>('inn');
  const [rc, setRc] = useState('all');
  const [rm, setRm] = useState<'runs' | 'imp'>('runs');
  const [muQ, setMuQ] = useState('');
  const [muMin, setMuMin] = useState<'6' | '30' | '60'>('6');
  const [ov, setOv] = useState<'opp' | 'venue'>('opp');
  const [csort, setCsort] = useState<'r' | 'imp' | 'sr'>('r');
  const years = useYears(p, fk, 'bat', yc);
  const years2 = useYears(p, fk, 'bat', pc2);
  const entry = p.entry?.[fk];
  const mus = (p.matchups?.[fk]?.bat ?? []).filter((x: any) => x[2] >= +muMin && (!muQ || String(x[1]).toLowerCase().includes(muQ.toLowerCase())));
  const recent = (p.recent?.bat ?? []).filter((x: any) => comps.some((c: any) => c.comp === x[1]) && (rc === 'all' || x[1] === rc));
  const phaseRows = phT === 'all' ? (sp.phase ?? []) : (sp.pt ?? []).filter((x: any) => String(x[0]).endsWith('|' + phT)).map((x: any) => [String(x[0]).split('|')[0], ...x.slice(1)]);
  const vsRows = vsP === 'all' ? (sp.vs ?? []) : (sp.pv ?? []).filter((x: any) => String(x[0]).startsWith(vsP + '|')).map((x: any) => [String(x[0]).split('|')[1], ...x.slice(1)]);
  const phasesAvail = [...new Set((sp.pt ?? []).map((x: any) => String(x[0]).split('|')[0]))] as string[];
  const PM: Record<string, [string, (v: number) => string, number]> = { sr: ['Strike rate', d1, s.sr], avg: ['Average', d1, s.avg], bnd: ['Boundary %', (v) => pct(v), s.bnd] };

  return (
    <>
      {tab === 'summary' && <>
      <StatBand metrics={BAT_METRICS} onDrill={setDrill} plate={`${p.name} · ${famKeyLabel(fk)} batting`}
        
        hero={[
          { l: 'Runs', v: n0(s.r), h: `${n0(s.i)} innings · ${n0(s.b)} balls`, k: 'r' },
          { l: 'Average', v: d2(s.avg), h: `${n0(s.o)} dismissals`, k: 'avg' },
          { l: 'Strike rate', v: d1(s.sr), h: `HS ${s.hs ?? '–'}`, k: 'sr' },
        ]}
        groups={[
          { t: 'Adjusted for context', items: [
            ...(adjAvg != null ? [{ l: 'Adjusted average', v: d1(adjAvg), tip: GLOSSARY.adj }] : []),
            { l: 'Runs above average', v: signed(s.rae, 0), tip: GLOSSARY.rae }, { l: 'Balls per dismissal', v: d1(s.bpd) },
            { l: 'Impact', v: signed(s.imp, 0), k: 'imp', tip: GLOSSARY.imp }, ...(limited ? [{ l: 'Win prob. added', v: signed(s.wpa, 2), k: 'wpa', tip: GLOSSARY.wpa }] : [{ l: 'Impact / 100 balls', v: signed(s.imp100, 2), k: 'imp100', tip: GLOSSARY.imp100 }]) ] },
          { t: 'Scoring', items: [
            { l: '50s · 100s', v: `${s.c50 ?? 0} · ${s.c100 ?? 0}` }, { l: 'Conversion', v: pct(conversion(s.c50, s.c100), 0), tip: GLOSSARY.conv },
            { l: 'Fours · sixes', v: `${n0(s.f4)} · ${n0(s.s6)}` },
            { l: 'Boundary %', v: pct(s.bnd), k: 'bnd' }, { l: 'Dot %', v: pct(s.dotp), k: 'dotp' } ] },
        ]} />
      <div className="muted" style={{ fontSize: 12, marginTop: -18 }}>Tap a number on the board or in the panel to break it down by phase, bowling type, innings, year, opposition and venue.</div>
      {drill && <Drill p={p} fk={fk} role="bat" metric={drill} name={p.name} onClose={() => setDrill(null)} />}
      {!card && <FormStrip rows={(p.recent?.bat ?? []).filter((x: any) => comps.some((c: any) => c.comp === x[1]))} careerAvg={s.avg} careerSr={s.sr} />}
      <div className="bento b57">
        <PercentileCard pc={pc?.bat} n={pc?.n_bat} fk={fk} items={pc?.bat ? [
          { label: 'Strike rate', pct: pc.bat.sr, value: d1(s.sr) },
          { label: 'Average', pct: pc.bat.avg, value: d1(s.avg) },
          ...(pc.bat.adj != null ? [{ label: 'Adjusted average', pct: pc.bat.adj, value: d1(adjAvg), tip: GLOSSARY.adj }] : []),
          { label: 'Impact / 100 balls', pct: pc.bat.imp100, value: signed(s.imp100, 2), tip: GLOSSARY.imp100 },
          ...(limited ? [{ label: 'WPA / 100 balls', pct: pc.bat.wpa100, value: signed(s.wpa100, 3) }] : []),
          { label: 'Boundary rate', pct: pc.bat.bnd, value: pct(s.bnd) },
          { label: 'Dot-ball avoidance', pct: pc.bat.dotp, value: pct(s.dotp) },
        ] : []} role="batters" />
        <Panel title="Year by year" sub={yc === 'all' ? 'All competitions in this format.' : compOpts.find((c) => c[0] === yc)?.[1]}
          tools={<>
            <Mini label="Metric" value={ym} onChange={setYm} options={[['r', 'Runs'], ['imp', 'Impact'], ['sr', 'Strike rate']]} />
            <MiniSelect label="In" value={yc} onChange={setYc} options={compOpts} />
          </>}>
          {years.length ? <Columns key={yc + ym} aria="Batting by year" fmt={ym === 'sr' ? d1 : ym === 'imp' ? (v) => signed(v, 0) : n0}
            data={years.map((y: any) => ({ label: yLabel(y.k), title: y.k, value: ym === 'r' ? y.r : ym === 'imp' ? y.imp : (y.b >= 30 ? y.sr : null),
              extra: [{ label: 'Runs', value: n0(y.r) }, { label: 'Balls', value: n0(y.b) }, { label: 'Average', value: d1(y.avg) }, { label: 'Strike rate', value: d1(y.sr) }, { label: 'Impact', value: signed(y.imp, 0) }] }))} />
            : <div className="empty">No batting here.</div>}
        </Panel>
      </div>
      <div className="bento b57">
        <Panel title="By competition" flush tools={<Mini label="Sort" value={csort} onChange={setCsort} options={[['r', 'Runs'], ['imp', 'Impact'], ['sr', 'SR']]} />}>
          <Table key={csort} rows={comps} sort={csort} cols={[
            { key: 'c', label: 'Competition', left: true, get: (c: any) => c.label, fmt: (v, c: any) => <Link to={`/league/${c.comp}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (c: any) => c.bat.i },
            { key: 'r', label: 'Runs', get: (c: any) => c.bat.r, fmt: n0 },
            { key: 'avg', label: 'Avg', get: (c: any) => bat(c.bat).avg, fmt: d1 },
            { key: 'sr', label: 'SR', get: (c: any) => bat(c.bat).sr, fmt: d1 },
            { key: 'imp', label: 'Impact', get: (c: any) => c.bat.imp, fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
        <Panel title="Average and strike rate by year" sub="Each on its own scale. Hollow rings mark years with few balls or dismissals."
          tools={<MiniSelect label="In" value={pc2} onChange={setPc2} options={compOpts} />}>
          {years2.length > 1 ? (
            <div className="stack" style={{ gap: 4 }}>
              <span className="mini-label">Strike rate</span>
              <LineChart aria="Strike rate by year" height={150} labels={years2.map((y: any) => y.k)} fmt={(v) => Math.round(v).toString()}
                series={[{ name: 'Strike rate', color: 'var(--s1)', values: years2.map((y: any) => (y.b >= 30 ? y.sr : null)), weak: years2.map((y: any) => y.b < 150) }]} />
              <span className="mini-label">Average</span>
              <LineChart aria="Average by year" height={150} labels={years2.map((y: any) => y.k)} fmt={(v) => Math.round(v).toString()}
                series={[{ name: 'Average', color: 'var(--s2)', values: years2.map((y: any) => (y.o >= 2 ? y.avg : null)), weak: years2.map((y: any) => y.o < 6) }]} />
            </div>
          ) : <div className="empty">Needs at least two seasons.</div>}
        </Panel>
      </div>
      </>}
      {tab === 'form' && <>
      <RollingForm p={p} fk={fk} role="bat" />
      <Panel title="Recent innings" sub="Oldest to newest. Hover for details."
        tools={<>
          <Mini label="Metric" value={rm} onChange={setRm} options={[['runs', 'Runs'], ['imp', 'Impact']]} />
          <MiniSelect label="In" value={rc} onChange={setRc} options={compOpts} />
        </>}>
        {recent.length ? <>
          <Columns key={rc + rm} aria="Recent innings" fmt={rm === 'imp' ? (v) => signed(v, 1) : n0} highlightMax data={recent.map((x: any) => ({
            label: dateShort(x[0]).split(' ').slice(1).join(' '), title: `${dateShort(x[0])} v ${x[2]}`, value: rm === 'runs' ? x[3] : x[6],
            color: rm === 'imp' && x[6] < 0 ? 'var(--s2)' : undefined,
            extra: [{ label: 'Runs', value: `${x[3]}${x[5] ? '' : '*'}` }, { label: 'Balls', value: n0(x[4]) }, { label: 'Impact', value: signed(x[6], 1) }] }))} />
          <div className="row" style={{ fontSize: 12 }}>
            {recent.slice(-6).reverse().map((x: any, n: number) => <Link key={`${x[8]}-${n}`} className="tag" to={`/match/${x[8]}`}>{x[3]}{x[5] ? '' : '*'} v {x[2]}</Link>)}
          </div>
        </> : <div className="empty">No recent innings here.</div>}
      </Panel>
      </>}
      {tab === 'scoring' && <>
      <div className="grid g2">
        <Panel title="Phase of the innings" sub="Hover a bar for the raw numbers."
          tools={<>
            <Mini label="Metric" value={phM} onChange={setPhM} options={[['sr', 'SR'], ['avg', 'Avg'], ['bnd', 'Boundary %']]} />
            <Mini label="Vs" value={phT} onChange={setPhT} options={[['all', 'All'], ['pace', 'Pace'], ['spin', 'Spin']]} />
          </>}>
          <HBars key={phT + phM} fmt={PM[phM][1]} base={PM[phM][2]} refLabel="career" rows={phaseRows.map(batSplit).sort((a: any, b: any) => +a.k - +b.k).map((x: any) => ({
            label: PHASES[fam][+x.k], value: x.b >= 20 ? x[phM] : null, note: `${n0(x.r)} runs · ${n0(x.b)} balls · ${n0(x.o)} outs`,
            tipRows: [{ label: 'SR', value: d1(x.sr) }, { label: 'Avg', value: d1(x.avg) }, { label: 'Impact', value: signed(x.imp, 0) }, { label: 'Dot %', value: pct(x.dotp) }] }))} />
        </Panel>
        <Panel title="Against bowling types" sub={`Strike rate against each bowling style. Tooltips add average and balls per dismissal.${unknownShare > 0.15 ? ` ${pct(unknownShare, 0)} of balls faced came from bowlers whose style is not recorded, so those are left out.` : ''}`}
          tools={<>
            <Mini label="Phase" value={vsP} onChange={setVsP} options={[['all', 'All'], ...phasesAvail.sort().map((k) => [k, phaseShort(fam, k)] as [string, string])]} />
            <Mini label="Sort" value={vsSort} onChange={setVsSort} options={[['b', 'Most faced'], ['sr', 'SR']]} />
          </>}>
          <HBars key={vsP + vsSort} fmt={plus} refLabel="overall strike rate" base={(() => { const r = vsRows.map(batSplit); const b = r.reduce((a: number, x: any) => a + (x.b ?? 0), 0); return b ? (100 * r.reduce((a: number, x: any) => a + (x.r ?? 0), 0)) / b : 0; })()} rows={vsRows.map(batSplit).filter((x: any) => x.k !== 'unknown' && x.b >= 24).sort((a: any, b: any) => (b[vsSort] ?? 0) - (a[vsSort] ?? 0)).map((x: any) => ({
            label: BGRP[x.k] ?? x.k, value: x.sr, note: `${n0(x.r)} off ${n0(x.b)} · ${n0(x.o)} outs`,
            tipRows: [{ label: 'SR', value: d1(x.sr) }, { label: 'Avg', value: d1(x.avg) }, { label: 'Balls per dismissal', value: d1(x.b / Math.max(x.o, 1)) }, { label: 'Impact', value: signed(x.imp, 0) }] }))} />
        </Panel>
      </div>
      </>}
      {tab === 'dismissals' && <>
      <div className="grid g2">
        <HowOut p={p} fk={fk} role="bat" />
        <WhoGetsThem rows={sp.vs ?? []} />
      </div>
      {cfg && zb && p.zc?.[fk]?.bat && Object.keys(p.zc[fk].bat).length > 0 && (
        <Panel title={<>Pitch map <span className="est-badge">Estimated</span> <InfoTip text={GLOSSARY.zones} /></>} eyebrow="Inferred zones · batting" sub="Where this batter is most at risk, where the runs come from, and where the dot balls pile up. Estimated, not ball-tracking.">
          <PitchMap role="bat" zc={p.zc[fk].bat} base={zb.bat} cfg={cfg} fam={fam} hand={p.bat} />
        </Panel>
      )}
      </>}
      {tab === 'matchups' && <>
      <div className="grid g2">
        <Panel title="Head to head: bowlers" flush
          tools={<>
            <MiniSearch value={muQ} onChange={setMuQ} placeholder="Find a bowler" />
            <Mini label="Min balls" value={muMin} onChange={setMuMin} options={[['6', '6'], ['30', '30'], ['60', '60']]} />
          </>}>
          <Table rows={mus} sort="b" limit={10} empty="No bowler matches." cols={[
            { key: 'n', label: 'Bowler', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'b', label: 'Balls', get: (x: any) => x[2] },
            { key: 'r', label: 'Runs', get: (x: any) => x[3] },
            { key: 'o', label: 'Outs', get: (x: any) => x[4] },
            { key: 'sr', label: 'SR', get: (x: any) => (100 * x[3]) / x[2], fmt: d1 },
            { key: 'avg', label: 'Avg', get: (x: any) => (x[4] ? x[3] / x[4] : NaN), fmt: d1 },
            { key: 'how', label: 'How out', left: true, sortable: false, get: (x: any) => kindsText(x[10], true), fmt: (v, x: any) => <Link className="link" to={`/h2h?bat=${p.id}&bowl=${x[0]}`} title={`${kindsText(x[10])}. Open the full head to head.`}>{v}</Link> },
          ]} />
        </Panel>
        <OppVenue rows={sp[ov] ?? []} ov={ov} setOv={setOv} kind="bat" />
      </div>
      <HomeAway p={p} fk={fk} role="bat" />
      </>}
      {tab === 'role' && <>
      <div className="grid g3">
        <Panel title="Batting position" flush tools={<Mini label="Min inns" value={minInn} onChange={setMinInn} options={[['1', '1'], ['5', '5'], ['20', '20']]} />}>
          <Table rows={(sp.pos ?? []).filter((x: any) => x[1] >= +minInn)} sort="i" cols={[
            { key: 'k', label: 'Position', left: true, get: (x: any) => +x[0], fmt: (v) => POS(String(v)) },
            { key: 'i', label: 'Inns', get: (x: any) => x[1] },
            { key: 'r', label: 'Runs', get: (x: any) => x[2], fmt: n0 },
            { key: 'avg', label: 'Avg', get: (x: any) => (x[4] ? x[2] / x[4] : NaN), fmt: d1 },
            { key: 'sr', label: 'SR', get: (x: any) => (x[3] ? (100 * x[2]) / x[3] : NaN), fmt: d1 },
          ]} />
        </Panel>
        <Panel title="Situation" flush tools={limited ? <Mini label="Split" value={ilv} onChange={setIlv} options={[['inn', 'Innings'], ['lev', 'Leverage']]} /> : undefined}>
          <Table key={ilv} rows={sp[ilv === 'lev' && limited ? 'lev' : 'inn'] ?? []} cols={[
            { key: 'k', label: ilv === 'lev' ? 'Leverage' : 'Innings', left: true, get: (x: any) => (ilv === 'lev' && limited ? LEV[x[0]] : INN[x[0]]), sortable: false },
            { key: 'b', label: 'Balls', get: (x: any) => x[1], fmt: n0 },
            { key: 'sr', label: 'SR', get: (x: any) => batSplit(x).sr, fmt: d1 },
            { key: 'avg', label: 'Avg', get: (x: any) => batSplit(x).avg, fmt: d1 },
            { key: 'imp', label: 'Impact', get: (x: any) => x[9], fmt: (v) => signed(v, 0) },
          ]} />
          {ilv === 'lev' && <div className="muted" style={{ padding: '10px 22px 16px', fontSize: 12 }}>High leverage = balls where the win chance typically swings 1.5× more than usual.</div>}
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
      </>}
    </>
  );
}

function PercentileCard({ pc, n, fk, items, role }: { pc: any; n?: number; fk: string; items: { label: string; pct: number | null; value: string; tip?: string }[]; role: string }) {
  const [order, setOrder] = useState<'def' | 'pct'>('def');
  const list = order === 'pct' ? [...items].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)) : items;
  return (
    <Panel title="Percentiles" sub={pc ? `Career, among ${n0(n)} qualified ${role} (${famKeyLabel(fk)}).` : `Not enough balls to rank yet.`}
      tools={pc ? <Mini label="Order" value={order} onChange={setOrder} options={[['def', 'Default'], ['pct', 'Strongest first']]} /> : undefined}>
      {pc && <PctBars key={order} items={list} />}
    </Panel>
  );
}

function OppVenue({ rows, ov, setOv, kind }: { rows: any[]; ov: 'opp' | 'venue'; setOv: (v: 'opp' | 'venue') => void; kind: 'bat' | 'bowl' }) {
  return (
    <Panel title={ov === 'opp' ? 'Against opponents' : 'At venues'} flush
      tools={<Mini label="By" value={ov} onChange={setOv} options={[['opp', 'Opponent'], ['venue', 'Venue']]} />}>
      <Table key={ov + kind} rows={rows} sort={kind === 'bat' ? 'r' : 'w'} limit={12} cols={kind === 'bat' ? [
        { key: 'k', label: ov === 'opp' ? 'Opponent' : 'Venue', left: true, get: (x: any) => (ov === 'venue' ? pretty(x[0]) : x[0]) },
        { key: 'i', label: 'Inns', get: (x: any) => x[1] },
        { key: 'r', label: 'Runs', get: (x: any) => x[2], fmt: n0 },
        { key: 'avg', label: 'Avg', get: (x: any) => (x[4] ? x[2] / x[4] : NaN), fmt: d1 },
        { key: 'sr', label: 'SR', get: (x: any) => (x[3] ? (100 * x[2]) / x[3] : NaN), fmt: d1 },
        { key: 'imp', label: 'Impact', get: (x: any) => x[5], fmt: (v) => signed(v, 0) },
      ] : [
        { key: 'k', label: ov === 'opp' ? 'Opponent' : 'Venue', left: true, get: (x: any) => (ov === 'venue' ? pretty(x[0]) : x[0]) },
        { key: 'i', label: 'Inns', get: (x: any) => x[1] },
        { key: 'w', label: 'Wkts', get: (x: any) => x[2] },
        { key: 'e', label: 'Econ', get: (x: any) => (x[3] ? (6 * x[4]) / x[3] : NaN), fmt: d2 },
        { key: 'imp', label: 'Impact', get: (x: any) => x[5], fmt: (v) => signed(v, 0) },
      ]} />
    </Panel>
  );
}

function Bowling({ p, fk, fam, cfg, zb, tab }: Ctx) {
  const s = bowl(p.summary[fk].bowl);
  const adjAvg = p.summary[fk].bowl.adj_r != null && s.w ? p.summary[fk].bowl.adj_r / s.w : null;
  const sp = p.splits?.[fk]?.bowl ?? {};
  const pc = p.pct?.[fk];
  const limited = !MULTI(fam);
  const [drill, setDrill] = useState<DrillMetric | null>(null);
  const comps = p.comps.filter((c: any) => `${c.fam}-${c.g}` === fk && c.bowl);
  const compOpts: [string, string][] = [['all', 'All competitions'], ...comps.map((c: any) => [c.comp, c.label] as [string, string])];
  const [yc, setYc] = useState('all');
  const [ym, setYm] = useState<'w' | 'econ' | 'imp'>('w');
  const [pc2, setPc2] = useState('all');
  const [phH, setPhH] = useState('all');
  const [phM, setPhM] = useState<'econ' | 'avg' | 'sr'>('econ');
  const [hP, setHP] = useState('all');
  const [rc, setRc] = useState('all');
  const [muQ, setMuQ] = useState('');
  const [muMin, setMuMin] = useState<'6' | '30' | '60'>('6');
  const [ov, setOv] = useState<'opp' | 'venue'>('opp');
  const [csort, setCsort] = useState<'w' | 'imp' | 'avg'>('w');
  const years = useYears(p, fk, 'bowl', yc);
  const years2 = useYears(p, fk, 'bowl', pc2);
  const mus = (p.matchups?.[fk]?.bowl ?? []).filter((x: any) => x[2] >= +muMin && (!muQ || String(x[1]).toLowerCase().includes(muQ.toLowerCase())));
  const recent = (p.recent?.bowl ?? []).filter((x: any) => comps.some((c: any) => c.comp === x[1]) && (rc === 'all' || x[1] === rc));
  const ph = sp.ph ?? [];
  const phaseRows = phH === 'all' ? (sp.phase ?? []) : ph.filter((x: any) => String(x[0]).endsWith('|' + phH)).map((x: any) => [String(x[0]).split('|')[0], ...x.slice(1)]);
  const handRows = hP === 'all' ? (sp.hand ?? []) : ph.filter((x: any) => String(x[0]).startsWith(hP + '|')).map((x: any) => [String(x[0]).split('|')[1], ...x.slice(1)]);
  const phasesAvail = [...new Set(ph.map((x: any) => String(x[0]).split('|')[0]))] as string[];
  const PM: Record<string, [string, (v: number) => string, number]> = { econ: ['Economy', d2, s.econ], avg: ['Average', d1, s.avg], sr: ['Strike rate', d1, s.sr] };

  return (
    <>
      {tab === 'summary' && <>
      <StatBand metrics={BOWL_METRICS} onDrill={setDrill} plate={`${p.name} · ${famKeyLabel(fk)} bowling`}
        hero={[
          { l: 'Wickets', v: n0(s.w), h: `${n0(s.i)} innings · ${overs(s.b)} overs`, k: 'w' },
          { l: 'Economy', v: d2(s.econ), h: `${n0(s.r)} runs conceded`, k: 'econ' },
          { l: 'Average', v: d1(s.avg), h: `SR ${d1(s.sr)} balls / wkt`, k: 'avg' },
        ]}
        groups={[
          { t: 'Adjusted for context', items: [
            ...(adjAvg != null ? [{ l: 'Adjusted average', v: d1(adjAvg), tip: GLOSSARY.adjBowl }] : []),
            { l: 'Runs saved v average', v: signed(s.saved, 0), tip: GLOSSARY.saved }, { l: 'Wickets per innings', v: d2((s.w ?? 0) / Math.max(s.i ?? 1, 1)) },
            { l: 'Impact', v: signed(s.imp, 0), k: 'imp', tip: GLOSSARY.imp }, ...(limited ? [{ l: 'Win prob. added', v: signed(s.wpa, 2), k: 'wpa', tip: GLOSSARY.wpa }] : [{ l: 'Impact / 100 balls', v: signed(s.imp100, 2), k: 'imp100', tip: GLOSSARY.imp100 }]) ] },
          { t: 'Hauls', items: [
            { l: 'Best figures', v: s.best ?? '–' }, { l: '3-fors · 5-fors', v: `${s.w3 ?? 0} · ${s.w5 ?? 0}` },
            { l: 'Strike rate', v: d1(s.sr), k: 'sr' }, { l: 'Dot %', v: pct(s.dotp), k: 'dotp' } ] },
        ]} />
      <div className="muted" style={{ fontSize: 12, marginTop: -18 }}>Tap any number to break it down by phase, batter hand, innings, year, opposition and venue.</div>
      {drill && <Drill p={p} fk={fk} role="bowl" metric={drill} name={p.name} onClose={() => setDrill(null)} />}
      <div className="bento b57">
        <PercentileCard pc={pc?.bowl} n={pc?.n_bowl} fk={fk} role="bowlers" items={pc?.bowl ? [
          { label: 'Economy', pct: pc.bowl.econ, value: d2(s.econ) },
          { label: 'Average', pct: pc.bowl.bavg, value: d1(s.avg) },
          { label: 'Strike rate', pct: pc.bowl.bsr, value: d1(s.sr) },
          ...(pc.bowl.adj != null ? [{ label: 'Adjusted average', pct: pc.bowl.adj, value: d1(adjAvg), tip: GLOSSARY.adjBowl }] : []),
          { label: 'Impact / 100 balls', pct: pc.bowl.imp100, value: signed(s.imp100, 2), tip: GLOSSARY.imp100 },
          ...(limited ? [{ label: 'WPA / 100 balls', pct: pc.bowl.wpa100, value: signed(s.wpa100, 3) }] : []),
          { label: 'Dot-ball rate', pct: pc.bowl.dotp, value: pct(s.dotp) },
        ] : []} />
        <Panel title="Year by year" sub={yc === 'all' ? 'All competitions in this format.' : compOpts.find((c) => c[0] === yc)?.[1]}
          tools={<>
            <Mini label="Metric" value={ym} onChange={setYm} options={[['w', 'Wickets'], ['econ', 'Economy'], ['imp', 'Impact']]} />
            <MiniSelect label="In" value={yc} onChange={setYc} options={compOpts} />
          </>}>
          {years.length ? <Columns key={yc + ym} aria="Bowling by year" fmt={ym === 'econ' ? d2 : ym === 'imp' ? (v) => signed(v, 0) : n0}
            data={years.map((y: any) => ({ label: yLabel(y.k), title: y.k, value: ym === 'w' ? y.w : ym === 'imp' ? y.imp : (y.b >= 30 ? y.econ : null),
              extra: [{ label: 'Wickets', value: n0(y.w) }, { label: 'Overs', value: overs(y.b) }, { label: 'Econ', value: d2(y.econ) }, { label: 'Impact', value: signed(y.imp, 0) }] }))} />
            : <div className="empty">No bowling here.</div>}
        </Panel>
      </div>
      <div className="bento b57">
        <Panel title="By competition" flush tools={<Mini label="Sort" value={csort} onChange={setCsort} options={[['w', 'Wickets'], ['imp', 'Impact'], ['avg', 'Avg']]} />}>
          <Table key={csort} rows={comps} sort={csort} cols={[
            { key: 'c', label: 'Competition', left: true, get: (c: any) => c.label, fmt: (v, c: any) => <Link to={`/league/${c.comp}`}>{v}</Link> },
            { key: 'i', label: 'Inns', get: (c: any) => c.bowl.i },
            { key: 'w', label: 'Wkts', get: (c: any) => c.bowl.w },
            { key: 'e', label: 'Econ', get: (c: any) => bowl(c.bowl).econ, fmt: d2 },
            { key: 'avg', label: 'Avg', get: (c: any) => bowl(c.bowl).avg, fmt: d1 },
            { key: 'imp', label: 'Impact', get: (c: any) => c.bowl.imp, fmt: (v) => signed(v, 0) },
          ]} />
        </Panel>
        <Panel title="Economy and average by year" sub="Lower is better for both. Years with few balls are left out."
          tools={<MiniSelect label="In" value={pc2} onChange={setPc2} options={compOpts} />}>
          <Legend items={[{ label: 'Economy', color: 'var(--s1)' }, { label: 'Average', color: 'var(--s2)' }]} />
          {years2.length > 1 ? <LineChart aria="Economy and average by year" labels={years2.map((y: any) => y.k)} fmt={d1}
            series={[{ name: 'Economy', color: 'var(--s1)', values: years2.map((y: any) => (y.b >= 60 ? y.econ : null)) },
                     { name: 'Average', color: 'var(--s2)', values: years2.map((y: any) => (y.b >= 120 && y.w >= 2 ? y.avg : null)) }]} />
            : <div className="empty">Needs at least two seasons.</div>}
        </Panel>
      </div>
      </>}
      {tab === 'form' && <>
      <RollingForm p={p} fk={fk} role="bowl" />
      <Panel title="Recent bowling" sub="Wickets per innings, oldest to newest."
        tools={<MiniSelect label="In" value={rc} onChange={setRc} options={compOpts} />}>
        {recent.length ? <Columns key={rc} aria="Recent bowling" fmt={n0} highlightMax={false} data={recent.map((x: any) => ({
          label: dateShort(x[0]).split(' ').slice(1).join(' '), title: `${dateShort(x[0])} v ${x[2]}`, value: x[5],
          extra: [{ label: 'Figures', value: `${x[5]}/${x[4]} (${overs(x[3])})` }, { label: 'Impact', value: signed(x[6], 1) }] }))} />
          : <div className="empty">No recent bowling here.</div>}
      </Panel>
      </>}
      {tab === 'scoring' && <>
      <div className="grid g2">
        <Panel title="Phase of the innings" sub={phM === 'econ' ? 'Runs per over. Lower is better.' : phM === 'avg' ? 'Runs per wicket. Lower is better.' : 'Balls per wicket. Lower is better.'}
          tools={<>
            <Mini label="Metric" value={phM} onChange={setPhM} options={[['econ', 'Econ'], ['avg', 'Avg'], ['sr', 'SR']]} />
            <Mini label="Vs" value={phH} onChange={setPhH} options={[['all', 'All'], ['R', 'RHB'], ['L', 'LHB']]} />
          </>}>
          <HBars key={phH + phM} fmt={PM[phM][1]} base={PM[phM][2]} refLabel="career" rows={phaseRows.map(bowlSplit).sort((a: any, b: any) => +a.k - +b.k).map((x: any) => ({
            label: PHASES[fam][+x.k], value: x.b >= 24 ? x[phM] : null, note: `${overs(x.b)} ov · ${n0(x.w)} wkts · econ ${d2(x.econ)}`,
            tipRows: [{ label: 'Average', value: d1(x.avg) }, { label: 'Impact', value: signed(x.imp, 0) }, { label: 'Dot %', value: pct(x.dotp) }] }))} />
        </Panel>
        <Panel title="Right- vs left-handers" sub="Economy against each batting hand. Lower is better."
          tools={<Mini label="Phase" value={hP} onChange={setHP} options={[['all', 'All'], ...phasesAvail.sort().map((k) => [k, phaseShort(fam, k)] as [string, string])]} />}>
          <HBars key={hP} fmt={plus} refLabel="overall economy" base={(() => { const r = handRows.map(bowlSplit); const b = r.reduce((a: number, x: any) => a + (x.b ?? 0), 0); return b ? (6 * r.reduce((a: number, x: any) => a + (x.r ?? 0), 0)) / b : 0; })()} rows={handRows.map(bowlSplit).filter((x: any) => x.k !== 'unknown').map((x: any) => ({
            label: x.k === 'R' ? 'vs right-handers' : 'vs left-handers', value: x.b >= 24 ? x.econ : null, note: `${overs(x.b)} ov · ${n0(x.w)} wkts`,
            tipRows: [{ label: 'Wickets', value: n0(x.w) }, { label: 'Strike rate', value: d1(x.sr) }, { label: 'Avg', value: d1(x.avg) }] }))} />
        </Panel>
      </div>
      </>}
      {tab === 'dismissals' && <>
      <div className="grid g2">
        <HowOut p={p} fk={fk} role="bowl" />
        <WhoTheyGet rows={sp.hand ?? []} />
      </div>
      {cfg && zb && p.zc?.[fk]?.bowl && Object.keys(p.zc[fk].bowl).length > 0 && (
        <Panel title={<>Pitch map <span className="est-badge">Estimated</span> <InfoTip text={GLOSSARY.zones} /></>} eyebrow="Inferred zones · bowling" sub="Where the wickets come from, where the runs leak, and where the dot balls build pressure. Estimated, not ball-tracking.">
          <PitchMap role="bowl" zc={p.zc[fk].bowl} base={zb.bowl} cfg={cfg} fam={fam} btype={p.btype} />
        </Panel>
      )}
      </>}
      {tab === 'matchups' && <>
      <div className="grid g2">
        <Panel title="Head to head: batters" flush
          tools={<>
            <MiniSearch value={muQ} onChange={setMuQ} placeholder="Find a batter" />
            <Mini label="Min balls" value={muMin} onChange={setMuMin} options={[['6', '6'], ['30', '30'], ['60', '60']]} />
          </>}>
          <Table rows={mus} sort="b" limit={10} empty="No batter matches." cols={[
            { key: 'n', label: 'Batter', left: true, get: (x: any) => x[1], fmt: (v, x: any) => <Link to={`/player/${x[0]}`}>{v}</Link> },
            { key: 'b', label: 'Balls', get: (x: any) => x[2] },
            { key: 'r', label: 'Runs', get: (x: any) => x[3] },
            { key: 'o', label: 'Wkts', get: (x: any) => x[4] },
            { key: 'sr', label: 'Batter SR', get: (x: any) => (100 * x[3]) / x[2], fmt: d1 },
            { key: 'dot', label: 'Dot %', get: (x: any) => x[5] / x[2], fmt: (v) => pct(v, 0) },
            { key: 'how', label: 'How out', left: true, sortable: false, get: (x: any) => kindsText(x[10], true), fmt: (v, x: any) => <Link className="link" to={`/h2h?bat=${x[0]}&bowl=${p.id}`} title={`${kindsText(x[10])}. Open the full head to head.`}>{v}</Link> },
          ]} />
        </Panel>
        <OppVenue rows={sp[ov] ?? []} ov={ov} setOv={setOv} kind="bowl" />
      </div>
      <HomeAway p={p} fk={fk} role="bowl" />
      </>}
    </>
  );
}


// Current form: the last 10 innings in this format against the career figures.
function FormStrip({ rows, careerAvg, careerSr }: { rows: any[]; careerAvg: number; careerSr: number }) {
  const last = rows.slice(-10);
  if (last.length < 3) return null;
  const r = last.reduce((a, x) => a + x[3], 0), b = last.reduce((a, x) => a + x[4], 0), o = last.filter((x) => x[5]).length;
  const avg = o ? r / o : NaN, sr = b ? (100 * r) / b : NaN;
  const trend = (now: number, base: number) => (!Number.isFinite(now) || !Number.isFinite(base) ? '' : now >= base * 1.1 ? 'up' : now <= base * 0.9 ? 'down' : 'flat');
  const arrow = (t: string) => (t === 'up' ? '▲' : t === 'down' ? '▼' : '▬');
  const ta = trend(avg, careerAvg), ts = trend(sr, careerSr);
  const max = Math.max(...last.map((x) => x[3]), 30);
  return (
    <Panel title="Current form" sub={`Last ${last.length} innings in this format, newest on the right. Taller = more runs; * = not out.`}>
      <div className="form-strip">
        <div className="form-bars" aria-label="Runs in recent innings">
          {last.map((x, i) => (
            <Link key={`${x[8]}-${i}`} to={`/match/${x[8]}`} className={`form-bar${x[3] >= 50 ? ' big' : ''}`} title={`${dateShort(x[0])} v ${x[2]}: ${x[3]}${x[5] ? '' : '*'} (${x[4]})`}
              style={{ ['--h' as any]: `${Math.max(6, (x[3] / max) * 100)}%`, animationDelay: `${i * 50}ms` }}>
              <span className="v">{x[3]}{x[5] ? '' : '*'}</span>
              <span className="o">{String(x[2]).split(' ').map((w: string) => w[0]).join('').slice(0, 3)}</span>
            </Link>
          ))}
        </div>
        <div className="form-kpis">
          <div><span className="l">Average</span><b>{Number.isFinite(avg) ? d1(avg) : '–'}</b><span className={`t ${ta}`}>{arrow(ta)} career {d1(careerAvg)}</span></div>
          <div><span className="l">Strike rate</span><b>{d1(sr)}</b><span className={`t ${ts}`}>{arrow(ts)} career {d1(careerSr)}</span></div>
          <div><span className="l">Runs</span><b>{n0(r)}</b><span className="t">{last.filter((x) => x[3] >= 50).length} scores of 50+</span></div>
        </div>
      </div>
    </Panel>
  );
}

// Last 10 innings as split-flap tiles inside the hero band, with average and strike rate against the career figures.
function HeroForm({ p, fk, role }: { p: any; fk: string; role: 'bat' | 'bowl' }) {
  const [fam, g] = fk.split('-');
  const comps = new Set((p.comps ?? []).filter((c: any) => c.fam === fam && c.g === g).map((c: any) => c.comp));
  const bowl = role === 'bowl';
  const rows = ((bowl ? p.recent?.bowl : p.recent?.bat) ?? []).filter((x: any) => comps.has(x[1])).slice(-10);
  if (rows.length < 3) return null;
  const s = p.summary[fk]?.[bowl ? 'bowl' : 'bat'] ?? {};
  // bat rows: [date, comp, opp, runs, balls, out, ...]; bowl rows: [date, comp, opp, balls, runs, wkts, ...]
  const sum = (i: number) => rows.reduce((a: number, x: any) => a + (+x[i] || 0), 0);
  const kpis = bowl
    ? [['Wickets', String(sum(5)), `${(s.w / Math.max(s.i, 1) * rows.length).toFixed(0)} usual`], ['Economy', (6 * sum(4) / Math.max(sum(3), 1)).toFixed(2), `career ${(6 * s.r / Math.max(s.b, 1)).toFixed(2)}`]]
    : [['Average', rows.filter((x: any) => x[5]).length ? (sum(3) / rows.filter((x: any) => x[5]).length).toFixed(1) : '–', `career ${(s.r / Math.max(s.o, 1)).toFixed(1)}`], ['Strike rate', (100 * sum(3) / Math.max(sum(4), 1)).toFixed(1), `career ${(100 * s.r / Math.max(s.b, 1)).toFixed(1)}`]];
  const opp = (t: string) => String(t).split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return (
    <div className="hero-form">
      <div className="hf-label">Last {rows.length} {bowl ? 'bowling innings' : 'innings'}, newest on the right</div>
      <div className="hf-tiles">
        {rows.map((x: any, i: number) => {
          const v = bowl ? `${x[5]}/${x[4]}` : `${x[3]}${x[5] ? '' : '*'}`;
          const big = bowl ? x[5] >= 3 : x[3] >= 50;
          return <Link key={i} to={`/match/${x[8]}`} className={`hf-tile${big ? ' big' : ''}`} title={`${x[0]} v ${x[2]}`} style={{ animationDelay: `${i * 70}ms` }}><b>{v}</b><span>{opp(x[2])}</span></Link>;
        })}
      </div>
      <div className="hf-kpis">{kpis.map(([l, v, h]) => <div key={l}><span>{l}</span><b>{v}</b><i>{h}</i></div>)}</div>
    </div>
  );
}
