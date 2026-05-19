// b13-2: TerrainSurface ユニットテスト.
//
// 検証対象:
//   - heightAt: sampleHeightBilinear×exaggeration を返すこと (exaggeration=1 と exaggeration≠1)
//   - project: XZ 符号が terrain3d.js と一致すること (東=+X / 北=-Z)
//   - ROAD_OFFSET_M: エクスポートされ正の値であること

import { describe, it, expect } from 'vitest';
import {
  TerrainSurface, ROAD_OFFSET_M, meshGridStep, sampleMeshHeight,
} from '../lib/map3d/terrain_surface.js';
import { sampleHeightBilinear } from '../lib/terrain3d.js';
import { tileXToLon, tileYToLat } from '../lib/tile_math.js';

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

// 連続ピクセル (px,py) に対応する緯度経度 (= sampleHeightBilinear の fx/fy 写像の逆)。
// これで任意のピクセル位置をピンポイントでサンプルできる。
function pixelToLatLon(rg, px, py, tileSize) {
  return {
    lon: tileXToLon(rg.xMin + px / tileSize, rg.zoom),
    lat: tileYToLat(rg.yMin + py / tileSize, rg.zoom),
  };
}

describe('meshGridStep', () => {
  it('長辺が targetGridDim 以下なら 1 (= 間引き無し)', () => {
    // 落ちたら: 小さいグリッドを無駄に間引く / step が 0 以下になるバグ。
    expect(meshGridStep(16, 16)).toBe(1);
    expect(meshGridStep(400, 400)).toBe(1);
    expect(meshGridStep(1, 1)).toBe(1);
  });

  it('長辺が targetGridDim を超えたら間引く (= 境界値 401→2 / 801→3)', () => {
    // 落ちたら: 間引き境界の off-by-one。
    expect(meshGridStep(401, 401)).toBe(2);
    expect(meshGridStep(800, 800)).toBe(2);
    expect(meshGridStep(801, 801)).toBe(3);
  });

  it('width / height の大きい方で step が決まる (= 非正方グリッドの取り違えを検出)', () => {
    expect(meshGridStep(800, 16)).toBe(2);
    expect(meshGridStep(16, 1200)).toBe(3);
  });
});

describe('sampleMeshHeight', () => {
  const rg = { zoom: 14, xMin: 14503, yMin: 6464 };

  it('フラット grid は step に関係なく同じ標高を返す', () => {
    // 落ちたら: 三角形分割の補間係数ミスで定数面が定数を返さない。
    const W = 401;
    const st = { grid: new Float32Array(W * W).fill(1234), width: W, height: W };
    const { lat, lon } = pixelToLatLon(rg, 137.4, 88.2, 256);
    expect(sampleMeshHeight(st, rg, lat, lon, meshGridStep(W, W), 256)).toBeCloseTo(1234, 3);
  });

  it('線形ランプ grid では間引き面 = 真の面 (= 補間値の正しさを pin)', () => {
    // 標高 = 1000 + px の線形ランプ。 線形面は間引いても線形補間で元に戻るので、
    // sampleMeshHeight は間引き頂点に乗らない点でも真のランプ値を返すはず。
    // 落ちたら: 補間の重み付けが間違っている。
    const W = 401;
    const grid = new Float32Array(W * W);
    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) grid[py * W + px] = 1000 + px;
    }
    const st = { grid, width: W, height: W };
    const probe = pixelToLatLon(rg, 137, 200, 256);  // px=137 は間引き頂点 (偶数) に乗らない
    expect(sampleMeshHeight(st, rg, probe.lat, probe.lon, meshGridStep(W, W), 256))
      .toBeCloseTo(1137, 1);
  });

  it('間引き頂点はフラット H・頂点間は凹の grid で、 頂点間でも間引き面 H を返す', () => {
    // 核心テスト: 間引き頂点 (step 刻み画素) を全て H、 その間の画素を H-D に凹ませる。
    // 地形メッシュ (= 間引き頂点だけで張る) は標高 H の平面。 sampleMeshHeight は
    // 頂点間の点でも H を返す (= 間引き面を見ている) のに対し、 sampleHeightBilinear
    // はフル解像度なので凹みを拾い < H を返す。
    // 落ちたら: sampleMeshHeight がフル解像度 DEM を見てしまっている (= バグ未修正)。
    const W = 401, H = 1400, D = 50;
    const grid = new Float32Array(W * W);
    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        grid[py * W + px] = (px % 2 === 0 && py % 2 === 0) ? H : H - D;
      }
    }
    const st = { grid, width: W, height: W };
    const step = meshGridStep(W, W);
    expect(step).toBe(2);  // 間引きが効いている前提
    const { lat, lon } = pixelToLatLon(rg, 1, 1, 256);  // セル中心 = 頂点間
    expect(sampleMeshHeight(st, rg, lat, lon, step, 256)).toBeCloseTo(H, 3);
    expect(sampleHeightBilinear(st, rg, lat, lon, 256)).toBeLessThan(H - 1);
  });
});
