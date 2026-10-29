/* Service Worker - Complaints System PWA
   Caches static assets for offline use. API calls still require the local server.
*/
const CACHE_NAME = "complaints-v0.4.0";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/ui-enhancements.css",
  "/ui-enhancements.js",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API or auth requests
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Network-first for HTML, cache-first for static assets
  if (event.request.mode === "navigate" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((r) => r || caches.match("/index.html")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok && event.request.method === "GET") {
          const clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    }),
  );
});
