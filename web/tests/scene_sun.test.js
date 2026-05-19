// sun_model.js の単体テスト ── scene.js の太陽光源・影 (shadow map) を駆動する純ロジック。
// THREE 非依存なので node の vitest から直接 import できる。
//   - sunElevationFromAzimuth : 方位 (= 時間帯) から太陽仰角を出す日周モデル
//   - shadowCameraConfig      : 自機倍率と太陽仰角から影オルソカメラの半幅・光源距離を出す
// 後者は「巨大ライダーで影が四角く切れる」 bug の修正核 ── 倍率に錐台が比例するかを pin する。

import { describe, it, expect } from 'vitest';
import {
  sunElevationFromAzimuth, shadowCameraConfig, MAX_SUN_ELEVATION_DEG, RIDER_SCALE_BASE,
} from '../lib/map3d/sun_model.js';

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

describe('shadowCameraConfig — 自機倍率と太陽仰角から影オルソカメラの設定', () => {
  it('基準倍率 (3.6) では k=1 ── reach は素の値 (仰角 45° で 3 + 2.6/tan(45°) = 5.6)', () => {
    const c = shadowCameraConfig(RIDER_SCALE_BASE, 45);
    expect(c.reach).toBeCloseTo(5.6, 5);
    expect(c.lightDist).toBeCloseTo(60, 5);
  });

  it('巨大ライダー (倍率 50) は錐台が k=50/3.6 倍に広がる ── 影が四角く切れる bug の修正核', () => {
    const base = shadowCameraConfig(RIDER_SCALE_BASE, 45);
    const big = shadowCameraConfig(50, 45);
    // 倍率 50 の錐台は基準より必ず大きい ── これが固定 18 上限で四角く切れた bug の逆。
    expect(big.reach).toBeGreaterThan(base.reach);
    expect(big.reach).toBeCloseTo(base.reach * (50 / RIDER_SCALE_BASE), 4);
    expect(big.lightDist).toBeCloseTo(60 * (50 / RIDER_SCALE_BASE), 4);
  });

  it('reach は riderScale に線形 (= 倍率 7.2 は 3.6 の 2 倍)', () => {
    const r1 = shadowCameraConfig(RIDER_SCALE_BASE, 45).reach;
    const r2 = shadowCameraConfig(RIDER_SCALE_BASE * 2, 45).reach;
    expect(r2).toBeCloseTo(r1 * 2, 5);
  });

  it('lightDist は riderScale に比例 (= 基準 60m、 倍率 k で 60k)', () => {
    expect(shadowCameraConfig(RIDER_SCALE_BASE, 45).lightDist).toBeCloseTo(60, 5);
    expect(shadowCameraConfig(RIDER_SCALE_BASE * 3, 45).lightDist).toBeCloseTo(180, 5);
  });

  it('太陽が低い (仰角 2°) ほど影が長く reach は上限 SHADOW_CAM_MAX (=18) に張り付く', () => {
    // 3 + 2.6/tan(2°) ≈ 77 だが上限 18 でクランプ。
    expect(shadowCameraConfig(RIDER_SCALE_BASE, 2).reach).toBeCloseTo(18, 5);
    expect(shadowCameraConfig(50, 2).reach).toBeCloseTo(18 * (50 / RIDER_SCALE_BASE), 4);
  });

  it('太陽が高い (仰角 80°) ほど影が短く reach は基本半幅 (=3) 寄りに縮む', () => {
    const r = shadowCameraConfig(RIDER_SCALE_BASE, 80).reach;
    expect(r).toBeGreaterThan(3);     // SHADOW_CAM_BASE より大きい
    expect(r).toBeLessThan(5.6);      // 仰角 45° の値より小さい
  });

  it('仰角が低いほど reach が大きい (= 影長に追従、 上限まで単調)', () => {
    expect(shadowCameraConfig(RIDER_SCALE_BASE, 20).reach)
      .toBeGreaterThan(shadowCameraConfig(RIDER_SCALE_BASE, 60).reach);
  });

  it('仰角 2° 以下は最低 2° にクランプ (= 地平線下や 0° でも reach は発散しない)', () => {
    const at2 = shadowCameraConfig(RIDER_SCALE_BASE, 2).reach;
    expect(shadowCameraConfig(RIDER_SCALE_BASE, 0).reach).toBeCloseTo(at2, 5);
    expect(shadowCameraConfig(RIDER_SCALE_BASE, -30).reach).toBeCloseTo(at2, 5);
  });

  it('仰角が非有限 (NaN / undefined) なら 2° 扱い', () => {
    const at2 = shadowCameraConfig(RIDER_SCALE_BASE, 2).reach;
    expect(shadowCameraConfig(RIDER_SCALE_BASE, NaN).reach).toBeCloseTo(at2, 5);
    expect(shadowCameraConfig(RIDER_SCALE_BASE, undefined).reach).toBeCloseTo(at2, 5);
  });

  it('riderScale が非有限 / 0 以下なら k=1 扱い (= 壊れた値で影を消さない)', () => {
    const base = shadowCameraConfig(RIDER_SCALE_BASE, 45);
    for (const bad of [0, -5, NaN, undefined, Infinity]) {
      const c = shadowCameraConfig(bad, 45);
      expect(c.reach).toBeCloseTo(base.reach, 5);
      expect(c.lightDist).toBeCloseTo(base.lightDist, 5);
    }
  });
});
