// b77: CK42BB cloud-shaders.md と式同型な純 JS helper。 vitest から直接 import して
// GLSL/JS 同値を 4 sample point で pin する基盤。 旧 b74 の heightMaskJs / densityJs と同じ
// 「GLSL と JS を同式に保つ」 規律を承継、 shader 内式を変えたら本 module も変える。
//
// Adapted from CK42BB/procedural-clouds-threejs (MIT) by Kingsley, 2026
// https://github.com/CK42BB/procedural-clouds-threejs
//
// MIT License (excerpt):
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
// 設計: shader 内識別子 (= hash3 / noise3D / fbm / worley / remap / cloudDensity / cloudPhase /
// silverLining) と式同型な純関数を THREE 非依存で export。 GLSL shader 文字列内の算式と本
// module の算式が drift した時に test (= cloud_helpers.test.js + volumetric_clouds.test.js)
// が検出する。

// fract: GLSL fract と同じ、 0..1 を返す (= negative でも positive fractional part)
function fract(x) {
  return x - Math.floor(x);
}

// mix: GLSL mix(a, b, t) = a*(1-t) + b*t
function mix(a, b, t) {
  return a * (1 - t) + b * t;
}

// clamp: GLSL clamp と同じ
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// smoothstep: GLSL smoothstep(edge0, edge1, x) と同式
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// hash3 ── deterministic 0..1 vec3 (CK42BB: fract(sin(p) * 43758.5453))
// returns [hx, hy, hz]
export function hash3(px, py, pz) {
  const qx = px * 127.1 + py * 311.7 + pz * 74.7;
  const qy = px * 269.5 + py * 183.3 + pz * 246.1;
  const qz = px * 113.5 + py * 271.9 + pz * 124.6;
  return [
    fract(Math.sin(qx) * 43758.5453),
    fract(Math.sin(qy) * 43758.5453),
    fract(Math.sin(qz) * 43758.5453),
  ];
}

// gradient noise 3D ── CK42BB noise3D 式同型、 おおよそ -1..1 範囲、 平均 ≈ 0
export function noise3D(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  // CK42BB の dot(hash3(i+corner), f-corner) を 8 corner で
  const corner = (cx, cy, cz) => {
    const h = hash3(ix + cx, iy + cy, iz + cz);
    return h[0] * (fx - cx) + h[1] * (fy - cy) + h[2] * (fz - cz);
  };
  const n000 = corner(0, 0, 0), n100 = corner(1, 0, 0);
  const n010 = corner(0, 1, 0), n110 = corner(1, 1, 0);
  const n001 = corner(0, 0, 1), n101 = corner(1, 0, 1);
  const n011 = corner(0, 1, 1), n111 = corner(1, 1, 1);

  return mix(
    mix(mix(n000, n100, ux), mix(n010, n110, ux), uy),
    mix(mix(n001, n101, ux), mix(n011, n111, ux), uy),
    uz,
  );
}

// FBM ── CK42BB fbm 式同型、 octave 上限 6 (= GLSL ループの hard cap と同期)
export function fbm(px, py, pz, octaves = 3) {
  const o = clamp(octaves | 0, 0, FBM_MAX_OCTAVES);
  let sum = 0, amp = 1, freq = 1, maxA = 0;
  for (let i = 0; i < o; i++) {
    sum += noise3D(px * freq, py * freq, pz * freq) * amp;
    maxA += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return maxA > 0 ? sum / maxA : 0;
}

// Worley cellular ── CK42BB worley 式同型、 cell 距離 sqrt を 0..約 1.7 で返す
export function worley(px, py, pz) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  let minDist2 = 1;
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const h = hash3(ix + x, iy + y, iz + z);
        const dx = x + h[0] - fx;
        const dy = y + h[1] - fy;
        const dz = z + h[2] - fz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minDist2) minDist2 = d2;
      }
    }
  }
  return Math.sqrt(minDist2);
}

// remap ── CK42BB remap(v, lo, hi, newLo, newHi) 式同型
export function remap(v, lo, hi, newLo, newHi) {
  const cv = clamp(v, lo, hi);
  return newLo + (cv - lo) / (hi - lo) * (newHi - newLo);
}

/**
 * cloudDensity ── CK42BB の altitude envelope + FBM shape + Worley billows + detail erosion +
 * coverage threshold + bottom roundness を 1 つに合成。 wind=0 / time=0 で評価 (= test 用に
 * 風流れを取り除いた純粋密度)。 shader の cloudDensity() と式同型。
 *
 * @param {number} px world x (m)
 * @param {number} py world y (m, 海抜)
 * @param {number} pz world z (m)
 * @param {object} params
 * @param {number} params.cloudBase 雲底海抜 (m)
 * @param {number} params.cloudTop 雲頂海抜 (m)
 * @param {number} params.coverage 0..1
 * @param {number} [params.detailStrength=0.35]
 * @param {number} [params.shapeOctaves=3]
 * @param {number} [params.detailOctaves=5]
 * @param {number} [params.worleyBlend=0.4]
 * @param {number} [params.bottomRoundness=0.3]
 * @returns {number} 0..1
 */
export function cloudDensity(px, py, pz, params) {
  const {
    cloudBase, cloudTop, coverage,
    detailStrength = CUMULUS_DETAIL_STRENGTH,
    shapeOctaves = CUMULUS_SHAPE_OCTAVES,
    detailOctaves = CUMULUS_DETAIL_OCTAVES,
    worleyBlend = CUMULUS_WORLEY_BLEND,
    bottomRoundness = CUMULUS_BOTTOM_ROUNDNESS,
  } = params;
  if (!(cloudTop > cloudBase)) return 0;  // 退化スラブは density 0
  if (!(coverage > 0)) return 0;          // coverage 0 (or NaN) → 雲なし (= remap 1/0 回避)
  const altNorm = (py - cloudBase) / (cloudTop - cloudBase);
  const altEnv = smoothstep(0, ALT_ENV_BASE, altNorm) * smoothstep(1, ALT_ENV_TOP_LO, altNorm);

  // 大局形状 FBM (shape freq = 0.0003)
  let shape = fbm(px * SHAPE_FREQ, py * SHAPE_FREQ, pz * SHAPE_FREQ, shapeOctaves);
  // cellShape = 1 - worley、 billows 反転
  const cellShape = 1 - worley(px * SHAPE_FREQ * 4, py * SHAPE_FREQ * 4, pz * SHAPE_FREQ * 4);
  shape = shape * (1 - worleyBlend) + cellShape * worleyBlend;

  // coverage threshold remap
  shape = remap(shape, 1 - coverage, 1, 0, 1);

  // detail erosion (detail freq = 0.003)
  const detail = fbm(px * DETAIL_FREQ, py * DETAIL_FREQ, pz * DETAIL_FREQ, detailOctaves) * detailStrength;

  let density = Math.max(shape - detail, 0) * altEnv;

  // bottom roundness ── cumulus 雲底平坦
  density *= smoothstep(0, bottomRoundness, altNorm);

  return density;
}

// Henyey-Greenstein phase (= CK42BB henyeyGreenstein 式同型)
export function henyeyGreenstein(cosTheta, g) {
  const g2 = g * g;
  const d = 1 + g2 - 2 * g * cosTheta;
  return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(d, 1e-4), 1.5));
}

// cumulus 2 lobe HG mix (= forward 0.6 × 0.7 + back -0.3 × 0.3)
export function cloudPhase(cosTheta) {
  return henyeyGreenstein(cosTheta, CUMULUS_PHASE_FORWARD) * CUMULUS_PHASE_FORWARD_WEIGHT
       + henyeyGreenstein(cosTheta, CUMULUS_PHASE_BACK)    * (1 - CUMULUS_PHASE_FORWARD_WEIGHT);
}

// silver lining ── 雲縁が太陽方向に光る成分 (= 1 - edge density)^2 × max(-cosTheta, 0)^2 × 0.4
// CK42BB の silver lining 式同型 (cloud-shaders.md:211-215)
export function silverLining(edgeDensity, cosTheta) {
  const edge = Math.pow(Math.max(1 - edgeDensity, 0), 2);
  const back = Math.pow(Math.max(-cosTheta, 0), 2);
  return edge * back * SILVER_LINING_STRENGTH;
}

// === GLSL define と同値で pin する定数 (= shader 内 #define / uniform default と同期) ===
export const FBM_MAX_OCTAVES = 6;          // GLSL ループの hard cap、 NUBIS 標準
export const MAX_STEPS = 60;               // view ray ステップ (RX 6400 30fps 目標、 80→60)
export const LIGHT_STEPS = 4;              // 太陽方向 light ray ステップ (6→4)
export const EARLY_BREAK_ALPHA = 0.98;     // 累積透過率 early exit
export const SHAPE_FREQ = 0.0003;          // 大局形状 FBM 周波数
export const DETAIL_FREQ = 0.003;          // 縁 erosion FBM 周波数
export const ALT_ENV_BASE = 0.15;          // 雲底 fade-in 終端 (= altNorm)
export const ALT_ENV_TOP_LO = 0.7;         // 雲頂 fade-out 開始
export const ALT_ENV_TOP_HI = 1.0;         // 雲頂 fade-out 終端

// CUMULUS cloud-types.md 由来の preset (= default fallback、 cloud_estimator が runtime 上書き可)
export const CUMULUS_COVERAGE = 0.35;
export const CUMULUS_SHAPE_OCTAVES = 3;
export const CUMULUS_DETAIL_OCTAVES = 5;
export const CUMULUS_DETAIL_STRENGTH = 0.35;
export const CUMULUS_WORLEY_BLEND = 0.4;
export const CUMULUS_BOTTOM_ROUNDNESS = 0.3;
export const CUMULUS_EDGE_SHARPNESS = 0.6;
export const CUMULUS_ABSORPTION = 0.045;
export const CUMULUS_PHASE_FORWARD = 0.6;
export const CUMULUS_PHASE_BACK = -0.3;
export const CUMULUS_PHASE_FORWARD_WEIGHT = 0.7;
export const SILVER_LINING_STRENGTH = 0.4;
export const SILVER_LINING_EDGE_OFFSET_M = 50;
export const BEER_POWDER_MIX = 0.5;
export const SELF_SHADOW_BASE = 0.4;       // base 暗くする mix の low (= top の 40%)
