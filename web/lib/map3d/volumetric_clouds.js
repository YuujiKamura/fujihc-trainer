// b77: CK42BB volumetric clouds 移植 (= 写真映え cumulus、 fullscreen quad screen-space ray-march)。
// 旧 b74 (= box mesh + perlin*worley) を全置換、 cauliflower billows + flat grey base + silver lining +
// powder mix + 2-lobe HG phase + altitude envelope + bottom roundness を完全装備。
//
// Adapted from CK42BB/procedural-clouds-threejs (MIT) by Kingsley, 2026
// https://github.com/CK42BB/procedural-clouds-threejs
//
// MIT License (full text):
//   Copyright (c) 2026 Kingsley (CK42BB)
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all
//   copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// 設計: fullscreen PlaneGeometry(2,2) + clip-space vertex shader で 1 quad、 fragment shader 内で
// screen UV から ray を逆引きし cloudBase..cloudTop の slab を ray-march。 ScreenSpace のため
// box AABB 不要、 雲が画面の広範囲に分布 (= 富士山周りだけでなく裾野・遠景もカバー)。
// onBeforeRender で camera 行列 (= projectionMatrixInverse / matrixWorld) を毎フレーム uniform 反映、
// facade からは setCameraPosition / setSunDir / setWeather / tick の既存 4 API のみで動く (= b74 と
// 後方互換、 facade 配線の破壊なし)。
//
// SoT: cloudBase / cloudTop / coverage の数値 3 個。 opts.cloudVolume は受理して無視 (deprecated
// 互換 shim、 facade 側で次フェーズ削除予定)。 opts.cloudBaseM / cloudTopM は cloudBase / cloudTop の
// alias、 同じく後方互換。

import {
  MAX_STEPS, LIGHT_STEPS, EARLY_BREAK_ALPHA,
  CUMULUS_COVERAGE, CUMULUS_DETAIL_STRENGTH, CUMULUS_ABSORPTION,
  CUMULUS_BOTTOM_ROUNDNESS, CUMULUS_WORLEY_BLEND,
  CUMULUS_PHASE_FORWARD, CUMULUS_PHASE_BACK, CUMULUS_PHASE_FORWARD_WEIGHT,
  SILVER_LINING_STRENGTH, SILVER_LINING_EDGE_OFFSET_M, BEER_POWDER_MIX,
  SELF_SHADOW_BASE,
  SHAPE_FREQ, DETAIL_FREQ, ALT_ENV_BASE, ALT_ENV_TOP_LO,
  CUMULUS_SHAPE_OCTAVES, CUMULUS_DETAIL_OCTAVES,
} from './cloud_helpers.js';

// fullscreen quad vertex shader ── clip-space に直書き、 modelView / projection 経路を skip。
// vUv は 0..1 で fragment 側で再利用。
const VERTEX_SHADER = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

// fragment shader ── CK42BB volumetric_clouds.frag ベース、 cumulus 専用パラメータで仕上げ。
// 全式は cloud_helpers.js の純 JS export と同型 (= GLSL/JS drift を test で検出)。
const FRAGMENT_SHADER = /* glsl */`
precision highp float;

uniform vec3  cameraPos;
uniform mat4  invProjection;
uniform mat4  invView;
uniform vec3  sunDir;
uniform vec3  sunColor;
uniform vec3  ambientSky;
uniform float time;
uniform float cloudBase;
uniform float cloudTop;
uniform float coverage;
uniform float detailStrength;
uniform vec2  windDirection;
uniform float windSpeed;
uniform float absorptionCoeff;

varying vec2 vUv;

#define MAX_STEPS ${MAX_STEPS}
#define LIGHT_STEPS ${LIGHT_STEPS}
#define PI 3.14159265

// hash ── deterministic 0..1 vec3 (cloud_helpers.js hash3 と同式)
vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}

// gradient noise 3D (cloud_helpers.js noise3D と同式)
float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), f.x),
                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), f.x), f.y),
             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), f.x),
                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), f.x), f.y), f.z);
}

// FBM (cloud_helpers.js fbm と同式、 hard cap 6 octave で NUBIS 標準と同期)
float fbm(vec3 p, int octaves) {
  float sum = 0.0, amp = 1.0, freq = 1.0, maxA = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += noise3D(p * freq) * amp;
    maxA += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / max(maxA, 1e-4);
}

// Worley cellular (cloud_helpers.js worley と同式)
float worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float minDist = 1.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 neighbor = vec3(float(x), float(y), float(z));
    vec3 point = hash3(i + neighbor);
    vec3 diff = neighbor + point - f;
    minDist = min(minDist, dot(diff, diff));
  }
  return sqrt(minDist);
}

// remap (cloud_helpers.js remap と同式)
float remap(float v, float lo, float hi, float newLo, float newHi) {
  return newLo + (clamp(v, lo, hi) - lo) / (hi - lo) * (newHi - newLo);
}

// cloudDensity ── altitude envelope + FBM shape + Worley billows + detail erosion +
// coverage threshold + bottom roundness。 cloud_helpers.js cloudDensity と同式。
float cloudDensity(vec3 p) {
  if (cloudTop <= cloudBase) return 0.0;  // 退化スラブ
  if (coverage <= 0.0) return 0.0;        // coverage 0 → 雲なし (= remap 1/0 回避、 JS と同期)
  vec3 wind = vec3(windDirection.x, 0.0, windDirection.y) * windSpeed * time * 0.001;

  float altNorm = (p.y - cloudBase) / (cloudTop - cloudBase);
  float altEnv = smoothstep(0.0, ${ALT_ENV_BASE.toFixed(3)}, altNorm)
               * smoothstep(1.0, ${ALT_ENV_TOP_LO.toFixed(3)}, altNorm);

  vec3 shapePos = (p + wind) * ${SHAPE_FREQ.toFixed(6)};
  float shape = fbm(shapePos, ${CUMULUS_SHAPE_OCTAVES});
  float cellShape = 1.0 - worley(shapePos * 4.0);
  shape = shape * ${(1 - CUMULUS_WORLEY_BLEND).toFixed(3)} + cellShape * ${CUMULUS_WORLEY_BLEND.toFixed(3)};

  shape = remap(shape, 1.0 - coverage, 1.0, 0.0, 1.0);

  vec3 detailPos = (p + wind * 2.0) * ${DETAIL_FREQ.toFixed(6)};
  float detail = fbm(detailPos, ${CUMULUS_DETAIL_OCTAVES}) * detailStrength;

  float density = max(shape - detail, 0.0) * altEnv;

  // cumulus 雲底平坦 (= bottom roundness)
  density *= smoothstep(0.0, ${CUMULUS_BOTTOM_ROUNDNESS.toFixed(3)}, altNorm);

  return density;
}

// Henyey-Greenstein
float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}

// cumulus 2 lobe phase (cloud_helpers.js cloudPhase と同式、 0.6/-0.3 の 0.7/0.3 mix)
float cloudPhase(float cosTheta) {
  return henyeyGreenstein(cosTheta, ${CUMULUS_PHASE_FORWARD.toFixed(2)}) * ${CUMULUS_PHASE_FORWARD_WEIGHT.toFixed(2)}
       + henyeyGreenstein(cosTheta, ${CUMULUS_PHASE_BACK.toFixed(2)}) * ${(1 - CUMULUS_PHASE_FORWARD_WEIGHT).toFixed(2)};
}

// light march ── 太陽方向に LIGHT_STEPS step、 Beer-powder mix で綿菓子質感
float lightMarch(vec3 p) {
  float stepL = max(cloudTop - p.y, 1.0) / float(LIGHT_STEPS);
  vec3 lightStep = sunDir * stepL;
  float accum = 0.0;
  for (int i = 0; i < LIGHT_STEPS; i++) {
    p += lightStep;
    accum += max(cloudDensity(p), 0.0) * stepL * 0.001;
  }
  float beer = exp(-accum * absorptionCoeff);
  float powder = 1.0 - exp(-accum * absorptionCoeff * 2.0);
  return mix(beer, beer * powder, ${BEER_POWDER_MIX.toFixed(2)});
}

// slab 交差 ── 雲底/雲頂で囲まれた水平スラブとの ray 交差 (= AABB ではない)
vec2 intersectSlab(vec3 ro, vec3 rd, float yMin, float yMax) {
  if (abs(rd.y) < 1e-4) {
    // ほぼ水平 ray、 cloud slab に対しては「無限大に伸びる」 を弱化して打ち切り
    if (ro.y >= yMin && ro.y <= yMax) return vec2(0.0, 100000.0);
    return vec2(0.0, -1.0);
  }
  float tMin = (yMin - ro.y) / rd.y;
  float tMax = (yMax - ro.y) / rd.y;
  if (tMin > tMax) { float tmp = tMin; tMin = tMax; tMax = tmp; }
  return vec2(max(tMin, 0.0), tMax);
}

void main() {
  // screen UV → clip → view → world ray
  vec4 clipPos = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec4 viewPos = invProjection * clipPos;
  viewPos.xyz /= viewPos.w;
  vec3 rd = normalize((invView * vec4(viewPos.xyz, 0.0)).xyz);
  vec3 ro = cameraPos;

  vec2 slabT = intersectSlab(ro, rd, cloudBase, cloudTop);
  if (slabT.x >= slabT.y || slabT.y < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float cosTheta = dot(rd, sunDir);
  float phase = cloudPhase(cosTheta);

  // jitter dither で banding 抑制
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  float stepSize = (slabT.y - slabT.x) / float(MAX_STEPS);
  float t = slabT.x + jitter * stepSize;

  vec4 result = vec4(0.0);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (result.a > ${EARLY_BREAK_ALPHA.toFixed(2)} || t > slabT.y) break;

    vec3 p = ro + rd * t;
    float density = cloudDensity(p);

    if (density > 0.001) {
      float lightEnergy = lightMarch(p);
      vec3 cloudCol = sunColor * lightEnergy * phase + ambientSky * 0.2;

      // silver lining ── 雲縁が太陽方向で金色 (= edge density + backlit pow)
      float edgeDensity = cloudDensity(p + sunDir * ${SILVER_LINING_EDGE_OFFSET_M.toFixed(1)});
      float silver = pow(max(1.0 - edgeDensity, 0.0), 2.0)
                   * pow(max(-cosTheta, 0.0), 2.0);
      cloudCol += sunColor * silver * ${SILVER_LINING_STRENGTH.toFixed(2)};

      // self shadow ── 雲底ほど暗く、 雲頂ほど明るく (= cumulus 立体感)
      float altNorm = clamp((p.y - cloudBase) / max(cloudTop - cloudBase, 1.0), 0.0, 1.0);
      cloudCol *= mix(${SELF_SHADOW_BASE.toFixed(2)}, 1.0, altNorm);

      float alpha = 1.0 - exp(-density * stepSize * absorptionCoeff * 80.0);
      result.rgb += cloudCol * alpha * (1.0 - result.a);
      result.a += alpha * (1.0 - result.a);
    }
    t += stepSize;
  }

  gl_FragColor = result;
}
`;

/**
 * volumetric clouds factory ── fullscreen quad + CK42BB cumulus shader。
 *
 * @param {object} THREE - three 名前空間 (PlaneGeometry / ShaderMaterial / Mesh / Vector2 / Vector3 / Matrix4 を使う)
 * @param {object} opts
 * @param {number} [opts.cloudBase] 雲底海抜 (m)、 alias = opts.cloudBaseM
 * @param {number} [opts.cloudTop] 雲頂海抜 (m)、 alias = opts.cloudTopM
 * @param {number} [opts.cloudCover=0]
 * @param {object} [opts.cloudVolume] 受理するが無視 (= b74 後方互換 shim、 廃止予定)
 * @returns {object} { mesh, setWeather, getWeather, setSunDir, setCameraPosition, tick, setSunColor, setAmbientSky }
 */
export function createVolumetricClouds(THREE, opts = {}) {
  const cloudBase = Number.isFinite(opts.cloudBase) ? opts.cloudBase
                  : Number.isFinite(opts.cloudBaseM) ? opts.cloudBaseM
                  : 1500;
  const cloudTop = Number.isFinite(opts.cloudTop) ? opts.cloudTop
                 : Number.isFinite(opts.cloudTopM) ? opts.cloudTopM
                 : 3500;
  const cloudCover = Number.isFinite(opts.cloudCover) ? opts.cloudCover : 0;

  const uniforms = {
    cameraPos:       { value: new THREE.Vector3() },
    invProjection:   { value: new THREE.Matrix4() },
    invView:         { value: new THREE.Matrix4() },
    sunDir:          { value: new THREE.Vector3(0.5, 0.7, 0.5).normalize() },
    sunColor:        { value: new THREE.Vector3(1.0, 0.97, 0.9) },
    ambientSky:      { value: new THREE.Vector3(0.7, 0.75, 0.8) },
    time:            { value: 0 },
    cloudBase:       { value: cloudBase },
    cloudTop:        { value: cloudTop },
    coverage:        { value: cloudCover },
    detailStrength:  { value: CUMULUS_DETAIL_STRENGTH },
    windDirection:   { value: new THREE.Vector2(1, 0) },
    windSpeed:       { value: 10 },
    absorptionCoeff: { value: CUMULUS_ABSORPTION },
  };

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // 地形 (renderOrder 0) より後、 atmosphere (renderOrder 2) より前
  mesh.renderOrder = 1;

  // onBeforeRender ── camera 行列を毎フレーム uniform 反映、 facade から explicit 更新不要
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    if (!camera) return;
    uniforms.cameraPos.value.copy(camera.position);
    if (camera.projectionMatrixInverse) {
      uniforms.invProjection.value.copy(camera.projectionMatrixInverse);
    }
    if (camera.matrixWorld) {
      uniforms.invView.value.copy(camera.matrixWorld);
    }
  };

  const current = {
    cloudCover, cloudBaseM: cloudBase, cloudTopM: cloudTop,
  };

  return {
    mesh,
    setWeather(weather) {
      if (!weather) return;
      if (Number.isFinite(weather.cloudCover)) {
        uniforms.coverage.value = weather.cloudCover;
        current.cloudCover = weather.cloudCover;
      }
      if (Number.isFinite(weather.cloudBaseM)) {
        uniforms.cloudBase.value = weather.cloudBaseM;
        current.cloudBaseM = weather.cloudBaseM;
      }
      if (Number.isFinite(weather.cloudTopM)) {
        uniforms.cloudTop.value = weather.cloudTopM;
        current.cloudTopM = weather.cloudTopM;
      }
    },
    getWeather() {
      return { ...current };
    },
    setSunDir(x, y, z) {
      const len = Math.sqrt(x * x + y * y + z * z);
      if (len > 1e-6) {
        uniforms.sunDir.value.set(x / len, y / len, z / len);
      }
    },
    setSunColor(r, g, b) {
      if ([r, g, b].every(Number.isFinite)) {
        uniforms.sunColor.value.set(r, g, b);
      }
    },
    setAmbientSky(r, g, b) {
      if ([r, g, b].every(Number.isFinite)) {
        uniforms.ambientSky.value.set(r, g, b);
      }
    },
    setCameraPosition(pos) {
      // onBeforeRender で毎フレーム自動更新するため通常不要、 facade 後方互換のため残す
      if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
        uniforms.cameraPos.value.copy(pos);
      }
    },
    tick(dtSeconds) {
      if (Number.isFinite(dtSeconds)) {
        uniforms.time.value += dtSeconds;
      }
    },
  };
}
