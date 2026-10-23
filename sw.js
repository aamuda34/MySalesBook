'use strict';

const CACHE_NAME = 'sellbook-shell-v1';
const APP_SHELL = [
  './',
  './index.html',
  './supabase-config.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './privacy.html',
  './terms.html'
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
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put('./index.html', response.clone()).catch(() => {});
        return response;
      } catch (_) {
        // A previously visited page must still open when offline. Always fall
        // back to the cached app shell, even for a URL containing a page hash.
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('SellBook is not available offline yet. Connect once to the internet, open the app, and try again.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
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
