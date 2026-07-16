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
const CACHE = 'gilbert-expenses-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon-32.png',
  './favicon-16.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
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
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./index.html'))
        )
    );
    return;
  }

  // ── Static assets: cache-first, refresh in the background ────
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
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
