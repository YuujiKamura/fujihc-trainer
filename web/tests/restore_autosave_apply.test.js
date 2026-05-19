// 中断ライド復元の回帰テスト (= 2026-05-17 復元バグ修正).
//
// なぜこのファイルが要るか:
//   「autosave record → 復元適用 → rider が復元距離に居る」 経路を pin する test が
//   1 件も無かった。 その結果、 viewer の applyPendingRestore が
//   (1) _pendingRestore セット後に二度と呼ばれない timing desync、
//   (2) getter-only の rider.distanceTraveled へ代入して TypeError で abort、
//   の 2 重バグを抱えたまま「復元しても何も起きない」状態が landed していた。
//
// このテストは本物の共有関数 applyAutosaveToRideState を本物の createRideState 上で
// 実行し、 rider が実際に復元距離・active 状態に居ることを assert する (= コピー実装は叩かない)。

import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { applyAutosaveToRideState } from '../lib/ride_autosave.js';
import { withCumulativeDistance, DEG_LAT_PER_M } from './_helpers/course_fixture.js';

// 1m 等間隔・全長 ≒1000m の合成コース (= lat を DEG_LAT_PER_M 刻みで動かし
// haversine 1 セグメント ≒ 1.0m に揃える). distance_m も haversine 累積で自己整合.
function buildCourse(n = 1001) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ lat: 35 + i * DEG_LAT_PER_M, lon: 138, elevation_m: 100 + i * 0.1, slope_pct: 2 });
  }
  return withCumulativeDistance(pts);
}

function makeRec(distanceM, trkptCount = 0) {
  return {
    rideStartedAt: '2026-05-17T08:00:00.000Z',
    distanceM,
    courseName: 'fujihill',
    trkpts: Array.from({ length: trkptCount }, (_, j) => ({
      t: `2026-05-17T08:00:${String(j).padStart(2, '0')}.000Z`,
      power: 200, cad: 85, hr: 145,
    })),
  };
}

describe('applyAutosaveToRideState — 復元の本経路', () => {
  it('record の distanceM に rider を持ち上げる (= 復元の核心)', () => {
    const rideState = createRideState(buildCourse());
    const applied = applyAutosaveToRideState(rideState, makeRec(523.4));
    expect(applied).not.toBeNull();
    expect(applied.distanceM).toBeCloseTo(523.4, 3);
    // rider が実際に復元距離に居ること (= getter-only 代入 bug の回帰 guard).
    expect(rideState._rider.distanceTraveled).toBeCloseTo(523.4, 3);
    expect(rideState.snapshot().distance).toBeCloseTo(523.4, 3);
  });

  it('復元後 ride は active かつ非 paused (= そのまま走り続けられる)', () => {
    const rideState = createRideState(buildCourse());
    applyAutosaveToRideState(rideState, makeRec(300));
    const snap = rideState.snapshot();
    expect(snap.active).toBe(true);
    expect(snap.paused).toBe(false);
  });

  it('trkpts を rideState に再 append し件数を返す', () => {
    const rideState = createRideState(buildCourse());
    const applied = applyAutosaveToRideState(rideState, makeRec(400, 12));
    expect(applied.trkptCount).toBe(12);
    expect(rideState.getTrkpts().length).toBe(12);
  });

  it('distanceM がコース全長を超えたら全長に clamp する', () => {
    const rideState = createRideState(buildCourse()); // 全長 ≒1000m
    const total = rideState._terrain.totalDistance;
    const applied = applyAutosaveToRideState(rideState, makeRec(99999));
    expect(applied.distanceM).toBeCloseTo(total, 6);
    expect(rideState._rider.distanceTraveled).toBeCloseTo(total, 6);
  });

  it('distanceM が undefined なら復元せず null を返す (= IndexedDB 不正 record 防御)', () => {
    const rideState = createRideState(buildCourse());
    const applied = applyAutosaveToRideState(rideState, { trkpts: [] });
    expect(applied).toBeNull();
    expect(rideState._rider.distanceTraveled).toBe(0);
  });

  it('distanceM が数値文字列など非有限なら null を返す', () => {
    const rideState = createRideState(buildCourse());
    expect(applyAutosaveToRideState(rideState, makeRec('523.4'))).toBeNull();
    expect(applyAutosaveToRideState(rideState, makeRec(NaN))).toBeNull();
    expect(applyAutosaveToRideState(rideState, makeRec(Infinity))).toBeNull();
  });

  it('trkpts が配列でなくても距離復元は成功し件数 0', () => {
    const rideState = createRideState(buildCourse());
    const rec = makeRec(250);
    rec.trkpts = 'not-an-array';
    const applied = applyAutosaveToRideState(rideState, rec);
    expect(applied.distanceM).toBeCloseTo(250, 3);
    expect(applied.trkptCount).toBe(0);
  });

  it('rideState / record が null でも throw せず null を返す', () => {
    expect(applyAutosaveToRideState(null, makeRec(100))).toBeNull();
    expect(applyAutosaveToRideState({}, makeRec(100))).toBeNull();
    expect(applyAutosaveToRideState(createRideState(buildCourse()), null)).toBeNull();
  });
});
