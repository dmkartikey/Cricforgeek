import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePageMeta } from '../lib/meta';
import { d1, d2, dateShort, n0 } from '../lib/fmt';
import {
  CALIB, chaseCurve, hash, LimData, LimInput, mdProbs, MdData, mean, Player, quantile, simLimited, simMd,
} from '../lib/predict';
import {
  ago, baseTeam, contextFx, LIVE_DEMO, P, quickWin, TEST_CAP, ballsOf, Card, dataKey, LiveDoc, LiveMatch, LimState, MdState, modelPath, playerFactors, PlayerFx, Snap, stateOf, useLive,
} from '../lib/live';
import { ErrorBox, Legend, Loader, Panel, SectionHead } from '../components/ui';
import { LineChart } from '../components/charts';
import { Board, SbCell } from '../components/Scoreboard';

const pct = (p: number) => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : '–');
const pct1 = (p: number) => (Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '–');
const odds = (p: number) => (p > 0.004 && p < 0.996 ? (1 / p).toFixed(2) : p >= 0.996 ? '1.00' : '–');
const FMT_NAME: Record<string, string> = { T20: 'T20I', ODI: 'ODI', TEST: 'Test' };
const SESSIONS: Record<string, number[]> = { T20: [6, 10, 15, 20], ODI: [10, 20, 30, 40, 50] };
const DISMISS: Record<string, string> = { field: 'Caught in the field', bowled: 'Bowled', lbw: 'LBW', keeper: 'Caught behind', stumped: 'Stumped', cab: 'Caught and bowled', runout: 'Run out', hitwicket: 'Hit wicket', other: 'Other (incl. run out)' };

function Disclaimer() {
  return (
    <div className="notice">
      These are statistical estimates for information only, not betting advice or a recommendation to bet. Online betting for money is illegal or
      restricted in many places, including India. Market odds are shown only for comparison; no bookmaker is named or linked.
    </div>
  );
}

// lines for over/under tables: five half-run lines around the middle of the distribution
function linesFor(vals: number[], unit = 1) {
  const med = quantile(vals, 0.5), iqr = quantile(vals, 0.75) - quantile(vals, 0.25);
  const step = Math.max(unit, Math.round(Math.max(iqr, 1) / 2 / unit) * unit);
  const mid = Math.floor(med) + 0.5;
  return [-2, -1, 0, 1, 2].map((k) => mid + k * step).filter((x) => x > 0);
}
function OverUnder({ title, sub, vals, unit = 1, note }: { title: string; sub?: string; vals: number[]; unit?: number; note?: ReactNode }) {
  if (!vals.length) return null;
  // Leave out lines that can't be reached (e.g. above a chase target).
  const ls = linesFor(vals, unit).filter((l) => { const p = mean(vals.map((v) => (v > l ? 1 : 0))); return p > 0.005 && p < 0.995; });
  if (!ls.length) return null;
  return (
    <Panel flush title={title} sub={sub}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th scope="col">Line</th><th scope="col">Over</th><th scope="col">Fair odds</th><th scope="col">Under</th><th scope="col">Fair odds</th></tr></thead>
          <tbody>{ls.map((l) => { const p = mean(vals.map((v) => (v > l ? 1 : 0))); return (
            <tr key={l}><td>{l}</td><td><b>{pct(p)}</b></td><td>{odds(p)}</td><td><b>{pct(1 - p)}</b></td><td>{odds(1 - p)}</td></tr>); })}</tbody>
        </table>
      </div>
      <div className="panel-foot">Median {n0(quantile(vals, 0.5))} · 80% between {n0(quantile(vals, 0.1))} and {n0(quantile(vals, 0.9))}{note ? <> · {note}</> : null}</div>
    </Panel>
  );
}

// ---------- page ----------
export default function Live() {
  const [sp] = useSearchParams();
  const id = sp.get('m');
  usePageMeta(id ? 'Live match' : 'Live cricket predictions');
  const demo = LIVE_DEMO && <div className="notice" style={{ marginBottom: 16 }}><b>Review copy.</b> These are saved sample matches, not live games. Once deployed, this page shows real internationals in progress.</div>;
  return <>{demo}{id ? <MatchView id={id} /> : <LiveList />}</>;
}

function LiveList() {
  const { data, error, at } = useLive<LiveDoc>('/live');
  const record = useData<any>('live/record.json');
  const live = (data?.matches ?? []).filter((m) => m.started && !m.ended);
  const done = (data?.matches ?? []).filter((m) => m.ended);
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow"><span className="live-dot" aria-hidden="true" /> Live internationals</div>
          <h1>Live predictions</h1>
          <p className="lede">Every Test, ODI and T20I in progress, men's and women's. Scores refresh about every 15 minutes on the free data plan, and the model
            works out win chances, totals, sessions, wickets and player markets from every recorded international.</p>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
          <span className="tag">Scores checked {ago(data?.checked)}</span>
          {data?.nextCheck && <span className="muted" style={{ fontSize: 12 }}>Next check about {new Date(data.nextCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
          {at > 0 && <span className="muted" style={{ fontSize: 12 }}>This page refreshes every minute</span>}
        </div>
      </section>
      {error && <ErrorBox error={error} />}
      {!data && !error && <Loader text="Loading live matches" />}
      {data && (
        <>
          <SectionHead title={live.length ? `${live.length} live now` : 'Nothing live right now'} sub={live.length ? 'Tap a match for the full prediction.' : 'International matches appear here as soon as they start.'} />
          {live.length > 0 && <div className="grid g2">{live.map((m) => <LiveCard key={m.id} m={m} />)}</div>}
          {data.upcoming.length > 0 && (
            <Panel flush title="Coming up" sub="Internationals starting in the next two days, with the market's view before the start (margin removed).">
              {data.upcoming.map((u) => {
                const f = u.market?.fair;
                const [a, b] = u.teams;
                return (
                  <div key={u.start + a} className="list-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <span className="t" style={{ fontWeight: 500 }}>{a} v {b}<div className="m">{FMT_NAME[u.fmt] ?? u.fmt} · {new Date(u.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></span>
                    <span className="v" style={{ fontSize: 13 }}>{f ? Object.entries(f).map(([k, p]) => `${k} ${pct(p)}`).join(' · ') : <span className="muted">no market yet</span>}</span>
                  </div>
                );
              })}
            </Panel>
          )}
          {done.length > 0 && (
            <Panel flush title="Just finished" sub="Results from the last 12 hours. Open one to see how the odds moved.">
              {done.map((m) => (
                <Link key={m.id} to={`/live?m=${encodeURIComponent(m.id)}`} className="list-row">
                  <span className="t" style={{ fontWeight: 500 }}>{m.teams[0]} v {m.teams[1]}<div className="m">{m.name.split(',').slice(1, 2).join('')} · {m.status}</div></span>
                  <span className="v" style={{ fontSize: 12 }}>{m.innings.map((i) => `${i.r}/${i.w}`).join(' · ')}</span>
                </Link>
              ))}
            </Panel>
          )}
          <TrackRecord rec={record.data} />
        </>
      )}
      <Disclaimer />
    </>
  );
}

// quick win chance for a list card
function LiveCard({ m }: { m: LiveMatch }) {
  const { data: d } = useData<LimData | MdData>(modelPath(m));
  const wp = useMemo(() => (d ? quickWin(d, m) : null), [d, m.id, JSON.stringify(m.innings)]); // eslint-disable-line
  return (
    <Link to={`/live?m=${encodeURIComponent(m.id)}`} className="idx-card live-card">
      <span className="row" style={{ justifyContent: 'space-between' }}>
        <span className="tag red"><span className="live-dot" aria-hidden="true" /> LIVE · {FMT_NAME[m.fmt]}{m.gender === 'female' ? ' · Women' : ''}</span>
        <span className="m">{m.name.split(',').slice(1, 2).join('').trim()}</span>
      </span>
      <span className="t">{m.teams[0]} v {m.teams[1]}</span>
      <span className="stack" style={{ gap: 2 }}>
        {m.innings.map((i, k) => <span key={k} className="kv"><span>{i.team}</span><b>{i.r}/{i.w} <small className="muted">({i.o} ov)</small></b></span>)}
      </span>
      <span className="m">{m.status}</span>
      {wp && (
        <span className="stackbar" aria-hidden="true">{Object.entries(wp).map(([k, p], i) => <i key={k} style={{ width: `${p * 100}%`, background: k === 'Draw' ? 'var(--line-2)' : i === 0 ? 'var(--s1)' : 'var(--s2)' }} />)}</span>
      )}
      {wp && <span className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>{Object.entries(wp).map(([k, p]) => <b key={k}>{k} {pct(p)}</b>)}</span>}
      {wp && <span className="m">Quick estimate from the score. Open the match for the full model with players.</span>}
    </Link>
  );
}

// ---------- one match ----------
type WhatIf = { label: string; wkts?: number; runs?: number; balls?: number; sched?: number };

function MatchView({ id }: { id: string }) {
  const { data, error } = useLive<{ match: LiveMatch | null; history: Snap[]; checked?: string }>(`/match?id=${encodeURIComponent(id)}`);
  const m = data?.match ?? null;
  const model = useData<LimData | MdData>(m ? modelPath(m) : null);
  const idx = useData<any>('search.json').data;
  const pidx = useData<any>('predict/index.json').data;
  const [fx, setFx] = useState<{ bat: Record<string, PlayerFx>; bowl: Record<string, PlayerFx> } | null>(null);
  const [sched, setSched] = useState<number | null>(null);
  const st = m ? stateOf(m) : null;
  const card = m?.card && m.card.inn === m.innings.length ? m.card : undefined;
  usePageMeta(m ? `${m.teams[0]} v ${m.teams[1]}: live prediction` : null);

  useEffect(() => {
    if (!m || !card || !st || !idx) { setFx(null); return; }
    let live = true;
    const fk = dataKey(m);
    const batting = card.batting.filter((b) => !b.out).map((b) => ({ name: b.name, team: st.batting }));
    const bowling = card.bowling.map((b) => ({ name: b.name, team: st.bowling }));
    Promise.all([playerFactors(idx, batting, fk, m.gender, 'bat'), playerFactors(idx, bowling, fk, m.gender, 'bowl')]).then(([bat, bowl]) => { if (live) setFx({ bat, bowl }); });
    return () => { live = false; };
  }, [m?.id, card?.fetchedAt, !!idx]); // eslint-disable-line

  if (error && !data) return <><ErrorBox error={error} /><Link className="link" to="/live">Back to live matches</Link></>;
  if (!data || (m && !model.data)) return <Loader text="Loading the live match" />;
  if (!m) return <div className="notice">This match is not in the live feed any more. <Link className="link" to="/live">See live matches</Link></div>;
  return (
    <>
      <section className="phead fade-in">
        <div className="stack">
          <div className="eyebrow"><Link to="/live">Live</Link> · {FMT_NAME[m.fmt]}{m.gender === 'female' ? ' · Women' : ''} · {m.name.split(',').slice(1).join(',').trim()}</div>
          <h1>{m.teams[0]} <span className="muted" style={{ fontWeight: 400 }}>v</span> {m.teams[1]}</h1>
          <div className="sub">{m.venue}{m.toss ? ` · Toss: ${m.teams.find((t) => t.toLowerCase() === m.toss!.winner.toLowerCase()) ?? m.toss.winner}, chose to ${m.toss.choice}` : ''}</div>
        </div>
        <div className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
          <span className="tag">{m.ended ? 'Finished' : `Score checked ${ago(data.checked ?? data.history.slice(-1)[0]?.t)}`}</span>
          <span className="muted" style={{ fontSize: 12 }}>Player detail: {m.card ? `scorecard ${ago(m.card.fetchedAt)}` : 'not fetched yet'}</span>
        </div>
      </section>
      {m.ended && (
        <div className="notice info"><b>Finished: {m.status}.</b> The numbers below are the model's view at the last score check. Every finished international feeds the
          {' '}<Link className="link" to="/live">track record</Link>, which shows how often the model's favourite won.</div>
      )}
      {model.data && (model.data as LimData).kind === 'limited' && st?.kind === 'limited'
        ? <LimitedView m={m} st={st} d={model.data as LimData} hist={data.history} card={card} fx={fx} dism={pidx?.dismissals?.[dataKey(m)]} sched={sched} setSched={setSched} />
        : model.data && st?.kind === 'multi'
          ? <TestView m={m} st={st} d={model.data as MdData} hist={data.history} card={card} fx={fx} />
          : <div className="notice">The match has not started yet, or there is not enough data for this format.</div>}
      <Disclaimer />
    </>
  );
}

// ---------- limited overs ----------
function LimitedView({ m, st, d, hist, card, fx, dism, sched, setSched }: {
  m: LiveMatch; st: LimState; d: LimData; hist: Snap[]; card?: Card; fx: { bat: Record<string, PlayerFx>; bowl: Record<string, PlayerFx> } | null;
  dism?: Record<string, Record<string, number>>; sched: number | null; setSched: (v: number | null) => void;
}) {
  const [what, setWhat] = useState<WhatIf | null>(null);
  const total = sched ? Math.min(st.total, sched * 6) : st.total;
  const out = useMemo(() => {
    const ctx = contextFx(d, m, st.batting, st.bowling);
    const maxB = m.fmt === 'T20' ? 24 : 60;
    const notOut = card ? card.batting.filter((b) => !b.out) : [];
    const pl = (b?: { name: string; r: number; b: number }, fb = 'Batter'): Player => {
      const f = b ? fx?.bat[b.name] : undefined;
      return { id: f?.id, name: b?.name ?? fb, rf: f?.rf ?? 1, wf: f?.wf ?? 1, runs: b?.r ?? 0, balls: b?.b ?? 0 };
    };
    const bowlers: Player[] = card ? card.bowling.map((b) => {
      const f = fx?.bowl[b.name];
      return { id: f?.id, name: b.name, rf: f?.rf ?? 1, wf: f?.wf ?? 1, ballsLeft: Math.max(0, maxB - ballsOf(b.o)) };
    }).filter((b) => (b.ballsLeft ?? 0) > 0) : [];
    const base: LimInput = {
      inn: st.inn, score: st.score, wkts: st.wkts, balls: Math.min(st.balls, total - 1), totalBalls: total, target: st.target,
      striker: pl(notOut[0], 'Striker'), nonStriker: pl(notOut[1], 'Non-striker'), next: [], bowlers, maxBowlerBalls: maxB,
      rf: ctx.rf, wf: ctx.wf, phr: ctx.phr, phw: ctx.phw,
    };
    if (base.striker.name === base.nonStriker.name) base.nonStriker = { ...base.nonStriker, name: base.nonStriker.name + ' (2)' };
    const N = m.fmt === 'ODI' ? 1800 : 3000;
    const seed = hash(m.id + JSON.stringify(m.innings) + (card?.fetchedAt ?? '') + total);
    const sim = simLimited(d, base, N, seed);
    const ctx2 = contextFx(d, m, st.bowling, st.batting);
    const base2 = { totalBalls: total, striker: P('A'), nonStriker: P('B'), next: [], bowlers: [], maxBowlerBalls: maxB, rf: ctx2.rf, wf: ctx2.wf, phr: ctx2.phr, phw: ctx2.phw };
    const par = d.first.find((f) => f[0] === Math.ceil(d.full / 6) && f[1] === 0 && f[2] === 0)?.[6] ?? (d.full === 300 ? 250 : 160);
    const curve = st.inn === 1 ? chaseCurve(d, base2, Math.round(par * 0.45 * total / d.full), Math.round(par * 1.6 * total / d.full), N >= 3000 ? 280 : 200, seed ^ 77) : null;
    const winOf = (s: ReturnType<typeof simLimited>) => (curve ? mean(s.final.map((x) => 1 - curve(x))) : mean(s.won));
    const win = winOf(sim);
    // what-ifs from the batting side's view
    const scen: WhatIf[] = [
      { label: 'Wicket next ball', wkts: 1, balls: 1 }, { label: 'Two wickets in the next over', wkts: 2, balls: 6, runs: 3 },
      { label: 'A six next ball', runs: 6, balls: 1 }, { label: 'Maiden next over', balls: 6 }, { label: `Next over goes for ${m.fmt === 'T20' ? 15 : 12}`, runs: m.fmt === 'T20' ? 15 : 12, balls: 6 },
    ];
    const apply = (w: WhatIf): LimInput => ({
      ...base, score: base.score + (w.runs ?? 0), wkts: Math.min(9, base.wkts + (w.wkts ?? 0)), balls: Math.min(total - 1, base.balls + (w.balls ?? 0)),
      ...(w.wkts ? { striker: { ...base.nonStriker }, nonStriker: { name: 'New batter', rf: 1, wf: 1, runs: 0, balls: 0 } } : {}),
    });
    const whatIfs = scen.map((w) => { const s2 = simLimited(d, apply(w), Math.round(N / 4), seed + w.label.length, false); return { ...w, win: winOf(s2), med: quantile(s2.final, 0.5) }; });
    const custom = what ? (() => { const s2 = simLimited(d, apply(what), Math.round(N / 2), seed + 9, false); return { win: winOf(s2), med: quantile(s2.final, 0.5) }; })() : null;
    // momentum across the match so far
    const snaps = hist.length > 40 ? hist.filter((_, i) => i % Math.ceil(hist.length / 40) === 0 || i === hist.length - 1) : hist;
    const teamA = m.teams[0];
    const mom = snaps.map((h) => {
      const k = Math.min(h.s.length, 2);
      const [r, w, o] = h.s[k - 1] ?? [0, 0, 0];
      const batTeam = m.innings[k - 1]?.team ?? st.batting;
      const tgt = k === 2 ? (h.s[0]?.[0] ?? 0) + 1 : undefined;
      const s2 = simLimited(d, { ...base, inn: k as 1 | 2, score: r, wkts: Math.min(w, 9), balls: Math.min(ballsOf(o), total - 1), target: tgt,
        striker: P('A'), nonStriker: P('B'), bowlers: [] }, 250, hash(h.t), false);
      const pBat = k === 1 && curve ? mean(s2.final.map((x) => 1 - curve(x))) : mean(s2.won);
      const pA = batTeam === teamA ? pBat : 1 - pBat;
      const mk = h.mk ? Object.entries(h.mk).find(([n]) => baseTeam(n).toLowerCase() === baseTeam(teamA).toLowerCase())?.[1] : undefined;
      return { t: h.t, label: `${k === 1 ? '1st' : '2nd'} inns ${r}/${w} (${o})`, pA, mk };
    });
    return { sim, win, base, ctx, whatIfs, custom, mom, N, par };
  }, [m.id, JSON.stringify(m.innings), card?.fetchedAt, fx, total, d, hist.length, what]); // eslint-disable-line

  const { sim, win, base, ctx, whatIfs, custom, mom, N } = out;
  const left = total - base.balls;
  const crr = base.balls ? (6 * st.score) / base.balls : 0;
  const need = st.target != null ? st.target - st.score : 0;
  const rrr = st.target != null ? (6 * need) / Math.max(left, 1) : NaN;
  const startOv = Math.floor(base.balls / 6);
  const atOver = (n: number) => sim.worm.map((w, i) => { const k = n - startOv - 1; return k < w.length ? w[k] : sim.final[i]; });
  const sessions = (SESSIONS[m.fmt] ?? []).filter((n) => n > startOv && n * 6 <= total);
  const ph = (() => { const third = Math.ceil(d.full / 6) / 3; const br = Math.ceil(left / 6); return br > 2 * third ? '0' : br > third ? '1' : '2'; })();
  const dm = dism?.[ph];
  const wicketOver = mean(sim.nextOver.map((x) => (x.w > 0 ? 1 : 0)));
  const r2w = sim.r2w.filter((x) => Number.isFinite(x));
  const noMore = 1 - r2w.length / sim.r2w.length;
  const mkt = m.market;
  const mkFair = (team: string) => (mkt ? Object.entries(mkt.fair).find(([n]) => baseTeam(n).toLowerCase() === baseTeam(team).toLowerCase())?.[1] : undefined);
  const preMk = hist.find((h) => h.mk)?.mk;
  const rows = [{ team: st.batting, p: win }, { team: st.bowling, p: 1 - win }];
  const hi = mom.length ? mom.reduce((a, b, i) => (i && Math.abs(b.pA - mom[i - 1].pA) > a.d ? { d: Math.abs(b.pA - mom[i - 1].pA), i } : a), { d: 0, i: 0 }) : null;
  const swings = mom.map((x, i) => (i ? { ...x, d: x.pA - mom[i - 1].pA } : null)).filter(Boolean).sort((a, b) => Math.abs(b!.d) - Math.abs(a!.d)).slice(0, 3) as (typeof mom[number] & { d: number })[];
  // history: real internationals from a similar spot
  const br = Math.ceil(left / 6);
  let hist2: { n: number; rate: number; desc: string } | null = null;
  if (st.inn === 2 && st.target != null) {
    const nb = Math.floor(need / d.need_step);
    let rr = d.chase.filter((c) => c[0] === br && c[1] === st.wkts && c[2] === nb);
    if (rr.reduce((a, c) => a + c[3] + c[4], 0) < 40) rr = d.chase.filter((c) => Math.abs(c[0] - br) <= 1 && c[1] === st.wkts && Math.abs(c[2] - nb) <= 1);
    const W = rr.reduce((a, c) => a + c[3], 0), L = rr.reduce((a, c) => a + c[4], 0);
    hist2 = { n: W + L, rate: W / Math.max(1, W + L), desc: `needing ${nb * d.need_step}–${nb * d.need_step + d.need_step - 1} off about ${br * 6} balls with ${st.wkts} down` };
  } else {
    const sb = Math.floor(st.score / d.score_step);
    let rr = d.first.filter((c) => c[0] === br && c[1] === st.wkts && c[2] === sb);
    if (!rr.length || rr[0][3] < 30) rr = d.first.filter((c) => Math.abs(c[0] - br) <= 1 && c[1] === st.wkts && Math.abs(c[2] - sb) <= 1);
    const n = rr.reduce((a, c) => a + c[3], 0);
    hist2 = { n, rate: rr.reduce((a, c) => a + (c[9] as number) * c[3], 0) / Math.max(1, n), desc: `on about ${st.score} for ${st.wkts} with about ${br * 6} balls left` };
  }
  // players
  const notOut = card ? card.batting.filter((b) => !b.out) : [];
  const outBats = card ? card.batting.filter((b) => b.out) : [];
  const topBat = (() => {
    if (!card) return null;
    const cands = [...outBats.map((b) => ({ name: b.name, fixed: b.r })), ...[base.striker, base.nonStriker].filter((p) => notOut.some((b) => b.name === p.name)).map((p) => ({ name: p.name, fixed: NaN })), { name: 'A batter yet to come in', fixed: NaN }];
    const wins: Record<string, number> = {};
    for (let i = 0; i < sim.final.length; i++) {
      let best = -1, who: string[] = [];
      for (const c of cands) {
        const v = Number.isFinite(c.fixed) ? c.fixed : c.name === 'A batter yet to come in' ? sim.topNew[i] : sim.batters[c.name]?.[i]?.runs ?? 0;
        if (v > best) { best = v; who = [c.name]; } else if (v === best) who.push(c.name);
      }
      for (const w of who) wins[w] = (wins[w] ?? 0) + 1 / who.length;
    }
    return Object.entries(wins).map(([k, v]) => ({ name: k, p: v / sim.final.length })).sort((a, b) => b.p - a.p).filter((x) => x.p >= 0.005);
  })();
  const bowlTable = card ? card.bowling.map((b) => {
    const f = sim.bowlers[b.name] ?? [];
    const more = f.length ? mean(f.map((x) => x.w)) : 0;
    return { name: b.name, id: fx?.bowl[b.name]?.id, o: b.o, w: b.w, r: b.r, left: base.bowlers.find((x) => x.name === b.name)?.ballsLeft ?? 0, more,
      next: mean(sim.nwb.map((x) => (x === b.name ? 1 : 0))), finalW: f.length ? f.map((x) => x.w + b.w) : sim.final.map(() => b.w) };
  }) : [];
  const topBowl = bowlTable.length ? (() => {
    const wins: Record<string, number> = {};
    for (let i = 0; i < sim.final.length; i++) {
      let best = -1, who: string[] = [];
      for (const b of bowlTable) { const v = b.finalW[i]; if (v > best) { best = v; who = [b.name]; } else if (v === best) who.push(b.name); }
      for (const w of who) wins[w] = (wins[w] ?? 0) + 1 / who.length;
    }
    return Object.entries(wins).map(([k, v]) => ({ name: k, p: v / sim.final.length })).sort((a, b) => b.p - a.p).slice(0, 6);
  })() : null;

  return (
    <div className="stack" style={{ gap: 32 }}>
      <Board plate={`Live · ${st.batting} batting`} foot={<>
        <span>{st.inn === 2 ? `${st.batting} need ${need} off ${left} balls · required ${d2(rrr)} an over · current ${d2(crr)}` : `${st.batting} ${st.score}/${st.wkts} after ${Math.floor(base.balls / 6)}.${base.balls % 6} overs · run rate ${d2(crr)}`}</span>
        {!(st.inn === 2 && /\bneed\b/i.test(m.status)) && <span>{m.status}</span>}
      </>}>
        <div className="sb-grid">
          <SbCell big label={`${st.batting} win`} value={pct(win)} sub={`fair odds ${odds(win)}`} tone="up" />
          <SbCell big label={`${st.bowling} win`} value={pct(1 - win)} sub={`fair odds ${odds(1 - win)}`} delay={150} />
          <SbCell label={st.inn === 2 ? 'Chase ends on' : 'Projected total'} value={String(Math.round(quantile(sim.final, 0.5)))} sub={`80%: ${Math.round(quantile(sim.final, 0.1))}–${Math.round(quantile(sim.final, 0.9))}`} delay={300} />
          <SbCell label="Wicket this over" value={pct(wicketOver)} sub={`next over: ${d1(mean(sim.nextOver.map((x) => x.r)))} runs expected`} delay={450} />
        </div>
      </Board>

      <SectionHead title="Match winner" sub="Model chances and fair odds (no margin), next to the market's view with the bookmaker margin removed." />
      <Panel flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Outcome</th><th scope="col">Model</th><th scope="col">Fair odds</th><th scope="col">Market</th><th scope="col">Market odds</th><th scope="col">Model − market</th><th scope="col">Before the start</th></tr></thead>
            <tbody>{rows.map((r) => {
              const mp = mkFair(r.team), pre = preMk ? Object.entries(preMk).find(([n]) => baseTeam(n).toLowerCase() === baseTeam(r.team).toLowerCase())?.[1] : undefined;
              const diff = mp != null ? r.p - mp : NaN;
              return (
                <tr key={r.team}><td>{r.team}</td><td><b>{pct1(r.p)}</b></td><td>{odds(r.p)}</td><td>{mp != null ? pct1(mp) : '–'}</td><td>{mp != null ? odds(mp) : '–'}</td>
                  <td className={Math.abs(diff) >= 0.05 ? (diff > 0 ? 'pos' : 'neg') : ''}>{Number.isFinite(diff) ? `${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts` : '–'}</td>
                  <td>{pre != null ? pct(pre) : '–'}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="panel-foot">{mkt ? `Market: average of ${mkt.books} bookmakers, ${(mkt.margin * 100).toFixed(1)}% margin removed, as of ${ago(mkt.fetchedAt)}. Market odds update a few times a day on the free plan, so they lag live play.` : 'No market odds for this match yet.'} Simulated {n0(N)} times; ± {Math.max(1, Math.round(196 * Math.sqrt((win * (1 - win)) / N)))} pts from simulation alone.</div>
      </Panel>

      <SectionHead title="Totals and sessions" sub="Over/under chances at several lines. Fair odds = 1 ÷ chance, with no margin." />
      <div className="grid g2">
        <OverUnder title={`${st.batting}: innings total`} vals={sim.final} unit={m.fmt === 'T20' ? 5 : 10} note={st.target != null ? `the chase stops at ${st.target}` : undefined} />
        <Panel flush title="Session runs" sub="Score at the end of each session over. Lines sit at the middle of the range.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th scope="col">Session</th><th scope="col">Median</th><th scope="col">80% range</th><th scope="col">Line</th><th scope="col">Over</th><th scope="col">Under</th></tr></thead>
              <tbody>
                {(() => { const nx = sim.nextOver.map((x) => x.r); const l = Math.floor(quantile(nx, 0.5)) + 0.5; const p = mean(nx.map((x) => (x > l ? 1 : 0)));
                  return <tr><td>{base.balls % 6 ? 'Rest of this over' : 'Next over'}</td><td>{n0(quantile(nx, 0.5))}</td><td>{n0(quantile(nx, 0.1))}–{n0(quantile(nx, 0.9))}</td><td>{l}</td><td><b>{pct(p)}</b> <small className="muted">{odds(p)}</small></td><td><b>{pct(1 - p)}</b> <small className="muted">{odds(1 - p)}</small></td></tr>; })()}
                {[startOv + 5].filter((n) => n * 6 < total && !sessions.includes(n)).concat(sessions).sort((a, b) => a - b).map((n) => {
                  const v = atOver(n); const l = Math.floor(quantile(v, 0.5)) + 0.5; const p = mean(v.map((x) => (x > l ? 1 : 0)));
                  return <tr key={n}><td>{n === startOv + 5 && !sessions.includes(n) ? `Next 5 overs (to over ${n})` : `${n}-over score`}</td><td>{n0(quantile(v, 0.5))}</td><td>{n0(quantile(v, 0.1))}–{n0(quantile(v, 0.9))}</td><td>{l}</td><td><b>{pct(p)}</b> <small className="muted">{odds(p)}</small></td><td><b>{pct(1 - p)}</b> <small className="muted">{odds(1 - p)}</small></td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="panel-foot">If the innings ends before a session over, its total counts for that session.</div>
        </Panel>
      </div>

      <SectionHead title="Wickets" />
      <div className="grid g3">
        <Panel title="Next wicket">
          <div className="kv"><span>Wicket in {base.balls % 6 ? 'the rest of this over' : 'the next over'}</span><b>{pct(wicketOver)}</b></div>
          <div className="kv"><span>Expected runs before the next wicket</span><b>{r2w.length ? d1(mean(r2w)) : '–'}</b></div>
          <div className="kv"><span>Next wicket within 10 runs</span><b>{pct(mean(sim.r2w.map((x) => (x < 10 ? 1 : 0))))}</b></div>
          <div className="kv"><span>Next wicket within 25 runs</span><b>{pct(mean(sim.r2w.map((x) => (x < 25 ? 1 : 0))))}</b></div>
          <div className="kv"><span>No more wickets this innings</span><b>{pct(noMore)}</b></div>
          <div className="kv"><span>Bowled out</span><b>{pct(mean(sim.wkts.map((w) => (w >= 10 ? 1 : 0))))}</b></div>
        </Panel>
        <OverUnder title="Total wickets this innings" vals={sim.wkts} unit={1} />
        <Panel title="How the next wicket falls" sub={`How wickets fall in ${FMT_NAME[m.fmt]}s at this stage of an innings.`}>
          {dm ? Object.entries(dm).slice(0, 7).map(([k, v]) => <div key={k} className="kv"><span>{DISMISS[k] ?? k}</span><b>{pct(v)} <small className="muted">{odds(v)}</small></b></div>)
            : <div className="muted">Not available.</div>}
        </Panel>
      </div>

      <SectionHead title="Players" sub={card ? `From the scorecard ${ago(card.fetchedAt)}. Each player's record in ${FMT_NAME[m.fmt]}s nudges their run and wicket rates.` : 'Player markets need a scorecard. On the free data plan scorecards are fetched for up to two matches, at each new innings and every two hours.'} />
      {card ? (
        <>
          <div className="grid g3">
            {[base.striker, base.nonStriker].filter((p) => notOut.some((b) => b.name === p.name)).map((p) => {
              const o = sim.batters[p.name] ?? [];
              const r = o.map((x) => x.runs);
              const mil = [30, 50, 100].filter((x) => x > (p.runs ?? 0) && (x < 100 || m.fmt !== 'T20' || (p.runs ?? 0) >= 40));
              return (
                <Panel key={p.name} title={p.id ? <Link className="link" to={`/player/${p.id}`}>{p.name}</Link> : p.name} sub={`${p.runs} off ${p.balls} now${fx?.bat[p.name]?.n ? '' : ' · no record found, treated as average'}`}>
                  {mil.map((x) => { const q = mean(r.map((v) => (v >= x ? 1 : 0))); return <div key={x} className="kv"><span>Reaches {x}</span><b>{pct(q)} <small className="muted">{odds(q)}</small></b></div>; })}
                  <div className="kv"><span>Expected final score</span><b>{d1(mean(r))}</b></div>
                  <OuLine label="Runs line" vals={r} />
                  <div className="kv"><span>Out this innings</span><b>{pct(mean(o.map((x) => (x.out ? 1 : 0))))}</b></div>
                </Panel>
              );
            })}
            {topBat && (
              <Panel title="Top batter this innings" sub="Including batters already out.">
                {topBat.slice(0, 6).map((x) => <div key={x.name} className="kv"><span>{x.name}</span><b>{pct(x.p)} <small className="muted">{odds(x.p)}</small></b></div>)}
              </Panel>
            )}
          </div>
          {bowlTable.length > 0 && (
            <Panel flush title="Bowlers" sub="Expected figures for the overs each bowler has left, who takes the next wicket, and who ends with the most wickets.">
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th scope="col">Bowler</th><th scope="col">Figures</th><th scope="col">Overs left</th><th scope="col">More wickets (exp.)</th><th scope="col">Takes the next wicket</th><th scope="col">Most wickets</th></tr></thead>
                  <tbody>{bowlTable.map((b) => <tr key={b.name}><td>{b.id ? <Link className="link" to={`/player/${b.id}`}>{b.name}</Link> : b.name}</td><td>{b.w}/{b.r} ({b.o})</td><td>{Math.floor(b.left / 6)}</td>
                    <td>{d2(b.more)}</td><td>{pct(b.next)}</td><td>{pct(topBowl?.find((x) => x.name === b.name)?.p ?? 0)}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="panel-foot">A bowler not yet used counts as "another bowler": {pct(mean(sim.nwb.map((x, i) => (x == null && Number.isFinite(sim.r2w[i]) ? 1 : 0))))} chance they take the next wicket.</div>
            </Panel>
          )}
          <OverUnder title={`${st.batting}: sixes from here`} vals={sim.sixes} unit={1} />
        </>
      ) : <div className="notice info">No scorecard for this innings yet. Player markets will appear after the next scorecard check.</div>}

      <SectionHead title="Momentum" sub="The model's win chance through the match, with the market where it was checked." />
      <div className="grid wide-l">
        <Panel title={`${m.teams[0]} win chance`} sub={mom.length > 1 ? `${mom.length} checks so far.` : 'Builds up as the match goes on.'}>
          <Legend items={[{ label: 'Model', color: 'var(--s1)' }, { label: 'Market', color: 'var(--s2)' }]} />
          {mom.length > 1 ? <LineChart aria="Win chance through the match" labels={mom.map((x) => x.label)} yMin={0} yMax={100} refLine={50} fmt={(v) => `${Math.round(v)}%`} height={240}
            xFmt={(l) => l.split(' ').slice(2).join(' ')}
            series={[{ name: 'Model', color: 'var(--s1)', wash: true, values: mom.map((x) => x.pA * 100) }, { name: 'Market', color: 'var(--s2)', values: mom.map((x) => (x.mk != null ? x.mk * 100 : null)) }]} />
            : <div className="empty">Needs at least two score checks.</div>}
        </Panel>
        <Panel title="Biggest swings" sub={`Changes in ${m.teams[0]}'s chance between checks.`}>
          {swings.length ? swings.map((s) => <div key={s.t} className="kv"><span>{s.label}<small className="muted" style={{ display: 'block' }}>{new Date(s.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><b className={s.d > 0 ? 'pos' : 'neg'}>{s.d > 0 ? '+' : ''}{(s.d * 100).toFixed(0)} pts</b></div>)
            : <div className="muted">None yet.</div>}
          {hi && hi.d > 0.2 && <div className="muted" style={{ fontSize: 12 }}>The biggest single swing was {(hi.d * 100).toFixed(0)} points.</div>}
        </Panel>
      </div>

      <SectionHead title="How far to trust it" />
      <div className="grid g3">
        <Panel title="History" sub={hist2 && hist2.n ? `Real matches ${hist2.desc}.` : undefined}>
          {hist2 && hist2.n > 0 ? <div className="kv"><span>In {n0(hist2.n)} similar situations the batting side won</span><b>{pct(hist2.rate)}</b></div> : <div className="muted">This situation is rare in the records.</div>}
          {CALIB[dataKey(m)] && <div className="muted" style={{ fontSize: 12 }}>On {CALIB[dataKey(m)].n} real chase situations, predictions were within {CALIB[dataKey(m)].rmse} points of what happened, on average.</div>}
          <div className="muted" style={{ fontSize: 12 }}>The model does not know about injuries, pitch reports, dew or weather.</div>
        </Panel>
        <Panel title="What moves the odds" sub={`${st.batting}'s win chance if this happens next.`}>
          {whatIfs.map((w) => { const dd = w.win - win; return <div key={w.label} className="kv"><span>{w.label}</span><b>{pct(w.win)} <small className={dd >= 0 ? 'pos' : 'neg'}>{dd >= 0 ? '▲' : '▼'} {Math.abs(Math.round(dd * 100))}</small></b></div>; })}
        </Panel>
        <Panel title="What went into it" sub="Scaling of an average side's run and wicket rates in exactly this situation.">
          {ctx.rows.map((r) => <div key={r[0]} className="kv"><span>{r[0]}<small className="muted" style={{ display: 'block' }}>{r[1]}</small></span><b>{Number.isFinite(r[2]) ? `runs ×${r[2].toFixed(2)}` : 'by phase'}</b></div>)}
        </Panel>
      </div>

      <Panel title="What if" sub="Try a change to the situation and see how the chances move.">
        <div className="pf-row">
          {[['Wicket now', { label: 'Wicket now', wkts: 1, balls: 1 }], ['+10 runs', { label: '+10 runs', runs: 10, balls: 6 }], ['Dot over', { label: 'Dot over', balls: 6 }], ['Two quick wickets', { label: 'Two quick wickets', wkts: 2, balls: 6 }]].map(([l, w]) => (
            <button key={l as string} type="button" className="btn" onClick={() => setWhat(w as WhatIf)} aria-pressed={what?.label === l}>{l as string}</button>
          ))}
          <label className="field">Overs per side (rain)
            <input className="input mono" type="number" min={1} max={st.total / 6} value={sched ?? st.total / 6} style={{ width: 90 }} onChange={(e) => setSched(Math.max(1, Math.min(st.total / 6, +e.target.value || st.total / 6)))} />
          </label>
          {(what || sched) && <button type="button" className="btn" onClick={() => { setWhat(null); setSched(null); }}>Reset</button>}
        </div>
        {custom && what && <div className="kv"><span>{what.label}: {st.batting} win chance</span><b>{pct(custom.win)} <small className={custom.win >= win ? 'pos' : 'neg'}>{custom.win >= win ? '▲' : '▼'} {Math.abs(Math.round((custom.win - win) * 100))} pts</small> · total {Math.round(custom.med)}</b></div>}
        {sched && <div className="muted" style={{ fontSize: 12 }}>Using {sched} overs a side. A revised target from a rain rule is not applied automatically.</div>}
      </Panel>
    </div>
  );
}

function OuLine({ label, vals }: { label: string; vals: number[] }) {
  const l = Math.floor(quantile(vals, 0.5)) + 0.5;
  const p = mean(vals.map((v) => (v > l ? 1 : 0)));
  return <div className="kv"><span>{label} {l}</span><b>over {pct(p)} · under {pct(1 - p)}</b></div>;
}

// ---------- Tests ----------
function TestView({ m, st, d, hist, card, fx }: { m: LiveMatch; st: MdState; d: MdData; hist: Snap[]; card?: Card; fx: { bat: Record<string, PlayerFx>; bowl: Record<string, PlayerFx> } | null }) {
  const cap = TEST_CAP[m.gender] ?? 450;
  const ol = Math.max(0, cap - st.oversUsed);
  const rr = (6 * st.score) / Math.max(st.ballsInn, 6);
  const P3 = mdProbs(d, st.inn, st.lead, 10 - st.wkts, ol, rr);
  const ctx = contextFx(d, m, st.batting, st.bowling);
  const notOut = card ? card.batting.filter((b) => !b.out) : [];
  const pl = (b?: { name: string; r: number; b: number }, fb = 'Batter'): Player => ({ name: b?.name ?? fb, rf: (b && fx?.bat[b.name]?.rf) || 1, wf: (b && fx?.bat[b.name]?.wf) || 1, runs: b?.r ?? 0, balls: b?.b ?? 0 });
  const sim = useMemo(() => simMd(d, { score: st.score, wkts: st.wkts, ballsInInnings: st.ballsInn, ballsLeftInMatch: Math.round(ol * 6 * 0.85), target: st.target,
    striker: pl(notOut[0], 'Striker'), nonStriker: pl(notOut[1], 'Non-striker'), next: [], bowlers: [], rf: ctx.rf, wf: ctx.wf }, 1500, hash(m.id + JSON.stringify(m.innings))),
  [m.id, JSON.stringify(m.innings), fx]); // eslint-disable-line
  const simP = [0, 1, 2].map((c) => mean(sim.result.map((x) => (x === c ? 1 : 0))));
  const fin = st.inn === 4 ? P3.map((p, i) => 0.75 * p + 0.25 * simP[i]) : P3;
  const mkt = m.market;
  const mk = (name: string) => (mkt ? Object.entries(mkt.fair).find(([n]) => baseTeam(n).toLowerCase() === baseTeam(name).toLowerCase())?.[1] : undefined);
  const rows: [string, number, number | undefined][] = [[st.batting, fin[0], mk(st.batting)], ['Draw', fin[1], mk('Draw')], [st.bowling, fin[2], mk(st.bowling)]];
  const teamA = m.teams[0];
  const mom = hist.map((h) => {
    const inns = h.s.map((x, i) => ({ team: m.innings[i]?.team ?? '', r: x[0], w: x[1], o: x[2], label: '' }));
    const s2 = stateOf({ ...m, innings: inns }) as MdState | null;
    if (!s2) return null;
    const p = mdProbs(d, s2.inn, s2.lead, 10 - s2.wkts, Math.max(0, cap - s2.oversUsed), (6 * s2.score) / Math.max(s2.ballsInn, 6));
    return { t: h.t, label: `inns ${s2.inn} ${s2.score}/${s2.wkts}`, pA: s2.batting === teamA ? p[0] : p[2], draw: p[1] };
  }).filter(Boolean) as { t: string; label: string; pA: number; draw: number }[];
  return (
    <div className="stack" style={{ gap: 32 }}>
      <Board plate={`Live Test · ${st.batting} batting`} foot={<span>{st.batting} {st.score}/{st.wkts} in innings {st.inn} · {st.lead >= 0 ? `lead by ${st.lead}` : `trail by ${-st.lead}`} · about {Math.round(ol)} overs left if no time is lost</span>}>
        <div className="sb-grid">
          <SbCell big label={`${st.batting} win`} value={pct(fin[0])} sub={`fair odds ${odds(fin[0])}`} tone="up" />
          <SbCell big label="Draw" value={pct(fin[1])} sub={`fair odds ${odds(fin[1])}`} delay={150} />
          <SbCell big label={`${st.bowling} win`} value={pct(fin[2])} sub={`fair odds ${odds(fin[2])}`} delay={300} />
          <SbCell label={st.target ? 'Runs needed' : 'Projected innings'} value={st.target ? String(Math.max(0, st.target - st.score)) : String(Math.round(quantile(sim.final, 0.5)))} sub={st.target ? `${pct(simP[0])} in the chase simulation` : `80%: ${Math.round(quantile(sim.final, 0.1))}–${Math.round(quantile(sim.final, 0.9))}`} delay={450} />
        </div>
      </Board>
      <Panel flush title="Match result" sub="Model chances and fair odds next to the market (margin removed).">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th scope="col">Outcome</th><th scope="col">Model</th><th scope="col">Fair odds</th><th scope="col">Market</th><th scope="col">Model − market</th></tr></thead>
            <tbody>{rows.map(([n, p, q]) => <tr key={n}><td>{n}</td><td><b>{pct1(p)}</b></td><td>{odds(p)}</td><td>{q != null ? `${pct1(q)} (${odds(q)})` : '–'}</td>
              <td className={q != null && Math.abs(p - q) >= 0.05 ? (p > q ? 'pos' : 'neg') : ''}>{q != null ? `${p - q > 0 ? '+' : ''}${((p - q) * 100).toFixed(1)} pts` : '–'}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="panel-foot">Overs left assume no time is lost to weather or bad light, which favours a result over a draw. {mkt ? `Market: ${mkt.books} bookmakers, ${ago(mkt.fetchedAt)}.` : 'No market odds yet.'}</div>
      </Panel>
      <div className="grid g2">
        <OverUnder title={`${st.batting}: this innings`} vals={sim.final} unit={10} />
        <Panel title="If they bat on" sub="This innings, simulated until all out, the target or the close.">
          <div className="kv"><span>Bowled out</span><b>{pct(mean(sim.wkts.map((w) => (w >= 10 ? 1 : 0))))}</b></div>
          <div className="kv"><span>Median overs batted from now</span><b>{d1(quantile(sim.balls, 0.5) / 6)}</b></div>
          {!st.target && <div className="kv"><span>Lead at the end of the innings</span><b>{Math.round(st.lead + quantile(sim.final, 0.5) - st.score)}</b></div>}
          {[pl(notOut[0], 'Striker'), pl(notOut[1], 'Non-striker')].filter((p) => notOut.some((b) => b.name === p.name)).map((p) => {
            const r = (sim.batters[p.name] ?? []).map((x) => x.runs);
            return [50, 100].filter((x) => x > (p.runs ?? 0)).map((x) => { const q = mean(r.map((v) => (v >= x ? 1 : 0))); return <div key={p.name + x} className="kv"><span>{p.name} ({p.runs}) reaches {x}</span><b>{pct(q)} <small className="muted">{odds(q)}</small></b></div>; });
          })}
        </Panel>
      </div>
      <Panel title="Momentum" sub={`${teamA}'s win chance and the draw chance through the match.`}>
        <Legend items={[{ label: `${teamA} win`, color: 'var(--s1)' }, { label: 'Draw', color: 'var(--s3)' }]} />
        {mom.length > 1 ? <LineChart aria="Result chances through the Test" labels={mom.map((x) => x.label)} yMin={0} yMax={100} fmt={(v) => `${Math.round(v)}%`} height={240}
          series={[{ name: `${teamA} win`, color: 'var(--s1)', values: mom.map((x) => x.pA * 100) }, { name: 'Draw', color: 'var(--s3)', values: mom.map((x) => x.draw * 100) }]} />
          : <div className="empty">Builds up as the match goes on.</div>}
      </Panel>
    </div>
  );
}

// ---------- track record ----------
function TrackRecord({ rec }: { rec: any }) {
  if (!rec || !rec.matches?.length) {
    return <Panel title="Track record" sub="Every finished international keeps its prediction history here, so you can see how often the model was right. It fills up as matches finish." />;
  }
  return (
    <Panel flush title="Track record" sub={`${n0(rec.matches.length)} finished international${rec.matches.length === 1 ? '' : 's'} since ${dateShort(String(rec.since).slice(0, 10))}. Updated nightly.`}>
      <div className="record-band" style={{ boxShadow: 'none', border: 0, borderBottom: '1px solid var(--line)', borderRadius: 0 }}>
        <div><span className="l">Favourite at halfway won</span><span className="v">{pct(rec.summary.halfway)}</span><span className="h">{rec.summary.n} matches</span></div>
        <div><span className="l">Brier score</span><span className="v">{d2(rec.summary.brier)}</span><span className="h">0 = perfect · 0.25 = coin flip</span></div>
        <div><span className="l">Predictions made</span><span className="v">{n0(rec.summary.points)}</span><span className="h">one per score check</span></div>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th scope="col">Model said</th><th scope="col">Times</th><th scope="col">Won</th></tr></thead>
          <tbody>{rec.summary.calib.map((c: any) => <tr key={c.bin}><td>{c.bin}</td><td>{n0(c.n)}</td><td>{pct(c.rate)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="panel-foot">A well-calibrated model wins about as often as it says: 70% calls should win about 70% of the time.</div>
    </Panel>
  );
}
