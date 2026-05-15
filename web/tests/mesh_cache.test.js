// brief 34 ε-F: mesh_cache.js の unit test.
// fake-indexeddb で in-memory IDB を立て、 TypedArray の byte-identical 復元 +
// 同 hash 異 kind の併存 + IDB 不在時の no-op + clear + 大容量 Float32Array を pin.
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import {
  MESH_DB_NAME,
  getMeshCache,
  setMeshCache,
  clearMeshCache,
  computeCourseHash,
} from '../lib/mesh_cache.js';

beforeEach(async () => {
  // 各 test で DB をリセット (= fake-indexeddb は globalThis.indexedDB を共有)
  await new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(MESH_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('computeCourseHash', () => {
  it('同一 course → 同一 hash (= 決定論的)', () => {
    const c = [
      { lat: 35.4, lon: 138.7, distance_m: 0 },
      { lat: 35.5, lon: 138.8, distance_m: 24000 },
    ];
    expect(computeCourseHash(c)).toBe(computeCourseHash(c));
  });
  it('長さ違いで別 hash', () => {
    const a = [{ lat: 35.4, lon: 138.7, distance_m: 0 }, { lat: 35.5, lon: 138.8, distance_m: 1000 }];
    const b = [{ lat: 35.4, lon: 138.7, distance_m: 0 }];
    expect(computeCourseHash(a)).not.toBe(computeCourseHash(b));
  });
  it('総距離違いで別 hash', () => {
    const a = [{ lat: 35.4, lon: 138.7, distance_m: 0 }, { lat: 35.5, lon: 138.8, distance_m: 24000 }];
    const b = [{ lat: 35.4, lon: 138.7, distance_m: 0 }, { lat: 35.5, lon: 138.8, distance_m: 12000 }];
    expect(computeCourseHash(a)).not.toBe(computeCourseHash(b));
  });
  it('null / 空 配列で空文字 (= 例外吐かない)', () => {
    expect(computeCourseHash(null)).toBe('');
    expect(computeCourseHash([])).toBe('');
    expect(computeCourseHash(undefined)).toBe('');
  });
});

describe('mesh_cache happy path', () => {
  it('setMeshCache → getMeshCache で Float32Array が byte-identical に復元', async () => {
    const verts = new Float32Array([1.5, 2.25, -3.125, 0.0, 100.5]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const ok = await setMeshCache('hashA', 'terrain', { vertices: verts, indices });
    expect(ok).toBe(true);

    const rec = await getMeshCache('hashA', 'terrain');
    expect(rec).not.toBeNull();
    expect(rec.kind).toBe('terrain');
    expect(rec.hash).toBe('hashA');
    expect(rec.arrays.vertices).toBeInstanceOf(Float32Array);
    expect(rec.arrays.indices).toBeInstanceOf(Uint32Array);
    expect(Array.from(rec.arrays.vertices)).toEqual(Array.from(verts));
    expect(Array.from(rec.arrays.indices)).toEqual(Array.from(indices));
  });

  it('異 hash で個別保存、 互いに干渉しない', async () => {
    await setMeshCache('hashA', 'terrain', { v: new Float32Array([1, 2]) });
    await setMeshCache('hashB', 'terrain', { v: new Float32Array([99, 100]) });
    const a = await getMeshCache('hashA', 'terrain');
    const b = await getMeshCache('hashB', 'terrain');
    expect(Array.from(a.arrays.v)).toEqual([1, 2]);
    expect(Array.from(b.arrays.v)).toEqual([99, 100]);
  });

  it('同 hash + 異 kind は併存 (= terrain と polygon を同 course で同時保持)', async () => {
    await setMeshCache('hashX', 'terrain', { v: new Float32Array([1, 2, 3]) });
    await setMeshCache('hashX', 'polygon', {
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1 }] },
    });
    const t = await getMeshCache('hashX', 'terrain');
    const p = await getMeshCache('hashX', 'polygon');
    expect(t).not.toBeNull();
    expect(p).not.toBeNull();
    expect(t.kind).toBe('terrain');
    expect(p.kind).toBe('polygon');
    expect(p.arrays.geojson.features[0].id).toBe(1);
  });

  it('GeoJSON plain object も TypedArray と同じ store に保存できる', async () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { color: '#7fff00', grade: 'flat' }, geometry: { type: 'Polygon', coordinates: [[[138.7, 35.4], [138.7, 35.5], [138.8, 35.5], [138.7, 35.4]]] } },
      ],
    };
    await setMeshCache('h1', 'polygon', { geojson: fc });
    const rec = await getMeshCache('h1', 'polygon');
    expect(rec.arrays.geojson).toEqual(fc);
  });

  it('大容量 Float32Array (= 数 MB 相当) も byte-identical に復元', async () => {
    // 256k float ≒ 1MB、 富士ヒル course の terrain mesh vertex 規模に近い軽量 sample
    const N = 256 * 1024;
    const big = new Float32Array(N);
    for (let i = 0; i < N; i++) big[i] = Math.sin(i * 0.001) * 1000;
    await setMeshCache('hashBig', 'terrain', { vertices: big });
    const rec = await getMeshCache('hashBig', 'terrain');
    expect(rec.arrays.vertices.length).toBe(N);
    // spot check 8 places (= 全 byte 比較は test 遅すぎ、 端点 + 中央で十分)
    expect(rec.arrays.vertices[0]).toBe(big[0]);
    expect(rec.arrays.vertices[1]).toBe(big[1]);
    expect(rec.arrays.vertices[N / 2]).toBe(big[N / 2]);
    expect(rec.arrays.vertices[N - 1]).toBe(big[N - 1]);
    // 全 byte 比較 (= 1MB は test で十分扱える)
    expect(Buffer.from(rec.arrays.vertices.buffer).equals(Buffer.from(big.buffer))).toBe(true);
  });
});

describe('mesh_cache edge cases', () => {
  it('miss で null を返す (= 例外吐かない)', async () => {
    const rec = await getMeshCache('nonexistent', 'terrain');
    expect(rec).toBeNull();
  });

  it('clearMeshCache 後は getMeshCache で null', async () => {
    await setMeshCache('hashC', 'terrain', { v: new Float32Array([7]) });
    expect((await getMeshCache('hashC', 'terrain'))).not.toBeNull();
    const cleared = await clearMeshCache();
    expect(cleared).toBe(true);
    expect((await getMeshCache('hashC', 'terrain'))).toBeNull();
  });

  it('hash / kind が空文字 / null で getMeshCache → null (= 例外吐かない)', async () => {
    expect(await getMeshCache('', 'terrain')).toBeNull();
    expect(await getMeshCache('hashA', '')).toBeNull();
    expect(await getMeshCache(null, 'terrain')).toBeNull();
    expect(await getMeshCache('hashA', null)).toBeNull();
  });

  it('hash / kind が空文字 / null で setMeshCache → false (= no-op)', async () => {
    expect(await setMeshCache('', 'terrain', { v: new Float32Array([1]) })).toBe(false);
    expect(await setMeshCache('h', '', { v: new Float32Array([1]) })).toBe(false);
  });

  it('IndexedDB 不在環境 (= globalThis.indexedDB undefined) で setMeshCache → false / getMeshCache → null', async () => {
    const saved = globalThis.indexedDB;
    // delete でも undefined 代入でも getIDB() の null fallback が走る
    // (= IDBFactory ではなく falsy なら null を返す設計)
    delete globalThis.indexedDB;
    try {
      const setOk = await setMeshCache('h', 'terrain', { v: new Float32Array([1]) });
      expect(setOk).toBe(false);
      const rec = await getMeshCache('h', 'terrain');
      expect(rec).toBeNull();
      const cleared = await clearMeshCache();
      expect(cleared).toBe(false);
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it('上書き保存 (= 同 hash + 同 kind を再 set) は最新値を返す', async () => {
    await setMeshCache('hashD', 'terrain', { v: new Float32Array([1, 2]) });
    await setMeshCache('hashD', 'terrain', { v: new Float32Array([10, 20, 30]) });
    const rec = await getMeshCache('hashD', 'terrain');
    expect(Array.from(rec.arrays.v)).toEqual([10, 20, 30]);
  });
});
