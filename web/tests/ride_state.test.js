import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';

// 富士ヒル域 (lat≒35) で 0.001 度ずつ動かす簡易 course を組む.
// 緯度 0.001° ≒ 111 m, 経度 0.001° ≒ 91 m (cos(35°)≒0.819).

/** 北向き直線 course を distance_m = 0, 111, 222, ... で組み立てる */
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

function buildSouthCourse(n = 6) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.4 - i * 0.001,
      lon: 138.7,
      distance_m: i * 111,
      elevation_m: 1000,
      slope_pct: 0,
    });
  }
  return arr;
}

function buildWestCourse(n = 6) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.4,
      lon: 138.7 - i * 0.001,
      distance_m: i * 91,
      elevation_m: 1000,
      slope_pct: 0,
    });
  }
  return arr;
}

describe('createRideState', () => {
  describe('advance', () => {
    it('happy: dt=1.0 s, speed=20km/h (=5.555 m/s) で curDist が ≒5.5 m 増える', () => {
      const course = buildNorthCourse();
      const ride = createRideState(course);
      ride.start();
      const speedMps = 20 / 3.6; // ≒ 5.555
      ride.advance(1.0, speedMps);
      const snap = ride.snapshot();
      expect(snap.distance).toBeCloseTo(5.555, 2);
      // 5.5 m < 111 m なので idx はまだ 0
      expect(snap.idx).toBe(0);
    });

    it('paused なら curDist 不変 (= start を呼んでない初期状態は paused)', () => {
      const course = buildNorthCourse();
      const ride = createRideState(course);
      // 初期 paused=true
      ride.advance(1.0, 20 / 3.6);
      expect(ride.snapshot().distance).toBe(0);
      // togglePause → 走る → togglePause → paused にして advance しても増えない
      ride.start();
      ride.togglePause(); // active かつ paused=true
      ride.advance(1.0, 20 / 3.6);
      expect(ride.snapshot().distance).toBe(0);
      expect(ride.snapshot().paused).toBe(true);
    });

    it('末尾到達で curDist は totalDist に clamp、 isAtEnd() = true', () => {
      const course = buildNorthCourse(5); // total = 4*111 = 444 m
      const ride = createRideState(course);
      ride.start();
      // 1000 m / 1 s = 1000 m/s で一気に超過させる
      ride.advance(1.0, 1000);
      const snap = ride.snapshot();
      expect(snap.distance).toBe(444);
      // curIdx は viewer-maplibre.js の tick と同 logic で `course[curIdx+1].distance_m < curDist`
      // を満たす限り前進する. ちょうど末尾 distance に到達したとき = lastIdx-1 で止まる.
      // 「末尾到達」は distance で判定するのが正しい (= isAtEnd の責務).
      expect(snap.idx).toBe(course.length - 2);
      expect(ride.isAtEnd()).toBe(true);
      // 末尾到達後の advance は no-op
      ride.advance(1.0, 100);
      expect(ride.snapshot().distance).toBe(444);
    });

    it('複数 tick で curIdx が curDist に追従して前進', () => {
      const course = buildNorthCourse(10); // distance_m: 0, 111, 222, ...
      const ride = createRideState(course);
      ride.start();
      // 250 m まで進める (= idx が 2 に進むはず: 222 < 250 < 333)
      ride.advance(1.0, 250);
      const snap = ride.snapshot();
      expect(snap.distance).toBe(250);
      expect(snap.idx).toBe(2);
    });
  });

  describe('getCurrentSlope', () => {
    it('curIdx の slope_pct を返す', () => {
      const course = buildNorthCourse(10);
      const ride = createRideState(course);
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
      const course = buildNorthCourse();
      const ride = createRideState(course);
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
      const course = buildNorthCourse();
      const ride = createRideState(course);
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
      const course = buildNorthCourse();
      const ride = createRideState(course);
      ride.start(); // paused=false
      expect(ride.snapshot().paused).toBe(false);
      ride.togglePause();
      expect(ride.snapshot().paused).toBe(true);
      ride.togglePause();
      expect(ride.snapshot().paused).toBe(false);
    });

    it('reset で curIdx=0, curDist=0 (paused / active は変えない)', () => {
      const course = buildNorthCourse();
      const ride = createRideState(course);
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
  });

  describe('snapshot', () => {
    it('immutable copy が返る (= 外側 mutation が内部 state に影響しない)', () => {
      const course = buildNorthCourse();
      const ride = createRideState(course);
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
      const course = buildNorthCourse(3); // total = 222 m
      const ride = createRideState(course);
      expect(ride.isAtEnd()).toBe(false);
      ride.start();
      ride.advance(1.0, 1000);
      expect(ride.isAtEnd()).toBe(true);
    });
  });
});
