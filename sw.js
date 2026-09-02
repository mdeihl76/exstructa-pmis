/* Squared Field service worker.
   Only caches the manifest + icons (so the installed home-screen icon's
   name/appearance still work without a live connection) — it deliberately
   does NOT cache or intercept mobile.html itself, or anything else.

   Why: iOS's standalone "Add to Home Screen" mode has real, well-documented
   flakiness around service workers intercepting the page's own navigation
   request — it can get stuck running a stale worker independently of what's
   actually being served on the server, which is what caused Safari's
   "Response served by the service worker has redirections" error to keep
   resurfacing even after the underlying code was confirmed fixed. Given
   most sites have solid 4G/5G coverage in practice, reliably opening the
   app matters more than instant offline loading — so mobile.html's own
   navigation is no longer intercepted at all; it always goes straight to
   the network, exactly like a normal, non-PWA page load. If there's
   genuinely no signal, the page just won't load, same as any other site.

   Everything else (Supabase auth, project data, photo uploads) was already,
   and remains, completely untouched by this service worker — those are a
   different origin and pass straight through either way. */

const SHELL_CACHE = 'squared-field-shell-v2';
const SHELL_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      // Also clears out the old v1 cache (which held a cached copy of
      // mobile.html from the previous approach) on everyone's next visit.
      Promise.all(names.filter(n => n !== SHELL_CACHE).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Never touch navigation requests (the page load itself) — see the
  // comment at the top of this file for why.
  if (event.request.mode === 'navigate') return;

  const url = new URL(event.request.url);

  // Only ever handle same-origin GETs for the manifest/icons above.
  // Everything else is left completely alone — returning without calling
  // event.respondWith() means the browser handles the request normally, as
  // if this service worker didn't exist.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request.url)
        .then(resp => {
          if (resp && resp.ok) {
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, resp.clone()));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
