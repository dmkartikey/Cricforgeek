// Writes a real HTML page for every route so search engines can read the site without running JavaScript.
// Each page gets its own <title>, description, canonical URL, social tags, structured data and a short
// readable summary with links. The React app replaces the summary as soon as it loads.
// Also writes sitemaps, robots.txt and 404.html.
// Usage: node scripts/prerender.mjs [distDir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (process.env.VITE_PREVIEW === '1') { console.log('preview build: skipping prerender'); process.exit(0); }
const dist = process.argv[2] ?? join(here, '..', 'dist');
const data = join(dist, 'data');
const cname = existsSync(join(here, '..', 'public', 'CNAME')) ? readFileSync(join(here, '..', 'public', 'CNAME'), 'utf8').trim() : 'cricforgeek.site';
const SITE = `https://${cname}`;
if (!existsSync(join(data, 'meta.json'))) { console.log('no data in dist/data: skipping prerender'); process.exit(0); }
const template = readFileSync(join(dist, 'index.html'), 'utf8');
const J = (p) => JSON.parse(readFileSync(join(data, p), 'utf8'));
const has = (p) => existsSync(join(data, p));

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-GB') : '–');
const d1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const d2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
const FMT = { TEST: 'Test', FC: 'first-class', ODI: 'ODI', LA: 'List A', T20: 'T20', HUN: 'Hundred' };
const G = { male: 'men', female: 'women' };
const dateLong = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');
const clip = (s, n = 158) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

let pages = 0, bytes = 0;
const urls = { pages: [], players: [], teams: [], comps: [], matches: [] };

function page(path, { title, desc, body, ld, noindex, type = 'website', group = 'pages', lastmod }) {
  const url = SITE + (path === '/' ? '/' : path);
  const fullTitle = path === '/' ? title : `${title} · cricforgeek`;
  const head = [
    `<title>${esc(fullTitle)}</title>`,
    `<meta name="description" content="${esc(clip(desc))}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    noindex ? '<meta name="robots" content="noindex, follow" />' : '<meta name="robots" content="index, follow, max-image-preview:large" />',
    `<meta property="og:site_name" content="cricforgeek" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(clip(desc, 200))}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(clip(desc, 200))}" />`,
    ...(ld ? [`<script type="application/ld+json">${ldJson(ld)}</script>`] : []),
  ].join('\n    ');
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><div class="ssr">${NAV}${body}</div></div>`);
  html = html.replace(/\n\s+/g, '\n');
  const file = path === '/' ? 'index.html' : `${path.slice(1)}.html`;
  mkdirSync(dirname(join(dist, file)), { recursive: true });
  writeFileSync(join(dist, file), html);
  pages++; bytes += html.length;
  if (!noindex) urls[group].push([url, lastmod]);
}

const NAV = `<nav class="ssr-nav"><a href="/">cricforgeek</a> · <a href="/players">Players</a> · <a href="/teams">Teams</a> · <a href="/competitions">Competitions</a> · <a href="/matches">Matches</a> · <a href="/predictor">Situation predictor</a> · <a href="/compare">Compare</a> · <a href="/explore">Explorer</a> · <a href="/methodology">Methodology</a></nav>`;
const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + path })) });
const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const linkList = (items) => `<ul>${items.map(([href, text]) => `<li><a href="${esc(href)}">${esc(text)}</a></li>`).join('')}</ul>`;
const teamKey = (team, gender) => team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + (gender === 'female' ? '-women' : '');

// ---------- shared data ----------
const meta = J('meta.json');
const search = J('search.json');
const compIdx = has('comps/index.json') ? J('comps/index.json') : meta.comps;
const compLabel = Object.fromEntries(compIdx.map((c) => [c.key, c.label]));
const teamIdx = has('teams/index.json') ? J('teams/index.json') : [];
const dataTo = meta.data_to;

// ---------- section pages ----------
const topPlayers = [...search.players].sort((a, b) => b[7] - a[7]).slice(0, 60);
page('/', {
  title: 'cricforgeek: ball-by-ball cricket stats for geeks',
  desc: `Deep cricket stats for Tests, ODIs, T20s, first-class and leagues: impact, win probability, pitch maps, full scorecards and a match situation predictor. ${n0(meta.counts.matches)} matches, ${n0(meta.counts.balls)} balls.`,
  ld: { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', name: 'cricforgeek', url: SITE + '/', potentialAction: { '@type': 'SearchAction', target: `${SITE}/players?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    { '@type': 'Dataset', name: 'cricforgeek ball-by-ball cricket statistics', description: 'Player, team and match statistics derived from Cricsheet ball-by-ball data.', url: SITE + '/',
      license: 'https://opendatacommons.org/licenses/by/1-0/', isBasedOn: 'https://cricsheet.org', dateModified: dataTo },
  ] },
  body: `<h1>Ball-by-ball cricket stats for geeks</h1><p>Impact, win probability, inferred pitch maps, full scorecards and a match situation predictor for ${n0(meta.counts.matches)} matches and ${n0(meta.counts.players)} players, updated every night from Cricsheet. Data to ${esc(dateLong(dataTo))}.</p><h2>Most-capped players</h2>${linkList(topPlayers.slice(0, 30).map((p) => [`/player/${p[0]}`, `${p[1]} (${p[4]})`]))}`,
});
page('/players', { title: 'Cricket players: stats for every player', desc: `Stats for ${n0(search.players.length)} cricketers with ball-by-ball records: runs, averages, strike rates, wickets, economy, impact and pitch maps.`,
  body: `<h1>Players</h1><p>Every cricketer with ball-by-ball records, sorted by matches played.</p>${linkList(topPlayers.map((p) => [`/player/${p[0]}`, `${p[1]}, ${p[4]}, ${p[5]}–${p[6]}`]))}` });
page('/teams', { title: 'Cricket teams: records and stats', desc: `Records for ${n0(teamIdx.length)} international and domestic cricket teams: results by season, head to head, leaders and team records.`,
  body: `<h1>Teams</h1>${linkList(teamIdx.slice(0, 200).map((t) => [`/team/${t[0]}`, t[1] + (t[2] === 'female' ? ' (women)' : '')]))}` });
page('/competitions', { title: 'Cricket competitions and leagues', desc: `Every competition with ball-by-ball records: Tests, ODIs, T20 internationals, the IPL, BBL, county cricket, Ranji Trophy and more. ${compIdx.length} competitions.`,
  body: `<h1>Competitions</h1>${linkList(compIdx.map((c) => [`/league/${c.key}`, `${c.label} (${c.from?.slice(0, 4)}–${c.to?.slice(0, 4)})`]))}` });
page('/matches', { title: 'Cricket match scorecards', desc: 'Full ball-by-ball scorecards with fall of wickets, partnerships, worm, win probability and turning points for every recorded match.',
  body: '<h1>Matches</h1><p>Full scorecards for every recorded match.</p>' });
page('/predictor', { title: 'Cricket situation predictor: who will win from here?',
  desc: 'Enter any match situation and see each side\'s chance of winning, the projected total and the most likely finish, simulated ball by ball from every recorded match. T20, ODI and Test.',
  ld: { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'cricforgeek situation predictor', applicationCategory: 'SportsApplication', operatingSystem: 'Any', url: SITE + '/predictor', offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' } },
  body: '<h1>Situation predictor</h1><p>Enter the score, wickets, overs, target, teams, ground and players. The predictor plays out the rest of the match thousands of times using how real matches went from the same situation, and shows win chances, the projected total, batter milestones and what could change the result.</p>' });
page('/compare', { title: 'Compare cricket players side by side', desc: 'Compare up to four cricketers: averages, strike rates, impact, year-by-year form, phase splits, pace v spin and pitch maps, over whole careers or the same years.',
  body: '<h1>Compare players</h1><p>Pick up to four players to compare on the same charts.</p>' });
page('/explore', { title: 'Cricket stats explorer and query builder', desc: 'Filter cricket stats by format, competition, years and minimum balls, sort by any metric and download CSV.', body: '<h1>Explorer</h1>' });
page('/methodology', { title: 'How cricforgeek works: models and methods', desc: 'How the impact, win probability, pitch-zone and situation-predictor models are built, and how accurate they are.', body: '<h1>Methodology</h1>' });
page('/pinboard', { title: 'My pinboard', desc: 'Your saved cricforgeek charts and leaderboards.', body: '<h1>My pinboard</h1>', noindex: true });

// ---------- players ----------
const fkLabel = (fk) => { const [f, g] = fk.split('-'); return `${G[g] === 'women' ? "women's " : ''}${FMT[f] ?? f}`; };
for (const f of readdirSync(join(data, 'players'))) {
  if (!f.endsWith('.json')) continue;
  const p = J(`players/${f}`);
  const fks = Object.entries(p.summary ?? {}).sort((a, b) => ((b[1].bat?.b ?? 0) + (b[1].bowl?.b ?? 0)) - ((a[1].bat?.b ?? 0) + (a[1].bowl?.b ?? 0)));
  if (!fks.length) continue;
  const bits = [], rows = [];
  for (const [fk, s] of fks) {
    const b = s.bat ?? {}, w = s.bowl ?? {};
    const avg = b.o ? b.r / b.o : NaN, sr = b.b ? (100 * b.r) / b.b : NaN, econ = w.b ? (6 * w.r) / w.b : NaN, bavg = w.w ? w.r / w.w : NaN;
    if ((b.b ?? 0) >= 60) bits.push(`${n0(b.r)} ${fkLabel(fk)} runs at ${d1(avg)}${fk.startsWith('TEST') || fk.startsWith('FC') ? '' : ` (SR ${d1(sr)})`}`);
    if ((w.w ?? 0) >= 5) bits.push(`${n0(w.w)} ${fkLabel(fk)} wickets at ${d1(bavg)}`);
    rows.push([esc(fkLabel(fk)), n0(b.i), n0(b.r), d2(avg), d1(sr), `${b.c100 ?? 0}/${b.c50 ?? 0}`, n0(w.w), d2(bavg), d2(econ), esc(w.best ?? '–')]);
  }
  const teams = (p.teams ?? []).slice(0, 6);
  const role = [p.bat === 'lhb' ? 'Left-hand bat' : p.bat === 'rhb' ? 'Right-hand bat' : '', p.bowl ? `${p.bowl.toUpperCase()} bowler` : ''].filter(Boolean).join(', ');
  const desc = `${p.name}${p.full && p.full !== p.name ? ` (${p.full})` : ''} cricket stats${teams.length ? `, ${teams.slice(0, 2).map((t) => t[0]).join(' and ')}` : ''}: ${bits.slice(0, 3).join('; ') || 'career record'}. Splits, form and pitch maps.`;
  page(`/player/${p.id}`, {
    title: `${p.name} stats`, desc, type: 'profile', group: 'players', lastmod: dataTo,
    ld: { '@context': 'https://schema.org', '@graph': [
      { '@type': 'Person', name: p.full || p.name, alternateName: p.full && p.full !== p.name ? p.name : undefined, url: `${SITE}/player/${p.id}`,
        affiliation: teams.map((t) => ({ '@type': 'SportsTeam', name: t[0], sport: 'Cricket', url: `${SITE}/team/${teamKey(t[0], t[1])}` })) },
      crumbs([['Players', '/players'], [p.name, `/player/${p.id}`]]) ] },
    body: `<h1>${esc(p.name)}</h1><p>${esc(p.full && p.full !== p.name ? p.full + '. ' : '')}${esc(role)}${role ? '. ' : ''}${esc(bits.join('; '))}.</p>`
      + table(['Format', 'Inns', 'Runs', 'Avg', 'SR', '100/50', 'Wkts', 'Bowl avg', 'Econ', 'Best'], rows)
      + (teams.length ? `<h2>Teams</h2>${linkList(teams.map((t) => [`/team/${teamKey(t[0], t[1])}`, `${t[0]} (${t[2]}–${t[3]})`]))}` : ''),
  });
}

// ---------- teams ----------
for (const f of readdirSync(join(data, 'teams'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  const t = J(`teams/${f}`);
  const fams = Object.entries(t.fams ?? {}).sort((a, b) => b[1].p - a[1].p);
  if (!fams.length) continue;
  const g = t.gender === 'female' ? "women's" : "men's";
  const desc = `${t.name} ${g} cricket team stats: ${fams.map(([k, v]) => `${n0(v.p)} ${FMT[k] ?? k} matches (${n0(v.w)} won)`).join(', ')}. Results by season, head to head, leaders and records.`;
  const leaders = Object.values(t.top_bat ?? {}).flat().slice(0, 12);
  page(`/team/${t.key}`, {
    title: `${t.name}${t.gender === 'female' ? ' (women)' : ''} cricket team stats`, desc, group: 'teams', lastmod: dataTo,
    ld: { '@context': 'https://schema.org', '@graph': [{ '@type': 'SportsTeam', name: t.name, sport: 'Cricket', url: `${SITE}/team/${t.key}` },
      crumbs([['Teams', '/teams'], [t.name, `/team/${t.key}`]])] },
    body: `<h1>${esc(t.name)}${t.gender === 'female' ? ' women' : ''}</h1><p>${esc(desc)}</p>`
      + table(['Format', 'Played', 'Won', 'Bat first won', 'Chasing won'], fams.map(([k, v]) => [esc(FMT[k] ?? k), n0(v.p), n0(v.w), `${v.bf_w}/${v.bf_p}`, `${v.ch_w}/${v.ch_p}`]))
      + `<h2>Competitions</h2>${linkList((t.comps ?? []).slice(0, 12).map((c) => [`/league/${c[0]}`, `${c[1]}: ${c[2]} played, ${c[3]} won`]))}`
      + (leaders.length ? `<h2>Leading batters</h2>${linkList(leaders.map((x) => [`/player/${x[0]}`, `${x[1]}: ${n0(x[2])} runs`]))}` : ''),
  });
}

// ---------- competitions ----------
for (const c of compIdx) {
  if (!has(`comps/${c.key}.json`)) continue;
  const x = J(`comps/${c.key}.json`);
  const seasons = Object.keys(x.standings ?? {}).sort().reverse();
  const latest = seasons[0] ? x.standings[seasons[0]] : [];
  const desc = `${c.label} stats and records${c.from ? `, ${c.from.slice(0, 4)}–${c.to.slice(0, 4)}` : ''}: ${n0(c.matches)} matches with ball-by-ball data. Tables, leaders by season, venues, records and every scorecard.`;
  page(`/league/${c.key}`, {
    title: `${c.label} stats and records`, desc, group: 'comps', lastmod: c.to,
    ld: { '@context': 'https://schema.org', '@graph': [{ '@type': 'SportsOrganization', name: c.label, sport: 'Cricket', url: `${SITE}/league/${c.key}` },
      crumbs([['Competitions', '/competitions'], [c.label, `/league/${c.key}`]])] },
    body: `<h1>${esc(c.label)}</h1><p>${esc(desc)}</p>`
      + (latest?.length ? `<h2>${esc(seasons[0])} table</h2>` + table(['Team', 'P', 'W', 'L'], latest.slice().sort((a, b) => b[2] - a[2]).map((r) => [`<a href="/team/${esc(teamKey(r[0], c.gender))}">${esc(r[0])}</a>`, n0(r[1]), n0(r[2]), n0(r[3])])) : ''),
  });
}

// ---------- matches ----------
const resultText = (i) => (i.winner ? `${i.winner} won${i.by_runs ? ` by ${i.by_runs} run${i.by_runs === 1 ? '' : 's'}` : i.by_wkts ? ` by ${i.by_wkts} wicket${i.by_wkts === 1 ? '' : 's'}` : ''}${i.method ? ` (${i.method})` : ''}`
  : i.result === 'draw' ? 'Match drawn' : i.result === 'tie' ? 'Match tied' : 'No result');
const overs = (b) => `${Math.floor(b / 6)}${b % 6 ? '.' + (b % 6) : ''}`;
for (const f of readdirSync(join(data, 'matches'))) {
  if (!f.endsWith('.json') || f.startsWith('index')) continue;
  const m = J(`matches/${f}`);
  const i = m.info;
  const nm = (id) => m.names?.[id] ?? id;
  const inns = Object.entries(m.extras ?? {}).sort((a, b) => +a[0] - +b[0]);
  const team = (k) => m.bat.find((b) => b[0] === +k)?.[10] ?? (+k % 2 ? i.team1 : i.team2);
  const scores = inns.map(([k, e]) => `${team(k)} ${e[4]}${e[6] < 10 ? '/' + e[6] : ''} (${overs(e[5])} ov)`);
  const res = resultText(i);
  const title = `${i.team1} v ${i.team2}, ${m.comp_label ?? ''} ${i.season ?? ''}`.replace(/\s+/g, ' ').trim();
  const desc = `${i.team1} v ${i.team2}, ${m.comp_label ?? ''}, ${dateLong(i.date)}${i.venue ? ` at ${i.venue}` : ''}. ${scores.join(', ')}. ${res}. Full scorecard, worm and win probability.`;
  const top = [...m.bat].sort((a, b) => b[2] - a[2]).slice(0, 4).map((b) => [`/player/${b[1]}`, `${nm(b[1])} ${b[2]} (${b[3]})`]);
  const topw = [...m.bowl].sort((a, b) => b[4] - a[4] || a[3] - b[3]).slice(0, 3).map((b) => [`/player/${b[1]}`, `${nm(b[1])} ${b[4]}/${b[3]}`]);
  page(`/match/${i.match_id}`, {
    title, desc, group: 'matches', lastmod: i.date,
    ld: { '@context': 'https://schema.org', '@graph': [{
      '@type': 'SportsEvent', name: `${i.team1} v ${i.team2}`, sport: 'Cricket', startDate: i.date, url: `${SITE}/match/${i.match_id}`,
      location: i.venue ? { '@type': 'Place', name: i.venue, address: i.city ?? undefined } : undefined,
      competitor: [i.team1, i.team2].map((t) => ({ '@type': 'SportsTeam', name: t, url: `${SITE}/team/${i[t === i.team1 ? 'team1_key' : 'team2_key'] ?? teamKey(t, i.gender)}` })),
      superEvent: m.comp_label ? { '@type': 'SportsEvent', name: m.comp_label, url: `${SITE}/league/${i.comp}` } : undefined,
    }, crumbs([['Matches', '/matches'], [m.comp_label ?? 'Match', `/league/${i.comp}`], [`${i.team1} v ${i.team2}`, `/match/${i.match_id}`]])] },
    body: `<h1>${esc(i.team1)} v ${esc(i.team2)}</h1><p><a href="/league/${esc(i.comp)}">${esc(m.comp_label ?? '')}</a>, ${esc(dateLong(i.date))}${i.venue ? `, ${esc(i.venue)}${i.city ? ', ' + esc(i.city) : ''}` : ''}. ${esc(res)}.</p>`
      + `<ul>${scores.map((s) => `<li>${esc(s)}</li>`).join('')}</ul><h2>Top scorers</h2>${linkList(top)}<h2>Best bowling</h2>${linkList(topw)}`
      + `<p><a href="/team/${esc(i.team1_key ?? teamKey(i.team1, i.gender))}">${esc(i.team1)}</a> · <a href="/team/${esc(i.team2_key ?? teamKey(i.team2, i.gender))}">${esc(i.team2)}</a></p>`,
  });
}

// ---------- 404, sitemaps, robots ----------
writeFileSync(join(dist, '404.html'), template
  .replace(/<title>[\s\S]*?<\/title>/, '<title>Page not found · cricforgeek</title>')
  .replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>'));

const xml = (list) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list.map(([u, lm]) => `  <url><loc>${esc(u)}</loc>${lm ? `<lastmod>${esc(String(lm).slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
const maps = [];
for (const [name, list] of Object.entries(urls)) {
  for (let k = 0; k * 45000 < list.length; k++) {
    const file = `sitemap-${name}${k ? '-' + (k + 1) : ''}.xml`;
    writeFileSync(join(dist, file), xml(list.slice(k * 45000, (k + 1) * 45000)));
    maps.push(file);
  }
}
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps.map((f) => `  <sitemap><loc>${SITE}/${f}</loc><lastmod>${dataTo}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`);
writeFileSync(join(dist, 'robots.txt'), `# cricforgeek\nUser-agent: *\nAllow: /\nDisallow: /pinboard\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(JSON.stringify({ pages, mb: +(bytes / 1e6).toFixed(1), sitemaps: maps.length, urls: Object.fromEntries(Object.entries(urls).map(([k, v]) => [k, v.length])) }));
