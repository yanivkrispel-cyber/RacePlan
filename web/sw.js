// web/sw.js — RacePlan PWA service worker.
// The whole app is same-origin static files now, so it genuinely works offline.
// Firebase / Google / font / CDN requests always go to the network.
const CACHE = 'raceplan-app-v2';
const SHELL = [
  '/', '/index.html', '/app.js', '/firebase-init.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // HTML + the app scripts: network-first (fresh on every launch), cache as
  // offline fallback.
  const fresh = e.request.mode === 'navigate'
    || /\/(app|firebase-init)\.js$/.test(url.pathname);
  if (fresh) {
    e.respondWith(
      fetch(e.request).then((res) => {
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
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }))
  );
});
