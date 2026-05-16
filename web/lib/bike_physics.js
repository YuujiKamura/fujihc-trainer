// 2026-05-15 user 指摘「下りで足を止めた時、 減速がデカすぎる。 普通は加速する局面でもリニアに止まる」 への補填。
//
// 旧経路: trainer から来た speed_mps をそのまま rider に渡す。 trainer 内部物理は「平地 + power のみ」 で
// 下り勾配の重力加速も慣性も入っていない機種が多い、 結果「足止め = 即減速」 の不自然挙動。
//
// 新経路: viewer 側で simple 1D physics を持つ。 trainer から来る speed は無視、 power と slope_pct
// だけ受け取って自前で v を時間積分する。
//
// 物理 model (= 教科書的、 user 体感調整は係数 default で):
//   m * dv/dt = (power / max(v, v_min)) - m*g*sin(slope) - C_rr*m*g - 0.5*rho*C_d*A*v^2
//
//   - 第 1 項: power / v = 推進力 (power 一定なら速度遅いほど大きい)
//   - 第 2 項: 重力 (登り正 = 減速、 下り負 = 加速)
//   - 第 3 項: 転がり抵抗 (一定)
//   - 第 4 項: 空気抵抗 (v^2 比例)
//
// default 値 (= 一般的なロード + rider 80kg):
//   m = 88 kg (= rider 80 + bike 8)
//   C_rr = 0.005 (= rolling resistance coefficient)
//   rho = 1.225 kg/m^3 (= 海面付近空気密度)
//   C_d = 0.88 (= drag coefficient, rider posture 込)
//   A = 0.4 m^2 (= 前面投影)
//   g = 9.80665
//   v_min = 0.5 m/s (= 推進力発散防止)
//
// pure function、 DOM / browser global 依存ゼロ、 unit test 可能.

const DEFAULTS = Object.freeze({
  mass: 88,
  c_rr: 0.005,
  rho: 1.225,
  c_d: 0.88,
  area: 0.4,
  g: 9.80665,
  v_min: 0.5,
  max_v: 30,  // 安全 cap (= 108 km/h、 物理的に下りで突き抜ける防止)
  // inertia: フライホイール等の「並進質量に乗らない慣性」 を kg 相当で足す。
  // 加速度の分母 (= mass + inertia) にだけ効き、 重力・転がり抵抗には効かない。
  // → 速度変化に抗う (= 漕ぎ出しは重く、 足を止めても長く転がる)。 0 で無効。
  inertia: 0,
});

/**
 * 1 step 進める。
 *
 * @param {number} v 現在速度 (m/s)
 * @param {number} dt 経過秒数
 * @param {number} power_w 入力 power (W、 trainer 起源、 ペダル止めなら 0)
 * @param {number} slope_pct 勾配 % (= 100 * rise/run、 下り負 / 登り正)
 * @param {object} [opts] DEFAULTS を override (mass / inertia / c_rr 等)
 * @returns {number} 新速度 (m/s、 v_min 以上 max_v 以下にクランプ)
 */
export function applyPhysicsStep(v, dt, power_w, slope_pct, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!(dt > 0)) return v;
  const slope_rad = Math.atan(Number(slope_pct || 0) / 100);
  const v_eff = Math.max(v, o.v_min);
  const propulsion = (Number(power_w) || 0) / v_eff;
  const gravity = o.mass * o.g * Math.sin(slope_rad);
  const rolling = o.c_rr * o.mass * o.g * Math.cos(slope_rad);
  const drag = 0.5 * o.rho * o.c_d * o.area * v_eff * v_eff;
  const net_force = propulsion - gravity - rolling - drag;
  // 加速度は「並進質量 + フライホイール慣性」 で割る。 重力 / 転がりの計算は
  // mass のまま (= フライホイールは持ち上がらないし路面も押さない)。
  const accel = net_force / (o.mass + Math.max(0, Number(o.inertia) || 0));
  let new_v = v + accel * dt;
  if (new_v < 0) new_v = 0;  // 停止以下にはならない (= 後退しない)
  if (new_v > o.max_v) new_v = o.max_v;
  return new_v;
}

export const PHYSICS_DEFAULTS = DEFAULTS;
