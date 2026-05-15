// save_summary.js の unit test.
import { describe, it, expect } from 'vitest';
import { buildSaveSummary, detectAnomalies, summaryToDisplay } from '../lib/save_summary.js';

function mkTrkpts(n, opts = {}) {
  const startLat = opts.startLat ?? 35.36;
  const startLon = opts.startLon ?? 138.59;
  const endLat = opts.endLat ?? 35.40;
  const endLon = opts.endLon ?? 138.73;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    out.push({
      t: new Date(Date.UTC(2026, 4, 15, 9, 0, i)).toISOString(),
      lat: startLat + (endLat - startLat) * t,
      lon: startLon + (endLon - startLon) * t,
      ele: 1000 + i,
      power: 200 + (i % 10),
      cad: 85 + (i % 5),
      hr: 140 + (i % 8),
    });
  }
  return out;
}

const course = [{ lat: 35.36, lon: 138.59, distance_m: 0 }, { lat: 35.40, lon: 138.73, distance_m: 24000 }];

describe('buildSaveSummary', () => {
  it('正常 ride で統計が取れる', () => {
    const trkpts = mkTrkpts(120);
    const s = buildSaveSummary({
      trkpts, course,
      rideStartedAt: 1000, nowMs: 121000,
    });
    expect(s.trkpt_count).toBe(120);
    expect(s.duration_s).toBe(120);
    expect(s.duration_hms).toBe('0:02:00');
    expect(s.avg_power_w).toBeGreaterThan(199);
    expect(s.max_power_w).toBeGreaterThanOrEqual(209);
    expect(s.lat_unique).toBeGreaterThan(50);
    expect(s.end_differs_from_start).toBe(true);
  });

  it('起点固定 bug (= 全 trkpt が起点 lat/lon) を検出', () => {
    const trkpts = mkTrkpts(120, { endLat: 35.36, endLon: 138.59 });
    const s = buildSaveSummary({ trkpts, course });
    expect(s.lat_unique).toBe(1);
    expect(s.end_differs_from_start).toBe(false);
  });

  it('distanceM 引数があれば haversine ではなく直接値を使う', () => {
    const trkpts = mkTrkpts(5);
    const s = buildSaveSummary({ trkpts, course, distanceM: 5000 });
    expect(s.distance_m).toBe(5000);
    expect(s.distance_km).toBe(5);
  });

  it('null sensor を含む trkpt でも統計が落ちない', () => {
    const trkpts = mkTrkpts(50).map((p, i) => ({ ...p, power: i % 2 === 0 ? null : p.power }));
    const s = buildSaveSummary({ trkpts, course });
    expect(Number.isFinite(s.avg_power_w)).toBe(true);
  });
});

describe('detectAnomalies', () => {
  it('正常 summary は空', () => {
    const s = buildSaveSummary({ trkpts: mkTrkpts(100), course, distanceM: 5000 });
    expect(detectAnomalies(s)).toEqual([]);
  });

  it('lat unique 1 + trkpts 多数 → lat 固定 flag', () => {
    const trkpts = mkTrkpts(100, { endLat: 35.36, endLon: 138.59 });
    const s = buildSaveSummary({ trkpts, course });
    const a = detectAnomalies(s);
    expect(a.some((m) => m.includes('lat 固定'))).toBe(true);
  });

  it('trkpts 空で flag', () => {
    const s = buildSaveSummary({ trkpts: [], course });
    expect(detectAnomalies(s).some((m) => m.includes('trkpts 空'))).toBe(true);
  });

  it('多数 trkpts で末尾 = 起点 → 動いていない flag', () => {
    const trkpts = mkTrkpts(150, { endLat: 35.36, endLon: 138.59 });
    const s = buildSaveSummary({ trkpts, course });
    const a = detectAnomalies(s);
    expect(a.some((m) => m.includes('動いていない') || m.includes('lat 固定'))).toBe(true);
  });
});

describe('summaryToDisplay', () => {
  it('表示行に時間 / 距離 / 異常 flag が含まれる', () => {
    const s = buildSaveSummary({ trkpts: mkTrkpts(60), course, distanceM: 3000, rideStartedAt: 0, nowMs: 60000 });
    const rows = summaryToDisplay(s);
    expect(rows.find((r) => r.label === '時間')).toBeTruthy();
    expect(rows.find((r) => r.label === '距離').value).toMatch(/3\.00 km/);
    const anom = rows.find((r) => r.label === '異常 flag');
    expect(anom).toBeTruthy();
  });
});
