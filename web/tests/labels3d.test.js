// b12 Phase3 部品7 labels3d のユニットテスト.
//
// 各 test は「落ちたら何のバグを検出したことになるか」を 1 行で言える形にする。
// Three.js の描画 (看板の見た目) と canvas 文字描画は実画面目視 (Phase4) に委ね、
// ここでは
//   - labelDistanceBucket / labelWindowFlags / labelSpriteScale / labelWorldPositions
//     (純関数: bucket 量子化 / 窓判定 / sprite スケール / ワールド座標化)
//   - createLabels3d (mock THREE + mock document で group 構成 / 窓制御 / scale を pin)
// を検証する。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  labelDistanceBucket, labelWindowFlags, labelSpriteScale, labelWorldPositions,
  createLabels3d,
  LABEL_BASE_HEIGHT_M, LABEL_WINDOW_BACK_M, LABEL_WINDOW_FWD_M,
} from '../lib/map3d/labels3d.js';

// terrain3d.test.js と同じ最小 fixture (= sampleHeightBilinear が通る投影パラメータ)。
const range = { zoom: 14, xMin: 14503, yMin: 6464 };
const TS = 16;
const stitched = { grid: new Float32Array(TS * TS).fill(1400), width: TS, height: TS };
const centerLat = 35.40, centerLon = 138.72;
const geo = { range, stitched, centerLat, centerLon, tileSize: TS };

// buildSegmentLabels が通る Polygon FeatureCollection を作る。
// n セグメント、 distance_m_start = i*20m (= 20m 刻み)。
function mkPolygonFC(n) {
  const features = [];
  for (let i = 0; i < n; i++) {
    const lon = 138.705 + i * 0.0002;
    const lat = 35.395 + i * 0.0002;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [lon, lat],
          [lon + 0.0002, lat + 0.0002],
          [lon + 0.00025, lat + 0.00015],
          [lon + 0.00005, lat - 0.00005],
          [lon, lat],
        ]],
      },
      properties: { distance_m_start: i * 20, slope_pct: i % 10 },
    });
  }
  return { type: 'FeatureCollection', features };
}

// createLabels3d が使う Three.js API だけを持つ最小 mock。
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
      constructor(o) { this.map = o.map; this.disposed = false; }
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

// labels3d.js の makeLabelCanvas は document.createElement('canvas') を使う。
// vitest は environment:node で document が無いため、 最小 mock を globalThis に挿す。
function mockDocument() {
  return {
    createElement() {
      const cv = { width: 0, height: 0 };
      cv.getContext = () => ({
        font: '', textBaseline: '', textAlign: '',
        lineJoin: '', lineWidth: 0, strokeStyle: '', fillStyle: '',
        measureText: (t) => ({ width: String(t).length * 24 }),
        strokeText() {}, fillText() {},
      });
      return cv;
    },
  };
}

describe('labelDistanceBucket', () => {
  it('50m 刻みで bucket index に量子化 (= 表示窓更新の間引き単位を pin)', () => {
    expect(labelDistanceBucket(0)).toBe(0);
    expect(labelDistanceBucket(49)).toBe(0);
    expect(labelDistanceBucket(50)).toBe(1);
    expect(labelDistanceBucket(125)).toBe(2);
  });

  it('null / undefined は 0 扱い (= 初回 tick の未確定距離で NaN bucket を防ぐ)', () => {
    expect(labelDistanceBucket(undefined)).toBe(0);
    expect(labelDistanceBucket(null)).toBe(0);
  });
});

describe('labelWindowFlags', () => {
  const labels = [
    { distance_m: 0 }, { distance_m: 100 }, { distance_m: 300 },
    { distance_m: 600 }, { distance_m: 1000 },
  ];

  it('窓 [rider-back, rider+fwd] 内のラベルだけ true (= 窓判定の取り違えを検出)', () => {
    // rider=400 → 窓 [400-150, 400+450] = [250, 850]。
    expect(labelWindowFlags(labels, 400)).toEqual([false, false, true, true, false]);
  });

  it('後方より前方を広く取る (= 進行方向のラベルを長く見せる設計を pin)', () => {
    expect(LABEL_WINDOW_FWD_M).toBeGreaterThan(LABEL_WINDOW_BACK_M);
  });

  it('labels と同じ長さの配列を返す (= sprite との 1 対 1 対応を pin)', () => {
    expect(labelWindowFlags(labels, 0).length).toBe(labels.length);
  });
});

describe('labelSpriteScale', () => {
  it('高さ = baseHeight*倍率、 幅 = 高さ*aspect (= 文字の縦横比が崩れるバグを検出)', () => {
    const [w, h] = labelSpriteScale(1, 4);
    expect(h).toBe(LABEL_BASE_HEIGHT_M);
    expect(w).toBe(LABEL_BASE_HEIGHT_M * 4);
  });

  it('倍率を上げると幅も高さも比例して増える (= setLabelScale が片側だけ効くのを検出)', () => {
    const [w1, h1] = labelSpriteScale(1, 3);
    const [w2, h2] = labelSpriteScale(2, 3);
    expect(w2).toBeCloseTo(w1 * 2, 6);
    expect(h2).toBeCloseTo(h1 * 2, 6);
  });
});

describe('labelWorldPositions', () => {
  const labels = [
    { lon: 138.715, lat: 35.400, text: 'a', distance_m: 100 },
    { lon: 138.725, lat: 35.410, text: 'b', distance_m: 200 },
  ];

  it('XZ が terrain3d 投影 (東=+X / 北=-Z) で出る (= ラベルがリボンとズレるのを検出)', () => {
    const M = 111320;
    const pos = labelWorldPositions(labels, geo);
    const mPerLon = M * Math.cos((centerLat * Math.PI) / 180);
    expect(pos[0][0]).toBeCloseTo((labels[0].lon - centerLon) * mPerLon, 2);
    expect(pos[0][2]).toBeCloseTo(-(labels[0].lat - centerLat) * M, 2);
  });

  it('Y は DEM 標高 + heightOffset で地面から立つ (= 看板が地中に埋まるのを検出)', () => {
    // stitched 一様 1400m + default heightOffset (LABEL_BASE_HEIGHT_M) → Y = 1440。
    const pos = labelWorldPositions(labels, geo);
    for (const p of pos) expect(p[1]).toBeCloseTo(1400 + LABEL_BASE_HEIGHT_M, 3);
  });

  it('labels と同じ個数の座標を返す', () => {
    expect(labelWorldPositions(labels, geo).length).toBe(labels.length);
  });
});

describe('createLabels3d', () => {
  let savedDoc;
  beforeAll(() => { savedDoc = globalThis.document; globalThis.document = mockDocument(); });
  afterAll(() => { globalThis.document = savedDoc; });

  const opts = () => ({ polygonFC: mkPolygonFC(30), ...geo });

  it('group にラベル個数ぶんの sprite が入る (= ラベルを取りこぼすバグを検出)', () => {
    const l = createLabels3d(mockThree(), opts());
    expect(l.labelCount).toBeGreaterThan(0);
    expect(l.group.children.length).toBe(l.labelCount);
  });

  it('各 sprite が有限のワールド座標に置かれる (= NaN 投影で看板が消えるのを検出)', () => {
    const l = createLabels3d(mockThree(), opts());
    for (const sp of l.group.children) {
      expect(Number.isFinite(sp.position.x)).toBe(true);
      expect(Number.isFinite(sp.position.y)).toBe(true);
      expect(Number.isFinite(sp.position.z)).toBe(true);
    }
  });

  it('setLabelScale で全 sprite の scale が比例変化 (= 倍率 slider が効かないバグを検出)', () => {
    const l = createLabels3d(mockThree(), opts());
    const before = l.group.children[0].scale.y;
    l.setLabelScale(3);
    const after = l.group.children[0].scale.y;
    expect(after).toBeCloseTo(before * 3, 6);
  });

  it('updateLabelWindow は bucket 変化時だけ true (= 50m 刻みの間引きを pin)', () => {
    const l = createLabels3d(mockThree(), opts());
    expect(l.updateLabelWindow(0)).toBe(true);    // 初回 → 更新
    expect(l.updateLabelWindow(30)).toBe(false);  // bucket 0 のまま → skip
    expect(l.updateLabelWindow(60)).toBe(true);   // bucket 1 → 更新
  });

  it('updateLabelWindow が窓外ラベルを非表示にする (= 表示窓制御が効かないバグを検出)', () => {
    const l = createLabels3d(mockThree(), opts());
    // fixture の距離は 0..580m。 rider=5000m なら全ラベルが窓外。
    l.updateLabelWindow(5000);
    expect(l.group.children.every((sp) => sp.visible === false)).toBe(true);
  });

  it('dispose で全 texture / material を解放 (= course 再読込時の GPU leak を検出)', () => {
    const l = createLabels3d(mockThree(), opts());
    const textures = l.group.children.map((sp) => sp.material.map);
    const materials = l.group.children.map((sp) => sp.material);
    l.dispose();
    expect(textures.every((t) => t.disposed)).toBe(true);
    expect(materials.every((m) => m.disposed)).toBe(true);
  });
});
