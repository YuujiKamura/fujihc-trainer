// rider-position-model: Terrain (= 地形・経路・区間の客観モデル) の unit test.
//
// 役割確認:
// - course を保有し、 距離スケールを lat/lon の haversine 累積長で作る
//   (= course.json の distance_m フィールドは使わない).
// - 位置 (segmentIdx, fracInSegment) ⇄ 距離 ⇄ lat/lon を相互変換できる.
// - course 内部は隠蔽、 必要なら getPointAtIdx / getCourse で取り出せる.
// - immutable: bounds は freeze、 getCourse は shallow copy.

import { describe, it, expect } from 'vitest';
import { createTerrain, haversineMeters } from '../lib/terrain.js';
import { withCumulativeDistance, cumulativeLengths } from './_helpers/course_fixture.js';

// 富士ヒル域 (lat≒35) で 0.001 度ずつ北へ動かす簡易 course.
// distance_m は haversine 累積で埋める (= 自己整合、 1 セグメント ≒ 111.2 m).
function buildNorthCourse(n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      lat: 35.4 + i * 0.001,
      lon: 138.7,
      elevation_m: 1000 + i * 10,
      slope_pct: i === 0 ? 0 : 5 + i * 0.1,
    });
  }
  return withCumulativeDistance(pts);
}

// 東へ 0.001 度ずつ動かす course (= 1 セグメント ≒ 90.6 m at lat 35.4).
function buildEastCourse(n = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ lat: 35.4, lon: 138.7 + i * 0.001, elevation_m: 1000, slope_pct: 0 });
  }
  return withCumulativeDistance(pts);
}

describe('haversineMeters', () => {
  it('同一点は 0', () => {
    expect(haversineMeters({ lat: 35.4, lon: 138.7 }, { lat: 35.4, lon: 138.7 })).toBe(0);
  });
  it('緯度 0.001 度差は約 111.2 m', () => {
    const d = haversineMeters({ lat: 35.4, lon: 138.7 }, { lat: 35.401, lon: 138.7 });
    expect(d).toBeCloseTo(111.2, 0);
  });
  it('不正入力は 0', () => {
    expect(haversineMeters(null, { lat: 1, lon: 1 })).toBe(0);
    expect(haversineMeters({ lat: 1, lon: 1 }, undefined)).toBe(0);
  });
});

describe('createTerrain', () => {
  it('course を渡すと length / segmentCount / totalDistance が読める', () => {
    const course = buildNorthCourse(10);
    const t = createTerrain({ course });
    expect(t.length).toBe(10);
    expect(t.segmentCount).toBe(9);
    // totalDistance = haversine 累積長 (= fixture の最終 distance_m と一致).
    expect(t.totalDistance).toBeCloseTo(course[9].distance_m, 6);
    expect(t.totalDistance).toBeCloseTo(cumulativeLengths(course)[9], 6);
  });

  it('空 course でも throw しない、 length=0 / segmentCount=0 / totalDistance=0', () => {
    const t = createTerrain({ course: [] });
    expect(t.length).toBe(0);
    expect(t.segmentCount).toBe(0);
    expect(t.totalDistance).toBe(0);
  });

  it('単一点 course は segmentCount=0 / totalDistance=0', () => {
    const t = createTerrain({ course: buildNorthCourse(1) });
    expect(t.length).toBe(1);
    expect(t.segmentCount).toBe(0);
    expect(t.totalDistance).toBe(0);
  });

  it('course が array でないと TypeError', () => {
    expect(() => createTerrain({ course: null })).toThrow(TypeError);
    expect(() => createTerrain({ course: 'foo' })).toThrow(TypeError);
  });

  describe('bounds', () => {
    it('lat/lon/elevation の min/max を返す', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      expect(t.bounds.latMin).toBeCloseTo(35.4, 5);
      expect(t.bounds.latMax).toBeCloseTo(35.4 + 9 * 0.001, 5);
      expect(t.bounds.lonMin).toBeCloseTo(138.7, 5);
      expect(t.bounds.lonMax).toBeCloseTo(138.7, 5);
      expect(t.bounds.eleMin).toBe(1000);
      expect(t.bounds.eleMax).toBe(1090);
    });

    it('bounds は freeze 済 (= mutation 不可)', () => {
      const t = createTerrain({ course: buildNorthCourse(3) });
      expect(() => { t.bounds.latMin = 99; }).toThrow();
    });
  });

  describe('segmentLength', () => {
    it('セグメント i の haversine 実長を返す', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      // セグメント 0 = course[0]→course[1] の haversine.
      expect(t.segmentLength(0)).toBeCloseTo(haversineMeters(course[0], course[1]), 6);
      expect(t.segmentLength(0)).toBeCloseTo(111.2, 0);
    });
    it('範囲外 / segment 無しは 0', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      expect(t.segmentLength(-1)).toBe(0);
      expect(t.segmentLength(9)).toBe(0);   // segmentCount=9、 セグメントは 0..8
      expect(t.segmentLength(999)).toBe(0);
      expect(createTerrain({ course: [] }).segmentLength(0)).toBe(0);
    });
  });

  describe('getPositionAt', () => {
    it('(segIdx, frac=0) は course 点そのもの', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const pos = t.getPositionAt(3, 0);
      expect(pos.lat).toBeCloseTo(35.403, 5);
      expect(pos.lon).toBeCloseTo(138.7, 5);
      expect(pos.elevation).toBe(1030);
      expect(pos.segmentIdx).toBe(3);
      expect(pos.fracInSegment).toBe(0);
    });

    it('(segIdx, frac=0.5) は segment 中点で lat/elevation を線形補間', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const pos = t.getPositionAt(0, 0.5);
      expect(pos.lat).toBeCloseTo(35.4 + 0.0005, 5);
      expect(pos.elevation).toBeCloseTo(1005, 6);
    });

    it('distance は distanceAt と一致する', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const pos = t.getPositionAt(4, 0.3);
      expect(pos.distance).toBeCloseTo(t.distanceAt(4, 0.3), 9);
    });

    it('範囲外 segIdx / frac は clamp', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      expect(t.getPositionAt(-5, 0.5).segmentIdx).toBe(0);
      expect(t.getPositionAt(999, 0.5).segmentIdx).toBe(8);  // segmentCount-1
      expect(t.getPositionAt(0, 3).fracInSegment).toBe(1);
      expect(t.getPositionAt(0, -3).fracInSegment).toBe(0);
    });

    it('空 course は安全な default を返す (= throw しない)', () => {
      const pos = createTerrain({ course: [] }).getPositionAt(0, 0);
      expect(pos.lat).toBe(0);
      expect(pos.lon).toBe(0);
      expect(pos.elevation).toBe(0);
      expect(pos.heading).toBe(0);
    });

    it('単一点 course は course[0] を返す', () => {
      const t = createTerrain({ course: buildNorthCourse(1) });
      const pos = t.getPositionAt(0, 0.5);
      expect(pos.lat).toBeCloseTo(35.4, 5);
      expect(pos.elevation).toBe(1000);
      expect(pos.distance).toBe(0);
    });
  });

  describe('distanceAt', () => {
    it('累積セグメント長 + frac×セグメント長', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      expect(t.distanceAt(0, 0)).toBe(0);
      expect(t.distanceAt(3, 0)).toBeCloseTo(course[3].distance_m, 6);
      // セグメント 3 の中点 = course[3] 距離 + セグメント長/2.
      const segLen3 = haversineMeters(course[3], course[4]);
      expect(t.distanceAt(3, 0.5)).toBeCloseTo(course[3].distance_m + segLen3 / 2, 6);
    });
    it('segment 無しは 0', () => {
      expect(createTerrain({ course: [] }).distanceAt(0, 0.5)).toBe(0);
    });
  });

  describe('locate', () => {
    it('distance → (segmentIdx, fracInSegment)', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      expect(t.locate(0)).toEqual({ segmentIdx: 0, fracInSegment: 0 });
      // セグメント 2 の中点距離 → segmentIdx 2, frac 0.5.
      const segLen2 = haversineMeters(course[2], course[3]);
      const mid2 = course[2].distance_m + segLen2 / 2;
      const loc = t.locate(mid2);
      expect(loc.segmentIdx).toBe(2);
      expect(loc.fracInSegment).toBeCloseTo(0.5, 6);
    });

    it('locate ⇄ distanceAt は round-trip する', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const d = 412.5;
      const loc = t.locate(d);
      expect(t.distanceAt(loc.segmentIdx, loc.fracInSegment)).toBeCloseTo(d, 6);
    });

    it('範囲外 distance は 0..totalDistance に clamp', () => {
      const t = createTerrain({ course: buildNorthCourse(5) });
      expect(t.locate(-100)).toEqual({ segmentIdx: 0, fracInSegment: 0 });
      const over = t.locate(99999);
      expect(over.segmentIdx).toBe(3);   // segmentCount-1
      expect(over.fracInSegment).toBe(1);
    });

    it('segment 無し course は (0,0)', () => {
      expect(createTerrain({ course: [] }).locate(50)).toEqual({ segmentIdx: 0, fracInSegment: 0 });
    });
  });

  describe('getPositionAtDistance', () => {
    it('distance=0 で course[0] と同位置', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const pos = t.getPositionAtDistance(0);
      expect(pos.lat).toBeCloseTo(35.4, 5);
      expect(pos.lon).toBeCloseTo(138.7, 5);
      expect(pos.elevation).toBe(1000);
      expect(pos.segmentIdx).toBe(0);
      expect(pos.fracInSegment).toBe(0);
    });

    it('distance=totalDistance で course 末尾と同位置', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      const pos = t.getPositionAtDistance(t.totalDistance);
      expect(pos.lat).toBeCloseTo(35.4 + 9 * 0.001, 5);
      expect(pos.elevation).toBe(1090);
    });

    it('segment 中間で lat/lon/elevation が線形補間される', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      // セグメント 0 の中点距離 (= course[1] の半分).
      const pos = t.getPositionAtDistance(course[1].distance_m / 2);
      expect(pos.segmentIdx).toBe(0);
      expect(pos.fracInSegment).toBeCloseTo(0.5, 6);
      expect(pos.lat).toBeCloseTo(35.4 + 0.0005, 5);
      expect(pos.elevation).toBeCloseTo(1005, 6);
    });

    it('北/東 で heading degrees を返す', () => {
      const n = createTerrain({ course: buildNorthCourse(10) });
      const e = createTerrain({ course: buildEastCourse(6) });
      expect(n.getPositionAtDistance(0).heading).toBeCloseTo(0, 1);
      expect(e.getPositionAtDistance(0).heading).toBeCloseTo(90, 1);
    });

    it('clamp: 範囲外の distance は 0..totalDistance に丸める', () => {
      const t = createTerrain({ course: buildNorthCourse(5) });
      const negPos = t.getPositionAtDistance(-100);
      expect(negPos.distance).toBe(0);
      const overPos = t.getPositionAtDistance(99999);
      expect(overPos.distance).toBeCloseTo(t.totalDistance, 6);
    });

    it('空 course は安全な default を返す (= throw しない)', () => {
      const t = createTerrain({ course: [] });
      const pos = t.getPositionAtDistance(0);
      expect(pos.lat).toBe(0);
      expect(pos.lon).toBe(0);
      expect(pos.elevation).toBe(0);
      expect(pos.heading).toBe(0);
    });

    it('slope_pct は当該 segment の course[segmentIdx].slope_pct を返す', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      // セグメント 2 の中 → slope = course[2].slope_pct = 5 + 2*0.1 = 5.2.
      const pos = t.getPositionAtDistance(course[2].distance_m + 30);
      expect(pos.segmentIdx).toBe(2);
      expect(pos.slope_pct).toBeCloseTo(5.2, 5);
    });
  });

  describe('idxAtDistance / distanceAtIdx', () => {
    it('idxAtDistance: 累積距離 <= target を満たす最大の点 idx', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      expect(t.idxAtDistance(0)).toBe(0);
      expect(t.idxAtDistance(course[1].distance_m - 1)).toBe(0);  // 点 1 直前
      expect(t.idxAtDistance(course[1].distance_m)).toBe(1);      // ちょうど点 1
      expect(t.idxAtDistance(250)).toBe(2);   // 点2(≒222) < 250 < 点3(≒334)
      expect(t.idxAtDistance(99999)).toBe(9); // 末尾点
    });

    it('distanceAtIdx: course 点 idx の累積 haversine 距離を返す', () => {
      const course = buildNorthCourse(10);
      const t = createTerrain({ course });
      expect(t.distanceAtIdx(0)).toBe(0);
      expect(t.distanceAtIdx(5)).toBeCloseTo(course[5].distance_m, 6);
      expect(t.distanceAtIdx(9)).toBeCloseTo(course[9].distance_m, 6);
      // 範囲外 idx は clamp.
      expect(t.distanceAtIdx(-3)).toBe(0);
      expect(t.distanceAtIdx(100)).toBeCloseTo(course[9].distance_m, 6);
    });
  });

  describe('getPointAtIdx', () => {
    it('course[idx] の参照を返す (= shallow)', () => {
      const course = buildNorthCourse(5);
      const t = createTerrain({ course });
      const p = t.getPointAtIdx(2);
      expect(p).toBe(course[2]);
      expect(p.lat).toBeCloseTo(35.402, 5);
    });
    it('空 course は null を返す', () => {
      const t = createTerrain({ course: [] });
      expect(t.getPointAtIdx(0)).toBeNull();
    });
  });

  describe('getCourse', () => {
    it('shallow copy を返す (= 外側 push が内部に影響しない)', () => {
      const course = buildNorthCourse(3);
      const t = createTerrain({ course });
      const a = t.getCourse();
      a.push({ marker: 'tampered' });
      const b = t.getCourse();
      expect(b.length).toBe(3);
    });
  });

  describe('getSections', () => {
    it('default n=10 で 10 区間に分割', () => {
      const t = createTerrain({ course: buildNorthCourse(100) });
      const sections = t.getSections();
      expect(sections.length).toBe(10);
      expect(sections[0].start_idx).toBe(0);
      expect(sections[9].end_idx).toBe(99);
    });
    it('n 指定で任意区間数', () => {
      const t = createTerrain({ course: buildNorthCourse(100) });
      const sections = t.getSections(5);
      expect(sections.length).toBe(5);
    });
  });
});
