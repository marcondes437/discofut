// Service worker: rede primeiro, cache como reserva. Depois de carregar o
// jogo uma vez, o treino offline continua abrindo mesmo sem servidor/internet.
const CACHE = 'discofut-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api') || url.pathname === '/healthz') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      throw new Error('offline');
    }
  })());
});
