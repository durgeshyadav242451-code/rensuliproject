// ═══════════════════════════════════════════════════
// PG Builders — Service Worker (PWA + Optional FCM)
// This file handles:
//  1. PWA install + offline caching (always works)
//  2. Firebase push notifications (only if config present)
// ═══════════════════════════════════════════════════

const CACHE_NAME = 'pgbuilders-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/tenant-dashboard.html',
  '/owner-dashboard.html',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/manifest.json'
];

// ── Install: cache key assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: serve from cache then network ──
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin HTML/CSS/JS
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Bypass HTTP cache for navigation requests (HTML) to break out of infinite reload loops
  let requestToFetch = event.request;
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    requestToFetch = new Request(event.request.url, { cache: 'no-cache' });
  }

  event.respondWith(
    fetch(requestToFetch).catch(() => caches.match(event.request))
  );
});

// ── Push notification handler (works without Firebase) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  
  let payload = {};
  try { payload = event.data.json(); } catch(e) { payload = { title: 'PG Builders', body: event.data.text() }; }

  const title = payload.title || payload.notification?.title || 'PG Builders';
  const options = {
    body: payload.body || payload.notification?.body || 'You have a new notification',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-72.svg',
    tag: payload.tag || 'pg-notif',
    data: { url: payload.url || '/', ...payload },
    vibrate: [200, 100, 200],
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click handler ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Try to load Firebase messaging (only if config was injected) ──
// This is skipped gracefully if Firebase isn't configured yet
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  // Only init if real config is injected (not placeholders)
  const cfg = self.__FCM_CONFIG__ || {};
  if (cfg.apiKey && cfg.apiKey !== 'placeholder' && cfg.messagingSenderId) {
    firebase.initializeApp(cfg);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage(payload => {
      const title = payload.notification?.title || payload.data?.title || 'PG Builders';
      const body = payload.notification?.body || payload.data?.body || '';
      self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.svg',
        badge: '/icons/icon-72.svg',
        data: { url: payload.data?.url || '/' },
        vibrate: [200, 100, 200]
      });
    });
  }
} catch(e) {
  // Firebase not available — PWA still works, just no FCM background messages
  console.log('[SW] FCM not loaded, PWA working in basic mode');
}
