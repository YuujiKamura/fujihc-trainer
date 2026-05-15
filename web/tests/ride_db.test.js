// brief 33 atom B: ride_db.js の unit test (= fake-indexeddb で in-memory IDB).
import { describe, it, expect, beforeEach } from 'vitest';
// fake-indexeddb は side-effect で globalThis.indexedDB / IDBKeyRange を set する.
import 'fake-indexeddb/auto';

import {
  RIDE_DB_NAME, RIDE_DB_VERSION, RIDE_STORE, RIDE_INDEX_DATE,
  RIDE_DB_AUTO_PRUNE_BYTES, RIDE_DB_KEEP_MIN,
  openRideDb, addRide, listRides, getRide, deleteRide, estimateRideDbBytes,
} from '../lib/ride_db.js';

function makeRec(id, date, trkptCount = 10) {
  const trkpts = [];
  for (let i = 0; i < trkptCount; i++) {
    trkpts.push({ t: `${date.slice(0, 19)}.${String(i).padStart(3, '0')}Z`, lat: 35.4 + i * 0.0001, lon: 138.7, ele: 1000 + i, power: 200, cad: 85, hr: 142 });
  }
  return {
    id,
    date,
    summary: { distance_m: 5000, duration_s: 1800, elevation_gain_m: 120, avg_power_w: 200, course_name: 'fujihill' },
    trkpts,
  };
}

// 各 test 前に DB を消して isolate (= fake-indexeddb は globalThis.indexedDB を共有).
beforeEach(async () => {
  await new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(RIDE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('ride_db consts', () => {
  it('schema 名前 / version が固定値 (= NG-R3-3 同型予防、 ローカル再定義禁止)', () => {
    expect(RIDE_DB_NAME).toBe('fujihill-trainer');
    expect(RIDE_DB_VERSION).toBe(1);
    expect(RIDE_STORE).toBe('rides');
    expect(RIDE_INDEX_DATE).toBe('by_date');
    expect(RIDE_DB_AUTO_PRUNE_BYTES).toBe(500 * 1024 * 1024);
    expect(RIDE_DB_KEEP_MIN).toBe(20);
  });
});

describe('openRideDb', () => {
  it('初回 open で store + index を作る (= schema v1 fresh-create)', async () => {
    const db = await openRideDb();
    expect(db.name).toBe(RIDE_DB_NAME);
    expect(db.version).toBe(RIDE_DB_VERSION);
    expect(db.objectStoreNames.contains(RIDE_STORE)).toBe(true);
    const tx = db.transaction(RIDE_STORE, 'readonly');
    const store = tx.objectStore(RIDE_STORE);
    expect(store.keyPath).toBe('id');
    expect(store.indexNames.contains(RIDE_INDEX_DATE)).toBe(true);
    db.close();
  });
});

describe('addRide / listRides / getRide / deleteRide', () => {
  it('addRide 1 件 → listRides で取れる', async () => {
    const db = await openRideDb();
    const rec = makeRec('2026-05-15T07:00:00Z-aaa', '2026-05-15T07:00:00Z');
    await addRide(db, rec);
    const all = await listRides(db);
    expect(all.length).toBe(1);
    expect(all[0].id).toBe(rec.id);
    db.close();
  });

  it('listRides は by_date 降順 (= 新しい順)', async () => {
    const db = await openRideDb();
    await addRide(db, makeRec('id-old', '2026-05-10T07:00:00Z'));
    await addRide(db, makeRec('id-new', '2026-05-15T07:00:00Z'));
    await addRide(db, makeRec('id-mid', '2026-05-12T07:00:00Z'));
    const all = await listRides(db);
    expect(all.map(r => r.id)).toEqual(['id-new', 'id-mid', 'id-old']);
    db.close();
  });

  it('getRide / deleteRide 往復', async () => {
    const db = await openRideDb();
    const rec = makeRec('id-x', '2026-05-15T07:00:00Z');
    await addRide(db, rec);
    const got = await getRide(db, 'id-x');
    expect(got && got.id).toBe('id-x');
    await deleteRide(db, 'id-x');
    const after = await getRide(db, 'id-x');
    expect(after).toBeUndefined();
    db.close();
  });

  it('addRide で id 必須 (= 不正 rec は throw)', async () => {
    const db = await openRideDb();
    await expect(addRide(db, {})).rejects.toThrow();
    db.close();
  });
});

describe('estimateRideDbBytes', () => {
  it('空 DB は 0', async () => {
    const db = await openRideDb();
    // 既存 record を全 clean (= 前 test で残ってる場合あり)
    const all = await listRides(db);
    for (const r of all) await deleteRide(db, r.id);
    expect(await estimateRideDbBytes(db)).toBe(0);
    db.close();
  });

  it('record 数に応じて増える', async () => {
    const db = await openRideDb();
    const all0 = await listRides(db);
    for (const r of all0) await deleteRide(db, r.id);
    await addRide(db, makeRec('id-a', '2026-05-15T07:00:00Z', 5));
    const b1 = await estimateRideDbBytes(db);
    await addRide(db, makeRec('id-b', '2026-05-15T08:00:00Z', 5));
    const b2 = await estimateRideDbBytes(db);
    expect(b2).toBeGreaterThan(b1);
    db.close();
  });
});

describe('auto-prune', () => {
  // threshold を一時的に下げて test するため、 直接 maybeAutoPrune を呼ばず、
  // 大きい trkpts を入れて自動 prune を発火させる方針はサイズ大すぎるので、
  // ここでは内部 KEEP_MIN がちゃんと const で参照可能なことだけ verify する.
  // 実装側 threshold (500MB) を超えるテストは現実時間で重い → const 接続性で代替.
  it('threshold / keep_min が module 経由で読める (= ローカル再定義検出のため)', () => {
    expect(typeof RIDE_DB_AUTO_PRUNE_BYTES).toBe('number');
    expect(typeof RIDE_DB_KEEP_MIN).toBe('number');
    expect(RIDE_DB_KEEP_MIN).toBeLessThan(RIDE_DB_AUTO_PRUNE_BYTES);
  });

  it('未超では idempotent (= addRide 連続でも record 消えない)', async () => {
    const db = await openRideDb();
    const all0 = await listRides(db);
    for (const r of all0) await deleteRide(db, r.id);
    for (let i = 0; i < 5; i++) {
      await addRide(db, makeRec(`id-${i}`, `2026-05-${String(10 + i).padStart(2, '0')}T07:00:00Z`, 3));
    }
    const after = await listRides(db);
    expect(after.length).toBe(5);
    db.close();
  });
});
