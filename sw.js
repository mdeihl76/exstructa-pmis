/* Squared Field service worker.
   Scope: caches ONLY the app shell (this page's own HTML/CSS/JS/icons) so the
   UI itself loads with no connectivity — someone standing in a basement with
   no signal should still be able to open the app and see "3 photos pending
   upload", not a blank white screen.

   Deliberately does NOT cache or intercept anything else — every request to
   Supabase (auth, project data, photo uploads) is a different origin anyway
   and passes straight through untouched. If a Supabase call fails because
   there's genuinely no connection, that failure is exactly what tells
   mobile.html's own code to fall back to the local IndexedDB queue instead —
   a service worker silently caching or retrying those calls would hide that
   signal and risk serving stale project data as if it were current. */

const SHELL_CACHE = 'squared-field-shell-v1';
const SHELL_ASSETS = [
  '/mobile.html',
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
      Promise.all(names.filter(n => n !== SHELL_CACHE).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only ever handle same-origin GETs for the exact shell assets above.
  // Everything else (Supabase, any other path) is left completely alone —
  // returning without calling event.respondWith() means the browser handles
  // the request normally, as if this service worker didn't exist.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      // event.request.mode is 'navigate' for a top-level page load like this
      // one, and browsers spec-mandate redirect:'manual' for any fetch() of
      // a navigation-mode Request. If /mobile.html is ever redirected for
      // ANY reason (a Cloudflare host/HTTPS normalization, a redirect rule
      // elsewhere on the zone, etc.), fetch(event.request) does not follow
      // it — it resolves to an opaque 'opaqueredirect' placeholder instead
      // of the real page. Handing that back via respondWith() on a
      // navigation is exactly what Safari's "Response served by the service
      // worker has redirections" error is complaining about, even when the
      // underlying page is otherwise completely fine.
      //
      // Fetching by plain URL string here (not the original Request object)
      // avoids this: a plain-URL fetch() defaults to redirect:'follow', so
      // any redirect gets fully resolved into the real final page before we
      // ever see the response — nothing "manual" or opaque about it.
      const network = fetch(event.request.url)
        .then(resp => {
          // Keep the cached shell fresh whenever we do have a connection.
          if (resp && resp.ok) {
            caches.open(SHELL_CACHE).then(cache => cache.put(event.request, resp.clone()));
          }
          return resp;
        })
        .catch(() => cached); // offline — fall back to whatever's cached
      return cached || network;
    })
  );
});
