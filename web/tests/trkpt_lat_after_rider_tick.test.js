// 2026-05-15 user bug 報告 「GPX upload で 0km 認識される」 の原因 = shim の
// `_legacyAppendTrkpt` が `_idx` ベースで lat/lon を取っていたが、 viewer が
// rider.tick 直接呼びに rewire されてから `_idx` が更新されない bug。
// 本 test は viewer の呼出順 (= rider.tick 直接 + rideState.appendTrkpt の組合せ)
// を再現し、 trkpt の lat/lon が course 起点で固定せず進行に追従することを pin する。
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { buildGpxXml } from '../lib/gpx_builder.js';

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

// GPX 保存パイプライン end-to-end:
// ライドを模擬 → rideState.appendTrkpt で記録 → buildGpxXml で XML 構築 → lat/lon/ele が変化する
//
// このテストが捕まえるバグ:
//   「_legacyAppendTrkpt が rider.position ではなく course[_idx] (= 常に 0) を参照する」
//   → 全 trkpt の lat が course[0].lat に固定され、 GPX 内の全 <trkpt lat="..."> が同値になる
//   → Strava で 0km として認識される (= 2026-05-15 user 報告)
//
// 既存の shim テスト (上段) は trkpt 配列の lat を直接 assert するが、 buildGpxXml を
// 通した GPX 文字列まで検証していなかった。 本 describe はその経路を埋める。
describe('GPX 保存パイプライン: ライド記録 → buildGpxXml → lat/lon/ele が変化する', () => {
  function runSimulation() {
    const course = makeCourse();
    const rs = createRideState(course);
    rs.start();
    const rider = rs._rider;
    rider.setSpeed(1);  // 1 m/s
    const dt = 1 / 60;
    let lastTrkptMs = 0;
    const base = new Date('2026-01-01T07:00:00Z').getTime();
    for (let i = 0; i < 60 * 50; i++) {
      rider.tick(dt, { speedMultiplier: 1 });
      const nowMs = i * (dt * 1000);
      if (nowMs - lastTrkptMs >= 1000) {
        rs.appendTrkpt({
          t: new Date(base + nowMs).toISOString(),
          power: 150, cad: 80, hr: 130,
        });
        lastTrkptMs = nowMs;
      }
    }
    return rs.getTrkpts();
  }

  it('ride simulation → buildGpxXml で lat が全点同値にならない (= 緯度固定バグ再発防止)', () => {
    const trkpts = runSimulation();
    expect(trkpts.length).toBeGreaterThan(40);

    const gpx = buildGpxXml(trkpts, { name: 'test-ride' });

    // GPX 内の全 lat 属性を抽出
    const latMatches = [...gpx.matchAll(/trkpt lat="([^"]+)"/g)];
    expect(latMatches.length).toBeGreaterThan(40);
    const latValues = latMatches.map((m) => parseFloat(m[1]));

    // 緯度が全点で同値でない (= 固定バグが出ると uniqLat.size === 1 になる)
    const uniqLat = new Set(latValues.map((l) => l.toFixed(6)));
    expect(uniqLat.size).toBeGreaterThan(5);

    // 末尾が起点より北上 (= コース形状に沿って進んでいる)
    expect(latValues[latValues.length - 1]).toBeGreaterThan(latValues[0]);
  });

  it('ele が点ごとに変化する (= コース高度に沿っている)', () => {
    const trkpts = runSimulation();
    const gpx = buildGpxXml(trkpts, { name: 'test-ride' });

    const eleMatches = [...gpx.matchAll(/<ele>([^<]+)<\/ele>/g)];
    expect(eleMatches.length).toBeGreaterThan(40);
    const eleValues = eleMatches.map((m) => parseFloat(m[1]));
    const uniqEle = new Set(eleValues.map((e) => Math.round(e)));
    expect(uniqEle.size).toBeGreaterThan(5);
    // 高度も上昇方向 (course で elevation_m は 1m ずつ増加)
    expect(eleValues[eleValues.length - 1]).toBeGreaterThan(eleValues[0]);
  });

  it('time / power / cad / hr フィールドが全点に含まれる', () => {
    const trkpts = runSimulation();
    const gpx = buildGpxXml(trkpts, { name: 'test-ride' });

    // time フィールドが全 trkpt に存在する
    const timeCount = (gpx.match(/<time>/g) || []).length;
    expect(timeCount).toBe(trkpts.length);

    // power フィールドが含まれる
    expect(gpx).toContain('<gpxpx:PowerInWatts>150</gpxpx:PowerInWatts>');
    expect(gpx).toContain('<power>150</power>');

    // cad / hr も含まれる
    expect(gpx).toContain('<gpxtpx:cad>80</gpxtpx:cad>');
    expect(gpx).toContain('<gpxtpx:hr>130</gpxtpx:hr>');
  });
});
