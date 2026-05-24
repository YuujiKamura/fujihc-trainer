// b74: volumetric clouds ── Perlin × Worley の density field を ray-march する
// fragment shader を持つ box mesh。
//
// 設計: cloudVolume (= demBounds 派生の world XZ + cloudBaseM..cloudTopM の Y) を覆う
// BoxGeometry を 1 つ用意し、 fragment shader 内で AABB との交差判定 + 視線方向 ray-march。
// 各 step で density × cloudCover × heightMask、 太陽方向への透過率は light ray 6 step で
// self-shadowing、 散乱位相は Henyey-Greenstein g=0.8。 早期終了は累積透過率 < 0.01。
//
// 純 JS helper (= heightMaskJs / densityJs) を GLSL と式同期で export ── node の vitest から
// 直接 import 可能、 GLSL と式が drift した時に test が検出する。 atmosphere3d.js と同型の
// 「純関数を THREE 非依存で export、 factory に THREE 注入」 規律を承継。

// === GLSL 同期定数 (= shader uniform と JS helper で同値を共有) ===
export const RAY_MARCH_STEPS = 16;              // view ray ステップ数 (b74 prototype の中央値)
export const LIGHT_RAY_STEPS = 6;                // 太陽方向 self-shadowing ステップ数
export const HG_G = 0.8;                         // Henyey-Greenstein asymmetry (積雲中央値)
export const HEIGHT_MASK_FADE_M = 200;           // 雲底・雲頂で透過率 soft にする幅 (雲厚 10%)
export const EARLY_BREAK_TRANSMITTANCE = 0.01;  // ray-march 早期終了閾値
export const PERLIN_FREQ = 0.0001;               // 周期 60 km、 雲塊スケール
export const WORLEY_FREQ = 0.0005;               // 周期 12 km、 cellular 細部

// === 純 JS helper (= node test で GLSL 式同期 pin) ===

/**
 * 雲底・雲頂で透過率を soft にする smoothstep mask の純 JS 版。
 * GLSL の heightMask() と式同型 ── どちらかを変えたら両方変えろ。
 *
 * @param {number} y - world Y 座標 (m)
 * @param {number} cloudBaseM - 雲底絶対海抜 (m)
 * @param {number} cloudTopM - 雲頂絶対海抜 (m)
 * @returns {number} 0..1 (cloudBaseM 以下 / cloudTopM 以上 で 0、 中央で 1)
 */
export function heightMaskJs(y, cloudBaseM, cloudTopM) {
  const baseT = Math.max(0, Math.min(1, (y - cloudBaseM) / HEIGHT_MASK_FADE_M));
  const topT = Math.max(0, Math.min(1, (cloudTopM - y) / HEIGHT_MASK_FADE_M));
  // smoothstep: 3t² - 2t³
  const sBase = baseT * baseT * (3 - 2 * baseT);
  const sTop = topT * topT * (3 - 2 * topT);
  return sBase * sTop;
}

/**
 * density 関数の純 JS 版 (= cloudCover=0 で 0、 範囲外で 0)。 GLSL と式同型。
 * noiseValue は perlin × worley の積を 0..1 で受ける (テスト用に DI、 GLSL は内部生成)。
 *
 * @param {number} y - world Y 座標 (m)
 * @param {number} cloudCover - 0..1
 * @param {number} cloudBaseM - 雲底絶対海抜 (m)
 * @param {number} cloudTopM - 雲頂絶対海抜 (m)
 * @param {number} [noiseValue=1] - perlin × worley の値 (= test では 1 固定で mask × cover を確認)
 * @returns {number} density 0..1
 */
export function densityJs(y, cloudCover, cloudBaseM, cloudTopM, noiseValue = 1) {
  const mask = heightMaskJs(y, cloudBaseM, cloudTopM);
  return noiseValue * cloudCover * mask;
}

// === GLSL シェーダソース (= 純 JS helper と式同型) ===

const VERTEX_SHADER = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// fragment shader: AABB 交差 → ray-march → density 積算 → HG 位相 + light ray self-shadowing。
// 識別子 cloudCover / cloudBaseM / cloudTopM / HG_G / RAY_MARCH_STEPS / LIGHT_RAY_STEPS は
// uniform として参照され、 shader 内 density() / heightMask() / ray-march loop で使われる。
// volumetric_clouds.test.js が material.fragmentShader 文字列から識別子 grep で参照を pin する。
const FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform float cloudCover;
uniform float cloudBaseM;
uniform float cloudTopM;
uniform float HG_G;
uniform int RAY_MARCH_STEPS;
uniform int LIGHT_RAY_STEPS;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform float uTime;

// hash 3D ── 値の擬似乱数を 0..1 で返す
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// value noise 3D (= Perlin 近似、 GPU で安価)
float perlin3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i + vec3(0, 0, 0));
  float n100 = hash3(i + vec3(1, 0, 0));
  float n010 = hash3(i + vec3(0, 1, 0));
  float n110 = hash3(i + vec3(1, 1, 0));
  float n001 = hash3(i + vec3(0, 0, 1));
  float n101 = hash3(i + vec3(1, 0, 1));
  float n011 = hash3(i + vec3(0, 1, 1));
  float n111 = hash3(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// cellular noise 3D (= Worley 近似)
float worley3d(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float minDist2 = 1.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 cell = vec3(float(x), float(y), float(z));
        vec3 offset = vec3(
          hash3(i + cell),
          hash3(i + cell + vec3(31.7, 0.0, 0.0)),
          hash3(i + cell + vec3(0.0, 41.9, 0.0))
        );
        vec3 dp = cell + offset - f;
        float d2 = dot(dp, dp);
        minDist2 = min(minDist2, d2);
      }
    }
  }
  return 1.0 - sqrt(minDist2);
}

// 雲底・雲頂の透過率 soft mask (= heightMaskJs と式同型)
float heightMask(float y) {
  float baseFade = smoothstep(cloudBaseM, cloudBaseM + 200.0, y);
  float topFade  = 1.0 - smoothstep(cloudTopM - 200.0, cloudTopM, y);
  return baseFade * topFade;
}

// density field (= 雲量 × Perlin × Worley × heightMask)。
// 生 perlin × worley は mean ≈ 0.25 で local variance が低く 「もこもこ雲」 にならないため、
// threshold + scale で sharp 化: 0.2 以下を 0、 0.45 以上を 1 にマップ (= 塊と隙間が立つ)。
float density(vec3 p) {
  vec3 windOffset = vec3(uTime * 5.0, 0.0, uTime * 2.0);
  float pn = perlin3d((p + windOffset) * 0.0001);
  float wn = worley3d(p * 0.0005);
  float raw = pn * wn;
  float clipped = clamp((raw - 0.2) * 4.0, 0.0, 1.0);
  return clipped * cloudCover * heightMask(p.y);
}

// Henyey-Greenstein 位相関数 (= 4π 除算込)
float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(d, 1e-4), 1.5));
}

// AABB と ray の交差 ── tNear / tFar を返す
bool intersectAABB(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out float tNear, out float tFar) {
  vec3 invRd = 1.0 / rd;
  vec3 t0 = (bmin - ro) * invRd;
  vec3 t1 = (bmax - ro) * invRd;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  tNear = max(max(tMin.x, tMin.y), tMin.z);
  tFar  = min(min(tMax.x, tMax.y), tMax.z);
  return tFar > 0.0 && tFar > tNear;
}

void main() {
  vec3 ro = uCameraPos;
  vec3 rd = normalize(vWorldPos - uCameraPos);
  float tNear, tFar;
  if (!intersectAABB(ro, rd, uBoundsMin, uBoundsMax, tNear, tFar)) {
    discard;
  }
  tNear = max(tNear, 0.0);
  float stepLen = (tFar - tNear) / float(RAY_MARCH_STEPS);
  vec3 accumColor = vec3(0.0);
  float transmittance = 1.0;
  float cosTheta = dot(rd, normalize(uSunDir));
  float phase = hgPhase(cosTheta, HG_G);

  // 雲の base color。 真夏の白い積雲質感を狙い、 sun は warm white、 ambient は明るい青み
  // (= ACES tone mapping 下で「白く飽和した雲」 に見える)。
  vec3 sunColor = vec3(1.0, 0.97, 0.9);
  vec3 ambientColor = vec3(0.7, 0.75, 0.8);  // 影部分も白に寄せて「暗灰色塊」 回避

  // density 積算 multiplier。 0.003 だと暗灰色塊で蓄積、 0.002 に下げて雲を細く + ambient
  // 強化と組み合わせて「真夏の白い積雲」 質感に。 塊の中心でも light transmit を残す。
  float densityMul = 0.002;
  for (int i = 0; i < 64; i++) {
    if (i >= RAY_MARCH_STEPS) break;
    float t = tNear + (float(i) + 0.5) * stepLen;
    vec3 p = ro + rd * t;
    float d = density(p);
    if (d > 0.001) {
      // light ray ── 太陽方向への透過率を sample
      float lightTransmit = 1.0;
      float lightStepLen = 200.0;  // 雲層内の light step
      vec3 sunDirN = normalize(uSunDir);
      for (int j = 0; j < 16; j++) {
        if (j >= LIGHT_RAY_STEPS) break;
        vec3 lp = p + sunDirN * (float(j) + 0.5) * lightStepLen;
        float ld = density(lp);
        lightTransmit *= exp(-ld * lightStepLen * densityMul);
      }
      // 散乱寄与: sunColor の base 寄与 + 太陽方向の前方散乱 (HG × lightTransmit) + 環境光。
      // 「真夏の白い積雲」 質感は雲全体が white に飽和、 太陽方向で更に明るく光るのが基準。
      // phase (= 0.0001..0.1) だけだと雲全体が暗くなるため、 sunColor base 0.6 を常時加算。
      vec3 inScatter = sunColor * (0.6 + phase * lightTransmit * 4.0) + ambientColor * 0.6;
      float dStep = d * stepLen * densityMul;
      // 累積色 (= alpha-premultiplied で blend、 dStep を 1.0 で clamp して overflow 防止)
      accumColor += inScatter * (1.0 - exp(-dStep)) * transmittance;
      transmittance *= exp(-dStep);
      if (transmittance < 0.01) break;
    }
  }
  float alpha = 1.0 - transmittance;
  gl_FragColor = vec4(accumColor, alpha);
}
`;

/**
 * volumetric clouds factory ── ShaderMaterial + BoxGeometry の Mesh と、 weather 更新 API を返す。
 *
 * @param {object} THREE - three 名前空間 (THREE.BoxGeometry / ShaderMaterial / Mesh / Vector3 を使う)
 * @param {object} opts
 * @param {{minX:number, maxX:number, minZ:number, maxZ:number}} opts.cloudVolume - world XZ bbox
 * @param {number} [opts.cloudCover=0]
 * @param {number} [opts.cloudBaseM=1500]
 * @param {number} [opts.cloudTopM=3500]
 * @returns {object} { mesh, setWeather, getWeather, setSunDir, setCameraPosition, tick }
 */
export function createVolumetricClouds(THREE, opts = {}) {
  const {
    cloudVolume, cloudCover = 0, cloudBaseM = 1500, cloudTopM = 3500,
  } = opts;
  if (!cloudVolume
      || !Number.isFinite(cloudVolume.minX) || !Number.isFinite(cloudVolume.maxX)
      || !Number.isFinite(cloudVolume.minZ) || !Number.isFinite(cloudVolume.maxZ)) {
    throw new Error('createVolumetricClouds: cloudVolume { minX, maxX, minZ, maxZ } の 4 数値が必須');
  }
  const width = cloudVolume.maxX - cloudVolume.minX;
  const depth = cloudVolume.maxZ - cloudVolume.minZ;
  const height = Math.max(1, cloudTopM - cloudBaseM);  // 退化 0 は避ける
  const cx = (cloudVolume.minX + cloudVolume.maxX) / 2;
  const cz = (cloudVolume.minZ + cloudVolume.maxZ) / 2;
  const cy = (cloudBaseM + cloudTopM) / 2;

  const geometry = new THREE.BoxGeometry(width, height, depth);

  const uniforms = {
    uCameraPos: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(1, 1, 0.5).normalize() },
    cloudCover: { value: cloudCover },
    cloudBaseM: { value: cloudBaseM },
    cloudTopM: { value: cloudTopM },
    HG_G: { value: HG_G },
    RAY_MARCH_STEPS: { value: RAY_MARCH_STEPS },
    LIGHT_RAY_STEPS: { value: LIGHT_RAY_STEPS },
    uBoundsMin: { value: new THREE.Vector3(cloudVolume.minX, cloudBaseM, cloudVolume.minZ) },
    uBoundsMax: { value: new THREE.Vector3(cloudVolume.maxX, cloudTopM, cloudVolume.maxZ) },
    uTime: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(cx, cy, cz);
  mesh.frustumCulled = false;
  // 空 (skyDome) より手前、 地形より後の描画順
  mesh.renderOrder = 1;

  const current = { cloudCover, cloudBaseM, cloudTopM };

  return {
    mesh,
    /**
     * 雲量・雲底・雲頂を実行時に差し替える。 cloudVolume bounds の Y も追従。
     */
    setWeather(weather) {
      if (!weather) return;
      if (Number.isFinite(weather.cloudCover)) {
        uniforms.cloudCover.value = weather.cloudCover;
        current.cloudCover = weather.cloudCover;
      }
      if (Number.isFinite(weather.cloudBaseM)) {
        uniforms.cloudBaseM.value = weather.cloudBaseM;
        uniforms.uBoundsMin.value.y = weather.cloudBaseM;
        current.cloudBaseM = weather.cloudBaseM;
      }
      if (Number.isFinite(weather.cloudTopM)) {
        uniforms.cloudTopM.value = weather.cloudTopM;
        uniforms.uBoundsMax.value.y = weather.cloudTopM;
        current.cloudTopM = weather.cloudTopM;
      }
    },
    getWeather() {
      return { ...current };
    },
    setSunDir(x, y, z) {
      uniforms.uSunDir.value.set(x, y, z).normalize();
    },
    setCameraPosition(pos) {
      if (pos) uniforms.uCameraPos.value.copy(pos);
    },
    /**
     * 毎フレーム時刻を進める ── density の perlin sampling 座標を風で動かす。
     * @param {number} dtSeconds - 前フレームからの経過秒
     */
    tick(dtSeconds) {
      if (Number.isFinite(dtSeconds)) {
        uniforms.uTime.value += dtSeconds;
      }
    },
  };
}
