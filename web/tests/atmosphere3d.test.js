// atmosphere3d.js の単体テスト ── 物理ベース大気散乱 (aerial perspective) の純関数と
// シェーダ注入の契約を pin する。
//
// 純関数 (rayleighPhase / henyeyGreenstein / transmittance / scatteringCoefficient /
// inScatter / sunDirection / effectiveCoefficients) は THREE 非依存なので node の vitest
// から直接 import できる。createAtmosphere(THREE) の applyTo は fake THREE + fake material
// で注入成否を pin する ── 注入の replace 空振りは散乱が黙って消える silent fail なので、
// 空振り時に throw することをテストで担保する。
//
// 散乱の「見た目」そのもの (遠景が青く霞む等) は test で pin しきれない ── 実画面目視
// (太陽方向 2 枚比較) が中核検証。本 test は数値ロジックの正しさに限る。

import { describe, it, expect } from 'vitest';
import {
  rayleighPhase, henyeyGreenstein, transmittance, scatteringCoefficient,
  inScatter, sunDirection, effectiveCoefficients, createAtmosphere,
  ATMO_BETA_RAYLEIGH, ATMO_MIE_G, ATMO_DENSITY,
} from '../lib/map3d/atmosphere3d.js';

describe('rayleighPhase — Rayleigh 位相関数 3/(16π)·(1+cos²θ)', () => {
  it('前方 / 後方 (cosθ=±1) は側方 (cosθ=0) の 2 倍 (1+c² が 2:1)', () => {
    const side = rayleighPhase(0);
    expect(rayleighPhase(1)).toBeCloseTo(side * 2, 9);
    expect(rayleighPhase(-1)).toBeCloseTo(side * 2, 9);
  });

  it('cosθ=±1 で対称 (前方後方が同値)', () => {
    expect(rayleighPhase(1)).toBeCloseTo(rayleighPhase(-1), 12);
  });

  it('常に正', () => {
    for (const c of [-1, -0.5, 0, 0.3, 1]) {
      expect(rayleighPhase(c)).toBeGreaterThan(0);
    }
  });

  it('cosθ=0 の値は 3/(16π)', () => {
    expect(rayleighPhase(0)).toBeCloseTo(3 / (16 * Math.PI), 9);
  });
});

describe('henyeyGreenstein — Mie 位相関数 (HG 近似)', () => {
  it('g>0 は前方 (cosθ=1) が後方 (cosθ=-1) より大 (前方散乱)', () => {
    expect(henyeyGreenstein(1, 0.76)).toBeGreaterThan(henyeyGreenstein(-1, 0.76));
  });

  it('g=0 は等方 ── 全 cosθ で 1/(4π)', () => {
    const iso = 1 / (4 * Math.PI);
    for (const c of [-1, -0.4, 0, 0.7, 1]) {
      expect(henyeyGreenstein(c, 0)).toBeCloseTo(iso, 9);
    }
  });

  it('常に正 (g=0.76 の全角度)', () => {
    for (const c of [-1, -0.5, 0, 0.5, 1]) {
      expect(henyeyGreenstein(c, 0.76)).toBeGreaterThan(0);
    }
  });

  it('g が大きいほど前方散乱が鋭く尖る', () => {
    expect(henyeyGreenstein(1, 0.9)).toBeGreaterThan(henyeyGreenstein(1, 0.5));
  });
});

describe('transmittance — 透過 exp(-βExt·d)', () => {
  const betaExt = [29e-6, 50e-6, 141e-6];  // 青 (index 2) 優位の消散係数

  it('距離 0 で [1,1,1] (消散なし)', () => {
    expect(transmittance(betaExt, 0)).toEqual([1, 1, 1]);
  });

  it('距離増で各成分が単調減衰し 0..1 に収まる', () => {
    const near = transmittance(betaExt, 2000);
    const far = transmittance(betaExt, 20000);
    for (let i = 0; i < 3; i += 1) {
      expect(far[i]).toBeLessThan(near[i]);
      expect(far[i]).toBeGreaterThanOrEqual(0);
      expect(near[i]).toBeLessThanOrEqual(1);
    }
  });

  it('青成分 (βExt 大) が赤成分より速く減衰する (= 透過光の赤方化)', () => {
    const t = transmittance(betaExt, 8000);
    expect(t[2]).toBeLessThan(t[0]);  // 青 < 赤
  });

  it('長距離で 0 へ漸近する', () => {
    const t = transmittance(betaExt, 1e6);
    expect(t[2]).toBeCloseTo(0, 6);
  });
});

describe('scatteringCoefficient — 散乱係数 βR·phaseR + βM·phaseM', () => {
  const eff = effectiveCoefficients(ATMO_DENSITY);

  it('全成分が正', () => {
    const s = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 0.3);
    for (const v of s) expect(v).toBeGreaterThan(0);
  });

  it('青成分 > 赤成分 (βRayleigh が青優位 = 1/λ⁴)', () => {
    const s = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 0);
    expect(s[2]).toBeGreaterThan(s[0]);
  });

  it('cosθ 依存で値が変わる (位相関数が効く = 太陽方向に勾配)', () => {
    const front = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 1);
    const side = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 0);
    expect(front[0]).not.toBeCloseTo(side[0], 9);
  });

  it('太陽方向 (cosθ=1) は前方散乱で側方より大きい', () => {
    const front = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 1);
    const side = scatteringCoefficient(eff.betaRayleigh, eff.betaMie, ATMO_MIE_G, 0);
    expect(front[0]).toBeGreaterThan(side[0]);
  });
});

describe('inScatter — 内部散乱 sunColor·(βScat/βExt)·(1−T)', () => {
  const scatterCoef = [4e-6, 8e-6, 18e-6];
  const betaExt = [29e-6, 50e-6, 141e-6];
  const sunColor = [1.7, 1.6, 1.45];

  it('透過 [1,1,1] (距離 0) で内部散乱はゼロ', () => {
    expect(inScatter(scatterCoef, betaExt, sunColor, [1, 1, 1])).toEqual([0, 0, 0]);
  });

  it('透過 [0,0,0] (距離 ∞) で飽和値 sunColor·βScat/βExt', () => {
    const sat = inScatter(scatterCoef, betaExt, sunColor, [0, 0, 0]);
    for (let i = 0; i < 3; i += 1) {
      expect(sat[i]).toBeCloseTo(sunColor[i] * scatterCoef[i] / betaExt[i], 12);
    }
  });

  it('青成分 > 赤成分 (= 内部散乱は青い加算光)', () => {
    const ins = inScatter(scatterCoef, betaExt, sunColor, [0.5, 0.45, 0.3]);
    // βScat/βExt の比が青で大きい (Rayleigh 青優位) ので内部散乱も青寄り。
    expect(ins[2] / sunColor[2]).toBeGreaterThan(ins[0] / sunColor[0]);
  });

  it('透過が小さい (遠い) ほど内部散乱は大きい', () => {
    const near = inScatter(scatterCoef, betaExt, sunColor, [0.9, 0.88, 0.8]);
    const far = inScatter(scatterCoef, betaExt, sunColor, [0.3, 0.25, 0.1]);
    for (let i = 0; i < 3; i += 1) expect(far[i]).toBeGreaterThan(near[i]);
  });

  it('合成不変条件: finalColor = objectColor·T + inScatter', () => {
    // 距離 0 (T=[1,1,1]) なら結果 = objectColor。
    const obj = [0.4, 0.5, 0.6];
    const T0 = [1, 1, 1];
    const ins0 = inScatter(scatterCoef, betaExt, sunColor, T0);
    const final0 = obj.map((c, i) => c * T0[i] + ins0[i]);
    expect(final0).toEqual(obj);
    // objectColor=[0,0,0] なら結果 = inScatter。
    const T = [0.3, 0.25, 0.1];
    const ins = inScatter(scatterCoef, betaExt, sunColor, T);
    const finalBlack = [0, 0, 0].map((c, i) => c * T[i] + ins[i]);
    expect(finalBlack).toEqual(ins);
  });
});

describe('sunDirection — 方位+仰角から太陽方向ベクトル (正規化)', () => {
  it('仰角 90° は真上 [0,1,0]', () => {
    const d = sunDirection(0, 90);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(1, 9);
    expect(d[2]).toBeCloseTo(0, 9);
  });

  it('方位 90° / 仰角 0° は東 [1,0,0]', () => {
    const d = sunDirection(90, 0);
    expect(d[0]).toBeCloseTo(1, 9);
    expect(d[1]).toBeCloseTo(0, 9);
    expect(d[2]).toBeCloseTo(0, 9);
  });

  it('方位 0° / 仰角 0° は北 [0,0,-1]', () => {
    const d = sunDirection(0, 0);
    expect(d[0]).toBeCloseTo(0, 9);
    expect(d[1]).toBeCloseTo(0, 9);
    expect(d[2]).toBeCloseTo(-1, 9);
  });

  it('返り値は常に長さ 1 (正規化済)', () => {
    for (const [az, el] of [[0, 0], [135, 12], [270, 49], [45, 80]]) {
      const d = sunDirection(az, el);
      const len = Math.hypot(d[0], d[1], d[2]);
      expect(len).toBeCloseTo(1, 9);
    }
  });
});

describe('effectiveCoefficients — density から実効散乱係数', () => {
  it('density 0 で全成分 0', () => {
    const e = effectiveCoefficients(0);
    expect(e.betaRayleigh).toEqual([0, 0, 0]);
    expect(e.betaMie).toEqual([0, 0, 0]);
    expect(e.betaExt).toEqual([0, 0, 0]);
  });

  it('betaRayleigh は density に線形', () => {
    const e1 = effectiveCoefficients(1);
    const e2 = effectiveCoefficients(2);
    for (let i = 0; i < 3; i += 1) {
      expect(e2.betaRayleigh[i]).toBeCloseTo(e1.betaRayleigh[i] * 2, 12);
      expect(e1.betaRayleigh[i]).toBeCloseTo(ATMO_BETA_RAYLEIGH[i], 12);
    }
  });

  it('betaExt は betaRayleigh より大 (Mie の消散ぶん加算)', () => {
    const e = effectiveCoefficients(ATMO_DENSITY);
    for (let i = 0; i < 3; i += 1) {
      expect(e.betaExt[i]).toBeGreaterThan(e.betaRayleigh[i]);
    }
  });

  it('betaMie は 3 成分とも同値 (灰色散乱 = 波長非依存)', () => {
    const e = effectiveCoefficients(ATMO_DENSITY);
    expect(e.betaMie[0]).toBe(e.betaMie[1]);
    expect(e.betaMie[1]).toBe(e.betaMie[2]);
  });
});

// === createAtmosphere / applyTo の注入契約 (fake THREE) ===

// 最小 fake THREE ── createAtmosphere は THREE.Vector3 だけを使う。
class FakeVec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
}
const fakeTHREE = { Vector3: FakeVec3 };

// three の meshphysical シェーダの注入マーカーを含む最小 fake shader。
function makeFakeShader() {
  return {
    vertexShader: 'void main() {\n  #include <worldpos_vertex>\n}',
    fragmentShader: 'void main() {\n  gl_FragColor = vec4(1.0);\n  #include <tonemapping_fragment>\n}',
    uniforms: {},
  };
}

describe('createAtmosphere — ファクトリと uniform 初期化', () => {
  it('uniforms が 7 本揃い、実効係数が density から初期化される', () => {
    const atmo = createAtmosphere(fakeTHREE);
    for (const k of ['uAtmoCameraPos', 'uAtmoSunDir', 'uAtmoSunColor',
      'uAtmoBetaRayleigh', 'uAtmoBetaMie', 'uAtmoBetaExt', 'uAtmoMieG']) {
      expect(atmo.uniforms[k], `${k} が無い`).toBeDefined();
    }
    // βExt は density 既定で正の値に初期化済。
    expect(atmo.uniforms.uAtmoBetaExt.value.z).toBeGreaterThan(0);
    expect(atmo.uniforms.uAtmoMieG.value).toBeCloseTo(ATMO_MIE_G, 9);
  });

  it('setSun が太陽方向 uniform を更新する (仰角 90° → 真上)', () => {
    const atmo = createAtmosphere(fakeTHREE);
    atmo.setSun(0, 90, 1);
    expect(atmo.uniforms.uAtmoSunDir.value.y).toBeCloseTo(1, 9);
  });

  it('setSun の strength が太陽色を昼夜でスケールする', () => {
    const atmo = createAtmosphere(fakeTHREE);
    atmo.setSun(135, 30, 1);
    const day = atmo.uniforms.uAtmoSunColor.value.x;
    atmo.setSun(135, 30, 0.18);
    const night = atmo.uniforms.uAtmoSunColor.value.x;
    expect(night).toBeCloseTo(day * 0.18, 9);
  });

  it('setCameraPosition がカメラ座標 uniform を更新する', () => {
    const atmo = createAtmosphere(fakeTHREE);
    atmo.setCameraPosition({ x: 10, y: 20, z: -30 });
    const p = atmo.uniforms.uAtmoCameraPos.value;
    expect([p.x, p.y, p.z]).toEqual([10, 20, -30]);
  });

  it('setParams({density}) が実効係数を再計算する', () => {
    const atmo = createAtmosphere(fakeTHREE);
    const before = atmo.uniforms.uAtmoBetaExt.value.z;
    atmo.setParams({ density: ATMO_DENSITY * 2 });
    expect(atmo.uniforms.uAtmoBetaExt.value.z).toBeCloseTo(before * 2, 9);
  });
});

describe('createAtmosphere.applyTo — シェーダ注入契約 (silent fail 防止)', () => {
  it('applyTo が onBeforeCompile を仕込み material.fog を false にする', () => {
    const atmo = createAtmosphere(fakeTHREE);
    const material = { fog: true, onBeforeCompile: null, needsUpdate: false };
    atmo.applyTo(material);
    expect(typeof material.onBeforeCompile).toBe('function');
    expect(material.fog).toBe(false);
    expect(material.needsUpdate).toBe(true);
  });

  it('onBeforeCompile が頂点 / フラグメントへ注入し uniforms を共有する', () => {
    const atmo = createAtmosphere(fakeTHREE);
    const material = { fog: true, onBeforeCompile: null };
    atmo.applyTo(material);
    const shader = makeFakeShader();
    material.onBeforeCompile(shader);
    // 頂点: world 座標 varying が注入される。
    expect(shader.vertexShader).toContain('vAtmoWorldPos');
    // フラグメント: 合成式と位相関数が注入される。
    expect(shader.fragmentShader).toContain('atmoRayleighPhase');
    expect(shader.fragmentShader).toContain('gl_FragColor.rgb = gl_FragColor.rgb * T + inScat');
    // uniform は共有参照 (createAtmosphere 生成の同一オブジェクト)。
    expect(shader.uniforms.uAtmoBetaExt).toBe(atmo.uniforms.uAtmoBetaExt);
    expect(shader.uniforms.uAtmoSunDir).toBe(atmo.uniforms.uAtmoSunDir);
  });

  it('頂点シェーダに worldpos_vertex マーカーが無いと throw (空振り検出)', () => {
    const atmo = createAtmosphere(fakeTHREE);
    const material = { fog: true, onBeforeCompile: null };
    atmo.applyTo(material);
    const shader = makeFakeShader();
    shader.vertexShader = 'void main() {}';  // マーカー欠落
    expect(() => material.onBeforeCompile(shader)).toThrow(/worldpos_vertex/);
  });

  it('フラグメントシェーダに tonemapping_fragment マーカーが無いと throw (空振り検出)', () => {
    const atmo = createAtmosphere(fakeTHREE);
    const material = { fog: true, onBeforeCompile: null };
    atmo.applyTo(material);
    const shader = makeFakeShader();
    shader.fragmentShader = 'void main() { gl_FragColor = vec4(1.0); }';  // マーカー欠落
    expect(() => material.onBeforeCompile(shader)).toThrow(/tonemapping_fragment/);
  });
});
