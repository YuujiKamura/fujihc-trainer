// b12 Phase3 部品3 course_ribbon3d のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
// Three.js の実描画 (リボンの見た目) は実画面目視に委ね、 ここでは
//   - ribbonSegmentBins:  course → 区間ごとのグレード bin 色 (純関数)
//   - ribbonColorGroups:  区間色 → 同色連続区間の geometry group 配列 (純関数)
//   - createCourseRibbon: BufferGeometry の構成 / attribute 長 / group / material (mock THREE)
// を検証する。 配色を区間フラット塗り (1 区間 1 色、 bin 境界で段差) に pin する。

import { describe, it, expect } from 'vitest';
import { ribbonSegmentBins, ribbonColorGroups, createCourseRibbon } from '../lib/map3d/course_ribbon3d.js';
import { gradeColorContinuous } from '../lib/route_styling.js';
import { meshGridStep } from '../lib/map3d/terrain_surface.js';
import { buildTerrainGeometry } from '../lib/terrain3d.js';
import { tileXToLon, tileYToLat } from '../lib/tile_math.js';

// terrain3d.test.js と同じ最小 fixture (= buildCourseRibbon が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40, centerLon = 138.72;
const geo = { range, stitched, centerLat, centerLon, tileSize: TS };
// 区間ごとに勾配が違うコース (= 全区間同色にならない、 色の対応を実際に走らせる)。
// 区間 i の色 = gradeColorContinuous(course[i].slope_pct)。 区間 0 → 始点 slope 0、
// 区間 1 → 始点 slope 7 ── 0.5% 刻みの連続ランプで別色になる。
const course = [
  { lat: 35.395, lon: 138.715, slope_pct: 0 },
  { lat: 35.405, lon: 138.720, slope_pct: 7 },
  { lat: 35.420, lon: 138.720, slope_pct: 15 },
];

// createCourseRibbon が使う Three.js API だけを持つ最小 mock。
// 実 Three.js の描画挙動は pin しない (= 実画面目視)。 ここでは
// 「BufferGeometry に position/index/group、 単色 material 配列、 dispose」 を pin する。
function mockThree() {
  return {
    DoubleSide: 'DoubleSide',
    BufferGeometry: class {
      constructor() {
        this.attributes = {};
        this.index = null;
        this.groups = [];
        this.disposed = false;
      }
      setAttribute(name, attr) { this.attributes[name] = attr; }
      setIndex(attr) { this.index = attr; }
      computeVertexNormals() { this.normalsComputed = true; }
      addGroup(start, count, materialIndex) {
        this.groups.push({ start, count, materialIndex });
      }
      dispose() { this.disposed = true; }
    },
    Float32BufferAttribute: class {
      constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    },
    BufferAttribute: class {
      constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    },
    MeshLambertMaterial: class {
      constructor(o) {
        this.color = o.color;
        this.vertexColors = !!o.vertexColors;
        this.side = o.side;
        this.disposed = false;
      }
      dispose() { this.disposed = true; }
    },
    Mesh: class {
      constructor(geometry, material) { this.geometry = geometry; this.material = material; }
    },
  };
}

describe('ribbonSegmentBins', () => {
  it('長さ = course.length-1 (= 区間ごとに 1 色、 区間数の配列形を pin)', () => {
    expect(ribbonSegmentBins(course).length).toBe(course.length - 1);
  });

  it('区間 i の色 = gradeColorContinuous(course[i].slope_pct) (= 始点勾配採用、 0.5% 刻みの連続ランプ色)', () => {
    const bins = ribbonSegmentBins(course);
    for (let i = 0; i < course.length - 1; i++) {
      expect(bins[i]).toBe(gradeColorContinuous(course[i].slope_pct));
    }
  });

  it('区間色は始点 course[i] 由来 ── 終点 course[i+1] 由来ではない (= 色が勾配区間より 1 区間後ろへずれる回帰を検出)', () => {
    // fixture course は点ごとに slope_pct が違う (0 / 7 / 15)。 区間 0 を終点 course[1]
    // (slope 7) で塗ると色が rider 体感勾配より 1 区間後ろにずれる ── 始点 course[0]
    // (slope 0) を採ることを pin する。
    const bins = ribbonSegmentBins(course);
    expect(bins[0]).toBe(gradeColorContinuous(course[0].slope_pct));
    expect(bins[0]).not.toBe(gradeColorContinuous(course[1].slope_pct));
  });

  it('勾配が違えば区間色も違う (= 全区間が同色になり勾配が読めないバグを検出)', () => {
    // 区間 0 (始点 slope 0) と区間 1 (始点 slope 7) は連続ランプ上で別色のはず。
    const bins = ribbonSegmentBins(course);
    expect(bins[0]).not.toBe(bins[1]);
  });

  it('始点 slope 欠損は終点 slope へ fallback (= 欠損点でも区間色が決まる)', () => {
    // 区間 0 の始点 course[0] は slope_pct 無し → 終点 course[1] の slope 8 を使う。
    const bins = ribbonSegmentBins([
      { lat: 35.4, lon: 138.7 },                  // slope_pct なし
      { lat: 35.41, lon: 138.71, slope_pct: 8 },
    ]);
    expect(bins[0]).toBe(gradeColorContinuous(8));
  });

  it('始点・終点とも slope 欠損なら flat (= 勾配 0 の色、 NaN が色計算に漏れるのを防ぐ)', () => {
    const bins = ribbonSegmentBins([
      { lat: 35.4, lon: 138.7 },
      { lat: 35.41, lon: 138.71 },
    ]);
    expect(bins[0]).toBe(gradeColorContinuous(0));  // = flat 緑
  });

  it('2 点未満は RangeError (= 区間を張れない退化入力を弾く)', () => {
    expect(() => ribbonSegmentBins([{ slope_pct: 5 }])).toThrow(RangeError);
    expect(() => ribbonSegmentBins([])).toThrow(RangeError);
  });

  it('色は 0.5% 勾配刻みで変わる ── 同じ 0.5% バケットの区間は同色、 別バケットは別色', () => {
    // gradeColorContinuous は slope を 0.5% に量子化してからランプをサンプルする。
    // 区間色は始点 slope_pct。 5.0% と 5.2% は同じ 0.5% バケット (round で 5.0) → 同色。
    const sameBucket = ribbonSegmentBins([
      { lat: 35.40, lon: 138.71, slope_pct: 5.0 },
      { lat: 35.41, lon: 138.72, slope_pct: 5.2 },
      { lat: 35.42, lon: 138.73, slope_pct: 0 },
    ]);
    expect(sameBucket[0]).toBe(sameBucket[1]);
    // 5.0% と 6.0% は別の 0.5% バケット → 色が段で変わる。
    const diffBucket = ribbonSegmentBins([
      { lat: 35.40, lon: 138.71, slope_pct: 5.0 },
      { lat: 35.41, lon: 138.72, slope_pct: 6.0 },
      { lat: 35.42, lon: 138.73, slope_pct: 0 },
    ]);
    expect(diffBucket[0]).not.toBe(diffBucket[1]);
  });
});

describe('ribbonColorGroups', () => {
  it('group が index 0 から隙間なく連続し count 総和 = 区間数*6 (= 塗り残し / 重なりが無い)', () => {
    const groups = ribbonColorGroups(['#3aa055', '#f4d03f', '#f4d03f', '#e74c3c']);  // 4 区間
    let cursor = 0;
    for (const g of groups) {
      expect(g.start).toBe(cursor);  // 前 group の直後から始まる
      cursor += g.count;
    }
    expect(cursor).toBe(4 * 6);  // 全 index (区間数*6) を覆う
  });

  it('各 group の start / count が 6 の倍数 (= 1 区間が group に分断されず単色)', () => {
    const groups = ribbonColorGroups(['#3aa055', '#f4d03f', '#f4d03f', '#e74c3c']);
    for (const g of groups) {
      expect(g.start % 6).toBe(0);
      expect(g.count % 6).toBe(0);
    }
  });

  it('同色の連続区間は 1 group にまとまる (= 区間ラン、 同一ビン区間が同色)', () => {
    // 区間 1,2 は同色 → 1 group (count 12) にまとまるはず。
    const groups = ribbonColorGroups(['#3aa055', '#f4d03f', '#f4d03f', '#e74c3c']);
    expect(groups.length).toBe(3);
    expect(groups[1]).toEqual({ start: 6, count: 12, color: '#f4d03f' });
  });

  it('色が変わる隣接区間は別 group・別色 (= bin 境界で段差)', () => {
    const groups = ribbonColorGroups(['#3aa055', '#f4d03f']);
    expect(groups.length).toBe(2);
    expect(groups[0].color).not.toBe(groups[1].color);
    expect(groups[0]).toEqual({ start: 0, count: 6, color: '#3aa055' });
    expect(groups[1]).toEqual({ start: 6, count: 6, color: '#f4d03f' });
  });

  it('全区間が同色なら group は 1 つ (= 連続する同一ビン区間が 1 ラン)', () => {
    const groups = ribbonColorGroups(['#f4d03f', '#f4d03f', '#f4d03f']);
    expect(groups).toEqual([{ start: 0, count: 18, color: '#f4d03f' }]);
  });

  it('1 区間でも 1 group (= 2 点コースの退化ケース)', () => {
    expect(ribbonColorGroups(['#3aa055'])).toEqual([{ start: 0, count: 6, color: '#3aa055' }]);
  });

  it('区間ゼロは RangeError (= 描画する区間が無い退化入力を弾く)', () => {
    expect(() => ribbonColorGroups([])).toThrow(RangeError);
  });
});

describe('createCourseRibbon', () => {
  it('mesh は BufferGeometry + material 配列で構成される', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry).toBeDefined();
    expect(Array.isArray(r.mesh.material)).toBe(true);
    expect(r.mesh.material.length).toBeGreaterThan(0);
  });

  it('position attribute 長 = n*2*3 (= rider 配置 ribbonCenterAt が読む n*2 頂点レイアウトを保つ)', () => {
    // 落ちたら: 頂点を複製 (de-index) して position 属性長を変えてしまった
    //          ── map3d/index.js → rider_placement.js の rider 配置が静かに壊れる。
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry.attributes.position.array.length).toBe(course.length * 2 * 3);
  });

  it('color (頂点色) attribute は持たない (= 補間する頂点色をやめ単色 material に移行済)', () => {
    // 落ちたら: 頂点色 attribute を残している ── 単色 material 方式では未使用、
    //          残すと vertexColors 描画へ逆戻りした疑い。
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry.attributes.color).toBeUndefined();
  });

  it('index attribute 長 = (n-1)*6 (= 区間あたり 2 三角形、 index は buildCourseRibbon のまま不変)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry.index.array.length).toBe((course.length - 1) * 6);
  });

  it('geometry.groups が ribbonColorGroups(ribbonSegmentBins(course)) と一致 (= 区間ランを material 別に分割)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    const expectGroups = ribbonColorGroups(ribbonSegmentBins(course));
    expect(r.mesh.geometry.groups.length).toBe(expectGroups.length);
    for (let k = 0; k < expectGroups.length; k++) {
      expect(r.mesh.geometry.groups[k].start).toBe(expectGroups[k].start);
      expect(r.mesh.geometry.groups[k].count).toBe(expectGroups[k].count);
    }
  });

  it('各 group の material が単色 MeshLambertMaterial (頂点色 OFF) + DoubleSide で、 色が区間 bin 色と一致 (= 混色 / 裏面抜け / 色取り違えを検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    const expectGroups = ribbonColorGroups(ribbonSegmentBins(course));
    for (let k = 0; k < r.mesh.geometry.groups.length; k++) {
      const mat = r.mesh.material[r.mesh.geometry.groups[k].materialIndex];
      expect(mat.vertexColors).toBe(false);   // 頂点色補間を使わない (= 区間内で混色しない)
      expect(mat.side).toBe('DoubleSide');
      expect(mat.color).toBe(expectGroups[k].color);
    }
  });

  it('区間 i の 6 index がちょうど 1 つの group・1 色に対応 (= 1 区間が単色、 区間内で混色しない)', () => {
    // 区間ごとに勾配を変えたコースで、 各区間の index 範囲 [seg*6, seg*6+6) を覆う
    // group がちょうど 1 つと確認する ── 2 つに割れていたら 1 区間が 2 色 = 混色回帰。
    const c = [
      { lat: 35.40, lon: 138.71, slope_pct: 0 },
      { lat: 35.41, lon: 138.72, slope_pct: 2 },   // 区間 0 終点 → gentle
      { lat: 35.42, lon: 138.73, slope_pct: 8 },   // 区間 1 終点 → hard
    ];
    const r = createCourseRibbon(mockThree(), c, geo);
    for (let seg = 0; seg < c.length - 1; seg++) {
      const lo = seg * 6, hi = seg * 6 + 6;
      const covering = r.mesh.geometry.groups.filter(
        (g) => g.start <= lo && g.start + g.count >= hi);
      expect(covering.length).toBe(1);
    }
  });

  it('dispose で geometry と全 material を解放 (= course 再読込時の GPU leak を検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    const geometry = r.mesh.geometry;
    const materials = r.mesh.material;
    r.dispose();
    expect(geometry.disposed).toBe(true);
    for (const m of materials) expect(m.disposed).toBe(true);
  });
});

// 連続ピクセル (px,py) に対応する緯度経度 (= terrain3d.js の投影の逆)。
function pixelToLatLon(rg, px, py, tileSize) {
  return {
    lon: tileXToLon(rg.xMin + px / tileSize, rg.zoom),
    lat: tileYToLat(rg.yMin + py / tileSize, rg.zoom),
  };
}

describe('createCourseRibbon — 地形メッシュ追随 (埋まり修正)', () => {
  // 間引き頂点 (step 刻み画素) は標高 H、 その間の画素は H-D に凹ませた DEM。
  // 地形メッシュ (buildTerrainGeometry を step 付きで呼ぶ) はこの間引き頂点だけで
  // 張られるので標高 H の平面、 フル解像度 DEM は頂点間で H-D に凹む。
  function concaveGrid(W, H, D) {
    const grid = new Float32Array(W * W);
    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        grid[py * W + px] = (px % 2 === 0 && py % 2 === 0) ? H : H - D;
      }
    }
    return { grid, width: W, height: W };
  }

  it('間引き地形メッシュに埋まる / 浮くリボン頂点が無い', () => {
    // 落ちたら: リボンがフル解像度 DEM で drape され凹区間で地形メッシュより下に
    //          潜る (= 「コースが地形に埋まる」バグそのもの)。 conformRibbonToMesh を
    //          外すとこのテストが落ちる (= 真正性確認の対象)。
    const W = 401, H = 1400, D = 50, OFFSET = 2;
    const stitched = concaveGrid(W, H, D);
    const rg = { zoom: 14, xMin: 14503, yMin: 6464 };
    const TS = 256;
    expect(meshGridStep(W, W)).toBe(2);  // 間引きが効いている前提

    // 前提確認: この合成 grid の地形メッシュは標高 H の平面である。
    const tg = buildTerrainGeometry(stitched, rg, { tileSize: TS, step: 2, exaggeration: 1 });
    for (let k = 1; k < tg.positions.length; k += 3) {
      expect(tg.positions[k]).toBeCloseTo(H, 3);
    }

    // grid を斜めに横切るコース (= 多くの頂点が間引きセルの内側に落ちる)。
    const courseX = [];
    for (let p = 20; p <= 380; p += 13) {
      const { lat, lon } = pixelToLatLon(rg, p, p, TS);
      courseX.push({ lat, lon, slope_pct: 5, distance_m: p });
    }
    const geoX = { range: rg, stitched, centerLat: 35.40, centerLon: 138.72, tileSize: TS };
    const r = createCourseRibbon(mockThree(), courseX, geoX, { drapeOffset: OFFSET });
    const pos = r.mesh.geometry.attributes.position.array;

    let minY = Infinity, maxY = -Infinity;
    for (let k = 1; k < pos.length; k += 3) {
      minY = Math.min(minY, pos[k]);
      maxY = Math.max(maxY, pos[k]);
    }
    // 全頂点が地形メッシュ平面 (H) 以上 = 埋まらない。
    expect(minY).toBeGreaterThanOrEqual(H);
    // かつ H + offset 付近 = 浮かない (= 間引き面そのものに乗る)。
    expect(maxY).toBeLessThanOrEqual(H + OFFSET + 0.01);
  });

  it('step 1 のフラット grid では従来どおり drape する (= 回帰なし)', () => {
    // 落ちたら: 間引きの無い小グリッドで Y 補正が従来の drape を壊している。
    // course / geo は本ファイル冒頭の 16×16 フラット fixture (全標高 1400、 step 1)。
    const r = createCourseRibbon(mockThree(), course, geo);
    const pos = r.mesh.geometry.attributes.position.array;
    for (let k = 1; k < pos.length; k += 3) {
      // 全点 DEM 1400 + 既定 drapeOffset 15。
      expect(pos[k]).toBeCloseTo(1415, 3);
    }
  });
});
