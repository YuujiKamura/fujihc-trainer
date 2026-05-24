// b77: CK42BB cumulus 移植後の volumetric_clouds.js 単体テスト。
//
// 旧 b74 の heightMaskJs / densityJs / GLSL/JS 同値 5 件 / Perlin/Worley 周波数定数は
// 全て cloud_helpers.js (= 新 module) に移行、 本 test は volumetric_clouds.js の
// factory 振る舞い + shader 識別子 pin + MIT notice gate + 旧識別子の negative grep
// に集中。 GLSL/JS 同値 pin の本体は cloud_helpers.test.js (= 新規) で担う。
//
// 構成:
//   (a) MIT notice grep (= license 削除を検出)
//   (b) factory happy 4: 返却 shape / setWeather / setSunDir / tick
//   (c) factory edge 5: coverage 0/1 / cloudTop≤cloudBase / sunDir zero / dt NaN
//   (d) factory error 1: opts 欠落でも default で立ち上がる (= 旧 cloudVolume 必須から解放)
//   (e) shader 識別子 grep (= 新 SoT uniform 名が shader 内で参照されている)
//   (f) 旧識別子 negative grep (= heightMaskJs / densityJs / RAY_MARCH_STEPS / HG_G / PERLIN_FREQ / WORLEY_FREQ
//        / LIGHT_RAY_STEPS / HEIGHT_MASK_FADE_M / EARLY_BREAK_TRANSMITTANCE / BoxGeometry が module から完全消失)
//   (g) 後方互換 alias (= cloudVolume / cloudBaseM / cloudTopM) の受理

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVolumetricClouds } from '../lib/map3d/volumetric_clouds.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = readFileSync(
  path.join(__dirname, '..', 'lib', 'map3d', 'volumetric_clouds.js'),
  'utf8',
);

// fake THREE ── factory が触る最小 API を模倣 (= node test で THREE を抜きにする)
function makeFakeTHREE() {
  class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    normalize() {
      const len = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);
      if (len > 0) { this.x /= len; this.y /= len; this.z /= len; }
      return this;
    }
  }
  class Matrix4 {
    constructor() { this.elements = new Array(16).fill(0); }
    copy(m) { this.elements = [...(m.elements || [])]; return this; }
  }
  class PlaneGeometry {
    constructor(w, h) { this.width = w; this.height = h; }
  }
  class ShaderMaterial {
    constructor(opts) { Object.assign(this, opts); }
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector3();
      this.renderOrder = 0;
      this.frustumCulled = true;
      this.onBeforeRender = null;
    }
  }
  return { Vector2, Vector3, Matrix4, PlaneGeometry, ShaderMaterial, Mesh };
}

describe('MIT notice / 帰属 (= license 削除を検出する grep gate)', () => {
  it('module 冒頭に CK42BB MIT 帰属コメントを含む', () => {
    expect(MODULE_SRC).toMatch(/CK42BB\/procedural-clouds-threejs/);
    expect(MODULE_SRC).toMatch(/MIT/);
    expect(MODULE_SRC).toMatch(/Copyright/);
  });

  it('MIT permission notice の必須文言を含む', () => {
    expect(MODULE_SRC).toMatch(/Permission is hereby granted/);
    expect(MODULE_SRC).toMatch(/above copyright notice/);
  });
});

describe('shader 識別子 grep (= 新 SoT uniform 名が shader 内で参照されている)', () => {
  it('cloudBase / cloudTop / coverage の 3 SoT uniform が fragment shader に存在', () => {
    expect(MODULE_SRC).toMatch(/uniform float\s+cloudBase/);
    expect(MODULE_SRC).toMatch(/uniform float\s+cloudTop/);
    expect(MODULE_SRC).toMatch(/uniform float\s+coverage/);
  });

  it('detailStrength / absorptionCoeff / windDirection / windSpeed uniform が shader に存在', () => {
    expect(MODULE_SRC).toMatch(/uniform float\s+detailStrength/);
    expect(MODULE_SRC).toMatch(/uniform float\s+absorptionCoeff/);
    expect(MODULE_SRC).toMatch(/uniform vec2\s+windDirection/);
    expect(MODULE_SRC).toMatch(/uniform float\s+windSpeed/);
  });

  it('camera 関連 uniform (cameraPos / invProjection / invView) + sunDir / sunColor / ambientSky が存在', () => {
    expect(MODULE_SRC).toMatch(/uniform vec3\s+cameraPos/);
    expect(MODULE_SRC).toMatch(/uniform mat4\s+invProjection/);
    expect(MODULE_SRC).toMatch(/uniform mat4\s+invView/);
    expect(MODULE_SRC).toMatch(/uniform vec3\s+sunDir/);
    expect(MODULE_SRC).toMatch(/uniform vec3\s+sunColor/);
    expect(MODULE_SRC).toMatch(/uniform vec3\s+ambientSky/);
  });

  it('MAX_STEPS / LIGHT_STEPS define が shader に存在', () => {
    expect(MODULE_SRC).toMatch(/#define MAX_STEPS/);
    expect(MODULE_SRC).toMatch(/#define LIGHT_STEPS/);
  });

  it('cumulus key 関数 cloudDensity / cloudPhase / lightMarch が shader に存在', () => {
    expect(MODULE_SRC).toMatch(/float cloudDensity\s*\(\s*vec3 p\s*\)/);
    expect(MODULE_SRC).toMatch(/float cloudPhase\s*\(\s*float cosTheta\s*\)/);
    expect(MODULE_SRC).toMatch(/float lightMarch\s*\(\s*vec3 p\s*\)/);
  });

  it('silver lining 計算 (= edgeDensity + back-scatter pow) が shader 内 main で参照されている', () => {
    expect(MODULE_SRC).toMatch(/silver/);
    expect(MODULE_SRC).toMatch(/edgeDensity/);
  });
});

describe('旧 b74 識別子の negative grep (= 撤去 brief の C2(e) 違反回避)', () => {
  const REMOVED_IDS = [
    'heightMaskJs',
    'densityJs',
    'RAY_MARCH_STEPS',
    'LIGHT_RAY_STEPS',
    'HG_G',
    'PERLIN_FREQ',
    'WORLEY_FREQ',
    'HEIGHT_MASK_FADE_M',
    'EARLY_BREAK_TRANSMITTANCE',
  ];
  for (const id of REMOVED_IDS) {
    it(`旧識別子 ${id} が volumetric_clouds.js から消失している`, () => {
      expect(MODULE_SRC).not.toMatch(new RegExp(id));
    });
  }

  it('旧 BoxGeometry 経路が消失 (= fullscreen quad に置換済)', () => {
    expect(MODULE_SRC).not.toMatch(/BoxGeometry/);
  });
});

describe('createVolumetricClouds factory ── happy path', () => {
  it('factory が必須 6 method + 拡張 2 method を持つ object を返す', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(cloud.mesh).toBeDefined();
    expect(typeof cloud.setWeather).toBe('function');
    expect(typeof cloud.getWeather).toBe('function');
    expect(typeof cloud.setSunDir).toBe('function');
    expect(typeof cloud.setCameraPosition).toBe('function');
    expect(typeof cloud.tick).toBe('function');
    expect(typeof cloud.setSunColor).toBe('function');
    expect(typeof cloud.setAmbientSky).toBe('function');
  });

  it('mesh は fullscreen quad で renderOrder=1 / frustumCulled=false / depthTest=false', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 6000,
    });
    expect(cloud.mesh.geometry.width).toBe(2);
    expect(cloud.mesh.geometry.height).toBe(2);
    expect(cloud.mesh.renderOrder).toBe(1);
    expect(cloud.mesh.frustumCulled).toBe(false);
    expect(cloud.mesh.material.transparent).toBe(true);
    expect(cloud.mesh.material.depthTest).toBe(false);
    expect(cloud.mesh.material.depthWrite).toBe(false);
  });

  it('setWeather で cloudCover / cloudBaseM / cloudTopM の 3 uniform 更新', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0, cloudBaseM: 1500, cloudTopM: 3500,
    });
    cloud.setWeather({ cloudCover: 0.7, cloudBaseM: 1200, cloudTopM: 6000 });
    const u = cloud.mesh.material.uniforms;
    expect(u.coverage.value).toBe(0.7);
    expect(u.cloudBase.value).toBe(1200);
    expect(u.cloudTop.value).toBe(6000);
    const got = cloud.getWeather();
    expect(got.cloudCover).toBe(0.7);
    expect(got.cloudBaseM).toBe(1200);
    expect(got.cloudTopM).toBe(6000);
  });

  it('setSunDir で normalize 後の単位ベクトルが uniform に入る', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    cloud.setSunDir(3, 4, 0);
    const u = cloud.mesh.material.uniforms;
    expect(u.sunDir.value.x).toBeCloseTo(0.6);
    expect(u.sunDir.value.y).toBeCloseTo(0.8);
    expect(u.sunDir.value.z).toBeCloseTo(0);
  });

  it('tick(dt) で time uniform が dt 加算される', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    const u = cloud.mesh.material.uniforms;
    const t0 = u.time.value;
    cloud.tick(0.5);
    cloud.tick(0.25);
    expect(u.time.value).toBeCloseTo(t0 + 0.75);
  });
});

describe('createVolumetricClouds factory ── edge path', () => {
  it('coverage=0 を受理 (= 雲なし状態)', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(cloud.mesh.material.uniforms.coverage.value).toBe(0);
  });

  it('coverage=1 を受理 (= 完全曇り)', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 1, cloudBaseM: 1500, cloudTopM: 3500,
    });
    expect(cloud.mesh.material.uniforms.coverage.value).toBe(1);
  });

  it('cloudTop ≤ cloudBase の退化スラブを factory が受理 (= shader 側で density=0)', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0.5, cloudBaseM: 3000, cloudTopM: 2500,
    });
    expect(cloud.mesh.material.uniforms.cloudBase.value).toBe(3000);
    expect(cloud.mesh.material.uniforms.cloudTop.value).toBe(2500);
  });

  it('setSunDir(0,0,0) を no-op として吸収 (= normalize NaN を避ける)', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    const u = cloud.mesh.material.uniforms;
    const before = { x: u.sunDir.value.x, y: u.sunDir.value.y, z: u.sunDir.value.z };
    cloud.setSunDir(0, 0, 0);
    expect(u.sunDir.value.x).toBe(before.x);
    expect(u.sunDir.value.y).toBe(before.y);
    expect(u.sunDir.value.z).toBe(before.z);
  });

  it('tick(NaN) / tick(undefined) / tick(null) を no-op として吸収', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    const u = cloud.mesh.material.uniforms;
    cloud.tick(0.5);
    const after = u.time.value;
    cloud.tick(NaN);
    cloud.tick(undefined);
    cloud.tick(null);
    expect(u.time.value).toBe(after);
  });
});

describe('createVolumetricClouds factory ── default / no-throw 入口', () => {
  it('opts なしで作っても throw せず default 値で uniform が埋まる (= 旧 cloudVolume 必須から解放)', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE);
    const u = cloud.mesh.material.uniforms;
    expect(u.cloudBase.value).toBe(1500);
    expect(u.cloudTop.value).toBe(3500);
    expect(u.coverage.value).toBe(0);
  });

  it('setWeather({}) / setWeather(null) / setWeather(undefined) を no-op として吸収', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudCover: 0.5, cloudBaseM: 1500, cloudTopM: 3500,
    });
    cloud.setWeather({});
    cloud.setWeather(null);
    cloud.setWeather(undefined);
    const u = cloud.mesh.material.uniforms;
    expect(u.coverage.value).toBe(0.5);
    expect(u.cloudBase.value).toBe(1500);
    expect(u.cloudTop.value).toBe(3500);
  });
});

describe('後方互換 alias (= b74 facade からの呼び出しを破壊しない)', () => {
  it('opts.cloudVolume を受理して無視 (= deprecated shim)', () => {
    const THREE = makeFakeTHREE();
    const cloudVolume = { minX: -100, maxX: 100, minZ: -50, maxZ: 50 };
    expect(() => createVolumetricClouds(THREE, {
      cloudVolume, cloudCover: 0.3, cloudBaseM: 1500, cloudTopM: 3500,
    })).not.toThrow();
  });

  it('opts.cloudBaseM / cloudTopM が cloudBase / cloudTop の alias として動く', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudBaseM: 1000, cloudTopM: 6000,
    });
    const u = cloud.mesh.material.uniforms;
    expect(u.cloudBase.value).toBe(1000);
    expect(u.cloudTop.value).toBe(6000);
  });

  it('opts.cloudBase / cloudTop が優先 (= 新 SoT)、 alias より強い', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {
      cloudBase: 800, cloudBaseM: 1500, cloudTop: 4000, cloudTopM: 6000,
    });
    const u = cloud.mesh.material.uniforms;
    expect(u.cloudBase.value).toBe(800);
    expect(u.cloudTop.value).toBe(4000);
  });
});

describe('setSunColor / setAmbientSky (= b75 ToD palette 伝播 hook)', () => {
  it('setSunColor で sunColor uniform 更新', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    cloud.setSunColor(1.0, 0.7, 0.4);  // sunset 金寄り
    const u = cloud.mesh.material.uniforms;
    expect(u.sunColor.value.x).toBe(1.0);
    expect(u.sunColor.value.y).toBe(0.7);
    expect(u.sunColor.value.z).toBe(0.4);
  });

  it('setSunColor(NaN, ...) を no-op として吸収', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    const u = cloud.mesh.material.uniforms;
    const before = { x: u.sunColor.value.x, y: u.sunColor.value.y, z: u.sunColor.value.z };
    cloud.setSunColor(NaN, 0.5, 0.5);
    expect(u.sunColor.value.x).toBe(before.x);
    expect(u.sunColor.value.y).toBe(before.y);
    expect(u.sunColor.value.z).toBe(before.z);
  });

  it('setAmbientSky で ambientSky uniform 更新', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    cloud.setAmbientSky(0.5, 0.6, 0.8);  // 朝の薄青
    const u = cloud.mesh.material.uniforms;
    expect(u.ambientSky.value.x).toBe(0.5);
    expect(u.ambientSky.value.y).toBe(0.6);
    expect(u.ambientSky.value.z).toBe(0.8);
  });
});

describe('onBeforeRender hook (= camera 行列を毎フレーム自動反映)', () => {
  it('onBeforeRender が設定されており、 camera の position / projectionMatrixInverse / matrixWorld を uniform に流す', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    expect(typeof cloud.mesh.onBeforeRender).toBe('function');

    // fake camera
    const camera = {
      position: { x: 100, y: 200, z: 300 },
      projectionMatrixInverse: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      matrixWorld: { elements: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1] },
    };
    cloud.mesh.onBeforeRender(null, null, camera);
    const u = cloud.mesh.material.uniforms;
    expect(u.cameraPos.value.x).toBe(100);
    expect(u.cameraPos.value.y).toBe(200);
    expect(u.cameraPos.value.z).toBe(300);
    expect(u.invProjection.value.elements[0]).toBe(1);
    expect(u.invView.value.elements[0]).toBe(2);
  });

  it('onBeforeRender(camera=null) を no-op として吸収', () => {
    const THREE = makeFakeTHREE();
    const cloud = createVolumetricClouds(THREE, {});
    expect(() => cloud.mesh.onBeforeRender(null, null, null)).not.toThrow();
    expect(() => cloud.mesh.onBeforeRender(null, null, undefined)).not.toThrow();
  });
});
