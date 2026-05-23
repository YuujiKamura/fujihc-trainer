// b12 Phase 3 部品 tile_loader3d.js の純ロジックのユニットテスト.
//
// tile_loader3d.js は Three.js を import しないので node 環境からそのまま import できる。
// fetch / Image / canvas を使う loadDemStitched / loadPhotoCanvas は DOM 依存なので
// ここでは対象外 ── 取得経路の正しさは Phase 4 の画面確認で見る。 本テストは Three にも
// DOM にも触れない 2 つの配管関数と、 GSI 配慮の定数を pin する。

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  tileCoordsForRange, mapLimit, loadDemStitched,
  DEM_ZOOM, TILE_PX, GSI_FETCH_LIMIT, MAX_TILES,
} from '../lib/map3d/tile_loader3d.js';

describe('tileCoordsForRange', () => {
  it('矩形範囲を tilesX*tilesY 枚に展開する', () => {
    const range = { xMin: 3, xMax: 5, yMin: 7, yMax: 8, tilesX: 3, tilesY: 2 };
    const coords = tileCoordsForRange(range);
    expect(coords).toHaveLength(6);
  });

  it('ty を外側・tx を内側に回す (= 北→南、西→東の並び)', () => {
    const range = { xMin: 3, xMax: 5, yMin: 7, yMax: 8, tilesX: 3, tilesY: 2 };
    const coords = tileCoordsForRange(range);
    expect(coords[0]).toEqual({ tx: 3, ty: 7 });
    expect(coords[1]).toEqual({ tx: 4, ty: 7 });
    expect(coords[2]).toEqual({ tx: 5, ty: 7 });
    expect(coords[3]).toEqual({ tx: 3, ty: 8 });
    expect(coords[5]).toEqual({ tx: 5, ty: 8 });
  });

  it('1x1 範囲は 1 枚だけ返す', () => {
    const range = { xMin: 10, xMax: 10, yMin: 20, yMax: 20, tilesX: 1, tilesY: 1 };
    expect(tileCoordsForRange(range)).toEqual([{ tx: 10, ty: 20 }]);
  });
});

describe('mapLimit', () => {
  it('完了順がばらけても入力順の結果配列を返す', async () => {
    // index が小さいほど遅く解決する fn ── それでも out は入力順でなければならない。
    const items = [1, 2, 3, 4];
    const out = await mapLimit(items, 4, async (x) => {
      await new Promise((r) => setTimeout(r, (5 - x) * 4));
      return x * 2;
    });
    expect(out).toEqual([2, 4, 6, 8]);
  });

  it('同時実行数を limit 以下に抑える', async () => {
    let active = 0;
    let peak = 0;
    await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return x;
    });
    expect(peak).toBe(2);
  });

  it('limit が要素数より大きくても全件処理する', async () => {
    const out = await mapLimit([1, 2], 10, async (x) => x + 100);
    expect(out).toEqual([101, 102]);
  });

  it('空配列は空配列を返す (fn は 1 度も呼ばれない)', async () => {
    let calls = 0;
    const out = await mapLimit([], 3, async (x) => { calls++; return x; });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it('onEach を 1 件完了ごとに呼び、最後の呼出で done==total になる', async () => {
    const progress = [];
    await mapLimit([1, 2, 3], 2, async (x) => x, (done, total) => {
      progress.push([done, total]);
    });
    expect(progress).toHaveLength(3);
    expect(progress[progress.length - 1]).toEqual([3, 3]);
  });
});

describe('GSI 配慮の定数 (fujihc CLAUDE.md ── 変更禁止の pin)', () => {
  it('同時接続上限は 6、タイル上限は 256 (b70 で 200→256)、DEM zoom は 15、タイルは 256px', () => {
    expect(GSI_FETCH_LIMIT).toBe(6);
    expect(MAX_TILES).toBe(256);
    // b59: dem5a (5mメッシュ) は z15 が native 上限。dem_png z14 から引上げて高精細化。
    // GSI_FETCH_LIMIT / MAX_TILES は配布元配慮の上限で変更禁止のまま。
    expect(DEM_ZOOM).toBe(15);
    expect(TILE_PX).toBe(256);
  });
});

// b67: 取得経路を IndexedDB → GSI 直の 2 段に統一 (bridge 段撤去) + zoom 引数追加。
// fetch を vi.fn() で差し替えて呼び出された URL を捕捉、 経路と zoom を pin する。
// 全 fetch を 404 にすれば bitmap decode 経路に入らないので DOM 非依存で完走する
// (= 「DEM タイルが 1 枚も取得できませんでした」 で reject されるので rejects.toThrow で受ける)。
describe('loadDemStitched (b67: bridge 段撤去 + zoom 引数)', () => {
  const SMALL_BBOX = [138.7, 35.4, 138.71, 35.41];  // 小 bbox (= z15 で数枚)
  const ORIGINAL_FETCH = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('bridge fetch 段撤去後、 fetch URL は gsiDirectBase 始まりのみ、 /tiles/gsi_dem は 1 件も出ない', async () => {
    const seen = [];
    globalThis.fetch = vi.fn(async (url) => { seen.push(url); return { ok: false, status: 404 }; });
    await expect(loadDemStitched({
      bounds: SMALL_BBOX, tileCache: null, gsiDirectBase: 'https://example.test/dem',
    })).rejects.toThrow(/1 枚も取得できません/);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((u) => u.includes('/tiles/gsi_dem'))).toHaveLength(0);
    expect(seen.every((u) => u.startsWith('https://example.test/dem'))).toBe(true);
  });

  it('zoom: 12 を渡すと URL に /12/ が出る (= 広域低精細メッシュ用)', async () => {
    const seen = [];
    globalThis.fetch = vi.fn(async (url) => { seen.push(url); return { ok: false, status: 404 }; });
    await expect(loadDemStitched({
      bounds: SMALL_BBOX, tileCache: null,
      gsiDirectBase: 'https://example.test/dem', zoom: 12,
    })).rejects.toThrow();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => /\/12\//.test(u))).toBe(true);
  });

  it('zoom 未指定で DEM_ZOOM (= 15) が使われる (= 既定値の後方互換)', async () => {
    const seen = [];
    globalThis.fetch = vi.fn(async (url) => { seen.push(url); return { ok: false, status: 404 }; });
    await expect(loadDemStitched({
      bounds: SMALL_BBOX, tileCache: null,
      gsiDirectBase: 'https://example.test/dem',
    })).rejects.toThrow();
    expect(seen.every((u) => /\/15\//.test(u))).toBe(true);
  });

  it('gsiDirectBase 未指定で呼ぶと早期エラー (= 異常呼び出しを silent fallback しない)', async () => {
    await expect(loadDemStitched({
      bounds: SMALL_BBOX, tileCache: null,
    })).rejects.toThrow(/gsiDirectBase/);
  });
});
