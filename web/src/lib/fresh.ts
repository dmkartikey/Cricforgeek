// Keeps open tabs on the newest version of the site.
// Phones keep tabs alive for days, and this is a single-page app, so without this an old tab keeps running the old
// code (old photos, and pages whose files a newer deploy has replaced fail to open). Each build writes version.json;
// the app checks it when you change page or come back to the tab, and loads the new version when there is one.
const BUILD: string = import.meta.env.VITE_BUILD_ID ?? 'dev';
let newer = false, lastCheck = 0;

/** Load the current page again from the network (a fresh address, so no saved copy of the page is used). */
export function freshReload(path = location.pathname + location.search) {
  const u = new URL(path, location.origin);
  u.searchParams.set('_v', String(Date.now()));
  location.replace(u.toString());
}

/** Remove the _v marker freshReload adds, so shared links stay clean. */
export function tidyUrl() {
  const u = new URL(location.href);
  if (u.searchParams.has('_v')) { u.searchParams.delete('_v'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
}

export async function checkVersion(force = false) {
  if (BUILD === 'dev' || newer || (!force && Date.now() - lastCheck < 15_000)) return newer;
  lastCheck = Date.now();
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) {
      const id = (await r.json()).id;
      // reload at most once for each new version: if the reload still runs old code (a cache serving old files for a
      // few minutes), don't loop; the next version, or a later visit, will pick it up
      let tried = null; try { tried = sessionStorage.getItem('cfg.freshFor'); } catch { /* storage blocked */ }
      newer = id !== BUILD && tried !== id;
      if (newer) { try { sessionStorage.setItem('cfg.freshFor', id); } catch { newer = false; /* can't guard: don't risk a loop */ } }
    }
  } catch { /* offline: try again later */ }
  return newer;
}

/** Call on every page change: if a newer version was found, open this page from it instead. */
export function onNavigate() {
  if (newer) { freshReload(); return; }
  void checkVersion().then((n) => { if (n) freshReload(); });
}

export function watchVersion() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && (await checkVersion(true))) freshReload();
  });
}
