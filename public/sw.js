/* NearBuyGoods service worker: app-shell precache, runtime caching, Web Push display.
   API calls stay network-first so prices/stock are never stale offline;
   failed GETs fall back to the last cached payload (handled in api.js). */
const VERSION = 'nbg-v1.1.2';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/app.css',
  '/js/config.js', '/js/app.js', '/js/api.js', '/js/store.js', '/js/ui.js', '/js/icons.js', '/js/map.js', '/js/charts.js', '/js/recognize.js', '/js/push.js', '/js/location.js', '/js/boot-check.js',
  '/js/pages/onboarding.js', '/js/pages/auth.js', '/js/pages/home.js', '/js/pages/search.js', '/js/pages/upload.js',
  '/js/pages/product.js', '/js/pages/storepage.js', '/js/pages/saved.js', '/js/pages/alerts.js', '/js/pages/profile.js',
  '/js/pages/business.js', '/js/pages/admin.js', '/js/pages/premium.js',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/icon-180.png', '/assets/logo.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !k.endsWith('-api')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/v1/')) {
      e.respondWith(
        fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(VERSION + '-api').then((c) => c.put(e.request, clone));
          return res;
        }).catch(() => caches.match(e.request))
      );
    }
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetchPromise = fetch(e.request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, clone)); }
        return res;
      }).catch(() => hit);
      return hit || fetchPromise;
    })
  );
});

/* ---- Web Push: display alerts even with the app closed ---- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'NearBuyGoods', body: e.data?.text() || '' }; }
  const title = data.title || 'NearBuyGoods';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/assets/icon-192.png',
    badge: data.badge || '/assets/icon-180.png',
    tag: data.tag || 'nbg',
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: data.url || '/#/alerts' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/#/alerts';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        try { c.navigate(url); } catch { /* ignore */ }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(url);
  })());
});
