// b61: 物理ベース大気散乱 (aerial perspective / 空気遠近法).
//
// 地形に貼った航空写真は遠景でもベタッと均一で、富士遠景の「遠いほど青く霞む」空気感
// が無い。本モジュールは距離フォグの擬似 (1 色 lerp) ではなく、Rayleigh 散乱 + Mie 散乱
// の実散乱式を解いて aerial perspective を出す。
//
// 方式は解析的単散乱 (analytic single-scattering)。地形はカメラから 10〜15 km スケールの
// 有界な対象で、視線に沿った単散乱を一様媒質と仮定すれば閉形式で積分できる ── Hillaire
// 2020 の aerial-perspective volume が数値積分するものの解析極限。LUT も raymarch も
// 事前計算テクスチャも不要、フラグメント 1 枚 ~20 ALU で self-contained に生 ESM 配信へ
// 乗る。物理は本物: Rayleigh は短波長 (青) を強く散乱 (∝1/λ⁴)、Mie は Henyey-Greenstein
// 位相関数、透過と内部散乱は実際の消散積分。
//
// camera3d.js / sun_model.js と同じ規律 ── 純関数は THREE 非依存で export し node の
// vitest から直接テスト可能に、THREE 生成物は createAtmosphere(THREE) ファクトリに隔離。
//
// 座標系 SoT: 東 = +X、上 = +Y、北 = -Z、方位は北 0°・時計回り (terrain3d.js / scene.js
// と一致)。

// === 調整可能定数 (b61: inertia-sim と同じ反復調整前提で外出し) ===
// 各定数に物理単位・出典・初期値の導出根拠を付す。

// 海面 Rayleigh 散乱係数 (1/m)。標準大気値 (Bruneton 2008 等の大気散乱実装の共通値)。
// 青:赤 ≈ 5.7:1 = 1/λ⁴ の波長依存 ── これが「遠景の青さ」の物理的根拠。
export const ATMO_BETA_RAYLEIGH = [5.8e-6, 13.5e-6, 33.1e-6];
// Mie 散乱係数 (1/m、波長非依存 = 灰)。GLSL uniform へはこの scalar を RGB 3 成分に
// broadcast する ── 波長非依存ゆえ散乱光を灰色に寄せる「白濁」の源。
// b71 (2026-05-24): user 手元 viewer の実画面 slider で Mie を 0 に絞った値を新 default に。
// b62 で 5e-6 (= 青い透明感の値) を既定にしたが、 user は富士山をフォトリアルにクリアに
// 見せたい志向で大気散乱を切る方向に調整、 これを新 default として固定。 「かすみの日」 を
// 見たいときは atmoMie スライダーを上げる (CONTROL_DEFS, 0..42e-6)。
export const ATMO_BETA_MIE = 0;
// Mie 単散乱アルベド。Mie 消散 (extinction) = 散乱 / albedo ── 吸収ぶんを含めた減衰。
export const ATMO_MIE_ALBEDO = 0.9;
// Mie 異方性 g (前方散乱)。 b71 で user 画面値 0 (= 等方) を default に (= b62 の 0.76 から)。
// 0 でも βMie = 0 と組み合わせるので Mie 散乱は実質ゼロ、 太陽周りのハローも出ない。
export const ATMO_MIE_G = 0;
// 散乱係数の全体倍率 (視認性スケール、唯一の非物理つまみ)。 b71 で user 画面値 1.0 を
// default に (= b62 の 3.5 から、 大気散乱効果を最小にしてフォトリアル寄りに調整)。
// 「霞ませたい日」 は atmoDensity スライダーを上げる (CONTROL_DEFS, 0.5..8.0)。
export const ATMO_DENSITY = 1.0;
// Rayleigh 散乱係数 (= 空の青さ) の倍率。 b71 で user 指示「空の青の濃さを調整できる
// スライダーを追加」 で導入。 1.0 が標準大気値、 0 で青散乱ゼロ (= 太陽周りだけ明るい黒い空)、
// 1.0 超で青が濃く (= 散乱光増、 遠景が青く飽和)。 物理的には Rayleigh 係数は空気分子由来
// で定数だが、 viewer の見栄え調整つまみとして倍率を可変にする (Mie が日々の気象、 Rayleigh は
// 「見たい青の濃さ」 の好み調整)。
export const ATMO_RAYLEIGH_SCALE = 1.0;
// 太陽の linear HDR 放射輝度。大きさ (>1) が露出に相当 ── 内部散乱は加算 HDR で 1 を
// 超え、ACES tone mapping (scene.js) が最終段で畳む。物理的には別個の倍率ではなく
// 「太陽の放射輝度」そのもの。遠景の霞の色 (内部散乱の飽和値) は sunColor·βScat/βExt で
// 決まり、青の比 βScat_b/βExt_b ≈ 0.06 ── 遠景の霞の青を linear で ≈0.5 に乗せるには
// sunColor ≈ 8 が要る。実画面目視で [1.7..] → [8.4..] に調整。色は中立 (霞の青みは
// sunColor でなく Rayleigh 波長依存の βScat から出す)。
export const ATMO_SUN_COLOR = [8.4, 8.4, 8.4];

// === 純関数 (THREE 非依存、vitest 対象) ===
// 下記はすべて配列 [r,g,b] または number の純計算。GLSL (本ファイル末尾の注入文字列)
// はこの式を逐語的に写す ── 片方を変えたら両方変えろ。

const RAYLEIGH_PHASE_K = 3 / (16 * Math.PI);  // ≈ 0.0596831
const MIE_PHASE_K = 1 / (4 * Math.PI);        // ≈ 0.0795775

/**
 * Rayleigh 位相関数 ── 散乱角余弦から散乱の角度分布を返す.
 *
 * 3/(16π)·(1+cos²θ)。前方 / 後方 (cosθ=±1) が側方 (cosθ=0) の 2 倍で対称。
 *
 * @param {number} cosTheta - 視線方向と太陽方向のなす角の余弦
 * @returns {number} 位相関数値 (常に正)
 */
export function rayleighPhase(cosTheta) {
  return RAYLEIGH_PHASE_K * (1 + cosTheta * cosTheta);
}

/**
 * Henyey-Greenstein 位相関数 ── Mie 散乱の角度分布近似.
 *
 * 1/(4π)·(1−g²)/(1+g²−2g·cosθ)^1.5。g>0 で前方散乱に偏り、太陽方向のハローを生む。
 * g=0 で等方 (全方向 1/(4π))。
 *
 * @param {number} cosTheta - 散乱角の余弦
 * @param {number} g - 異方性 (-1..1、前方散乱は正)
 * @returns {number} 位相関数値 (常に正)
 */
export function henyeyGreenstein(cosTheta, g) {
  const g2 = g * g;
  const d = 1 + g2 - 2 * g * cosTheta;
  return MIE_PHASE_K * (1 - g2) / (d * Math.sqrt(Math.max(d, 1e-4)));
}

/**
 * 透過 (transmittance) ── 視線に沿った距離 distance の消散後に残る光の割合.
 *
 * T = exp(-βExt·d)。RGB 各成分独立。距離 0 で [1,1,1] (消散なし)、距離増で単調減衰。
 * βExt は青成分が大きいので青がより速く減衰する (= 透過光の赤方化)。
 *
 * @param {number[]} betaExt - 総消散係数 [r,g,b] (1/m)
 * @param {number} distance - カメラ→地表点の距離 (m)
 * @returns {number[]} 透過率 [r,g,b] (各 0..1)
 */
export function transmittance(betaExt, distance) {
  return [
    Math.exp(-betaExt[0] * distance),
    Math.exp(-betaExt[1] * distance),
    Math.exp(-betaExt[2] * distance),
  ];
}

/**
 * 散乱係数 (scattering coefficient) ── 視線方向へ散乱してくる光の波長別係数.
 *
 * βScat(cosθ) = βRayleigh·phaseR(cosθ) + βMie·phaseM(cosθ)。RGB 各成分独立。
 * Rayleigh ぶんは青優位、Mie ぶんは灰。cosθ 依存で太陽方向に勾配を持つ。
 *
 * @param {number[]} betaRayleigh - 実効 Rayleigh 散乱係数 [r,g,b] (1/m)
 * @param {number[]} betaMie - 実効 Mie 散乱係数 [r,g,b] (1/m)
 * @param {number} mieG - Mie 異方性 g
 * @param {number} cosTheta - 視線方向と太陽方向のなす角の余弦
 * @returns {number[]} 散乱係数 [r,g,b]
 */
export function scatteringCoefficient(betaRayleigh, betaMie, mieG, cosTheta) {
  const pr = rayleighPhase(cosTheta);
  const pm = henyeyGreenstein(cosTheta, mieG);
  return [
    betaRayleigh[0] * pr + betaMie[0] * pm,
    betaRayleigh[1] * pr + betaMie[1] * pm,
    betaRayleigh[2] * pr + betaMie[2] * pm,
  ];
}

/**
 * 内部散乱 (in-scattering) ── 視線に沿って手前の空気が散乱して足し込まれる光.
 *
 * 一様媒質の単散乱を 0..d で閉形式積分した結果:
 *   inScatter = sunColor·(βScat/βExt)·(1−T)
 * 距離 0 (T=[1,1,1]) で [0,0,0]、距離 ∞ (T=[0,0,0]) で飽和値 sunColor·βScat/βExt。
 * βScat が青優位なので内部散乱は青い加算光になる ── これが遠景の青さの本体。
 *
 * @param {number[]} scatterCoef - 散乱係数 [r,g,b] (scatteringCoefficient の戻り)
 * @param {number[]} betaExt - 総消散係数 [r,g,b] (1/m)
 * @param {number[]} sunColor - 太陽の linear HDR 放射輝度 [r,g,b]
 * @param {number[]} transmittanceVec - 透過率 [r,g,b] (transmittance の戻り)
 * @returns {number[]} 内部散乱光 [r,g,b]
 */
export function inScatter(scatterCoef, betaExt, sunColor, transmittanceVec) {
  return [
    sunColor[0] * (scatterCoef[0] / Math.max(betaExt[0], 1e-9)) * (1 - transmittanceVec[0]),
    sunColor[1] * (scatterCoef[1] / Math.max(betaExt[1], 1e-9)) * (1 - transmittanceVec[1]),
    sunColor[2] * (scatterCoef[2] / Math.max(betaExt[2], 1e-9)) * (1 - transmittanceVec[2]),
  ];
}

/**
 * 方位 + 仰角から太陽方向ベクトル (地表→太陽、正規化) を返す.
 *
 * scene.js の sunPosition(az,el,dist) を距離 1 に正規化した式と同一:
 *   [cos(el)·sin(az), sin(el), -cos(el)·cos(az)]
 * 方位は北 0°・時計回り、仰角は地平線 0°・天頂 90°。返り値は長さ 1。
 *
 * 太陽の SoT は sun_model.js ── 仰角を方位 (= 時間帯) から導くのは sunElevationFromAzimuth
 * が唯一の SoT で、本関数は (方位,仰角) を方向ベクトルへ変換するだけ。仰角を方位から
 * 算出する経路は持たない。scene.js が sunElevationFromAzimuth で導いた仰角を setSun
 * 経由で渡す。
 *
 * @param {number} azimuthDeg - 方位 (北 0°、時計回り)
 * @param {number} elevationDeg - 仰角 (地平線 0°、天頂 90°)
 * @returns {number[]} 太陽方向 [x,y,z] (正規化済)
 */
export function sunDirection(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  const cosEl = Math.cos(el);
  return [cosEl * Math.sin(az), Math.sin(el), -cosEl * Math.cos(az)];
}

/**
 * 視認性スケール density から実効散乱係数 3 本を返す純関数.
 *
 * βRayleigh_eff = ATMO_BETA_RAYLEIGH·density、βMie_eff = betaMie·density (RGB
 * broadcast)、βExt = βRayleigh_eff + βMie_eff/ATMO_MIE_ALBEDO (Mie の吸収ぶんを
 * 含めた総消散)。透過・散乱係数・内部散乱はすべてこの実効係数を使う ── 不一致だと
 * energy 非保存で濁る。
 *
 * b62: 第 2 引数 opts で Mie 散乱係数を実行時に差し替えられる (調整スライダー用)。
 * Rayleigh 散乱係数は空気分子由来でほぼ一定の物理的与件 ── 日々変わるのは Mie
 * (エアロゾル・水滴 = 山肌のもや) なので、調整つまみは Mie 一本に絞る。省略時は
 * betaMie=ATMO_BETA_MIE ── 1 引数呼び出し effectiveCoefficients(density) は b61 と
 * 完全一致 (後方互換)。
 *
 * @param {number} density - 視認性スケール (ATMO_DENSITY が既定)
 * @param {{betaMie?:number}} [opts] - Mie 散乱係数 (1/m)。非数は ATMO_BETA_MIE に落とす。
 * @returns {{betaRayleigh:number[], betaMie:number[], betaExt:number[]}}
 */
export function effectiveCoefficients(density, opts = {}) {
  const betaMieScalar = Number.isFinite(opts.betaMie) ? opts.betaMie : ATMO_BETA_MIE;
  // b71: rayleighScale = 空の青さの倍率 (default ATMO_RAYLEIGH_SCALE = 1.0)。
  // ATMO_BETA_RAYLEIGH に掛けてから density 倍する ── 順序は乗算可換なので意味は同じ。
  const rayleighScale = Number.isFinite(opts.rayleighScale) ? opts.rayleighScale : ATMO_RAYLEIGH_SCALE;
  const betaRayleigh = [
    ATMO_BETA_RAYLEIGH[0] * density * rayleighScale,
    ATMO_BETA_RAYLEIGH[1] * density * rayleighScale,
    ATMO_BETA_RAYLEIGH[2] * density * rayleighScale,
  ];
  const mieEff = betaMieScalar * density;
  const betaMie = [mieEff, mieEff, mieEff];
  const betaExt = [
    betaRayleigh[0] + betaMie[0] / ATMO_MIE_ALBEDO,
    betaRayleigh[1] + betaMie[1] / ATMO_MIE_ALBEDO,
    betaRayleigh[2] + betaMie[2] / ATMO_MIE_ALBEDO,
  ];
  return { betaRayleigh, betaMie, betaExt };
}

// === GLSL シェーダ注入 (上記純関数を逐語的に写したもの) ===

// 頂点シェーダ: world 座標を fragment へ渡す varying。注入マーカーは meshphysical_vert
// に無条件常在する #include <worldpos_vertex>。
const VERT_DECL = 'varying vec3 vAtmoWorldPos;\n';
const VERT_MARKER = '#include <worldpos_vertex>';
const VERT_INJECT = `${VERT_MARKER}
  vAtmoWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

// フラグメントシェーダ: 位相関数の宣言。シェーダ頭に prepend する。
const FRAG_DECL = `varying vec3 vAtmoWorldPos;
uniform vec3 uAtmoCameraPos;
uniform vec3 uAtmoSunDir;
uniform vec3 uAtmoSunColor;
uniform vec3 uAtmoBetaRayleigh;
uniform vec3 uAtmoBetaMie;
uniform vec3 uAtmoBetaExt;
uniform float uAtmoMieG;
float atmoRayleighPhase(float c){ return 0.0596831 * (1.0 + c * c); }
float atmoMiePhase(float c, float g){
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * c;
  return 0.0795775 * (1.0 - g2) / (d * sqrt(max(d, 1e-4)));
}
`;
// フラグメント合成の注入マーカーは meshphysical_frag に無条件常在する
// #include <tonemapping_fragment>。その直前に合成を入れる ── この時点で gl_FragColor は
// 照明済み linear HDR 色 (<opaque_fragment> 後)、tone mapping より前 = linear 空間。
const FRAG_MARKER = '#include <tonemapping_fragment>';
const FRAG_INJECT = `{
  vec3 viewVec = vAtmoWorldPos - uAtmoCameraPos;          // カメラ→地表点
  float dist = length(viewVec);
  vec3 viewDir = viewVec / max(dist, 1e-3);
  vec3 T = exp(-uAtmoBetaExt * dist);                     // 透過 transmittance
  float cosT = dot(viewDir, uAtmoSunDir);
  vec3 betaScat = uAtmoBetaRayleigh * atmoRayleighPhase(cosT)
                + uAtmoBetaMie * atmoMiePhase(cosT, uAtmoMieG);   // 散乱係数
  vec3 inScat = uAtmoSunColor * (betaScat / max(uAtmoBetaExt, vec3(1e-9)))
              * (1.0 - T);                                // 内部散乱 (加算光)
  gl_FragColor.rgb = gl_FragColor.rgb * T + inScat;       // finalColor = obj·T + inScatter
}
${FRAG_MARKER}`;

// === ファクトリ (THREE 注入、描画グルー) ===

/**
 * 大気散乱インスタンスを生成する.
 *
 * uniform オブジェクトを 1 セット生成して保持する。three の uniform は {value:x} 形式
 * ── この {value} の参照を applyTo 内で material の shader.uniforms に代入する。{value}
 * は共有参照なので setSun 等で .value を書き換えると、それを参照する全 material の
 * シェーダに即反映する。本 brief では地形 material 1 つだが、この方式なら将来リボン等
 * へ拡張しても setSun 1 回が全 material に効く。
 *
 * THREE は THREE.Vector3 を uniform 値に使うため注入する (camera3d.js と同じ作法)。
 * 純関数 (本ファイル上部の export) は THREE 非依存なので、atmosphere3d.js を import した
 * だけでは THREE は要求されない (node テスト可)。
 *
 * @param {object} THREE - three 名前空間 (THREE.Vector3 を使う)
 * @param {{density?:number}} [opts]
 * @returns {object} 大気散乱 API
 */
export function createAtmosphere(THREE, opts = {}) {
  // 散乱パラメータのランタイム状態 (b62: 調整スライダーが setParams で書き換える)。
  // density / betaMie は実効係数 (recalcEffective)、mieG は uniform 直、sunScale は
  // 太陽色 (recalcSunColor) に効く。いずれも module const が既定値。Rayleigh 係数は
  // 空気分子由来の物理定数なので可変にしない (調整は Mie = もや 側に絞る)。
  let density = Number.isFinite(opts.density) ? opts.density : ATMO_DENSITY;
  let betaMie = Number.isFinite(opts.betaMie) ? opts.betaMie : ATMO_BETA_MIE;
  let mieG = Number.isFinite(opts.mieG) ? opts.mieG : ATMO_MIE_G;
  // b71: rayleighScale = 空の青さの倍率 (default 1.0)。 user 調整スライダー atmoRayleigh から流れる。
  let rayleighScale = Number.isFinite(opts.rayleighScale) ? opts.rayleighScale : ATMO_RAYLEIGH_SCALE;
  // 太陽放射輝度 (ATMO_SUN_COLOR) に掛ける倍率 = 露出相当の非物理つまみ。
  let sunScale = Number.isFinite(opts.sunScale) ? opts.sunScale : 1;
  // 直近 setSun が受けた昼夜係数。sunScale 変更時に太陽色を再計算するため保持する。
  let lastDaylight = 1;

  // uniform を 1 セット生成。{value} の参照を applyTo で共有する。
  const uniforms = {
    uAtmoCameraPos: { value: new THREE.Vector3() },
    uAtmoSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAtmoSunColor: { value: new THREE.Vector3(...ATMO_SUN_COLOR) },
    uAtmoBetaRayleigh: { value: new THREE.Vector3() },
    uAtmoBetaMie: { value: new THREE.Vector3() },
    uAtmoBetaExt: { value: new THREE.Vector3() },
    uAtmoMieG: { value: ATMO_MIE_G },
  };

  // density / betaMie / mieG / rayleighScale から散乱係数 uniform を再計算する。
  function recalcEffective() {
    const eff = effectiveCoefficients(density, { betaMie, rayleighScale });
    uniforms.uAtmoBetaRayleigh.value.set(...eff.betaRayleigh);
    uniforms.uAtmoBetaMie.value.set(...eff.betaMie);
    uniforms.uAtmoBetaExt.value.set(...eff.betaExt);
    uniforms.uAtmoMieG.value = mieG;
  }

  // 太陽色 uniform を再計算する ── ATMO_SUN_COLOR·sunScale·昼夜係数。
  function recalcSunColor() {
    uniforms.uAtmoSunColor.value.set(
      ATMO_SUN_COLOR[0] * sunScale * lastDaylight,
      ATMO_SUN_COLOR[1] * sunScale * lastDaylight,
      ATMO_SUN_COLOR[2] * sunScale * lastDaylight);
  }
  recalcEffective();
  recalcSunColor();

  return {
    // 散乱パラメータの uniform を読む口 (= scene.js の検証 / 将来 control_panel 用)。
    uniforms,

    /**
     * material に大気散乱シェーダを注入する.
     *
     * onBeforeCompile で uniform 共有参照を仕込み、頂点 / フラグメントへ注入する。
     * material.fog=false にして three の灰色距離フォグ (scene.fog) を地形では物理
     * aerial perspective に置き換える (地形だけ二重減衰しない)。
     *
     * 注入は文字列 replace。three の version 更新で chunk 名が変わると replace が空振り
     * して散乱が黙って消えるため、頂点 / フラグメント両方のマーカー存在を確認し、無ければ
     * throw して即座に気付けるようにする (silent fail させない)。
     *
     * @param {object} material - 注入対象マテリアル (terrain の MeshStandardMaterial)
     */
    applyTo(material) {
      material.onBeforeCompile = (shader) => {
        if (shader.vertexShader.indexOf(VERT_MARKER) === -1) {
          throw new Error(
            `atmosphere3d: 頂点シェーダに ${VERT_MARKER} が無く注入不能 `
            + '(three version 不整合の可能性)');
        }
        if (shader.fragmentShader.indexOf(FRAG_MARKER) === -1) {
          throw new Error(
            `atmosphere3d: フラグメントシェーダに ${FRAG_MARKER} が無く注入不能 `
            + '(three version 不整合の可能性)');
        }
        // uniform の {value} 参照を共有する ── setSun 等の .value 更新が即反映される。
        shader.uniforms.uAtmoCameraPos = uniforms.uAtmoCameraPos;
        shader.uniforms.uAtmoSunDir = uniforms.uAtmoSunDir;
        shader.uniforms.uAtmoSunColor = uniforms.uAtmoSunColor;
        shader.uniforms.uAtmoBetaRayleigh = uniforms.uAtmoBetaRayleigh;
        shader.uniforms.uAtmoBetaMie = uniforms.uAtmoBetaMie;
        shader.uniforms.uAtmoBetaExt = uniforms.uAtmoBetaExt;
        shader.uniforms.uAtmoMieG = uniforms.uAtmoMieG;
        shader.vertexShader = VERT_DECL + shader.vertexShader.replace(VERT_MARKER, VERT_INJECT);
        shader.fragmentShader = FRAG_DECL + shader.fragmentShader.replace(FRAG_MARKER, FRAG_INJECT);
      };
      // 地形では three の灰色フォグを切り、物理 aerial perspective に一本化する。
      material.fog = false;
      material.needsUpdate = true;
    },

    /**
     * 太陽方向を更新する (地表照明と同じ太陽 ── scene.js の applySun が毎回呼ぶ).
     *
     * b62: 昼夜係数 strength を lastDaylight に保持し recalcSunColor 経由で太陽色を出す
     * ── これで setParams({sunScale}) が後から来ても次の setSun を待たず即反映できる。
     *
     * @param {number} azimuthDeg - 方位 (北 0°、時計回り)
     * @param {number} elevationDeg - 仰角 (deg)
     * @param {number} strength - 昼夜係数 (昼 1 / 夜 0.18、scene.js の daylight と同値)
     */
    setSun(azimuthDeg, elevationDeg, strength = 1) {
      const d = sunDirection(azimuthDeg, elevationDeg);
      uniforms.uAtmoSunDir.value.set(d[0], d[1], d[2]);
      lastDaylight = Number.isFinite(strength) ? Math.max(0, strength) : 1;
      recalcSunColor();
    },

    /**
     * カメラ world 座標を更新する (毎フレーム、scene.js の render が呼ぶ).
     *
     * @param {{x:number,y:number,z:number}} pos
     */
    setCameraPosition(pos) {
      if (pos) uniforms.uAtmoCameraPos.value.copy(pos);
    },

    /**
     * 散乱パラメータを実行時に差し替える (b62: 機器設定パネルの調整スライダー接続口).
     *
     * 渡されたキーのうち有限数のものだけ更新する ── 非数 / undefined / 未知キーは黙って
     * 無視し既存値を保つ (throw しない、現状の density ガードと同型)。density / betaMie /
     * mieG を変えたら実効係数を、sunScale を変えたら太陽色を再計算する。Rayleigh 係数は
     * 物理定数なので params に持たない。
     *
     * @param {{density?:number, betaMie?:number, mieG?:number, sunScale?:number}} params
     */
    setParams(params = {}) {
      let effDirty = false;
      let sunDirty = false;
      if (Number.isFinite(params.density)) { density = params.density; effDirty = true; }
      if (Number.isFinite(params.betaMie)) { betaMie = params.betaMie; effDirty = true; }
      if (Number.isFinite(params.mieG)) { mieG = params.mieG; effDirty = true; }
      // b71: rayleighScale (= 空の青さ) も scattering 再計算で uniform に反映。
      if (Number.isFinite(params.rayleighScale)) { rayleighScale = params.rayleighScale; effDirty = true; }
      if (Number.isFinite(params.sunScale)) { sunScale = params.sunScale; sunDirty = true; }
      if (effDirty) recalcEffective();
      if (sunDirty) recalcSunColor();
    },
  };
}
