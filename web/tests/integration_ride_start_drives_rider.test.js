// 回帰テスト: ride 開始 → rider が active → fake trainer が power を出す → 物理積分で前進。
//
// 2026-05-17 のバグ (= 統合検証で発見、 f4d9011 でも再現する既存バグ):
//   TEST MODE の自動 ride 開始 (initTestMode の 500ms タイマー → startRideConfirmed) が
//   loadCourse の rideState 生成を追い越す race。 startRideConfirmed / ride_status:started の
//   `if (rideState) rideState.start()` が rideState 未生成のため空振りし、 その後 rideState が
//   生成されても誰も start を呼び直さない。 rider は createRider 既定の paused/inactive のまま。
//   fake trainer (createFakeStateGenerator) は ride が active の時だけ power を出す設計なので、
//   rider が永久に inactive → power 0 → 速度 0 → 距離が進まない、 という症状になっていた。
//
// fix: viewer-maplibre.js に _pendingRideStart 保留フラグを導入。 rideState 未生成時の
//   開始要求をフラグに保留し、 loadCourse が rideState を生成した直後に消費して start する。
//
// このファイルが pin するもの:
//   - createFakeStateGenerator: active かつ非 paused の時だけ power 150 を出す
//   - createRideState.start() が rider を active/非 paused にする
//   - 「ride 開始 → active → fake power → integratePhysics → rider.tick」 で距離が増える全鎖
//   - _pendingRideStart 機構が viewer-maplibre.js の実 source に landing 済 (= source 走査)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRideState } from '../lib/ride_state.js';
import { createFakeStateGenerator } from '../lib/ws_client.js';
import { integratePhysics } from '../lib/bike_physics.js';

// 1m 等間隔・全長 2000m・平地 (slope 0) の合成コース.
function buildCourse(n = 2001) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({ lat: 35 + i * 1e-5, lon: 138, distance_m: i, elevation_m: 100, slope_pct: 0 });
  }
  return arr;
}

const PHYS_OPTS = { mass: 88, c_rr: 0.001, c_d: 0.35, area: 1, inertia: 800 };

describe('createFakeStateGenerator — fake trainer は ride active 時のみ power を出す', () => {
  it('ride 未開始 (rideState 既定) なら power / speed / cadence すべて 0', () => {
    const rideState = createRideState(buildCourse());
    const gen = createFakeStateGenerator(() => rideState.snapshot(), 'OK (TEST MODE)');
    const s = gen();
    expect(s.power_w).toBe(0);
    expect(s.speed_mps).toBe(0);
    expect(s.cadence_rpm).toBe(0);
  });

  it('ride 開始後 (active かつ非 paused) は power 150 / cadence 80 を出す', () => {
    const rideState = createRideState(buildCourse());
    rideState.start();
    const gen = createFakeStateGenerator(() => rideState.snapshot(), 'OK (TEST MODE)');
    const s = gen();
    expect(s.power_w).toBe(150);
    expect(s.cadence_rpm).toBe(80);
    expect(s.speed_mps).toBeCloseTo(20 / 3.6, 5);
  });

  it('paused なら active でも power 0 (= 一時停止中は fake trainer も止まる)', () => {
    const rideState = createRideState(buildCourse());
    rideState.start();
    rideState.togglePause();
    const gen = createFakeStateGenerator(() => rideState.snapshot());
    expect(gen().power_w).toBe(0);
  });

  it('getSnapshot が null (= rideState 未生成) でも throw せず power 0', () => {
    const gen = createFakeStateGenerator(() => null);
    expect(gen().power_w).toBe(0);
  });

  it('ackLabel が last_ack に反映される', () => {
    expect(createFakeStateGenerator(() => null, 'OK (MAP MODE)')().last_ack).toBe('OK (MAP MODE)');
    expect(createFakeStateGenerator(() => null)().last_ack).toBe('OK (TEST MODE)');
  });
});

describe('ride 開始 → rider 前進 の全鎖', () => {
  it('ride 未開始では fake power 0 → 物理積分しても速度 0、 rider 不動', () => {
    const rideState = createRideState(buildCourse());
    const gen = createFakeStateGenerator(() => rideState.snapshot());
    const rider = rideState._rider;
    let v = 0;
    for (let i = 0; i < 10; i++) {
      const st = gen();
      v = integratePhysics(v, 1.0, st.power_w, 0, PHYS_OPTS);
      rider.setSpeed(v);
      rider.tick(1.0, { speedMultiplier: 1 });
    }
    expect(v).toBe(0);
    expect(rideState.snapshot().distance).toBe(0);
  });

  it('ride 開始すれば active → fake power 150 → integratePhysics で加速 → rider.tick で前進', () => {
    const rideState = createRideState(buildCourse());
    rideState.start();
    expect(rideState.snapshot().active).toBe(true);
    expect(rideState.snapshot().paused).toBe(false);

    const gen = createFakeStateGenerator(() => rideState.snapshot());
    const rider = rideState._rider;
    const distBefore = rideState.snapshot().distance;
    let v = 0;
    for (let i = 0; i < 10; i++) {
      const st = gen();
      expect(st.power_w).toBe(150);  // active な限り fake trainer は漕ぎ続ける
      v = integratePhysics(v, 1.0, st.power_w, 0, PHYS_OPTS);
      rider.setSpeed(v);
      rider.tick(1.0, { speedMultiplier: 1 });
    }
    expect(v).toBeGreaterThan(0);
    expect(rideState.snapshot().distance).toBeGreaterThan(distBefore + 1);
  });
});

describe('_pendingRideStart 機構 — ride 開始が rideState 生成前に要求された race の回帰', () => {
  it('rideState 生成直後は inactive、 保留分を消費すれば active になり rider が動ける', () => {
    // viewer: rideState 未生成時の開始要求は _pendingRideStart=true で保留され、
    // loadCourse が rideState 生成直後に「pending かつ未 active なら start」 で消費する。
    // その消費後の状態を本物の rideState で pin する。
    const rideState = createRideState(buildCourse());
    expect(rideState.snapshot().active).toBe(false);  // createRider 既定は inactive

    const pendingRideStart = true;  // ride 開始が生成前に要求済の状態
    if (pendingRideStart && !rideState.snapshot().active) rideState.start();

    expect(rideState.snapshot().active).toBe(true);
    // active になったので fake trainer が power を出せる (= rider が走り出せる)
    expect(createFakeStateGenerator(() => rideState.snapshot())().power_w).toBe(150);
  });

  // viewer-maplibre.js は maplibre-gl / DOM 依存で単体 import 不可のため、
  // fix が実 source に landing 済かを source 走査 gate で物理確認する。
  const viewer = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'viewer-maplibre.js'), 'utf8');

  it('viewer-maplibre.js: rideState 未生成時の開始要求が _pendingRideStart を立てる', () => {
    expect(viewer).toMatch(/else\s+_pendingRideStart\s*=\s*true/);
  });

  it('viewer-maplibre.js: loadCourse が applyPendingRestore の後で _pendingRideStart を消費する', () => {
    const idxRestore = viewer.indexOf('applyPendingRestore();');
    const idxConsume = viewer.indexOf('if (_pendingRideStart)');
    expect(idxRestore).toBeGreaterThan(-1);
    expect(idxConsume).toBeGreaterThan(idxRestore);
  });
});
