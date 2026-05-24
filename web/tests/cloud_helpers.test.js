// b77: cloud_helpers.js (= CK42BB shader 式と同型な純 JS helper) の単体テスト。
// GLSL/JS 同値を 4+ sample point で pin、 旧 b74 の heightMaskJs / densityJs 系
// 5 件 GLSL/JS 同値の置換。 shader 内式を変えたら本 module を変える、 本 test が
// 検出する規律 (= atmosphere3d.test.js の同型継承)。

import { describe, it, expect } from 'vitest';
import {
  smoothstep,
  hash3,
  noise3D,
  fbm,
  worley,
  remap,
  cloudDensity,
  henyeyGreenstein,
  cloudPhase,
  silverLining,
  FBM_MAX_OCTAVES,
  MAX_STEPS,
  LIGHT_STEPS,
  EARLY_BREAK_ALPHA,
  CUMULUS_COVERAGE,
  CUMULUS_SHAPE_OCTAVES,
  CUMULUS_DETAIL_OCTAVES,
  CUMULUS_DETAIL_STRENGTH,
  CUMULUS_WORLEY_BLEND,
  CUMULUS_BOTTOM_ROUNDNESS,
  CUMULUS_ABSORPTION,
  CUMULUS_PHASE_FORWARD,
  CUMULUS_PHASE_BACK,
  CUMULUS_PHASE_FORWARD_WEIGHT,
  SILVER_LINING_STRENGTH,
  BEER_POWDER_MIX,
  SHAPE_FREQ,
  DETAIL_FREQ,
  ALT_ENV_BASE,
  ALT_ENV_TOP_LO,
} from '../lib/map3d/cloud_helpers.js';

describe('GLSL/JS 同値 pin 定数 (= shader define / uniform default と同期)', () => {
  it('MAX_STEPS=60 / LIGHT_STEPS=4 (= RX 6400 30fps 目標、 b77 brief 性能トレード)', () => {
    expect(MAX_STEPS).toBe(60);
    expect(LIGHT_STEPS).toBe(4);
  });

  it('FBM_MAX_OCTAVES=6 (= NUBIS 標準 + CK42BB ループ上限と同期)', () => {
    expect(FBM_MAX_OCTAVES).toBe(6);
  });

  it('EARLY_BREAK_ALPHA=0.98 (= 累積透過率 early exit 閾値)', () => {
    expect(EARLY_BREAK_ALPHA).toBe(0.98);
  });

  it('CUMULUS preset (= cloud-types.md 由来) の数値が CK42BB と一致', () => {
    expect(CUMULUS_COVERAGE).toBe(0.35);
    expect(CUMULUS_SHAPE_OCTAVES).toBe(3);
    expect(CUMULUS_DETAIL_OCTAVES).toBe(5);
    expect(CUMULUS_DETAIL_STRENGTH).toBe(0.35);
    expect(CUMULUS_WORLEY_BLEND).toBe(0.4);  // CK42BB shader hardcode と一致
    expect(CUMULUS_BOTTOM_ROUNDNESS).toBe(0.3);
    expect(CUMULUS_ABSORPTION).toBe(0.045);
  });

  it('HG 2 lobe phase (= 0.6/-0.3 の 0.7/0.3 mix)', () => {
    expect(CUMULUS_PHASE_FORWARD).toBe(0.6);
    expect(CUMULUS_PHASE_BACK).toBe(-0.3);
    expect(CUMULUS_PHASE_FORWARD_WEIGHT).toBe(0.7);
  });

  it('silver lining 強度 0.4 + Beer-powder mix 0.5', () => {
    expect(SILVER_LINING_STRENGTH).toBe(0.4);
    expect(BEER_POWDER_MIX).toBe(0.5);
  });

  it('FBM 周波数 (= shape 0.0003 / detail 0.003)', () => {
    expect(SHAPE_FREQ).toBe(0.0003);
    expect(DETAIL_FREQ).toBe(0.003);
  });

  it('altitude envelope thresholds (= base 0.15 / top 0.7)', () => {
    expect(ALT_ENV_BASE).toBe(0.15);
    expect(ALT_ENV_TOP_LO).toBe(0.7);
  });
});

describe('smoothstep (= GLSL smoothstep 式同型)', () => {
  it('edge0 以下で 0、 edge1 以上で 1', () => {
    expect(smoothstep(0, 1, -0.5)).toBe(0);
    expect(smoothstep(0, 1, 1.5)).toBe(1);
  });

  it('中央 (= 0.5) で 0.5 (= 3t² - 2t³ at t=0.5)', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('monotonically increasing on [edge0, edge1]', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const v = smoothstep(0, 1, i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('hash3 (= 決定論的 0..1 vec3 / GLSL fract(sin(p)) と同式)', () => {
  it('同じ入力で同じ出力 (= deterministic)', () => {
    const a = hash3(1.5, 2.5, 3.5);
    const b = hash3(1.5, 2.5, 3.5);
    expect(a).toEqual(b);
  });

  it('出力 3 成分が全て 0..1 範囲', () => {
    for (let i = -3; i < 3; i++) {
      const h = hash3(i * 1.7, i * 2.3, i * 3.1);
      for (const v of h) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('異なる入力で異なる出力 (= avalanche、 同一 hash3 衝突を稀に)', () => {
    const a = hash3(1, 2, 3);
    const b = hash3(1, 2, 4);
    // 3 成分のうち少なくとも 1 つは確実に異なる
    const diff = a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2];
    expect(diff).toBe(true);
  });
});

describe('noise3D (= gradient noise、 GLSL noise3D と同式)', () => {
  it('整数 grid 点で値が連続 (= smooth)', () => {
    const a = noise3D(0.0001, 0.0001, 0.0001);
    const b = noise3D(0, 0, 0);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('範囲は概ね -1..1 (= unit cube 内で sampling した値の絶対値が 1 を超えない)', () => {
    let maxAbs = 0;
    for (let i = 0; i < 50; i++) {
      const x = i * 0.13, y = i * 0.27, z = i * 0.41;
      const v = noise3D(x, y, z);
      maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    expect(maxAbs).toBeLessThanOrEqual(1.5);  // numeric safety margin
  });

  it('同じ入力で同じ出力 (= deterministic)', () => {
    const a = noise3D(2.3, 4.5, 6.7);
    const b = noise3D(2.3, 4.5, 6.7);
    expect(a).toBe(b);
  });
});

describe('fbm (= multi-octave noise、 octave 上限 6)', () => {
  it('octaves=0 は 0 を返す', () => {
    expect(fbm(1.5, 2.5, 3.5, 0)).toBe(0);
  });

  it('octaves=1 は単一 noise3D 相当', () => {
    const f = fbm(1.5, 2.5, 3.5, 1);
    const n = noise3D(1.5, 2.5, 3.5);
    expect(f).toBeCloseTo(n, 6);
  });

  it('octaves が増えると normalize で範囲が安定 (= maxA で割る)', () => {
    let maxAbs = 0;
    for (let oct = 1; oct <= 6; oct++) {
      for (let i = 0; i < 10; i++) {
        const x = i * 0.13, y = i * 0.27, z = i * 0.41;
        maxAbs = Math.max(maxAbs, Math.abs(fbm(x, y, z, oct)));
      }
    }
    expect(maxAbs).toBeLessThanOrEqual(1.5);
  });

  it('octaves > FBM_MAX_OCTAVES は上限 clamp (= GLSL ループ hard cap と同期)', () => {
    const a = fbm(1.5, 2.5, 3.5, FBM_MAX_OCTAVES);
    const b = fbm(1.5, 2.5, 3.5, FBM_MAX_OCTAVES + 5);
    expect(a).toBe(b);
  });
});

describe('worley (= cellular distance)', () => {
  it('cell 距離は 0 以上', () => {
    for (let i = 0; i < 20; i++) {
      const x = i * 0.7, y = i * 1.3, z = i * 2.1;
      expect(worley(x, y, z)).toBeGreaterThanOrEqual(0);
    }
  });

  it('cell 距離は概ね sqrt(3) 以下 (= 隣接 27 cell の最近距離)', () => {
    let maxD = 0;
    for (let i = 0; i < 20; i++) {
      const x = i * 0.7, y = i * 1.3, z = i * 2.1;
      maxD = Math.max(maxD, worley(x, y, z));
    }
    expect(maxD).toBeLessThan(Math.sqrt(3));
  });

  it('同じ入力で同じ出力', () => {
    expect(worley(1.5, 2.5, 3.5)).toBe(worley(1.5, 2.5, 3.5));
  });
});

describe('remap (= GLSL remap 式同型)', () => {
  it('lo 入力 → newLo 出力', () => {
    expect(remap(0, 0, 1, 100, 200)).toBe(100);
  });

  it('hi 入力 → newHi 出力', () => {
    expect(remap(1, 0, 1, 100, 200)).toBe(200);
  });

  it('中央 → 中央 (= 線形写像)', () => {
    expect(remap(0.5, 0, 1, 100, 200)).toBe(150);
  });

  it('clamp 外 input は clamp される (= < lo → newLo、 > hi → newHi)', () => {
    expect(remap(-1, 0, 1, 10, 20)).toBe(10);
    expect(remap(2, 0, 1, 10, 20)).toBe(20);
  });
});

describe('cloudDensity (= altitude envelope + FBM + Worley + coverage + bottom roundness)', () => {
  const params = {
    cloudBase: 1500,
    cloudTop: 6000,
    coverage: 0.5,
    detailStrength: CUMULUS_DETAIL_STRENGTH,
    shapeOctaves: 3,
    detailOctaves: 5,
    worleyBlend: 0.4,
    bottomRoundness: 0.3,
  };

  it('coverage=0 なら全 y で 0 (= 雲なし)', () => {
    const p = { ...params, coverage: 0 };
    expect(cloudDensity(0, 3000, 0, p)).toBe(0);
    expect(cloudDensity(1000, 4500, 200, p)).toBe(0);
  });

  it('y < cloudBase なら 0 (= altitude envelope 下限)', () => {
    expect(cloudDensity(0, 500, 0, params)).toBe(0);
    expect(cloudDensity(0, 1499, 0, params)).toBe(0);
  });

  it('y > cloudTop なら 0 (= altitude envelope 上限)', () => {
    expect(cloudDensity(0, 6001, 0, params)).toBe(0);
    expect(cloudDensity(0, 10000, 0, params)).toBe(0);
  });

  it('退化スラブ (cloudTop ≤ cloudBase) なら 0', () => {
    const p = { ...params, cloudBase: 6000, cloudTop: 3000 };
    expect(cloudDensity(0, 4000, 0, p)).toBe(0);
  });

  it('coverage 増加で density 上昇 (= 同 sample point、 単調)', () => {
    const x = 100, y = 3500, z = 200;
    const d05 = cloudDensity(x, y, z, { ...params, coverage: 0.5 });
    const d10 = cloudDensity(x, y, z, { ...params, coverage: 1.0 });
    expect(d10).toBeGreaterThanOrEqual(d05);
  });

  it('雲底直上 (= 雲底平坦 cumulus 特徴) で密度が抑制される', () => {
    const justAbove = params.cloudBase + 50;
    const middle = (params.cloudBase + params.cloudTop) / 2;
    const dJust = cloudDensity(100, justAbove, 200, params);
    const dMid = cloudDensity(100, middle, 200, params);
    expect(dJust).toBeLessThanOrEqual(dMid);  // bottom roundness 効果
  });
});

describe('henyeyGreenstein / cloudPhase (= 2 lobe HG mix)', () => {
  it('HG(g=0) は等方 = 1/(4π) (= isotropic baseline)', () => {
    expect(henyeyGreenstein(0, 0)).toBeCloseTo(1 / (4 * Math.PI), 4);
    expect(henyeyGreenstein(1, 0)).toBeCloseTo(1 / (4 * Math.PI), 4);
    expect(henyeyGreenstein(-1, 0)).toBeCloseTo(1 / (4 * Math.PI), 4);
  });

  it('HG(g>0, cosTheta=1) は forward peak (= 太陽方向で最大)', () => {
    const forward = henyeyGreenstein(1, 0.6);
    const back = henyeyGreenstein(-1, 0.6);
    expect(forward).toBeGreaterThan(back);
  });

  it('cloudPhase は 2 lobe mix (= forward 0.7 + back 0.3 比率)', () => {
    const mixed = cloudPhase(1);
    const onlyForward = henyeyGreenstein(1, CUMULUS_PHASE_FORWARD) * CUMULUS_PHASE_FORWARD_WEIGHT
                      + henyeyGreenstein(1, CUMULUS_PHASE_BACK) * (1 - CUMULUS_PHASE_FORWARD_WEIGHT);
    expect(mixed).toBeCloseTo(onlyForward, 6);
  });

  it('cloudPhase(cosTheta=1) > cloudPhase(cosTheta=0) (= forward scattering 優位)', () => {
    expect(cloudPhase(1)).toBeGreaterThan(cloudPhase(0));
  });
});

describe('silverLining (= 雲縁 backlit edge density × pow(-cosTheta))', () => {
  it('edgeDensity=1 なら silver=0 (= 縁ではない = 雲塊内部)', () => {
    expect(silverLining(1, -1)).toBe(0);
  });

  it('cosTheta >= 0 なら silver=0 (= 太陽が後ろにいる時のみ点灯)', () => {
    expect(silverLining(0, 0.5)).toBe(0);
    expect(silverLining(0, 1)).toBe(0);
  });

  it('edgeDensity=0 + cosTheta=-1 で silver = SILVER_LINING_STRENGTH (= max 強度)', () => {
    expect(silverLining(0, -1)).toBeCloseTo(SILVER_LINING_STRENGTH, 6);
  });

  it('edgeDensity / cosTheta が極端ほど silver 強い (= 単調)', () => {
    const weakest = silverLining(0.5, -0.5);
    const strongest = silverLining(0.0, -1.0);
    expect(strongest).toBeGreaterThan(weakest);
  });
});
