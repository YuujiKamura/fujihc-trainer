// b70: 広域低精細メッシュを ring topology (= 4 外周ストリップ) に作り直す。
// `index.js` から export した 3 純関数 (alignDemBoundsToZ12 / alignDbBoundsToZ12 /
// buildWideStripBboxes) の挙動と境界数学的一致を pin する。
//
// b70-X-FIX (2026-05-23): 旧 alignDemBoundsToZ12Y は Y 軸のみスナップで X 軸 overlap
// (= east strip の z12 タイルが demA 内部に 6.6km 食い込み) が残っていた。 X+Y 両軸
// snap + buildWideStripBboxes をタイル番号ベースに書き換えて真の disjoint を達成。

import { describe, it, expect } from 'vitest';
import {
  alignDemBoundsToZ12, alignDbBoundsToZ12, buildWideStripBboxes,
} from '../lib/map3d/index.js';
import { tileRangeForBounds } from '../lib/terrain3d.js';
import { fujihill } from '../courses/fujihill.js';

describe('b70 alignDemBoundsToZ12 (= demBounds を X+Y 両軸 z12 整数倍に外向きスナップ)', () => {
  it('原 demBounds を内包する (4 辺すべて元 demBounds より外側 or 一致)', () => {
    const demA = alignDemBoundsToZ12(fujihill.demBounds);
    expect(demA[0]).toBeLessThanOrEqual(fujihill.demBounds[0]);   // W
    expect(demA[1]).toBeLessThanOrEqual(fujihill.demBounds[1]);   // S
    expect(demA[2]).toBeGreaterThanOrEqual(fujihill.demBounds[2]); // E
    expect(demA[3]).toBeGreaterThanOrEqual(fujihill.demBounds[3]); // N
  });

  it('z15 タイル数 = 256 (= 16×16、 元 96 から +160、 MAX_TILES 256 丁度)', () => {
    const demA = alignDemBoundsToZ12(fujihill.demBounds);
    expect(tileRangeForBounds(demA, 15).count).toBe(256);
  });

  it('z15 タイル範囲が X 軸も Y 軸も 8 の倍数 (= z12 タイル整数倍に揃った十分条件)', () => {
    const demA = alignDemBoundsToZ12(fujihill.demBounds);
    const r15 = tileRangeForBounds(demA, 15);
    expect(r15.xMin % 8).toBe(0);
    expect((r15.xMax + 1) % 8).toBe(0);
    expect(r15.yMin % 8).toBe(0);
    expect((r15.yMax + 1) % 8).toBe(0);
  });

  it('z12 タイル数 = 4 (= 2×2、 高精細 z15 256 タイルが z12 4 タイルに対応)', () => {
    const demA = alignDemBoundsToZ12(fujihill.demBounds);
    expect(tileRangeForBounds(demA, 12).count).toBe(4);
  });
});

describe('b70 alignDbBoundsToZ12 (= dbBounds を両軸 z12 整数倍に外向きスナップ)', () => {
  it('原 dbBounds を内包する', () => {
    const dbA = alignDbBoundsToZ12(fujihill.dbBounds);
    expect(dbA[0]).toBeLessThanOrEqual(fujihill.dbBounds[0]);
    expect(dbA[1]).toBeLessThanOrEqual(fujihill.dbBounds[1]);
    expect(dbA[2]).toBeGreaterThanOrEqual(fujihill.dbBounds[2]);
    expect(dbA[3]).toBeGreaterThanOrEqual(fujihill.dbBounds[3]);
  });

  it('z12 タイル数 = 12 (= 4×3、 原と同じ)', () => {
    const dbA = alignDbBoundsToZ12(fujihill.dbBounds);
    expect(tileRangeForBounds(dbA, 12).count).toBe(12);
  });
});

describe('b70-X-FIX buildWideStripBboxes (= dbA から demA を引いた 4 strip ring、 z12 タイル空間で disjoint)', () => {
  const demA = alignDemBoundsToZ12(fujihill.demBounds);
  const dbA  = alignDbBoundsToZ12(fujihill.dbBounds);

  it('4 strip の z12 タイル数: 北=3 / 南=3 / 東=2 / 西=null (= 空 strip)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    expect(tileRangeForBounds(s.north, 12).count).toBe(3);
    expect(tileRangeForBounds(s.south, 12).count).toBe(3);
    expect(tileRangeForBounds(s.east,  12).count).toBe(2);
    expect(s.west).toBeNull();  // demA.W が dbA.W と一致して西側に strip 領域なし
  });

  it('strip と demA の z12 タイル集合が disjoint (= 真の overlap ゼロ、 b70-X-FIX の核)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const demT = tileRangeForBounds(demA, 12);
    for (const [name, bbox] of Object.entries(s)) {
      if (bbox === null) continue;
      const sT = tileRangeForBounds(bbox, 12);
      const disjoint = sT.xMax < demT.xMin || sT.xMin > demT.xMax
                    || sT.yMax < demT.yMin || sT.yMin > demT.yMax;
      expect(disjoint, `${name} strip の z12 タイル集合が demA と overlap`).toBe(true);
    }
  });

  it('strip 合計 z12 タイル + demA z12 タイル = dbA z12 タイル (= 漏れ重複ゼロの完全分割)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const demT = tileRangeForBounds(demA, 12).count;
    const stripSum = Object.values(s)
      .reduce((acc, b) => acc + (b === null ? 0 : tileRangeForBounds(b, 12).count), 0);
    const dbT = tileRangeForBounds(dbA, 12).count;
    expect(stripSum + demT).toBe(dbT);
  });

  it('demA 内部の 9 点 (= 中心 + 4 隅 EPS 内側 + 4 辺中点) は 4 strip のどれにも含まれない', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const eps = 1e-6;  // 端から 0.0001 度 ≒ 11m 内側、 浮動小数誤差より十分大
    const points = [
      [(demA[0]+demA[2])/2, (demA[1]+demA[3])/2],   // 中心
      [demA[0]+eps, demA[1]+eps],                    // SW 隅 EPS 内側
      [demA[2]-eps, demA[1]+eps],                    // SE
      [demA[0]+eps, demA[3]-eps],                    // NW
      [demA[2]-eps, demA[3]-eps],                    // NE
      [(demA[0]+demA[2])/2, demA[1]+eps],            // S 辺中点
      [(demA[0]+demA[2])/2, demA[3]-eps],            // N 辺中点
      [demA[0]+eps, (demA[1]+demA[3])/2],            // W 辺中点
      [demA[2]-eps, (demA[1]+demA[3])/2],            // E 辺中点
    ];
    for (const [px, py] of points) {
      for (const [name, bbox] of Object.entries(s)) {
        if (bbox === null) continue;
        const inside = bbox[0] <= px && px <= bbox[2] && bbox[1] <= py && py <= bbox[3];
        expect(inside, `点 (${px}, ${py}) が ${name} strip に含まれる`).toBe(false);
      }
    }
  });

  it('strip 同士は互いに z12 タイル空間で disjoint (= ring の各辺が重複なし)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const ranges = {};
    for (const [name, bbox] of Object.entries(s)) {
      if (bbox !== null) ranges[name] = tileRangeForBounds(bbox, 12);
    }
    const keys = Object.keys(ranges);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = ranges[keys[i]];
        const b = ranges[keys[j]];
        const disjoint = a.xMax < b.xMin || b.xMax < a.xMin
                      || a.yMax < b.yMin || b.yMax < a.yMin;
        expect(disjoint, `${keys[i]} と ${keys[j]} の z12 タイル集合が overlap`).toBe(true);
      }
    }
  });

  it('demA が dbA の外に出る不正入力で throw (= error path)', () => {
    expect(() => buildWideStripBboxes(
      [138.60, 35.20, 138.90, 35.60], dbA  // demA が dbA より広い
    )).toThrow();
  });
});
