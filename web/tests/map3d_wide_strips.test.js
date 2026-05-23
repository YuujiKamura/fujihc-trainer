// b70: 広域低精細メッシュを ring topology (= 4 外周ストリップ) に作り直す。
// `index.js` から export した 3 純関数 (alignDemBoundsToZ12Y / alignDbBoundsToZ12 /
// buildWideStripBboxes) の挙動と境界数学的一致を pin する。
//
// z15 と z12 は倍率 8 で入れ子になる性質を利用し、 demBounds を Y のみ z12 タイル
// 整数倍に外向きスナップ + dbBounds を両軸 z12 整数倍に外向きスナップ。 strip の
// demA 側辺と demA の対辺が同じ lat/lon に揃う = 隙間/重複ゼロ。

import { describe, it, expect } from 'vitest';
import {
  alignDemBoundsToZ12Y, alignDbBoundsToZ12, buildWideStripBboxes,
} from '../lib/map3d/index.js';
import { tileRangeForBounds } from '../lib/terrain3d.js';
import { fujihill } from '../courses/fujihill.js';

describe('b70 alignDemBoundsToZ12Y (= demBounds を Y のみ z12 整数倍に外向きスナップ)', () => {
  it('原 demBounds を内包する (4 辺すべて元 demBounds より外側 or 一致)', () => {
    const demA = alignDemBoundsToZ12Y(fujihill.demBounds);
    expect(demA[0]).toBeLessThanOrEqual(fujihill.demBounds[0]);   // W
    expect(demA[1]).toBeLessThanOrEqual(fujihill.demBounds[1]);   // S
    expect(demA[2]).toBeGreaterThanOrEqual(fujihill.demBounds[2]); // E
    expect(demA[3]).toBeGreaterThanOrEqual(fujihill.demBounds[3]); // N
  });

  it('z15 タイル数 = 128 (= 元 96 から +32、 MAX_TILES 200 内)', () => {
    const demA = alignDemBoundsToZ12Y(fujihill.demBounds);
    expect(tileRangeForBounds(demA, 15).count).toBe(128);
  });

  it('X 軸は元 demBounds のまま (= W/E 不変、 経度方向の高精細メッシュ範囲不変)', () => {
    const demA = alignDemBoundsToZ12Y(fujihill.demBounds);
    expect(demA[0]).toBe(fujihill.demBounds[0]);
    expect(demA[2]).toBe(fujihill.demBounds[2]);
  });

  it('Y 軸は z12 タイル境界に揃う (= z15 範囲が 8 の倍数)', () => {
    const demA = alignDemBoundsToZ12Y(fujihill.demBounds);
    const r15 = tileRangeForBounds(demA, 15);
    expect(r15.yMin % 8).toBe(0);
    expect((r15.yMax + 1) % 8).toBe(0);
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

  it('z12 タイル数 = 12 (= 原と同じ、 既に z12 境界に近かった)', () => {
    const dbA = alignDbBoundsToZ12(fujihill.dbBounds);
    expect(tileRangeForBounds(dbA, 12).count).toBe(12);
  });
});

describe('b70 buildWideStripBboxes (= dbA から demA を引いた 4 strip ring)', () => {
  const demA = alignDemBoundsToZ12Y(fujihill.demBounds);
  const dbA  = alignDbBoundsToZ12(fujihill.dbBounds);

  it('4 strip の z12 タイル数: 北=6 / 南=6 / 東=4 / 西=2 (= 合計 18)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    expect(tileRangeForBounds(s.north, 12).count).toBe(6);
    expect(tileRangeForBounds(s.south, 12).count).toBe(6);
    expect(tileRangeForBounds(s.east,  12).count).toBe(4);
    expect(tileRangeForBounds(s.west,  12).count).toBe(2);
    const sum = Object.values(s)
      .reduce((acc, b) => acc + tileRangeForBounds(b, 12).count, 0);
    expect(sum).toBe(18);
  });

  it('strip 境界 lat/lon が demA の対辺と完全一致 (= 隙間/重複ゼロの数学的証明)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    expect(s.north[1]).toBe(demA[3]);  // north.S === demA.N
    expect(s.south[3]).toBe(demA[1]);  // south.N === demA.S
    expect(s.east[0]).toBe(demA[2]);   // east.W === demA.E
    expect(s.west[2]).toBe(demA[0]);   // west.E === demA.W
  });

  it('demA 中心は 4 strip のどれにも含まれない (= ring 構造証明)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const cx = (demA[0] + demA[2]) / 2;
    const cy = (demA[1] + demA[3]) / 2;
    for (const [name, [w, sy, e, n]] of Object.entries(s)) {
      const inside = (w <= cx && cx <= e && sy <= cy && cy <= n);
      expect(inside, `demA 中心が ${name} に含まれている`).toBe(false);
    }
  });

  it('strip 同士は互いに重複なし (= 角は北・南に寄せる規約で内部に被りゼロ)', () => {
    const s = buildWideStripBboxes(demA, dbA);
    const overlaps = (a, b) =>
      !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
    const keys = Object.keys(s);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(overlaps(s[keys[i]], s[keys[j]]),
          `${keys[i]} と ${keys[j]} が重複`).toBe(false);
      }
    }
  });

  it('4 strip 面積合計 + demA 面積 = dbA 面積 (= 漏れなし証明)', () => {
    const area = (b) => (b[2] - b[0]) * (b[3] - b[1]);
    const s = buildWideStripBboxes(demA, dbA);
    const sum = Object.values(s).reduce((a, b) => a + area(b), 0) + area(demA);
    expect(sum).toBeCloseTo(area(dbA), 10);
  });

  it('demA が dbA の外に出る不正入力で throw (= error path)', () => {
    expect(() => buildWideStripBboxes(
      [138.60, 35.20, 138.90, 35.60], dbA  // demA が dbA より広い
    )).toThrow();
  });
});
