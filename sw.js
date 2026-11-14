const C = 'mygym-core-v8.0.1';
const MEDIA_CACHE = 'mygym-media-v1';

const CORE_SHELL = [
  './',
  './index.html',
  './style.css',
  './style.css?v=8.0.1',
  './shell.js',
  './shell.js?v=8.0.1',
  './calc.js',
  './calc.js?v=8.0.1',
  './ai-config.js',
  './ai-config.js?v=8.0.1',
  './app.js',
  './app.js?v=8.0.1',
  './vendor/three.module.js',
  './vendor/three.module.js?v=8.0.1',
  './manifest.json'
];

const OPTIONAL_DATA = [
  './icon.png',
  './exercises.json',
  'exercises.json'
];

const ASSETS = [
  ...CORE_SHELL,
  './icon.png',
  './exercises.json',
  'exercises.json'
];

const CORE_ASSETS = Array.from(new Set(CORE_SHELL));

// Helper: Trim media cache to max items (~250 items / ~150MB)
async function trimCache(cacheName, maxItems = 250) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const deleteCount = keys.length - maxItems;
      for (let i = 0; i < deleteCount; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (_) {}
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(C).then(cache => {
      // 1. Core shell assets cached atomically
      return cache.addAll(CORE_ASSETS).then(() => {
        // 2. Larger/optional assets cached via allSettled so missing asset never aborts install
        return Promise.allSettled(
          OPTIONAL_DATA.map(url => cache.add(url).catch(() => null))
        );
      });
    })
  );
});

self.addEventListener('activate', e => {
  // Safe Offline Cache Purge: verify new cache integrity before purging old caches
  // NEVER purge MEDIA_CACHE (mygym-media-v1) across app updates
  e.waitUntil(
    caches.has(C).then(hasNewCache => {
      if (!hasNewCache) return clients.claim();
      return caches.open(C).then(cache => {
        return cache.match('./index.html').then(match => {
          if (match) {
            return caches.keys().then(keys => Promise.all(
              keys.filter(k => k !== C).filter(k => k !== MEDIA_CACHE).map(k => caches.delete(k))
            ));
          }
        });
      }).then(() => clients.claim());
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // 1. Exercise Images & GIFs: Dedicated persistent media cache (mygym-media-v1)
  if (url.includes('/media/')) {
    e.respondWith(
      caches.open(MEDIA_CACHE).then(mediaCache => {
        return mediaCache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(response => {
            if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
              mediaCache.put(e.request, response.clone());
              trimCache(MEDIA_CACHE, 250);
            }
            return response;
          }).catch(() => cached || null);
        });
      })
    );
    return;
  }

  // 2. HTML Navigation: 2.5s network timeout falling back immediately to cached ./index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(C).then(cache => cache.put('./index.html', clone));
          }
          return response;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('nav_timeout')), 2500))
      ]).catch(() => caches.match('./index.html').then(fallback => fallback || caches.match('./')))
    );
    return;
  }

  // 3. Versioned scripts/styles & static assets: Cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(response => {
        // Cache valid GET requests on the fly in core cache
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          const clone = response.clone();
          caches.open(C).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback to precached exercises.json if offline or alternate path
        if (url && url.includes('exercises.json')) {
          return caches.match('./exercises.json').then(fb => fb || caches.match('exercises.json'));
        }
      });
    })
  );
});
