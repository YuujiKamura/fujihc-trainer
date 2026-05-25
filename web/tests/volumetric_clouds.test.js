// b74: volumetric_clouds.js の単体テスト。
//
// (a) 純 JS helper (heightMaskJs / densityJs) は THREE 非依存で直接 import + test。
// (b) createVolumetricClouds(THREE) は fake THREE で factory return shape + setWeather 経路 +
//     shader source 文字列の識別子 grep を pin。 misleading test 回避: uniform 経路だけ
//     正しくても shader が読まない事故を検出するため、 fragmentShader 文字列で
//     cloudCover / cloudBaseM / cloudTopM / HG_G / RAY_MARCH_STEPS / LIGHT_RAY_STEPS の
//     識別子参照を pin。

import { describe, it, expect } from 'vitest';
import {
  heightMaskJs, densityJs, hg2Js, powderJs,
  RAY_MARCH_STEPS, LIGHT_RAY_STEPS, HG_G, HEIGHT_MASK_FADE_M,
  HG_FORWARD, HG_BACKWARD, HG_MIX,
  POWDER_SCALE, POWDER_EXPONENT,
  DENSITY_PROFILE_LINEAR, DENSITY_PROFILE_CONST,
  PERLIN_FREQ, WORLEY_FREQ,
  createVolumetricClouds,
} from '../lib/map3d/volumetric_clouds.js';

describe('定数 (= GLSL と JS で同値共有)', () => {
  it('RAY_MARCH_STEPS = 16 (= view ray)', () => {
    expect(RAY_MARCH_STEPS).toBe(16);
  });
  it('LIGHT_RAY_STEPS = 6 (= 太陽方向 self-shadowing)', () => {
    expect(LIGHT_RAY_STEPS).toBe(6);
  });
  it('HG_G = 0.8 (= legacy 1 lobe HG asymmetry、 b80 で 2 lobe 化により unused、 後方互換)', () => {
    expect(HG_G).toBe(0.8);
  });
  it('b80: HG_FORWARD = 0.7 / HG_BACKWARD = -0.2 / HG_MIX = 0.5 (= 2 lobe HG default)', () => {
    expect(HG_FORWARD).toBe(0.7);
    expect(HG_BACKWARD).toBe(-0.2);
    expect(HG_MIX).toBe(0.5);
  });
  it('b80: POWDER_SCALE = 0.8 / POWDER_EXPONENT = 15 (= Beer-powder dark edge)', () => {
    expect(POWDER_SCALE).toBe(0.8);
    expect(POWDER_EXPONENT).toBe(15);
  });
  it('b80: DENSITY_PROFILE_LINEAR = 0.75 / DENSITY_PROFILE_CONST = 0.25 (= takram CloudLayer DEFAULT linearTerm/constantTerm)', () => {
    expect(DENSITY_PROFILE_LINEAR).toBe(0.75);
    expect(DENSITY_PROFILE_CONST).toBe(0.25);
  });
  it('HEIGHT_MASK_FADE_M = 200 (= legacy 旧 smoothstep mask FADE 幅、 b80 で unused、 後方互換)', () => {
    expect(HEIGHT_MASK_FADE_M).toBe(200);
  });
  it('PERLIN_FREQ = 0.0001 / WORLEY_FREQ = 0.0005 (= 周期 60km / 12km)', () => {
    expect(PERLIN_FREQ).toBe(0.0001);
    expect(WORLEY_FREQ).toBe(0.0005);
  });
});

describe('heightMaskJs — b80 densityProfile + shapeAlteringFunction (= cumulus flat base + 頂部 round)', () => {
  const base = 1500;
  const top = 3500;

  it('y = cloudBaseM の真下では 0 (= 雲層外)', () => {
    expect(heightMaskJs(base - 1, base, top)).toBe(0);
    expect(heightMaskJs(0, base, top)).toBe(0);
  });

  it('y = cloudBaseM ぴったりは 0 (= gate)', () => {
    expect(heightMaskJs(base, base, top)).toBe(0);
  });

  it('y = cloudTopM の真上では 0 (= 雲層外)', () => {
    expect(heightMaskJs(top + 1, base, top)).toBe(0);
    expect(heightMaskJs(10000, base, top)).toBe(0);
  });

  it('y = cloudTopM ぴったりは 0 (= gate)', () => {
    expect(heightMaskJs(top, base, top)).toBe(0);
  });

  it('雲層中央 (= base..top の中央、 h=0.5) で 0.5 付近 (= linear 0.625 × roundTop 0.83 ≒ 0.52)', () => {
    const mid = (base + top) / 2;
    const m = heightMaskJs(mid, base, top);
    expect(m).toBeGreaterThan(0.4);
    expect(m).toBeLessThan(0.6);
  });

  it('雲底直上 (h=0.05) は薄い (= flat base、 takram cumulus 質感の核)', () => {
    const y = base + (top - base) * 0.05;
    const m = heightMaskJs(y, base, top);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(0.3); // flat base、 旧 smoothstep だと約 0.5 だった
  });

  it('雲頂手前 (h=0.95) は roundTop が小さい (= 頂部を半円で丸める shapeAlteringFunction の効果)', () => {
    const y = base + (top - base) * 0.95;
    const m = heightMaskJs(y, base, top);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(0.3); // top は roundTop 小、 旧 smoothstep だと 1 だった
  });

  it('h=0.25 付近で roundTop=1.0 (= shapeAlteringFunction の peak、 sqrt(0.25)=0.5 で t=0)', () => {
    const h25 = base + (top - base) * 0.25;
    const m = heightMaskJs(h25, base, top);
    // h=0.25 で linear=0.4375、 roundTop=1.0、 積=0.4375
    expect(m).toBeCloseTo(0.4375, 3);
  });
});

describe('densityJs — cloudCover × noise × heightMask', () => {
  const base = 1500;
  const top = 3500;
  const mid = (base + top) / 2;

  it('cloudCover = 0 なら全 y で 0 (= 雲無し)', () => {
    expect(densityJs(mid, 0, base, top, 1)).toBe(0);
    expect(densityJs(2000, 0, base, top, 0.5)).toBe(0);
  });

  it('y が雲層外なら 0 (= 雲底以下 / 雲頂以上)', () => {
    expect(densityJs(0, 0.8, base, top, 1)).toBe(0);
    expect(densityJs(10000, 0.8, base, top, 1)).toBe(0);
  });

  it('cloudCover = 1 + noise = 1 + 雲層中央 → density ≒ heightMaskJs(mid) (= b80 で 0.5 付近)', () => {
    const d = densityJs(mid, 1, base, top, 1);
    expect(d).toBeGreaterThan(0.4);
    expect(d).toBeLessThan(0.6);
  });

  it('cloudCover 比例 ── 0.5 で半分', () => {
    const dFull = densityJs(mid, 1, base, top, 1);
    const dHalf = densityJs(mid, 0.5, base, top, 1);
    expect(dHalf).toBeCloseTo(dFull * 0.5, 6);
  });
});

describe('hg2Js — b80 2 lobe Henyey-Greenstein (= silver lining)', () => {
  it('cosTheta = 1 (= 太陽方向と同方向) で forward lobe dominant、 backlight より明るい', () => {
    const fwd = hg2Js(1);
    const back = hg2Js(-1);
    expect(fwd).toBeGreaterThan(back);
  });

  it('g1 = 0, g2 = 0 (= isotropic) で 1/(4π) (= 物理的 sanity)', () => {
    expect(hg2Js(0, 0, 0, 0.5)).toBeCloseTo(1 / (4 * Math.PI), 4);
  });

  it('default (= forward 0.7, backward -0.2, mix 0.5) で cosTheta=0.5 が cosTheta=0 より大 (= 前方散乱)', () => {
    expect(hg2Js(0.5)).toBeGreaterThan(hg2Js(0));
  });

  it('backward 寄与で cosTheta=-1 が cosTheta=0 より大 (= silver lining、 backlight でも光る)', () => {
    expect(hg2Js(-1)).toBeGreaterThan(hg2Js(0));
  });
});

describe('powderJs — b80 Beer-powder dark edge', () => {
  it('density = 0 で 1 - scale = 0.2 (= 雲外周は dark)', () => {
    expect(powderJs(0)).toBeCloseTo(0.2, 6);
  });

  it('density 大で 1 に近づく (= 雲深部は bright)', () => {
    expect(powderJs(10)).toBeGreaterThan(0.99);
  });

  it('単調増加 (= density 増加に対し powder factor 増加)', () => {
    expect(powderJs(0.1)).toBeLessThan(powderJs(1));
    expect(powderJs(0.01)).toBeLessThan(powderJs(0.1));
  });

  it('scale=0 (= dark edge 無効) で常に 1', () => {
    expect(powderJs(0, 0)).toBe(1);
    expect(powderJs(10, 0)).toBe(1);
  });
});

// === fake THREE for factory test (= atmosphere3d.test.js と同型) ===
function makeFakeThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    normalize() {
      const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
      this.x /= len; this.y /= len; this.z /= len; return this;
    }
  }
  class BoxGeometry {
    constructor(w, h, d) { this.width = w; this.height = h; this.depth = d; }
  }
  class ShaderMaterial {
    constructor(opts) {
      this.vertexShader = opts.vertexShader;
      this.fragmentShader = opts.fragmentShader;
      this.uniforms = opts.uniforms;
      this.transparent = opts.transparent;
      this.side = opts.side;
      this.depthWrite = opts.depthWrite;
    }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector3();
      this.frustumCulled = true;
      this.renderOrder = 0;
    }
  }
  return {
    Vector3, BoxGeometry, ShaderMaterial, Mesh,
    DoubleSide: 'DoubleSide',
  };
}

describe('createVolumetricClouds — factory', () => {
  const THREE = makeFakeThree();
  const cloudVolume = { minX: -6000, maxX: 6000, minZ: -6000, maxZ: 6000 };  // 12km 四方相当

  it('mesh / setWeather / getWeather / setSunDir / setCameraPosition / tick を返す', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.mesh).toBeDefined();
    expect(typeof inst.setWeather).toBe('function');
    expect(typeof inst.getWeather).toBe('function');
    expect(typeof inst.setSunDir).toBe('function');
    expect(typeof inst.setCameraPosition).toBe('function');
    expect(typeof inst.tick).toBe('function');
  });

  it('mesh は BoxGeometry + ShaderMaterial、 frustumCulled=false', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(inst.mesh.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(inst.mesh.frustumCulled).toBe(false);
  });

  it('BoxGeometry の幅・高さ・奥行が cloudVolume と cloudBaseM..cloudTopM から算出される', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume: { minX: -6000, maxX: 6000, minZ: -4000, maxZ: 4000 },
      cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.mesh.geometry.width).toBe(12000);
    expect(inst.mesh.geometry.height).toBe(2000);
    expect(inst.mesh.geometry.depth).toBe(8000);
  });

  it('mesh.position は cloudVolume と Y の中心', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume: { minX: -100, maxX: 100, minZ: -200, maxZ: 200 },
      cloudBaseM: 1000, cloudTopM: 3000,
    });
    expect(inst.mesh.position.x).toBe(0);
    expect(inst.mesh.position.y).toBe(2000);
    expect(inst.mesh.position.z).toBe(0);
  });

  it('cloudVolume が無効なら throw', () => {
    expect(() => createVolumetricClouds(THREE, {})).toThrow();
    expect(() => createVolumetricClouds(THREE, { cloudVolume: {} })).toThrow();
    expect(() => createVolumetricClouds(THREE, {
      cloudVolume: { minX: NaN, maxX: 1, minZ: 0, maxZ: 1 },
    })).toThrow();
  });

  it('setWeather で uniform 値が更新される', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudCover: 0, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const u = inst.mesh.material.uniforms;
    expect(u.cloudCover.value).toBe(0);
    inst.setWeather({ cloudCover: 0.9, cloudBaseM: 1800, cloudTopM: 3800 });
    expect(u.cloudCover.value).toBe(0.9);
    expect(u.cloudBaseM.value).toBe(1800);
    expect(u.cloudTopM.value).toBe(3800);
    // uBoundsMin / uBoundsMax の Y も追従
    expect(u.uBoundsMin.value.y).toBe(1800);
    expect(u.uBoundsMax.value.y).toBe(3800);
  });

  it('getWeather で current state を返す', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudCover: 0.7, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.getWeather()).toEqual({ cloudCover: 0.7, cloudBaseM: 1500, cloudTopM: 3500 });
    inst.setWeather({ cloudCover: 0.3 });
    expect(inst.getWeather().cloudCover).toBe(0.3);
    expect(inst.getWeather().cloudBaseM).toBe(1500);  // 変更なし
  });

  it('tick で uTime が増える (= 雲が風で動く)', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const t0 = inst.mesh.material.uniforms.uTime.value;
    inst.tick(0.016);
    expect(inst.mesh.material.uniforms.uTime.value).toBeCloseTo(t0 + 0.016, 6);
  });

  // === shader source の grep assert (= misleading test 回避、 軸 4 audit 指摘) ===

  it('fragmentShader に cloudCover 識別子が登場 (= shader が uniform を読む pin)', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.mesh.material.fragmentShader).toContain('cloudCover');
  });

  it('fragmentShader に cloudBaseM / cloudTopM 識別子が登場', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(inst.mesh.material.fragmentShader).toContain('cloudBaseM');
    expect(inst.mesh.material.fragmentShader).toContain('cloudTopM');
  });

  it('fragmentShader に HG_G / RAY_MARCH_STEPS / LIGHT_RAY_STEPS 識別子が登場', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    expect(src).toContain('HG_G');
    expect(src).toContain('RAY_MARCH_STEPS');
    expect(src).toContain('LIGHT_RAY_STEPS');
  });

  it('fragmentShader に density / heightMask / hgPhase / intersectAABB 関数が登場', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    expect(src).toContain('density');
    expect(src).toContain('heightMask');
    expect(src).toContain('hgPhase');
    expect(src).toContain('intersectAABB');
  });

  it('fragmentShader に perlin3d / worley3d noise 関数が登場', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    expect(src).toContain('perlin3d');
    expect(src).toContain('worley3d');
  });

  it('b80: fragmentShader に hg2Phase 関数が登場 (= 2 lobe HG、 silver lining 経路)', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    expect(src).toContain('hg2Phase');
    // ray-march loop で phase 取得が hg2Phase に切り替わったことを pin
    expect(src).toContain('phase = hg2Phase');
  });

  it('b80: fragmentShader に powder factor が登場 (= Beer-powder dark edge)', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    expect(src).toContain('powder');
    // inScatter に powder 乗算 (= 雲外周 dark) の経路を pin
    expect(src).toMatch(/\* powder/);
  });

  it('b80: fragmentShader の heightMask が densityCurve + roundTop の積に書き換わってる', () => {
    const inst = createVolumetricClouds(THREE, {
      cloudVolume, cloudBaseM: 1500, cloudTopM: 3500,
    });
    const src = inst.mesh.material.fragmentShader;
    // 旧 smoothstep 経路 (= baseFade / topFade) が消えて、 新 densityCurve / roundTop が入ったことを pin
    expect(src).not.toContain('baseFade');
    expect(src).not.toContain('topFade');
    expect(src).toContain('densityCurve');
    expect(src).toContain('roundTop');
  });
});
