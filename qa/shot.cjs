const { chromium, devices } = require('playwright'); const fs = require('fs');
(async () => { fs.mkdirSync('out', { recursive: true });
  const b = await chromium.launch(); const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 150)));
  const names = await (await fetch('https://cricforgeek.site/data/names.json')).json().catch(() => ({}));
  console.log('::notice::live names.json entries ' + Object.keys(names).length + '; kohli=' + names.ba607b88);
  for (const [k, u] of [['tendulkar', '/player/d2c2b2d5'], ['kohli', '/player/ba607b88'], ['home', '/'], ['explore', '/explore']]) {
    await p.goto('https://cricforgeek.site' + u, { waitUntil: 'networkidle' }); await p.waitForTimeout(3000);
    const st = await p.evaluate(() => ({ h1: document.querySelector('h1')?.innerText, card: document.querySelector('.pcard h3')?.innerText, partial: document.querySelector('.pc-partial')?.innerText, lead: document.querySelector('.rl-lead .who')?.innerText }));
    console.log(`::notice::live ${k}: ${JSON.stringify(st)}`); await p.screenshot({ path: `out/${k}.png` });
  }
  console.log('::notice::live errors ' + (errs.join(' | ') || 'none')); await b.close(); })();
