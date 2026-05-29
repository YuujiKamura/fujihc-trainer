// ride_autosave: ride 中の進行状態を IndexedDB に定期 save、 reload 時に復元する.
// 2 時間走った ride が壊れる事故 (= 2026-05-15) の 2 重 mitigation。
//
// 設計:
// - 別 DB (= fujihill-trainer-autosave) を用意。 既存 fujihill-trainer (履歴用) と独立、
//   schema 衝突を避ける + 履歴 prune に巻き込まれない。
// - object store "autosave"、 keyPath なし、 fixed key 'current' で 1 件だけ管理。
//   過去 ride に競合する worry が無いので簡素な fixed-key 設計。
// - 内容: { rideStartedAt (ISO), distanceM, courseName, trkpts, lastSavedAt (ISO), ended? }
// - 終了 flag ended=true で saveAutosave すると「未完了 ride」判定から外れる。
//   通常は clearAutosave を呼んで record を消す。

export const AUTOSAVE_DB_NAME = 'fujihill-trainer-autosave';
export const AUTOSAVE_DB_VERSION = 1;
export const AUTOSAVE_STORE = 'autosave';
export const AUTOSAVE_KEY = 'current';
export const AUTOSAVE_INTERVAL_MS = 30 * 1000;

function getIDB(override) {
  if (override) return override;
  if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
  throw new Error('IndexedDB not available');
}

async function openAutosaveDb(opts = {}) {
  const idb = getIDB(opts.indexedDB);
  return new Promise((resolve, reject) => {
    const req = idb.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUTOSAVE_STORE)) {
        db.createObjectStore(AUTOSAVE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('open failed'));
    req.onblocked = () => reject(new Error('blocked'));
  });
}

/**
 * autosave record を保存する. 既存 record は上書き。
 * @param {{
 *   rideStartedAt: string,
 *   distanceM: number,
 *   courseName?: string,
 *   trkpts: Array,
 *   ended?: boolean,
 * }} record
 * @param {{indexedDB?:IDBFactory, now?: () => Date}} [opts]
 */
export async function saveAutosave(record, opts = {}) {
  const db = await openAutosaveDb(opts);
  const now = (opts.now || (() => new Date()))();
  const rec = {
    rideStartedAt: record.rideStartedAt,
    distanceM: Number(record.distanceM) || 0,
    courseName: record.courseName || 'fujihill',
    trkpts: Array.isArray(record.trkpts) ? record.trkpts : [],
    lastSavedAt: now.toISOString(),
    ended: !!record.ended,
  };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE).put(rec, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('put failed'));
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
  db.close();
}

/**
 * autosave record を読み出す.
 * @param {{indexedDB?:IDBFactory}} [opts]
 * @returns {Promise<object|null>}
 */
export async function loadAutosave(opts = {}) {
  let db;
  try {
    db = await openAutosaveDb(opts);
  } catch {
    return null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readonly');
    const req = tx.objectStore(AUTOSAVE_STORE).get(AUTOSAVE_KEY);
    req.onsuccess = () => {
      db.close();
      resolve(req.result || null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('get failed'));
    };
  });
}

/**
 * autosave record を削除する.
 * @param {{indexedDB?:IDBFactory}} [opts]
 */
export async function clearAutosave(opts = {}) {
  let db;
  try {
    db = await openAutosaveDb(opts);
  } catch {
    return;
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(AUTOSAVE_STORE, 'readwrite');
    tx.objectStore(AUTOSAVE_STORE).delete(AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('delete failed'));
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
  db.close();
}

/**
 * 未完了 ride が存在するか. ended !== true で trkpts が 1 件以上あれば true.
 * @param {{indexedDB?:IDBFactory}} [opts]
 * @returns {Promise<boolean>}
 */
export async function hasPendingAutosave(opts = {}) {
  const rec = await loadAutosave(opts);
  if (!rec) return false;
  if (rec.ended === true) return false;
  return Array.isArray(rec.trkpts) && rec.trkpts.length > 0;
}

/**
 * autosave record を rideState (= createRideState の戻り値 shim) に適用し、
 * rider を復元距離・active 状態へ持ち上げる純粋関数.
 *
 * なぜ共有関数か: viewer-map3d.js の applyPendingRestore が record→rideState 変換を
 * 直書きしていたが、 (1) rider.distanceTraveled は getter-only accessor なので
 * `_rider.distanceTraveled = ...` の直接代入は strict mode (= ES module) で TypeError を
 * throw し復元が丸ごと abort していた、 (2) この経路を pin する test が無く嘘の緑のまま
 * 残っていた。 変換を 1 本の export 関数に集約し、 viewer と test が同じ経路を叩く。
 *
 * record は IndexedDB という信頼境界外ストア由来なので型を検証する:
 *   - distanceM が有限数でなければ復元しない (= null を返す)
 *   - trkpts が配列でなければ空として扱う
 * distance のセットは rider.placeAtDistance() 経由 (= clampDist でコース範囲に丸める).
 *
 * @param {{start:Function, appendTrkpt:Function, _rider:object}} rideState
 * @param {{distanceM:number, trkpts?:Array}} rec
 * @returns {{distanceM:number, trkptCount:number}|null} 適用不可なら null
 */
export function applyAutosaveToRideState(rideState, rec) {
  if (!rideState || !rideState._rider
      || typeof rideState.start !== 'function'
      || typeof rideState.appendTrkpt !== 'function'
      || typeof rideState._rider.placeAtDistance !== 'function') {
    return null;
  }
  if (!rec || !Number.isFinite(rec.distanceM)) return null;
  rideState.start();
  rideState._rider.placeAtDistance(rec.distanceM);
  const trkpts = Array.isArray(rec.trkpts) ? rec.trkpts : [];
  for (const tp of trkpts) {
    if (!tp || typeof tp !== 'object') continue;
    rideState.appendTrkpt({ t: tp.t, power: tp.power, cad: tp.cad, hr: tp.hr });
  }
  return { distanceM: rideState._rider.distanceTraveled, trkptCount: trkpts.length };
}
