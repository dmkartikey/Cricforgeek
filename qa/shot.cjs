// Speed check: each page on a throttled phone connection (about 4G: 9 Mbps down, 60 ms), fresh cache.
const { chromium, devices } = require('playwright'); const fs = require('fs');
(async () => { fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch(); const rows = [];
  for (const [k, u] of [['home', '/'], ['players', '/players'], ['player-kohli', '/player/ba607b88'], ['player-small', '/player/3241e3fd'], ['matches', '/matches'], ['match', '/match/1557534'], ['team', '/team/india'], ['records', '/records'], ['venues', '/venues'], ['explore', '/explore'], ['play', '/play']]) {
    const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    const res = []; p.on('response', async (r) => { try { const len = (await r.body()).length; res.push([r.url().replace('https://cricforgeek.site', ''), len, r.status()]); } catch { } });
    const t0 = Date.now();
    await p.goto('https://cricforgeek.site' + u, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let ready = null; for (let i = 0; i < 120; i++) { await p.waitForTimeout(250); if (await p.evaluate(() => !document.querySelector('.ball-loader') && (document.querySelector('main')?.innerText?.trim()?.length ?? 0) > 200)) { ready = Date.now() - t0; break; } }
    await p.waitForTimeout(1500);
    const total = res.reduce((a, r) => a + r[1], 0);
    const big = res.sort((a, b2) => b2[1] - a[1]).slice(0, 6).map((r) => `${r[0].slice(0, 60)} ${Math.round(r[1] / 1024)}KB`);
    rows.push({ k, ready, kb: Math.round(total / 1024), n: res.length, big });
    console.log(`::notice::speed ${k}: ready ${ready}ms, ${Math.round(total / 1024)}KB in ${res.length} files; biggest ${big.join(', ')}`.slice(0, 900));
    await ctx.close();
  }
  fs.writeFileSync('out/speed.json', JSON.stringify(rows, null, 1)); await b.close(); })();
