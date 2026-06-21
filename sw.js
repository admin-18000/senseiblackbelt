// ═══════════════════════════════════════════════════════════
//  SENSEI BlackBelt — Service Worker (auto-versionnant)
//  Stratégie : Network-First pour index.html (toujours à jour)
//              Stale-While-Revalidate pour les assets statiques
//              Cache-First dédié pour le CDN TF.js + Fonts
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
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// ── INSTALL — résilient (un fichier manquant ne bloque pas) ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Precache skip (fichier absent ?):', url, err.message)
          )
        )
      )
    ).then(() => self.skipWaiting())
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

  // index.html → Network-First (avec fallback cache pour offline)
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
    return cached || new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>SENSEI BlackBelt</title></head><body style="margin:0;background:#0d1117;color:#f0f2f8;font-family:sans-serif;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px">' +
      '<div><div style="font-size:64px;margin-bottom:16px">🥋</div>' +
      '<div style="font-family:Impact,sans-serif;font-size:24px;color:#f5c518;letter-spacing:2px;margin-bottom:12px">SENSEI BLACKBELT</div>' +
      '<div style="font-size:14px;color:#7a8299;line-height:1.6;max-width:320px;margin:0 auto">' +
      'Pas de connexion internet.<br>Ouvre l\'app une première fois en wifi pour activer le mode hors-ligne.' +
      '<br><br>No internet connection.<br>Open the app once on wifi to enable offline mode.' +
      '</div><div style="margin-top:24px"><button onclick="location.reload()" style="background:#f5c518;color:#0d1117;' +
      'border:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;letter-spacing:1px">' +
      'RÉESSAYER / RETRY</button></div></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
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

  return cached || networkFetch || new Response('', { status: 404 });
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
    return new Response('', { status: 503 });
  }
}
