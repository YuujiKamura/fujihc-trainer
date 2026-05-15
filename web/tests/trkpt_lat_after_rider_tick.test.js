// 2026-05-15 user bug 報告 「GPX upload で 0km 認識される」 の原因 = shim の
// `_legacyAppendTrkpt` が `_idx` ベースで lat/lon を取っていたが、 viewer が
// rider.tick 直接呼びに rewire されてから `_idx` が更新されない bug。
// 本 test は viewer の呼出順 (= rider.tick 直接 + rideState.appendTrkpt の組合せ)
// を再現し、 trkpt の lat/lon が course 起点で固定せず進行に追従することを pin する。
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';

function makeCourse() {
  // 1m 等間隔の 100 点。 lat は 0.0001 deg ずつ北上 (= 1 点で約 11m、 だが distance_m は 1m
  // 等間隔で intentionally 不整合、 「distance ベースで idx 引く」 を test するため).
  const arr = [];
  for (let i = 0; i < 100; i++) {
    arr.push({
      lat: 35.45 + i * 0.0001,
      lon: 138.75,
      distance_m: i,
      elevation_m: 1000 + i,
      slope_pct: 0,
    });
  }
  return arr;
}

describe('shim trkpt lat/lon が rider 進行に追従する (= viewer rewire 後の bug pin)', () => {
  it('viewer が rider.tick 直接 + rideState.appendTrkpt を呼ぶ経路で lat/lon が course 起点に固定しない', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    const rider = rs._rider;
    // 50 秒分、 60Hz で rider.tick 直接 (= shim.advance を bypass)、 1Hz で appendTrkpt
    rider.setSpeed(1);  // 1 m/s
    const dt = 1 / 60;
    let lastTrkptMs = 0;
    for (let i = 0; i < 60 * 50; i++) {
      rider.tick(dt, { speedMultiplier: 1 });
      const nowMs = i * (dt * 1000);
      if (nowMs - lastTrkptMs >= 1000) {
        rs.appendTrkpt({ t: new Date().toISOString(), power: 100, cad: 60, hr: 120 });
        lastTrkptMs = nowMs;
      }
    }
    const trkpts = rs.getTrkpts();
    expect(trkpts.length).toBeGreaterThan(40);
    // 起点に固定していない (= lat unique 数が複数)
    const uniqLat = new Set(trkpts.map((p) => p.lat));
    expect(uniqLat.size).toBeGreaterThan(5);
    // 末尾 lat が起点と異なる (= 確実に進んでいる)
    expect(trkpts[trkpts.length - 1].lat).not.toBe(trkpts[0].lat);
    // 末尾 lat が起点より北上 (= lat 増加方向)
    expect(trkpts[trkpts.length - 1].lat).toBeGreaterThan(trkpts[0].lat);
  });

  it('shim.advance 経路 (= 旧 viewer の path) でも lat/lon が進行に追従する', () => {
    const rs = createRideState(makeCourse());
    rs.start();
    const dt = 1 / 60;
    let lastTrkptMs = 0;
    for (let i = 0; i < 60 * 30; i++) {
      rs.advance(dt, 1);  // shim 経路
      const nowMs = i * (dt * 1000);
      if (nowMs - lastTrkptMs >= 1000) {
        rs.appendTrkpt({ t: new Date().toISOString(), power: 100, cad: 60, hr: 120 });
        lastTrkptMs = nowMs;
      }
    }
    const trkpts = rs.getTrkpts();
    expect(trkpts.length).toBeGreaterThan(25);
    const uniqLat = new Set(trkpts.map((p) => p.lat));
    expect(uniqLat.size).toBeGreaterThan(5);
  });
});
