// b124: 妥協 2 で受容した「未受信 0 を null 化」を pure 関数 buildSaveSummaryTrkptPoint で pin。
// この null 正規化は preflight の trainer snapshot で使う (= impl-time grep で brief 記述の
// 「save_summary trkpt」の実体が preflight と判明、 詳細は save_summary_trkpt.js の冒頭注記)。
import { describe, it, expect } from 'vitest';
import { buildSaveSummaryTrkptPoint } from '../lib/save_summary_trkpt.js';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

const course = [
  { lat: 35.0, lon: 138.0, distance_m: 0, elevation_m: 0, slope_pct: 0 },
  { lat: 35.0, lon: 138.001, distance_m: 100, elevation_m: 0, slope_pct: 0 },
];

describe('b124: trkpt sensor 値の null 正規化', () => {
  it('rider が sensor 未受信 (= 全 0) なら power / cadence / hr は null', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    const pt = buildSaveSummaryTrkptPoint({ rider, t: '2026-05-29T00:00:00Z' });
    expect(pt.power).toBeNull();
    expect(pt.cadence).toBeNull();
    expect(pt.hr).toBeNull();
    expect(pt.t).toBe('2026-05-29T00:00:00Z');
  });

  it('rider が一度 sensor を受信したら数値が出る', () => {
    const terrain = createTerrain({ course });
    const rider = createRider({ terrain });
    rider.setSensors({ power: 200, cad: 90, hr: 150 });
    const pt = buildSaveSummaryTrkptPoint({ rider, t: '2026-05-29T00:00:00Z' });
    expect(pt.power).toBe(200);
    expect(pt.cadence).toBe(90);
    expect(pt.hr).toBe(150);
  });

  it('rider が null でも no-throw で全 null', () => {
    const pt = buildSaveSummaryTrkptPoint({ rider: null, t: '2026-05-29T00:00:00Z' });
    expect(pt.power).toBeNull();
    expect(pt.cadence).toBeNull();
    expect(pt.hr).toBeNull();
  });
});
