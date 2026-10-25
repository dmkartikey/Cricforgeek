// cricforgeek live feed (Cloudflare Worker).
// Every minute the schedule wakes up, decides whether a call is worth spending, and if so fetches
// live international scores (CricketData.org), scorecards and market odds (The Odds API).
// Results go to KV; the website reads them through the GET endpoints below.
import { cardsToFetch, fairMarket, freshBudget, matchEvent, normalize, ODDS_KEY, oddsToFetch, parseCard, scoreInterval } from './logic.ts';
import type { Budget, LiveMatch, Upcoming } from './logic.ts';

type KV = {
  get(key: string, type: 'json'): Promise<any>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};
export type Env = { LIVE: KV; CRICDATA_KEY?: string; ODDS_API_KEY?: string; SITE: string; ODDS_ENABLED?: string };

type LiveDoc = { updated: string; checked: string; nextCheck: string; matches: LiveMatch[]; upcoming: (Upcoming & { market?: LiveMatch['market'] })[] };
type Snap = { t: string; s: [number, number, number][]; st: string; mk?: Record<string, number> };
type Done = { id: string; name: string; fmt: string; gender: string; teams: [string, string]; start: string; status: string; winner: string | null; innings: LiveMatch['innings']; ended: string };

const CRIC = 'https://api.cricapi.com/v1';
const ODDS = 'https://api.the-odds-api.com/v4';
const HOUR = 3600_000;

const winnerOf = (m: LiveMatch) => {
  const s = m.status.toLowerCase();
  if (/\bdrawn\b|\bdraw\b/.test(s)) return 'Draw';
  if (/\btied\b|\btie\b/.test(s)) return 'Tie';
  return m.teams.find((t) => s.startsWith(t.toLowerCase() + ' won')) ?? null;
};

const toDone = (m: LiveMatch, now: Date): Done => ({ id: m.id, name: m.name, fmt: m.fmt, gender: m.gender, teams: m.teams, start: m.start, status: m.status,
  winner: winnerOf(m), innings: m.innings, ended: now.toISOString() });

// Add finished matches to the results list (newest first). Returns true if anything was new.
async function addDone(env: Env, add: Done[]) {
  const done: Done[] = (await env.LIVE.get('done', 'json')) ?? [];
  const have = new Set(done.map((d) => d.id));
  const fresh = add.filter((d) => !have.has(d.id) && d.innings.length);
  if (!fresh.length) return false;
  const all = [...fresh, ...done].sort((a, b) => (b.start || b.ended).localeCompare(a.start || a.ended)).slice(0, 500);
  await env.LIVE.put('done', JSON.stringify(all));
  return true;
}

function note(b: Budget, msg: string) {
  b.errors = [`${new Date().toISOString()} ${msg}`, ...b.errors].slice(0, 10);
}

async function getJson(url: string, label: string, b: Budget) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'cricforgeek-live/1.0' } });
  if (!r.ok) { note(b, `${label}: HTTP ${r.status}`); return null; }
  return { body: await r.json<any>(), headers: r.headers };
}

async function knownTeams(env: Env) {
  const cached = await env.LIVE.get('teams', 'json');
  if (cached && Date.now() - cached.t < 24 * HOUR) return cached.teams;
  try {
    const r = await fetch(`${env.SITE}/data/predict/index.json`);
    if (r.ok) {
      const teams = (await r.json<any>()).intl_teams;
      if (teams) { await env.LIVE.put('teams', JSON.stringify({ t: Date.now(), teams })); return teams; }
    }
  } catch { /* fall back below */ }
  return cached?.teams ?? null;
}

export async function tick(env: Env, now = new Date()) {
  const b = freshBudget(now, (await env.LIVE.get('budget', 'json')) ?? undefined);
  const doc: LiveDoc = (await env.LIVE.get('live', 'json')) ?? { updated: '', checked: '', nextCheck: '', matches: [], upcoming: [] };
  const oddsOn = env.ODDS_ENABLED !== 'false' && !!env.ODDS_API_KEY;
  let changed = false, budgetChanged = false;

  const liveNow = doc.matches.filter((m) => m.started && !m.ended);
  const soon = doc.upcoming.some((u) => { const t = Date.parse(u.start) - now.getTime(); return t > -HOUR && t < 30 * 60_000; });
  const wait = scoreInterval(b, now, liveNow.length, soon);

  // 1. scores for every current match (1 call)
  if (env.CRICDATA_KEY && now.getTime() - b.lastScores >= wait) {
    b.lastScores = now.getTime(); budgetChanged = true;
    const res = await getJson(`${CRIC}/currentMatches?apikey=${env.CRICDATA_KEY}&offset=0`, 'scores', b);
    if (res?.body?.status === 'success') {
      if (Number.isFinite(res.body.info?.hitsToday)) b.hitsToday = res.body.info.hitsToday;
      if (Number.isFinite(res.body.info?.hitsLimit)) b.hitsLimit = res.body.info.hitsLimit;
      const prev = new Map(doc.matches.map((m) => [m.id, m]));
      const fresh = normalize(res.body.data, await knownTeams(env));
      const keep: LiveMatch[] = [];
      for (const m of fresh) {
        const old = prev.get(m.id);
        if (old) { m.card = old.card; m.market = old.market; m.toss = old.toss; }
        if (!m.market) {
          const u = doc.upcoming.find((x) => x.market && matchEvent(m, [{ home_team: x.teams[0], away_team: x.teams[1], commence_time: x.start }]));
          if (u) m.market = u.market;
        }
        const scoreKey = JSON.stringify(m.innings.map((i) => [i.r, i.w, i.o]));
        const oldKey = old ? JSON.stringify(old.innings.map((i) => [i.r, i.w, i.o])) : '';
        if (m.started && (scoreKey !== oldKey || (old && old.ended !== m.ended))) {
          const h: Snap[] = (await env.LIVE.get(`h:${m.id}`, 'json')) ?? [];
          h.push({ t: now.toISOString(), s: m.innings.map((i) => [i.r, i.w, i.o]), st: m.status, ...(m.market ? { mk: m.market.fair } : {}) });
          await env.LIVE.put(`h:${m.id}`, JSON.stringify(h.slice(-400)), { expirationTtl: 400 * 86400 });
        }
        if (m.ended && !old?.ended) {
          // also catches matches that had already finished when the worker first saw them
          if (await addDone(env, [toDone(m, now)])) await env.LIVE.put(`m:${m.id}`, JSON.stringify(m), { expirationTtl: 400 * 86400 });
        }
        // keep live matches, and finished ones for 12 hours after they end
        m.endedAt = old?.endedAt ?? (m.ended ? now.toISOString() : undefined);
        if (!m.ended || now.getTime() - Date.parse(m.endedAt!) < 12 * HOUR) keep.push(m);
      }
      doc.matches = keep;
      doc.checked = now.toISOString();
      changed = true;
    }
  }

  // 2. scorecards (10 calls each) for at most two live matches
  const live = doc.matches.filter((m) => m.started && !m.ended);
  if (env.CRICDATA_KEY && changed) {
    for (const id of cardsToFetch(b, now, live)) {
      const res = await getJson(`${CRIC}/match_scorecard?apikey=${env.CRICDATA_KEY}&id=${encodeURIComponent(id)}`, 'scorecard', b);
      b.lastCard[id] = now.getTime(); budgetChanged = true;
      if (res?.body?.status !== 'success') continue;
      if (Number.isFinite(res.body.info?.hitsToday)) b.hitsToday = res.body.info.hitsToday;
      const m = doc.matches.find((x) => x.id === id);
      const card = parseCard(res.body.data, now);
      if (m && card) {
        m.card = card; b.cardInnings[id] = m.innings.length;
        if (res.body.data.tossWinner) { const tw = String(res.body.data.tossWinner); m.toss = { winner: m.teams.find((t) => t.toLowerCase() === tw.toLowerCase()) ?? tw, choice: String(res.body.data.tossChoice ?? '') }; }
        changed = true;
      }
    }
  }

  // 3. fixtures for the next two days (free), hourly
  if (oddsOn && now.getTime() - b.lastEvents > HOUR) {
    b.lastEvents = now.getTime(); budgetChanged = true;
    const up: LiveDoc['upcoming'] = [];
    for (const key of Object.values(ODDS_KEY)) {
      const res = await getJson(`${ODDS}/sports/${key}/events?apiKey=${env.ODDS_API_KEY}`, `fixtures ${key}`, b);
      for (const e of (Array.isArray(res?.body) ? res!.body : [])) {
        const t = Date.parse(e.commence_time) - now.getTime();
        if (t > -6 * HOUR && t < 48 * HOUR) {
          const old = doc.upcoming.find((u) => u.start === e.commence_time && u.teams[0] === e.home_team);
          up.push({ key, fmt: Object.entries(ODDS_KEY).find(([, v]) => v === key)![0], start: e.commence_time, teams: [e.home_team, e.away_team], market: old?.market });
        }
      }
    }
    doc.upcoming = up.sort((x, y) => x.start.localeCompare(y.start));
    changed = true;
  }

  // 4. market odds (1 credit per format), rationed across the month
  if (oddsOn) {
    for (const key of oddsToFetch(b, now, live, doc.upcoming)) {
      const res = await getJson(`${ODDS}/sports/${key}/odds?apiKey=${env.ODDS_API_KEY}&regions=uk&markets=h2h&oddsFormat=decimal`, `odds ${key}`, b);
      b.lastOdds[key] = now.getTime(); b.oddsToday++; budgetChanged = true;
      const rem = Number(res?.headers.get('x-requests-remaining'));
      if (Number.isFinite(rem)) b.oddsRemaining = rem;
      if (!Array.isArray(res?.body)) continue;
      for (const m of doc.matches) {
        const ev = matchEvent(m, res!.body);
        const mk = ev && fairMarket(ev, now);
        if (mk) { m.market = mk; changed = true; }
      }
      for (const u of doc.upcoming) {
        const ev = res!.body.find((e: any) => e.commence_time === u.start && e.home_team === u.teams[0]);
        const mk = ev && fairMarket(ev, now);
        if (mk) { u.market = mk; changed = true; }
      }
    }
  }

  // 5. recent results (1 call per 25 matches) every 6 hours, to fill in matches that finished between score checks
  //    or before the worker started. The first run reads four pages to backfill the last few weeks.
  const leftToday = b.hitsLimit - b.hitsToday;
  if (env.CRICDATA_KEY && now.getTime() - (b.lastRecent ?? 0) >= 6 * HOUR && leftToday > 30) {
    b.lastRecent = now.getTime(); budgetChanged = true;
    const pages = b.backfilled ? 1 : 4;
    const teams = await knownTeams(env);
    const found: Done[] = [];
    for (let p = 0; p < pages; p++) {
      const res = await getJson(`${CRIC}/matches?apikey=${env.CRICDATA_KEY}&offset=${p * 25}`, 'recent results', b);
      if (res?.body?.status !== 'success') break;
      if (Number.isFinite(res.body.info?.hitsToday)) b.hitsToday = res.body.info.hitsToday;
      for (const m of normalize(res.body.data, teams)) {
        const age = now.getTime() - Date.parse(m.start);
        if (m.ended && age > 0 && age < 60 * 24 * HOUR) found.push(toDone(m, now));
      }
      if ((res.body.data ?? []).length < 25) break;
    }
    b.backfilled = true;
    await addDone(env, found);
  }

  if (changed) {
    doc.updated = now.toISOString();
    const liveCount = doc.matches.filter((m) => m.started && !m.ended).length;
    const nextSoon = doc.upcoming.some((u) => { const t = Date.parse(u.start) - now.getTime(); return t > -HOUR && t < 30 * 60_000; });
    const next = b.lastScores + scoreInterval(b, now, liveCount, nextSoon);
    doc.nextCheck = Number.isFinite(next) ? new Date(next).toISOString() : '';
    await env.LIVE.put('live', JSON.stringify(doc));
  }
  if (budgetChanged || changed) await env.LIVE.put('budget', JSON.stringify(b));
  return { changed, budget: b };
}

// ---------- read-only API for the website ----------
const ALLOWED = [/^https:\/\/cricforgeek\.site$/, /^https:\/\/www\.cricforgeek\.site$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const memo = new Map<string, { t: number; body: string }>();

function reply(body: string, origin: string | null, status = 200, maxAge = 60) {
  const allow = origin && ALLOWED.some((r) => r.test(origin)) ? origin : 'https://cricforgeek.site';
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': allow, vary: 'Origin', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'cross-origin-resource-policy': 'cross-origin',
    },
  });
}

async function cached(env: Env, key: string, ms = 30_000) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.body;
  const v = await env.LIVE.get(key, 'json');
  const body = JSON.stringify(v ?? null);
  memo.set(key, { t: Date.now(), body });
  return body;
}

export async function handle(req: Request, env: Env) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return reply('', origin, 204);
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply('{"error":"method not allowed"}', origin, 405);
  const oddsOn = env.ODDS_ENABLED !== 'false';
  const strip = (s: string) => (oddsOn ? s : JSON.stringify(JSON.parse(s), (k, v) => (k === 'market' || k === 'mk' ? undefined : v)));
  switch (url.pathname) {
    case '/live': return reply(strip(await cached(env, 'live')), origin);
    case '/match': {
      const id = (url.searchParams.get('id') ?? '').slice(0, 64);
      if (!/^[\w-]+$/.test(id)) return reply('{"error":"bad id"}', origin, 400);
      const live = JSON.parse(await cached(env, 'live'));
      const match = live?.matches?.find((m: LiveMatch) => m.id === id) ?? JSON.parse(await cached(env, `m:${id}`, 300_000));
      const history = JSON.parse(await cached(env, `h:${id}`));
      return reply(strip(JSON.stringify({ match, history: history ?? [], checked: live?.checked })), origin);
    }
    case '/done': return reply(await cached(env, 'done', 300_000), origin, 200, 300);
    case '/health': {
      const b: Budget | null = await env.LIVE.get('budget', 'json');
      return reply(JSON.stringify({
        ok: true, now: new Date().toISOString(), scores: !!env.CRICDATA_KEY, odds: oddsOn && !!env.ODDS_API_KEY,
        hitsToday: b?.hitsToday, hitsLimit: b?.hitsLimit, oddsRemaining: b?.oddsRemaining, oddsToday: b?.oddsToday,
        lastScores: b?.lastScores ? new Date(b.lastScores).toISOString() : null, errors: b?.errors ?? [],
      }), origin, 200, 30);
    }
    default: return reply('{"endpoints":["/live","/match?id=","/done","/health"]}', origin, 404);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  scheduled: (_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(tick(env)),
};
