// b13-2: TerrainSurface ユニットテスト.
//
// 検証対象:
//   - heightAt: sampleHeightBilinear×exaggeration を返すこと (exaggeration=1 と exaggeration≠1)
//   - project: XZ 符号が terrain3d.js と一致すること (東=+X / 北=-Z)
//   - ROAD_OFFSET_M: エクスポートされ正の値であること

import { describe, it, expect } from 'vitest';
import { TerrainSurface, ROAD_OFFSET_M } from '../lib/map3d/terrain_surface.js';

// terrain3d.test.js と同じ最小 fixture (= sampleHeightBilinear が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40;
const centerLon = 138.72;

const M_PER_DEG_LAT = 111320;

describe('ROAD_OFFSET_M', () => {
  it('正の値でエクスポートされる (= SoT が terrain_surface.js にある)', () => {
    expect(typeof ROAD_OFFSET_M).toBe('number');
    expect(ROAD_OFFSET_M).toBeGreaterThan(0);
  });

  it('旧 drapeOffset (15m / 25m) より小さい (= 過大オフセット回帰を検出)', () => {
    expect(ROAD_OFFSET_M).toBeLessThan(15);
  });
});

describe('TerrainSurface.heightAt', () => {
  it('exaggeration=1 のとき sampleHeightBilinear と同値 (= 掛け算ゼロの回帰を検出)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon, tileSize: TS, exaggeration: 1 });
    expect(surf.heightAt(35.40, 138.72)).toBeCloseTo(1400, 3);
  });

  it('exaggeration=2 のとき DEM 標高の 2 倍を返す (= exaggeration 抜けのバグを検出)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon, tileSize: TS, exaggeration: 2 });
    expect(surf.heightAt(35.40, 138.72)).toBeCloseTo(2800, 3);
  });

  it('exaggeration 省略時は 1.0 と同じ (= デフォルト値を pin)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon, tileSize: TS });
    expect(surf.heightAt(35.40, 138.72)).toBeCloseTo(1400, 3);
  });
});

describe('TerrainSurface.project', () => {
  it('中心点 (centerLat/centerLon) は x=0, z=0 (= 投影の原点を pin)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon });
    const { x, z } = surf.project(centerLat, centerLon);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('東へ移動すると x が正になる (= 東=+X の符号を pin)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon });
    const { x } = surf.project(centerLat, centerLon + 0.01);
    expect(x).toBeGreaterThan(0);
  });

  it('北へ移動すると z が負になる (= 北=-Z の符号を pin)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon });
    const { z } = surf.project(centerLat + 0.01, centerLon);
    expect(z).toBeLessThan(0);
  });

  it('XZ 値が terrain3d.js の投影式と一致する (= ラベル/リボンとのズレを検出)', () => {
    const surf = new TerrainSurface({ stitched, range, centerLat, centerLon });
    const testLat = 35.41;
    const testLon = 138.73;
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
    const expectedX = (testLon - centerLon) * mPerDegLon;
    const expectedZ = -(testLat - centerLat) * M_PER_DEG_LAT;
    const { x, z } = surf.project(testLat, testLon);
    expect(x).toBeCloseTo(expectedX, 4);
    expect(z).toBeCloseTo(expectedZ, 4);
  });
});
