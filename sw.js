'use strict';

const CACHE_NAME = 'sellbook-shell-v133';
// These files are required for the signed-in app shell to start offline.
const CORE_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './stock-history-tabs.js',
  './supabase-config.js',
  './manifest.webmanifest'
];
// Optional pages and artwork must never prevent the core app from being cached.
const OPTIONAL_SHELL = [
  './icons/icon.svg',
  './privacy.html',
  './terms.html'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fail installation if a core file is unavailable: activating an incomplete
    // shell would make the app harder to recover when the device goes offline.
    await cache.addAll(CORE_SHELL);
    // A missing legal page or icon is non-critical and must not block offline use.
    await Promise.all(OPTIONAL_SHELL.map(path =>
      cache.add(path).catch(error => {
        console.warn('Optional offline resource was not cached:', path, error);
      })
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('sellbook-shell-') &&
                         key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache database/API requests or authentication responses.
  if (
    url.hostname.includes('supabase.co') &&
    (url.pathname.includes('/rest/') ||
     url.pathname.includes('/auth/') ||
     url.pathname.includes('/storage/') ||
     url.pathname.includes('/functions/'))
  ) {
    return;
  }

  // App navigation: try the network first, then use the cached app page.
  if (request.mode === 'navigate') {
    const refresh = fetch(request).then(async response => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put('./index.html', response.clone()).catch(() => {});
      }
      return response;
    }).catch(() => null);
    // Extend the navigation event immediately while the cached shell is served.
    event.waitUntil(refresh);
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html') || await cache.match('./');
      // Return the cached app immediately; network refresh updates the next launch.
      if (cached) return cached;
      const response = await refresh;
      return response || new Response('Sellbook is not available offline yet. Connect once to the internet, open the app, and try again.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    })());
    return;
  }
  // Cache successful same-origin static files. Also allow already-cached
  // external libraries to load offline after they have been fetched online.
  event.respondWith(
    caches.match(request).then(async cached => {
      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (response && response.ok &&
            (url.origin === self.location.origin ||
             url.hostname === 'cdn.jsdelivr.net')) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }

        return response;
      } catch (error) {
        if (url.origin === self.location.origin) {
          const cache = await caches.open(CACHE_NAME);
          const fallback = await cache.match(request);
          if (fallback) return fallback;
        }

        throw error;
      }
    })
  );
});
