// b124: rider の sensor sticky 振る舞いを behavioral pin。 grep gate だけでは拾えない
// 「undefined は前値保持 / null は 0 リセット / 非数値は no-op」の落とし穴を全数 pin する。
import { describe, it, expect } from 'vitest';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

const course = [
  { lat: 35.0, lon: 138.0, distance_m: 0, elevation_m: 0, slope_pct: 0 },
  { lat: 35.0, lon: 138.001, distance_m: 100, elevation_m: 0, slope_pct: 0 },
];

describe('b124: rider sensor sticky 振る舞い', () => {
  it('部分更新で他 field の前値を保持する (= sticky happy)', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSensors({ power: 200, cad: 90, hr: 150 });
    rider.setSensors({ power: 220 });
    expect(rider.power).toBe(220);
    expect(rider.cadence).toBe(90);
    expect(rider.hr).toBe(150);
  });

  it('undefined を渡しても前値保持 (= sticky 仕様)', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSensors({ power: 200, cad: 90, hr: 150 });
    rider.setSensors({ power: undefined, cad: undefined, hr: undefined });
    expect(rider.power).toBe(200);
    expect(rider.cadence).toBe(90);
    expect(rider.hr).toBe(150);
  });

  it('null は 0 リセットされる (= sticky 落とし穴、 handler が null を渡さないことを behavioral pin)', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSensors({ power: 200, cad: 90, hr: 150 });
    rider.setSensors({ power: null, cad: null, hr: null });
    expect(rider.power).toBe(0);
    expect(rider.cadence).toBe(0);
    expect(rider.hr).toBe(0);
  });

  it('非数値文字列は no-op (= NaN guard)', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSensors({ power: 200, cad: 90, hr: 150 });
    rider.setSensors({ power: 'abc', cad: 'def', hr: 'ghi' });
    expect(rider.power).toBe(200);
    expect(rider.cadence).toBe(90);
    expect(rider.hr).toBe(150);
  });

  it('setSpeed: 負値は no-op、 NaN は no-op、 undefined は no-op、 正数は反映', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSpeed(5.5);
    expect(rider.speed).toBe(5.5);
    rider.setSpeed(-1);
    expect(rider.speed).toBe(5.5);
    rider.setSpeed(NaN);
    expect(rider.speed).toBe(5.5);
    rider.setSpeed(undefined);
    expect(rider.speed).toBe(5.5);
  });
});
