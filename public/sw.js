// Service worker. Offline-first by design:
// - App shell is precached so the app opens with no signal.
// - Species lists (/api/species) are network-first, falling back to the last
//   saved copy, so any place you've opened before still works in the field.
// - Later: a "trip deck" cache will hold that trip's photos and audio
//   (see CLAUDE.md → Offline trip decks).

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const DATA = "data-v1";      // API responses; kept across app updates
const FONTS = "fonts-v1";

const SHELL_FILES = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL, DATA, FONTS]);
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    e.respondWith(networkFirst(req, DATA));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(staleWhileRevalidate(req, FONTS));
  } else if (url.origin === location.origin) {
    if (req.mode === "navigate") e.respondWith(caches.match("/index.html").then((r) => r || fetch(req)));
    else e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    return hit || new Response(JSON.stringify({ error: "You're offline and this isn't saved on this device yet." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
