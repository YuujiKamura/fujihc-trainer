// b130: e2e/_helpers/paint_complete.js の hasNonEmptyPixel 純粋関数 unit.
// e2e helper の核 (= 非空 pixel 判定) を node 単体で pin、 同型バグの regression
// を block する.
import { describe, it, expect } from 'vitest';
import { hasNonEmptyPixel } from '../../e2e/_helpers/paint_complete.js';

describe('hasNonEmptyPixel: RGBA 並びの ImageData.data から非空 pixel を検出', () => {
  it('null / undefined / 空配列は false', () => {
    expect(hasNonEmptyPixel(null)).toBe(false);
    expect(hasNonEmptyPixel(undefined)).toBe(false);
    expect(hasNonEmptyPixel([])).toBe(false);
    expect(hasNonEmptyPixel([0, 0, 0])).toBe(false);
  });

  it('全 pixel が alpha=0 なら false (= 完全透明、 描画ゼロ)', () => {
    const data = new Uint8ClampedArray(16);  // 4 pixel 分、 全 0
    expect(hasNonEmptyPixel(data)).toBe(false);
  });

  it('1 pixel でも alpha>0 なら true', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 1, 0, 0, 0, 0]);
    expect(hasNonEmptyPixel(data)).toBe(true);
  });

  it('RGB に値があっても alpha=0 なら false (= 不可視、 描画されてない扱い)', () => {
    const data = new Uint8ClampedArray([255, 128, 64, 0, 100, 200, 50, 0]);
    expect(hasNonEmptyPixel(data)).toBe(false);
  });

  it('最後の pixel だけ alpha>0 でも true (= 最後まで scan)', () => {
    const data = new Uint8ClampedArray(16);
    data[15] = 255;
    expect(hasNonEmptyPixel(data)).toBe(true);
  });

  it('alpha=255 は当然 true', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    expect(hasNonEmptyPixel(data)).toBe(true);
  });
});
