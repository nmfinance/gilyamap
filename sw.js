/* sw.js · СБОРКА 2 · в этом файле нет и не должно быть никаких токенов.
   Если в вашей копии встречается длинная строка с точками — это чужой файл, замените его. */

/* Service Worker карты «Москва и москвичи».
   Кэширует оболочку приложения, просмотренные тайлы карты и фотографии,
   чтобы карта открывалась без интернета и быстрее грузилась при повторных заходах.
   При обновлении карты меняйте VERSION — старые кэши будут удалены. */

const VERSION      = 'v9';
const APP_CACHE    = 'gilya-app-'   + VERSION;
const TILE_CACHE   = 'gilya-tiles-' + VERSION;
const PHOTO_CACHE  = 'gilya-photos-'+ VERSION;

const TILE_LIMIT   = 800;   // примерно 2–3 прогулки по центру
const PHOTO_LIMIT  = 250;   // фотографий в базе ~99, с запасом

const PRECACHE = [
  './',
  './index.html',
  './points.json',
  './glossary.json',
  './manifest.json',
  './photos/filippov-bakery.jpg',
  './photos/butyrsky-zamok.jpg',
  './photos/vospitatelny-dom.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

/* ---------- установка ---------- */
self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(APP_CACHE).then(function(cache){
      // каждый файл кладём отдельно: если один CDN недоступен, установка не сорвётся
      return Promise.allSettled(PRECACHE.map(function(url){
        return cache.add(new Request(url, {cache:'reload'}));
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

/* ---------- активация: чистим кэши прошлых версий ---------- */
self.addEventListener('activate', function(event){
  const keep = [APP_CACHE, TILE_CACHE, PHOTO_CACHE];
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(n){
        if(n.indexOf('gilya-') === 0 && keep.indexOf(n) === -1) return caches.delete(n);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

/* ---------- вспомогательное: не даём кэшу разрастаться ---------- */
function trimCache(cacheName, maxItems){
  caches.open(cacheName).then(function(cache){
    cache.keys().then(function(keys){
      if(keys.length > maxItems){
        cache.delete(keys[0]).then(function(){ trimCache(cacheName, maxItems); });
      }
    });
  });
}

/* cache-first: сначала кэш, при промахе — сеть с записью в кэш */
function cacheFirst(request, cacheName, limit){
  return caches.match(request).then(function(hit){
    if(hit) return hit;
    return fetch(request).then(function(resp){
      if(resp && (resp.ok || resp.type === 'opaque')){
        const copy = resp.clone();
        caches.open(cacheName).then(function(cache){
          cache.put(request, copy).then(function(){ trimCache(cacheName, limit); });
        });
      }
      return resp;
    }).catch(function(){ return hit; });
  });
}

/* ---------- перехват запросов ---------- */
self.addEventListener('fetch', function(event){
  const req = event.request;
  if(req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch(e){ return; }
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 1. Сама страница: сначала сеть (чтобы видеть обновления), при офлайне — кэш
  if(req.mode === 'navigate'){
    event.respondWith(
      fetch(req).then(function(resp){
        const copy = resp.clone();
        caches.open(APP_CACHE).then(function(c){ c.put('./index.html', copy); });
        return resp;
      }).catch(function(){
        return caches.match('./index.html').then(function(hit){
          return hit || new Response(
            '<meta charset="utf-8"><body style="font-family:sans-serif;padding:2em">' +
            '<h3>Нет подключения к интернету</h3><p>Откройте карту один раз в сети — после этого она будет работать офлайн.</p></body>',
            {headers:{'Content-Type':'text/html; charset=utf-8'}}
          );
        });
      })
    );
    return;
  }

  // 2. Тайлы карты (Mapbox или OpenStreetMap)
  if(url.hostname === 'api.mapbox.com' || url.hostname.endsWith('tile.openstreetmap.org')){
    event.respondWith(cacheFirst(req, TILE_CACHE, TILE_LIMIT));
    return;
  }

  // 3. Фотографии pastvu
  if(url.hostname.endsWith('pastvu.com')){
    event.respondWith(cacheFirst(req, PHOTO_CACHE, PHOTO_LIMIT));
    return;
  }

  // 4. Всё остальное (свои файлы, Leaflet, шрифты): отдаём из кэша, тихо обновляя в фоне
  event.respondWith(
    caches.match(req).then(function(hit){
      const network = fetch(req).then(function(resp){
        if(resp && (resp.ok || resp.type === 'opaque')){
          const copy = resp.clone();
          caches.open(APP_CACHE).then(function(c){ c.put(req, copy); });
        }
        return resp;
      }).catch(function(){ return hit; });
      return hit || network;
    })
  );
});
