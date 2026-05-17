// 2026-05-15 user 「下りで足を止めた時、 減速がデカすぎる。 普通は加速する局面でもリニアに止まる」
// bike_physics.applyPhysicsStep が物理的に妥当な挙動 (= 下りで power=0 でも加速、 登りで減速、
// 平地で速度依存 drag) を取ることを pin する。
import { describe, it, expect } from 'vitest';
import { applyPhysicsStep, integratePhysics, PHYSICS_DEFAULTS } from '../lib/bike_physics.js';

describe('bike_physics.applyPhysicsStep', () => {
  it('平地 + power 一定: v が収束値に向かう', () => {
    let v = 5; // m/s
    const dt = 0.1;
    for (let i = 0; i < 600; i++) {  // 60 秒分
      v = applyPhysicsStep(v, dt, 200, 0);
    }
    // 平地 200W は概ね 8〜10 m/s (= 30〜36 km/h) で収束、 ハードコード値ではなく range で pin
    expect(v).toBeGreaterThan(7);
    expect(v).toBeLessThan(12);
  });

  it('下り 5% + power=0: v が加速する (= 重力加速、 user 指摘の対象)', () => {
    let v = 5; // 既に 5 m/s で巡航中
    const dt = 0.1;
    const v0 = v;
    for (let i = 0; i < 50; i++) {  // 5 秒、 下り
      v = applyPhysicsStep(v, dt, 0, -5);
    }
    expect(v).toBeGreaterThan(v0);  // 加速したことを pin
  });

  it('下り 8% + power=0: 平地時より遥かに減速が小さい (= 「リニアに止まる」 を防ぐ)', () => {
    let v_flat = 8;
    let v_down = 8;
    const dt = 0.1;
    for (let i = 0; i < 30; i++) {  // 3 秒
      v_flat = applyPhysicsStep(v_flat, dt, 0, 0);
      v_down = applyPhysicsStep(v_down, dt, 0, -8);
    }
    expect(v_down).toBeGreaterThan(v_flat);  // 下りの方が当然速い
    expect(v_down).toBeGreaterThanOrEqual(8);  // 下り 8% なら加速 or 維持、 減速しない
  });

  it('登り 8% + power=0: 急減速', () => {
    let v = 5;
    const dt = 0.1;
    for (let i = 0; i < 30; i++) {  // 3 秒
      v = applyPhysicsStep(v, dt, 0, 8);
    }
    expect(v).toBeLessThan(3);  // 5 m/s → 3 m/s 未満まで落ちる
  });

  it('登り 10% + power=400W: ほぼ維持 (= 力が釣り合う領域)', () => {
    let v = 4;
    const dt = 0.1;
    for (let i = 0; i < 200; i++) {  // 20 秒
      v = applyPhysicsStep(v, dt, 400, 10);
    }
    expect(v).toBeGreaterThan(2);
    expect(v).toBeLessThan(7);
  });

  it('max_v cap: 下り急勾配の暴走を止める', () => {
    let v = 10;
    const dt = 0.1;
    for (let i = 0; i < 6000; i++) {  // 10 分下りっぱなし
      v = applyPhysicsStep(v, dt, 0, -20);
    }
    expect(v).toBeLessThanOrEqual(PHYSICS_DEFAULTS.max_v);
  });

  it('v=0 + power=0 + 平地: 静止維持 (= NaN や負値にならない)', () => {
    let v = 0;
    const dt = 0.1;
    for (let i = 0; i < 30; i++) {
      v = applyPhysicsStep(v, dt, 0, 0);
    }
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.5);  // v_min 以下に下がってる (= 静止寄り)
  });

  it('v=0 + power=300W + 平地: 発進できる (= v が増える)', () => {
    let v = 0;
    const dt = 0.1;
    for (let i = 0; i < 50; i++) {  // 5 秒
      v = applyPhysicsStep(v, dt, 300, 0);
    }
    expect(v).toBeGreaterThan(2);
  });

  it('dt <= 0: no-op (= v 不変)', () => {
    expect(applyPhysicsStep(5, 0, 200, 0)).toBe(5);
    expect(applyPhysicsStep(5, -1, 200, 0)).toBe(5);
  });

  it('opts override が反映される (= 体重 60kg は 88kg より速い)', () => {
    let v_heavy = 5, v_light = 5;
    const dt = 0.1;
    for (let i = 0; i < 100; i++) {
      v_heavy = applyPhysicsStep(v_heavy, dt, 200, 5);  // 登り 5% 88kg
      v_light = applyPhysicsStep(v_light, dt, 200, 5, { mass: 60 });  // 60kg
    }
    expect(v_light).toBeGreaterThan(v_heavy);  // 軽量 rider の方が登りで速い
  });

  it('slope_pct = NaN / undefined: 平地扱い', () => {
    const v1 = applyPhysicsStep(5, 0.1, 200, NaN);
    const v2 = applyPhysicsStep(5, 0.1, 200, undefined);
    const v3 = applyPhysicsStep(5, 0.1, 200, 0);
    expect(Number.isFinite(v1)).toBe(true);
    expect(Number.isFinite(v2)).toBe(true);
    expect(v1).toBeCloseTo(v3, 5);
    expect(v2).toBeCloseTo(v3, 5);
  });

  it('inertia 未指定 / 0: 従来挙動と一致 (= 既存 caller を壊さない)', () => {
    const a = applyPhysicsStep(5, 0.1, 200, 3);
    const b = applyPhysicsStep(5, 0.1, 200, 3, { inertia: 0 });
    expect(a).toBe(b);
  });

  it('inertia 大: 漕ぎ出しが重い (= 同 power でも加速が鈍る)', () => {
    let v_none = 0, v_fly = 0;
    const dt = 0.1;
    for (let i = 0; i < 50; i++) {  // 5 秒、 平地発進
      v_none = applyPhysicsStep(v_none, dt, 300, 0);
      v_fly = applyPhysicsStep(v_fly, dt, 300, 0, { inertia: 300 });
    }
    expect(v_fly).toBeLessThan(v_none);  // フライホイールぶん加速が鈍い
  });

  it('inertia 大: 足を止めても長く転がる (= コースト距離が伸びる)', () => {
    // 8 m/s から平地で power=0、 止まる (v<0.3) までの走行距離を比較
    const coastDist = (inertia) => {
      let v = 8, dist = 0;
      const dt = 0.1;
      for (let i = 0; i < 3000 && v > 0.3; i++) {
        v = applyPhysicsStep(v, dt, 0, 0, { inertia });
        dist += v * dt;
      }
      return dist;
    };
    expect(coastDist(300)).toBeGreaterThan(coastDist(0));   // フライホイール有りは長い
    expect(coastDist(900)).toBeGreaterThan(coastDist(300)); // 強いほど更に長い
  });

  it('inertia は重力負荷を増やさない (= 登りで質量だけ増やすより速い)', () => {
    // 登り 8%: フライホイール 200 は加速の分母にしか効かない。
    // 質量 +200 は重力にも効くので、 同じ慣性量でも登りは遅くなるはず。
    let v_fly = 6, v_mass = 6;
    const dt = 0.1;
    for (let i = 0; i < 150; i++) {  // 15 秒登坂
      v_fly = applyPhysicsStep(v_fly, dt, 300, 8, { mass: 88, inertia: 200 });
      v_mass = applyPhysicsStep(v_mass, dt, 300, 8, { mass: 288, inertia: 0 });
    }
    expect(v_fly).toBeGreaterThan(v_mass);
  });

  it('inertia 負値: 0 にクランプ (= mass を割り込まない)', () => {
    const a = applyPhysicsStep(5, 0.1, 200, 3, { inertia: -500 });
    const b = applyPhysicsStep(5, 0.1, 200, 3, { inertia: 0 });
    expect(a).toBe(b);
    expect(Number.isFinite(a)).toBe(true);
  });
});

// 2026-05-17 redraft (b3): viewer / inertia-sim / テストに手コピーされていた
// 「クランプ済 dt 区間を 1/120s サブステップ積分する」 段取りを共有関数 integratePhysics に
// 集約。 物理の式は applyPhysicsStep のまま、 切り出しで挙動が drift しないことを下記が pin。
describe('bike_physics.integratePhysics', () => {
  // characterization: 共有関数の出力が手書きサブステップループと完全一致することを担保。
  // この helper は切り出し前に viewer / sim / test が直書きしていたループの逐語再現。
  function manualSubstep(v, dt, power, slope, opts) {
    const SUB = 1 / 120;
    let remain = dt;
    while (remain > 0) {
      const h = Math.min(SUB, remain);
      v = applyPhysicsStep(v, h, power, slope, opts);
      remain -= h;
    }
    return v;
  }

  it('手書きサブステップループと出力が一致する (= 切り出しで物理が drift しない)', () => {
    const cases = [
      [0, 1.0, 250, 8, { mass: 88 }],
      [8, 2.0, 0, -7, { mass: 88, inertia: 800 }],
      [5, 0.1, 200, 0, {}],
      [3, 1.5, 400, 10, { mass: 60, c_rr: 0.005, c_d: 0.35, area: 1, inertia: 3000 }],
    ];
    for (const [v, dt, p, s, o] of cases) {
      expect(integratePhysics(v, dt, p, s, o)).toBe(manualSubstep(v, dt, p, s, o));
    }
  });

  it('dt <= 0: no-op (= v 不変、 サブステップループに入らない)', () => {
    expect(integratePhysics(5, 0, 200, 0)).toBe(5);
    expect(integratePhysics(5, -1, 200, 0)).toBe(5);
  });

  it('サブステップ分割境界に依存しない (= 2.0s 一括 = 1.0s×2 連続)', () => {
    const opts = { mass: 88, inertia: 800 };
    const oneShot = integratePhysics(0, 2.0, 250, -3, opts);
    let split = integratePhysics(0, 1.0, 250, -3, opts);
    split = integratePhysics(split, 1.0, 250, -3, opts);
    expect(split).toBeCloseTo(oneShot, 10);
  });

  it('opts 既定 (省略時): applyPhysicsStep の DEFAULTS で積分する', () => {
    const v = integratePhysics(5, 1.0, 200, 0);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });

  it('下り + power=0 で加速、 登り + power=0 で減速', () => {
    expect(integratePhysics(8, 5.0, 0, -7, { mass: 88 })).toBeGreaterThan(8);
    expect(integratePhysics(8, 3.0, 0, 8, { mass: 88 })).toBeLessThan(8);
  });
});
