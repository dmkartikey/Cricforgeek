// @ts-nocheck -- ported as-is from the approved card mockup: DOM building and Web Animations, no app state.
// The card is plain markup (every value passes through esc) mounted into a container the React component owns.
const SIL = `<svg viewBox="0 0 200 260" aria-hidden="true"><path d="M96 20a20 20 0 1 1 0 40a20 20 0 1 1 0-40zM74 68c16-6 30-6 44 0l10 30 34-40 10 8-38 58-6 30 18 104h-22l-18-82h-8l-16 82H56l14-104-6-34-18 10-8-12z" fill="#2E3D63"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const avgP = (rows) => { const v = rows.map((r) => r[2]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
function rating(p) {
  const b = p.bat ? avgP(p.bat.meters) : 0, w = p.bowl ? avgP(p.bowl.meters) : 0;
  return Math.min(99, Math.round(p.role === 'all' ? Math.max(b, w) + .15 * Math.min(b, w) : Math.max(b, w)));
}
const TIER = (r) => (r >= 90 ? ['Legend', 'linear-gradient(90deg,#F3D98C,#E2B64A)'] : r >= 80 ? ['Elite', 'linear-gradient(90deg,#EFE6CB,#D9CDA8)'] : r >= 70 ? ['Gold', 'linear-gradient(90deg,#E2B64A,#B98A2E)'] : ['Silver', 'linear-gradient(90deg,#D8DCD2,#A9B9A6)']);
const segColor = (v) => (v >= 90 ? '#E2B64A' : v >= 70 ? '#8FE0B0' : v >= 40 ? '#C9D7C2' : '#FF9C8F');
const ROLE = { bat: 'Batter', bowl: 'Bowler', all: 'All-rounder' };

function spark(series, label, unit) {
  const W = 100, H = 30, max = Math.max(...series.map((s) => s[1]), 1);
  const pts = series.map((s, i) => [series.length > 1 ? (i / (series.length - 1)) * W : W / 2, H - (s[1] / max) * (H - 3) - 1.5]);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
  const pk = series.reduce((a, s) => (s[1] > a[1] ? s : a), series[0]); const pi = series.indexOf(pk);
  return `<div class="spark"><span class="t">${esc(label)} by year</span><span class="pk">Peak ${esc(pk[1].toLocaleString('en'))} ${unit} · ${esc(pk[0])}</span>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(label)} by year"><path d="${d} L${W},${H} L0,${H} Z" fill="rgba(143,224,176,.14)"/>
    <path class="ln" d="${d}" pathLength="1" fill="none" stroke="#8FE0B0" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
    <circle cx="${pts[pi][0]}" cy="${pts[pi][1]}" r="1.8" fill="#E2B64A"/></svg></div>`;
}
function pane(p, d, kind) {
  const ph = d.phases, best = ph.reduce((a, x) => ((kind === 'bat' ? x[1] > a[1] : x[1] < a[1]) ? x : a), ph[0]);
  return `<div class="pane" data-pane="${kind}">
    <div class="hero">${d.hero.map(([l, v, n]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b>${n ? `<i>${esc(n)}</i>` : ''}</div>`).join('')}</div>
    <div class="meters">${d.meters.map(([l, v, pc]) => `<div class="meter"><span>${esc(l)}<i>${esc(v)}</i></span><span class="segs" style="--c:${segColor(pc)}">${Array.from({ length: 10 }, (_, i) => `<u class="${i < Math.round(pc / 10) ? 'on' : ''}" style="transition-delay:${300 + i * 45}ms"></u>`).join('')}</span><b>${pc}</b></div>`).join('')}</div>
    ${spark(d.year, kind === 'bat' ? 'Runs' : 'Wickets', kind === 'bat' ? 'runs' : 'wkts')}
    <div class="insights"><div class="up"><small>${kind === 'bat' ? 'Feasts on' : 'Best phase'}</small>${esc(d.up)}${kind === 'bat' ? `<br><span style="opacity:.8">Best phase: ${esc(best[0].toLowerCase())} · SR ${esc(String(best[1]))}</span>` : ''}</div><div class="dn"><small>${kind === 'bat' ? 'Watch for' : 'Hardest phase'}</small>${esc(d.dn)}</div></div>
  </div>`;
}
function cardHtml(p) {
  const r = rating(p), [tn, tg] = TIER(r);
  const main = p.role === 'bowl' ? p.bowl : p.bat;
  const disc = p.role === 'all' ? `<div class="disc"><span>BAT ${Math.round(avgP(p.bat.meters))}</span><span>BOWL ${Math.round(avgP(p.bowl.meters))}</span></div>` : '';
  return `<div class="face front"><span class="beam l"></span><span class="beam r"></span><span class="ring"></span>
      <span class="tier" style="background:${tg}">${tn} · ${esc(p.fmt)}</span><span class="ovr">${r}<small>RATING</small></span>${disc}
      <div class="photo">${p.photo ? `<img src="${p.photo}" alt="">` : SIL}</div>
      <div class="pc-band"><h3>${esc(p.name)}</h3><div class="pc-chips"><span>${esc(p.team)}</span><span class="alt">${esc(p.roleText)}</span></div>
        <div class="trio">${p.trio.map(([l, v]) => `<div><small>${esc(l)}</small><b>${esc(v)}</b></div>`).join('')}</div></div></div>
    <div class="face back"><span class="beam l"></span><span class="beam r"></span>
      <div class="inner">
        <div class="hd"><div><h4>${esc(p.full)}</h4><p>${esc(p.fmt)} · ${esc(p.roleText)} · ${esc(p.span)}</p></div>
          <div class="gauge" style="--g:${r}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle class="v" cx="18" cy="18" r="15.9" fill="none" stroke="url(#gg-${p.key})" stroke-width="3" stroke-linecap="round" pathLength="100"/><defs><linearGradient id="gg-${p.key}"><stop offset="0" stop-color="#8FE0B0"/><stop offset="1" stop-color="#E2B64A"/></linearGradient></defs></svg><b>${r}</b><small>${tn.toUpperCase()}</small></div></div>
        ${p.role === 'all' ? `<div class="pc-tabs" role="group" aria-label="Discipline"><button data-t="bat" aria-pressed="true">Batting</button><button data-t="bowl" aria-pressed="false">Bowling</button></div>` : ''}
        ${p.bat && p.role !== 'bowl' ? pane(p, p.bat, 'bat') : ''}${p.bowl && p.role !== 'bat' ? pane(p, p.bowl, 'bowl') : ''}
        <div class="credit">${esc(p.credit)}</div>
      </div></div>`;
}

// ---------- helpers for effects ----------
const el = (fx, cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; fx.appendChild(d); return d; };
const stumpsEl = (fx, x, y, zing) => { const s = el(fx, 'stumps' + (zing ? ' zing' : ''), '<i class="s"></i><i class="s"></i><i class="s"></i><i class="bl a"></i><i class="bl b"></i>'); s.style.left = x + 'px'; s.style.top = y + 'px'; return s; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const anim = (node, frames, opts) => node.animate(frames, { fill: 'forwards', easing: 'cubic-bezier(.3,.6,.3,1)', ...opts }).finished;
function dims(stage) { const fx = stage.querySelector('.fx'); return { fx, W: fx.clientWidth, H: fx.clientHeight }; }
// the card ends turned to the back (180deg); the next play starts from the front again
async function settle(card, back) {
  card.getAnimations().forEach((a) => a.cancel());
  card.style.transform = back ? 'rotateY(180deg)' : 'none';
  card.classList.toggle('on-back', back);
}

const OPTIONS = [
  { k: 'bowled', t: 'Bowled him!', d: 'A full ball races in under the card, the middle stump cartwheels, both bails fly, and the card spins one and a half times to land on the stats.', ms: 1900,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const st = stumpsEl(fx, W / 2 - 13, H - 64); const ball = el(fx, 'ball');
      await anim(ball, [{ transform: `translate(${-10}px, ${H * .55}px) rotate(0)` }, { transform: `translate(${W * .35}px, ${H - 40}px) rotate(360deg)`, offset: .7 }, { transform: `translate(${W / 2 - 7}px, ${H - 30}px) rotate(540deg)` }], { duration: 520, easing: 'linear' });
      const [s1, s2, s3, b1, b2] = st.children;
      anim(s2, [{ transform: 'none' }, { transform: 'translate(10px,-34px) rotate(160deg)', opacity: 0 }], { duration: 700 });
      anim(b1, [{ transform: 'none' }, { transform: 'translate(-30px,-70px) rotate(-320deg)', opacity: 0 }], { duration: 800 });
      anim(b2, [{ transform: 'none' }, { transform: 'translate(34px,-80px) rotate(380deg)', opacity: 0 }], { duration: 800 });
      anim(s1, [{ transform: 'none' }, { transform: 'rotate(-14deg)' }], { duration: 300 }); anim(s3, [{ transform: 'none' }, { transform: 'rotate(10deg)' }], { duration: 300 });
      ball.remove();
      await anim(card, [{ transform: 'rotateY(0) translateY(0)' }, { transform: 'rotateY(-12deg) translateY(4px)', offset: .12 }, { transform: 'rotateY(300deg) translateY(-18px) scale(1.04)', offset: .6 }, { transform: 'rotateY(540deg) translateY(0) scale(1)' }], { duration: 1100, easing: 'cubic-bezier(.25,.7,.2,1)' });
      await wait(150); st.remove();
    } },
  { k: 'zing', t: 'Direct hit, run out', d: 'A throw fizzes in flat from the deep, hits the LED stumps and they flash red. The card shudders like the batter diving, then flips over.', ms: 1900,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const st = stumpsEl(fx, W / 2 - 13, H - 64, true); const ball = el(fx, 'ball');
      await anim(ball, [{ transform: `translate(${W + 10}px, ${H * .35}px)` }, { transform: `translate(${W / 2 + 4}px, ${H - 52}px)` }], { duration: 380, easing: 'cubic-bezier(.5,0,.9,.6)' });
      ball.remove();
      const parts = [...st.children];
      parts.forEach((p) => anim(p, [{ background: '#1E2430', boxShadow: 'none' }, { background: '#FF2B2B', boxShadow: '0 0 14px #FF3B3B' }, { background: '#5A0E0E' }, { background: '#FF2B2B', boxShadow: '0 0 14px #FF3B3B' }, { background: '#5A0E0E' }, { background: '#FF2B2B', boxShadow: '0 0 18px #FF3B3B' }], { duration: 700, easing: 'steps(6, end)' }));
      anim(parts[3], [{ transform: 'none' }, { transform: 'translate(-16px,-24px) rotate(-90deg)' }], { duration: 400 }); anim(parts[4], [{ transform: 'none' }, { transform: 'translate(16px,-28px) rotate(90deg)' }], { duration: 400 });
      await anim(card, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px) rotateZ(-1.5deg)' }, { transform: 'translateX(6px) rotateZ(1.5deg)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'linear' });
      await anim(card, [{ transform: 'rotateY(0) rotateZ(0)' }, { transform: 'rotateY(110deg) rotateZ(-4deg) translateY(-10px)', offset: .5 }, { transform: 'rotateY(180deg) rotateZ(0)' }], { duration: 700 });
      await wait(300); st.remove();
    } },
  { k: 'drs', t: 'DRS ball-tracking', d: 'The broadcast review: a ball-tracking path is drawn down the card, then Pitching, Impact and Wickets light up one by one. "OUT", and the card turns.', ms: 2900,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const svg = el(fx, '', `<svg width="${W}" height="${H}" style="position:absolute;inset:0"><path d="M ${W * .62} 30 C ${W * .6} ${H * .4}, ${W * .55} ${H * .6}, ${W / 2} ${H - 40}" fill="none" stroke="rgba(255,60,60,.75)" stroke-width="12" stroke-linecap="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><circle cx="${W / 2}" cy="${H - 40}" r="0" fill="rgba(255,60,60,.9)"/></svg>`);
      const path = svg.querySelector('path'), dot = svg.querySelector('circle');
      await anim(path, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 800 });
      anim(dot, [{ r: 0 }, { r: 9 }], { duration: 200 });
      const labels = [['PITCHING', 'IN LINE'], ['IMPACT', 'IN LINE'], ['WICKETS', 'HITTING']];
      for (let i = 0; i < 3; i++) { const p = el(fx, 'pc-panel', `${labels[i][0]}<b>${labels[i][1]}</b>`); p.style.top = (H * .28 + i * 30) + 'px'; anim(p, [{ opacity: 0, transform: 'translateX(-50%) scale(.8)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 220 }); await wait(260); }
      const out = el(fx, 'pc-panel out', 'DECISION<b>OUT</b>'); out.style.top = (H * .28 + 96) + 'px'; out.style.fontSize = '14px';
      await anim(out, [{ opacity: 0, transform: 'translateX(-50%) scale(1.6)' }, { opacity: 1, transform: 'translateX(-50%) scale(1)' }], { duration: 260 });
      await wait(250);
      fx.querySelectorAll('.panel, svg').forEach((n) => anim(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 250 }));
      await anim(card, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(180deg)' }], { duration: 750 });
    } },
  { k: 'toss', t: 'The toss', d: 'The card is flicked up like the coin at the toss, spins end over end in the air, and lands stats-side up. A little shadow on the turf sells the height.', ms: 1700,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const sh = el(fx, ''); sh.style.cssText = `position:absolute;left:${W / 2 - 70}px;top:${H - 34}px;width:140px;height:16px;border-radius:50%;background:rgba(0,0,0,.28);filter:blur(4px)`;
      anim(sh, [{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(.45)', opacity: .35, offset: .45 }, { transform: 'scale(1)', opacity: .9 }], { duration: 1300, easing: 'ease-in-out' });
      await anim(card, [{ transform: 'translateY(0) rotateX(0) rotateY(0)' }, { transform: 'translateY(-150px) rotateX(720deg) rotateY(90deg)', offset: .45, easing: 'cubic-bezier(.2,.6,.4,1)' }, { transform: 'translateY(0) rotateX(1440deg) rotateY(180deg)', offset: .9, easing: 'cubic-bezier(.6,0,.8,.4)' }, { transform: 'translateY(-8px) rotateX(1440deg) rotateY(180deg)', offset: .95 }, { transform: 'translateY(0) rotateX(1440deg) rotateY(180deg)' }], { duration: 1300, easing: 'linear' });
      sh.remove();
    } },
  { k: 'six', t: 'Into the stands', d: 'A bat swings through the bottom corner, the ball sails off in a long arc with a trail, a big SIX pops up, and the card turns as if following the ball.', ms: 2000,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const bat = el(fx, ''); bat.style.cssText = `position:absolute;left:${W * .18}px;top:${H - 120}px;width:14px;height:96px;border-radius:4px 4px 7px 7px;background:linear-gradient(90deg,#D9B27A,#B98B54);transform-origin:50% 8px;box-shadow:inset -3px 0 0 rgba(0,0,0,.15)`;
      el(bat, '').style.cssText = 'position:absolute;left:4px;top:-26px;width:6px;height:30px;border-radius:3px;background:#2B2B2B';
      const ball = el(fx, 'ball'); ball.style.transform = `translate(${W * .22}px, ${H - 40}px)`;
      await anim(bat, [{ transform: 'rotate(70deg)' }, { transform: 'rotate(-80deg)' }], { duration: 260, easing: 'cubic-bezier(.6,0,.3,1)' });
      const pts = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return { transform: `translate(${W * .22 + t * W * .85}px, ${H - 40 - Math.sin(t * Math.PI) * H * .95 + t * 30}px) rotate(${t * 900}deg)` }; });
      const trail = setInterval(() => { const tr = el(fx, ''); const b = ball.getBoundingClientRect(), f = fx.getBoundingClientRect(); tr.style.cssText = `position:absolute;left:${b.left - f.left + 4}px;top:${b.top - f.top + 4}px;width:6px;height:6px;border-radius:50%;background:rgba(255,120,100,.6)`; anim(tr, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.3)' }], { duration: 500 }).then(() => tr.remove()); }, 30);
      const flight = anim(ball, pts, { duration: 900, easing: 'linear' });
      await wait(250);
      const six = el(fx, 'stamp', '6'); six.style.fontSize = '120px'; six.style.color = '#F7D774';
      anim(six, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1.1)', offset: .6 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.3)' }], { duration: 900 });
      await anim(card, [{ transform: 'rotateY(0) rotateZ(0) translateX(0)' }, { transform: 'rotateY(100deg) rotateZ(-6deg) translateX(18px) translateY(-12px)', offset: .5 }, { transform: 'rotateY(180deg) rotateZ(0) translateX(0)' }], { duration: 800 });
      await flight; clearInterval(trail); bat.remove(); ball.remove(); six.remove();
    } },
  { k: 'spin', t: 'Leg-spinner', d: 'The card is tossed up like a leg-break: it drifts in, dips, then rips sideways off the pitch and turns over. A spinning ball with an angled seam leads it in.', ms: 1700,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const ball = el(fx, 'ball'); ball.style.width = ball.style.height = '18px';
      anim(ball, [{ transform: `translate(${W * .1}px, 0) rotate(0)` }, { transform: `translate(${W * .3}px, ${H * .5}px) rotate(720deg)`, offset: .55 }, { transform: `translate(${W * .85}px, ${H * .62}px) rotate(1400deg)` }], { duration: 900, easing: 'cubic-bezier(.4,0,.6,1)' }).then(() => ball.remove());
      await anim(card, [{ transform: 'translate(0,0) rotateZ(0) rotateY(0)' }, { transform: 'translate(-26px,-22px) rotateZ(-7deg) rotateY(-10deg)', offset: .3 }, { transform: 'translate(-10px,16px) rotateZ(-2deg) rotateY(10deg)', offset: .55 },
        { transform: 'translate(24px,4px) rotateZ(8deg) rotateY(150deg)', offset: .8 }, { transform: 'translate(0,0) rotateZ(0) rotateY(180deg)' }], { duration: 1300, easing: 'cubic-bezier(.45,.05,.4,1)' });
    } },
  { k: 'flaps', t: 'Scoreboard flaps', d: 'The pavilion scoreboard takes over: green flaps clatter down over the card one row at a time, the card turns behind them, and the flaps fold away to show the stats.', ms: 1900,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const top = 40, h = H - 70, n = 9, sh = h / n, strips = [];
      for (let i = 0; i < n; i++) { const s = el(fx, 'strip'); s.style.top = (top + i * sh) + 'px'; s.style.height = (sh + 1) + 'px'; s.style.borderRadius = i === 0 ? '18px 18px 0 0' : i === n - 1 ? '0 0 18px 18px' : '0'; strips.push(s); }
      await Promise.all(strips.map((s, i) => anim(s, [{ transform: 'perspective(400px) rotateX(-90deg)' }, { transform: 'perspective(400px) rotateX(0)' }], { duration: 260, delay: i * 55 })));
      await settle(card, true);
      await wait(120);
      await Promise.all(strips.map((s, i) => anim(s, [{ transform: 'perspective(400px) rotateX(0)' }, { transform: 'perspective(400px) rotateX(90deg)' }], { duration: 260, delay: i * 55 })));
      strips.forEach((s) => s.remove());
      return 'done';
    } },
  { k: 'snicko', t: 'Snicko edge', d: 'The edge-detector trace runs across the card, flat, flat, then a sharp spike as the ball takes the edge. The card is flicked away by the nick and comes back stats-side.', ms: 1800,
    run: async (card, stage) => {
      const { fx, W, H } = dims(stage);
      const y = H * .48, pts = [];
      for (let x = 0; x <= W - 80; x += 6) { const c = x - (W - 80) * .55; const amp = Math.abs(c) < 22 ? (22 - Math.abs(c)) * 3.4 * (x % 12 ? 1 : -1) : (Math.random() - .5) * 4; pts.push(`${x + 40},${y + amp}`); }
      const svg = el(fx, '', `<svg width="${W}" height="${H}" style="position:absolute;inset:0"><rect x="34" y="${y - 54}" width="${W - 68}" height="108" rx="8" fill="rgba(6,10,20,.82)" stroke="rgba(111,243,255,.35)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#6FF3FF" stroke-width="2" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/><text x="44" y="${y - 38}" fill="#9FB0D8" font-family="IBM Plex Mono, monospace" font-size="9" letter-spacing="1.5">SNICKO</text></svg>`);
      await anim(svg.querySelector('polyline'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, easing: 'linear' });
      const edge = el(fx, 'pc-panel out', 'EDGE<b>DETECTED</b>'); edge.style.top = (y + 62) + 'px';
      anim(edge, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
      await anim(card, [{ transform: 'rotateY(0) rotateZ(0)' }, { transform: 'rotateY(-25deg) rotateZ(-5deg) translateX(-10px)', offset: .15 }, { transform: 'rotateY(200deg) rotateZ(3deg)', offset: .75 }, { transform: 'rotateY(180deg) rotateZ(0)' }], { duration: 850 });
      await anim(svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }); edge.remove(); svg.remove();
    } },
];



// Batter reveal: the ball is bowled in, the bat swings through and meets it, the ball flies off and the card turns with it.
OPTIONS.find((o) => o.k === 'six').run = async (card, stage) => {
  const { fx, W, H } = dims(stage);
  const bx = W * .2, by = H - 128;
  const bat = el(fx, ''); bat.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:15px;height:98px;border-radius:4px 4px 8px 8px;background:linear-gradient(90deg,#E4C08A,#B98B54);transform-origin:50% 6px;box-shadow:inset -3px 0 0 rgba(0,0,0,.15);transform:rotate(75deg)`;
  el(bat, '').style.cssText = 'position:absolute;left:4.5px;top:-28px;width:6px;height:32px;border-radius:3px;background:#2B2A22';
  const ball = el(fx, 'ball');
  const hitX = bx + 30, hitY = H - 52;
  await anim(ball, [{ transform: `translate(${W + 10}px, ${H * .5}px) rotate(0)` }, { transform: `translate(${W * .55}px, ${H - 30}px) rotate(300deg)`, offset: .6 }, { transform: `translate(${hitX}px, ${hitY}px) rotate(480deg)` }], { duration: 520, easing: 'linear' });
  await anim(bat, [{ transform: 'rotate(75deg)' }, { transform: 'rotate(-70deg)' }], { duration: 170, easing: 'cubic-bezier(.7,0,.3,1)' });
  const pts = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return { transform: `translate(${hitX + t * W * .9}px, ${hitY - Math.sin(t * Math.PI * .85) * H * .9}px) rotate(${480 + t * 900}deg)`, opacity: t > .85 ? 1 - (t - .85) / .15 : 1 }; });
  const flight = anim(ball, pts, { duration: 800, easing: 'cubic-bezier(.2,.6,.4,1)' });
  anim(bat, [{ transform: 'rotate(-70deg)' }, { transform: 'rotate(-40deg)' }], { duration: 400 });
  await anim(card, [{ transform: 'rotateY(0) rotateZ(0)' }, { transform: 'rotateY(-10deg) translateY(4px)', offset: .12 }, { transform: 'rotateY(110deg) rotateZ(-4deg) translateX(14px) translateY(-10px)', offset: .55 }, { transform: 'rotateY(180deg) rotateZ(0)' }], { duration: 850 });
  await flight; bat.remove(); ball.remove();
};

const reduce = typeof matchMedia !== "undefined" && matchMedia('(prefers-reduced-motion: reduce)').matches;
function revealFor(p) {
  if (p.role === 'bat') return 'six';
  if (p.role === 'bowl') return 'bowled';
  const all = OPTIONS.map((o) => o.k); return all[Math.floor(Math.random() * all.length)];
}
export function mountCard(stage, p, startBack = false) {
  stage.innerHTML = `<div class="fx"></div><div class="pc-card${startBack ? ' on-back' : ''}" tabindex="0" role="button" aria-label="${esc(p.name)} card. Press to turn over">${cardHtml(p)}</div>`;
  const card = stage.querySelector('.pc-card'), front = card.querySelector('.front');
  if (startBack) card.style.transform = 'rotateY(180deg)';
  card.querySelectorAll('.pc-tabs button').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    card.querySelectorAll('.pc-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    card.querySelectorAll('.pane').forEach((x) => { x.hidden = x.dataset.pane !== b.dataset.t; });
  }));
  card.querySelectorAll('.pane[data-pane="bowl"]').forEach((x) => { if (p.role === 'all') x.hidden = true; });
  // Show only the face turned towards the viewer. Safari on iPhone does not always honour backface-visibility,
  // so the face is picked from the card's real angle: the z part of its transform tells which side faces us.
  const backEl = card.querySelector('.back');
  const syncFaces = () => {
    const t = getComputedStyle(card).transform;
    let showBack = false;
    if (t && t !== 'none') { try { showBack = new DOMMatrix(t).m33 < 0; } catch { showBack = card.classList.contains('on-back'); } }
    front.style.visibility = showBack ? 'hidden' : 'visible';
    backEl.style.visibility = showBack ? 'visible' : 'hidden';
  };
  let raf = 0;
  const watch = () => { syncFaces(); raf = requestAnimationFrame(watch); };
  const stopWatch = () => { cancelAnimationFrame(raf); syncFaces(); };
  syncFaces();
  let busy = false;
  const back = () => card.classList.contains('on-back');
  stage.reveal = async (k) => {
    if (busy) return; busy = true; watch();
    await settle(card, false);
    if (reduce) { await anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }); await settle(card, true); card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); busy = false; stopWatch(); return; }
    const o = OPTIONS.find((x) => x.k === (k || revealFor(p)));
    await o.run(card, stage); await settle(card, true); stage.querySelector('.fx').innerHTML = ''; busy = false; stopWatch();
  };
  const toggle = async () => { if (busy) return; if (back()) { busy = true; watch(); await anim(card, [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(360deg)' }], { duration: 600 }); await settle(card, false); busy = false; stopWatch(); } else stage.reveal(); };
  card.addEventListener('click', toggle);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  card.addEventListener('pointermove', (e) => { if (busy || back()) return; const b = card.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
    card.style.transform = `rotateY(${x * 12}deg) rotateX(${-y * 12}deg)`; front.style.setProperty('--hx', String(Math.round((x + .5) * 360))); front.style.setProperty('--holo', '.7'); });
  card.addEventListener('pointerleave', () => { if (!busy && !back()) card.style.transform = 'none'; front.style.setProperty('--holo', '.3'); });
}


export { rating };
