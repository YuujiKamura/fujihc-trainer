// brief 35: Terrain (= 地形・経路・区間の客観モデル) の unit test.
//
// 役割確認:
// - course を保有し、 distance → {lat/lon/elevation/heading/slope/segmentIdx/frac} を返す
// - course 内部は隠蔽、 必要なら getPointAtIdx / getCourse で取り出せる
// - immutable: bounds は freeze、 getCourse は shallow copy.

import { describe, it, expect } from 'vitest';
import { createTerrain } from '../lib/terrain.js';

// 富士ヒル域 (lat≒35) で 0.001 度ずつ動かす簡易 course を組む.
// 緯度 0.001° ≒ 111 m, 経度 0.001° ≒ 91 m (cos(35°)≒0.819).
function buildNorthCourse(n = 10) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.4 + i * 0.001,
      lon: 138.7,
      distance_m: i * 111,
      elevation_m: 1000 + i * 10,
      slope_pct: i === 0 ? 0 : 5 + i * 0.1,
    });
  }
  return arr;
}

function buildEastCourse(n = 6) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.4,
      lon: 138.7 + i * 0.001,
      distance_m: i * 91,
      elevation_m: 1000,
      slope_pct: 0,
    });
  }
  return arr;
}

describe('createTerrain', () => {
  it('course を渡すと length / totalDistance が読める', () => {
    const t = createTerrain({ course: buildNorthCourse(10) });
    expect(t.length).toBe(10);
    expect(t.totalDistance).toBe(9 * 111);  // 999
  });

  it('空 course でも throw しない、 length=0 / totalDistance=0', () => {
    const t = createTerrain({ course: [] });
    expect(t.length).toBe(0);
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
      const t = createTerrain({ course: buildNorthCourse(10) });
      // segment 0-1 の中間 (= distance 55.5)
      const pos = t.getPositionAtDistance(55.5);
      expect(pos.segmentIdx).toBe(0);
      expect(pos.fracInSegment).toBeCloseTo(0.5, 2);
      expect(pos.lat).toBeCloseTo(35.4 + 0.0005, 4);
      expect(pos.elevation).toBeCloseTo(1005, 2);
    });

    it('北/東/南/西 で heading degrees を返す', () => {
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
      expect(overPos.distance).toBe(t.totalDistance);
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
      const t = createTerrain({ course: buildNorthCourse(10) });
      // segment 2 の中 → slope = 5 + 2*0.1 = 5.2
      const pos = t.getPositionAtDistance(2 * 111 + 30);
      expect(pos.segmentIdx).toBe(2);
      expect(pos.slope_pct).toBeCloseTo(5.2, 5);
    });
  });

  describe('idxAtDistance / distanceAtIdx', () => {
    it('idxAtDistance: distance_m <= target を満たす最大 idx', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      expect(t.idxAtDistance(0)).toBe(0);
      expect(t.idxAtDistance(110)).toBe(0);   // 111 直前
      expect(t.idxAtDistance(111)).toBe(1);   // ちょうど segment 境界
      expect(t.idxAtDistance(250)).toBe(2);   // 222 < 250 < 333
      expect(t.idxAtDistance(99999)).toBe(9); // 末尾
    });

    it('distanceAtIdx: course[idx].distance_m を返す', () => {
      const t = createTerrain({ course: buildNorthCourse(10) });
      expect(t.distanceAtIdx(0)).toBe(0);
      expect(t.distanceAtIdx(5)).toBe(555);
      expect(t.distanceAtIdx(9)).toBe(999);
      // 範囲外 idx は clamp.
      expect(t.distanceAtIdx(-3)).toBe(0);
      expect(t.distanceAtIdx(100)).toBe(999);
    });
  });

  describe('getPointAtIdx', () => {
    it('course[idx] の参照を返す (= shallow)', () => {
      const course = buildNorthCourse(5);
      const t = createTerrain({ course });
      const p = t.getPointAtIdx(2);
      expect(p.lat).toBeCloseTo(35.402, 5);
      expect(p.distance_m).toBe(222);
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
