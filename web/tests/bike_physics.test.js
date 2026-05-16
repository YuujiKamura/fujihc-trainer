// 2026-05-15 user 「下りで足を止めた時、 減速がデカすぎる。 普通は加速する局面でもリニアに止まる」
// bike_physics.applyPhysicsStep が物理的に妥当な挙動 (= 下りで power=0 でも加速、 登りで減速、
// 平地で速度依存 drag) を取ることを pin する。
import { describe, it, expect } from 'vitest';
import { applyPhysicsStep, PHYSICS_DEFAULTS } from '../lib/bike_physics.js';

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
