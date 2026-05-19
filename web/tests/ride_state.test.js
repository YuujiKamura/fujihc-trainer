import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { withCumulativeDistance } from './_helpers/course_fixture.js';

// rider-position-model: ride_state は Terrain + Rider 2 層モデルの後方互換 shim.
// fixture は haversine 自己整合 (= distance_m を haversine 累積で埋める). 1 セグメント:
// 北向き 0.001° ≒ 111.2 m、 東西 ≒ 90.6 m at lat 35.4.

function buildNorthCourse(n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      lat: 35.4 + i * 0.001, lon: 138.7,
      elevation_m: 1000 + i * 10, slope_pct: i === 0 ? 0 : 5 + i * 0.1,
    });
  }
  return withCumulativeDistance(pts);
}

function buildEastCourse(n = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ lat: 35.4, lon: 138.7 + i * 0.001, elevation_m: 1000, slope_pct: 0 });
  }
  return withCumulativeDistance(pts);
}

function buildSouthCourse(n = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ lat: 35.4 - i * 0.001, lon: 138.7, elevation_m: 1000, slope_pct: 0 });
  }
  return withCumulativeDistance(pts);
}

function buildWestCourse(n = 6) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ lat: 35.4, lon: 138.7 - i * 0.001, elevation_m: 1000, slope_pct: 0 });
  }
  return withCumulativeDistance(pts);
}

describe('createRideState', () => {
  describe('advance', () => {
    it('happy: dt=1.0 s, speed=20km/h (=5.555 m/s) で curDist が ≒5.5 m 増える', () => {
      const ride = createRideState(buildNorthCourse());
      ride.start();
      const speedMps = 20 / 3.6; // ≒ 5.555
      ride.advance(1.0, speedMps);
      const snap = ride.snapshot();
      expect(snap.distance).toBeCloseTo(5.555, 2);
      // 5.5 m < 111 m なので idx はまだ 0
      expect(snap.idx).toBe(0);
    });

    it('paused なら curDist 不変 (= start を呼んでない初期状態は paused)', () => {
      const ride = createRideState(buildNorthCourse());
      // 初期 paused=true
      ride.advance(1.0, 20 / 3.6);
      expect(ride.snapshot().distance).toBe(0);
      // start → 走る → togglePause で paused にして advance しても増えない
      ride.start();
      ride.togglePause(); // active かつ paused=true
      ride.advance(1.0, 20 / 3.6);
      expect(ride.snapshot().distance).toBe(0);
      expect(ride.snapshot().paused).toBe(true);
    });

    it('末尾到達で curDist は totalDist に clamp、 isAtEnd() = true', () => {
      const ride = createRideState(buildNorthCourse(5)); // segmentCount=4
      ride.start();
      // 1000 m / 1 s で一気に超過させる
      ride.advance(1.0, 1000);
      const snap = ride.snapshot();
      expect(snap.distance).toBeCloseTo(ride._terrain.totalDistance, 6);
      // 末端到達時の segmentIdx = segmentCount-1 = course.length-2.
      expect(snap.idx).toBe(5 - 2);
      expect(ride.isAtEnd()).toBe(true);
      // 末尾到達後の advance は no-op
      ride.advance(1.0, 100);
      expect(ride.snapshot().distance).toBeCloseTo(ride._terrain.totalDistance, 6);
    });

    it('複数 tick で curIdx が curDist に追従して前進', () => {
      const ride = createRideState(buildNorthCourse(10));
      ride.start();
      // 250 m まで進める (= idx が 2 に進むはず: 点2≒222 < 250 < 点3≒334)
      ride.advance(1.0, 250);
      const snap = ride.snapshot();
      expect(snap.distance).toBeCloseTo(250, 6);
      expect(snap.idx).toBe(2);
    });
  });

  describe('getCurrentSlope', () => {
    it('現在セグメントの slope_pct を返す', () => {
      const ride = createRideState(buildNorthCourse(10));
      ride.start();
      // idx=0 → slope_pct=0
      expect(ride.getCurrentSlope()).toBe(0);
      // 250 m まで進めて idx=2 (= slope_pct = 5 + 2*0.1 = 5.2)
      ride.advance(1.0, 250);
      expect(ride.getCurrentSlope()).toBeCloseTo(5.2, 5);
    });
  });

  describe('getHeading', () => {
    it('北/東/南/西 の 4 方向で正しい heading を返す (= computeTravelHeading 委譲)', () => {
      const n = createRideState(buildNorthCourse());
      const e = createRideState(buildEastCourse());
      const s = createRideState(buildSouthCourse());
      const w = createRideState(buildWestCourse());
      expect(n.getHeading(5)).toBeCloseTo(0, 1);
      expect(e.getHeading(5)).toBeCloseTo(90, 1);
      expect(s.getHeading(5)).toBeCloseTo(180, 1);
      expect(w.getHeading(5)).toBeCloseTo(270, 1);
    });
  });

  describe('start / end / togglePause / reset', () => {
    it('start で active=true, paused=false, リセット位置', () => {
      const ride = createRideState(buildNorthCourse());
      // 一度進めてから start で位置が 0 に戻ること
      ride.start();
      ride.advance(1.0, 100);
      expect(ride.snapshot().distance).toBeGreaterThan(0);
      ride.start();
      const snap = ride.snapshot();
      expect(snap.distance).toBe(0);
      expect(snap.idx).toBe(0);
      expect(snap.paused).toBe(false);
      expect(snap.active).toBe(true);
    });

    it('end で paused=true, active=false (位置は保持)', () => {
      const ride = createRideState(buildNorthCourse());
      ride.start();
      ride.advance(1.0, 100);
      const distBeforeEnd = ride.snapshot().distance;
      ride.end();
      const snap = ride.snapshot();
      expect(snap.paused).toBe(true);
      expect(snap.active).toBe(false);
      expect(snap.distance).toBe(distBeforeEnd); // 位置は保持
    });

    it('togglePause で paused が反転', () => {
      const ride = createRideState(buildNorthCourse());
      ride.start(); // paused=false
      expect(ride.snapshot().paused).toBe(false);
      ride.togglePause();
      expect(ride.snapshot().paused).toBe(true);
      ride.togglePause();
      expect(ride.snapshot().paused).toBe(false);
    });

    it('reset で curIdx=0, curDist=0 (paused / active は変えない)', () => {
      const ride = createRideState(buildNorthCourse());
      ride.start();
      ride.advance(1.0, 300);
      expect(ride.snapshot().idx).toBeGreaterThan(0);
      ride.reset();
      const snap = ride.snapshot();
      expect(snap.idx).toBe(0);
      expect(snap.distance).toBe(0);
      // paused / active は reset で変えない
      expect(snap.paused).toBe(false);
      expect(snap.active).toBe(true);
    });

    it('startFrom で指定 course 点から active 開始', () => {
      const course = buildNorthCourse(10);
      const ride = createRideState(course);
      ride.startFrom(4);
      const snap = ride.snapshot();
      expect(snap.idx).toBe(4);
      expect(snap.distance).toBeCloseTo(course[4].distance_m, 6);
      expect(snap.active).toBe(true);
    });
  });

  describe('snapshot', () => {
    it('immutable copy が返る (= 外側 mutation が内部 state に影響しない)', () => {
      const ride = createRideState(buildNorthCourse());
      ride.start();
      const s1 = ride.snapshot();
      s1.distance = 99999;
      s1.idx = 42;
      s1.paused = true;
      const s2 = ride.snapshot();
      expect(s2.distance).toBe(0);
      expect(s2.idx).toBe(0);
      expect(s2.paused).toBe(false);
    });
  });

  describe('isAtEnd', () => {
    it('初期は false、 末尾到達後 true', () => {
      const ride = createRideState(buildNorthCourse(3));
      expect(ride.isAtEnd()).toBe(false);
      ride.start();
      ride.advance(1.0, 1000);
      expect(ride.isAtEnd()).toBe(true);
    });
  });
});
