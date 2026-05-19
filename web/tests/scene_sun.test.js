// sun_model.js の単体テスト ── 方位 (= 時間帯) から太陽仰角を出す日周モデル。
// THREE 非依存の純関数なので node の vitest から直接 import できる。

import { describe, it, expect } from 'vitest';
import { sunElevationFromAzimuth, MAX_SUN_ELEVATION_DEG } from '../lib/map3d/sun_model.js';

describe('sunElevationFromAzimuth — 方位から太陽仰角 (日周モデル)', () => {
  it('東 (方位 90°) は日の出 = 仰角ほぼ 0°', () => {
    expect(sunElevationFromAzimuth(90)).toBeCloseTo(0, 6);
  });

  it('南 (方位 180°) は南中 = 最大仰角', () => {
    expect(sunElevationFromAzimuth(180)).toBeCloseTo(MAX_SUN_ELEVATION_DEG, 6);
  });

  it('西 (方位 270°) は日の入り = 仰角ほぼ 0°', () => {
    expect(sunElevationFromAzimuth(270)).toBeCloseTo(0, 6);
  });

  it('南東 (方位 135°) は東と南の中間で正の仰角', () => {
    const e = sunElevationFromAzimuth(135);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(MAX_SUN_ELEVATION_DEG);
  });

  it('昼の仰角は南中 (180°) を頂点に東西対称 (= 135° と 225° が同じ高さ)', () => {
    expect(sunElevationFromAzimuth(135)).toBeCloseTo(sunElevationFromAzimuth(225), 6);
  });

  it('北 (方位 0° / 360°) は地平線下 = 負 (= 北からは陽が差さない)', () => {
    expect(sunElevationFromAzimuth(0)).toBeLessThan(0);
    expect(sunElevationFromAzimuth(360)).toBeLessThan(0);
  });

  it('北寄りの方位 (45°, 315°) も地平線下 = 負', () => {
    expect(sunElevationFromAzimuth(45)).toBeLessThan(0);
    expect(sunElevationFromAzimuth(315)).toBeLessThan(0);
  });

  it('範囲外の方位も 360° で正規化して扱う', () => {
    expect(sunElevationFromAzimuth(180 + 360)).toBeCloseTo(MAX_SUN_ELEVATION_DEG, 6);
    expect(sunElevationFromAzimuth(-180)).toBeCloseTo(MAX_SUN_ELEVATION_DEG, 6);  // -180 → 180
  });
});
