'use strict';

/**
 * Offline cache covers only public static UI assets.
 * HTML, API responses, user data and the live app bundle remain network-only.
 * The local Express process is required for the complaints system to operate.
 */
const CACHE_NAME = 'complaints-ui-reports-palette-v3';
const STATIC_ASSETS = new Set([
  '/app.js',
  '/ui-system.css',
  '/ui-compat.css',
  '/thmanyah-fonts.css',
  '/fallback-font.css',
  '/assets/NotoSansArabic.ttf',
  '/ui-enhancements.js',
  '/attachments-ui-bridge.js'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([...STATIC_ASSETS]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('complaints-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSETS.has(url.pathname)) {
    return; // All API, login, navigation, dynamic bundle and attachments bypass SW.
  }
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, clone)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_UI_CACHE') {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k.startsWith('complaints-')).map(k => caches.delete(k)))
      )
    );
  }
});
