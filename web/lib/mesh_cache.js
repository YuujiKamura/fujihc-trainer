// brief 34 ε-F: terrain mesh / road polygon の計算結果を IndexedDB に永続化する小さな KV cache.
//
// 目的: 旧 JS viewer の「2 回目以降の起動 = 計算スキップ」 を支える substrate。
// course / data がほぼ不変 (= 富士ヒル course 固定) であるため、 course hash を key に
// (a) terrain mesh の Float32Array / Uint32Array、 (b) 道路 polygon の GeoJSON FeatureCollection
// を value として保存しておくと、 2 回目以降は計算経路を完全に bypass できる。
//
// 設計 notes:
// - DB / store 名前は ride_db.js (= 'fujihill-trainer' / 'rides') と完全分離。
//   schema 変更時に rides DB に migration が伝染するのを避ける (= NG-R3-3 同型予防)。
// - value は { kind, hash, arrays, t } の plain object、 IndexedDB の structured-clone
//   が TypedArray (Float32Array / Uint32Array 等) と plain JSON (GeoJSON Feature) の
//   両方を **byte-identical** に保存できる。 自前 serialize / deserialize は書かない。
// - IndexedDB が無い環境 (= test の一部 / SSR) では get → null、 set → no-op、
//   clear → no-op。 例外は吐かない。 cache miss と同義に倒して、 上流 (= viewer) に
//   既存経路を走らせる。
// - computeCourseHash は SHA256 を使わない軽量な fingerprint (= 長さ + 末尾 distance +
//   先頭 lat/lon)。 同一 course を一意特定できれば十分、 collisions は別 kind / version
//   bump で剥がす運用。

export const MESH_DB_NAME = 'fujihill-mesh-cache';
export const MESH_DB_VERSION = 1;
export const MESH_STORE = 'meshes';

function getIDB(idbOverride) {
  if (idbOverride) return idbOverride;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  return null;
}

function req2promise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDBRequest error'));
  });
}

function openMeshDb(opts = {}) {
  const idb = getIDB(opts.indexedDB);
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = idb.open(MESH_DB_NAME, MESH_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion || 0;
      if (oldVersion < 1) {
        // keyPath は { hash, kind } 複合 ── store.put({ hash, kind, arrays, t }) で
        // 同 hash + 異 kind が併存できる。 IDB の複合 keyPath は array string で指定。
        db.createObjectStore(MESH_STORE, { keyPath: ['hash', 'kind'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('openMeshDb failed'));
    req.onblocked = () => reject(new Error('openMeshDb blocked'));
  });
}

/**
 * cache から読む. miss / 不在 / 例外いずれも null を返す (= 上流に既存経路を走らせる).
 *
 * @param {string} courseHash
 * @param {string} kind  - 'terrain' | 'polygon' | 自由文字列
 * @param {{indexedDB?: IDBFactory}} [opts]
 * @returns {Promise<{kind:string, hash:string, arrays:object, t:number} | null>}
 */
export async function getMeshCache(courseHash, kind, opts = {}) {
  if (!courseHash || !kind) return null;
  let db;
  try {
    db = await openMeshDb(opts);
  } catch { return null; }
  if (!db) return null;
  try {
    const tx = db.transaction(MESH_STORE, 'readonly');
    const store = tx.objectStore(MESH_STORE);
    const rec = await req2promise(store.get([courseHash, kind]));
    return rec || null;
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

/**
 * cache に書く. IDB 不在環境では no-op、 例外は throw せず false を返す.
 *
 * arrays は { vertices: Float32Array, indices: Uint32Array, ... } のような
 * TypedArray hash でも、 GeoJSON FeatureCollection のような plain JSON でも可。
 * structured-clone が TypedArray を byte-identical に保存する。
 *
 * @returns {Promise<boolean>} 成功で true、 IDB 不在 / 例外で false.
 */
export async function setMeshCache(courseHash, kind, arrays, opts = {}) {
  if (!courseHash || !kind) return false;
  let db;
  try {
    db = await openMeshDb(opts);
  } catch { return false; }
  if (!db) return false;
  try {
    const tx = db.transaction(MESH_STORE, 'readwrite');
    const store = tx.objectStore(MESH_STORE);
    await req2promise(store.put({ hash: courseHash, kind, arrays, t: Date.now() }));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('setMeshCache tx error'));
      tx.onabort = () => reject(tx.error || new Error('setMeshCache tx abort'));
    });
    return true;
  } catch {
    return false;
  } finally {
    try { db.close(); } catch {}
  }
}

/**
 * 全 entry を破棄. version bump / user 操作 (= 「キャッシュクリア」 button) で呼ぶ.
 * IDB 不在環境では no-op.
 */
export async function clearMeshCache(opts = {}) {
  let db;
  try {
    db = await openMeshDb(opts);
  } catch { return false; }
  if (!db) return false;
  try {
    const tx = db.transaction(MESH_STORE, 'readwrite');
    const store = tx.objectStore(MESH_STORE);
    await req2promise(store.clear());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('clearMeshCache tx error'));
      tx.onabort = () => reject(tx.error || new Error('clearMeshCache tx abort'));
    });
    return true;
  } catch {
    return false;
  } finally {
    try { db.close(); } catch {}
  }
}

/**
 * course.json の軽量 fingerprint. SHA256 ではなく以下 3 要素の決定論的 concat:
 *   - course.length
 *   - 末尾 point の distance_m (= course 総距離、 fixed-precision)
 *   - 先頭 point の lat,lon (= course 開始地点、 fixed-precision)
 *
 * 富士ヒル course のような「同じ data を毎回読む」 use case では、 この 3 要素が
 * 変われば確実に別の course、 同じなら同じ course と見なせる。 collision risk は
 * 別 course を同 fingerprint と誤判定するのみで、 course / kind / version で覆える。
 *
 * @param {Array} courseJson - course point の配列 (= { lat, lon, distance_m, ... })
 * @returns {string} fingerprint 文字列、 入力不正時は空文字列.
 */
export function computeCourseHash(courseJson) {
  if (!Array.isArray(courseJson) || courseJson.length === 0) return '';
  const n = courseJson.length;
  const last = courseJson[n - 1] || {};
  const first = courseJson[0] || {};
  const lastDist = Number.isFinite(last.distance_m) ? last.distance_m.toFixed(2) : 'na';
  const firstLat = Number.isFinite(first.lat) ? first.lat.toFixed(6) : 'na';
  const firstLon = Number.isFinite(first.lon) ? first.lon.toFixed(6) : 'na';
  return `n${n}-d${lastDist}-${firstLat},${firstLon}`;
}
