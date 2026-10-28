// Service worker: offline basis en pushmeldingen.
const VERSION = '__APP_VERSION__';
const CACHE = `ehbo-app-${VERSION}`;
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/badge-72.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    // Pagina: eerst netwerk, zonder bereik de bewaarde versie.
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Overige bestanden: direct uit de cache, op de achtergrond verversen.
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    const network = fetch(event.request).then(async (res) => {
      if (res.ok) (await caches.open(CACHE)).put(event.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached ?? network;
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || 'EHBO-app';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag || 'ehbo',
    renotify: true,
    requireInteraction: Boolean(data.urgent),
    vibrate: data.urgent ? [400, 150, 400, 150, 800] : [200, 100, 200],
    data: { url: data.url || '/' },
    timestamp: Date.now(),
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'push-received', title });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', location.origin).href;
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if ('focus' in client) { await client.focus(); if ('navigate' in client) client.navigate(target).catch(() => {}); return; }
    }
    await self.clients.openWindow(target);
  })());
});

// Als de browser het abonnement vernieuwt, geven we het nieuwe direct aan de server door.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const info = await fetch('/api/info').then((r) => r.json());
    const key = Uint8Array.from(atob(info.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - info.vapidPublicKey.length % 4) % 4)), (c) => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })());
});
