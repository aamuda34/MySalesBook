'use strict';

const CACHE_NAME = 'my-sales-book-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('my-sales-book-shell-') &&
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
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('./index.html')) ||
               (await cache.match('./'));
      })
    );
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
