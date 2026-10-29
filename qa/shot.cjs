// Phone screenshots of the Players page rails (ODI men), to check how photos sit on the cards.
const { chromium, devices } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  await p.goto('https://cricforgeek.site/players', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  await p.locator('.vb-fmts button', { hasText: 'ODI' }).first().click().catch(() => {}); await p.waitForTimeout(2500);
  const srcs = await p.evaluate(() => [...document.querySelectorAll('.rcard img')].slice(0, 6).map((i) => i.getAttribute('src')));
  console.log('::notice::photo srcs ' + srcs.join(' '));
  await p.locator('.rail-row').first().scrollIntoViewIfNeeded(); await p.waitForTimeout(800);
  await p.screenshot({ path: 'out/players-phone.png' });
  await p.goto('https://cricforgeek.site/player/b4b99816', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
  await p.screenshot({ path: 'out/player-phone.png' });
  await b.close();
})();
