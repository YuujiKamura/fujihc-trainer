// b39 landmarks3d のユニットテスト。 既存 labels3d.test.js の mockThree() / mockDocument()
// pattern を踏襲、 入力 data が snappedLandmarks (= 7 件固有地名) に変わる点を pin する。
//
// 各 test は「落ちたら何のバグを検出するか」 を 1 行で言える形にする。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  LANDMARK_BASE_HEIGHT_M, landmarkSpriteScale, landmarkWorldPositions, createLandmarks3d,
} from '../lib/map3d/landmarks3d.js';

// labels3d.test.js と同じ最小 fixture (= sampleHeightBilinear が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40, centerLon = 138.72;
const geo = { range, stitched, centerLat, centerLon, tileSize: TS, exaggeration: 1 };

// snapLandmarksToCourse の戻り value 相当の minimal fixture。
// 富士ヒル 7 landmark を name と lon/lat だけ持つ form で 7 件。
function makeSnappedLandmarks() {
  return [
    { id: 'start',    name: '料金所',         lon: 138.71, lat: 35.395, distance_m: 0,     elevation_m: 1088, idx: 0 },
    { id: 'jukaidai', name: '樹海台駐車場',    lon: 138.72, lat: 35.40,  distance_m: 10500, elevation_m: 1700, idx: 10 },
    { id: 'san_go',   name: '三合目',         lon: 138.73, lat: 35.405, distance_m: 12800, elevation_m: 1850, idx: 12 },
    { id: 'osawa',    name: '大沢駐車場',      lon: 138.72, lat: 35.41,  distance_m: 17200, elevation_m: 2020, idx: 17 },
    { id: 'yon_go',   name: '四合目',         lon: 138.72, lat: 35.41,  distance_m: 17800, elevation_m: 2060, idx: 18 },
    { id: 'okuniwa',  name: '奥庭駐車場',      lon: 138.73, lat: 35.39,  distance_m: 21500, elevation_m: 2227, idx: 21 },
    { id: 'finish',   name: '五合目',         lon: 138.73, lat: 35.39,  distance_m: 24000, elevation_m: 2305, idx: 23 },
  ];
}

// createLandmarks3d が使う Three.js API だけを持つ最小 mock (= labels3d.test.js と完全同型)。
function mockThree() {
  return {
    Group: class {
      constructor() { this.children = []; }
      add(o) { this.children.push(o); }
    },
    CanvasTexture: class {
      constructor(canvas) { this.canvas = canvas; this.disposed = false; }
      dispose() { this.disposed = true; }
    },
    SpriteMaterial: class {
      constructor(o) {
        this.map = o.map;
        this.transparent = !!o.transparent;
        this.disposed = false;
      }
      dispose() { this.disposed = true; }
    },
    Sprite: class {
      constructor(material) {
        this.material = material;
        this.visible = true;
        this.position = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      }
    },
  };
}

// makeLandmarkCanvas は document.createElement('canvas') を使う。 vitest:node 環境で
// document を mock する (= labels3d.test.js と同型)。
function mockDocument() {
  return {
    createElement() {
      const cv = { width: 0, height: 0 };
      cv.getContext = () => ({
        font: '', textBaseline: '', textAlign: '',
        lineJoin: '', lineWidth: 0, strokeStyle: '', fillStyle: '',
        measureText: (t) => ({ width: String(t).length * 32 }),
        strokeText() {}, fillText() {},
      });
      return cv;
    },
  };
}

let savedDocument;
beforeAll(() => {
  savedDocument = globalThis.document;
  globalThis.document = mockDocument();
});
afterAll(() => {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
});

describe('landmarkSpriteScale', () => {
  it('倍率 1 + aspect 2 → [幅 8m, 高さ 4m] (= LANDMARK_BASE_HEIGHT_M=4 を pin、 segment label 2m との差別化)', () => {
    expect(landmarkSpriteScale(1, 2)).toEqual([8, 4]);
  });
  it('倍率 2 + aspect 1.5 → 高さ 8m、 幅 12m', () => {
    expect(landmarkSpriteScale(2, 1.5)).toEqual([12, 8]);
  });
});

describe('landmarkWorldPositions', () => {
  it('snappedLandmarks 7 件 → 7 [x,y,z] (= 7 件全部がワールド座標化される)', () => {
    const result = landmarkWorldPositions(makeSnappedLandmarks(), geo);
    expect(result.length).toBe(7);
    for (const xyz of result) {
      expect(xyz.length).toBe(3);
      expect(Number.isFinite(xyz[0])).toBe(true);
      expect(Number.isFinite(xyz[1])).toBe(true);
      expect(Number.isFinite(xyz[2])).toBe(true);
    }
  });
  it('centerLat / centerLon ピッタリの landmark は (0, _, 0) (= 投影原点で X / Z が 0)', () => {
    const lms = [{ id: 'c', name: 'C', lon: centerLon, lat: centerLat }];
    const result = landmarkWorldPositions(lms, geo);
    expect(result[0][0]).toBeCloseTo(0, 6);
    expect(result[0][2]).toBeCloseTo(0, 6);
  });
  it('heightOffset 既定 = LANDMARK_BASE_HEIGHT_M / 2 (= 2m、 landmark の下端が地面に接する想定)', () => {
    const lms = [{ id: 'c', name: 'C', lon: centerLon, lat: centerLat }];
    const result = landmarkWorldPositions(lms, geo);
    // y = demH * exaggeration + heightOffset = 1400 + 2 = 1402
    expect(result[0][1]).toBeCloseTo(1402, 3);
  });
});

describe('createLandmarks3d', () => {
  it('snappedLandmarks 7 件 → group.children に 7 sprite + landmarkCount=7', () => {
    const THREE = mockThree();
    const l = createLandmarks3d(THREE, { snappedLandmarks: makeSnappedLandmarks(), ...geo });
    expect(l.landmarkCount).toBe(7);
    expect(l.group.children.length).toBe(7);
  });

  it('setLabelScale(2) → 全 sprite の scale が 2 倍に反映される (= 機器設定 slider 連動)', () => {
    const THREE = mockThree();
    const l = createLandmarks3d(THREE, { snappedLandmarks: makeSnappedLandmarks(), ...geo });
    // 倍率 1 の高さ
    const h1 = l.group.children[0].scale.y;
    l.setLabelScale(2);
    const h2 = l.group.children[0].scale.y;
    expect(h2).toBeCloseTo(h1 * 2, 3);
  });

  it('dispose() で texture / material が disposed フラグ true (= GPU リソース leak 防止)', () => {
    const THREE = mockThree();
    const l = createLandmarks3d(THREE, { snappedLandmarks: makeSnappedLandmarks(), ...geo });
    const tex0 = l.group.children[0].material.map;
    const mat0 = l.group.children[0].material;
    expect(tex0.disposed).toBe(false);
    expect(mat0.disposed).toBe(false);
    l.dispose();
    expect(tex0.disposed).toBe(true);
    expect(mat0.disposed).toBe(true);
  });

  it('snappedLandmarks 空 → group.children = 0 + landmarkCount=0 (= 退化 case)', () => {
    const THREE = mockThree();
    const l = createLandmarks3d(THREE, { snappedLandmarks: [], ...geo });
    expect(l.landmarkCount).toBe(0);
    expect(l.group.children.length).toBe(0);
  });

  it('snappedLandmarks 未指定 → 空配列扱い (= opts.snappedLandmarks 不在で例外を投げない)', () => {
    const THREE = mockThree();
    const l = createLandmarks3d(THREE, { ...geo });
    expect(l.landmarkCount).toBe(0);
  });

  it('name が空の landmark は sprite を作らない (= course 起点等、 表示する地名が無い landmark)', () => {
    const THREE = mockThree();
    const lms = makeSnappedLandmarks();
    lms[0].name = '';  // start を「地名なし」にする (= course_landmarks.js の id='start')
    const l = createLandmarks3d(THREE, { snappedLandmarks: lms, ...geo });
    expect(l.landmarkCount).toBe(6);
    expect(l.group.children.length).toBe(6);
  });
});
