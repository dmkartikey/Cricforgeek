// mirrors web/src/components/GettyPhoto.tsx
window.gie = window.gie || function (c) { (window.gie.q = window.gie.q || []).push(c); };
const s = document.createElement('script'); s.src = 'https://embed-cdn.gettyimages.com/widgets.js'; s.async = true; document.head.appendChild(s);
function slot(box, id, sig, item, w, h) {
  const a = document.createElement('a'); a.id = id; a.className = 'gie-single'; a.href = 'https://www.gettyimages.com/detail/' + item; a.textContent = 'Embed from Getty Images';
  document.getElementById(box).appendChild(a);
  window.gie(function () { window.gie.widgets.load({ id: id, sig: sig, w: w + 'px', h: h + 'px', items: item, caption: false, tld: 'com', is360: false }); });
}
slot('a', 'c3M8KgJzQt53IOOYOcWPmw', 'iYuykixLlvAr02-FAwybhBf9RWLnabvM5L4JSTsNj5E=', '2287092991', 168, 150);
