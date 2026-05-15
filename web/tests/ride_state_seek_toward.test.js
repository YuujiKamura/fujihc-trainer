// 2026-05-15 user 指示「コースを観るモードで区間遷移をするとき、ワープするんじゃなくて
// 時速300kmで移動するようにしよう」
// rideState.seekToward(targetDist, dt, speedMps) を追加。 前後どちらにも進める、
// 1 step では speedMps*dt 進む、 残差が step 以下なら targetDist に着地して true を返す。
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';

// 1m 等間隔の 11 点 (0..10m) を持つ minimal course (= seek の前後移動を確認しやすい).
function makeCourse() {
  const arr = [];
  for (let i = 0; i <= 10; i++) {
    arr.push({ lat: 35 + i * 0.0001, lon: 138, distance_m: i, elevation_m: 100 + i, slope_pct: 0 });
  }
  return arr;
}

describe('rideState.seekToward', () => {
  it('現在地より前の目標に speedMps*dt で前進し、 到達前は false', () => {
    const rs = createRideState(makeCourse());
    rs.start();  // active=true, curDist=0
    const reached = rs.seekToward(10, 0.1, 50);  // 5m 進む、 10m まで届かない
    expect(reached).toBe(false);
    expect(rs.snapshot().distance).toBeCloseTo(5, 5);
  });

  it('1 step で残差を超える時は targetDist に着地して true を返す', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(10, 0.1, 50);  // 5m 進む
    const reached = rs.seekToward(10, 0.1, 50);  // 残り 5m、 step 5m で着地
    expect(reached).toBe(true);
    expect(rs.snapshot().distance).toBeCloseTo(10, 5);
  });

  it('curIdx も targetDist 到達時に再計算される', () => {
    const rs = createRideState(makeCourse());
    rs.start();  // curIdx=0
    rs.seekToward(7, 1, 100);  // 100m/s × 1s = 100m、 着地して curDist=7
    const snap = rs.snapshot();
    expect(snap.distance).toBeCloseTo(7, 5);
    expect(snap.idx).toBe(7);
  });

  it('現在地より後の目標 (= 後退) にも対応、 curDist が減る', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(8, 1, 100);  // 8m に着地
    const back = rs.seekToward(2, 0.1, 50);  // 残差 6m、 step 5m、 前進ではなく後退
    expect(back).toBe(false);
    expect(rs.snapshot().distance).toBeCloseTo(3, 5);
    // 後退の場合も curIdx は curDist 直下の index に refresh
    expect(rs.snapshot().idx).toBe(3);
  });

  it('paused 中は seekToward しても no-op', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.togglePause();  // paused=true
    const reached = rs.seekToward(10, 1, 100);
    expect(reached).toBe(false);  // 進まず targetDist にも届かない
    expect(rs.snapshot().distance).toBeCloseTo(0, 5);
  });

  it('dt <= 0 / speedMps <= 0 は no-op (= 既存 advance と同じガード)', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(5, 0, 100);
    expect(rs.snapshot().distance).toBeCloseTo(0, 5);
    rs.seekToward(5, 0.1, 0);
    expect(rs.snapshot().distance).toBeCloseTo(0, 5);
  });

  it('totalDist を超える target は totalDist にクランプして true', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    const reached = rs.seekToward(9999, 1, 1000);  // 1km/s × 1s で 10m を余裕越え
    expect(reached).toBe(true);
    expect(rs.snapshot().distance).toBeCloseTo(10, 5);
  });

  it('既に target と同じ位置なら 1 step で true (= no-op で即着地)', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(5, 1, 100);  // 5m に着地
    const reached = rs.seekToward(5, 0.1, 50);
    expect(reached).toBe(true);
    expect(rs.snapshot().distance).toBeCloseTo(5, 5);
  });
});
