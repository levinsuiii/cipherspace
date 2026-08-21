const APP_SHELL_CACHE = "cipherspace-app-shell-v2";
const STATIC_CACHE = "cipherspace-static-v1";
const APP_SHELL = [
  "/",
  "/offline.html",
  "/offline.css",
  "/manifest.webmanifest",
  "/icons/cipherspace.svg",
  "/icons/cipherspace-180.png",
  "/icons/cipherspace-192.png",
  "/icons/cipherspace-512.png",
  "/icons/cipherspace-maskable-512.png"
];

async function cacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.addAll(APP_SHELL);
  const shellResponse = await cache.match("/");
  if (!shellResponse) return;

  const shellHtml = await shellResponse.text();
  const assetPaths = [...shellHtml.matchAll(/(?:href|src)="(\/assets\/[^"?]+)"/g)]
    .map((match) => match[1])
    .filter(Boolean);
  await cache.addAll([...new Set(assetPaths)]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const activeCaches = new Set([APP_SHELL_CACHE, STATIC_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("cipherspace-") && !activeCaches.has(name))
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Authentication, sync, notes, comments, and health responses always bypass these caches.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match("/")) ?? (await caches.match("/offline.html"))
      )
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/offline.css" ||
    url.pathname === "/manifest.webmanifest";
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
