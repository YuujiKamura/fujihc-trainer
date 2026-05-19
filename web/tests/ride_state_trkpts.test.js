// brief 33 atom E: ride_state.js の trkpts 拡張部 unit test.
// 既存 ride_state.test.js とは独立 file (= 拡張部のみ verify、 既存 12 件は不変).
import { describe, it, expect } from 'vitest';
import { createRideState } from '../lib/ride_state.js';
import { withCumulativeDistance } from './_helpers/course_fixture.js';

// rider-position-model: distance_m は haversine 累積で自己整合に埋める.
function buildCourse(n = 10) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      lat: 35.4 + i * 0.001,
      lon: 138.7,
      elevation_m: 1000 + i * 10,
      slope_pct: 5,
    });
  }
  return withCumulativeDistance(pts);
}

describe('ride_state trkpts (brief 33)', () => {
  it('start() で trkpts 初期化 (= 空配列)', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    expect(rs.getTrkpts()).toEqual([]);
    expect(rs.snapshot().trkptCount).toBe(0);
  });

  it('advance(dt, speed, extras) で trkpt 1 件 push', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.advance(1.0, 5.0, { t: '2026-05-15T07:30:00Z', power: 210, cad: 85, hr: 142 });
    const pts = rs.getTrkpts();
    expect(pts.length).toBe(1);
    expect(pts[0].t).toBe('2026-05-15T07:30:00Z');
    // 2026-05-15 fix (commit de57ce1): shim の trkpt lat/lon source を _idx の raw 値から
    // rider.position の interpolated 値に変更。 advance(1s, 5m/s) で 5m 進む間 lat は
    // 起点から微小 (= 4 桁精度内) ずれる、 5 桁精度の旧 assertion は緩める。
    expect(pts[0].lat).toBeCloseTo(35.4, 3);
    expect(pts[0].lon).toBeCloseTo(138.7, 3);
    expect(pts[0].power).toBe(210);
    expect(pts[0].cad).toBe(85);
    expect(pts[0].hr).toBe(142);
  });

  it('advance(dt, speed) (= 2 引数 = 既存 caller) は trkpt 追加なし (= 後方互換)', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.advance(1.0, 5.0);  // 既存 signature
    rs.advance(1.0, 5.0);
    expect(rs.getTrkpts()).toEqual([]);
  });

  it('appendTrkpt 単独で push 可能 (= ride 中の tick 内で別 cadence で呼べる)', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.appendTrkpt({ t: '2026-05-15T07:30:00Z', power: 200, cad: 80, hr: 140 });
    rs.appendTrkpt({ t: '2026-05-15T07:30:01Z', power: 205, cad: 82, hr: 141 });
    expect(rs.getTrkpts().length).toBe(2);
    expect(rs.snapshot().trkptCount).toBe(2);
  });

  it('reset() で trkpts もクリア', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.advance(1.0, 5.0, { power: 200 });
    expect(rs.getTrkpts().length).toBeGreaterThan(0);
    rs.reset();
    expect(rs.getTrkpts()).toEqual([]);
  });

  it('start() を 2 回呼ぶと trkpts も初期化される', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.advance(1.0, 5.0, { power: 200 });
    rs.start();
    expect(rs.getTrkpts()).toEqual([]);
  });

  it('getTrkpts() は immutable copy を返す (= caller mutate で内部影響しない)', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.appendTrkpt({ power: 200, cad: 80, hr: 140 });
    const a = rs.getTrkpts();
    a.push({ x: 'tampered' });
    a[0].power = 999;
    const b = rs.getTrkpts();
    expect(b.length).toBe(1);
    expect(b[0].power).toBe(200);  // mutation 影響なし
  });

  it('extras 省略時は t を auto-fill (= new Date().toISOString())', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.appendTrkpt({ power: 200 });
    const pts = rs.getTrkpts();
    expect(pts[0].t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(pts[0].cad).toBeNull();
    expect(pts[0].hr).toBeNull();
  });

  it('paused 中の advance(dt, speed, extras) は trkpt 追加しない', () => {
    const rs = createRideState(buildCourse());
    rs.start();
    rs.togglePause();  // → paused = true
    rs.advance(1.0, 5.0, { power: 200 });
    expect(rs.getTrkpts()).toEqual([]);
  });
});
