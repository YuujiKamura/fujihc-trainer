// b12 Phase 3 部品 tile_loader3d.js の純ロジックのユニットテスト.
//
// tile_loader3d.js は Three.js を import しないので node 環境からそのまま import できる。
// fetch / Image / canvas を使う loadDemStitched / loadPhotoCanvas は DOM 依存なので
// ここでは対象外 ── 取得経路の正しさは Phase 4 の画面確認で見る。 本テストは Three にも
// DOM にも触れない 2 つの配管関数と、 GSI 配慮の定数を pin する。

import { describe, it, expect } from 'vitest';
import {
  tileCoordsForRange, mapLimit,
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
  it('同時接続上限は 6、タイル上限は 200、DEM zoom は 14', () => {
    expect(GSI_FETCH_LIMIT).toBe(6);
    expect(MAX_TILES).toBe(200);
    expect(DEM_ZOOM).toBe(14);
    expect(TILE_PX).toBe(256);
  });
});
