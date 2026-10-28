// Site QA: open a wide sample of pages on desktop and phone, click every tab and toggle, and record what breaks.
// Writes out/site-qa.json and screenshots to out/shots/. Read-only against the live site.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const S = process.env.SITE || 'https://cricforgeek.site';
const OUT = 'out';
fs.mkdirSync(`${OUT}/shots`, { recursive: true });

const j = async (p) => (await fetch(`${S}/data/${p}`)).json();
const pick = (a, n, seed = 7) => { const b = [...a]; let s = seed; for (let i = b.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const k = Math.floor((s / 233280) * (i + 1)); [b[i], b[k]] = [b[k], b[i]]; } return b.slice(0, n); };

(async () => {
  const search = await j('search.json');
  const venues = await j('venues/index.json').catch(() => []);
  const routes = ['/', '/players', '/teams', '/competitions', '/matches', '/venues', '/records', '/h2h', '/play', '/explore', '/pinboard', '/methodology', '/live', '/predictor', '/nope-404'];
  const P = search.players;
  const top = P.slice(0, 30).map((r) => r[0]);
  const women = P.filter((r) => r[3] === 'female').slice(0, 8).map((r) => r[0]);
  const rnd = pick(P.slice(30), 14).map((r) => r[0]);
  for (const id of [...top, ...women, ...rnd]) routes.push(`/player/${id}`);
  for (const t of ['form', 'scoring', 'dismissals', 'matchups', 'role']) routes.push(`/player/${top[0]}?tab=${t}`, `/player/${women[0]}?tab=${t}`);
  routes.push(`/player/${P.find((r) => r[1].includes('Bumrah'))?.[0] ?? top[1]}?tab=dismissals`);
  routes.push(`/compare?p=${top.slice(0, 3).join(',')}`, `/compare?p=${top.slice(3, 5).join(',')}&r=bowl`);
  for (const t of [...search.teams.slice(0, 8), ...pick(search.teams.slice(8), 5)]) routes.push(`/team/${t[0]}`);
  for (const c of [...search.comps.slice(0, 6), ...pick(search.comps.slice(6), 4)]) routes.push(`/league/${c[0]}`);
  for (const v of [...venues.slice(0, 5), ...pick(venues.slice(5), 4)]) routes.push(`/venue/${v[0]}`);
  for (const f of ['T20-male-2026', 'ODI-male-2026', 'TEST-male-2026', 'T20-female-2026', 'ODI-female-2025', 'TEST-male-2010', 'T20-male-2016']) {
    const idx = await j(`matches/index-${f}.json`).catch(() => []);
    for (const m of [...idx.slice(0, 2), ...pick(idx.slice(2), 1)]) routes.push(`/match/${m[0]}`);
  }

  const res = [];
  const b = await chromium.launch();
  for (const [dev, opts] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['phone', devices['Pixel 7']]]) {
    const ctx = await b.newContext(opts);
    const shot = new Set();
    for (const r of routes) {
      const p = await ctx.newPage();
      const e = { route: r, dev, errors: [], bad: [], overflow: [], text: [], images: 0, interactions: 0 };
      p.on('pageerror', (x) => e.errors.push('js: ' + x.message.slice(0, 200)));
      p.on('console', (m) => { if (m.type() === 'error') e.errors.push('console: ' + m.text().slice(0, 200)); });
      p.on('response', (x) => { if (x.status() >= 400 && !x.url().includes('/cdn-cgi/')) e.bad.push(`${x.status()} ${x.url().replace(S, '')}`); });
      p.on('requestfailed', (x) => e.bad.push(`failed ${x.url().replace(S, '')} ${x.failure()?.errorText ?? ''}`));
      const t0 = Date.now();
      try {
        await p.goto(S + r, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForFunction(() => !document.querySelector('.ball-loader'), null, { timeout: 20000 }).catch(() => e.errors.push('still loading after 20s'));
        await p.waitForTimeout(1200);
        e.ms = Date.now() - t0;
        const check = async (label) => {
          const o = await p.evaluate((label) => {
            const W = document.documentElement.clientWidth, out = { overflow: [], text: [], broken: 0, imgs: 0 };
            if (document.documentElement.scrollWidth > W + 1) {
              for (const el of document.querySelectorAll('main *')) {
                const rc = el.getBoundingClientRect();
                if (rc.right > W + 2 && rc.width > 0 && getComputedStyle(el).position !== 'fixed') {
                  let sc = false; for (let a = el.parentElement; a; a = a.parentElement) { const ov = getComputedStyle(a).overflowX; if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { sc = true; break; } }
                  if (!sc) out.overflow.push(`${label}: <${el.tagName.toLowerCase()} class="${el.className?.baseVal ?? el.className}"> right=${Math.round(rc.right)} W=${W}`);
                }
                if (out.overflow.length >= 3) break;
              }
            }
            const txt = (document.querySelector('main') ?? document.body).innerText;
            for (const re of [/\bNaN\b/, /\bundefined\b/, /\bInfinity\b/, /\[object \w+\]/, /\bnull\b/, /-0\.0\b/, /\b\d{1,3}(,\d{3})*\.\d{4,}\b/]) {
              const m = txt.match(re); if (m) { const i = m.index; out.text.push(`${label}: "${txt.slice(Math.max(0, i - 50), i + 40).replace(/\s+/g, ' ')}"`); }
            }
            for (const im of document.querySelectorAll('main img')) { out.imgs++; if (im.complete && im.naturalWidth === 0) out.broken++; }
            return out;
          }, label);
          e.overflow.push(...o.overflow); e.text.push(...o.text); e.images = Math.max(e.images, o.imgs); if (o.broken) e.errors.push(`${label}: ${o.broken} broken images`);
        };
        await check('load');
        const key = dev + ':' + r.split('/')[1].split('?')[0];
        if (!shot.has(key)) { shot.add(key); await p.screenshot({ path: `${OUT}/shots/${dev}-${(r.replace(/[^a-z0-9]+/gi, '_') || 'home').slice(0, 60)}.jpg`, quality: 45, type: 'jpeg', fullPage: true }).catch(() => {}); }
        // click every tab / toggle button once
        const n = await p.locator('main [role=tab], main .seg button, main .viewbar button').count();
        for (let i = 0; i < Math.min(n, 18); i++) {
          const btn = p.locator('main [role=tab], main .seg button, main .viewbar button').nth(i);
          if (!(await btn.isVisible().catch(() => false)) || (await btn.isDisabled().catch(() => true))) continue;
          const lbl = (await btn.innerText().catch(() => '?')).slice(0, 24).replace(/\s+/g, ' ');
          await btn.click({ timeout: 3000 }).catch(() => {});
          await p.waitForTimeout(500);
          e.interactions++;
          await check(`after "${lbl}"`);
        }
        if (r === '/play') {
          for (let i = 0; i < 6; i++) {
            const mine = p.locator('.gt-mine .gc-stats button:not([disabled])');
            if (await mine.count()) await mine.nth(i % 10).click().catch(() => {});
            else await p.locator('text=Let the computer pick').click().catch(() => {});
            await p.locator('text=Next card').click({ timeout: 3000 }).catch(() => e.errors.push('play: no Next card button'));
          }
          await check('after 6 rounds');
        }
        e.title = await p.title();
        e.h1 = (await p.locator('h1').first().innerText({ timeout: 2000 }).catch(() => '')).slice(0, 80);
        e.words = (await p.evaluate(() => (document.querySelector('main') ?? document.body).innerText.split(/\s+/).length));
      } catch (x) { e.errors.push('fatal: ' + x.message.slice(0, 200)); }
      e.overflow = [...new Set(e.overflow)].slice(0, 5); e.text = [...new Set(e.text)].slice(0, 6); e.errors = [...new Set(e.errors)].slice(0, 8); e.bad = [...new Set(e.bad)].slice(0, 8);
      res.push(e);
      await p.close();
    }
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/site-qa.json`, JSON.stringify(res, null, 1));
  const issues = res.filter((e) => e.errors.length || e.bad.length || e.overflow.length || e.text.length);
  console.log(`::notice::site qa: ${res.length} page loads, ${issues.length} with issues, slowest ${Math.max(...res.map((e) => e.ms || 0))}ms`);
})();
