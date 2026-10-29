const { chromium, webkit, devices } = require('playwright');
const fs = require('fs');
(async () => {
  fs.mkdirSync('out', { recursive: true });
  for (const [eng, name] of [[webkit, 'safari'], [chromium, 'chrome']]) {
    const b = await eng.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'] });
    for (const [k, u] of [['abhishek', '/player/f29185a1'], ['kohli', '/player/ba607b88'], ['players', '/players']]) {
      const p = await ctx.newPage(); const errs = [], bad = [];
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 200))); p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 200)));
      p.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 100)); });
      p.on('requestfailed', (r) => bad.push('failed ' + r.url().slice(0, 100) + ' ' + (r.failure()?.errorText || '')));
      const t = Date.now();
      await p.goto('https://cricforgeek.site' + u, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => errs.push('goto ' + e.message.slice(0, 100)));
      await p.waitForTimeout(9000);
      const st = await p.evaluate(() => ({ loader: !!document.querySelector('.ball-loader'), h1: document.querySelector('h1')?.innerText, words: (document.querySelector('main')?.innerText || '').split(/\s+/).length, scripts: [...document.scripts].map((s) => s.src.split('/').pop()).join(','), getty: !!document.querySelector('.getty iframe'), err: document.querySelector('.err,.error')?.innerText?.slice(0, 120) }));
      console.log(`::notice::${name} ${k}: ${JSON.stringify(st)} errors=${errs.slice(0, 4).join(' | ')} bad=${bad.slice(0, 5).join(' | ')}`.slice(0, 1500));
      await p.screenshot({ path: `out/${name}-${k}.png` }); await p.close();
    }
    await b.close();
  }
})();
