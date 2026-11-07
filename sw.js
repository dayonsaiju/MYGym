const C = 'mygym-core-v6.3.0';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './style.css?v=6.3.0',
  './shell.js',
  './shell.js?v=6.3.0',
  './calc.js',
  './calc.js?v=6.3.0',
  './ai-config.js',
  './ai-config.js?v=6.3.0',
  './ai-config.js',
  './ai-config.js?v=6.2.0',
  './app.js',
  './app.js?v=6.3.0',
  './manifest.json',
  './icon.png',
  './exercises.json',
  'exercises.json'
];
const CORE_ASSETS = Array.from(new Set(ASSETS));

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(C).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', e => {
  // Safe Offline Cache Purge: verify new cache integrity before purging old caches
  e.waitUntil(
    caches.has(C).then(hasNewCache => {
      if (!hasNewCache) return clients.claim();
      return caches.open(C).then(cache => {
        return cache.match('./index.html').then(match => {
          if (match) {
            return caches.keys().then(keys => Promise.all(
              keys.filter(k => k !== C).map(k => caches.delete(k))
            ));
          }
        });
      }).then(() => clients.claim());
    })
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
