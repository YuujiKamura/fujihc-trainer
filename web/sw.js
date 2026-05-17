// 2026-05-16: service worker (= browser のローカル DB に tile / pmtiles / course.json /
// lib / vendor 等の静的資産を永続保存、 2 回目以降の起動を速く / オフライン可に).
//
// user 苛立ち「毎回タイルを並べる手間」 への対応。 過去 user 意思 (2026-05-14 訂正)
// 「ローカル DB にタイルを整備したらダメなんか?」 の実装。
//
// 2026-05-17: 取得戦略を 2 つに分けた。
//   - アプリ本体 (html / js / css) は **network-first** ── 毎回まず network から最新を取り、
//     失敗した時だけ cache に fallback する。 旧来は全 URL cache-first で、 コードを変えても
//     SW が古い cache を返し続け「新しい版に切り替わらない」 罠があった (= version bump を
//     忘れると修正がブラウザに永久に届かない)。 network-first なら online の限り常に最新。
//   - tile / pmtiles / dem / json / 画像 等の重い静的資産は従来どおり **cache-first**
//     (= 2 回目以降 fetch ゼロ、 オフライン起動可)。
// version bump (CACHE_NAME) は cache 全消しの強制リセット手段として残す。

const CACHE_NAME = 'fujihill-v10';

// install 時に一括取得する static 資産。 dynamic な tile / pmtiles は事前リスト不可、
// fetch handler 側で cache-on-demand する (= 走った tile から順に永続化)。
const PRECACHE_URLS = [
  './',
  './index.html',
  './viewer-maplibre.js?v=38',
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

// アプリ本体 = html / js / css。 これらは network-first で常に最新を取りに行く。
function isAppShell(pathname) {
  return pathname === '/' || /\.(html|js|css)$/.test(pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // GET 以外、 同 origin 以外、 chrome-extension 等は skip.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isAppShell(url.pathname)) {
    // network-first: まず network から最新を取り、 成功したら cache を更新して返す。
    // network 失敗 (= オフライン) の時だけ cache に fallback。 これで「コードを変えたのに
    // 古い版が出続ける」 cache-first の罠が起きない。
    // terrain3d.html / lib/terrain3d.js も .html/.js なのでここに入り network-first =
    // 活発に変更中の Path B 実験ページも online の限り常に最新版が出る。
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const resp = await fetch(req);
          if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
          return resp;
        } catch (err) {
          const hit = await cache.match(req);
          if (hit) return hit;
          throw err;
        }
      })
    );
    return;
  }

  // cache-first: tile / pmtiles / dem / json / 画像 等の重い静的資産。
  // 同じ URL を 1 回でも cache に入れたら、 以降 fetch ゼロ。
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const resp = await fetch(req);
        // 成功 response のみ cache に入れる (= 4xx / 5xx は cache しない)。
        // partial content (= Range request) も入れて pmtiles の効率を保つ。
        if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      } catch (err) {
        // network 失敗時は cache miss なら browser 標準の network error を素直に投げ返す。
        throw err;
      }
    })
  );
});
