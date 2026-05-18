// b12 Phase3 部品6 markers3d のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
// Three.js の描画 (球の見た目) は実画面目視 (Phase4) に委ね、 ここでは
//   - courseEndpoints: コース両端の 3D 座標抽出 (純関数)
//   - createMarkers3d: group 構成 / 色 / 位置 / 可視制御 / dispose (mock THREE で構造を pin)
// を検証する。

import { describe, it, expect } from 'vitest';
import {
  courseEndpoints, createMarkers3d,
  START_MARKER_COLOR, GOAL_MARKER_COLOR,
} from '../lib/map3d/markers3d.js';

// terrain3d.test.js と同じ最小 fixture (= buildCoursePath が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40, centerLon = 138.72;
const geo = { range, stitched, centerLat, centerLon, tileSize: TS };
const M = 111320;
const course = [
  { lat: 35.395, lon: 138.715 },
  { lat: 35.402, lon: 138.725 },
  { lat: 35.410, lon: 138.735 },
];

// createMarkers3d が使う Three.js API だけを持つ最小 mock。
// 実 Three.js の描画挙動は pin しない (= Phase4 の実画面目視)。 ここでは
// 「group に 2 mesh / 色 / 位置 / visible 切替 / dispose」 の構造契約だけを pin する。
function mockThree() {
  return {
    Group: class {
      constructor() { this.children = []; this.visible = true; }
      add(o) { this.children.push(o); }
    },
    SphereGeometry: class {
      constructor(r) { this.radius = r; this.disposed = false; }
      dispose() { this.disposed = true; }
    },
    Mesh: class {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = {
          x: 0, y: 0, z: 0,
          set(x, y, z) { this.x = x; this.y = y; this.z = z; },
        };
      }
    },
    MeshBasicMaterial: class {
      constructor(o) { this.color = o.color; this.disposed = false; }
      dispose() { this.disposed = true; }
    },
  };
}

describe('courseEndpoints', () => {
  it('start = course 先頭点 / goal = course 末尾点 の投影座標 (= 端の取り違えを検出)', () => {
    const { start, goal } = courseEndpoints(course, geo);
    const mPerLon = M * Math.cos((centerLat * Math.PI) / 180);
    expect(start[0]).toBeCloseTo((course[0].lon - centerLon) * mPerLon, 2);
    expect(start[2]).toBeCloseTo(-(course[0].lat - centerLat) * M, 2);
    expect(goal[0]).toBeCloseTo((course[2].lon - centerLon) * mPerLon, 2);
    expect(goal[2]).toBeCloseTo(-(course[2].lat - centerLat) * M, 2);
  });

  it('Y は DEM 標高 + drapeOffset で地形に沿う (= 起点 / 終点が宙に浮くのを検出)', () => {
    // stitched 一様 1400m + buildCoursePath の default drapeOffset 25 → Y = 1425。
    const { start, goal } = courseEndpoints(course, geo);
    expect(start[1]).toBeCloseTo(1425, 3);
    expect(goal[1]).toBeCloseTo(1425, 3);
  });

  it('2 点未満は RangeError (= 起点 / 終点を区別できない退化入力を弾く)', () => {
    expect(() => courseEndpoints([{ lat: 35.4, lon: 138.7 }], geo)).toThrow(RangeError);
    expect(() => courseEndpoints([], geo)).toThrow(RangeError);
  });
});

describe('createMarkers3d', () => {
  it('group に起点 / 終点の 2 mesh が入る (= マーカー個数の取り違えを検出)', () => {
    const m = createMarkers3d(mockThree(), course, geo);
    expect(m.group.children.length).toBe(2);
  });

  it('起点 mesh は緑 / 終点 mesh は赤 (= MapLibre Marker 色との不一致を検出)', () => {
    const m = createMarkers3d(mockThree(), course, geo);
    expect(m.group.children[0].material.color).toBe(START_MARKER_COLOR);
    expect(m.group.children[1].material.color).toBe(GOAL_MARKER_COLOR);
  });

  it('各 mesh の position が courseEndpoints の座標に一致 (= 端への配置ズレを検出)', () => {
    const { start, goal } = courseEndpoints(course, geo);
    const m = createMarkers3d(mockThree(), course, geo);
    const sp = m.group.children[0].position;
    const gp = m.group.children[1].position;
    expect([sp.x, sp.y, sp.z]).toEqual(start);
    expect([gp.x, gp.y, gp.z]).toEqual(goal);
  });

  it('opts.radiusM が球 geometry の半径に渡る (= マーカーサイズ指定が無視されるのを検出)', () => {
    const m = createMarkers3d(mockThree(), course, geo, { radiusM: 123 });
    expect(m.group.children[0].geometry.radius).toBe(123);
  });

  it('setStartGoalVisible(false) で不可視 / true で可視 (= ride 中の退避制御を pin)', () => {
    const m = createMarkers3d(mockThree(), course, geo);
    m.setStartGoalVisible(false);
    expect(m.group.visible).toBe(false);
    m.setStartGoalVisible(true);
    expect(m.group.visible).toBe(true);
  });

  it('dispose で geometry と 2 material を解放 (= course 再読込時の GPU leak を検出)', () => {
    const m = createMarkers3d(mockThree(), course, geo);
    const geometry = m.group.children[0].geometry;
    const startMat = m.group.children[0].material;
    const goalMat = m.group.children[1].material;
    m.dispose();
    expect(geometry.disposed).toBe(true);
    expect(startMat.disposed).toBe(true);
    expect(goalMat.disposed).toBe(true);
  });
});
