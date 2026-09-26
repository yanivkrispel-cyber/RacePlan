// web/sw.js — RacePlan PWA service worker.
// The whole app is same-origin static files now, so it genuinely works offline.
// Firebase / Google / font / CDN requests always go to the network.
// CACHE is stamped with the build hash by build/build.mjs, so every deploy
// ships a byte-different sw.js → browsers install it and drop the old cache.
const CACHE = 'raceplan-f6027f64f77d';
const SHELL = [
  '/', '/index.html', '/app.js', '/firebase-init.js', '/manifest.webmanifest',
  '/logo.webp', '/icons/boot-192.webp',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/favicon-64.png',
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

  // HTML + the app scripts + JSON data: network-first (fresh on every
  // launch), cache as offline fallback.
  const fresh = e.request.mode === 'navigate'
    || /\/(app|firebase-init)\.js$|\.json$/.test(url.pathname);
  if (fresh) {
    e.respondWith(
      fetch(e.request).then((res) => {
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
