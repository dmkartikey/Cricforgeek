// Speed check on a slow phone connection (1.6 Mbps, 150 ms): compressed bytes per file and when each started/ended.
const { chromium, devices } = require('playwright'); const fs = require('fs');
(async () => { fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch(); const rows = [];
  for (const [k, u] of [['home', '/'], ['players', '/players'], ['player', '/player/ba607b88'], ['matches', '/matches'], ['match', '/match/1557534'], ['explore', '/explore'], ['records', '/records']]) {
    const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });  // a mid-range phone
    const req = {}; let t0 = 0;
    cdp.on('Network.requestWillBeSent', (e) => { req[e.requestId] = { url: e.request.url.replace('https://cricforgeek.site', ''), s: e.timestamp }; if (!t0) t0 = e.timestamp; });
    cdp.on('Network.loadingFinished', (e) => { if (req[e.requestId]) { req[e.requestId].e = e.timestamp; req[e.requestId].kb = Math.round(e.encodedDataLength / 1024); } });
    const start = Date.now();
    await p.goto('https://cricforgeek.site' + u, { waitUntil: 'domcontentloaded', timeout: 120000 });
    let ready = null; for (let i = 0; i < 240; i++) { await p.waitForTimeout(250); if (await p.evaluate(() => !document.querySelector('.ball-loader') && (document.querySelector('main')?.innerText?.trim()?.length ?? 0) > 200)) { ready = Date.now() - start; break; } }
    await p.waitForTimeout(1000);
    const list = Object.values(req).filter((r) => r.e).map((r) => ({ u: r.url.slice(0, 55), kb: r.kb, s: Math.round((r.s - t0) * 1000), e: Math.round((r.e - t0) * 1000) })).sort((a, c) => a.s - c.s);
    const kb = list.reduce((a, r) => a + r.kb, 0);
    rows.push({ k, ready, kb, list });
    console.log(`::notice::slow ${k}: ready ${ready}ms, ${kb}KB transferred, ${list.length} files`);
    await ctx.close();
  }
  fs.writeFileSync('out/speed.json', JSON.stringify(rows, null, 1)); await b.close(); })();
