import { describe, it, expect } from 'vitest';
import {
  GRADE_THRESHOLDS,
  classifyGrade,
  gradeColorContinuous,
  buildGradeColoredRoute,
  makeGradeColorExpression,
} from '../lib/route_styling.js';

// brief 24: Zwift Climb Portal 風の勾配グレード別色分け.
// 富士ヒル course (= 平均 5.2%、 区間最大 ~9%) を 6 段階に分類して
// MapLibre paint expression に渡せる substrate のテスト.

describe('GRADE_THRESHOLDS', () => {
  it('6 段階の grade が定義されている', () => {
    expect(GRADE_THRESHOLDS).toHaveLength(6);
    const names = GRADE_THRESHOLDS.map((g) => g.name);
    expect(names).toEqual([
      'flat',
      'gentle',
      'moderate',
      'hard',
      'very_hard',
      'extreme',
    ]);
  });

  it('各 grade に hex color が設定されている', () => {
    for (const g of GRADE_THRESHOLDS) {
      expect(g.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('classifyGrade — happy path', () => {
  it('0% → flat (緑)', () => {
    const r = classifyGrade(0);
    expect(r.name).toBe('flat');
    expect(r.color).toBe('#3aa055');
  });

  it('2% → gentle (黄緑)', () => {
    const r = classifyGrade(2);
    expect(r.name).toBe('gentle');
    expect(r.color).toBe('#a3c853');
  });

  it('5% → moderate (黄、 富士ヒル平均勾配 5.2% 帯)', () => {
    const r = classifyGrade(5);
    expect(r.name).toBe('moderate');
    expect(r.color).toBe('#f4d03f');
  });

  it('8% → hard (橙、 富士ヒル区間最大級)', () => {
    const r = classifyGrade(8);
    expect(r.name).toBe('hard');
    expect(r.color).toBe('#e67e22');
  });

  it('12% → very_hard (赤)', () => {
    const r = classifyGrade(12);
    expect(r.name).toBe('very_hard');
    expect(r.color).toBe('#e74c3c');
  });

  it('20% → extreme (紫)', () => {
    const r = classifyGrade(20);
    expect(r.name).toBe('extreme');
    expect(r.color).toBe('#8e44ad');
  });
});

describe('classifyGrade — 境界値 (min inclusive / max exclusive)', () => {
  it('1.0% → gentle (= flat の max は exclusive)', () => {
    expect(classifyGrade(1).name).toBe('gentle');
  });

  it('0.999% → flat (= 1 直前)', () => {
    expect(classifyGrade(0.999).name).toBe('flat');
  });

  it('4.0% → moderate (= gentle の max は exclusive)', () => {
    expect(classifyGrade(4).name).toBe('moderate');
  });

  it('7.0% → hard', () => {
    expect(classifyGrade(7).name).toBe('hard');
  });

  it('10.0% → very_hard', () => {
    expect(classifyGrade(10).name).toBe('very_hard');
  });

  it('15.0% → extreme', () => {
    expect(classifyGrade(15).name).toBe('extreme');
  });
});

describe('classifyGrade — 異常値 / 防御', () => {
  it('負値 -2% → flat (下り、 安全側 default)', () => {
    expect(classifyGrade(-2).name).toBe('flat');
  });

  it('null → flat (default)', () => {
    expect(classifyGrade(null).name).toBe('flat');
  });

  it('undefined → flat (default)', () => {
    expect(classifyGrade(undefined).name).toBe('flat');
  });

  it('NaN → flat (default)', () => {
    expect(classifyGrade(NaN).name).toBe('flat');
  });
});

describe('buildGradeColoredRoute', () => {
  // 富士ヒル風 mini course (= 5 点、 4 segment).
  const miniCourse = [
    { lat: 35.40, lon: 138.70, slope_pct: 0.5, distance_m: 0 },
    { lat: 35.41, lon: 138.71, slope_pct: 2.5, distance_m: 100 },
    { lat: 35.42, lon: 138.72, slope_pct: 5.5, distance_m: 200 },
    { lat: 35.43, lon: 138.73, slope_pct: 8.0, distance_m: 300 },
    { lat: 35.44, lon: 138.74, slope_pct: 12.0, distance_m: 400 },
  ];

  it('FeatureCollection を返す', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    expect(fc.type).toBe('FeatureCollection');
    expect(Array.isArray(fc.features)).toBe(true);
  });

  it('segment 数 = course.length - 1', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    expect(fc.features).toHaveLength(miniCourse.length - 1);
  });

  it('各 feature.geometry は LineString で coordinates が [start, end]', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    const f0 = fc.features[0];
    expect(f0.geometry.type).toBe('LineString');
    expect(f0.geometry.coordinates).toEqual([
      [138.70, 35.40],
      [138.71, 35.41],
    ]);
  });

  it('各 feature.properties に slope_pct / grade / color が含まれる', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    for (const f of fc.features) {
      expect(f.properties).toHaveProperty('slope_pct');
      expect(f.properties).toHaveProperty('grade');
      expect(f.properties).toHaveProperty('color');
      expect(typeof f.properties.color).toBe('string');
      expect(f.properties.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('「次区間の勾配」semantics: segment[0] は course[1].slope_pct を採用', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    // segment 0: course[0] -> course[1], slope = course[1].slope_pct = 2.5 → gentle.
    expect(fc.features[0].properties.slope_pct).toBe(2.5);
    expect(fc.features[0].properties.grade).toBe('gentle');
    // segment 3: course[3] -> course[4], slope = course[4].slope_pct = 12.0 → very_hard.
    expect(fc.features[3].properties.slope_pct).toBe(12.0);
    expect(fc.features[3].properties.grade).toBe('very_hard');
  });

  it('distance_m_start / distance_m_end が properties に入る', () => {
    const fc = buildGradeColoredRoute(miniCourse);
    expect(fc.features[0].properties.distance_m_start).toBe(0);
    expect(fc.features[0].properties.distance_m_end).toBe(100);
    expect(fc.features[3].properties.distance_m_start).toBe(300);
    expect(fc.features[3].properties.distance_m_end).toBe(400);
  });

  it('course が空 / 1 点 → 空 FeatureCollection', () => {
    expect(buildGradeColoredRoute([]).features).toHaveLength(0);
    expect(buildGradeColoredRoute([{ lat: 35.4, lon: 138.7 }]).features).toHaveLength(0);
  });

  it('slope_pct が欠落した course も flat にフォールバックする (= 落ちない)', () => {
    const bad = [
      { lat: 35.4, lon: 138.7 },
      { lat: 35.41, lon: 138.71 },
    ];
    const fc = buildGradeColoredRoute(bad);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.grade).toBe('flat');
  });
});

describe('makeGradeColorExpression', () => {
  it('MapLibre case expression 形式 (= 配列、 先頭 "case")', () => {
    const expr = makeGradeColorExpression();
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('case');
  });

  it('全 grade に対応する分岐を含む + default 末尾', () => {
    const expr = makeGradeColorExpression();
    // 'case' + (condition, color) * 6 + default = 1 + 12 + 1 = 14.
    expect(expr).toHaveLength(1 + GRADE_THRESHOLDS.length * 2 + 1);
    // 末尾は flat 緑 (default fallback).
    expect(expr[expr.length - 1]).toBe('#3aa055');
  });

  it('各 grade の条件は ["==", ["get", "grade"], name] 形式', () => {
    const expr = makeGradeColorExpression();
    for (let i = 0; i < GRADE_THRESHOLDS.length; i++) {
      const cond = expr[1 + i * 2];
      const color = expr[1 + i * 2 + 1];
      expect(cond[0]).toBe('==');
      expect(cond[1]).toEqual(['get', 'grade']);
      expect(cond[2]).toBe(GRADE_THRESHOLDS[i].name);
      expect(color).toBe(GRADE_THRESHOLDS[i].color);
    }
  });
});

// 2026-05-17: 勾配色を 6 段階離散 bin から連続 RGB 補間に。 user 指示
// 「路面の勾配毎の色をもっと滑らかに細かく」 への対応。
describe('gradeColorContinuous (連続グレード色)', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  it('平地 (0%) は緑 #3aa055', () => {
    expect(gradeColorContinuous(0)).toBe('#3aa055');
  });

  it('null / undefined / NaN は緑 (= 安全側 default)', () => {
    expect(gradeColorContinuous(null)).toBe('#3aa055');
    expect(gradeColorContinuous(undefined)).toBe('#3aa055');
    expect(gradeColorContinuous(NaN)).toBe('#3aa055');
  });

  it('下り (負値) は緑にクランプ', () => {
    expect(gradeColorContinuous(-5)).toBe('#3aa055');
  });

  it('激坂 (17% 以上) は紫 #8e44ad にクランプ', () => {
    expect(gradeColorContinuous(17)).toBe('#8e44ad');
    expect(gradeColorContinuous(25)).toBe('#8e44ad');
  });

  it('hex 形式 (#rrggbb) を返す', () => {
    expect(gradeColorContinuous(6)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('bin 境界で色がガクッと変わらない (= 3.9% と 4.1% が近い)', () => {
    const a = rgb(gradeColorContinuous(3.9));
    const b = rgb(gradeColorContinuous(4.1));
    const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist).toBeLessThan(20);  // 連続補間なら僅差、 離散 bin なら大ジャンプ
  });

  it('急勾配ほど緑成分が減る (= 暖色化、 単調性)', () => {
    expect(rgb(gradeColorContinuous(2))[1]).toBeGreaterThan(rgb(gradeColorContinuous(10))[1]);
    expect(rgb(gradeColorContinuous(10))[1]).toBeGreaterThan(rgb(gradeColorContinuous(16))[1]);
  });
});
