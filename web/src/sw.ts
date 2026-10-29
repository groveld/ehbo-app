// Service worker: offline basis en pushmeldingen.
import type { AppInfo, PushPayload } from '@ehbo/shared';

declare let self: ServiceWorkerGlobalScope;
// Ingevuld door de Vite-plugin in vite.config.ts.
declare const __PRECACHE__: string[];
declare const __BUILD_ID__: string;

const BUILD_ID = __BUILD_ID__;
/** Bij npm run dev levert Vite alles vers; de cache zou dan oude code tonen. */
const DEV = BUILD_ID === 'dev';
const CACHE = `ehbo-app-${BUILD_ID}`;
const SHELL = [
  ...__PRECACHE__,
  '/manifest.webmanifest',
  // Eigen logo van het evenement; zonder eigen logo verwijst de server naar het standaardicoon.
  '/brand/icon-192.png',
  '/brand/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/badge-72.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Alleen oude app-versies opruimen; de kaart (ehbo-map-…) beheert de app zelf.
    for (const key of await caches.keys()) if (key.startsWith('ehbo-app-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Kaarttegels staan vooraf in de cache en veranderen nooit (de versie zit in het pad).
  if (url.pathname.startsWith('/map/')) {
    event.respondWith((async () => (await caches.match(event.request)) ?? fetch(event.request))());
    return;
  }
  if (DEV) return;
  if (event.request.mode === 'navigate') {
    // Pagina: eerst netwerk, zonder bereik de bewaarde versie.
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/index.html')) ?? Response.error()));
    return;
  }
  // Overige bestanden: direct uit de cache, op de achtergrond verversen.
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    const network = fetch(event.request).then(async (res) => {
      if (res.ok) await (await caches.open(CACHE)).put(event.request, res.clone());
      return res;
    }).catch(() => cached ?? Response.error());
    return cached ?? network;
  })());
});

self.addEventListener('push', (event) => {
  let data: Partial<PushPayload> = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || 'EHBO-app';
  // vibrate en renotify ontbreken nog in de TypeScript-typen, maar Android gebruikt ze wel.
  const options: NotificationOptions & { vibrate: number[]; renotify: boolean; timestamp: number } = {
    body: data.body || '',
    icon: '/brand/icon-192.png',
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
      if ('focus' in client) {
        await client.focus();
        // De app opent de pagina zelf (App.vue); dat werkt ook als deze service worker de pagina nog niet beheert.
        client.postMessage({ type: 'open', url: new URL(target).pathname });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

function b64urlToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

// Als de browser het abonnement vernieuwt, geven we het nieuwe direct aan de server door.
self.addEventListener('pushsubscriptionchange', (event) => {
  (event as ExtendableEvent).waitUntil((async () => {
    const info: AppInfo = await fetch('/api/info').then((r) => r.json());
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(info.vapidPublicKey) });
    await fetch('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  })());
});
