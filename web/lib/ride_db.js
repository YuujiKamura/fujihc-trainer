// brief 33 atom B: IndexedDB wrapper (= rides store の CRUD + auto-prune).
// schema v1: object store "rides", keyPath "id" (= ISO8601 + suffix), index "by_date".
//
// 設計 notes:
// - indexedDB の low-level (= openRequest / transaction / cursor) を Promise wrapper 化
// - migration は version=1 fresh-create のみ、 oldVersion switch 構造は将来追加用に残す
// - auto-prune は addRide 内、 estimateRideDbBytes > threshold で by_date 昇順 LRU 削除、
//   ただし残数が RIDE_DB_KEEP_MIN を割らない
// - load-bearing 数字 / 文字列は module top 1 箇所のみ export (= NG-R3-3 同型予防)
// - pure module、 caller 側で `globalThis.indexedDB` を inject 可能にして node test を許容

export const RIDE_DB_NAME = 'fujihill-trainer';
export const RIDE_DB_VERSION = 1;
export const RIDE_STORE = 'rides';
export const RIDE_INDEX_DATE = 'by_date';
export const RIDE_DB_AUTO_PRUNE_BYTES = 500 * 1024 * 1024;  // 500MB
export const RIDE_DB_KEEP_MIN = 20;

function getIDB(idbOverride) {
  if (idbOverride) return idbOverride;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  throw new Error('IndexedDB not available in this environment');
}

/** IDBRequest を Promise 化. */
function req2promise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDBRequest error'));
  });
}

/**
 * IndexedDB DB を open し、 必要なら migration を走らせる.
 * @param {{indexedDB?: IDBFactory}} [opts]
 * @returns {Promise<IDBDatabase>}
 */
export function openRideDb(opts = {}) {
  const idb = getIDB(opts.indexedDB);
  return new Promise((resolve, reject) => {
    const req = idb.open(RIDE_DB_NAME, RIDE_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = ev.oldVersion || 0;
      // version=1 で fresh-create のみ。 将来 v2+ で alter したくなったら下に case 追加。
      if (oldVersion < 1) {
        const store = db.createObjectStore(RIDE_STORE, { keyPath: 'id' });
        store.createIndex(RIDE_INDEX_DATE, 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('openRideDb failed'));
    req.onblocked = () => reject(new Error('openRideDb blocked'));
  });
}

/**
 * ride 1 件追加. auto-prune を内部で走らせる.
 * @param {IDBDatabase} db
 * @param {{id: string, date: string, summary: object, trkpts: Array}} rec
 */
export async function addRide(db, rec) {
  if (!rec || typeof rec.id !== 'string') {
    throw new TypeError('addRide: rec.id (string) required');
  }
  const tx = db.transaction(RIDE_STORE, 'readwrite');
  const store = tx.objectStore(RIDE_STORE);
  await req2promise(store.put(rec));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('addRide tx error'));
    tx.onabort = () => reject(tx.error || new Error('addRide tx abort'));
  });
  await maybeAutoPrune(db);
}

/** 全 ride を by_date 降順で返す (= 新しい順). */
export async function listRides(db) {
  const tx = db.transaction(RIDE_STORE, 'readonly');
  const idx = tx.objectStore(RIDE_STORE).index(RIDE_INDEX_DATE);
  const out = [];
  return new Promise((resolve, reject) => {
    const req = idx.openCursor(null, 'prev');  // prev = 降順
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push(cursor.value);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error || new Error('listRides cursor error'));
  });
}

export async function getRide(db, id) {
  const tx = db.transaction(RIDE_STORE, 'readonly');
  const store = tx.objectStore(RIDE_STORE);
  return req2promise(store.get(id));
}

export async function deleteRide(db, id) {
  const tx = db.transaction(RIDE_STORE, 'readwrite');
  const store = tx.objectStore(RIDE_STORE);
  await req2promise(store.delete(id));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('deleteRide tx error'));
  });
}

/**
 * 全 ride の trkpts JSON 長 sum で容量推定 (= navigator.storage.estimate は browser 依存、 ここは pure).
 * @param {IDBDatabase} db
 * @returns {Promise<number>} 推定 byte 数
 */
export async function estimateRideDbBytes(db) {
  const all = await listRides(db);
  let total = 0;
  for (const r of all) {
    try {
      total += JSON.stringify(r).length;  // 概算 byte (= 全角は ×3 にならない、 ASCII 想定で十分)
    } catch {
      // 巡回参照は想定しない、 fail 時は 0 加算 (= 安全側)
    }
  }
  return total;
}

/** addRide 内で呼ぶ. threshold 超で古い順 (= by_date 昇順) に削除. */
async function maybeAutoPrune(db) {
  let total = await estimateRideDbBytes(db);
  if (total <= RIDE_DB_AUTO_PRUNE_BYTES) return;

  // 全 ride を昇順 (古い順) に列挙、 keep_min を割らない範囲で先頭から削除.
  // tx 内で複数 delete を順に発行する (= cursor 内で size 試算しつつ落とす).
  const tx = db.transaction(RIDE_STORE, 'readwrite');
  const idx = tx.objectStore(RIDE_STORE).index(RIDE_INDEX_DATE);

  const countReq = tx.objectStore(RIDE_STORE).count();
  await req2promise(countReq);
  let remaining = countReq.result;

  await new Promise((resolve, reject) => {
    const cursorReq = idx.openCursor(null, 'next');  // next = 昇順
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) { resolve(); return; }
      if (remaining <= RIDE_DB_KEEP_MIN) { resolve(); return; }
      if (total <= RIDE_DB_AUTO_PRUNE_BYTES) { resolve(); return; }
      let recSize = 0;
      try { recSize = JSON.stringify(cursor.value).length; } catch { recSize = 0; }
      cursor.delete();
      remaining -= 1;
      total -= recSize;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error || new Error('prune cursor error'));
  });

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('prune tx error'));
    tx.onabort = () => reject(tx.error || new Error('prune tx abort'));
  });
}
