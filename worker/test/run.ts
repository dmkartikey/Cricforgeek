// Runs the Worker's schedule through a simulated day with fake API replies and checks it stays inside
// the free limits: 100 CricketData calls a day (scorecards cost 10) and the monthly odds credits.
import { tick, handle, type Env } from '../src/index.ts';
import { normalize, parseCard, fairMarket, isInternational } from '../src/logic.ts';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const store = new Map<string, string>();
let writes = 0;
const kv = {
  async get(k: string) { const v = store.get(k); return v ? JSON.parse(v) : null; },
  async put(k: string, v: string) { writes++; store.set(k, v); },
};

let hits = 0, odds = 500, oddsCalls = 0, cards = 0, events = 0, recentCalls = 0;
let clock = Date.parse('2026-10-25T06:00:00Z');
const teams = { male: { Pakistan: [1], England: [1], Nigeria: [1], Uganda: [1], India: [1], Australia: [1] }, female: { India: [1], England: [1] } };

function matchesAt(t: number) {
  const mins = (t - Date.parse('2026-10-25T08:00:00Z')) / 60000; // ODI starts 08:00, T20 starts 13:00
  const odiOvers = Math.max(0, Math.min(100, mins / 3.6));
  const inn1 = Math.min(50, odiOvers), inn2 = Math.max(0, odiOvers - 50);
  const t20 = Math.max(0, (t - Date.parse('2026-10-25T13:00:00Z')) / 60000 / 4.2);
  const list: any[] = [
    { id: 'odi1', name: 'Pakistan vs England, 4th Match, Pakistan ODI Tri-Series, 2026', matchType: 'odi', status: 'live', venue: 'Gaddafi Stadium, Lahore',
      dateTimeGMT: '2026-10-25T08:00:00', teams: ['Pakistan', 'England'], teamInfo: [{ name: 'England', shortname: 'ENG' }, { name: 'Pakistan', shortname: 'PAK' }],
      score: [{ r: Math.round(inn1 * 5.2), w: Math.min(10, Math.floor(inn1 / 6)), o: Math.floor(inn1), inning: 'England Inning 1' },
        ...(inn2 > 0 ? [{ r: Math.round(inn2 * 5.4), w: Math.min(9, Math.floor(inn2 / 7)), o: Math.floor(inn2), inning: 'Pakistan Inning 1' }] : [])],
      matchStarted: mins > 0, matchEnded: odiOvers >= 100 },
    { id: 'a-test', name: 'New Zealand A vs India A, 1st Unofficial Test', matchType: 'test', teams: ['New Zealand A', 'India A'], score: [], matchStarted: true, matchEnded: false },
    { id: 'u19', name: 'India U19 vs Australia U19, 1st Youth ODI', matchType: 'odi', teams: ['India U19', 'Australia U19'], score: [], matchStarted: true, matchEnded: false },
    { id: 'w1', name: 'India Women vs England Women, 1st T20I', matchType: 't20', teams: ['India Women', 'England Women'], dateTimeGMT: '2026-10-25T13:00:00',
      score: t20 > 0 ? [{ r: Math.round(Math.min(20, t20) * 7.5), w: 2, o: Math.floor(Math.min(20, t20)), inning: 'India Women Inning 1' }] : [], matchStarted: t20 > 0, matchEnded: t20 > 40 },
  ];
  return list;
}

globalThis.fetch = (async (input: any) => {
  const url = new URL(String(input));
  const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
  if (url.hostname === 'cricforgeek.site') return json({ intl_teams: teams });
  if (url.pathname.endsWith('/currentMatches')) { hits += 1; return json({ status: 'success', info: { hitsToday: hits, hitsLimit: 100 }, data: matchesAt(clock) }); }
  if (url.pathname.endsWith('/match_scorecard')) {
    hits += 10; cards++;
    return json({ status: 'success', info: { hitsToday: hits }, data: { tossWinner: 'pakistan', tossChoice: 'bowl', scorecard: [{ inning: 'England Inning 1',
      batting: [{ batsman: { name: 'Tom Banton' }, 'dismissal-text': 'c Arafat Minhas b Shaheen Afridi', r: 4, b: 5, '4s': 1, '6s': 0 }, { batsman: { name: 'Joe Root' }, 'dismissal-text': 'not out', r: 61, b: 70, '4s': 5, '6s': 1 }],
      bowling: [{ bowler: { name: 'Shaheen Afridi' }, o: 8.4, m: 0, r: 46, w: 4, nb: 0, wd: 1 }] }] } });
  }
  if (url.pathname.endsWith('/matches')) {
    hits += 1; recentCalls++;
    const off = +(url.searchParams.get('offset') ?? 0);
    const data = off > 0 ? [] : [
      { id: 'old-odi', name: 'India vs Australia, 2nd ODI, Australia tour of India, 2026', matchType: 'odi', status: 'India won by 6 wickets', teams: ['India', 'Australia'],
        dateTimeGMT: '2026-10-20T08:30:00', score: [{ r: 281, w: 8, o: 50, inning: 'Australia Inning 1' }, { r: 285, w: 4, o: 47.2, inning: 'India Inning 1' }], matchStarted: true, matchEnded: true },
      { id: 'dom', name: 'Mumbai vs Delhi, Ranji Trophy', matchType: 'test', status: 'Match drawn', teams: ['Mumbai', 'Delhi'], dateTimeGMT: '2026-10-18T04:00:00',
        score: [{ r: 300, w: 10, o: 90, inning: 'Mumbai Inning 1' }], matchStarted: true, matchEnded: true },
      { id: 'future', name: 'India vs Australia, 3rd ODI', matchType: 'odi', status: 'Match not started', teams: ['India', 'Australia'], dateTimeGMT: '2026-10-29T08:30:00', score: [], matchStarted: false, matchEnded: false },
    ];
    return json({ status: 'success', info: { hitsToday: hits }, data });
  }
  if (url.pathname.endsWith('/events')) { events++; return json([{ commence_time: '2026-10-25T13:00:00Z', home_team: 'India', away_team: 'England' }]); }
  if (url.pathname.endsWith('/odds')) {
    odds--; oddsCalls++;
    return json([{ commence_time: '2026-10-25T08:00:00Z', home_team: 'Pakistan', away_team: 'England', bookmakers: [
      { title: 'A', markets: [{ key: 'h2h', outcomes: [{ name: 'Pakistan', price: 2.1 }, { name: 'England', price: 1.8 }] }] },
      { title: 'B', markets: [{ key: 'h2h', outcomes: [{ name: 'Pakistan', price: 2.0 }, { name: 'England', price: 1.85 }] }] }] }],
    { 'x-requests-remaining': String(odds) });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const env: Env = { LIVE: kv as any, CRICDATA_KEY: 'k', ODDS_API_KEY: 'o', SITE: 'https://cricforgeek.site' };

// unit checks
ok(!isInternational('New Zealand A vs India A', ['New Zealand A', 'India A'], 'test', teams), 'A-team match is not treated as international');
ok(!isInternational('India U19 vs Australia U19', ['India U19', 'Australia U19'], 'odi', teams), 'Under-19 match is excluded');
ok(isInternational('India Women vs England Women, 1st T20I', ['India Women', 'England Women'], 't20', teams), "Women's T20I is included");
ok(normalize(matchesAt(Date.parse('2026-10-25T10:00:00Z')), teams).length === 2, 'two internationals kept from four');
const card = parseCard({ scorecard: [{ inning: 'X', batting: [{ batsman: { name: 'A' }, 'dismissal-text': 'not out', r: 1, b: 1 }], bowling: [] }] }, new Date());
ok(card?.batting[0].out === false, 'not-out batter recognised');
const mk = fairMarket({ bookmakers: [{ markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 1.9 }, { name: 'B', price: 1.9 }] }] }] }, new Date());
ok(Math.abs((mk?.fair.A ?? 0) - 0.5) < 1e-9 && (mk?.margin ?? 0) > 0.05, 'bookmaker margin removed from market odds');

ok(!isInternational('Perth Scorchers Women vs Sydney Sixers Women, Final', ['Perth Scorchers Women', 'Sydney Sixers Women'], 't20', null), 'nothing passes without the team list');
// a domestic result stored before the team list was available gets cleaned out
store.set('done', JSON.stringify([{ id: 'psw', name: 'Perth Scorchers Women vs Sydney Sixers Women, Final', fmt: 'T20', gender: 'female', teams: ['Perth Scorchers Women', 'Sydney Sixers Women'],
  start: '2026-10-24T08:00:00', status: 'Sydney Sixers Women won by 15 runs', winner: 'Sydney Sixers Women', innings: [{ team: 'Perth Scorchers Women', r: 120, w: 8, o: 20, label: '' }], ended: '2026-10-24T12:00:00Z' }]));

// a simulated day, one tick per minute from 06:00 to 23:59 UTC
for (; clock < Date.parse('2026-10-25T23:59:00Z'); clock += 60_000) await tick(env, new Date(clock));
console.log(`day: ${hits} CricketData calls (${cards} scorecards), ${oddsCalls} odds credits, ${events} fixture checks, ${writes} storage writes`);
ok(hits <= 100, 'stays inside 100 CricketData calls a day');
ok(cards >= 2, 'fetched scorecards for the live matches');
ok(oddsCalls <= 17, 'odds credits stay inside the daily share of the monthly 500');
ok(writes < 1000, 'stays inside 1,000 storage writes a day');

const live = JSON.parse(store.get('live')!);
ok(live.matches.every((m: any) => !/\bA$|U19/.test(m.teams[0])), 'stored feed has only senior internationals');
const odi = live.matches.find((m: any) => m.id === 'odi1');
ok(!!odi?.market && Math.abs(odi.market.fair.Pakistan + odi.market.fair.England - 1) < 1e-6, 'market odds attached to the right match');
const hist = JSON.parse(store.get('h:odi1')!);
ok(hist.length >= 15, `ODI history kept (${hist.length} snapshots)`);
const done = JSON.parse(store.get('done') ?? '[]');
ok(done.some((d: any) => d.id === 'odi1'), 'finished ODI recorded for the track record');
ok(done.some((d: any) => d.id === 'old-odi' && d.winner === 'India'), 'recent results backfill an international that finished earlier');
ok(!done.some((d: any) => d.id === 'dom' || d.id === 'future'), 'domestic and unfinished matches are left out of results');
ok(done.every((d: any, i: number) => i === 0 || (done[i - 1].start || '') >= (d.start || '')), 'results are newest first');
ok(!done.some((d: any) => d.id === 'psw'), 'domestic result stored earlier is removed');
ok(recentCalls <= 6, `recent-results calls stay small (${recentCalls})`);

// API
const r1 = await handle(new Request('https://x/live', { headers: { origin: 'https://cricforgeek.site' } }), env);
ok(r1.status === 200 && r1.headers.get('access-control-allow-origin') === 'https://cricforgeek.site', '/live answers with CORS for the site');
const r2 = await handle(new Request('https://x/live', { headers: { origin: 'https://evil.example' } }), env);
ok(r2.headers.get('access-control-allow-origin') === 'https://cricforgeek.site', 'other sites are not allowed to read it from a browser');
const r3 = await handle(new Request('https://x/match?id=odi1'), env);
ok((await r3.json() as any).history.length >= 15, '/match returns the history');
const r4 = await handle(new Request('https://x/match?id=../../x'), env);
ok(r4.status === 400, 'bad match id rejected');
const r5 = await handle(new Request('https://x/live', { method: 'POST' }), env);
ok(r5.status === 405, 'writes are refused');
const h = await (await handle(new Request('https://x/health'), env)).text();
ok(!h.includes('"k"') && !/apikey|apiKey/.test(h), 'health check does not reveal keys');
const off = await (await handle(new Request('https://x/live'), { ...env, ODDS_ENABLED: 'false' })).text();
ok(!off.includes('"market"'), 'odds switch removes market odds from the feed');

console.log(fail ? `${fail} FAILED` : 'all checks passed');
process.exit(fail ? 1 : 0);
