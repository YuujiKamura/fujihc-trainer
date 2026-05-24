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
  heightMaskJs, densityJs,
  RAY_MARCH_STEPS, LIGHT_RAY_STEPS, HG_G, HEIGHT_MASK_FADE_M,
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
  it('HG_G = 0.8 (= 積雲前方散乱)', () => {
    expect(HG_G).toBe(0.8);
  });
  it('HEIGHT_MASK_FADE_M = 200 (= 雲底・雲頂で透過率 soft する幅)', () => {
    expect(HEIGHT_MASK_FADE_M).toBe(200);
  });
  it('PERLIN_FREQ = 0.0001 / WORLEY_FREQ = 0.0005 (= 周期 60km / 12km)', () => {
    expect(PERLIN_FREQ).toBe(0.0001);
    expect(WORLEY_FREQ).toBe(0.0005);
  });
});

describe('heightMaskJs — 雲底・雲頂の smoothstep mask', () => {
  const base = 1500;
  const top = 3500;

  it('y = cloudBaseM の真下では 0', () => {
    expect(heightMaskJs(base - 1, base, top)).toBe(0);
    expect(heightMaskJs(0, base, top)).toBe(0);
  });

  it('y = cloudTopM の真上では 0', () => {
    expect(heightMaskJs(top + 1, base, top)).toBe(0);
    expect(heightMaskJs(10000, base, top)).toBe(0);
  });

  it('雲層中央 (= base..top の中央) で最大 (= 1 に近い)', () => {
    const mid = (base + top) / 2;
    expect(heightMaskJs(mid, base, top)).toBeGreaterThan(0.9);
  });

  it('雲底直上 base + FADE/2 で中間値 (0..1)', () => {
    const y = base + HEIGHT_MASK_FADE_M / 2;
    const m = heightMaskJs(y, base, top);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
  });

  it('雲底 + FADE と雲頂 - FADE で 1 (= soft fade を抜けた範囲)', () => {
    // smoothstep(0)=0, smoothstep(1)=1
    expect(heightMaskJs(base + HEIGHT_MASK_FADE_M, base, top)).toBeCloseTo(1, 6);
    expect(heightMaskJs(top - HEIGHT_MASK_FADE_M, base, top)).toBeCloseTo(1, 6);
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

  it('cloudCover = 1 + noise = 1 + 雲層中央 → density 最大 (= 1 に近い)', () => {
    expect(densityJs(mid, 1, base, top, 1)).toBeGreaterThan(0.9);
  });

  it('cloudCover 比例 ── 0.5 で半分', () => {
    const dFull = densityJs(mid, 1, base, top, 1);
    const dHalf = densityJs(mid, 0.5, base, top, 1);
    expect(dHalf).toBeCloseTo(dFull * 0.5, 6);
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
});
