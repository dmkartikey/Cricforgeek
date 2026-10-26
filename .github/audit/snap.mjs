// Temporary audit helper: screenshots the live site and saves the data files each page loads.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const SITE = 'https://cricforgeek.site';
const OUT = process.argv[2];
const pages = ['/', '/players', '/player/ba607b88', '/compare', '/live', '/teams', '/team/india', '/competitions', '/league/ipl', '/matches', '/explore', '/methodology', '/pinboard', '/team/india-women', '/league/bbl'];
const b = await chromium.launch();
const saved = new Set();
let matchUrl = null;
for (const scheme of ['dark', 'light']) for (const [w, h, tag] of [[390, 844, 'm'], [1280, 900, 'd']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: tag === 'm' ? 2 : 1, colorScheme: scheme, isMobile: tag === 'm', hasTouch: tag === 'm' });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  pg.on('response', async (r) => {
    const u = new URL(r.url());
    if (u.host !== 'cricforgeek.site' || !u.pathname.startsWith('/data/') || saved.has(u.pathname) || r.status() !== 200) return;
    saved.add(u.pathname);
    try { const body = await r.body(); const f = join(OUT, 'data', u.pathname.slice(6)); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); } catch {}
  });
  const list = [...pages]; if (matchUrl) list.push(matchUrl);
  for (const p of list) {
    try {
      await pg.goto(SITE + p, { waitUntil: 'networkidle', timeout: 60000 });
      if (p === '/matches' && !matchUrl) matchUrl = await pg.evaluate(() => [...document.querySelectorAll('a[href^="/match/"]')][0]?.getAttribute('href')) ;
      for (let y = 0; y < 30; y++) { await pg.mouse.wheel(0, 900); await pg.waitForTimeout(120); }
      await pg.waitForTimeout(800);
      await pg.evaluate(() => window.scrollTo(0, 0));
      const name = `${scheme}-${tag}-${(p === '/' ? 'home' : p.slice(1).replace(/\//g, '_'))}.jpg`;
      await pg.screenshot({ path: join(OUT, 'shots', name), fullPage: true, type: 'jpeg', quality: 55 });
      // layout probe: elements wider than the viewport and overlapping text boxes
      const probe = await pg.evaluate(() => {
        const vw = document.documentElement.clientWidth, out = [];
        if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect(); if (!r.width) continue;
          const cs = getComputedStyle(el);
          if (r.right > vw + 1 && !el.closest('.tabs, .jump, .table-wrap, [style*="overflow"], .scroll-x') && cs.position !== 'fixed') {
            let anc = el.parentElement, clipped = false; while (anc) { const o = getComputedStyle(anc).overflowX; if (o === 'auto' || o === 'hidden' || o === 'scroll' || o === 'clip') { clipped = true; break; } anc = anc.parentElement; }
            if (!clipped) out.push(`overflows right: <${el.tagName.toLowerCase()} class="${el.className?.baseVal ?? el.className}"> ${Math.round(r.right)}px`);
          }
        }
        return [...new Set(out)].slice(0, 25);
      });
      writeFileSync(join(OUT, 'shots', name.replace('.jpg', '.txt')), [...probe, ...errs.splice(0).map((e) => 'console: ' + e)].join('\n'));
    } catch (e) { writeFileSync(join(OUT, 'shots', `ERR-${scheme}-${tag}-${p.replace(/\//g, '_')}.txt`), String(e)); }
  }
  await ctx.close();
}
await b.close();
console.log('saved data files', saved.size);
