// Only public card artwork belongs in this durable cache, never game state.
const CACHE = 'tarok-card-art-v1';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !/^\/cards\/.+\.(jpg|png)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE).catch(() => null);
    const saved = await cache?.match(event.request).catch(() => null);
    if (saved) return saved;
    const response = await fetch(event.request);
    if (cache && response.ok && response.headers.get('content-type')?.startsWith('image/')) {
      await cache.put(event.request, response.clone()).catch(() => {});
    }
    return response;
  })());
});
