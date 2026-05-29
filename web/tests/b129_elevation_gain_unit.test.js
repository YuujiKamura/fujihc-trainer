import { describe, it, expect } from 'vitest';
import { calcElevationGainM } from '../lib/save_summary.js';

describe('calcElevationGainM: trkpts の ele 差分から獲得標高 (m) を出す', () => {
  it('trkpts が空なら 0', () => {
    expect(calcElevationGainM([])).toBe(0);
  });

  it('trkpts が 1 点だけなら 0', () => {
    expect(calcElevationGainM([{ ele: 100 }])).toBe(0);
  });

  it('null / undefined 入力は 0', () => {
    expect(calcElevationGainM(null)).toBe(0);
    expect(calcElevationGainM(undefined)).toBe(0);
  });

  it('連続上り (0→10→20→30) は 30 m', () => {
    const trkpts = [0, 10, 20, 30].map((ele) => ({ ele }));
    expect(calcElevationGainM(trkpts)).toBe(30);
  });

  it('連続下り (30→20→10→0) は 0 m', () => {
    const trkpts = [30, 20, 10, 0].map((ele) => ({ ele }));
    expect(calcElevationGainM(trkpts)).toBe(0);
  });

  it('上り下り混合 (0→10→5→15→10) は 上りの累積 20 m', () => {
    const trkpts = [0, 10, 5, 15, 10].map((ele) => ({ ele }));
    expect(calcElevationGainM(trkpts)).toBe(20);
  });

  it('threshold (default 0.5m) 未満の jitter は noise として無視 (0→0.3→0.3→0.3)', () => {
    const trkpts = [0, 0.3, 0.3, 0.3].map((ele) => ({ ele }));
    expect(calcElevationGainM(trkpts)).toBe(0);
  });

  it('NaN ele 点は skip して連続性を保つ (0→NaN→10 で gain=10)', () => {
    const trkpts = [{ ele: 0 }, { ele: NaN }, { ele: 10 }];
    expect(calcElevationGainM(trkpts)).toBe(10);
  });

  it('ele が undefined / 文字列の点も skip される', () => {
    const trkpts = [{ ele: 0 }, { ele: undefined }, { ele: 'x' }, { ele: 10 }];
    expect(calcElevationGainM(trkpts)).toBe(10);
  });

  it('threshold opt 上書きで 1.0m 未満の上りも noise 扱いになる', () => {
    const trkpts = [{ ele: 0 }, { ele: 0.6 }, { ele: 1.2 }];
    expect(calcElevationGainM(trkpts)).toBe(1);
    expect(calcElevationGainM(trkpts, { threshold: 1.0 })).toBe(0);
  });

  it('富士ヒル風 (= 25 km で 1200m 線形上り、 250 点) で約 1200 m', () => {
    const N = 250;
    const trkpts = [];
    for (let i = 0; i <= N; i++) {
      trkpts.push({ ele: i * (1200 / N) });
    }
    const gain = calcElevationGainM(trkpts);
    expect(gain).toBeGreaterThanOrEqual(1199);
    expect(gain).toBeLessThanOrEqual(1201);
  });
});
