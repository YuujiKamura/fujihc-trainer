// brief 23: web/lib/gpx_smooth.js のユニットテスト + cross-language 同値性 pin.
//
// 全関数 mandate で movingAverage / smoothCourse を網羅、
// Python 側 fixture (web/tests/fixtures/py_gpx_smooth.json) と
// 浮動小数点誤差 < 1e-9 (toBeCloseTo digits=9) で一致を担保する.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { movingAverage, smoothCourse } from '../lib/gpx_smooth.js';

import { COURSE_PATH } from './_fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'py_gpx_smooth.json');

describe('movingAverage', () => {
  it('window=3 で [1,2,3,4,5] → [1.5, 2, 3, 4, 4.5] (端は縮む)', () => {
    const out = movingAverage([1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(5);
    expect(out[0]).toBeCloseTo(1.5, 9);
    expect(out[1]).toBeCloseTo(2.0, 9);
    expect(out[2]).toBeCloseTo(3.0, 9);
    expect(out[3]).toBeCloseTo(4.0, 9);
    expect(out[4]).toBeCloseTo(4.5, 9);
  });

  it('window=1 は identity (値そのまま、 別配列)', () => {
    const values = [1.0, 2.5, -3.0, 4.0];
    const out = movingAverage(values, 1);
    expect(out).toEqual(values);
    expect(out).not.toBe(values);
  });

  it('window >= length で全要素が全体平均と等しい', () => {
    const values = [1, 2, 3, 4, 5];
    const out = movingAverage(values, 6); // length + 1
    const mean = 3.0;
    for (const v of out) expect(v).toBeCloseTo(mean, 9);
    expect(out).toHaveLength(5);
  });

  it('空入力は空出力', () => {
    expect(movingAverage([], 11)).toEqual([]);
  });

  it('不正 window で RangeError', () => {
    expect(() => movingAverage([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => movingAverage([1, 2, 3], -1)).toThrow(RangeError);
    expect(() => movingAverage([1, 2, 3], 1.5)).toThrow(RangeError);
  });
});

describe('smoothCourse', () => {
  // 富士ヒル実 course を fixture として使う (= 1968 点).
  const fujiCourse = JSON.parse(readFileSync(COURSE_PATH, 'utf-8'));

  it('window=1 は identity (= 値そのまま、 別 object)', () => {
    const head = fujiCourse.slice(0, 50);
    const out = smoothCourse(head, 1);
    expect(out).toHaveLength(50);
    for (let i = 0; i < head.length; i++) {
      expect(out[i]).toEqual(head[i]);
      expect(out[i]).not.toBe(head[i]);
    }
  });

  it('distance_m / slope_pct / elevation_m は smoothing 前後で完全不変 (default window)', () => {
    const out = smoothCourse(fujiCourse);  // default window=5
    expect(out).toHaveLength(fujiCourse.length);
    for (let i = 0; i < fujiCourse.length; i++) {
      expect(out[i].distance_m).toBe(fujiCourse[i].distance_m);
      expect(out[i].slope_pct).toBe(fujiCourse[i].slope_pct);
      expect(out[i].elevation_m).toBe(fujiCourse[i].elevation_m);
    }
  });

  it('lat/lon は変わるが原データから大きく離れない (default window=5、 < 0.001°)', () => {
    const out = smoothCourse(fujiCourse);  // default window=5
    let maxDLat = 0;
    let maxDLon = 0;
    let anyDiff = false;
    for (let i = 0; i < fujiCourse.length; i++) {
      const dlat = Math.abs(out[i].lat - fujiCourse[i].lat);
      const dlon = Math.abs(out[i].lon - fujiCourse[i].lon);
      if (dlat > 0 || dlon > 0) anyDiff = true;
      if (dlat > maxDLat) maxDLat = dlat;
      if (dlon > maxDLon) maxDLon = dlon;
    }
    expect(anyDiff).toBe(true);
    // window=5 のジッター補正は実測 max_dlat ~0.00046 / max_dlon ~0.00066.
    expect(maxDLat).toBeLessThan(0.001);
    expect(maxDLon).toBeLessThan(0.001);
  });

  it('default window=5 で course 全長変化が < 1% (= ジグザグ補正レベル)', () => {
    const totalLength = (c) => {
      let total = 0;
      for (let i = 1; i < c.length; i++) {
        const dlat = (c[i].lat - c[i - 1].lat) * 111000;
        const dlon = (c[i].lon - c[i - 1].lon) * 111000 * Math.cos(35.4 * Math.PI / 180);
        total += Math.hypot(dlat, dlon);
      }
      return total;
    };
    const origLen = totalLength(fujiCourse);
    const smoothedLen = totalLength(smoothCourse(fujiCourse));  // default window=5
    const ratio = Math.abs(smoothedLen - origLen) / origLen;
    // 実測 ~0.62%、 1% 未満で「道路カーブを潰していない」と言える.
    expect(ratio).toBeLessThan(0.01);
  });

  it('window=11 は default (5) より course 全長を大きく削る (= 大 window は道路カーブも消える挙動の確認)', () => {
    const totalLength = (c) => {
      let total = 0;
      for (let i = 1; i < c.length; i++) {
        const dlat = (c[i].lat - c[i - 1].lat) * 111000;
        const dlon = (c[i].lon - c[i - 1].lon) * 111000 * Math.cos(35.4 * Math.PI / 180);
        total += Math.hypot(dlat, dlon);
      }
      return total;
    };
    const origLen = totalLength(fujiCourse);
    const smW5 = totalLength(smoothCourse(fujiCourse, 5));
    const smW11 = totalLength(smoothCourse(fujiCourse, 11));
    const ratioW5 = Math.abs(smW5 - origLen) / origLen;
    const ratioW11 = Math.abs(smW11 - origLen) / origLen;
    expect(ratioW11).toBeGreaterThan(ratioW5);
    // ただし全体が完全直線化するほどではない (< 3%).
    expect(ratioW11).toBeLessThan(0.03);
  });

  it('空 course は空 list', () => {
    expect(smoothCourse([], 11)).toEqual([]);
  });

  it('不正 window で RangeError', () => {
    expect(() => smoothCourse([{ lat: 0, lon: 0 }], 0)).toThrow(RangeError);
    expect(() => smoothCourse([{ lat: 0, lon: 0 }], -3)).toThrow(RangeError);
  });

  it('options.smoothFields で elevation_m を指定 → lat/lon は不変', () => {
    const head = fujiCourse.slice(0, 50);
    const out = smoothCourse(head, 5, { smoothFields: ['elevation_m'] });
    for (let i = 0; i < head.length; i++) {
      expect(out[i].lat).toBe(head[i].lat);
      expect(out[i].lon).toBe(head[i].lon);
    }
    const diffs = head.map((p, i) => Math.abs(out[i].elevation_m - p.elevation_m));
    expect(Math.max(...diffs)).toBeGreaterThan(0);
  });
});

describe('cross-language equivalence (Python ↔ JS)', () => {
  // Python 側 test (tests/test_gpx_smooth.py::test_dump_gpx_smooth_fixture_for_js)
  // が出力する fixture を読み、 同 input で JS が同 output を出すことを確認.
  // 浮動小数点誤差 < 1e-9 で吸収.
  const fixtureExists = existsSync(FIXTURE_PATH);

  it.skipIf(!fixtureExists)('movingAverage: window=3 が Python と一致', () => {
    const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const js = movingAverage(fx.simple_input, 3);
    expect(js).toHaveLength(fx.simple_window3.length);
    for (let i = 0; i < js.length; i++) {
      expect(js[i]).toBeCloseTo(fx.simple_window3[i], 9);
    }
  });

  it.skipIf(!fixtureExists)('movingAverage: window=1 / window>length が Python と一致', () => {
    const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const js1 = movingAverage(fx.simple_input, 1);
    const js6 = movingAverage(fx.simple_input, 6);
    for (let i = 0; i < js1.length; i++) {
      expect(js1[i]).toBeCloseTo(fx.simple_window1[i], 9);
      expect(js6[i]).toBeCloseTo(fx.simple_window6[i], 9);
    }
  });

  it.skipIf(!fixtureExists)('smoothCourse: 富士ヒル course 先頭 100 点 default window=5 が Python と一致', () => {
    const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    // default 引数 (= window 省略) で Python の window=5 出力と一致するか.
    const js = smoothCourse(fx.course_input);
    expect(js).toHaveLength(fx.course_smoothed_window5.length);
    for (let i = 0; i < js.length; i++) {
      expect(js[i].lat).toBeCloseTo(fx.course_smoothed_window5[i].lat, 9);
      expect(js[i].lon).toBeCloseTo(fx.course_smoothed_window5[i].lon, 9);
      expect(js[i].distance_m).toBe(fx.course_smoothed_window5[i].distance_m);
      expect(js[i].slope_pct).toBe(fx.course_smoothed_window5[i].slope_pct);
      expect(js[i].elevation_m).toBe(fx.course_smoothed_window5[i].elevation_m);
    }
  });

  it.skipIf(!fixtureExists)('smoothCourse: 富士ヒル course 先頭 100 点 window=11 (= 調査用) が Python と一致', () => {
    const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));
    const js = smoothCourse(fx.course_input, 11);
    expect(js).toHaveLength(fx.course_smoothed_window11.length);
    for (let i = 0; i < js.length; i++) {
      expect(js[i].lat).toBeCloseTo(fx.course_smoothed_window11[i].lat, 9);
      expect(js[i].lon).toBeCloseTo(fx.course_smoothed_window11[i].lon, 9);
      expect(js[i].distance_m).toBe(fx.course_smoothed_window11[i].distance_m);
      expect(js[i].slope_pct).toBe(fx.course_smoothed_window11[i].slope_pct);
      expect(js[i].elevation_m).toBe(fx.course_smoothed_window11[i].elevation_m);
    }
  });
});
