// 2026-05-15 user 指摘「ふつう完走時の終端処理とかテストケース書くだろ」 への補填。
// 完走 (= rider.atGoal = true) で起きるべき経路を pin:
//   1. shim 経路で totalDist を超える advance すると rider.atGoal が true
//   2. viewer-maplibre.js source に「atGoal → 自動 ride 終了 (= sendRideEnd / rideState.end)
//      + _autoEnded gate」 logic が存在し、 再発火しないこと
//
// viewer-maplibre.js は maplibre-gl global 依存で直 import 不可、 ride 進行 / atGoal は
// rider 単独 unit、 完走経路は source-grep で物理 gate する 2 軸 test。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRideState } from '../lib/ride_state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');

function makeShortCourse() {
  // 100m course、 2 点。 totalDist = 100。
  return [
    { lat: 35.45, lon: 138.75, distance_m: 0, elevation_m: 1000, slope_pct: 0 },
    { lat: 35.46, lon: 138.75, distance_m: 100, elevation_m: 1100, slope_pct: 10 },
  ];
}

describe('ride 完走時の終端処理 (= 2026-05-15 user 指摘の補填)', () => {
  it('totalDist を超える距離まで advance すると rider.atGoal = true になる', () => {
    const rs = createRideState(makeShortCourse());
    rs.start();
    // 100m を 5 秒で走破 (= 20 m/s で 6 秒分 tick、 完走後 1 秒オーバー)
    for (let i = 0; i < 60 * 6; i++) {
      rs.advance(1 / 60, 20);
    }
    expect(rs._rider.atGoal).toBe(true);
    expect(rs.isAtEnd()).toBe(true);
    expect(rs.snapshot().distance).toBe(100);  // totalDist にクランプ
  });

  it('完走後の追加 advance は no-op (= distance 不変、 atGoal 維持)', () => {
    const rs = createRideState(makeShortCourse());
    rs.start();
    for (let i = 0; i < 60 * 6; i++) rs.advance(1 / 60, 20);
    const distAfterGoal = rs.snapshot().distance;
    for (let i = 0; i < 60; i++) rs.advance(1 / 60, 20);  // 完走後 1 秒分追加
    expect(rs.snapshot().distance).toBe(distAfterGoal);
    expect(rs._rider.atGoal).toBe(true);
  });

  it('viewer-maplibre.js: tick の atGoal 分岐で sendRideEnd + rideState.end を呼ぶ', () => {
    const viewer = readFileSync(VIEWER_PATH, 'utf8');
    // tick 末尾の atGoal else 分岐で sendRideEnd と rideState.end が呼ばれる
    expect(viewer).toMatch(/rider\.atGoal[\s\S]{0,400}sendRideEnd/);
    expect(viewer).toMatch(/rider\.atGoal[\s\S]{0,400}rideState\.end/);
  });

  it('viewer-maplibre.js: _autoEnded flag で完走自動終了の再発火を防止', () => {
    const viewer = readFileSync(VIEWER_PATH, 'utf8');
    // _autoEnded で gate して 1 回限り発火、 ride 開始時に reset
    expect(viewer).toMatch(/_autoEnded\s*=\s*true/);  // 完走時 set
    expect(viewer).toMatch(/_autoEnded\s*=\s*false/); // ride 開始時 reset
    expect(viewer).toMatch(/if\s*\(\s*!_autoEnded\s*\)/);  // gate 条件
  });

  it('viewer-maplibre.js: startRideConfirmed で _autoEnded をリセット (= 2 回目 ride も自動完走)', () => {
    const viewer = readFileSync(VIEWER_PATH, 'utf8');
    const m = viewer.match(/function\s+startRideConfirmed\s*\([\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/_autoEnded\s*=\s*false/);
  });
});
