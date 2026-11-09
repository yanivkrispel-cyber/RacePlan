// web/sw.js — RacePlan PWA service worker.
// The whole app is same-origin static files now, so it genuinely works offline.
// Firebase / Google / CDN requests always go to the network (React and the
// fonts are same-origin now, so they're cached like the rest of the shell).
// CACHE is stamped with the build hash by build/build.mjs, so every deploy
// ships a byte-different sw.js → browsers install it and drop the old cache.
const CACHE = 'raceplan-82d060d0317c';
const SHELL = [
  '/', '/index.html', '/app.js', '/firebase-init.js', '/manifest.webmanifest',
  '/rp-logo.webp', '/icons/rp-boot-192.webp',
  '/fonts/heebo-v28-latin.woff2', '/fonts/heebo-v28-hebrew.woff2',
  '/vendor/react-18.3.1.production.min.js', '/vendor/react-dom-18.3.1.production.min.js',
  '/icons/rp-icon-192.png', '/icons/rp-icon-512.png', '/icons/rp-icon-maskable-512.png',
  '/icons/rp-apple-touch-icon.png', '/icons/rp-favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The deploy probe (src/update.jsx) must always hit the network.
  if (url.pathname === '/version.json') return;
  // The Cloud Functions behind /api/ (Garmin's consent returns to /api/garmin/callback and is answered with a
  // redirect back into the app) are never the worker's: 3.11.2026 the redirect came back to the worker as an
  // opaque response, failed the res.ok check below and the cached app shell was served at the callback URL,
  // stuck on the logo.
  if (url.pathname.startsWith('/api/')) return;

  // HTML + the app scripts + JSON data: network-first (fresh on every
  // launch), cache as offline fallback.
  const fresh = e.request.mode === 'navigate'
    || /\/(app|firebase-init)\.js$|\.json$/.test(url.pathname);
  if (fresh) {
    e.respondWith(
      fetch(e.request).then((res) => {
        // a redirect is the page's to follow, never an error to replace with the cached shell
        if (res.type === 'opaqueredirect' || res.redirected) return res;
        // A non-2xx (e.g. a transient 503 from the origin) must NOT be
        // cached or handed to the page as if it were the real app — that
        // poisons the cache with an error body and breaks the mount.
        if (!res.ok) throw new Error('bad status ' + res.status);
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then((h) => h || caches.match('/index.html')))
    );
    return;
  }

  // Icons / manifest / css: cache-first.
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
