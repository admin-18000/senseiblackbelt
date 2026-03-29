// ═══════════════════════════════════════════════════════════
//  SENSEI BlackBelt — Service Worker
//  Stratégie : Cache-First pour assets statiques
//              Network-First pour index.html (toujours à jour)
// ═══════════════════════════════════════════════════════════

const CACHE_NAME     = 'sensei-v1';
const OFFLINE_URL    = '/index.html';

// Assets à mettre en cache immédiatement à l'installation
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/logo.png',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png',
  // Fonts Google — mises en cache au premier accès via fetch
];

// ── INSTALL : précache des assets critiques ─────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE : nettoyage des anciens caches ─────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH : stratégie selon le type de requête ──────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET et les extensions tierces
  if (request.method !== 'GET') return;
  if (!url.origin.match(/senseiblackbelt\.com|localhost/)) return;

  // index.html → Network-First (toujours la version fraîche)
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets statiques → Cache-First
  event.respondWith(cacheFirst(request));
});

// ── Stratégie Cache-First ───────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline + pas en cache → fallback
    return caches.match(OFFLINE_URL);
  }
}

// ── Stratégie Network-First ─────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline → servir depuis le cache
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE_URL);
  }
}
