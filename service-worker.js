const CACHE_NAME = "lego-scanner-v2";
const APP_SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
  ];

self.addEventListener("install", (event) => {
    event.waitUntil(
          caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
        );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
          caches.keys().then((keys) =>
                  Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
                                 ).then(() => self.clients.claim())
        );
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

                        if (
                              url.hostname.includes("rebrickable.com") ||
                              url.hostname.includes("jsdelivr.net") ||
                              url.hostname.includes("unpkg.com")
                            ) {
                              return;
                        }

                        event.respondWith(
                              caches.match(event.request).then((cached) => {
                                      const fetchPromise = fetch(event.request)
                                        .then((networkResp) => {
                                                    if (event.request.method === "GET" && networkResp.ok) {
                                                                  const clone = networkResp.clone();
                                                                  caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                                                    }
                                                    return networkResp;
                                        })
                                        .catch(() => cached);
                                      return cached || fetchPromise;
                              })
                            );
});
