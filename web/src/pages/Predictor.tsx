import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { usePageMeta } from '../lib/meta';
import { Link } from 'react-router-dom';
import { load, useData } from '../lib/data';
import { FMTS, Fmt, useSettings } from '../lib/settings';
import { d1, d2, dateShort, n0 } from '../lib/fmt';
import { FAM_LABEL } from '../lib/labels';
import {
  batFactor, bowlFactor, CALIB, chaseCurve, hash, LimData, LimInput, mdProbs, MdData, mean, PITCH_ALPHA, Player, quantile, simLimited, simMd,
} from '../lib/predict';
import { ErrorBox, Legend, Loader, Mini, Panel, SectionHead, Seg } from '../components/ui';
import { Columns, LineChart } from '../components/charts';
import { Board, SbCell } from '../components/Scoreboard';

// ---------- inputs ----------
type Pick = { id?: string; name: string; rf: number; wf: number; n: number };
type BatIn = { p: Pick | null; runs: number; balls: number };
type BowlIn = { p: Pick | null; overs: number };
type Form = {
  batTeam: string; bowlTeam: string; venue: string; comp: string; level: 'top' | 'intl' | 'other'; year: string;
  toss: '' | 'bat' | 'bowl'; tossCall: '' | 'bat' | 'field';
  inn: number; score: number; wkts: number; overs: string; sched: number; target: number;
  prev: number[]; followOn: boolean; day: number; oversToday: number;
  striker: BatIn; nonStriker: BatIn; next: (Pick | null)[]; bowlers: BowlIn[];
};
const MAX_OVERS: Record<string, number> = { T20: 20, HUN: 100 / 6, ODI: 50, LA: 50 };
const OPD: Record<string, number> = { 'TEST-male': 90, 'TEST-female': 100, 'FC-male': 96, 'FC-female': 100 };
const DAYS: Record<string, number> = { 'TEST-male': 5, 'TEST-female': 4, 'FC-male': 4, 'FC-female': 3 };
const dataKey = (fmt: Fmt, g: string) => `${fmt === 'LA' ? 'ODI' : fmt}-${g}`;
const isMulti = (fmt: Fmt) => fmt === 'TEST' || fmt === 'FC';
const parseOvers = (s: string, bpo = 6) => { const [o, b] = String(s).split('.'); return (+o || 0) * bpo + Math.min(+(b || 0), bpo - 1); };
const oversStr = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const EXAMPLES: Record<string, Partial<Form> & { label: string }> = {
  'T20-male': { label: 'A T20 chase going down to the wire', comp: 'ipl', batTeam: 'Royal Challengers Bengaluru', bowlTeam: 'Mumbai Indians', venue: 'wankhede-stadium', inn: 2, score: 142, wkts: 4, overs: '16.0', target: 191 },
  'ODI-male': { label: 'An ODI first innings at halfway', comp: 'men-odi', batTeam: 'India', bowlTeam: 'Australia', inn: 1, score: 148, wkts: 2, overs: '25.0' },
  'TEST-male': { label: 'A fourth-innings chase on day five', batTeam: 'England', bowlTeam: 'India', inn: 4, prev: [364, 332, 271], score: 121, wkts: 3, overs: '38.0', day: 5, oversToday: 20 },
};

function blankForm(fmt: Fmt, d: LimData | MdData | null): Form {
  return {
    batTeam: '', bowlTeam: '', venue: '', comp: '', level: 'top', year: d ? Object.keys(d.era).sort().slice(-1)[0] ?? '' : '', toss: '', tossCall: '',
    inn: 1, score: 0, wkts: 0, overs: '0.0', sched: Math.round(MAX_OVERS[fmt] ?? 20), target: 0,
    prev: [], followOn: false, day: 1, oversToday: 0,
    striker: { p: null, runs: 0, balls: 0 }, nonStriker: { p: null, runs: 0, balls: 0 }, next: [], bowlers: [],
  };
}

// ---------- small form controls ----------
function Num({ label, value, onChange, min = 0, max, step = 1, w = 84, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; w?: number; hint?: string }) {
  return (
    <label className="field">{label}
      <input className="input mono" type="number" inputMode="numeric" min={min} max={max} step={step} value={Number.isFinite(value) ? value : 0} style={{ width: w }}
        onChange={(e) => { const v = +e.target.value; onChange(Math.max(min, max != null ? Math.min(max, v) : v)); }} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function Choose({ label, value, onChange, options, w = 220 }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; w?: number }) {
  return (
    <label className="field">{label}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: w, maxWidth: '100%' }}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}

// Searchable team / venue box: a text input with a filtered list
function Finder({ label, value, onChange, items, placeholder, w = 240 }: { label: string; value: string; onChange: (k: string) => void; items: [string, string, string?][]; placeholder: string; w?: number }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const cur = items.find((x) => x[0] === value);
  const hits = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return items.filter((x) => words.every((wd) => norm(x[1] + ' ' + (x[2] ?? '')).includes(wd))).slice(0, 12);
  }, [q, items]);
  return (
    <label className="field" style={{ position: 'relative' }}>{label}
      <input className="input" style={{ width: w, maxWidth: '100%' }} placeholder={placeholder} value={open ? q : cur?.[1] ?? ''}
        onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
      {open && (
        <div className="search-pop" style={{ top: 58, width: Math.max(w, 260) }} role="listbox">
          <a href="#" onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}><span className="muted">Not set (average)</span></a>
          {hits.map((x) => (
            <a key={x[0]} href="#" onMouseDown={(e) => { e.preventDefault(); onChange(x[0]); setOpen(false); }}><span>{x[1]}</span>{x[2] && <small>{x[2]}</small>}</a>
          ))}
        </div>
      )}
    </label>
  );
}

// Player box: search the directory, load the profile, turn it into run and wicket factors for this format
function PlayerBox({ label, value, onChange, role, fk, gender, compact }: { label: string; value: Pick | null; onChange: (p: Pick | null) => void; role: 'bat' | 'bowl'; fk: string; gender: string; compact?: boolean }) {
  const idx = useData<any>('search.json').data;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hits = useMemo(() => {
    if (!idx || q.trim().length < 2) return [];
    const words = norm(q).split(/\s+/).filter(Boolean);
    return idx.players.filter((p: any) => p[3] === gender && words.every((wd) => norm(p[1] + ' ' + p[2] + ' ' + p[4]).includes(wd))).slice(0, 8);
  }, [idx, q, gender]);
  const pick = async (p: any) => {
    setOpen(false); setQ(''); setBusy(true);
    try {
      const prof = await load<any>(`players/${p[0]}.json`);
      const sum = prof.summary?.[fk]?.[role];
      const f = role === 'bat' ? batFactor(sum) : bowlFactor(sum);
      onChange({ id: p[0], name: p[1], ...f });
    } catch { onChange({ id: p[0], name: p[1], rf: 1, wf: 1, n: 0 }); }
    setBusy(false);
  };
  const tip = value && value.n ? (role === 'bat'
    ? `${value.rf >= 1 ? 'Scores' : 'Scores'} ${Math.abs(Math.round((value.rf - 1) * 100))}% ${value.rf >= 1 ? 'faster' : 'slower'} than average, out ${Math.abs(Math.round((value.wf - 1) * 100))}% ${value.wf <= 1 ? 'less' : 'more'} often`
    : `Concedes ${Math.abs(Math.round((value.rf - 1) * 100))}% ${value.rf <= 1 ? 'less' : 'more'} than average, takes ${Math.abs(Math.round((value.wf - 1) * 100))}% ${value.wf >= 1 ? 'more' : 'fewer'} wickets`)
    : value ? 'No record in this format: treated as average' : '';
  return (
    <label className="field" style={{ position: 'relative', minWidth: 0 }}>{label}
      <input className="input" style={{ width: compact ? 170 : 210, maxWidth: '100%' }} placeholder={busy ? 'Loading…' : 'Search a player'} value={open ? q : value?.name ?? ''}
        onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
      {tip && !open && <small className="muted" style={{ maxWidth: 230 }}>{tip}</small>}
      {open && (q.trim().length >= 2 || value) && (
        <div className="search-pop" style={{ top: 58, width: 300 }} role="listbox">
          {value && <a href="#" onMouseDown={(e) => { e.preventDefault(); onChange(null); setOpen(false); }}><span className="muted">Clear (average player)</span></a>}
          {hits.map((p: any) => <a key={p[0]} href="#" onMouseDown={(e) => { e.preventDefault(); pick(p); }}><span>{p[1]}</span><small>{p[4]} · {p[5]}–{p[6]}</small></a>)}
        </div>
      )}
    </label>
  );
}

function Group({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="pf-group">
      <h3>{title}</h3>
      <div className="pf-row">{children}</div>
      {note && <div className="muted" style={{ fontSize: 12 }}>{note}</div>}
    </div>
  );
}

// ---------- page ----------
export default function Predictor() {
  usePageMeta('Situation predictor');
  const st = useSettings();
  const [fmt, setFmt] = useState<Fmt>(st.fmt);
  const [gender, setGender] = useState(st.gender);
  const key = dataKey(fmt, gender);
  const { data, error } = useData<LimData | MdData>(`predict/${key}.json`);
  const [form, setForm] = useState<Form>(() => blankForm(st.fmt, null));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!data) return;
    const f = blankForm(fmt, data);
    const ex = EXAMPLES[key];
    setForm(ex ? { ...f, ...ex } as Form : f);
    setReady(true);
  }, [data, key]); // eslint-disable-line
  const set = (p: Partial<Form>) => setForm((o) => ({ ...o, ...p }));
  const pfk = `${fmt}-${gender}`;

  if (error) return <ErrorBox error={error === 'Not found' ? `The predictor does not have enough ${gender === 'female' ? "women's" : "men's"} ${FAM_LABEL[fmt]} data. Try another format.` : error} />;

  const teams: [string, string, string?][] = data ? Object.entries(data.team_bat).sort((a, b) => b[1][2] - a[1][2]).map(([k, v]) => [k, k, `${n0(v[2])} balls`]) : [];
  const venues: [string, string, string?][] = data ? Object.entries(data.venues).sort((a, b) => b[1][2] - a[1][2]).map(([k, v]) => [k, v[3], v[4] ?? undefined]) : [];
  const multi = isMulti(fmt);

  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow">Situation predictor</div>
          <h1>What happens next?</h1>
          <p className="lede">Enter any match situation. For limited-overs cricket the site plays out the rest of the match ball by ball thousands of times,
            using how real matches went from the same balls left, wickets down and run rate needed, adjusted for the teams, the ground, the era and the players.
            Tests and first-class games use a model trained on every past Test situation. All of it runs in your browser.</p>
        </div>
      </section>

      <Panel className="pf-panel" title="Match situation" sub={data ? `Built from ${n0((data as any).balls ?? (data as any).states)} ${multi ? 'over-by-over match states' : 'balls'} in ${n0(data.matches)} matches, to ${dateShort(data.data_to)}.` : 'Loading the model…'}
        right={EXAMPLES[key] && <button className="btn" onClick={() => data && setForm({ ...blankForm(fmt, data), ...EXAMPLES[key] } as Form)}>Load example</button>}>
        <Group title="Format">
          <div className="seg" role="group" aria-label="Format">
            {FMTS.map((f) => <button key={f.k} type="button" aria-pressed={fmt === f.k} onClick={() => { setFmt(f.k); setReady(false); }}>{f.l}</button>)}
          </div>
          <Seg label="Gender" value={gender} onChange={(v) => { setGender(v); setReady(false); }} options={[['male', 'Men'], ['female', 'Women']]} />
        </Group>
        {!data || !ready ? <Loader text="Loading the model" /> : (
          <>
            <Group title="Teams and ground" note="Leave any of these blank to use an average side or ground.">
              <Finder label="Batting team" value={form.batTeam} onChange={(v) => set({ batTeam: v })} items={teams} placeholder="Search a team" />
              <Finder label="Bowling team" value={form.bowlTeam} onChange={(v) => set({ bowlTeam: v })} items={teams} placeholder="Search a team" />
              <Finder label="Venue" value={form.venue} onChange={(v) => set({ venue: v })} items={venues} placeholder="Search a ground" w={280} />
            </Group>
            {multi ? <MdInputs form={form} set={set} fk={pfk} /> : <LimInputs form={form} set={set} fmt={fmt} />}
            <Group title="Players in the middle" note="Each player's record in this format nudges the run and wicket rates. Unknown players count as average.">
              <PlayerBox label="On strike" role="bat" fk={pfk} gender={gender} value={form.striker.p} onChange={(p) => set({ striker: { ...form.striker, p } })} />
              <Num label="Runs" value={form.striker.runs} onChange={(v) => set({ striker: { ...form.striker, runs: v } })} w={70} />
              <Num label="Balls" value={form.striker.balls} onChange={(v) => set({ striker: { ...form.striker, balls: v } })} w={70} />
              <span className="pf-gap" />
              <PlayerBox label="Non-striker" role="bat" fk={pfk} gender={gender} value={form.nonStriker.p} onChange={(p) => set({ nonStriker: { ...form.nonStriker, p } })} />
              <Num label="Runs" value={form.nonStriker.runs} onChange={(v) => set({ nonStriker: { ...form.nonStriker, runs: v } })} w={70} />
              <Num label="Balls" value={form.nonStriker.balls} onChange={(v) => set({ nonStriker: { ...form.nonStriker, balls: v } })} w={70} />
            </Group>
            <Group title="Still to bat" note="In batting order. Anyone not listed counts as an average batter for that position.">
              {[0, 1, 2, 3].map((i) => (
                <PlayerBox key={i} compact label={`Next ${i + 1}`} role="bat" fk={pfk} gender={gender} value={form.next[i] ?? null}
                  onChange={(p) => { const nx = [...form.next]; nx[i] = p; set({ next: nx }); }} />
              ))}
            </Group>
            <Group title={multi ? 'Bowling attack' : 'Bowlers with overs left'} note={multi ? 'Bowlers share the work at random.' : `Enter overs already bowled; each bowler can bowl up to ${fmt === 'HUN' ? '20 balls' : `${fmt === 'T20' ? 4 : 10} overs`}. Overs not covered go to an average bowler.`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="pf-pair">
                  <PlayerBox compact label={`Bowler ${i + 1}`} role="bowl" fk={pfk} gender={gender} value={form.bowlers[i]?.p ?? null}
                    onChange={(p) => { const b = [...form.bowlers]; b[i] = { p, overs: b[i]?.overs ?? 0 }; set({ bowlers: b }); }} />
                  {!multi && <Num label="Bowled" w={64} step={1} value={form.bowlers[i]?.overs ?? 0} max={fmt === 'T20' ? 4 : fmt === 'HUN' ? 3 : 10}
                    onChange={(v) => { const b = [...form.bowlers]; b[i] = { p: b[i]?.p ?? null, overs: v }; set({ bowlers: b }); }} />}
                </span>
              ))}
            </Group>
            <Group title="Conditions" note="Cricsheet does not record day or night games, so floodlights are not modelled.">
              {!multi && (data as LimData).comps && (
                <Choose label="Competition" value={form.comp} w={260} onChange={(v) => {
                  const ys = (data as LimData).comps[v]?.years; set({ comp: v, year: ys ? Object.keys(ys).sort().slice(-1)[0] : form.year }); }}
                  options={[['', 'Not listed / any'], ...Object.entries((data as LimData).comps).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([k, c]) => [k, c.label] as [string, string])]} />
              )}
              {(multi || !form.comp) && !multi && <Choose label="Level" value={form.level} onChange={(v) => set({ level: v as Form['level'] })} w={240}
                options={[['top', 'Full members and major leagues'], ['intl', 'International'], ['other', 'Other (associates, minor events)']]} />}
              <Choose label={form.comp && !multi ? 'Season' : 'Era (scoring level of)'} value={form.year} onChange={(v) => set({ year: v })} w={120}
                options={Object.keys(!multi && form.comp ? (data as LimData).comps[form.comp]?.years ?? data.era : data.era).sort().reverse().map((y) => [y, y] as [string, string])} />
              <Choose label="Toss won by" value={form.toss} onChange={(v) => set({ toss: v as Form['toss'] })} w={160} options={[['', 'Not set'], ['bat', 'Batting team'], ['bowl', 'Bowling team']]} />
              {form.toss && <Choose label="And chose to" value={form.tossCall} onChange={(v) => set({ tossCall: v as Form['tossCall'] })} w={120} options={[['', 'Not set'], ['bat', 'Bat'], ['field', 'Field']]} />}
            </Group>
          </>
        )}
      </Panel>

      {data && ready && (multi ? <MdResults d={data as MdData} form={form} fk={pfk} /> : <LimResults d={data as LimData} form={form} fmt={fmt} gender={gender} fk={pfk} />)}
    </>
  );
}

function LimInputs({ form, set, fmt }: { form: Form; set: (p: Partial<Form>) => void; fmt: Fmt }) {
  const max = Math.round(MAX_OVERS[fmt] ?? 20);
  return (
    <Group title="Score" note={fmt === 'HUN' ? 'The Hundred is entered in 6-ball overs: 100 balls = 16.4 overs.' : 'Change scheduled overs for a rain-shortened match. Enter the revised target for the chase.'}>
      <Seg label="Innings" value={String(form.inn)} onChange={(v) => set({ inn: +v })} options={[['1', 'Batting first'], ['2', 'Chasing']]} />
      <Num label="Runs" value={form.score} onChange={(v) => set({ score: v })} />
      <Num label="Wickets" value={form.wkts} onChange={(v) => set({ wkts: v })} max={9} w={70} />
      <label className="field">Overs bowled<input className="input mono" value={form.overs} onChange={(e) => set({ overs: e.target.value.replace(/[^0-9.]/g, '') })} style={{ width: 84 }} /></label>
      <Num label="Scheduled overs" value={form.sched} onChange={(v) => set({ sched: v })} max={max} min={1} w={90} />
      {form.inn === 2 && <Num label="Target" value={form.target} onChange={(v) => set({ target: v })} w={84} />}
    </Group>
  );
}

function MdInputs({ form, set, fk }: { form: Form; set: (p: Partial<Form>) => void; fk: string }) {
  const k = form.inn;
  const names = ['1st innings', '2nd innings', '3rd innings'];
  return (
    <>
      <Group title="Match so far" note="Enter the totals of completed innings. The batting side of each innings follows the normal order unless the follow-on was enforced.">
        <Seg label="Innings" value={String(k)} onChange={(v) => set({ inn: +v })} options={[['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th']]} />
        {Array.from({ length: k - 1 }, (_, i) => (
          <Num key={i} label={`${names[i]} total`} value={form.prev[i] ?? 0} onChange={(v) => { const p = [...form.prev]; p[i] = v; set({ prev: p }); }} w={90} />
        ))}
        {k >= 3 && <label className="field">Follow-on<span className="row" style={{ height: 34 }}><input type="checkbox" checked={form.followOn} onChange={(e) => set({ followOn: e.target.checked })} /> enforced</span></label>}
      </Group>
      <Group title="This innings">
        <Num label="Runs" value={form.score} onChange={(v) => set({ score: v })} />
        <Num label="Wickets" value={form.wkts} onChange={(v) => set({ wkts: v })} max={9} w={70} />
        <label className="field">Overs<input className="input mono" value={form.overs} onChange={(e) => set({ overs: e.target.value.replace(/[^0-9.]/g, '') })} style={{ width: 84 }} /></label>
        <Num label="Day" value={form.day} onChange={(v) => set({ day: v })} min={1} max={DAYS[fk] ?? 5} w={64} />
        <Num label="Overs bowled today" value={form.oversToday} onChange={(v) => set({ oversToday: v })} max={OPD[fk] ?? 90} w={90}
          hint={`${OPD[fk] ?? 90} overs a day, ${DAYS[fk] ?? 5} days`} />
      </Group>
    </>
  );
}

// ---------- context factors ----------
// Competition and season set the scoring level for each phase of the innings; teams and the venue add a half-weight nudge.
function factors(d: LimData | MdData, form: Form, bat: string, bowl: string) {
  const lim = (d as LimData).comps != null;
  const half = (x: number) => Math.pow(x, 0.5);
  const tb = d.team_bat[bat], tw = d.team_bowl[bowl], v = d.venues[form.venue];
  const rows: [string, number, number, string][] = [];
  let phr = [1, 1, 1], phw = [1, 1, 1];
  const comp = lim ? (d as LimData).comps[form.comp] : undefined;
  if (comp) {
    const cy = comp.years[form.year] ?? Object.values(comp.years).slice(-1)[0];
    phr = cy.map((x) => x[0]); phw = cy.map((x) => x[1]);
    rows.push([`${comp.label} ${form.year}`, NaN, NaN, `start ×${phr[0].toFixed(2)} · middle ×${phr[1].toFixed(2)} · end ×${phr[2].toFixed(2)}`]);
  } else if (lim && (d as LimData).era_ph?.[form.year]) {
    const e = (d as LimData).era_ph[form.year];
    phr = e.map((x) => x[0]); phw = e.map((x) => x[1]);
    rows.push([`All cricket in ${form.year}`, NaN, NaN, `start ×${phr[0].toFixed(2)} · middle ×${phr[1].toFixed(2)} · end ×${phr[2].toFixed(2)}`]);
    const lv = (d as LimData).level?.[form.level];
    if (lv) rows.push(['Level', lv[0], lv[1], form.level === 'top' ? 'full members and major leagues' : form.level === 'intl' ? 'international' : 'other']);
  } else {
    const e = d.era[form.year] ?? [1, 1, 0];
    rows.push(['Era', e[0], e[1], form.year]);
  }
  rows.push(['Batting team', half(tb?.[0] ?? 1), half(tb?.[1] ?? 1), bat || 'average']);
  rows.push(['Bowling team', half(tw?.[0] ?? 1), half(tw?.[1] ?? 1), bowl || 'average']);
  rows.push(['Venue', half(v?.[0] ?? 1), half(v?.[1] ?? 1), v?.[3] ?? 'average']);
  const rf = rows.reduce((a, r) => a * (Number.isFinite(r[1]) ? r[1] : 1), 1), wf = rows.reduce((a, r) => a * (Number.isFinite(r[2]) ? r[2] : 1), 1);
  // multi-day has no phase split: fold it in
  return lim ? { rf, wf, phr, phw, rows, comp: !!comp } : { rf: rf * phr[0], wf: wf * phw[0], phr: undefined, phw: undefined, rows, comp: false };
}

const toP = (b: BatIn | null, fallback: string): Player => ({ id: b?.p?.id, name: b?.p?.name ?? fallback, rf: b?.p?.rf ?? 1, wf: b?.p?.wf ?? 1, runs: b?.runs ?? 0, balls: b?.balls ?? 0 });
const pctTxt = (v: number) => `${Math.round(v * 100)}%`;

function useDebounced<T>(v: T, ms = 450) {
  const [x, setX] = useState(v);
  useEffect(() => { const t = setTimeout(() => setX(v), ms); return () => clearTimeout(t); }, [JSON.stringify(v)]); // eslint-disable-line
  return x;
}

// ---------- limited-overs results ----------
function LimResults({ d, form: live, fmt, gender, fk }: { d: LimData; form: Form; fmt: Fmt; gender: string; fk: string }) {
  const form = useDebounced(live);
  const [busy, setBusy] = useState(true);
  const [out, setOut] = useState<any>(null);
  const [reach, setReach] = useState(0);
  const [what, setWhat] = useState<'final' | 'worm'>('final');
  const job = useRef(0);
  const total = Math.min(d.full, Math.round(form.sched * 6));
  const balls = Math.min(parseOvers(form.overs), total - 1);
  const bat = form.batTeam || 'Batting side', bowl = form.bowlTeam || 'Bowling side';

  useEffect(() => {
    const id = ++job.current;
    setBusy(true);
    const t = setTimeout(() => {
      if (id !== job.current) return;
      const fx = factors(d, form, form.batTeam, form.bowlTeam);
      const par = d.first.find((f) => f[0] === Math.ceil(d.full / 6) && f[1] === 0 && f[2] === 0)?.[6] ?? (d.full === 300 ? 250 : 160);
      const alpha = PITCH_ALPHA[gender] ?? 0.3;
      const inn = form.inn === 2 ? 2 : 1;
      const target = inn === 2 ? Math.max(form.target, form.score + 1) : undefined;
      const pitch = inn === 2 && target && !fx.comp ? Math.pow(target / (par * (total / d.full)), alpha) : 1;
      const maxB = fmt === 'HUN' ? 20 : fmt === 'T20' ? 24 : 60;
      const bowlers: Player[] = form.bowlers.filter((b) => b?.p).map((b) => ({ id: b.p!.id, name: b.p!.name, rf: b.p!.rf, wf: b.p!.wf, ballsLeft: Math.max(0, maxB - Math.round(b.overs * 6)) }));
      const base: LimInput = {
        inn, score: form.score, wkts: Math.min(form.wkts, 9), balls, totalBalls: total, target,
        striker: toP(form.striker, 'Striker'), nonStriker: toP(form.nonStriker, 'Non-striker'),
        next: form.next.filter(Boolean).map((p) => ({ id: p!.id, name: p!.name, rf: p!.rf, wf: p!.wf })), bowlers, maxBowlerBalls: maxB,
        rf: fx.rf * pitch, wf: fx.wf, phr: fx.phr, phw: fx.phw,
      };
      if (base.striker.name === base.nonStriker.name) base.nonStriker = { ...base.nonStriker, name: base.nonStriker.name + ' (2)' };
      const N = d.full >= 300 ? 1800 : 3000;
      const seed = hash(JSON.stringify(form) + fk);
      const sim = simLimited(d, base, N, seed);
      let win: number, curve: ((t: number) => number) | null = null, par1 = NaN;
      const fx2 = factors(d, form, form.bowlTeam, form.batTeam);
      const base2 = { totalBalls: total, striker: toP(null, 'A'), nonStriker: toP(null, 'B'), next: [], bowlers: [], maxBowlerBalls: maxB, rf: fx2.rf, wf: fx2.wf, phr: fx2.phr, phw: fx2.phw };
      if (inn === 1) {
        const lo = quantile(sim.final, 0.03), hi = quantile(sim.final, 0.97);
        curve = chaseCurve(d, base2, lo, hi, d.full >= 300 ? 220 : 320, seed ^ 99, (tg) => (fx2.comp ? 1 : Math.pow(tg / (par * (total / d.full)), alpha)));
        win = mean(sim.final.map((x) => 1 - curve!(x)));
        // par: the total that gives a 50% chance
        for (let x = Math.round(lo); x <= hi + 60; x++) if (curve(x) <= 0.5) { par1 = x; break; }
      } else win = mean(sim.won);
      // what-ifs from the batting side's view
      const scen: [string, Partial<LimInput>][] = [
        ['Wicket next ball', { wkts: Math.min(base.wkts + 1, 9), balls: balls + 1, striker: { ...base.nonStriker }, nonStriker: { name: 'New batter', rf: 1, wf: 1, runs: 0, balls: 0 } }],
        ['Two quick wickets', { wkts: Math.min(base.wkts + 2, 9), balls: Math.min(balls + 6, total - 1), striker: { name: 'New batter', rf: 1, wf: 1, runs: 0, balls: 0 }, nonStriker: { name: 'New batter 2', rf: 1, wf: 1, runs: 0, balls: 0 } }],
        ['A boundary next ball', { score: base.score + 4, balls: balls + 1 }],
        ['Next over: a maiden', { balls: Math.min(balls + 6, total - 1) }],
        [`Next over goes for ${d.full >= 300 ? 12 : 15}`, { score: base.score + (d.full >= 300 ? 12 : 15), balls: Math.min(balls + 6, total - 1) }],
      ];
      const whatIfs = scen.map(([label, ch]) => {
        const s2 = simLimited(d, { ...base, ...ch }, Math.round(N / 3), seed + label.length, false);
        const w = inn === 1 && curve ? mean(s2.final.map((x) => 1 - curve!(x))) : mean(s2.won);
        return { label, win: w, med: quantile(s2.final, 0.5) };
      });
      if (id === job.current) { setOut({ sim, win, curve, par1, base, fx, pitch, whatIfs, N, target, inn }); setBusy(false); }
    }, 30);
    return () => clearTimeout(t);
  }, [JSON.stringify(form), d]); // eslint-disable-line

  if (!out) return <Loader text="Playing out the match" />;
  const { sim, win, par1, base, fx, pitch, whatIfs, N, target, inn } = out;
  const left = total - balls;
  const med = quantile(sim.final, 0.5), p10 = quantile(sim.final, 0.1), p90 = quantile(sim.final, 0.9);
  const se = 1.96 * Math.sqrt((win * (1 - win)) / N) * 100;
  const crr = balls ? (6 * form.score) / balls : 0;
  const need = target != null ? target - form.score : 0;
  const rrr = target != null ? (6 * need) / Math.max(left, 1) : NaN;
  const reachT = reach || (inn === 2 ? target : Math.round(med / 10) * 10 + 10);
  const pReach = mean(sim.final.map((x: number) => (x >= reachT ? 1 : 0)));
  // final score histogram
  const lo = Math.floor(quantile(sim.final, 0.01) / 5) * 5, hi = Math.ceil(quantile(sim.final, 0.99) / 5) * 5;
  const bins: { label: string; value: number; color?: string; extra: { label: string; value: string }[] }[] = [];
  for (let x = lo; x <= hi; x += 5) {
    const c = sim.final.filter((v: number) => v >= x && v < x + 5).length / sim.final.length;
    bins.push({ label: String(x), value: c * 100, color: target != null && x + 5 <= target ? 'var(--line-2)' : 'var(--s1)', extra: [{ label: 'Runs', value: `${x}–${x + 4}` }] });
  }
  // in a chase, show how it ends rather than the total (which is capped by the target)
  if (inn === 2 && target != null) {
    bins.length = 0;
    const spare = Math.max(12, Math.round(total / 10));
    const cats: [string, (i: number) => boolean, string][] = [
      ['Lost by 30+', (i) => sim.won[i] === 0 && target - 1 - sim.final[i] >= 30, 'var(--s2)'],
      ['Lose by 10–29', (i) => sim.won[i] === 0 && target - 1 - sim.final[i] >= 10 && target - 1 - sim.final[i] < 30, 'var(--s2)'],
      ['Lose by 1–9', (i) => sim.won[i] === 0 && target - 1 - sim.final[i] < 10, 'var(--s2)'],
      ['Tie', (i) => sim.won[i] === 0.5, 'var(--line-2)'],
      ['Win in the last over', (i) => sim.won[i] === 1 && total - sim.ballsUsed[i] < 6, 'var(--s1)'],
      [`Win, ${Math.round(spare / 6) > 1 ? `1–${Math.round(spare / 6)} overs` : '1 over'} spare`, (i) => sim.won[i] === 1 && total - sim.ballsUsed[i] >= 6 && total - sim.ballsUsed[i] < spare, 'var(--s1)'],
      ['Win with more to spare', (i) => sim.won[i] === 1 && total - sim.ballsUsed[i] >= spare, 'var(--s1)'],
    ];
    const short: Record<string, string> = { 'Lost by 30+': 'L 30+', 'Lose by 10–29': 'L 10–29', 'Lose by 1–9': 'L 1–9', Tie: 'Tie', 'Win in the last over': 'W last ov', 'Win with more to spare': 'W big' };
    short[cats[5][0]] = 'W early';
    for (const [label, f, color] of cats) {
      let c = 0; for (let i = 0; i < sim.final.length; i++) if (f(i)) c++;
      bins.push({ label: short[label] ?? label, value: (100 * c) / sim.final.length, color, extra: [{ label: 'Outcome', value: label }] });
    }
  }
  const winsSpare = sim.won.map((w: number, i: number) => (w === 1 ? total - sim.ballsUsed[i] : NaN)).filter((x: number) => Number.isFinite(x));
  // worm fan
  const ovLeft = Math.ceil(left / 6), startOv = Math.floor(balls / 6);
  const at = (k: number) => sim.worm.map((w: number[]) => w[Math.min(k, w.length - 1)] ?? form.score);
  const wormLabels = Array.from({ length: ovLeft }, (_, k) => String(startOv + k + 1));
  const fan = (q: number) => Array.from({ length: ovLeft }, (_, k) => quantile(at(k), q));
  const nx = sim.nextOver;
  const nxR = mean(nx.map((x: any) => x.r)), nxW = mean(nx.map((x: any) => (x.w > 0 ? 1 : 0))), nxB = mean(nx.map((x: any) => (x.bnd > 0 ? 1 : 0)));
  const allOut = mean(sim.wkts.map((w: number) => (w >= 10 ? 1 : 0)));
  // history
  const br = Math.ceil(left / 6), wk = Math.min(form.wkts, 9);
  let hist: any = null;
  if (inn === 2 && target != null) {
    const nb = Math.floor(need / d.need_step);
    let rows = d.chase.filter((c) => c[0] === br && c[1] === wk && c[2] === nb);
    if (rows.reduce((a, c) => a + c[3] + c[4], 0) < 40) rows = d.chase.filter((c) => Math.abs(c[0] - br) <= 1 && c[1] === wk && Math.abs(c[2] - nb) <= 1);
    const W = rows.reduce((a, c) => a + c[3], 0), L = rows.reduce((a, c) => a + c[4], 0), T = rows.reduce((a, c) => a + c[5], 0);
    hist = { n: W + L + T, rate: W / Math.max(1, W + L), ex: rows.flatMap((c) => c[6]).filter((e, i, a) => a.findIndex((x) => x[0] === e[0]) === i).slice(0, 6), desc: `needing ${nb * d.need_step}–${nb * d.need_step + d.need_step - 1} off about ${br * 6} balls with ${wk} down` };
  } else {
    const sb = Math.floor(form.score / d.score_step);
    let rows = d.first.filter((c) => c[0] === br && c[1] === wk && c[2] === sb);
    if (!rows.length || rows[0][3] < 30) rows = d.first.filter((c) => Math.abs(c[0] - br) <= 1 && c[1] === wk && Math.abs(c[2] - sb) <= 1);
    const n = rows.reduce((a, c) => a + c[3], 0);
    const wavg = (i: number) => rows.reduce((a, c) => a + (c[i] as number) * c[3], 0) / Math.max(1, n);
    hist = { n, p10: wavg(4), p50: wavg(6), p90: wavg(8), rate: wavg(9), ex: rows.flatMap((c) => c[10]).filter((e, i, a) => a.findIndex((x) => x[0] === e[0]) === i).slice(0, 6), desc: `${form.score - (form.score % d.score_step)}–${form.score - (form.score % d.score_step) + d.score_step - 1} for ${wk} with about ${br * 6} balls left` };
  }
  const cal = CALIB[fk];
  const v = d.venues[form.venue];

  return (
    <div className={`stack ${busy ? 'pf-busy' : ''}`} style={{ gap: 32 }}>
      <Board plate={`Prediction · ${bat} v ${bowl}`} foot={<>
        <span>{inn === 2 ? `${bat} need ${need} off ${left} balls · required ${d2(rrr)} an over` : `${bat} ${form.score}/${form.wkts} after ${oversStr(balls)} overs · run rate ${d2(crr)}`}</span>
        {busy && <span>Updating…</span>}
      </>}>
        <div className="sb-grid">
          <SbCell big label={`${bat} win`} value={pctTxt(win)} sub={`± ${Math.max(1, Math.round(se))} pts`} tone="up" />
          <SbCell big label={`${bowl} win`} value={pctTxt(1 - win)} sub={inn === 2 ? 'defending' : 'chasing'} delay={150} />
          {inn === 2
            ? <SbCell label="Balls to spare if they win" value={winsSpare.length ? String(Math.round(quantile(winsSpare, 0.5))) : '–'} sub={`median of ${n0(winsSpare.length)} winning finishes`} delay={300} />
            : <SbCell label="Projected total" value={String(Math.round(med))} sub={`80% between ${Math.round(p10)} and ${Math.round(p90)}`} delay={300} />}
          {inn === 1
            ? <SbCell label="Par total" value={Number.isFinite(par1) ? String(par1) : '–'} sub="gives the chasers 50%" delay={450} />
            : <SbCell label="Chance of a tie" value={pctTxt(mean(sim.won.map((x: number) => (x === 0.5 ? 1 : 0))))} sub={`${pctTxt(allOut)} chance of all out`} delay={450} />}
        </div>
      </Board>

      <div className="grid g2">
        <Panel title="Win probability" sub={`From ${n0(N)} simulated finishes. The band is the simulation's own uncertainty; real matches add more.`}>
          <div className="wl-bar" style={{ height: 22, borderRadius: 4 }} aria-hidden="true">
            <i className="sweep" style={{ width: `${win * 100}%`, background: 'var(--s1)' }} /><i style={{ width: `${(1 - win) * 100}%`, background: 'var(--s2)' }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>{bat} {pctTxt(win)}</b><b>{pctTxt(1 - win)} {bowl}</b></div>
          {hist && hist.n > 0 && (
            <div className="kv"><span>In {n0(hist.n)} real {inn === 2 ? 'chases' : 'first innings'} from a similar spot (all competitions and years), the batting side won</span><b>{pctTxt(hist.rate)}</b></div>
          )}
          {cal && <div className="muted" style={{ fontSize: 12 }}>Checked on {cal.n} real chase situations in this format: predictions were within {cal.rmse} points of what happened, on average.</div>}
        </Panel>
        <Panel title="What could change it" sub="The batting side's win chance if this happens next.">
          {whatIfs.map((w: any) => {
            const dd = w.win - win;
            return (
              <div key={w.label} className="kv" style={{ padding: '6px 0', borderTop: '1px solid var(--line)' }}>
                <span>{w.label}</span>
                <b>{pctTxt(w.win)} <span className={dd >= 0 ? 'pos' : 'neg'} style={{ fontSize: 12, marginLeft: 6 }}>{dd >= 0 ? '▲' : '▼'} {Math.abs(Math.round(dd * 100))} pts</span></b>
              </div>
            );
          })}
        </Panel>
      </div>

      <div className="grid wide-l">
        <Panel title={what === 'final' ? (target != null ? 'How the chase ends' : 'Where the innings ends') : 'How the innings unfolds'}
          sub={what === 'final' ? (target != null ? 'Share of simulated finishes by result and margin. Green: the chasing side wins; orange: the defenders win.' : 'Share of simulations ending in each 5-run band.') : 'Median score at the end of each over, with the range that covers 80% of simulations.'}
          tools={<Mini label="Show" value={what} onChange={setWhat} options={[['final', target != null ? 'Result' : 'Final total'], ['worm', 'Over by over']]} />}>
          {what === 'final'
            ? <Columns key="fin" aria="Distribution of final totals" data={bins} fmt={(x) => `${x.toFixed(0)}%`} highlightMax={false} height={230} />
            : <>
                <Legend items={[{ label: 'Median', color: 'var(--s1)' }, { label: '10th and 90th percentile', kind: 'dash' }]} />
                <LineChart key="worm" aria="Projected score by over" labels={wormLabels} fmt={n0} refLine={target} refLabel={target != null ? `target ${target}` : undefined} height={240}
                  series={[{ name: 'Median', color: 'var(--s1)', values: fan(0.5), wash: true }, { name: '90th percentile', color: 'var(--s3)', values: fan(0.9), dashed: true }, { name: '10th percentile', color: 'var(--s3)', values: fan(0.1), dashed: true }]} />
              </>}
        </Panel>
        <Panel title="Chance of reaching" sub="Pick a total.">
          <label className="field">Total
            <input type="range" min={Math.max(form.score, lo)} max={hi} value={reachT} onChange={(e) => setReach(+e.target.value)} />
          </label>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 28, fontWeight: 600 }}>{reachT}+</span>
            <span className="mono" style={{ fontSize: 28, fontWeight: 600, color: 'var(--accent)' }}>{pctTxt(pReach)}</span>
          </div>
          {[0.1, 0.25, 0.5, 0.75, 0.9].map((q) => <div key={q} className="kv"><span>{q === 0.5 ? 'Median' : `${q * 100}th percentile`}</span><b>{Math.round(quantile(sim.final, q))}</b></div>)}
          <div className="kv"><span>All out</span><b>{pctTxt(allOut)}</b></div>
          <div className="kv"><span>Average wickets lost by the end</span><b>{d1(mean(sim.wkts))}</b></div>
        </Panel>
      </div>

      <SectionHead title="Ball by ball from here" />
      <div className="grid g3">
        <Panel title={balls % 6 ? 'Rest of this over' : 'Next over'}>
          <div className="kv"><span>Expected runs</span><b>{d1(nxR)}</b></div>
          <div className="kv"><span>Chance of a wicket</span><b>{pctTxt(nxW)}</b></div>
          <div className="kv"><span>Chance of a boundary</span><b>{pctTxt(nxB)}</b></div>
          <div className="kv"><span>Chance of 10+ runs</span><b>{pctTxt(mean(nx.map((x: any) => (x.r >= 10 ? 1 : 0))))}</b></div>
        </Panel>
        {[base.striker, base.nonStriker].map((p: Player) => {
          const o = sim.batters[p.name] ?? [];
          const r = o.map((x: any) => x.runs);
          return (
            <Panel key={p.name} title={p.name} eyebrow={p === base.striker ? 'On strike' : 'Non-striker'} sub={`${p.runs ?? 0} off ${p.balls ?? 0} now`}>
              <div className="kv"><span>Expected final score</span><b>{d1(mean(r))}</b></div>
              <div className="kv"><span>Median</span><b>{Math.round(quantile(r, 0.5))}</b></div>
              {(p.runs ?? 0) < 50 && <div className="kv"><span>Chance of 50+</span><b>{pctTxt(mean(r.map((x: number) => (x >= 50 ? 1 : 0))))}</b></div>}
              {(p.runs ?? 0) < 100 && d.full >= 120 && <div className="kv"><span>Chance of 100+</span><b>{pctTxt(mean(r.map((x: number) => (x >= 100 ? 1 : 0))))}</b></div>}
              <div className="kv"><span>Chance of being out</span><b>{pctTxt(mean(o.map((x: any) => (x.out ? 1 : 0))))}</b></div>
              <div className="kv"><span>Expected balls faced</span><b>{d1(mean(o.map((x: any) => x.balls)))}</b></div>
            </Panel>
          );
        })}
      </div>
      {base.bowlers.length > 0 && (
        <Panel flush title="Bowlers' remaining spells" sub="Expected figures for the overs each bowler has left.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Bowler</th><th scope="col">Overs left</th><th scope="col">Exp. runs</th><th scope="col">Exp. wkts</th><th scope="col">Chance of a wicket</th><th scope="col">Economy</th></tr></thead>
              <tbody>
                {base.bowlers.map((b: Player) => {
                  const f = sim.bowlers[b.name] ?? [];
                  const bb = mean(f.map((x: any) => x.b)), rr = mean(f.map((x: any) => x.r));
                  return <tr key={b.name}><td>{b.id ? <Link className="link" to={`/player/${b.id}`}>{b.name}</Link> : b.name}</td><td>{oversStr(b.ballsLeft ?? 0)}</td><td>{d1(rr)}</td>
                    <td>{d2(mean(f.map((x: any) => x.w)))}</td><td>{pctTxt(mean(f.map((x: any) => (x.w > 0 ? 1 : 0))))}</td><td>{bb ? d2((6 * rr) / bb) : '–'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <SectionHead title="What history says" sub="Real matches that passed through a similar situation at the start of an over." />
      <div className="grid g2">
        <Panel title={hist.n ? `${n0(hist.n)} similar situations` : 'No close match in the records'} sub={hist.n ? `Matches at ${hist.desc}.` : 'This situation is rare, so the simulation is the only guide.'}>
          {hist.n > 0 && (inn === 2
            ? <div className="kv"><span>Chasing side won</span><b>{pctTxt(hist.rate)}</b></div>
            : <>
                <div className="kv"><span>Median final total</span><b>{Math.round(hist.p50)}</b></div>
                <div className="kv"><span>80% finished between</span><b>{Math.round(hist.p10)}–{Math.round(hist.p90)}</b></div>
                <div className="kv"><span>Batting side went on to win</span><b>{pctTxt(hist.rate)}</b></div>
              </>)}
          {hist.ex.length > 0 && <h3 style={{ marginTop: 6 }}>Examples</h3>}
          {hist.ex.map((e: any, i: number) => (
            <Link key={e[0] + i} className="list-row" style={{ padding: '8px 0' }} to={`/match/${e[0]}`}>
              <span className="t" style={{ fontWeight: 500 }}>{e[2]} v {e[3]}<div className="m">{dateShort(e[1])}</div></span>
              <span className={`tag ${e[4] === 'W' ? 'accent' : 'red'}`}>{e[4] === 'W' ? 'won' : e[4] === 'T' ? 'tied' : 'lost'}{e[5] != null ? ` · ${e[5]}` : ''}</span>
            </Link>
          ))}
        </Panel>
        <Panel title="What went into this" sub="Each factor scales the run rate and wicket rate of an average side in exactly this situation.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Factor</th><th scope="col" className="left">Setting</th><th scope="col">Runs</th><th scope="col">Wickets</th></tr></thead>
              <tbody>
                {fx.rows.map((r: any) => <tr key={r[0]}><td>{r[0]}</td><td className="txt left wrap">{r[3]}</td><td>{Number.isFinite(r[1]) ? fxTxt(r[1]) : 'by phase'}</td><td>{Number.isFinite(r[2]) ? fxTxt(r[2]) : 'by phase'}</td></tr>)}
                {inn === 2 && !fx.comp && <tr><td>Pitch, read from the target</td><td className="txt left">target {target}</td><td>{fxTxt(pitch)}</td><td>–</td></tr>}
                {[base.striker, base.nonStriker].filter((p: Player) => p.rf !== 1 || p.wf !== 1).map((p: Player) => <tr key={p.name}><td>Batter</td><td className="txt left">{p.name}</td><td>{fxTxt(p.rf)}</td><td>{fxTxt(p.wf)}</td></tr>)}
              </tbody>
            </table>
          </div>
          {v && <div className="muted" style={{ fontSize: 12 }}>{v[3]}: {n0(v[5])} first innings recorded, average {d1(v[6])}, sides batting first won {d1(v[7])}%.</div>}
          {live.toss && live.tossCall && <div className="muted" style={{ fontSize: 12 }}>The toss is shown for context only: once a match is under way, it adds nothing the score does not already say.</div>}
        </Panel>
      </div>
    </div>
  );
}
const fxTxt = (x: number) => (Math.abs(x - 1) < 0.005 ? '×1.00' : `×${x.toFixed(2)}`);

// ---------- multi-day results ----------
function MdResults({ d, form: live, fk }: { d: MdData; form: Form; fk: string }) {
  const form = useDebounced(live);
  const k = Math.min(4, Math.max(1, form.inn));
  // who batted which innings: A = 1, 3 (normal) or 1, 4 (follow-on)
  const sideOf = (i: number) => (form.followOn ? (i === 1 || i === 4 ? 'A' : 'B') : (i % 2 ? 'A' : 'B'));
  const me = sideOf(k);
  const prev = Array.from({ length: k - 1 }, (_, i) => form.prev[i] ?? 0);
  const mine = prev.reduce((a, x, i) => a + (sideOf(i + 1) === me ? x : 0), 0), theirs = prev.reduce((a, x, i) => a + (sideOf(i + 1) !== me ? x : 0), 0);
  const lead = mine + form.score - theirs;
  const ballsInn = parseOvers(form.overs);
  const opd = OPD[fk] ?? 90, cap = d.cap;
  const used = (form.day - 1) * opd + form.oversToday;
  const ol = Math.max(0, cap - used);
  const rr = (6 * form.score) / Math.max(ballsInn, 6);
  const P = mdProbs(d, k, lead, 10 - Math.min(form.wkts, 9), ol, rr);
  const target = k === 4 ? theirs - mine + 1 : undefined;
  const bat = form.batTeam || 'Batting side', bowl = form.bowlTeam || 'Bowling side';
  const fx = factors(d, form, form.batTeam, form.bowlTeam);
  const sim = useMemo(() => simMd(d, {
    score: form.score, wkts: Math.min(form.wkts, 9), ballsInInnings: ballsInn, ballsLeftInMatch: Math.round(ol * 6 * 0.85), target,
    striker: toP(form.striker, 'Striker'), nonStriker: toP(form.nonStriker, 'Non-striker'),
    next: form.next.filter(Boolean).map((p) => ({ name: p!.name, rf: p!.rf, wf: p!.wf })),
    bowlers: form.bowlers.filter((b) => b?.p).map((b) => ({ name: b.p!.name, rf: b.p!.rf, wf: b.p!.wf })), rf: fx.rf, wf: fx.wf,
  }, 1500, hash(JSON.stringify(form))), [JSON.stringify(form), d]); // eslint-disable-line
  // 4th innings: blend the chase simulation (teams and players) with the state model
  const simP = [0, 1, 2].map((c) => mean(sim.result.map((x) => (x === c ? 1 : 0))));
  const final = k === 4 ? P.map((p, i) => 0.75 * p + 0.25 * simP[i]) : P;
  const med = quantile(sim.final, 0.5);
  const cal = d.calib.find((c) => c.inn === k);
  // scenario grid: win / draw / loss if they add X runs for Y wickets, at their current scoring rate
  const adds = [0, 50, 100, 150, 200], lose = [0, 2, 4, 6];
  // history
  const wih = 10 - Math.min(form.wkts, 9);
  let hist: any = null;
  if (k === 4 && target) {
    const rows = d.hist4.filter((h) => h[0] === Math.floor((target - form.score) / 25) && h[1] === wih && h[2] === Math.floor(ol / 30));
    const W = rows.reduce((a, h) => a + h[3], 0), D = rows.reduce((a, h) => a + h[4], 0), L = rows.reduce((a, h) => a + h[5], 0);
    hist = { n: W + D + L, W, D, L, ex: rows.flatMap((h) => h[6]).filter((e, i, a) => a.findIndex((x) => x[0] === e[0]) === i).slice(0, 6) };
  } else {
    const rows = d.hist.filter((h) => h[0] === k && h[1] === Math.floor(lead / 50) && h[2] === wih && h[3] === Math.floor(ol / 45));
    const W = rows.reduce((a, h) => a + h[4], 0), D = rows.reduce((a, h) => a + h[5], 0), L = rows.reduce((a, h) => a + h[6], 0);
    hist = { n: W + D + L, W, D, L, ex: [] };
  }
  const fmtTxt = d.fmt === 'TEST' ? 'Test' : 'first-class';

  return (
    <div className="stack" style={{ gap: 32 }}>
      <Board plate={`Prediction · ${bat} v ${bowl}`} foot={<span>{bat} {form.score}/{form.wkts} in the {['1st', '2nd', '3rd', '4th'][k - 1]} innings · {lead >= 0 ? `lead by ${lead}` : `trail by ${-lead}`} · {Math.round(ol)} overs left in the match</span>}>
        <div className="sb-grid">
          <SbCell big label={`${bat} win`} value={pctTxt(final[0])} tone="up" />
          <SbCell big label="Draw" value={pctTxt(final[1])} delay={150} />
          <SbCell big label={`${bowl} win`} value={pctTxt(final[2])} delay={300} />
          <SbCell label={k === 4 ? 'Runs needed' : 'Projected innings'} value={k === 4 ? String(Math.max(0, (target ?? 0) - form.score)) : String(Math.round(med))} sub={k === 4 ? `${Math.round(ol)} overs left` : `80% between ${Math.round(quantile(sim.final, 0.1))} and ${Math.round(quantile(sim.final, 0.9))}`} delay={450} />
        </div>
      </Board>

      <div className="grid g2">
        <Panel title="Result chances" sub={k === 4 ? 'Three parts the match-state model, trained on real Test results, and one part a simulation of the chase with these teams and players.' : 'From the match-state model: lead, wickets in hand, overs left and run rate.'}>
          <div className="stackbar" style={{ height: 22 }} aria-hidden="true">
            <i style={{ width: `${final[0] * 100}%`, background: 'var(--s1)' }} /><i style={{ width: `${final[1] * 100}%`, background: 'var(--line-2)' }} /><i style={{ width: `${final[2] * 100}%`, background: 'var(--s2)' }} />
          </div>
          <Legend items={[{ label: `${bat} win ${pctTxt(final[0])}`, color: 'var(--s1)', kind: 'box' }, { label: `Draw ${pctTxt(final[1])}`, color: 'var(--line-2)', kind: 'box' }, { label: `${bowl} win ${pctTxt(final[2])}`, color: 'var(--s2)', kind: 'box' }]} />
          {k === 4 && <div className="kv"><span>Simulation alone (win / draw / loss)</span><b>{simP.map(pctTxt).join(' / ')}</b></div>}
          {k === 4 && <div className="kv"><span>Match-state model alone</span><b>{P.map(pctTxt).join(' / ')}</b></div>}
          {cal && <div className="muted" style={{ fontSize: 12 }}>On {n0(cal.n)} past {fmtTxt} states in innings {k}, the model picked the eventual result {pctTxt(cal.accuracy)} of the time.</div>}
        </Panel>
        <Panel title="If they bat on" sub={`The rest of this innings, simulated ${n0(sim.final.length)} times${k === 4 ? ' until the target, all out or the close' : ' until all out or the end of the match (declarations are not modelled)'}.`}>
          <div className="kv"><span>Median innings total</span><b>{Math.round(med)}</b></div>
          <div className="kv"><span>80% between</span><b>{Math.round(quantile(sim.final, 0.1))}–{Math.round(quantile(sim.final, 0.9))}</b></div>
          <div className="kv"><span>Median overs batted from now</span><b>{d1(quantile(sim.balls, 0.5) / 6)}</b></div>
          <div className="kv"><span>Chance of being bowled out</span><b>{pctTxt(mean(sim.wkts.map((w) => (w >= 10 ? 1 : 0))))}</b></div>
          {k < 4 && <div className="kv"><span>Projected lead at the end of the innings</span><b>{Math.round(lead + med - form.score)}</b></div>}
          {[toP(form.striker, 'Striker'), toP(form.nonStriker, 'Non-striker')].map((p) => {
            const o = sim.batters[p.name] ?? [];
            return <div key={p.name} className="kv"><span>{p.name}: chance of {(p.runs ?? 0) < 50 ? '50' : '100'}+</span><b>{pctTxt(mean(o.map((x) => (x.runs >= ((p.runs ?? 0) < 50 ? 50 : 100) ? 1 : 0))))}</b></div>;
          })}
        </Panel>
      </div>

      <Panel flush title="Scenario grid" sub={`${bat}'s win / draw / loss chances if they add these runs for these wickets, at their current scoring rate of ${d2(rr)} an over.`}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Runs added</th>{lose.map((l) => <th key={l} scope="col">{l} more wickets</th>)}</tr></thead>
            <tbody>
              {adds.map((a) => (
                <tr key={a}><td>+{a}</td>{lose.map((l) => {
                  const w = Math.min(form.wkts + l, 9), olx = Math.max(0, ol - a / Math.max(rr, 1));
                  const p = mdProbs(d, k, lead + a, 10 - w, olx, rr);
                  return <td key={l}><b style={{ color: 'var(--s1)' }}>{pctTxt(p[0])}</b> <span className="muted">/ {pctTxt(p[1])} / {pctTxt(p[2])}</span></td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid g2">
        <Panel title={hist.n ? `${n0(hist.n)} similar situations` : 'No close match in the records'} sub="Past matches with a similar lead (or target), wickets in hand and overs left.">
          {hist.n > 0 && <>
            <div className="kv"><span>Batting side won</span><b>{pctTxt(hist.W / hist.n)}</b></div>
            <div className="kv"><span>Drawn</span><b>{pctTxt(hist.D / hist.n)}</b></div>
            <div className="kv"><span>Batting side lost</span><b>{pctTxt(hist.L / hist.n)}</b></div>
          </>}
          {hist.ex.map((e: any, i: number) => (
            <Link key={e[0] + i} className="list-row" style={{ padding: '8px 0' }} to={`/match/${e[0]}`}>
              <span className="t" style={{ fontWeight: 500 }}>{e[2]} v {e[3]}<div className="m">{dateShort(e[1])}</div></span>
              <span className={`tag ${e[4] === 'W' ? 'accent' : e[4] === 'L' ? 'red' : ''}`}>{e[4] === 'W' ? 'won' : e[4] === 'D' ? 'drawn' : 'lost'}</span>
            </Link>
          ))}
        </Panel>
        <Panel title="What went into this" sub="Factors used in the innings simulation.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Factor</th><th scope="col" className="left">Setting</th><th scope="col">Runs</th><th scope="col">Wickets</th></tr></thead>
              <tbody>{fx.rows.map((r: any) => <tr key={r[0]}><td>{r[0]}</td><td className="txt left wrap">{r[3]}</td><td>{fxTxt(r[1])}</td><td>{fxTxt(r[2])}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Overs left assume {opd} overs a day for {DAYS[fk] ?? 5} days ({cap} in all). The simulation expects about 85% of them to be bowled, since weather, bad light and over rates usually cost time.</div>
        </Panel>
      </div>
    </div>
  );
}
