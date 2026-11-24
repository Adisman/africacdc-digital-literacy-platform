// Service worker: caches the app shell, curriculum and locales so the platform opens and course content works offline.
// API calls are never cached here (the app keeps its own offline outbox and downloaded course packages).
const V = 'dlp-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'locales/index.json', 'locales/en.json', 'locales/fr.json', 'icons/logo.png', 'icons/logo-sm.png', 'icons/icon-192.png',
  ...['app', 'admin', 'author', 'learner', 'api', 'charts', 'core', 'countries', 'env', 'i18n', 'qr', 'seed', 'sha256', 'state', 'store', 'ui', 'zip'].map((n) => `js/${n}.js`)];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('/healthz')) return;
  // network-first so updates arrive; fall back to cache offline. Successful responses refresh the cache.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(V).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
