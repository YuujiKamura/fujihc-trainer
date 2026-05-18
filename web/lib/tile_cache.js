// IndexedDB-backed tile cache with per-layer TTL.
// DOM / Three.js 非依存 (= node test 容易)。
//
// openTileCache() は Promise dedup cache を module 内部に持つ。
// 何回 await しても同一 IDBDatabase インスタンスを返す (IDB open は 1 回のみ)。
// 呼び出し側はインスタンスを保持・渡し回しする必要がない。
//
// テスト時は openTileCache({ idbFactory: new IDBFactory() }) で
// 呼び出しごとに独立した DB を使える。

const DB_NAME = 'fujihc-tile-cache';
const DB_VERSION = 1;
const STORE = 'tiles';

export const TILE_TTL_MS = {
  dem_png:        90 * 24 * 3600 * 1000,
  std:            30 * 24 * 3600 * 1000,
  relief:         30 * 24 * 3600 * 1000,
  seamlessphoto:   7 * 24 * 3600 * 1000,
};

// module-level dedup: idbFactory → Promise<TileCache>
const _openPromises = new Map();

function idbOpen(idbFactory) {
  return new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error('IDB open blocked'));
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

function idbGetAllKeys(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function idbGetAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

class TileCache {
  constructor(db) {
    this._db = db;
  }

  async get(layer, z, x, y) {
    const key = `${layer}/${z}/${x}/${y}`;
    const entry = await idbGet(this._db, key);
    if (!entry) return null;
    const ttl = TILE_TTL_MS[entry.layer] ?? TILE_TTL_MS.seamlessphoto;
    if (Date.now() >= entry.fetchedAt + ttl) return null;
    return entry.blob;
  }

  async set(layer, z, x, y, blob) {
    const key = `${layer}/${z}/${x}/${y}`;
    await idbPut(this._db, key, { blob, fetchedAt: Date.now(), layer });
  }

  async evict() {
    const keys   = await idbGetAllKeys(this._db);
    const values = await idbGetAll(this._db);
    let deleted = 0;
    for (let i = 0; i < keys.length; i++) {
      const entry = values[i];
      const ttl = TILE_TTL_MS[entry.layer] ?? TILE_TTL_MS.seamlessphoto;
      if (Date.now() >= entry.fetchedAt + ttl) {
        await idbDelete(this._db, keys[i]);
        deleted++;
      }
    }
    return deleted;
  }

  async stats() {
    const values = await idbGetAll(this._db);
    const layers = {};
    for (const v of values) {
      layers[v.layer] = (layers[v.layer] ?? 0) + 1;
    }
    return { total: values.length, layers };
  }
}

export function openTileCache({ idbFactory } = {}) {
  const factory = idbFactory ?? globalThis.indexedDB;
  if (!factory) return Promise.reject(new Error('IndexedDB not available'));

  if (_openPromises.has(factory)) return _openPromises.get(factory);

  const p = idbOpen(factory).then((db) => new TileCache(db));
  _openPromises.set(factory, p);
  return p;
}
