/**
 * FluiStream — Service Worker (Offline UI Cache)
 */

const CACHE_NAME = 'fluistream-ui-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/localization.js',
  './js/m3u-parser.js',
  './js/epg-parser.js',
  './js/xtream-api.js',
  './js/storage.js',
  './js/player.js',
  './js/app.js',
  './assets/logo.svg',
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
  // Apenas cachear requisições GET para os arquivos locais da interface
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Não interferir com fluxos HLS de streaming
  if (url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts') || url.pathname.endsWith('.mp4') || url.search.includes('username=')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
