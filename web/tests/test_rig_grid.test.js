import { describe, it, expect } from 'vitest';
import {
  computeGridValues, worldToScreen, latLonToEastNorth,
  drawGrid, drawCoursePath, drawRiderMarker,
} from '../lib/test_rig_grid.js';

// CanvasRenderingContext2D の最小 mock (= 呼出回数だけ取れれば良い).
function makeCtx() {
  const calls = {
    save: 0, restore: 0, beginPath: 0, stroke: 0, fill: 0,
    moveTo: [], lineTo: [], fillRect: 0, fillText: [],
    translate: [], closePath: 0,
  };
  return {
    save()  { calls.save++; },
    restore() { calls.restore++; },
    beginPath() { calls.beginPath++; },
    stroke() { calls.stroke++; },
    fill() { calls.fill++; },
    moveTo(x, y) { calls.moveTo.push([x, y]); },
    lineTo(x, y) { calls.lineTo.push([x, y]); },
    fillRect() { calls.fillRect++; },
    fillText(t, x, y) { calls.fillText.push([t, x, y]); },
    translate(x, y) { calls.translate.push([x, y]); },
    closePath() { calls.closePath++; },
    set fillStyle(_v) {},
    set strokeStyle(_v) {},
    set lineWidth(_v) {},
    set font(_v) {},
    _calls: calls,
  };
}

describe('test_rig_grid', () => {
  describe('computeGridValues', () => {
    it('1000×1000 canvas, pxPerMeter=2, 100m gridSize → 半対角 ≒ 354m → ±400 刻みで 9 値', () => {
      const v = computeGridValues({ width: 1000, height: 1000, pxPerMeter: 2, gridSize: 100 });
      expect(v).toEqual([-400, -300, -200, -100, 0, 100, 200, 300, 400]);
    });

    it('200×200 canvas, pxPerMeter=2, 10m gridSize → 半対角 ≒ 71m → ±80 刻み 17 値', () => {
      const v = computeGridValues({ width: 200, height: 200, pxPerMeter: 2, gridSize: 10 });
      expect(v.length).toBe(17);
      expect(v[0]).toBe(-80);
      expect(v[v.length - 1]).toBe(80);
    });

    it('0 を必ず含む (= rider 中心を通る軸)', () => {
      const v = computeGridValues({ width: 800, height: 600, pxPerMeter: 1.5, gridSize: 50 });
      expect(v).toContain(0);
    });
  });

  describe('worldToScreen', () => {
    const proj0 = { width: 200, height: 200, bearingDeg: 0, pxPerMeter: 2 };

    it('bearing=0: (0, 100) 北 → 画面上 (y < 中心)', () => {
      const p = worldToScreen(0, 100, proj0);
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(100 - 200, 6);
    });

    it('bearing=0: (100, 0) 東 → 画面右 (x > 中心)', () => {
      const p = worldToScreen(100, 0, proj0);
      expect(p.x).toBeCloseTo(100 + 200, 6);
      expect(p.y).toBeCloseTo(100, 6);
    });

    it('bearing=90 (= 東進): (100, 0) 東 → 画面上に来る (進行方向が画面上)', () => {
      const p = worldToScreen(100, 0, { ...proj0, bearingDeg: 90 });
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(100 - 200, 6);
    });

    it('bearing=90 (= 東進): (0, 100) 北 → 画面左に来る (北は左)', () => {
      const p = worldToScreen(0, 100, { ...proj0, bearingDeg: 90 });
      expect(p.x).toBeCloseTo(100 - 200, 6);
      expect(p.y).toBeCloseTo(100, 6);
    });

    it('bearing=180 (= 南進): (0, 100) 北 → 画面下 (背後)', () => {
      const p = worldToScreen(0, 100, { ...proj0, bearingDeg: 180 });
      expect(p.x).toBeCloseTo(100, 6);
      expect(p.y).toBeCloseTo(100 + 200, 6);
    });
  });

  describe('latLonToEastNorth', () => {
    it('同点なら 0,0', () => {
      const r = latLonToEastNorth(35.45, 138.75, 35.45, 138.75);
      expect(r.e_m).toBeCloseTo(0, 6);
      expect(r.n_m).toBeCloseTo(0, 6);
    });

    it('北 0.001° → 約 111.32 m north', () => {
      const r = latLonToEastNorth(35.451, 138.75, 35.45, 138.75);
      expect(r.n_m).toBeCloseTo(111.32, 1);
      expect(r.e_m).toBeCloseTo(0, 6);
    });

    it('東 0.001° @ lat=35.45 → 約 90.71 m east (= 111.32 × cos35.45°)', () => {
      const r = latLonToEastNorth(35.45, 138.751, 35.45, 138.75);
      expect(r.e_m).toBeCloseTo(90.71, 1);
      expect(r.n_m).toBeCloseTo(0, 6);
    });
  });

  describe('drawGrid', () => {
    it('100m 太線 + 10m 細線の本数が computeGridValues と一致 (= stroke 回数)', () => {
      const opts = { width: 1000, height: 1000, riderLat: 35.45, riderLon: 138.75, bearingDeg: 0, pxPerMeter: 2 };
      const ctx = makeCtx();
      drawGrid(ctx, opts);
      const v100 = computeGridValues({ width: 1000, height: 1000, pxPerMeter: 2, gridSize: 100 });
      const v10  = computeGridValues({ width: 1000, height: 1000, pxPerMeter: 2, gridSize: 10  });
      // 各 value につき e-line + n-line で 2 strokes.
      const expected = (v100.length + v10.length) * 2;
      expect(ctx._calls.stroke).toBe(expected);
    });

    it('bearing=0 と bearing=90 で stroke 数は同じ (= 同じ grid 構造を回転描画してるだけ)', () => {
      const base = { width: 400, height: 400, riderLat: 0, riderLon: 0, pxPerMeter: 2 };
      const c0 = makeCtx();
      const c90 = makeCtx();
      drawGrid(c0, { ...base, bearingDeg: 0 });
      drawGrid(c90, { ...base, bearingDeg: 90 });
      expect(c90._calls.stroke).toBe(c0._calls.stroke);
    });

    it('bearing=90 で「北 100m」 が画面左に来る (= rider 進行方向が画面上)', () => {
      // 直接 worldToScreen で確認、 drawGrid は内部 helper で同じ式を使う前提
      const proj = { width: 200, height: 200, bearingDeg: 90, pxPerMeter: 2 };
      const p = worldToScreen(0, 100, proj);
      expect(p.x).toBeLessThan(100); // 中心より左
      expect(p.y).toBeCloseTo(100, 1);
    });

    it('100m 毎の座標 label が描画される (= fillText が 100m 軸ごとに呼ばれる)', () => {
      const ctx = makeCtx();
      drawGrid(ctx, { width: 400, height: 400, riderLat: 0, riderLon: 0, bearingDeg: 0, pxPerMeter: 2 });
      // 100m values: ceil(sqrt(2*40000)/2/2/100)=2 → -200..200 step 100 → 5 values
      // 0 はスキップ、 残り 4 値 × (east + north) = 8 label
      expect(ctx._calls.fillText.length).toBe(8);
    });

    it('背景クリア (= fillRect が 1 回呼ばれる)', () => {
      const ctx = makeCtx();
      drawGrid(ctx, { width: 100, height: 100, riderLat: 0, riderLon: 0, bearingDeg: 0, pxPerMeter: 2 });
      expect(ctx._calls.fillRect).toBe(1);
    });
  });

  describe('drawCoursePath', () => {
    it('course 列を polyline で描く (= moveTo 1 + lineTo n-1)', () => {
      const ctx = makeCtx();
      const course = [
        { lat: 35.45,  lon: 138.75 },
        { lat: 35.451, lon: 138.75 },
        { lat: 35.452, lon: 138.75 },
        { lat: 35.453, lon: 138.75 },
      ];
      drawCoursePath(ctx, course, {
        width: 200, height: 200,
        riderLat: 35.45, riderLon: 138.75,
        bearingDeg: 0, pxPerMeter: 2,
      });
      expect(ctx._calls.moveTo.length).toBe(1);
      expect(ctx._calls.lineTo.length).toBe(3);
      expect(ctx._calls.stroke).toBe(1);
    });

    it('空 course なら no-op', () => {
      const ctx = makeCtx();
      drawCoursePath(ctx, [], {
        width: 200, height: 200,
        riderLat: 0, riderLon: 0, bearingDeg: 0, pxPerMeter: 2,
      });
      expect(ctx._calls.moveTo.length).toBe(0);
      expect(ctx._calls.stroke).toBe(0);
    });
  });

  describe('drawRiderMarker', () => {
    it('画面中央に三角形マーカ (= translate(w/2, h/2) + 三辺 lineTo)', () => {
      const ctx = makeCtx();
      drawRiderMarker(ctx, { width: 200, height: 200 });
      expect(ctx._calls.translate).toEqual([[100, 100]]);
      expect(ctx._calls.fill).toBe(1);
      expect(ctx._calls.closePath).toBe(1);
    });
  });
});
