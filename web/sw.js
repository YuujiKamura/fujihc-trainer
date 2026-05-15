// 2026-05-16: service worker (= browser のローカル DB に tile / pmtiles / course.json /
// lib / vendor 等の静的資産を永続保存、 2 回目以降 fetch ゼロ で起動).
//
// user 苛立ち「毎回タイルを並べる手間」 への対応。 過去 user 意思 (2026-05-14 訂正)
// 「ローカル DB にタイルを整備したらダメなんか?」 の実装。 Cache Storage は内部で
// IndexedDB を使う browser 標準の永続ストレージ、 SW install 時に一括 download、
// fetch 時に cache-first で抜く。
//
// scope は SW を register した path の階層、 起動 origin 配下全部を覆う想定。
// 強制更新は version bump (= CACHE_NAME の suffix を変える) で旧 cache を消す。

const CACHE_NAME = 'fujihill-v1';

// install 時に一括取得する static 資産。 dynamic な tile / pmtiles は事前リスト不可、
// fetch handler 側で cache-on-demand する (= 走った tile から順に永続化)。
const PRECACHE_URLS = [
  './',
  './index.html',
  './viewer-maplibre.js?v=30',
  './course.json',
  './static/course.json',
  './static/map.pmtiles',
  './lib/vendor/maplibre-gl.js',
  './lib/vendor/maplibre-gl.css',
  './lib/vendor/pmtiles.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // 個別に addAll、 1 件失敗で全部失敗を避けるため Promise.allSettled で best-effort.
      return Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // GET 以外、 同 origin 以外、 chrome-extension 等は skip.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // cache-first: 同じ URL を 1 回でも cache に入れたら、 以降 fetch ゼロ。
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        // 成功 response のみ cache に入れる (= 4xx / 5xx は cache しない)。
        if (resp && resp.ok) {
          // GSI dem tile / pmtiles range / 個別 tile を含む全 path を cache-on-demand。
          // partial content (= Range request) も入れて pmtiles の効率を保つ。
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch (err) {
        // network 失敗時は cache miss なら 503 風 response、 ただし 404 と区別困難なので
        // browser 標準の network error を素直に投げ返す。
        throw err;
      }
    })
  );
});
