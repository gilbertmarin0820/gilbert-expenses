// ═══════════════════════════════════════════════════════════════
// Gilbert Expenses — service worker
//
// CACHE VERSION: bump this string on EVERY release you push to
// GitHub. Old caches are deleted automatically on activate, so
// returning users get a clean fresh download instead of stale files.
//
// Update strategy (v3):
//  • App shell (navigations / index.html) — NETWORK FIRST, falling
//    back to cache when offline. This means updates on GitHub Pages
//    arrive on the very next open — no more telling people to clear
//    their cache manually. Offline still works exactly as before.
//  • Everything else (icons, manifest) — cache-first with a silent
//    background refresh.
//  • skipWaiting + clients.claim so a new SW takes over immediately
//    instead of waiting for every tab to close.
// ═══════════════════════════════════════════════════════════════
const CACHE = 'gilbert-expenses-v40';

// How long a page load waits for the network before falling back to the cached
// shell. Long enough that a normal mobile connection is never cut short, short
// enough that a stalled one doesn't hold a blank screen. The request itself
// carries on in the background and still refreshes the cache.
const NAV_TIMEOUT_MS = 3000;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon-32.png',
  './favicon-16.png',
  './apple-touch-icon.png',
];

// The app itself. If this one is missing there is nothing to install; every
// other entry is an icon or the manifest and must not be able to stop the
// install on its own.
const APP_SHELL_REQUIRED = ['./', './index.html'];

self.addEventListener('install', (event) => {
  // cache.addAll() is ALL-OR-NOTHING: one 404 (a renamed icon, a half-finished
  // deploy) rejected the whole install, so the worker never activated and the
  // app silently lost offline support entirely. Each file is added on its own
  // and an optional one is allowed to fail.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(APP_SHELL.map((url) =>
        cache.add(url).catch((err) => {
          if (APP_SHELL_REQUIRED.indexOf(url) !== -1) throw err;
          console.warn('[sw] skipped optional asset', url, err);
        })
      )))
      .then(() => self.skipWaiting()) // don't wait for old tabs to close
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// index.html listens for this after showing its "update downloaded" toast.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Cross-origin requests (FX-rate APIs, Supabase sync, fonts) go
  // straight to the network — never cached, never intercepted.
  if (url.origin !== self.location.origin) return;

  // ── App shell: NETWORK FIRST, WITH A DEADLINE ────────────────
  // Network-first had no timeout, so "online but useless" — a captive portal,
  // a stalled mobile connection, a hotel wifi that accepts the socket and
  // never answers — left the app on a blank screen until the browser gave up,
  // minutes later, with a perfectly good copy sitting in the cache the whole
  // time. Offline was always handled; this is the case in between. The fetch
  // is NOT abandoned when the deadline passes: it keeps running and still
  // refreshes the cache, so the next open has the new version.
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    const net = fetch(req)
        .then((res) => {
          // ONLY a real page gets written over the cached shell. Without this
          // check a 404 or 502 from the host — a bad deploy, a paused Pages
          // build — was cached as index.html, so the app stayed broken offline
          // long after the host recovered. The static branch below always
          // checked res.ok; this one did not.
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        });

    // Offline, or slower than the deadline. The static branch below was given
    // a real 504 in 03d for exactly this reason and this branch was left as it
    // was: with nothing cached — storage pressure evicted it, an install that
    // never completed, a navigation to a path the shell does not cover — both
    // matches miss and respondWith is handed `undefined`, which throws inside
    // the fetch handler and surfaces as an opaque network error instead of a
    // page. Always end on a Response. When nothing is cached there is nothing
    // better to answer with, so it waits for the network after all rather than
    // showing a 504 to somebody who is merely on a slow connection.
    const fromCache = () =>
      caches.match(req)
        .then((hit) => hit || caches.match('./index.html'))
        .then((hit) => hit || net.catch(() => null))
        .then((hit) => hit || offlineResponse(req))
        .catch(() => offlineResponse(req));

    event.respondWith(new Promise((resolve) => {
      let settled = false;
      const done = (res) => { if (!settled) { settled = true; resolve(res); } };
      const timer = setTimeout(() => { fromCache().then(done, () => done(offlineResponse(req))); }, NAV_TIMEOUT_MS);
      net.then(
        (res) => { clearTimeout(timer); done(res); },
        ()    => { clearTimeout(timer); fromCache().then(done, () => done(offlineResponse(req))); }
      );
    }));
    return;
  }

  // ── Static assets: cache-first, refresh in the background ────
  // NOTE: respondWith() must always receive a Response. Offline with nothing
  // cached, the fetch rejects and the old `.catch(() => hit)` handed back
  // `undefined`, which throws inside the fetch handler and surfaces as an
  // opaque network error. A real 504 is returned instead.
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || null);
      return hit || refresh.then((res) => res || offlineResponse(req));
    }).catch(() => offlineResponse(req))
  );
});

function offlineResponse(req) {
  return new Response('Offline and not in the cache.', {
    status: 504,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
