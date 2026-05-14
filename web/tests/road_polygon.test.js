import { describe, it, expect } from 'vitest';
import {
  offsetSegment,
  buildRoadPolygons,
  buildGradeColoredRoadPolygons,
} from '../lib/road_polygon.js';

// brief 25: course 各点列を「一定幅の道路 polygon」として描画するための buffer 化.
// MapLibre `line` (pixel 単位幅) ではなく `fill` / `fill-extrusion` で meter 単位幅
// の路面を出すための substrate. buildGradeColoredRoadPolygons は brief 24 の
// classifyGrade を再利用して grade 色分け済 polygon を出す.

// 富士山緯度近辺 (= 35.4°) 1 度経度 ≈ 90730 m, 1 度緯度 ≈ 111320 m.
// 5 m 道路幅 → halfW = 2.5 m
//   → perpLon ≈ 2.5 / 90730 ≈ 2.756e-5 deg
//   → perpLat ≈ 2.5 / 111320 ≈ 2.246e-5 deg

const FUJI_LAT = 35.4;
const FUJI_LON = 138.7;

describe('offsetSegment — 北向き線分 (A=(0,0), B=(0,0.001))', () => {
  // 北向き = lat 増加方向. 直交 offset は lon 軸 (= 東西).
  const a = { lat: 0, lon: 0 };
  const b = { lat: 0.001, lon: 0 };

  it('左右 offset が東西方向 (= lon 軸) になる', () => {
    const ring = offsetSegment(a, b, 5);
    // aLeft, bLeft は同じ lon 符号、 aRight, bRight は逆符号.
    const aLeft = ring[0];
    const bLeft = ring[1];
    const bRight = ring[2];
    const aRight = ring[3];

    // 進行方向に lat 差は無く、 lon 方向に offset が出る.
    expect(Math.abs(aLeft[0])).toBeGreaterThan(0);
    expect(Math.abs(aRight[0])).toBeGreaterThan(0);
    expect(Math.sign(aLeft[0])).toBe(-Math.sign(aRight[0]));
    expect(Math.sign(bLeft[0])).toBe(-Math.sign(bRight[0]));

    // lat 方向には offset が（ほぼ）出ない. 進行方向と offset 方向が直交するため.
    expect(Math.abs(aLeft[1] - a.lat)).toBeLessThan(1e-9);
    expect(Math.abs(bLeft[1] - b.lat)).toBeLessThan(1e-9);
  });
});

describe('offsetSegment — 東向き線分', () => {
  // 東向き = lon 増加方向. 直交 offset は lat 軸 (= 南北).
  const a = { lat: 0, lon: 0 };
  const b = { lat: 0, lon: 0.001 };

  it('左右 offset が南北方向 (= lat 軸) になる', () => {
    const ring = offsetSegment(a, b, 5);
    const aLeft = ring[0];
    const aRight = ring[3];

    // lat 方向に offset が出る.
    expect(Math.abs(aLeft[1])).toBeGreaterThan(0);
    expect(Math.sign(aLeft[1])).toBe(-Math.sign(aRight[1]));

    // lon 方向には offset が（ほぼ）出ない.
    expect(Math.abs(aLeft[0] - a.lon)).toBeLessThan(1e-9);
    expect(Math.abs(aRight[0] - a.lon)).toBeLessThan(1e-9);
  });
});

describe('offsetSegment — widthM スケール', () => {
  const a = { lat: FUJI_LAT, lon: FUJI_LON };
  const b = { lat: FUJI_LAT + 0.001, lon: FUJI_LON };

  it('widthM=10 のとき offset の絶対値 ≈ 5 m 相当の degree', () => {
    const ring = offsetSegment(a, b, 10);
    // 北向き線分なので offset は lon 方向. halfW = 5 m.
    // 1 度経度 ≈ 111320 * cos(35.4°) ≈ 90730 m → 5 m ≈ 5.51e-5 度.
    const aLeft = ring[0];
    const offsetLon = Math.abs(aLeft[0] - a.lon);
    expect(offsetLon).toBeGreaterThan(4e-5);
    expect(offsetLon).toBeLessThan(7e-5);
  });

  it('widthM が大きいほど offset も大きい (= 比例)', () => {
    const r5 = offsetSegment(a, b, 5);
    const r20 = offsetSegment(a, b, 20);
    const off5 = Math.abs(r5[0][0] - a.lon);
    const off20 = Math.abs(r20[0][0] - a.lon);
    // 20/5 = 4 倍.
    expect(off20 / off5).toBeCloseTo(4, 5);
  });
});

describe('offsetSegment — ring の形状', () => {
  it('4 頂点 + 閉じる頂点 = length 5、 末尾 == 先頭', () => {
    const ring = offsetSegment(
      { lat: FUJI_LAT, lon: FUJI_LON },
      { lat: FUJI_LAT + 0.001, lon: FUJI_LON + 0.001 },
      5
    );
    expect(ring).toHaveLength(5);
    expect(ring[4]).toEqual(ring[0]);
  });

  it('退化 segment (= A == B) でも length 5 で落ちない', () => {
    const p = { lat: FUJI_LAT, lon: FUJI_LON };
    const ring = offsetSegment(p, p, 5);
    expect(ring).toHaveLength(5);
    // 全頂点が同一点に縮退.
    for (const v of ring) {
      expect(v).toEqual([FUJI_LON, FUJI_LAT]);
    }
  });
});

describe('buildRoadPolygons — happy path (富士ヒル風 mini course)', () => {
  const miniCourse = [
    { lat: 35.40, lon: 138.70, slope_pct: 0.5, distance_m: 0 },
    { lat: 35.41, lon: 138.71, slope_pct: 2.5, distance_m: 100 },
    { lat: 35.42, lon: 138.72, slope_pct: 5.5, distance_m: 200 },
    { lat: 35.43, lon: 138.73, slope_pct: 8.0, distance_m: 300 },
    { lat: 35.44, lon: 138.74, slope_pct: 12.0, distance_m: 400 },
  ];

  it('segment 数 = course.length - 1', () => {
    const fc = buildRoadPolygons(miniCourse);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(miniCourse.length - 1);
  });

  it('各 feature.geometry.type は Polygon で coordinates[0].length = 5', () => {
    const fc = buildRoadPolygons(miniCourse);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('Polygon');
      expect(Array.isArray(f.geometry.coordinates)).toBe(true);
      expect(f.geometry.coordinates).toHaveLength(1); // 1 outer ring.
      expect(f.geometry.coordinates[0]).toHaveLength(5);
    }
  });

  it('properties に slope_pct / distance_m_start / distance_m_end が入る', () => {
    const fc = buildRoadPolygons(miniCourse);
    expect(fc.features[0].properties.slope_pct).toBe(2.5); // 次区間 = course[1].slope_pct.
    expect(fc.features[0].properties.distance_m_start).toBe(0);
    expect(fc.features[0].properties.distance_m_end).toBe(100);
    expect(fc.features[3].properties.distance_m_start).toBe(300);
    expect(fc.features[3].properties.distance_m_end).toBe(400);
  });

  it('widthM が反映される (= 大きい widthM ほど offset 大、 polygon が広い)', () => {
    const narrow = buildRoadPolygons(miniCourse, 2);
    const wide = buildRoadPolygons(miniCourse, 20);
    // 同 segment の 1 頂点 (aLeft) を比較. center (= course[0]) からの距離.
    const c0 = miniCourse[0];
    const nv = narrow.features[0].geometry.coordinates[0][0];
    const wv = wide.features[0].geometry.coordinates[0][0];
    const dn = Math.hypot(nv[0] - c0.lon, nv[1] - c0.lat);
    const dw = Math.hypot(wv[0] - c0.lon, wv[1] - c0.lat);
    expect(dw).toBeGreaterThan(dn * 5); // 20/2 = 10 倍 オーダー.
  });

  it('course が空 / 1 点 → 空 FeatureCollection', () => {
    expect(buildRoadPolygons([]).features).toHaveLength(0);
    expect(buildRoadPolygons([{ lat: FUJI_LAT, lon: FUJI_LON }]).features).toHaveLength(0);
  });
});

describe('buildGradeColoredRoadPolygons', () => {
  const miniCourse = [
    { lat: 35.40, lon: 138.70, slope_pct: 0.5, distance_m: 0 },
    { lat: 35.41, lon: 138.71, slope_pct: 2.5, distance_m: 100 },
    { lat: 35.42, lon: 138.72, slope_pct: 5.5, distance_m: 200 },
    { lat: 35.43, lon: 138.73, slope_pct: 8.0, distance_m: 300 },
    { lat: 35.44, lon: 138.74, slope_pct: 12.0, distance_m: 400 },
  ];

  it('各 feature.properties に grade / color が含まれる', () => {
    const fc = buildGradeColoredRoadPolygons(miniCourse);
    expect(fc.features).toHaveLength(4);
    for (const f of fc.features) {
      expect(f.properties).toHaveProperty('grade');
      expect(f.properties).toHaveProperty('color');
      expect(typeof f.properties.color).toBe('string');
      expect(f.properties.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    // segment 0: slope = course[1].slope_pct = 2.5 → gentle / #a3c853.
    expect(fc.features[0].properties.grade).toBe('gentle');
    expect(fc.features[0].properties.color).toBe('#a3c853');
    // segment 3: slope = course[4].slope_pct = 12.0 → very_hard / #e74c3c.
    expect(fc.features[3].properties.grade).toBe('very_hard');
    expect(fc.features[3].properties.color).toBe('#e74c3c');
  });

  it('slope_pct null 安全 (= 欠落しても flat default 緑、 落ちない)', () => {
    const bad = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.41, lon: 138.71 },
    ];
    const fc = buildGradeColoredRoadPolygons(bad);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.grade).toBe('flat');
    expect(fc.features[0].properties.color).toBe('#3aa055');
  });

  it('geometry.type は依然 Polygon、 widthM 引数も透過する', () => {
    const fc = buildGradeColoredRoadPolygons(miniCourse, 10);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('Polygon');
      expect(f.geometry.coordinates[0]).toHaveLength(5);
    }
  });
});
