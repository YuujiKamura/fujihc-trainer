// b12 Phase3 部品3 course_ribbon3d のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
// Three.js の描画 (リボンの見た目) は実画面目視 (Phase4) に委ね、 ここでは
//   - ribbonVertexColors: slope_pct → 頂点色 RGB の変換 (純関数)
//   - createCourseRibbon: BufferGeometry の構成 / attribute 長 / material (mock THREE)
// を検証する。

import { describe, it, expect } from 'vitest';
import { ribbonVertexColors, createCourseRibbon } from '../lib/map3d/course_ribbon3d.js';
import { classifyGrade } from '../lib/route_styling.js';
import { meshGridStep } from '../lib/map3d/terrain_surface.js';
import { buildTerrainGeometry } from '../lib/terrain3d.js';
import { tileXToLon, tileYToLat } from '../lib/tile_math.js';

// terrain3d.test.js と同じ最小 fixture (= buildCourseRibbon が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40, centerLon = 138.72;
const geo = { range, stitched, centerLat, centerLon, tileSize: TS };
// 勾配が点ごとに違うコース (= 全点同色にならない、 色の対応を実際に走らせる)。
const course = [
  { lat: 35.395, lon: 138.715, slope_pct: 0 },
  { lat: 35.405, lon: 138.720, slope_pct: 7 },
  { lat: 35.420, lon: 138.720, slope_pct: 15 },
];

// '#rrggbb' → 0..1 RGB。 期待色の照合用 (= ribbonVertexColors と同じ変換)。
function hexToRgb01(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

// ribbonVertexColors の出力 (Float32Array) から course 点 i の頂点色 (左頂点) を取り出す。
function pointColor(colors, i) {
  const vi = i * 2 * 3;
  return [colors[vi], colors[vi + 1], colors[vi + 2]];
}

// createCourseRibbon が使う Three.js API だけを持つ最小 mock。
// 実 Three.js の描画挙動は pin しない (= Phase4 の実画面目視)。 ここでは
// 「BufferGeometry に position/color/index、 頂点色 material、 dispose」 を pin する。
function mockThree() {
  return {
    DoubleSide: 'DoubleSide',
    BufferGeometry: class {
      constructor() { this.attributes = {}; this.index = null; this.disposed = false; }
      setAttribute(name, attr) { this.attributes[name] = attr; }
      setIndex(attr) { this.index = attr; }
      dispose() { this.disposed = true; }
    },
    Float32BufferAttribute: class {
      constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    },
    BufferAttribute: class {
      constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
    },
    MeshBasicMaterial: class {
      constructor(o) {
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

describe('ribbonVertexColors', () => {
  it('長さ = course.length*2*3 (= 左右 2 頂点 / 点の RGB 配列形を pin)', () => {
    expect(ribbonVertexColors(course).length).toBe(course.length * 2 * 3);
  });

  it('左右頂点 (2i, 2i+1) が同色 (= 道路の片側だけ色が違うバグを検出)', () => {
    const c = ribbonVertexColors(course);
    for (let i = 0; i < course.length; i++) {
      const left = i * 2 * 3;
      const right = (i * 2 + 1) * 3;
      expect([c[left], c[left + 1], c[left + 2]])
        .toEqual([c[right], c[right + 1], c[right + 2]]);
    }
  });

  it('各点の色が classifyGrade(slope_pct).color と一致 (= 勾配ビン配色の取り違えを検出)', () => {
    const c = ribbonVertexColors(course);
    for (let i = 0; i < course.length; i++) {
      const want = hexToRgb01(classifyGrade(course[i].slope_pct).color);
      const vi = i * 2 * 3;
      expect(c[vi]).toBeCloseTo(want[0], 6);
      expect(c[vi + 1]).toBeCloseTo(want[1], 6);
      expect(c[vi + 2]).toBeCloseTo(want[2], 6);
    }
  });

  it('勾配が違えば色も違う (= 全頂点が同色になり勾配が読めないバグを検出)', () => {
    const c = ribbonVertexColors(course);
    // slope 0 (course[0]) と slope 15 (course[2]) は別色のはず。
    const flat = [c[0], c[1], c[2]];
    const steep = [c[(2 * 2) * 3], c[(2 * 2) * 3 + 1], c[(2 * 2) * 3 + 2]];
    expect(flat).not.toEqual(steep);
  });

  it('slope_pct 欠損点は flat (緑) 色 (= NaN が色計算に漏れるのを防ぐ)', () => {
    const c = ribbonVertexColors([
      { lat: 35.4, lon: 138.7 },              // slope_pct なし
      { lat: 35.41, lon: 138.71, slope_pct: 5 },
    ]);
    const want = hexToRgb01(classifyGrade(undefined).color);  // = flat 緑
    expect(c[0]).toBeCloseTo(want[0], 6);
    expect(c[1]).toBeCloseTo(want[1], 6);
    expect(c[2]).toBeCloseTo(want[2], 6);
  });

  it('全成分が 0..1 (= 0..255 のまま渡してリボンが白飛びするのを検出)', () => {
    const c = ribbonVertexColors(course);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('2 点未満は RangeError (= リボンを張れない退化入力を弾く)', () => {
    expect(() => ribbonVertexColors([{ slope_pct: 5 }])).toThrow(RangeError);
    expect(() => ribbonVertexColors([])).toThrow(RangeError);
  });

  // --- 離散ビン (タイル状) 配色の本質を pin する。 配色を連続グラデーション
  //     (gradeColorContinuous) へ戻すと下記が落ちる ── それが回帰検出の役目。 ---

  it('同一 bin 内の点は同色 (= 区間ごとフラット色、 離散ビンの「同一区間 1 色」を pin)', () => {
    // 4.5% も 6.5% も classifyGrade の moderate bin (4-7%)。 連続グラデーションなら
    // 別色になる ── このテストが落ちたら配色が連続補間に戻っている。
    const c = ribbonVertexColors([
      { lat: 35.40, lon: 138.71, slope_pct: 4.5 },
      { lat: 35.41, lon: 138.72, slope_pct: 6.5 },
    ]);
    expect(pointColor(c, 0)).toEqual(pointColor(c, 1));
  });

  it('bin 境界をまたぐと色が段に切り替わる (= タイル状配色、 隣接ビンは別色)', () => {
    // 3.9% は gentle (1-4%)、 4.1% は moderate (4-7%) ── 隣接ビンなので別色。
    const c = ribbonVertexColors([
      { lat: 35.40, lon: 138.71, slope_pct: 3.9 },
      { lat: 35.41, lon: 138.72, slope_pct: 4.1 },
    ]);
    expect(pointColor(c, 0)).not.toEqual(pointColor(c, 1));
  });

  it('GRADE_THRESHOLDS の境界値 1/4/7/10/15% で色が変わる (min inclusive / max exclusive)', () => {
    // 各境界値の直前は下のビン、 境界値そのものは上のビン (min inclusive)。
    // 例: 3.999% は gentle、 4.0% は moderate ── 境界で別色になる。
    for (const b of [1, 4, 7, 10, 15]) {
      const c = ribbonVertexColors([
        { lat: 35.40, lon: 138.71, slope_pct: b - 0.001 },  // 境界直前 = 下のビン
        { lat: 35.41, lon: 138.72, slope_pct: b },          // 境界値 = 上のビン
      ]);
      expect(pointColor(c, 0)).not.toEqual(pointColor(c, 1));
    }
  });
});

describe('createCourseRibbon', () => {
  it('mesh は BufferGeometry + MeshBasicMaterial で構成される', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry).toBeDefined();
    expect(r.mesh.material).toBeDefined();
  });

  it('position / color attribute 長 = n*2*3 (= リボン頂点数の取り違えを検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry.attributes.position.array.length).toBe(course.length * 2 * 3);
    expect(r.mesh.geometry.attributes.color.array.length).toBe(course.length * 2 * 3);
  });

  it('index attribute 長 = (n-1)*6 (= 区間あたり 2 三角形の数え違いを検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.geometry.index.array.length).toBe((course.length - 1) * 6);
  });

  it('material は頂点色 ON + DoubleSide (= 色が出ない / 裏面が抜けるバグを検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(r.mesh.material.vertexColors).toBe(true);
    expect(r.mesh.material.side).toBe('DoubleSide');
  });

  it('color attribute の中身が ribbonVertexColors と一致 (= 色の詰め違いを検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    expect(Array.from(r.mesh.geometry.attributes.color.array))
      .toEqual(Array.from(ribbonVertexColors(course)));
  });

  it('dispose で geometry と material を解放 (= course 再読込時の GPU leak を検出)', () => {
    const r = createCourseRibbon(mockThree(), course, geo);
    const { geometry, material } = r.mesh;
    r.dispose();
    expect(geometry.disposed).toBe(true);
    expect(material.disposed).toBe(true);
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
