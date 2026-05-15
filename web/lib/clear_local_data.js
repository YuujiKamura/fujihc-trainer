// brief 34 ε-5: 「このサイトの全データを削除」機能の core module.
//
// 削除対象:
// - IndexedDB (= fujihc-trainer DB の全 store)
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
 * IndexedDB の fujihc-trainer DB を削除する.
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
        'fujihc.consent.intro.v1',
        'fujihc.consent.ride.v1',
        'fujihc.diff',
        'fujihc.spd',
        'fujihc.trainer.address',
        'fujihc.strava.client_id',
        'fujihc.strava.token',
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
