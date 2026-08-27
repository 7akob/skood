// Service worker: caches the app shell for fast/offline load
const CACHE = "skood-v3";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/script.js",
  "/socket.io/socket.io.js",
  "/icon.svg",
  "/manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // Remove old caches from previous versions
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Only cache GET requests for our own origin
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache the live rooms count; a stale number is worse than none
  if (url.pathname === "/stats") return;

  // Network first, fall back to cache if offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
