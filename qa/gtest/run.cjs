const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const page of ['index.html', 'nocsp.html']) {
    const ctx = await b.newContext({ viewport: { width: 420, height: 800 } }); const p = await ctx.newPage();
    const msgs = [], net = [];
    p.on('console', (m) => msgs.push(m.type() + ': ' + m.text().slice(0, 160))); p.on('pageerror', (e) => msgs.push('pageerror: ' + e.message.slice(0, 160)));
    p.on('requestfinished', async (r) => { const res = await r.response(); net.push(`${res ? res.status() : '?'} ${r.url().slice(0, 110)}`); });
    p.on('requestfailed', (r) => net.push(`FAILED ${r.url().slice(0, 110)} ${r.failure()?.errorText}`));
    await p.goto('http://localhost:8099/' + page); await p.waitForTimeout(10000);
    const st = await p.evaluate(() => ({ widgets: typeof (window.gie && window.gie.widgets), q: (window.gie && window.gie.q || []).length, iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 140)), html: document.getElementById('a').innerHTML.slice(0, 300) }));
    console.log(`::notice::getty ${page} state ${JSON.stringify(st)}`.slice(0, 1500));
    console.log(`::notice::getty ${page} net ${net.join(' | ')}`.slice(0, 1800));
    console.log(`::notice::getty ${page} console ${msgs.join(' | ') || 'none'}`.slice(0, 1200));
    await p.screenshot({ path: `out/getty-${page}.png` });
    await ctx.close();
  }
  await b.close();
})();
