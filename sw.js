'use strict';

const CACHE_NAME = 'sellbook-shell-v161';
const CORE_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './startup-diagnostic.js',
  './stock-history-tabs.js',
  './location-sharing.js',
  './location-sharing.css',
  './supabase-config.js',
  './manifest.webmanifest'
];
const OPTIONAL_SHELL = ['./icons/icon.svg', './privacy.html', './terms.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = CORE_SHELL.map(path => new Request(path, { cache: 'reload' }));
    await cache.addAll(requests);
    await Promise.all(OPTIONAL_SHELL.map(path =>
      cache.add(new Request(path, { cache: 'reload' })).catch(error => {
        console.warn('Optional offline resource was not cached:', path, error);
      })
    ));
    // The active app remains in control until the user accepts the update.
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('sellbook-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache database/API, authentication, storage or function responses.
  if (url.hostname.includes('supabase.co') &&
      ['/rest/', '/auth/', '/storage/', '/functions/'].some(path => url.pathname.includes(path))) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        // Keep HTML and its same-build scripts/styles in step on normal refreshes.
        const response = await fetch(new Request(request, { cache: 'reload' }));
        if (response && response.ok) await cache.put('./index.html', response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        return new Response('Sellbook is not available offline yet. Connect once to the internet, open the app, and try again.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Same-origin app assets are network-first so a refresh cannot keep an old
  // app.js beside a newer index.html. The current build remains available offline.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(new Request(request, { cache: 'reload' }));
        if (response && response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // External libraries are cache-first after their first successful download.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })());
  }
});
