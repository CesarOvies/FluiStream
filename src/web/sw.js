/**
 * FluiStream — Service Worker (Offline UI Cache & Auto-Update)
 */

const CACHE_NAME = 'fluistream-ui-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './favicon.ico',
  './js/localization.js',
  './js/m3u-parser.js',
  './js/epg-parser.js',
  './js/xtream-api.js',
  './js/storage.js',
  './js/player.js',
  './js/network.js',
  './js/version.js',
  './js/app.js',
  './assets/logo.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './assets/site-footer.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Apenas interceptar requisições GET locais
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Não interferir com fluxos HLS/VOD de streaming ou chamadas de API externa
  if (url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts') || url.pathname.endsWith('.mp4') || url.search.includes('username=') || url.origin !== self.location.origin) {
    return;
  }

  // Estratégia Network-First com fallback para Cache Storage:
  // Garante que o usuário receba imediatamente as atualizações e correções de bugs mais recentes,
  // mantendo a operação offline transparente caso a rede esteja indisponível.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

