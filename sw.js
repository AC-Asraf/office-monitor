// Service Worker for Office Monitor PWA
const CACHE_NAME = 'office-monitor-v5';
const STATIC_ASSETS = [
  '/',
  '/dashboard.html',
  '/settings.html',
  '/reports.html',
  '/topology.html',
  '/3d-view.html',
  '/3d-floor-view.html',
  '/manifest.json'
];

// Install event - cache static assets individually to handle failures gracefully
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each asset individually - don't fail entire install if one fails
      return Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { credentials: 'omit' });
            // Only cache successful responses (2xx)
            if (response.ok) {
              await cache.put(url, response);
            }
          } catch (e) {
            // Silently ignore fetch failures during install
            console.log(`SW: Could not cache ${url}:`, e.message);
          }
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API requests (always fetch fresh)
  if (event.request.url.includes('/api/')) return;

  // Skip WebSocket requests
  if (event.request.url.startsWith('ws://') || event.request.url.startsWith('wss://')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful responses (2xx) - don't cache 401s or errors
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Office Monitor Alert';
  const options = {
    body: data.body || 'A device status has changed',
    icon: '/manifest.json',
    badge: '/manifest.json',
    vibrate: [200, 100, 200],
    tag: data.tag || 'office-monitor',
    data: data.url || '/dashboard.html'
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || '/dashboard.html')
  );
});
