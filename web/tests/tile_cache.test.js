import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openTileCache, TILE_TTL_MS } from '../lib/tile_cache.js';

// 各テストに独立した IDB インスタンスを渡す。
// openTileCache は idbFactory をキーに Promise dedup するため、
// 毎回 new IDBFactory() を渡すことでテスト間の DB 汚染を防ぐ。
function freshCache() {
  return openTileCache({ idbFactory: new IDBFactory() });
}

const DUMMY_BLOB = new Uint8Array([1, 2, 3]);

describe('openTileCache', () => {
  it('同じ idbFactory を渡すと同一インスタンスを返す (Promise dedup)', async () => {
    const fac = new IDBFactory();
    const p1 = openTileCache({ idbFactory: fac });
    const p2 = openTileCache({ idbFactory: fac });
    expect(p1).toBe(p2);
    const [c1, c2] = await Promise.all([p1, p2]);
    expect(c1).toBe(c2);
  });
});

describe('TileCache get/set', () => {
  it('set した tile を get で取得できる', async () => {
    const cache = await freshCache();
    await cache.set('dem_png', 14, 100, 200, DUMMY_BLOB);
    const result = await cache.get('dem_png', 14, 100, 200);
    expect(result).toEqual(DUMMY_BLOB);
  });

  it('TTL 内は miss にならない', async () => {
    const cache = await freshCache();
    await cache.set('seamlessphoto', 14, 1, 2, DUMMY_BLOB);
    const result = await cache.get('seamlessphoto', 14, 1, 2);
    expect(result).not.toBeNull();
  });

  it('TTL 超えは get が null を返す', async () => {
    const cache = await freshCache();
    const past = Date.now() - TILE_TTL_MS.seamlessphoto - 1;
    vi.spyOn(Date, 'now').mockReturnValueOnce(past);
    await cache.set('seamlessphoto', 14, 1, 2, DUMMY_BLOB);
    vi.restoreAllMocks();
    const result = await cache.get('seamlessphoto', 14, 1, 2);
    expect(result).toBeNull();
  });

  it('fetchedAt + TTL_MS === now の瞬間は miss 扱い (境界値)', async () => {
    const cache = await freshCache();
    const fetchedAt = 1000000;
    vi.spyOn(Date, 'now').mockReturnValueOnce(fetchedAt);
    await cache.set('seamlessphoto', 14, 1, 2, DUMMY_BLOB);
    vi.restoreAllMocks();
    // 境界: now === fetchedAt + TTL → miss
    vi.spyOn(Date, 'now').mockReturnValue(fetchedAt + TILE_TTL_MS.seamlessphoto);
    const result = await cache.get('seamlessphoto', 14, 1, 2);
    vi.restoreAllMocks();
    expect(result).toBeNull();
  });

  it('layer が違うと別 entry として扱われる', async () => {
    const cache = await freshCache();
    const blobA = new Uint8Array([10]);
    const blobB = new Uint8Array([20]);
    await cache.set('dem_png',      14, 1, 1, blobA);
    await cache.set('seamlessphoto', 14, 1, 1, blobB);
    expect(await cache.get('dem_png',      14, 1, 1)).toEqual(blobA);
    expect(await cache.get('seamlessphoto', 14, 1, 1)).toEqual(blobB);
  });

  it('存在しない key への get は null を返す', async () => {
    const cache = await freshCache();
    expect(await cache.get('dem_png', 14, 9999, 9999)).toBeNull();
  });
});

describe('TileCache evict', () => {
  it('TTL 超えのエントリだけ削除し、TTL 内は残す', async () => {
    const cache = await freshCache();
    const old = Date.now() - TILE_TTL_MS.seamlessphoto - 1;
    vi.spyOn(Date, 'now').mockReturnValueOnce(old);
    await cache.set('seamlessphoto', 14, 1, 1, DUMMY_BLOB);
    vi.restoreAllMocks();
    await cache.set('seamlessphoto', 14, 2, 2, DUMMY_BLOB);

    const deleted = await cache.evict();
    expect(deleted).toBe(1);
    expect(await cache.get('seamlessphoto', 14, 1, 1)).toBeNull();
    expect(await cache.get('seamlessphoto', 14, 2, 2)).not.toBeNull();
  });

  it('返値は削除件数 (number)', async () => {
    const cache = await freshCache();
    const deleted = await cache.evict();
    expect(typeof deleted).toBe('number');
  });

  it('空 DB で evict を呼んでも 0 を返す', async () => {
    const cache = await freshCache();
    expect(await cache.evict()).toBe(0);
  });

  it('TTL が layer 別に異なる (dem_png=90d, seamlessphoto=7d)', async () => {
    const cache = await freshCache();
    // 8 日前に set → seamlessphoto は期限切れ、dem_png はまだ有効
    const eightDaysAgo = Date.now() - 8 * 24 * 3600 * 1000;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(eightDaysAgo)
      .mockReturnValueOnce(eightDaysAgo);
    await cache.set('seamlessphoto', 14, 1, 1, DUMMY_BLOB);
    await cache.set('dem_png',       14, 1, 1, DUMMY_BLOB);
    vi.restoreAllMocks();

    const deleted = await cache.evict();
    expect(deleted).toBe(1);
    expect(await cache.get('seamlessphoto', 14, 1, 1)).toBeNull();
    expect(await cache.get('dem_png',       14, 1, 1)).not.toBeNull();
  });
});

describe('TileCache stats', () => {
  it('total は全 entry 数', async () => {
    const cache = await freshCache();
    await cache.set('dem_png',       14, 1, 1, DUMMY_BLOB);
    await cache.set('seamlessphoto', 14, 2, 2, DUMMY_BLOB);
    const s = await cache.stats();
    expect(s.total).toBe(2);
  });

  it('layers は layer 別カウント', async () => {
    const cache = await freshCache();
    await cache.set('dem_png',       14, 1, 1, DUMMY_BLOB);
    await cache.set('dem_png',       14, 1, 2, DUMMY_BLOB);
    await cache.set('seamlessphoto', 14, 3, 3, DUMMY_BLOB);
    const s = await cache.stats();
    expect(s.layers['dem_png']).toBe(2);
    expect(s.layers['seamlessphoto']).toBe(1);
  });

  it('空 DB の stats は total=0 / layers={}', async () => {
    const cache = await freshCache();
    const s = await cache.stats();
    expect(s.total).toBe(0);
    expect(s.layers).toEqual({});
  });
});

describe('openTileCache error path', () => {
  it('IDB open 失敗 → 呼び出し側に reject が伝わる', async () => {
    // open() が即 onerror を発火する壊れた factory を作る
    const brokenFactory = {
      open() {
        const req = {};
        setTimeout(() => req.onerror?.({ target: { error: new Error('IDB fail') } }), 0);
        return req;
      },
    };
    await expect(openTileCache({ idbFactory: brokenFactory })).rejects.toThrow('IDB fail');
  });
});
