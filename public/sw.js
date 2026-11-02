// Service worker. Offline-first by design:
// - App shell is precached so the app opens with no signal. With signal, the
//   app's own files come from the network first, so a new deploy shows up on
//   the next open (the page reloads itself once when a new worker takes over).
// - Species lists (/api/species) are network-first, falling back to the last
//   saved copy, so any place you've opened before still works in the field.
// - Later: a "trip deck" cache will hold that trip's photos and audio
//   (see CLAUDE.md → Offline trip decks).

const VERSION = "v6";
const SHELL = `shell-${VERSION}`;
const DATA = "data-v1";      // API responses; kept across app updates
const FONTS = "fonts-v1";
const MEDIA = "media-v1";    // bird photos you have seen; kept across app updates
const MEDIA_MAX = 400;      // rough cap on cached photos

const SHELL_FILES = ["/", "/index.html", "/styles.css", "/app.js", "/lib.js", "/learn.js", "/study.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL, DATA, FONTS, MEDIA]);
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
  } else if (/(^|\.)inaturalist\.org$|inaturalist-open-data\.s3\.amazonaws\.com$/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, MEDIA));
  } else if (url.origin === location.origin) {
    e.respondWith(shellNetworkFirst(req));
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

// App files: fresh from the network when possible; saved copy when offline.
async function shellNetworkFirst(req) {
  const cache = await caches.open(SHELL);
  const key = req.mode === "navigate" ? "/index.html" : req;
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || (await caches.match(req)) || Response.error();
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > MEDIA_MAX) await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map((k) => cache.delete(k)));
  }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
