/* ---------------------------------------------------------------
   eduquest — service-worker.js
   Safe cache-first strategy. No "Response body already used" bug.
   Relative paths so it works on any GitHub Pages subdirectory.
   --------------------------------------------------------------- */

const CACHE_NAME = "eduquest-v3";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./result.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

/* ---------- Install: pre-cache app shell ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        /* addAll fails if any single URL fails — use individual puts for resilience */
        return Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            fetch(url)
              .then((res) => {
                if (res.ok) {
                  return cache.put(url, res);
                }
              })
              .catch(() => { /* skip if unavailable */ })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ---------- Activate: clean up old caches ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ---------- Fetch: network-first for navigation & API, cache-first for assets ---------- */
self.addEventListener("fetch", (event) => {
  /* Only intercept GET */
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  /* Never intercept Hugging Face API calls — let them go straight to network */
  if (url.hostname === "router.huggingface.co") return;

  /* Never intercept CDN requests (Bootstrap, Google Fonts, etc.) */
  if (
    url.hostname.includes("cdn.jsdelivr.net") ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) return;

  const isNavigation = event.request.mode === "navigate";

  if (isNavigation) {
    /* Navigation: network-first, fall back to cached index.html */
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          /* Clone before consuming so we can store a fresh copy */
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  /* All other same-origin GET: cache-first, refresh in background */
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((res) => {
            if (res && res.ok && url.origin === self.location.origin) {
              /* Clone before storing — never reuse the same body */
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => cached);

        /* Return cached immediately if available, otherwise wait for network */
        return cached || networkFetch;
      })
    )
  );
});
