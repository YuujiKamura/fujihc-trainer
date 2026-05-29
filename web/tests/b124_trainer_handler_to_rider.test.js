// b124: trainer message → rider への流入経路を pure 関数 handleTrainerStatePush で behavioral pin。
// viewer 本体は top-level で document を触り node import で落ちるため、handler を別 lib に切り出して
// ここから直接駆動する (= 完了条件 8 の別ファイル path)。
import { describe, it, expect, beforeEach } from 'vitest';
import { handleTrainerStatePush } from '../lib/trainer_handler.js';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

const course = [
  { lat: 35.0, lon: 138.0, distance_m: 0, elevation_m: 0, slope_pct: 0 },
  { lat: 35.0, lon: 138.001, distance_m: 100, elevation_m: 0, slope_pct: 0 },
];

describe('b124: trainer message handler が rider に sticky で流入する', () => {
  let rider;
  beforeEach(() => {
    const terrain = createTerrain({ course });
    rider = createRider({ terrain });
  });

  it('完全 msg で 4 field 全部反映', () => {
    handleTrainerStatePush({ power_w: 200, cadence_rpm: 90, hr_bpm: 150, speed_mps: 5.5 }, { rider });
    expect(rider.power).toBe(200);
    expect(rider.cadence).toBe(90);
    expect(rider.hr).toBe(150);
    expect(rider.speed).toBe(5.5);
  });

  it('partial msg (= cadence_rpm のみ) で他 field は sticky', () => {
    handleTrainerStatePush({ power_w: 200, cadence_rpm: 90, hr_bpm: 150, speed_mps: 5.5 }, { rider });
    handleTrainerStatePush({ cadence_rpm: 95 }, { rider });
    expect(rider.cadence).toBe(95);
    expect(rider.power).toBe(200);
    expect(rider.hr).toBe(150);
    expect(rider.speed).toBe(5.5);
  });

  it('rider が null の handler は no-throw', () => {
    expect(() => handleTrainerStatePush({ power_w: 200 }, { rider: null })).not.toThrow();
  });

  it('ctx 省略でも no-throw (= rider 未指定の防御)', () => {
    expect(() => handleTrainerStatePush({ power_w: 200 })).not.toThrow();
  });

  it('msg の型不一致 (= power_w が文字列) は無視、 数値の cadence_rpm は反映', () => {
    handleTrainerStatePush({ power_w: 'abc', cadence_rpm: 90 }, { rider });
    expect(rider.power).toBe(0);
    expect(rider.cadence).toBe(90);
  });
});
