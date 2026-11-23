
const CACHE = 'mon-app-safearea-v105';
const SHELL = [
  './', 'index.html', 'manifest.json', 'style.css', 'config.js', 'db.js', 'ui.js', 'app.js',
  'view-train.js', 'view-notes.js', 'view-budget.js', 'view-budget-extra.js', 'view-budget-banks.js', 'view-supp.js', 'view-profile.js', 'view-settings.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        SHELL.map(async (url) => {
          const res = await fetch(url, { cache: 'no-store' });
          if (res && res.status === 200) await cache.put(url, res);
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Les fichiers statiques sont préchargés à l'installation et servis localement.
// Les pages de navigation restent réseau d'abord pour récupérer les nouvelles versions.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'esm.sh';
  if (!sameOrigin && !cdn) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (sameOrigin && req.mode !== 'navigate') {
      const cached = await cache.match(req);
      if (cached) return cached;
    }
    try {
      const res = await fetch(req);
      if (res.ok && (sameOrigin || cdn)) {
        e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      }
      return res;
    } catch (_) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (sameOrigin && req.mode === 'navigate') {
        const fallback = await cache.match('index.html');
        if (fallback) return fallback;
      }
      return new Response('Ressource indisponible', { status: 503 });
    }
  })());
});
