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
const CACHE = 'gilbert-expenses-v31';

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

  // ── App shell: NETWORK FIRST ──────────────────────────────────
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(
      fetch(req)
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
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
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
