import { describe, it, expect } from 'vitest';
import {
  gsiPixelToHeight,
  heightToTerrariumRGB,
  convertGsiPixelsToTerrariumPixels,
} from '../lib/terrarium.js';

describe('terrarium', () => {
  // === gsiPixelToHeight: 4 件 ===
  it('gsiPixelToHeight: 海面 (0,0,0) → 0m', () => {
    expect(gsiPixelToHeight(0, 0, 0)).toBe(0);
  });

  it('gsiPixelToHeight: 富士山頂 ≒ 3776m round-trip', () => {
    // 3776m → 377600 cm. encode: 377600 / 65536 = 5.76..., R=5, rest=49920 (= 377600-327680).
    // 49920 / 256 = 195.0, G=195, B=0.
    // 検算: 5*65536 + 195*256 + 0 = 327680 + 49920 = 377600 ✓ → 3776.0m
    expect(gsiPixelToHeight(5, 195, 0)).toBeCloseTo(3776.0, 6);
  });

  it('gsiPixelToHeight: 海面下 -200m', () => {
    // -200m → -20000 cm. 24-bit 符号付きで encode: 16777216 + (-20000) = 16757216
    // 16757216 → R*65536+G*256+B = 16757216 → R=255, rest=65440 → G=255, rest=160 → B=160
    // 検算: 255*65536 + 255*256 + 160 = 16711680 + 65280 + 160 = 16777120 (差 96)
    // ぴったり: 16757216 = 255*65536 + r → 65536 - r でズレ. 直接計算:
    // 16757216 / 65536 = 255.7..., つまり R=255, 残り = 16757216 - 16711680 = 45536
    // 45536 / 256 = 177.875, G=177, 残り = 45536 - 45312 = 224
    // 検算: 255*65536 + 177*256 + 224 = 16711680 + 45312 + 224 = 16757216 ✓
    expect(gsiPixelToHeight(255, 177, 224)).toBeCloseTo(-200.0, 6);
  });

  it('gsiPixelToHeight: 無効値 (128, 0, 0) → null', () => {
    expect(gsiPixelToHeight(128, 0, 0)).toBeNull();
  });

  // === heightToTerrariumRGB: 3 件 ===
  it('heightToTerrariumRGB: 0m → encode + 逆算で 0m に戻る', () => {
    const [r, g, b] = heightToTerrariumRGB(0);
    // terrarium 仕様: h = (R*256 + G + B/256) - 32768. 0m → (R*256 + G + B/256) = 32768.
    const decoded = (r * 256 + g + b / 256) - 32768;
    expect(decoded).toBeCloseTo(0, 6);
  });

  it('heightToTerrariumRGB: 3776m → encode + 逆算で 3776m に戻る (cm 精度)', () => {
    const [r, g, b] = heightToTerrariumRGB(3776);
    const decoded = (r * 256 + g + b / 256) - 32768;
    expect(decoded).toBeCloseTo(3776, 2);
  });

  it('heightToTerrariumRGB: 負値 -200m も clamp されずに encode', () => {
    const [r, g, b] = heightToTerrariumRGB(-200);
    const decoded = (r * 256 + g + b / 256) - 32768;
    expect(decoded).toBeCloseTo(-200, 2);
    // 上下端で clamp されてないこと
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
  });

  // === convertGsiPixelsToTerrariumPixels: 2 件 ===
  it('convertGsiPixelsToTerrariumPixels: 256x256 入力 → 同サイズ出力 + alpha=255', () => {
    const W = 256, H = 256;
    const src = new Uint8ClampedArray(W * H * 4);
    // 全ピクセル「海面 (0,0,0)」で埋める
    for (let i = 0; i < W * H; i++) {
      src[i * 4] = 0;
      src[i * 4 + 1] = 0;
      src[i * 4 + 2] = 0;
      src[i * 4 + 3] = 255;
    }
    const dst = convertGsiPixelsToTerrariumPixels(src);
    expect(dst).toBeInstanceOf(Uint8ClampedArray);
    expect(dst.length).toBe(W * H * 4);
    // 海面 0m を terrarium decode で逆算
    const r0 = dst[0], g0 = dst[1], b0 = dst[2], a0 = dst[3];
    const decoded = (r0 * 256 + g0 + b0 / 256) - 32768;
    expect(decoded).toBeCloseTo(0, 2);
    expect(a0).toBe(255);
  });

  it('convertGsiPixelsToTerrariumPixels: 無効ピクセル (128,0,0) は terrarium 0m として扱う + alpha=255', () => {
    const src = new Uint8ClampedArray(4);
    src[0] = 128; src[1] = 0; src[2] = 0; src[3] = 255;
    const dst = convertGsiPixelsToTerrariumPixels(src);
    expect(dst.length).toBe(4);
    const decoded = (dst[0] * 256 + dst[1] + dst[2] / 256) - 32768;
    expect(decoded).toBeCloseTo(0, 2);
    expect(dst[3]).toBe(255);
  });
});
