const C = 'mygym-core-v5.5.1-fix';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './style.css?v=5.5.1',
  './app.js',
  './app.js?v=5.5.1',
  './manifest.json',
  './icon.png',
  './exercises.json',
  'exercises.json'
];
const CORE_ASSETS = ASSETS;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(C).then(cache => cache.addAll(CORE_ASSETS))
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
  
  // HTML Navigation: Network-first to always fetch latest shell updates when online,
  // falling back to offline cached index.html immediately.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(C).then(cache => cache.put('./index.html', clone));
        }
        return response;
      }).catch(() => caches.match('./index.html').then(fallback => fallback || caches.match('./')))
    );
    return;
  }

  // Versioned scripts/styles & static assets: Cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      
      return fetch(e.request).then(response => {
        // Cache media and valid GET requests on the fly
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          const clone = response.clone();
          caches.open(C).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback to precached exercises.json if offline or alternate path
        if (e.request && e.request.url && e.request.url.includes('exercises.json')) {
          return caches.match('./exercises.json').then(fb => fb || caches.match('exercises.json'));
        }
      });
    })
  );
});
