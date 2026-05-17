// brief b7: DEM → 標高グリッド → メッシュ頂点 のデータ経路を pin する.
//
// 各 test は「落ちたら何のバグを捕まえたことになるか」を 1 行で言える形にする
// (= tautological / misleading test を作らない)。 描画 (Three.js) は実画面目視に
// 委ね、 ここでは純粋なデータ変換だけを検証する。

import { describe, it, expect } from 'vitest';
import {
  decodeGsiHeightGrid,
  tileRangeForBounds,
  stitchHeightGrid,
  buildTerrainGeometry,
  courseBounds,
} from '../lib/terrain3d.js';

// === helpers ===

// GSI dem_png encoding: 標高 m を h*100 の 24bit (負値は 2's complement) に詰める.
function gsiEncode(height_m) {
  let raw = Math.round(height_m * 100);
  if (raw < 0) raw += 16777216;
  return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
}

// w*h の GSI RGBA タイルを、 全画素同一標高で作る.
function gsiTileFlat(w, h, height_m) {
  const [r, g, b] = gsiEncode(height_m);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// indices の triangle t の面法線 (= (p1-p0)×(p2-p0)) を返す.
function triangleNormal(positions, indices, t) {
  const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
  const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
  const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
  const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
  const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

// === decodeGsiHeightGrid ===

describe('decodeGsiHeightGrid', () => {
  it('既知標高 1000m の GSI 画素 → 1000m に decode (= encoding 式の取り違えを検出)', () => {
    const rgba = gsiTileFlat(2, 2, 1000);
    const grid = decodeGsiHeightGrid(rgba, 2, 2);
    expect(grid.length).toBe(4);
    for (const v of grid) expect(v).toBeCloseTo(1000, 1);
  });

  it('無効ピクセル (R=128,G=0,B=0) → 0m (= 海域/欠損が巨大値で混入するバグを検出)', () => {
    const rgba = new Uint8ClampedArray([
      128, 0, 0, 255,
      128, 0, 0, 255,
    ]);
    const grid = decodeGsiHeightGrid(rgba, 2, 1);
    expect(Array.from(grid)).toEqual([0, 0]);
  });

  it('負の標高 -50m → -50m (= 2の補数の符号復元漏れを検出)', () => {
    const rgba = gsiTileFlat(1, 1, -50);
    const grid = decodeGsiHeightGrid(rgba, 1, 1);
    expect(grid[0]).toBeCloseTo(-50, 1);
  });
});

// === tileRangeForBounds ===

describe('tileRangeForBounds', () => {
  it('富士ヒルコース bbox を z=14 で覆う → タイル範囲と count が整合 (= y の南北反転を検出)', () => {
    // 富士スバルライン course の概略 bbox (course.json の実 extent 由来)。
    const bounds = [138.689, 35.372, 138.760, 35.453];
    const range = tileRangeForBounds(bounds, 14);
    expect(range.zoom).toBe(14);
    // Web Mercator: 北 (緯度大) ほど y 小 → yMin は北端から。
    expect(range.yMin).toBeLessThanOrEqual(range.yMax);
    expect(range.xMin).toBeLessThanOrEqual(range.xMax);
    expect(range.tilesX).toBe(range.xMax - range.xMin + 1);
    expect(range.tilesY).toBe(range.yMax - range.yMin + 1);
    expect(range.count).toBe(range.tilesX * range.tilesY);
  });

  it('極小 bbox (ほぼ1点) → 1x1 タイル範囲 (= 端タイルの数え落としを検出)', () => {
    const range = tileRangeForBounds([138.75, 35.40, 138.7501, 35.4001], 14);
    expect(range.tilesX).toBe(1);
    expect(range.tilesY).toBe(1);
    expect(range.count).toBe(1);
  });

  it('反転 bbox (E<W) は RangeError (= 引数順ミスを早期に弾く)', () => {
    expect(() => tileRangeForBounds([139, 35, 138, 36], 14)).toThrow(RangeError);
  });
});

// === stitchHeightGrid ===

describe('stitchHeightGrid', () => {
  const range = { xMin: 10, xMax: 11, yMin: 20, yMax: 20, tilesX: 2, tilesY: 1 };

  it('2x1 タイルを連結 → width = 2*tileSize, 各タイルの値が正しい offset に入る', () => {
    const left = new Float32Array(4 * 4).fill(100);   // tileSize=4
    const right = new Float32Array(4 * 4).fill(900);
    const tiles = new Map([['10/20', left], ['11/20', right]]);
    const { grid, width, height } = stitchHeightGrid(tiles, range, 4);
    expect(width).toBe(8);
    expect(height).toBe(4);
    expect(grid[0]).toBe(100);          // 左タイル先頭
    expect(grid[4]).toBe(900);          // 右タイル先頭 (x offset = 4)
    expect(grid[width * 2 + 7]).toBe(900);  // 右タイル 3 行目末尾
  });

  it('欠損タイルは 0m で埋まる (= 1枚 404 で全体が NaN/巨大値に汚染されるのを防ぐ)', () => {
    const left = new Float32Array(4 * 4).fill(100);
    const tiles = new Map([['10/20', left]]);  // 右タイル無し
    const { grid, width } = stitchHeightGrid(tiles, range, 4);
    expect(grid[0]).toBe(100);   // 左は値あり
    expect(grid[4]).toBe(0);     // 右は 0m 埋め
  });
});

// === buildTerrainGeometry ===

describe('buildTerrainGeometry', () => {
  const range = { zoom: 14, xMin: 14503, yMin: 6461 };

  // 高さがグリッド位置で変化する 8x8 の標高グリッドを作る (= 平坦でない地形).
  function rampGrid(w, h) {
    const grid = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grid[y * w + x] = 1000 + x * 10 + y * 5;  // 1000m 基準で傾斜
      }
    }
    return { grid, width: w, height: h };
  }

  it('頂点数 = gw*gh, index 数 = (gw-1)(gh-1)*6 (= 格子・三角形の数え違いを検出)', () => {
    const geo = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8 });
    expect(geo.vertexCount).toBe(geo.gw * geo.gh);
    expect(geo.positions.length).toBe(geo.gw * geo.gh * 3);
    expect(geo.indices.length).toBe((geo.gw - 1) * (geo.gh - 1) * 6);
    expect(geo.uvs.length).toBe(geo.gw * geo.gh * 2);
  });

  it('minH/maxH が入力グリッドの標高 min/max と一致 (= 標高を頂点に乗せ損なうのを検出)', () => {
    const geo = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8 });
    // ramp は 1000 .. 1000+7*10+7*5 = 1105
    expect(geo.minH).toBeCloseTo(1000, 3);
    expect(geo.maxH).toBeCloseTo(1105, 3);
  });

  it('標高が頂点 Y に乗る (= 起伏ゼロの平板になっていないことを検出)', () => {
    const geo = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8 });
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 1; i < geo.positions.length; i += 3) {
      yMin = Math.min(yMin, geo.positions[i]);
      yMax = Math.max(yMax, geo.positions[i]);
    }
    expect(yMax - yMin).toBeCloseTo(105, 1);  // ramp の標高差がそのまま Y 差に
  });

  it('exaggeration で Y がスケールする (= 誇張係数が無視されるのを検出)', () => {
    const flat = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8, exaggeration: 1 });
    const tall = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8, exaggeration: 3 });
    expect(tall.positions[1]).toBeCloseTo(flat.positions[1] * 3, 3);
  });

  it('step で頂点が間引かれる (= 巨大メッシュ対策の downsample が効くことを保証)', () => {
    const full = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8, step: 1 });
    const thin = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8, step: 2 });
    expect(thin.vertexCount).toBeLessThan(full.vertexCount);
    expect(thin.gw).toBe(4);  // (8-1)/2 + 1 = 4
  });

  it('全頂点座標が有限, uv は [0,1] (= NaN 投影や uv はみ出しを検出)', () => {
    const geo = buildTerrainGeometry(rampGrid(8, 8), range, { tileSize: 8 });
    for (const v of geo.positions) expect(Number.isFinite(v)).toBe(true);
    for (const uv of geo.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0);
      expect(uv).toBeLessThanOrEqual(1);
    }
  });

  it('三角形の面法線が +Y を向く (= winding 逆転で地形が真っ黒/裏返るバグを検出)', () => {
    // 平坦グリッドなら全三角形が真上向き。 winding が逆なら normal.y < 0。
    const flat = { grid: new Float32Array(8 * 8).fill(1500), width: 8, height: 8 };
    const geo = buildTerrainGeometry(flat, range, { tileSize: 8 });
    const triCount = geo.indices.length / 3;
    for (let t = 0; t < triCount; t++) {
      const n = triangleNormal(geo.positions, geo.indices, t);
      expect(n[1]).toBeGreaterThan(0);
    }
  });

  it('1x1 グリッドは RangeError (= メッシュを張れない退化入力を弾く)', () => {
    expect(() => buildTerrainGeometry(
      { grid: new Float32Array(1), width: 1, height: 1 }, range, {})).toThrow(RangeError);
  });
});

// === courseBounds ===

describe('courseBounds', () => {
  it('course の全点 + 余白を含む bbox を返す (= 外接矩形の取り違えを検出)', () => {
    const course = [
      { lat: 35.40, lon: 138.70 },
      { lat: 35.45, lon: 138.75 },
    ];
    const [w, s, e, n] = courseBounds(course, 500);
    expect(w).toBeLessThan(138.70);
    expect(s).toBeLessThan(35.40);
    expect(e).toBeGreaterThan(138.75);
    expect(n).toBeGreaterThan(35.45);
  });

  it('余白を増やすと bbox が広がる (= bufferM が無視されるのを検出)', () => {
    const course = [{ lat: 35.40, lon: 138.70 }, { lat: 35.45, lon: 138.75 }];
    const narrow = courseBounds(course, 100);
    const wide = courseBounds(course, 2000);
    expect(wide[0]).toBeLessThan(narrow[0]);
    expect(wide[2]).toBeGreaterThan(narrow[2]);
  });

  it('空 course は RangeError (= 富士ヒルコース未ロードで沈黙破綻するのを防ぐ)', () => {
    expect(() => courseBounds([], 500)).toThrow(RangeError);
  });
});

// === full path: DEM RGBA → 標高グリッド → メッシュ頂点 ===

describe('DEM → 標高グリッド → メッシュ頂点 のデータ経路', () => {
  it('GSI タイル群を decode→stitch→geometry まで通し、 標高が頂点 Y に届く', () => {
    // 2x1 タイル (tileSize=4)、 左 1200m / 右 1800m。
    const range = { zoom: 14, xMin: 14503, xMax: 14504, yMin: 6461, yMax: 6461,
                     tilesX: 2, tilesY: 1 };
    const leftRgba = gsiTileFlat(4, 4, 1200);
    const rightRgba = gsiTileFlat(4, 4, 1800);
    const tiles = new Map([
      ['14503/6461', decodeGsiHeightGrid(leftRgba, 4, 4)],
      ['14504/6461', decodeGsiHeightGrid(rightRgba, 4, 4)],
    ]);
    const stitched = stitchHeightGrid(tiles, range, 4);
    expect(stitched.width).toBe(8);
    const geo = buildTerrainGeometry(stitched, range, { tileSize: 4 });
    // 標高範囲 1200..1800 がそのまま頂点の Y に出る。
    expect(geo.minH).toBeCloseTo(1200, 1);
    expect(geo.maxH).toBeCloseTo(1800, 1);
    expect(geo.vertexCount).toBe(geo.gw * geo.gh);
  });
});
