/* Gilbert Expenses — Service Worker
   Strategy:
   - App shell (HTML/manifest/icons) → cache-first, with a background
     network update so the next launch picks up new versions.
   - Google Fonts → cache-first (fonts basically never change).
   - FX rate APIs (jsdelivr/x-rates/frankfurter/etc.) → network-only,
     never cached, since exchange rates must always be fresh. The app's
     own JS already has multiple fallback providers and handles failures.
*/

const CACHE_NAME = 'gilbert-expenses-v2';

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icon-72.png',
  './icon-96.png',
  './icon-128.png',
  './icon-144.png',
  './icon-152.png',
  './icon-192.png',
  './icon-384.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

// Hosts whose responses should NEVER be cached (always go to network).
const NETWORK_ONLY_HOSTS = [
  'cdn.jsdelivr.net',
  'x-rates.com',
  'www.x-rates.com',
  'open.er-api.com',
  'api.frankfurter.app',
  'api.allorigins.win',
  'corsproxy.io',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POST etc.

  const url = new URL(req.url);

  // 1. FX rate / proxy APIs — always hit the network, never cache.
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // 2. Google Fonts — cache-first, long-lived.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // 3. Navigations (the HTML page itself) — network-first so updates
  //    are picked up immediately when online, cache fallback when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 4. Everything else same-origin (manifest, icons) — cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // 5. Any other cross-origin request — just pass through to network.
});
