import { describe, it, expect } from 'vitest';
import { bilinearUpsample, gsiToTerrariumUpsampled } from '../lib/terrain_mesh.js';

// === helpers ===

function gsiEncode(height_m) {
  // GSI: h*100 を 24bit に詰める (負値は 2's complement)
  let raw = Math.round(height_m * 100);
  if (raw < 0) raw += 16777216;
  return [
    (raw >> 16) & 0xff,
    (raw >> 8) & 0xff,
    raw & 0xff,
  ];
}

function terrariumDecode(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

// === bilinearUpsample ===

describe('bilinearUpsample', () => {
  it('factor=1 は identity', () => {
    const src = new Uint8ClampedArray([
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
    ]);
    const { data, width, height } = bilinearUpsample(src, 2, 2, 1);
    expect(width).toBe(2);
    expect(height).toBe(2);
    expect(Array.from(data)).toEqual(Array.from(src));
  });

  it('factor=4 で出力サイズ 4 倍', () => {
    const src = new Uint8ClampedArray(2 * 2 * 4);
    const { width, height } = bilinearUpsample(src, 2, 2, 4);
    expect(width).toBe(8);
    expect(height).toBe(8);
  });

  it('factor=2 で中央 2x2 ピクセル群の平均が 4 隅の平均と一致', () => {
    // 2x2 の角に 4 色、 factor=2 で 4x4 dst (block-center sampling)
    const src = new Uint8ClampedArray([
      0, 0, 0, 255,         // (0,0) 黒
      100, 0, 0, 255,       // (1,0) 赤 100
      0, 100, 0, 255,       // (0,1) 緑 100
      100, 100, 0, 255,     // (1,1) 黄 100
    ]);
    const { data, width } = bilinearUpsample(src, 2, 2, 2);
    // 中央 4 ピクセル (dx=1..2, dy=1..2) の平均 R = (0+100+0+100)/4 = 50
    let sumR = 0, sumG = 0, sumB = 0;
    for (let dy = 1; dy <= 2; dy++) {
      for (let dx = 1; dx <= 2; dx++) {
        const di = (dy * width + dx) * 4;
        sumR += data[di];
        sumG += data[di + 1];
        sumB += data[di + 2];
      }
    }
    expect(sumR / 4).toBeCloseTo(50, 0);
    expect(sumG / 4).toBeCloseTo(50, 0);
    expect(sumB).toBe(0);
  });

  it('alpha は 255 固定 (= 入力に何が入っていても)', () => {
    const src = new Uint8ClampedArray([
      10, 20, 30, 0,  // alpha=0
      40, 50, 60, 0,
      70, 80, 90, 0,
      100, 110, 120, 0,
    ]);
    const { data } = bilinearUpsample(src, 2, 2, 2);
    // 全ピクセルの alpha が 255
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });
});

// === gsiToTerrariumUpsampled ===

describe('gsiToTerrariumUpsampled', () => {
  it('全 0m の GSI → 全 0m の terrarium (sanity)', () => {
    // GSI: (0, 0, 0) はそのまま h*100=0 で 0m
    const src = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      src[i * 4] = 0;
      src[i * 4 + 1] = 0;
      src[i * 4 + 2] = 0;
      src[i * 4 + 3] = 255;
    }
    const { data, width, height } = gsiToTerrariumUpsampled(src, 2, 2, 4);
    expect(width).toBe(8);
    expect(height).toBe(8);
    // 中央ピクセルが 0m に decode される (terrarium で encode(0+32768)*256 = 8388608 → (128, 0, 0))
    const di = (4 * width + 4) * 4;
    const decoded = terrariumDecode(data[di], data[di + 1], data[di + 2]);
    expect(decoded).toBeCloseTo(0, 0);
  });

  it('富士山頂 3776m の GSI → 3776m の terrarium', () => {
    // 2x2 全ピクセルを 3776m に
    const src = new Uint8ClampedArray(2 * 2 * 4);
    const [r, g, b] = gsiEncode(3776);
    for (let i = 0; i < 4; i++) {
      src[i * 4] = r;
      src[i * 4 + 1] = g;
      src[i * 4 + 2] = b;
      src[i * 4 + 3] = 255;
    }
    const { data, width } = gsiToTerrariumUpsampled(src, 2, 2, 4);
    const di = (4 * width + 4) * 4;
    const decoded = terrariumDecode(data[di], data[di + 1], data[di + 2]);
    expect(decoded).toBeCloseTo(3776, 0);
  });

  it('無効ピクセル (= R=128, G=B=0) は 0m として扱う', () => {
    const src = new Uint8ClampedArray([
      128, 0, 0, 255,
      128, 0, 0, 255,
      128, 0, 0, 255,
      128, 0, 0, 255,
    ]);
    const { data, width } = gsiToTerrariumUpsampled(src, 2, 2, 4);
    const di = (4 * width + 4) * 4;
    const decoded = terrariumDecode(data[di], data[di + 1], data[di + 2]);
    expect(decoded).toBeCloseTo(0, 0);
  });

  it('factor=4 で出力 1024x1024 (= 256x256 入力時)', () => {
    const src = new Uint8ClampedArray(256 * 256 * 4);
    // 全 0m
    const { width, height } = gsiToTerrariumUpsampled(src, 256, 256, 4);
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });

  it('factor=1 で出力 = 入力サイズ、 GSI → terrarium 単純変換', () => {
    // 4 隅に異なる高度
    const heights = [0, 100, 500, 1000];
    const src = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      const [r, g, b] = gsiEncode(heights[i]);
      src[i * 4] = r;
      src[i * 4 + 1] = g;
      src[i * 4 + 2] = b;
      src[i * 4 + 3] = 255;
    }
    const { data, width, height } = gsiToTerrariumUpsampled(src, 2, 2, 1);
    expect(width).toBe(2);
    expect(height).toBe(2);
    for (let i = 0; i < 4; i++) {
      const decoded = terrariumDecode(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      expect(decoded).toBeCloseTo(heights[i], 0);
    }
  });

  it('補間で中央 2x2 ピクセル群の平均高度 = 角の平均', () => {
    // 4 隅に 0m / 400m / 400m / 800m、 factor=4 で 8x8 dst
    // block-center sampling では中央 2 ピクセル群 (dy=3..4, dx=3..4) が 4 隅の補間値、
    // その平均が 4 隅の平均 = 400m に一致
    const heights = [0, 400, 400, 800];
    const src = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      const [r, g, b] = gsiEncode(heights[i]);
      src[i * 4] = r;
      src[i * 4 + 1] = g;
      src[i * 4 + 2] = b;
      src[i * 4 + 3] = 255;
    }
    const { data, width } = gsiToTerrariumUpsampled(src, 2, 2, 4);
    let sum = 0;
    for (let dy = 3; dy <= 4; dy++) {
      for (let dx = 3; dx <= 4; dx++) {
        const di = (dy * width + dx) * 4;
        sum += terrariumDecode(data[di], data[di + 1], data[di + 2]);
      }
    }
    // 中央 4 ピクセルの平均 = (0+400+400+800)/4 = 400
    expect(sum / 4).toBeCloseTo(400, 0);
  });

  it('全 alpha 出力が 255 (= terrarium 表示で透明扱い無し)', () => {
    const src = new Uint8ClampedArray(2 * 2 * 4);
    const { data } = gsiToTerrariumUpsampled(src, 2, 2, 2);
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });
});
