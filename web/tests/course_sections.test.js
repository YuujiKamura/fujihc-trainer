// brief 34 ε-8: course_sections.js の unit test.
//
// 観るモードの core lib (= 区間分割) を pure function として pin。
// 「単純 course (= 10 点 / 1km / 一定勾配 5%) で 10 区間が正しく切れる、 区間勾配が正しい」
// を核として、 degenerate ケース (= 空 course / 点数不足 / n<1) も covered.

import { describe, it, expect } from 'vitest';
import { splitCourseIntoSections, formatSectionLabel } from '../lib/course_sections.js';

// 単純 course: 11 点 / 1km 間隔 / 一定勾配 5% (= 50m/km 上昇).
// distance_m=[0, 1000, 2000, ... 10000], elevation_m=[100, 150, 200, ... 600].
function buildSimpleCourse() {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    out.push({
      distance_m: i * 1000,
      elevation_m: 100 + i * 50,  // 50m / 1km = 5% slope
      slope_pct: 5,
      lat: 35.0 + i * 0.001,
      lon: 138.7 + i * 0.001,
    });
  }
  return out;
}

describe('brief 34 ε-8: splitCourseIntoSections (= 観るモード core lib)', () => {
  it('単純 course (= 10 点 / 1km / 一定勾配 5%) を 10 区間に切る → 10 個返る', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    expect(sections.length).toBe(10);
  });

  it('各区間の index は 0..9 で連続 (= UI で 1 始まり表示するため 0 始まりで揃える)', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    for (let i = 0; i < 10; i++) {
      expect(sections[i].index).toBe(i);
    }
  });

  it('単純 course での区間平均勾配は 5% (= 一定勾配だから各区間も 5%)', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    for (const s of sections) {
      expect(s.avg_slope_pct).toBeCloseTo(5.0, 5);
    }
  });

  it('単純 course で区間 0 は distance 0-1000m を覆う (= 等分 1 区間 1km)', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    expect(sections[0].start_dist).toBeCloseTo(0, 5);
    expect(sections[0].end_dist).toBeCloseTo(1000, 5);
    expect(sections[0].start_idx).toBe(0);
    expect(sections[0].end_idx).toBe(1);  // distance 1000m の点
  });

  it('単純 course で最終区間 (= 9) は course の末尾 idx を含む', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    expect(sections[9].end_idx).toBe(course.length - 1);
    expect(sections[9].end_dist).toBeCloseTo(10000, 5);
  });

  it('区間境界 (= start_dist / end_dist) は隣接区間で連続する', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    for (let i = 1; i < sections.length; i++) {
      // 前区間 end_dist ≦ 当区間 start_dist (= 連続 or 同一)
      expect(sections[i].start_dist).toBeGreaterThanOrEqual(sections[i - 1].end_dist);
    }
  });

  it('n の default は 10 (= 富士ヒル 24km なら 1 区間 2.4km の想定)', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course);  // n 省略
    expect(sections.length).toBe(10);
  });

  it('上り下りが混在する course で正負勾配が出る (= 平均勾配の符号)', () => {
    // 4 点: 0->100m up, 100->50m down, 50->150m up (= 異なる勾配)
    const course = [
      { distance_m: 0, elevation_m: 0 },
      { distance_m: 1000, elevation_m: 100 },
      { distance_m: 2000, elevation_m: 50 },
      { distance_m: 3000, elevation_m: 150 },
    ];
    const sections = splitCourseIntoSections(course, 3);
    expect(sections.length).toBe(3);
    expect(sections[0].avg_slope_pct).toBeCloseTo(10.0, 3);  // +100m / 1000m
    expect(sections[1].avg_slope_pct).toBeCloseTo(-5.0, 3);  // -50m / 1000m
    expect(sections[2].avg_slope_pct).toBeCloseTo(10.0, 3);  // +100m / 1000m
  });

  it('start_idx / end_idx は course の範囲内 (= 0 <= idx < course.length)', () => {
    const course = buildSimpleCourse();
    const sections = splitCourseIntoSections(course, 10);
    for (const s of sections) {
      expect(s.start_idx).toBeGreaterThanOrEqual(0);
      expect(s.start_idx).toBeLessThan(course.length);
      expect(s.end_idx).toBeGreaterThanOrEqual(0);
      expect(s.end_idx).toBeLessThan(course.length);
      expect(s.end_idx).toBeGreaterThanOrEqual(s.start_idx);
    }
  });
});

describe('brief 34 ε-8: splitCourseIntoSections の degenerate cases', () => {
  it('空 course → 空配列', () => {
    expect(splitCourseIntoSections([], 10)).toEqual([]);
  });

  it('1 点 course → 空配列 (= 区間切れない)', () => {
    expect(splitCourseIntoSections([{ distance_m: 0, elevation_m: 0 }], 10)).toEqual([]);
  });

  it('非配列入力 → 空配列', () => {
    expect(splitCourseIntoSections(null, 10)).toEqual([]);
    expect(splitCourseIntoSections(undefined, 10)).toEqual([]);
    expect(splitCourseIntoSections('hello', 10)).toEqual([]);
  });

  it('n < 1 → 空配列', () => {
    const course = buildSimpleCourse();
    expect(splitCourseIntoSections(course, 0)).toEqual([]);
    expect(splitCourseIntoSections(course, -1)).toEqual([]);
  });

  it('n=NaN / Infinity → 空配列', () => {
    const course = buildSimpleCourse();
    expect(splitCourseIntoSections(course, NaN)).toEqual([]);
    expect(splitCourseIntoSections(course, Infinity)).toEqual([]);
  });

  it('total distance = 0 (= 全 point が同じ distance) → 空配列', () => {
    const course = [
      { distance_m: 0, elevation_m: 100 },
      { distance_m: 0, elevation_m: 100 },
    ];
    expect(splitCourseIntoSections(course, 10)).toEqual([]);
  });

  it('区間長 0 (= 同 idx 縮退) で avg_slope_pct = 0 (div-by-zero guard)', () => {
    // 3 点しか無い course を 10 等分すると、 多くの区間が同 point に縮退する.
    const course = [
      { distance_m: 0, elevation_m: 0 },
      { distance_m: 500, elevation_m: 25 },
      { distance_m: 1000, elevation_m: 50 },
    ];
    const sections = splitCourseIntoSections(course, 10);
    expect(sections.length).toBe(10);
    // 同 idx に縮退する区間が複数あるはず、 全 section に finite な勾配が入る (= NaN/Infinity 不在)
    for (const s of sections) {
      expect(Number.isFinite(s.avg_slope_pct)).toBe(true);
    }
  });
});

describe('brief 34 ε-8: 富士ヒル相当の課題シナリオ (= 約 24km / 1968 点 / 10 区間)', () => {
  it('24km course (= 富士ヒル相当) を 10 等分すると 1 区間 2.4km', () => {
    // 1968 点を 24km に均等配置 (= mock、 本物 course.json は不均等だが test には十分)
    const course = [];
    const N = 1968;
    const TOTAL = 24000;
    for (let i = 0; i < N; i++) {
      course.push({
        distance_m: (i / (N - 1)) * TOTAL,
        elevation_m: 1000 + (i / (N - 1)) * 1250,  // 1000->2250m linear
      });
    }
    const sections = splitCourseIntoSections(course, 10);
    expect(sections.length).toBe(10);
    // 各区間長は約 2400m に揃う (= 1 区間 2.4km)
    for (let i = 0; i < 9; i++) {
      const segLen = sections[i].end_dist - sections[i].start_dist;
      expect(segLen).toBeGreaterThan(2300);
      expect(segLen).toBeLessThan(2500);
    }
    // 平均勾配は約 +5.2% (= 1250m / 24000m)
    expect(sections[0].avg_slope_pct).toBeCloseTo(5.2, 0);
  });
});

describe('brief 34 ε-8: formatSectionLabel (= UI 表示文字列の整形)', () => {
  it('section を「区間 N: a.a-b.b km、 平均勾配 c.c%」形式で返す', () => {
    const s = {
      index: 0,
      start_dist: 0, end_dist: 2400,
      start_ele: 1061, end_ele: 1186,
      avg_slope_pct: 5.2,
      start_idx: 0, end_idx: 196,
    };
    expect(formatSectionLabel(s)).toBe('区間 1: 0.0-2.4 km、 平均勾配 5.2%');
  });

  it('section index は 1 始まり表示 (= 0 始まり配列で 1 始まり表示)', () => {
    const s = {
      index: 9, start_dist: 21600, end_dist: 24000,
      start_ele: 2178, end_ele: 2303,
      avg_slope_pct: 5.2,
      start_idx: 1800, end_idx: 1967,
    };
    expect(formatSectionLabel(s)).toBe('区間 10: 21.6-24.0 km、 平均勾配 5.2%');
  });

  it('null / undefined section → 空文字列 (= 防御 default)', () => {
    expect(formatSectionLabel(null)).toBe('');
    expect(formatSectionLabel(undefined)).toBe('');
  });

  it('負勾配 (= 下り) も正しく表示', () => {
    const s = {
      index: 0, start_dist: 0, end_dist: 1000,
      start_ele: 100, end_ele: 50,
      avg_slope_pct: -5.0,
      start_idx: 0, end_idx: 1,
    };
    expect(formatSectionLabel(s)).toBe('区間 1: 0.0-1.0 km、 平均勾配 -5.0%');
  });
});
