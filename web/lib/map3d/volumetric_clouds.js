// b74 + b80: volumetric clouds ── Perlin × Worley の density field を ray-march する
// fragment shader を持つ box mesh。
//
// b80 改修: takram 公式積雲設計の「式だけ」 を本体に注入 (= b80-cumulus-formula-injection.md)。
//   path B: 対称 smoothstep heightMask → densityProfile (= 4 係数 expTerm/exponent/linearTerm/
//           constantTerm) + shapeAlteringFunction (= 頂部を半円で丸める takram clouds.glsl:68-73)
//   path C: 1 lobe HG → 2 lobe HG (= forward 0.7 + backward -0.2 を 50:50 blend、 takram
//           clouds.frag:332-338) + Beer-powder (= 太陽と反対側の dark edge、 takram clouds.frag:581-583)
// 借りるのは数式だけ、 takram package そのものは入れない。 工程 1 日、 ALU +320/pixel = 誤差、
// 1 commit revert 可。 「半透明メタボール」 評価の真因 4 つのうち後ろ 2 つ (= silver lining なし、
// multi scattering なし) を直撃。
//
// 設計: cloudVolume (= demBounds 派生の world XZ + cloudBaseM..cloudTopM の Y) を覆う
// BoxGeometry を 1 つ用意し、 fragment shader 内で AABB との交差判定 + 視線方向 ray-march。
// 各 step で density × cloudCover × heightMask、 太陽方向への透過率は light ray 6 step で
// self-shadowing、 散乱位相は 2 lobe Henyey-Greenstein。 早期終了は累積透過率 < 0.01。
//
// 純 JS helper (= heightMaskJs / densityJs / hg2Js / powderJs) を GLSL と式同期で export ──
// node の vitest から直接 import 可能、 GLSL と式が drift した時に test が検出する。
// atmosphere3d.js と同型の「純関数を THREE 非依存で export、 factory に THREE 注入」 規律を承継。

// b93: 雲底 / 雲頂の絶対床は cloud_estimator.js を SoT として import (= 3 箇所ばらまき廃止)。
import { CLOUD_BASE_FLOOR_M, CLOUD_TOP_FLOOR_M } from '../weather/cloud_estimator.js';

// === GLSL 同期定数 (= shader uniform と JS helper で同値を共有) ===
export const RAY_MARCH_STEPS = 16;              // view ray ステップ数 (b74 prototype の中央値)
export const LIGHT_RAY_STEPS = 6;                // 太陽方向 self-shadowing ステップ数
export const HG_G = 0.8;                         // legacy 1 lobe HG asymmetry、 b80 で 2 lobe 化により unused (後方互換のため残置)
export const HG_FORWARD = 0.7;                   // b80: 2 lobe HG forward (= takram clouds.frag scatterAnisotropy1)
export const HG_BACKWARD = -0.2;                 // b80: 2 lobe HG backward (= takram clouds.frag scatterAnisotropy2)
export const HG_MIX = 0.5;                       // b80: 2 lobe HG mix (= takram clouds.frag scatterAnisotropyMix)
export const POWDER_SCALE = 0.8;                 // b80: Beer-powder dark edge scale (= takram clouds.frag:581 powderScale)
export const POWDER_EXPONENT = 15;               // b80: Beer-powder exponent (= takram 150 を本体 densityMul 0.002 オーダーに合わせ 1/10 scale)
export const HEIGHT_MASK_FADE_M = 200;           // 旧 smoothstep mask の FADE 幅 (= b80 で unused、 legacy 後方互換のため残置)
export const DENSITY_PROFILE_LINEAR = 0.75;      // b80: densityProfile 線形項 (= takram CloudLayer DEFAULT linearTerm)
export const DENSITY_PROFILE_CONST = 0.25;       // b80: densityProfile 定数項 (= takram CloudLayer DEFAULT constantTerm、 雲底密度)
export const EARLY_BREAK_TRANSMITTANCE = 0.01;  // ray-march 早期終了閾値
// b92: noise scale を cumulus 1 個 (= 数百 m) スケールに揃える。 旧 PERLIN 0.0001
// (= 周期 10km) は 16 step ray-march の総距離が perlin 1/10 周期に収まり、 全 step で
// density 不変 → 均一灰色靄になっていた (sub-agent review 結論)。 0.003 で周期 333m、
// 0.008 で周期 125m、 cumulus on/off 境界が視野内に複数回現れて塊感が出る。
export const PERLIN_FREQ = 0.003;                // 周期 333 m、 cumulus 1 個スケール
export const WORLEY_FREQ = 0.008;                // 周期 125 m、 cellular 細部

// === 純 JS helper (= node test で GLSL 式同期 pin) ===

/**
 * b80: cumulus の高度方向密度プロファイル + 頂部 round shape。 GLSL の heightMask() と式同型。
 *
 * 旧 (b74) は対称 smoothstep 2 段で楕円体的、 新 (b80) は takram CloudLayer DEFAULT
 * `(expTerm=0, exponent=0, linearTerm=0.75, constantTerm=0.25)` の線形上昇 + shapeAlteringFunction
 * (= `1 - (2*sqrt(h) - 1)^2` 半円関数) の積で、 cumulus の「flat base + 上膨らみ」 形状を encode。
 *
 * @param {number} y - world Y 座標 (m)
 * @param {number} cloudBaseM - 雲底絶対海抜 (m)
 * @param {number} cloudTopM - 雲頂絶対海抜 (m)
 * @returns {number} 0..1 (cloudBaseM 以下 / cloudTopM 以上 で 0、 中央付近で 0.5、 anvil top heavy)
 */
export function heightMaskJs(y, cloudBaseM, cloudTopM) {
  if (y <= cloudBaseM || y >= cloudTopM) return 0;
  const h = (y - cloudBaseM) / Math.max(cloudTopM - cloudBaseM, 1);
  // densityProfile: linearTerm * h + constantTerm (= takram CloudLayer DEFAULT (0, 0, 0.75, 0.25))
  const densityCurve = DENSITY_PROFILE_CONST + DENSITY_PROFILE_LINEAR * h;
  // shapeAlteringFunction (= takram clouds.glsl:68-73「semi-circle transform to round the top」)
  const t = 2 * Math.sqrt(h) - 1;
  const roundTop = 1 - t * t;
  return densityCurve * roundTop;
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

/**
 * b80: 2 lobe Henyey-Greenstein phase function (= takram clouds.frag:332-338 同型)。
 *
 * 1 lobe (g=0.8) は前方散乱のみで silver lining が出ない、 2 lobe (forward 0.7 + backward -0.2
 * を 50:50 で blend) で太陽 backlight 時に雲縁が金色に光る「silver lining」 質感を encode。
 *
 * @param {number} cosTheta - 視線方向と太陽方向のなす角 cos
 * @param {number} [g1=HG_FORWARD] - forward lobe asymmetry
 * @param {number} [g2=HG_BACKWARD] - backward lobe asymmetry
 * @param {number} [mix=HG_MIX] - forward:backward の blend 比 (= 0..1)
 * @returns {number} phase value (= 4π 除算込)
 */
export function hg2Js(cosTheta, g1 = HG_FORWARD, g2 = HG_BACKWARD, mix = HG_MIX) {
  const hg = (g, c) => {
    const g2v = g * g;
    const denom = Math.pow(Math.max(1 + g2v - 2 * g * c, 1e-4), 1.5);
    return (1 - g2v) / (4 * Math.PI * denom);
  };
  return mix * hg(g1, cosTheta) + (1 - mix) * hg(g2, cosTheta);
}

/**
 * b80: Beer-powder dark edge (= takram clouds.frag:581-583 同型)。
 *
 * 雲外周は dark (= density 小)、 雲深部は bright (= density 大)、 「綿菓子 → 真の積雲」 質感。
 * scale=0.8 で density=0 のとき 0.2 (= 雲外周 80% 暗)、 density 大で 1 に漸近 (= 雲深部 bright)。
 *
 * @param {number} density - ray-march の現在 sample 密度
 * @param {number} [scale=POWDER_SCALE] - dark edge scale
 * @param {number} [exponent=POWDER_EXPONENT] - exp の引数倍率 (= 本体 densityMul=0.002 オーダーに合わせ takram 150 を 1/10 scale)
 * @returns {number} powder factor (= 0.2..1.0)
 */
export function powderJs(density, scale = POWDER_SCALE, exponent = POWDER_EXPONENT) {
  return 1 - scale * Math.exp(-density * exponent);
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
// 識別子 cloudCover / cloudBaseM / cloudTopM / RAY_MARCH_STEPS / LIGHT_RAY_STEPS は
// uniform として参照され、 shader 内 density() / heightMask() / ray-march loop で使われる。
// b80: 2 lobe HG / powder の定数は JS 側 export (HG_FORWARD / HG_BACKWARD / HG_MIX /
// POWDER_SCALE / POWDER_EXPONENT) をテンプレートリテラルで注入 ── JS と shader が drift せず、
// test が JS 定数を pin すれば shader にも反映される (= misleading test 構造の対症療法)。
// volumetric_clouds.test.js が material.fragmentShader 文字列から識別子 grep で参照を pin する。
const FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;
uniform float cloudCover;
uniform float cloudBaseM;
uniform float cloudTopM;
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

// b80: 高度方向密度プロファイル + 頂部 round shape (= heightMaskJs と式同型)。
// takram CloudLayer DEFAULT (0, 0, 0.75, 0.25) の densityProfile (= linear 0.75*h + 0.25) と
// shapeAlteringFunction (= 1 - (2*sqrt(h) - 1)^2、 takram clouds.glsl:68-73) の積。
// cumulus の「flat base + 上膨らみ」 形状を encode、 真因「対称楕円体」 を直撃。
float heightMask(float y) {
  if (y <= cloudBaseM || y >= cloudTopM) return 0.0;
  float h = (y - cloudBaseM) / max(cloudTopM - cloudBaseM, 1.0);
  float densityCurve = 0.25 + 0.75 * h;
  float t = 2.0 * sqrt(h) - 1.0;
  float roundTop = 1.0 - t * t;
  return densityCurve * roundTop;
}

// density field (= 雲量 × Perlin FBM 2 octave × Worley FBM 2 octave × heightMask)。
// 生 perlin × worley は mean ≈ 0.25 で local variance が低く 「もこもこ雲」 にならないため、
// threshold + scale で sharp 化: 0.2 以下を 0、 0.45 以上を 1 にマップ (= 塊と隙間が立つ)。
// b95: 1 octave noise は cumulus の「カリフラワー縁取り」 (= 大塊内に小塊の入れ子) を
// 出さない、 user 「およそ雲って感じではない」 + 山中湖ライブカメラの multi-scale 観察を
// 受け、 Perlin / Worley を 2 octave FBM に化けた (= base freq + 2x freq、 重み 2:1)。
// sample cost は perlin 2x + worley 27→54 sample/pixel × 16 step = 1300 sample/frame で
// RX 6400 でも fragment 命令は ALU 余裕、 GPU 計測で問題出たら octave 数減らせる。
float density(vec3 p) {
  vec3 windOffset = vec3(uTime * 5.0, 0.0, uTime * 2.0);
  // Perlin FBM: 大塊スケール + 2x freq の細部、 amplitude 2:1 で base 重め
  float pn = 0.67 * perlin3d((p + windOffset) * ${PERLIN_FREQ})
           + 0.33 * perlin3d((p + windOffset) * ${PERLIN_FREQ * 2});
  // Worley FBM: 大塊縁 + 2x freq の小塊縁、 amplitude 2:1 で multi-scale カリフラワー縁
  float wn = 0.67 * worley3d(p * ${WORLEY_FREQ})
           + 0.33 * worley3d(p * ${WORLEY_FREQ * 2});
  float raw = pn * wn;
  float clipped = clamp((raw - 0.2) * 4.0, 0.0, 1.0);
  return clipped * cloudCover * heightMask(p.y);
}

// Henyey-Greenstein 位相関数 (= 4π 除算込、 1 lobe utility)
float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(d, 1e-4), 1.5));
}

// b80: 2 lobe Henyey-Greenstein (= forward ${HG_FORWARD} + backward ${HG_BACKWARD} を
// ${HG_MIX}:${1-HG_MIX} blend、 takram clouds.frag:332-338 同型)。 太陽 backlight 時の
// silver lining を encode。 hg2Js と式同型、 JS 定数注入で drift 防止。
float hg2Phase(float cosTheta) {
  float pf = hgPhase(cosTheta, ${HG_FORWARD.toFixed(1)});
  float pb = hgPhase(cosTheta, ${HG_BACKWARD.toFixed(1)});
  return ${HG_MIX.toFixed(1)} * pf + ${(1 - HG_MIX).toFixed(1)} * pb;
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
  // b79 guard: cloudCover が極小 (= slider 0、 雲オミット) なら ray-march outer loop と
  // noise sampling を完全 skip。 GPU の box mesh fragment は依然 rasterize されるが、
  // perlin3d / worley3d / heightMask 計算と 16 step loop は走らない (= 過負荷ゼロに近づく)。
  // 完全な fragment skip は viewer 側で mesh.visible = false を立てる別 path。
  if (cloudCover < 0.001) { discard; }
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
  // b80: 2 lobe HG で silver lining、 旧 1 lobe hgPhase 単体呼出を置換 (= dead code 削除済)。
  float phase = hg2Phase(cosTheta);

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
      // b80: Beer-powder で雲外周を dark、 雲深部を bright (= 「綿菓子→真の積雲」 質感)、
      // takram clouds.frag:581-583 同型。 powderJs と式同型、 JS 定数注入で drift 防止。
      float powder = 1.0 - ${POWDER_SCALE.toFixed(1)} * exp(-d * ${POWDER_EXPONENT.toFixed(1)});
      vec3 inScatter = (sunColor * (0.6 + phase * lightTransmit * 4.0) + ambientColor * 0.6) * powder;
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
 * @param {number} [opts.cloudBaseM=CLOUD_BASE_FLOOR_M]
 * @param {number} [opts.cloudTopM=CLOUD_TOP_FLOOR_M]  // SoT = cloud_estimator.js (= 笠雲再現の絶対床)
 * @returns {object} { mesh, setWeather, getWeather, setSunDir, setCameraPosition, tick }
 */
export function createVolumetricClouds(THREE, opts = {}) {
  const {
    cloudVolume, cloudCover = 0, cloudBaseM = CLOUD_BASE_FLOOR_M, cloudTopM = CLOUD_TOP_FLOOR_M,
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
