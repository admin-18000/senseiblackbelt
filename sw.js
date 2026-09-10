// ═══════════════════════════════════════════════════════════
//  SENSEI BlackBelt — Service Worker v2 (AUTO-VERSIONNÉ)
//
//  ✅ ZÉRO manipulation manuelle.
//  ✅ Chaque nouvelle version de index.html sur GitHub est
//     automatiquement servie aux utilisateurs à leur prochaine
//     visite en ligne (grâce à Network-First strict + timeout).
//  ✅ Les assets se rafraîchissent tout seuls en arrière-plan
//     (Stale-While-Revalidate).
//  ✅ Auto-purge des entrées cache > 30 jours (évite accumulation).
//  ✅ Fonctionne hors-ligne (cache offline stylé si pas de réseau).
// ═══════════════════════════════════════════════════════════

const CACHE_NAME     = 'sensei-cache';    // Cache principal (auto-géré)
const CDN_CACHE_NAME = 'sensei-cdn';      // Cache CDN (TF.js + Fonts)
const MEDIA_CACHE    = 'sensei-media';    // Cache media lourd (hero.mp4)

const NETWORK_TIMEOUT_MS = 3000;          // Timeout Network-First (3s)
const CACHE_MAX_AGE_MS   = 30 * 24 * 60 * 60 * 1000; // Purge auto > 30 jours

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-72x72.png',
  '/icon-96x96.png',
  '/icon-128x128.png',
  '/icon-144x144.png',
  '/icon-152x152.png',
  '/icon-192x192.png',
  '/icon-384x384.png',
  '/icon-512x512.png',
  '/icon-512x512-maskable.png',
  '/dojo-bg.jpg',
  '/logo.png',
  '/coach.jpg',
  '/bb.jpg',
  '/bb2.jpg'
];

const HEAVY_MEDIA = ['/hero.mp4'];

const CDN_PATTERNS = [
  'cdn.jsdelivr.net/npm/@tensorflow',
  'cdn.jsdelivr.net/npm/@tensorflow-models',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

const SELF_ORIGIN_PATTERNS = [
  /senseiblackbelt\.com$/,
  /www\.senseiblackbelt\.com$/,
  /admin-18000\.github\.io$/,
  /^localhost/,
  /^127\.0\.0\.1/,
  /^192\.168\./
];

// ═══════════════════════════════════════════════════════════
//  INSTALL — précache best-effort (résilient)
// ═══════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Precache skip:', url, err.message)
          )
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════════════════════════
//  ACTIVATE — nettoie anciens caches + purge entrées vieilles
// ═══════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // 1. Supprimer les caches obsolètes (anciens noms de version)
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME && key !== CDN_CACHE_NAME && key !== MEDIA_CACHE)
            .map(key => caches.delete(key))
        )
      ),
      // 2. Purger les entrées trop vieilles du cache principal (> 30 jours)
      purgeOldEntries(CACHE_NAME, CACHE_MAX_AGE_MS)
    ]).then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════════════════
//  FETCH — stratégies différenciées
// ═══════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  // CDN TF.js + Fonts → Cache-First (peuvent être re-téléchargés en cas de miss)
  if (CDN_PATTERNS.some(p => url.href.indexOf(p) > -1)) {
    event.respondWith(cdnCacheFirst(request));
    return;
  }

  // Filtre : ne gérer que nos propres domaines
  const isOwnOrigin = SELF_ORIGIN_PATTERNS.some(p => p.test(url.hostname));
  if (!isOwnOrigin) return;

  // Media lourd (hero.mp4) → Cache-First avec cache dédié
  if (HEAVY_MEDIA.some(m => url.pathname === m || url.pathname.endsWith(m))) {
    event.respondWith(mediaCacheFirst(request));
    return;
  }

  // index.html → Network-First STRICT avec timeout (garantit fraîcheur)
  if (url.pathname === '/' || url.pathname.endsWith('index.html')) {
    event.respondWith(networkFirstStrict(request));
    return;
  }

  // Autres assets → Stale-While-Revalidate (auto-rafraîchi en arrière-plan)
  event.respondWith(staleWhileRevalidate(request));
});

// ═══════════════════════════════════════════════════════════
//  MESSAGE — permet à la page de forcer une mise à jour
//  (usage optionnel : postMessage({action: 'SKIP_WAITING'}))
// ═══════════════════════════════════════════════════════════
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ═══════════════════════════════════════════════════════════
//  STRATÉGIES
// ═══════════════════════════════════════════════════════════

// Network-First STRICT : tente le réseau avec timeout, fallback cache
async function networkFirstStrict(request) {
  const cache = await caches.open(CACHE_NAME);

  // Créer une promise avec timeout
  const networkPromise = fetch(request).then(response => {
    if (response.ok) {
      // Enregistrer avec timestamp pour purge future
      cache.put(request, addTimestamp(response.clone()));
    }
    return response;
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)
  );

  try {
    // On tente le réseau avec timeout
    return await Promise.race([networkPromise, timeoutPromise]);
  } catch {
    // Fallback : cache si dispo, sinon page offline stylée
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineFallbackHTML();
  }
}

// Stale-While-Revalidate : sert cache immédiat + met à jour en arrière-plan
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, addTimestamp(response.clone()));
    return response;
  }).catch(() => null);

  return cached || networkFetch || new Response('', { status: 404 });
}

// Cache-First CDN : sert cache si dispo, sinon fetch et cache
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

// Cache-First Media : idem mais cache dédié pour hero.mp4
async function mediaCacheFirst(request) {
  const cache = await caches.open(MEDIA_CACHE);
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

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

// Ajoute un header timestamp custom pour tracker l'âge du cache
function addTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('X-SW-Cached-At', Date.now().toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

// Purge automatique des entrées > maxAge
async function purgeOldEntries(cacheName, maxAge) {
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const now = Date.now();
    await Promise.all(requests.map(async req => {
      const response = await cache.match(req);
      if (!response) return;
      const cachedAt = parseInt(response.headers.get('X-SW-Cached-At') || '0', 10);
      if (cachedAt && (now - cachedAt) > maxAge) {
        await cache.delete(req);
      }
    }));
  } catch(e) { /* ignore */ }
}

// Page offline stylée (bilingue)
function offlineFallbackHTML() {
  return new Response(
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
