const C = 'lift-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png',
  './exercises.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(C).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== C).map(k => caches.delete(k))
    )).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      
      return fetch(e.request).then(response => {
        // Cache valid local media or core assets on the fly
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(C).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html').then(fallback => fallback || caches.match('./'));
        }
      });
    })
  );
});
