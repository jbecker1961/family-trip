// Makes the app open fast and keep working with a weak signal in the parks.
// Trip data has its own offline copy (Firestore's local cache), so this only caches the page files.
//
// - Versioned files (app.js?v=…, styles.css?v=…) never change once published, so they come straight
//   from this phone's copy with no network wait.
// - The page itself is fetched fresh, but if the network takes more than 2.5 seconds the saved copy
//   is shown instead, and the fresh one is saved for next time.
// - Other files on this site show the saved copy at once and refresh it in the background.
// - Firebase and font files are kept in their own cache that survives app updates.
// Bump VERSION together with the ?v= in index.html and APP_VERSION in app.js.
const VERSION = '2026.11.15-13';
const CACHE = 'family-trip-' + VERSION;
const LIB_CACHE = 'family-trip-lib-1';
const SHELL = ['./', `app.js?v=${VERSION}`, `styles.css?v=${VERSION}`, 'firebase-config.js', 'manifest.webmanifest', 'icon-192.png'];
const PAGE_TIMEOUT_MS = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== LIB_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const save = (cache, key, res) => {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(cache).then(c => c.put(key, copy)); }
  return res;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const staticCdn = url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (sameOrigin && req.mode === 'navigate') {
    // The page: fresh when the network is quick, otherwise the saved copy right away.
    const fresh = fetch(url.origin + url.pathname + url.search, { cache: 'no-cache' }).then(res => save(CACHE, './', res));
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const finish = res => { if (!done && res) { done = true; resolve(res); } };
      const timer = setTimeout(() => caches.match('./').then(finish), PAGE_TIMEOUT_MS);
      fresh.then(res => { clearTimeout(timer); finish(res); })
        .catch(() => { clearTimeout(timer); caches.match('./').then(hit => finish(hit || Response.error())); });
    }));
  } else if (sameOrigin && url.searchParams.has('v')) {
    // Versioned files: the saved copy if there is one, otherwise download and save.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => save(CACHE, req, res))));
  } else if (sameOrigin) {
    // Everything else on the site: saved copy now, refreshed in the background.
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => save(CACHE, req, res));
    e.waitUntil(fresh.catch(() => {}));
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fresh));
  } else if (staticCdn) {
    // Versioned library and font files never change, so serve them from the cache when present.
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => save(LIB_CACHE, req, res))));
  }
});
