// b124: autosave restore は trkpt 配列を再生するだけで rider の sensor 値には流れない
// (= restore 後 rider.power は 0 のまま) ことを round-trip で pin。 本 brief の SoT 統一が
// autosave 互換に影響しないことのマイグレ可逆性 gate。
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { applyAutosaveToRideState } from '../lib/ride_autosave.js';

const course = [
  { lat: 35.0, lon: 138.0, distance_m: 0, elevation_m: 0, slope_pct: 0 },
  { lat: 35.0, lon: 138.001, distance_m: 100, elevation_m: 0, slope_pct: 0 },
];

describe('b124: autosave restore で sensor 値が rider に流れず、 trkpt のみ再生される', () => {
  it('restore 後 rider.power は 0、 trkpt は record の値', () => {
    const rideState = createRideState(course);
    const rec = {
      distanceM: 50,
      trkpts: [
        { t: '2026-05-29T00:00:00Z', power: 200, cad: 90, hr: 150 },
        { t: '2026-05-29T00:00:01Z', power: 220, cad: 95, hr: 155 },
      ],
    };
    const result = applyAutosaveToRideState(rideState, rec);
    expect(result.trkptCount).toBe(2);
    expect(rideState._rider.power).toBe(0);
    const trkpts = rideState.getTrkpts();
    expect(trkpts.length).toBe(2);
    expect(trkpts[0].power).toBe(200);
    expect(trkpts[1].power).toBe(220);
  });
});
