const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  const msgs = []; p.on('console', (m) => msgs.push(m.type() + ': ' + m.text().slice(0, 200))); p.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
  await p.goto('http://localhost:8099/index.html'); await p.waitForTimeout(9000);
  const r = await p.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => [f.src.slice(0, 160), f.width, f.height, f.getBoundingClientRect().width, f.getBoundingClientRect().height]));
  console.log('::notice::getty test iframes ' + JSON.stringify(r));
  console.log('::notice::getty test console ' + (msgs.join(' | ') || 'none').slice(0, 1500));
  await p.screenshot({ path: 'out/getty-test.png' });
  await b.close();
})();
