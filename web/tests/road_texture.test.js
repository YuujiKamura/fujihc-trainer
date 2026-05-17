// brief b11-Phase2: 道路テクスチャに焼く距離・勾配マークのデータ経路を pin する.
//
// 各 test は「落ちたら何のバグを捕まえたことになるか」を 1 行で言える形にする
// (= tautological / misleading test を作らない)。 canvas 描画 (DOM) は terrain3d.html
// 側で実画面目視に委ね、 ここでは純粋なデータ変換だけを検証する。

import { describe, it, expect } from 'vitest';
import {
  courseTotalDistance,
  slopeAtDistance,
  buildRoadMarks,
} from '../lib/road_texture.js';

// 距離・勾配を持つ単純なコース (= 線形補間・マーク列を実際に走らせる).
// distance_m は単調増加、 slope_pct は点ごとに変える.
const course = [
  { distance_m: 0,     slope_pct: 0 },
  { distance_m: 1000,  slope_pct: 4 },
  { distance_m: 2000,  slope_pct: 10 },
  { distance_m: 5000,  slope_pct: 6 },
];

// === courseTotalDistance ===

describe('courseTotalDistance', () => {
  it('最終点の distance_m を返す (= 総距離の取り違えを検出)', () => {
    expect(courseTotalDistance(course)).toBe(5000);
  });

  it('空 course は RangeError (= コース未ロードで沈黙破綻を防ぐ)', () => {
    expect(() => courseTotalDistance([])).toThrow(RangeError);
  });

  it('最終点の distance_m が非有限なら RangeError (= NaN 総距離が u 計算に漏れるのを防ぐ)', () => {
    expect(() => courseTotalDistance([{ distance_m: 0 }, { distance_m: NaN }]))
      .toThrow(RangeError);
  });
});

// === slopeAtDistance ===

describe('slopeAtDistance', () => {
  it('course 点ちょうどの距離 → その点の slope (= 補間が点で値をずらすのを検出)', () => {
    expect(slopeAtDistance(course, 0)).toBeCloseTo(0, 6);
    expect(slopeAtDistance(course, 1000)).toBeCloseTo(4, 6);
    expect(slopeAtDistance(course, 2000)).toBeCloseTo(10, 6);
    expect(slopeAtDistance(course, 5000)).toBeCloseTo(6, 6);
  });

  it('2 点間 → distance 比の線形補間値 (= 補間式の取り違えを検出)', () => {
    // 1000m(slope 4) と 2000m(slope 10) の中点 1500m → 7。
    expect(slopeAtDistance(course, 1500)).toBeCloseTo(7, 6);
    // 2000m(slope 10) と 5000m(slope 6) の 1/3 地点 3000m → 10 + (6-10)/3。
    expect(slopeAtDistance(course, 3000)).toBeCloseTo(10 + (6 - 10) / 3, 6);
  });

  it('始点前・終点後の距離は端の slope へ clamp (= 範囲外で NaN/外挿するのを防ぐ)', () => {
    expect(slopeAtDistance(course, -500)).toBeCloseTo(0, 6);
    expect(slopeAtDistance(course, 99999)).toBeCloseTo(6, 6);
  });

  it('slope_pct 欠損は 0 扱い (= NaN が背景色計算に漏れるのを防ぐ)', () => {
    const c = [{ distance_m: 0 }, { distance_m: 1000, slope_pct: null }];
    expect(slopeAtDistance(c, 500)).toBeCloseTo(0, 6);
  });

  it('空 course は RangeError', () => {
    expect(() => slopeAtDistance([], 100)).toThrow(RangeError);
  });
});

// === buildRoadMarks ===

describe('buildRoadMarks', () => {
  it('major 数 = floor(総距離/majorIntervalM) (= マークの数え違いを検出)', () => {
    const m = buildRoadMarks(course, { majorIntervalM: 1000, minorIntervalM: 100 });
    expect(m.totalDistanceM).toBe(5000);
    expect(m.major.length).toBe(5);          // 1000,2000,3000,4000,5000
    expect(m.minor.length).toBe(50);         // 100,200,...,5000
  });

  it('major マークの distance_m は interval の整数倍 (= マーク位置のズレを検出)', () => {
    const m = buildRoadMarks(course, { majorIntervalM: 1000 });
    expect(m.major.map((x) => x.distance_m)).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it('u は distance_m / 総距離 で [0,1] に収まる (= テクスチャ横座標のはみ出しを検出)', () => {
    const m = buildRoadMarks(course, { majorIntervalM: 1000, minorIntervalM: 100 });
    for (const mk of m.major) {
      expect(mk.u).toBeCloseTo(mk.distance_m / 5000, 9);
      expect(mk.u).toBeGreaterThan(0);
      expect(mk.u).toBeLessThanOrEqual(1);
    }
    for (const mk of m.minor) {
      expect(mk.u).toBeGreaterThan(0);
      expect(mk.u).toBeLessThanOrEqual(1);
    }
  });

  it('major マークの slope_pct は slopeAtDistance と一致 (= 偽値でない実勾配を焼くことを保証)', () => {
    const m = buildRoadMarks(course, { majorIntervalM: 1000 });
    for (const mk of m.major) {
      expect(mk.slope_pct).toBeCloseTo(slopeAtDistance(course, mk.distance_m), 9);
    }
    // 3000m マークは 2000m(10) と 5000m(6) の補間 = 偽の丸め値ではない。
    const mk3 = m.major.find((x) => x.distance_m === 3000);
    expect(mk3.slope_pct).toBeCloseTo(10 + (6 - 10) / 3, 6);
  });

  it('minor マークは数字を持たない = distance_m と u のみ (= major/minor の責務混同を検出)', () => {
    const m = buildRoadMarks(course, { minorIntervalM: 1000 });
    for (const mk of m.minor) {
      expect(Object.keys(mk).sort()).toEqual(['distance_m', 'u']);
    }
  });

  it('majorIntervalM が総距離超なら major は空配列 (= 短コースで沈黙破綻するのを防ぐ)', () => {
    const m = buildRoadMarks(course, { majorIntervalM: 99999 });
    expect(m.major).toEqual([]);
    expect(m.minor.length).toBeGreaterThan(0);  // minor は出る
  });

  it('interval 非正は RangeError (= 0 除算 / 無限ループを弾く)', () => {
    expect(() => buildRoadMarks(course, { majorIntervalM: 0 })).toThrow(RangeError);
    expect(() => buildRoadMarks(course, { minorIntervalM: -100 })).toThrow(RangeError);
  });

  it('空 course は RangeError (= courseTotalDistance 経由で弾く)', () => {
    expect(() => buildRoadMarks([], {})).toThrow(RangeError);
  });
});
