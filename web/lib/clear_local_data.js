// brief 34 ε-5: 「このサイトの全データを削除」機能の core module.
//
// 削除対象:
// - IndexedDB (= fujihill-trainer DB の全 store)
// - localStorage (= consent / Strava token / client_id / trainer.address / 設定スライダ値 等、 全 key)
// - Strava 側 token invalidate は client side では不可 (= CORS、 strava_oauth.js:185 comment 同期)。
//   削除完了後 dialog で Strava 設定ページへの導線を再提示する (= index.html:343 link 既存)。
//
// 設計:
// - pure module、 caller (= viewer-maplibre.js) から「実行確認」が済んだ後にのみ呼ばれる前提
// - confirm dialog は viewer 側で既存 #confirm-overlay (z=1700) を流用する (= B 軸 7 (c) 対策)
// - storage / indexedDB は inject 可能 (= node test 用)

import { RIDE_DB_NAME } from './ride_db.js';

/**
 * IndexedDB の fujihill-trainer DB を削除する.
 * @param {{indexedDB?: IDBFactory|null}} [opts] indexedDB に明示 null を渡せば「不在環境」として扱う、
 *   undefined / 未指定なら globalThis.indexedDB に fallback。
 * @returns {Promise<{deleted: boolean, error?: string}>}
 */
export function deleteIndexedDb(opts = {}) {
  // null 明示 = 不在環境シミュレーション、 undefined / 未指定 = globalThis fallback。
  // (両者を区別するため `opts.indexedDB === null` を明示 check.)
  let idb;
  if (opts.indexedDB === null) {
    idb = null;
  } else if (opts.indexedDB !== undefined) {
    idb = opts.indexedDB;
  } else {
    idb = (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  }
  if (!idb) return Promise.resolve({ deleted: false, error: 'IndexedDB not available' });
  return new Promise((resolve) => {
    let req;
    try {
      req = idb.deleteDatabase(RIDE_DB_NAME);
    } catch (err) {
      resolve({ deleted: false, error: err && err.message ? err.message : String(err) });
      return;
    }
    req.onsuccess = () => resolve({ deleted: true });
    req.onerror = () => resolve({ deleted: false, error: (req.error && req.error.message) || 'deleteDatabase failed' });
    req.onblocked = () => resolve({ deleted: false, error: 'blocked (= 他 tab が DB を open 中)' });
  });
}

/**
 * localStorage を全削除. clear() は同一 origin の **全** key を消すので、
 * 他アプリと localStorage を共有してる origin では危険、 ただし本アプリは
 * `${BASE_PATH}` 配下に閉じる前提なので clear で OK。 (B 軸 7 (c) 対策で
 * 確認 dialog は viewer 側で実施済。)
 * @param {{storage?: Storage}} [opts]
 * @returns {{cleared: boolean, error?: string}}
 */
export function clearAllLocalStorage(opts = {}) {
  const ls = opts.storage
    || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return { cleared: false, error: 'localStorage not available' };
  try {
    // clear() がある standard browser、 無ければ既知 key の removeItem 列挙で fallback.
    if (typeof ls.clear === 'function') {
      ls.clear();
    } else {
      // 既知 key を網羅的に list (= 将来 key 追加時はここに足す).
      const knownKeys = [
        'fujihill.consent.intro.v1',
        'fujihill.consent.ride.v1',
        'fujihill.diff',
        'fujihill.spd',
        'fujihill.trainer.address',
        'fujihill.strava.client_id',
        'fujihill.strava.token',
      ];
      for (const k of knownKeys) ls.removeItem(k);
    }
    return { cleared: true };
  } catch (err) {
    return { cleared: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * 全データ削除を実行する (= IndexedDB + localStorage). caller (viewer) は事前に確認 dialog で
 * user の意思を確定してからこの関数を呼ぶこと。 sessionStorage / cookie は対象外 (= 元々不使用).
 *
 * Strava 側 token は revoke できないため、 削除完了後 dialog で Strava 設定ページの link を
 * 提示する責務は caller 側にある (= index.html:343 既存 link を確認 dialog で再表示).
 *
 * @param {{storage?: Storage, indexedDB?: IDBFactory}} [opts]
 * @returns {Promise<{indexedDb: {deleted: boolean, error?: string}, localStorage: {cleared: boolean, error?: string}}>}
 */
export async function clearAllLocalData(opts = {}) {
  const idbRes = await deleteIndexedDb({ indexedDB: opts.indexedDB });
  const lsRes = clearAllLocalStorage({ storage: opts.storage });
  return { indexedDb: idbRes, localStorage: lsRes };
}

/**
 * brief b43: Service Worker を unregister し CacheStorage を全削除する
 * (= アプリ本体コードのキャッシュを捨てて最新版に更新する)。
 *
 * **非破壊**: IndexedDB / localStorage には触らない。 ride 履歴・設定・タイルの一次
 * キャッシュ (= IndexedDB TileCache) は残る。「全データ削除」(= clearAllLocalData)
 * とは別操作。 deleteIndexedDb / clearAllLocalStorage を呼ばないことで非破壊を構造的に担保。
 *
 * viewer-maplibre.js の `?nosw=1` URL パラメータ経路と「アプリを最新版に更新」 ボタンの
 * 両方がこの 1 関数を呼ぶ (= SW クリアロジックの 1 本化、 双子コピペ回避)。
 *
 * @param {{serviceWorker?: ServiceWorkerContainer|null, caches?: CacheStorage|null}} [opts]
 *   serviceWorker / caches に明示 null を渡せば「不在環境」 として扱う。 undefined / 未指定なら
 *   navigator.serviceWorker / globalThis.caches に fallback。
 * @returns {Promise<{unregistered:number, cachesDeleted:number, error?:string}>}
 */
export async function clearServiceWorkerCache(opts = {}) {
  // null 明示 = 不在環境シミュレーション、 undefined / 未指定 = global fallback。
  let sw;
  if (opts.serviceWorker === null) {
    sw = null;
  } else if (opts.serviceWorker !== undefined) {
    sw = opts.serviceWorker;
  } else {
    sw = (typeof navigator !== 'undefined' && navigator.serviceWorker) ? navigator.serviceWorker : null;
  }
  let cacheStore;
  if (opts.caches === null) {
    cacheStore = null;
  } else if (opts.caches !== undefined) {
    cacheStore = opts.caches;
  } else {
    cacheStore = (typeof globalThis !== 'undefined' && globalThis.caches) ? globalThis.caches : null;
  }

  let unregistered = 0;
  let cachesDeleted = 0;
  const errors = [];

  // SW registration を全件 unregister。 失敗は throw せず error に畳む (= deleteIndexedDb と同作法)。
  if (sw) {
    try {
      const regs = await sw.getRegistrations();
      for (const reg of regs || []) {
        try {
          await reg.unregister();
          unregistered += 1;
        } catch (err) {
          errors.push(`unregister: ${err && err.message ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`getRegistrations: ${err && err.message ? err.message : String(err)}`);
    }
  }

  // CacheStorage を全 key 削除。
  if (cacheStore) {
    try {
      const keys = await cacheStore.keys();
      for (const k of keys || []) {
        try {
          await cacheStore.delete(k);
          cachesDeleted += 1;
        } catch (err) {
          errors.push(`caches.delete: ${err && err.message ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`caches.keys: ${err && err.message ? err.message : String(err)}`);
    }
  }

  const result = { unregistered, cachesDeleted };
  if (errors.length > 0) result.error = errors.join('; ');
  return result;
}
