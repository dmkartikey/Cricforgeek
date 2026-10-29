// Draws a player card as a 1080 × 1350 PNG for sharing: photo, name, rating and the key numbers.
// Plain canvas drawing, so it needs no extra library. The photo is same-origin, so the canvas stays exportable.
import type { CardData } from './card';

const tierOf = (r: number) => (r >= 90 ? 'LEGEND' : r >= 80 ? 'ELITE' : r >= 70 ? 'GOLD' : 'SILVER');
const segColor = (v: number) => (v >= 90 ? '#E2B64A' : v >= 70 ? '#8FE0B0' : v >= 40 ? '#C9D7C2' : '#FF9C8F');

function loadImg(src: string) {
  return new Promise<HTMLImageElement | null>((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function fit(c: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 800) {
  let s = size;
  do { c.font = `${weight} ${s}px Inter, system-ui, sans-serif`; s -= 2; } while (c.measureText(text).width > max && s > 20);
}

export async function cardPng(card: CardData): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  if (!c) return null;
  try { await (document as any).fonts?.ready; } catch { /* fonts are optional */ }
  // background: pavilion green with floodlight glow
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0E3B2E'); g.addColorStop(1, '#06231B');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (const [x, col] of [[160, 'rgba(226,182,74,.20)'], [920, 'rgba(143,224,176,.16)']] as const) {
    const lg = c.createRadialGradient(x, 60, 10, x, 60, 700);
    lg.addColorStop(0, col); lg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = lg; c.fillRect(0, 0, W, H);
  }
  // card frame
  rr(c, 60, 60, W - 120, H - 120, 48);
  c.strokeStyle = 'rgba(226,182,74,.55)'; c.lineWidth = 4; c.stroke();
  // photo
  const im = card.photo ? await loadImg(card.photo) : null;
  if (im) {
    const ph = 640, pw = (im.width / im.height) * ph;
    c.save(); rr(c, 64, 64, W - 128, 700, 46); c.clip();
    const halo = c.createRadialGradient(W / 2, 470, 40, W / 2, 470, 420);
    halo.addColorStop(0, 'rgba(143,224,176,.30)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = halo; c.fillRect(0, 0, W, 760);
    c.drawImage(im, (W - pw) / 2, 764 - ph, pw, ph);
    // fade the bottom of the photo into the card
    const fade = c.createLinearGradient(0, 600, 0, 766);
    fade.addColorStop(0, 'rgba(10,47,36,0)'); fade.addColorStop(1, 'rgba(10,47,36,1)');
    c.fillStyle = fade; c.fillRect(0, 600, W, 166);
    c.restore();
  } else {
    // no photo: the player's initials in a big team-coloured circle, as on the card
    c.save();
    c.beginPath(); c.arc(W / 2, 470, 230, 0, Math.PI * 2); c.fillStyle = card.colour; c.fill();
    c.lineWidth = 10; c.strokeStyle = 'rgba(226,182,74,.55)'; c.stroke();
    c.fillStyle = '#FFFFFF'; c.font = '800 200px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(card.initials, W / 2, 480);
    c.restore();
  }
  // tier and rating
  const tier = tierOf(card.rating);
  c.fillStyle = tier === 'LEGEND' || tier === 'GOLD' ? '#E2B64A' : '#D9CDA8';
  rr(c, 110, 110, 330, 64, 32); c.fill();
  c.fillStyle = '#0B2A20'; c.font = '800 28px Inter, system-ui, sans-serif'; c.textBaseline = 'middle';
  c.fillText(`${tier} · ${card.fmt.toUpperCase()}`.slice(0, 22), 134, 143);
  c.fillStyle = '#F6F1E1'; c.textAlign = 'right'; c.font = '900 150px Inter, system-ui, sans-serif'; c.textBaseline = 'alphabetic';
  c.fillText(String(card.rating), W - 110, 250);
  c.font = '700 26px Inter, system-ui, sans-serif'; c.fillStyle = 'rgba(246,241,225,.7)'; c.fillText('RATING', W - 112, 290);
  c.textAlign = 'left';
  // name band
  const by = 800;
  c.fillStyle = '#F6F1E1'; fit(c, card.name, W - 220, 92);
  c.fillText(card.name, 110, by + 40);
  c.font = '600 32px Inter, system-ui, sans-serif'; c.fillStyle = '#8FE0B0';
  c.fillText(`${card.team}  ·  ${card.roleText}  ·  ${card.span}`, 110, by + 96);
  // trio
  const tw = (W - 220) / 3;
  card.trio.forEach(([l, v], i) => {
    const x = 110 + i * tw;
    rr(c, x, by + 130, tw - 20, 150, 24); c.fillStyle = 'rgba(255,255,255,.06)'; c.fill();
    c.fillStyle = 'rgba(246,241,225,.65)'; c.font = '700 24px Inter, system-ui, sans-serif'; c.fillText(l.toUpperCase(), x + 26, by + 176);
    c.fillStyle = '#F6F1E1'; c.font = '800 64px Inter, system-ui, sans-serif'; c.fillText(v, x + 26, by + 250);
  });
  // meters (main discipline)
  const pane = card.role === 'bowl' ? card.bowl : card.bat;
  const meters = (pane?.meters ?? []).slice(0, 3);
  meters.forEach(([l, v, pc], i) => {
    const y = by + 322 + i * 40;
    c.fillStyle = 'rgba(246,241,225,.8)'; c.font = '600 24px Inter, system-ui, sans-serif'; c.fillText(`${l}  ${v}`, 110, y);
    for (let k = 0; k < 10; k++) {
      rr(c, 520 + k * 38, y - 20, 30, 18, 5);
      c.fillStyle = k < Math.round(pc / 10) ? segColor(pc) : 'rgba(255,255,255,.12)'; c.fill();
    }
    c.fillStyle = '#F6F1E1'; c.font = '800 24px Inter, system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(String(pc), W - 110, y); c.textAlign = 'left';
  });
  c.fillStyle = '#E2B64A'; c.font = '800 26px Inter, system-ui, sans-serif';
  c.fillText('cricforgeek.site', 110, H - 108);
  c.fillStyle = 'rgba(246,241,225,.55)'; c.font = '500 19px Inter, system-ui, sans-serif';
  let credit = `Meters are percentiles among qualified players. ${card.credit}`;
  while (c.measureText(credit).width > W - 220 && credit.length > 20) credit = credit.slice(0, -2);
  if (credit.length < `Meters are percentiles among qualified players. ${card.credit}`.length) credit = credit.trimEnd() + '…';
  c.fillText(credit, 110, H - 80);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}

/** Share the PNG where the browser can, otherwise download it. */
export async function shareCard(card: CardData) {
  const blob = await cardPng(card);
  if (!blob) return 'failed';
  const file = new File([blob], `${card.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-cricforgeek.png`, { type: 'image/png' });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: `${card.name} · cricforgeek`, text: `${card.name}: ${card.rating} rating (${card.fmt})` }); return 'shared'; } catch { return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
