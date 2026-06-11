/**
 * Shoplixo Service Worker — sw.js
 * Cache Strategy:
 *   HTML        → Network First  (fresh always, offline fallback)
 *   API calls   → Network Only   (real-time, never cached)
 *   Images      → Cache First    (1-week expiry)
 *   Fonts/CSS/JS→ Cache First    (1-month expiry)
 */

const CACHE_VERSION   = 'v2';
const STATIC_CACHE    = `shoplixo-static-${CACHE_VERSION}`;
const IMG_CACHE       = `shoplixo-images-${CACHE_VERSION}`;
const DYNAMIC_CACHE   = `shoplixo-dynamic-${CACHE_VERSION}`;

const ALL_CACHES = [STATIC_CACHE, IMG_CACHE, DYNAMIC_CACHE];

/** Pages to pre-cache on install (App Shell) */
const APP_SHELL = [
  '/',
  '/index.html',
  '/profile.html',
  '/track-order.html',
  '/404.html',
];

/** Max age constants (in seconds) */
const ONE_WEEK  = 7  * 24 * 60 * 60 * 1000;
const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────
// INSTALL — pre-cache App Shell
// ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching App Shell…');
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log('[SW] App Shell cached successfully.');
      })
      .catch((err) => {
        console.warn('[SW] App Shell caching failed (some pages may not exist yet):', err);
      })
  );
  // Activate immediately without waiting for old SW to release
  self.skipWaiting();
});

// ─────────────────────────────────────────────
// ACTIVATE — purge stale caches
// ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((existingCaches) => {
      return Promise.all(
        existingCaches
          .filter((cacheName) => !ALL_CACHES.includes(cacheName))
          .map((staleCacheName) => {
            console.log('[SW] Deleting stale cache:', staleCacheName);
            return caches.delete(staleCacheName);
          })
      );
    })
  );
  // Take control of all open pages immediately
  self.clients.claim();
});

// ─────────────────────────────────────────────
// FETCH — routing strategies
// ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip non-http(s) requests (chrome-extension:// etc.)
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // ── 1. API calls → Network Only (never cache) ──
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'offline', message: 'আপনি offline আছেন। API তে পৌঁছানো সম্ভব হয়নি।' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // ── 2. Images → Cache First with 1-week expiry ──
  if (request.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?.*)?$/.test(url.pathname)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const cached = await cache.match(request);

        if (cached) {
          // Check expiry header stored alongside the cached response
          const cachedDate = cached.headers.get('sw-cached-date');
          if (cachedDate && (Date.now() - parseInt(cachedDate, 10)) < ONE_WEEK) {
            return cached;
          }
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            // Clone and store with a custom timestamp header
            const responseToCache = new Response(await networkResponse.clone().blob(), {
              status: networkResponse.status,
              statusText: networkResponse.statusText,
              headers: {
                ...Object.fromEntries(networkResponse.headers.entries()),
                'sw-cached-date': Date.now().toString(),
              },
            });
            cache.put(request, responseToCache);
          }
          return networkResponse;
        } catch {
          // Return stale cached image if available
          if (cached) return cached;
          // Fallback: transparent 1x1 pixel PNG
          return new Response(
            atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
            { status: 200, headers: { 'Content-Type': 'image/png' } }
          );
        }
      })
    );
    return;
  }

  // ── 3. Fonts / CSS / JS → Cache First with 1-month expiry ──
  if (
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    /\.(woff2?|ttf|otf|eot|css|js)(\?.*)?$/.test(url.pathname) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdnjs.cloudflare.com'
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);

        if (cached) {
          const cachedDate = cached.headers.get('sw-cached-date');
          if (cachedDate && (Date.now() - parseInt(cachedDate, 10)) < ONE_MONTH) {
            return cached;
          }
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            const responseToCache = new Response(await networkResponse.clone().blob(), {
              status: networkResponse.status,
              statusText: networkResponse.statusText,
              headers: {
                ...Object.fromEntries(networkResponse.headers.entries()),
                'sw-cached-date': Date.now().toString(),
              },
            });
            cache.put(request, responseToCache);
          }
          return networkResponse;
        } catch {
          if (cached) return cached;
          return new Response('', { status: 404 });
        }
      })
    );
    return;
  }

  // ── 4. HTML Page Navigation → Network First, cache fallback ──
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache the fresh page for offline use
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // Offline: try exact URL match first
          const cached = await caches.match(request);
          if (cached) return cached;

          // Fallback: serve cached homepage
          const homePage = await caches.match('/index.html') || await caches.match('/');
          if (homePage) return homePage;

          // Last resort: offline page
          return new Response(
            `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Offline | Shoplixo</title>
  <style>
    body{font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F7F7FC;text-align:center;padding:24px}
    h1{font-size:2rem;color:#E41E26;margin-bottom:.5rem}
    p{color:#4A4A6A;margin-bottom:1.5rem}
    a{background:#E41E26;color:#fff;padding:12px 28px;border-radius:9999px;text-decoration:none;font-weight:700;display:inline-block}
  </style>
</head>
<body>
  <div>
    <div style="font-size:4rem;margin-bottom:1rem">📶</div>
    <h1>আপনি Offline</h1>
    <p>ইন্টারনেট সংযোগ নেই। সংযোগ ফিরে আসলে আবার চেষ্টা করুন।</p>
    <a href="/" onclick="location.reload()">আবার চেষ্টা করুন</a>
  </div>
</body>
</html>`,
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // ── 5. Everything else → Cache First, then Network ──
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch(() => new Response('', { status: 404 }));
    })
  );
});

// ─────────────────────────────────────────────
// BACKGROUND SYNC — offline order queue
// ─────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }
});

async function syncPendingOrders() {
  try {
    const db = await openDB();
    const pendingOrders = await getAllPendingOrders(db);

    for (const order of pendingOrders) {
      try {
        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order.data),
        });

        if (response.ok) {
          await deletePendingOrder(db, order.id);
          console.log('[SW] Synced order:', order.id);
        }
      } catch (err) {
        console.warn('[SW] Failed to sync order:', order.id, err);
      }
    }
  } catch (err) {
    console.warn('[SW] Background sync failed:', err);
  }
}

/** Minimal IndexedDB helpers for order queue */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shoplixo-offline', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function getAllPendingOrders(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('orders', 'readonly');
    const req = tx.objectStore('orders').getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function deletePendingOrder(db, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('orders', 'readwrite');
    const req = tx.objectStore('orders').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─────────────────────────────────────────────
// PUSH NOTIFICATIONS (placeholder)
// ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Shoplixo', body: event.data.text() }; }

  const options = {
    body: data.body || 'নতুন আপডেট আছে!',
    icon: 'https://shoplixo.shop/icon-192.png',
    badge: 'https://shoplixo.shop/icon-192.png',
    tag: data.tag || 'shoplixo-push',
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'দেখুন' },
      { action: 'dismiss', title: 'বন্ধ করুন' },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Shoplixo', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
