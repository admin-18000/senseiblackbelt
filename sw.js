// ═══════════════════════════════════════════════════════════
//  SENSEI BlackBelt — Service Worker (auto-versionnant)
//  Stratégie : Network-First pour index.html (toujours à jour)
//              Stale-While-Revalidate pour les assets statiques
//              Cache-First dédié pour le CDN TF.js
//
//  ⚙️  AUCUNE manip manuelle : le cache se renouvelle tout seul.
// ═══════════════════════════════════════════════════════════

const BUILD          = 'auto';
const CACHE_NAME     = 'sensei-' + BUILD;
const CDN_CACHE_NAME = 'sensei-cdn-v1';
const OFFLINE_URL    = '/index.html';

const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png',
];

const CDN_PATTERNS = [
  'cdn.jsdelivr.net/npm/@tensorflow',
  'cdn.jsdelivr.net/npm/@tensorflow-models',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== CDN_CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // CDN TF.js + Fonts → Cache-First (AVANT le filtre d'origin !)
  if (CDN_PATTERNS.some(p => url.href.indexOf(p) > -1)) {
    event.respondWith(cdnCacheFirst(request));
    return;
  }

  // Filtre : ne gérer que les requêtes vers notre propre domaine
  if (!url.origin.match(/senseiblackbelt\.com|localhost/)) return;

  // index.html → Network-First
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Assets statiques → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// ── Network-First ───────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match(OFFLINE_URL);
  }
}

// ── Stale-While-Revalidate ──────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || networkFetch || caches.match(OFFLINE_URL);
}

// ── CDN Cache-First ─────────────────────────────────────────
async function cdnCacheFirst(request) {
  const cache = await caches.open(CDN_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('CDN unavailable offline', { status: 503 });
  }
}
