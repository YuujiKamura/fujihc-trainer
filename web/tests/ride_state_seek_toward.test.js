// 2026-05-15 user 指示「コースを観るモードで区間遷移をするとき、ワープするんじゃなくて
// 時速300kmで移動するようにしよう」
// rideState.seekToward(targetDist, dt, speedMps) を追加。 前後どちらにも進める、
// 1 step では speedMps*dt 進む、 残差が step 以下なら targetDist に着地して true を返す。
//
// rider-position-model: fixture を haversine 自己整合な metre スケール (= 1 セグメント
// ≒ 1.0 m) で組み直し、 距離 ≒ 点 index になるよう DEG_LAT_PER_M 刻みで lat を動かす。
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { withCumulativeDistance, DEG_LAT_PER_M } from './_helpers/course_fixture.js';

// 1m 等間隔の 11 点 (0..10m). lat を DEG_LAT_PER_M 刻みで動かし haversine 1 セグメント
// ≒ 1.0 m に揃える ── seek の前後移動と idx 境界を 1m 粒度で確認できる。
function makeCourse() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({ lat: 35 + i * DEG_LAT_PER_M, lon: 138, elevation_m: 100 + i, slope_pct: 0 });
  }
  return withCumulativeDistance(pts);
}

describe('rideState.seekToward', () => {
  it('現在地より前の目標に speedMps*dt で前進し、 到達前は false', () => {
    const rs = createRideState(makeCourse());
    rs.start();  // active=true, curDist=0
    const reached = rs.seekToward(10, 0.1, 50);  // 5m 進む、 10m まで届かない
    expect(reached).toBe(false);
    expect(rs.snapshot().distance).toBeCloseTo(5, 3);
  });

  it('1 step で残差を超える時は targetDist に着地して true を返す', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(10, 0.1, 50);  // 5m 進む
    const reached = rs.seekToward(10, 0.1, 50);  // 残り 5m、 step 5m で着地
    expect(reached).toBe(true);
    expect(rs.snapshot().distance).toBeCloseTo(10, 3);
  });

  it('curIdx も targetDist 到達時に再計算される', () => {
    const rs = createRideState(makeCourse());
    rs.start();  // curIdx=0
    // 7.5m (= セグメント 7 の内部) へ着地 ── 整数 m はセグメント境界で float 由来に
    // どちらの idx にもなり得るため、 区間内部の値で idx を確定的に確認する。
    rs.seekToward(7.5, 1, 100);  // 100m/s × 1s = 100m、 着地して curDist=7.5
    const snap = rs.snapshot();
    expect(snap.distance).toBeCloseTo(7.5, 3);
    expect(snap.idx).toBe(7);  // 7.5m はセグメント 7 (1 セグメント ≒ 1m)
  });

  it('現在地より後の目標 (= 後退) にも対応、 curDist が減る', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(8.5, 1, 100);  // 8.5m に着地
    const back = rs.seekToward(2, 0.1, 50);  // 残差 6.5m、 step 5m、 前進ではなく後退
    expect(back).toBe(false);
    expect(rs.snapshot().distance).toBeCloseTo(3.5, 3);
    // 後退の場合も curIdx は curDist 直下の index に refresh
    expect(rs.snapshot().idx).toBe(3);  // 3.5m はセグメント 3
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
    expect(rs.snapshot().distance).toBeCloseTo(rs._terrain.totalDistance, 6);
  });

  it('既に target と同じ位置なら 1 step で true (= no-op で即着地)', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    rs.seekToward(5, 1, 100);  // 5m に着地
    const reached = rs.seekToward(5, 0.1, 50);
    expect(reached).toBe(true);
    expect(rs.snapshot().distance).toBeCloseTo(5, 3);
  });
});
