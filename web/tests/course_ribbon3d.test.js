// b12 Phase3 部品3 course_ribbon3d のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
// Three.js の描画 (リボンの見た目) は実画面目視 (Phase4) に委ね、 ここでは
//   - ribbonVertexColors: slope_pct → 頂点色 RGB の変換 (純関数)
//   - createCourseRibbon: BufferGeometry の構成 / attribute 長 / material (mock THREE)
// を検証する。

import { describe, it, expect } from 'vitest';
import { ribbonVertexColors, createCourseRibbon } from '../lib/map3d/course_ribbon3d.js';
import { gradeColorContinuous } from '../lib/route_styling.js';

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

  it('各点の色が gradeColorContinuous(slope_pct) と一致 (= 勾配色パレットの取り違えを検出)', () => {
    const c = ribbonVertexColors(course);
    for (let i = 0; i < course.length; i++) {
      const want = hexToRgb01(gradeColorContinuous(course[i].slope_pct));
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
    const want = hexToRgb01(gradeColorContinuous(undefined));  // = flat 緑
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
