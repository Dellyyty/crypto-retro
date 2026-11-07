/**
 * CRYPTOCAST service worker.
 *
 * Strategy:
 *  - Shell (HTML/CSS/JS/font/icons): stale-while-revalidate, so the app boots
 *    offline and picks up deploys on the next visit.
 *  - Market APIs: network-only. A cached price shown as live would be a lie.
 *    The app keeps its own snapshot for offline first paint.
 *  - Navigation failures fall back to the cached index so deep links still work.
 */

const VERSION = "v1";
const SHELL = `cryptocast-shell-${VERSION}`;
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./about.html",
  "./data.html",
  "./infra.html",
  "./design.html",
  "./styles/broadcast.css",
  "./styles/docs.css",
  "./scripts/app.js",
  "./scripts/lib/api.js",
  "./scripts/lib/format.js",
  "./scripts/lib/conditions.js",
  "./scripts/lib/charts.js",
  "./scripts/lib/astro.js",
  "./scripts/lib/audio.js",
  "./scripts/redirect.js",
  "./404.html",
  "./assets/fonts/martian-mono-latin.woff2",
  "./assets/img/favicon.svg",
  "./assets/img/og.png",
  "./assets/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache market data: stale prices must not masquerade as live.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
