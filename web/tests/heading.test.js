import { describe, it, expect } from 'vitest';
import { computeTravelHeading, clampIndex } from '../lib/heading.js';

// 富士ヒル域 (lat≒35) で 0.001 度ずつ動かして方位を作る.
// 緯度方向 0.001° ≒ 111 m, 経度方向 0.001° ≒ 91 m (cos(35°)≒0.819).

describe('heading', () => {
  it('北向き直線: lat 増加方向 → heading ≒ 0°', () => {
    const course = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.401, lon: 138.7 },
      { lat: 35.402, lon: 138.7 },
      { lat: 35.403, lon: 138.7 },
      { lat: 35.404, lon: 138.7 },
      { lat: 35.405, lon: 138.7 },
    ];
    const h = computeTravelHeading(course, 0, 5);
    expect(h).toBeCloseTo(0, 1);
  });

  it('東向き直線: lon 増加方向 → heading ≒ 90°', () => {
    const course = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.4, lon: 138.701 },
      { lat: 35.4, lon: 138.702 },
      { lat: 35.4, lon: 138.703 },
      { lat: 35.4, lon: 138.704 },
      { lat: 35.4, lon: 138.705 },
    ];
    const h = computeTravelHeading(course, 0, 5);
    expect(h).toBeCloseTo(90, 1);
  });

  it('南向き直線: lat 減少方向 → heading ≒ 180°', () => {
    const course = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.399, lon: 138.7 },
      { lat: 35.398, lon: 138.7 },
      { lat: 35.397, lon: 138.7 },
      { lat: 35.396, lon: 138.7 },
      { lat: 35.395, lon: 138.7 },
    ];
    const h = computeTravelHeading(course, 0, 5);
    expect(h).toBeCloseTo(180, 1);
  });

  it('西向き直線: lon 減少方向 → heading ≒ 270°', () => {
    const course = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.4, lon: 138.699 },
      { lat: 35.4, lon: 138.698 },
      { lat: 35.4, lon: 138.697 },
      { lat: 35.4, lon: 138.696 },
      { lat: 35.4, lon: 138.695 },
    ];
    const h = computeTravelHeading(course, 0, 5);
    expect(h).toBeCloseTo(270, 1);
  });

  it('lookAhead が course 長を超えるときに clamp (= 最終点で停止しても heading 確定)', () => {
    const course = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.401, lon: 138.7 },
    ];
    // idx=1 から lookAhead=5 → clamp で idx=1 の同点参照になる → 1 つ前にずらして方位確定
    const h = computeTravelHeading(course, 1, 5);
    expect(h).toBeCloseTo(0, 1);
    // clampIndex 単独の挙動も検証
    expect(clampIndex(10, 2)).toBe(1);
    expect(clampIndex(-3, 2)).toBe(0);
    expect(clampIndex(0, 0)).toBe(0);
  });
});
