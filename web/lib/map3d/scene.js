// b12 Phase 3 部品1: シーン / レンダラ / ライティング.
//
// Three.js の Scene / WebGLRenderer / Fog / 太陽光をまとめて持ち、 1 フレーム描画と
// 光源スライダーの反映を担う。 rAF ループは持たない ── viewer 本体の tick が毎フレーム
// render() を呼ぶ (= terrain3d.html の loop() が抱えていた rAF はここに移さない)。
//
// 担当する差し替え口メソッド (b12 Phase3 設計メモ §3 部品1):
//   - render()                  ── 1 フレーム描画
//   - setSunlightDirection(deg)  ── 太陽の方位
//   - setSunlightStrength(exag)  ── 太陽の強さ
//
// 三角の頂点 / 地形メッシュ / カメラは作らない。 mesh は add() で受け取り、 camera は
// render(camera) の引数で受け取る (= カメラ部品は別ワーカーが作る)。

import * as THREE from 'three';
import {
  sunElevationFromAzimuth, shadowCameraConfig, SHADOW_CAM_BASE, SHADOW_LIGHT_DIST,
} from './sun_model.js';
import { createAtmosphere } from './atmosphere3d.js';

// グラデーション青空の色 (= MapLibre 版 map_renderer.js の COMMON_SKY を Three.js に移植).
// b12 Phase 4 の Three.js 化で MapLibre の sky レイヤが失われ、 背景が単色の暗色になっていた。
// b61: ACES tone mapping をグローバル有効化したため、 ACES で中間調が沈むぶんを見越して
// 旧値 (zenith 0x3a7cc4 / horizon 0xe8f0f8) より明るめ・やや濃いめに再調整した
// (= ACES 下で旧来の見えに寄せる、 地表の物理散乱と地平線で色が連続するように)。
// b71 (2026-05-24): 「真夏快晴」 の HTML 標準色 defacto を採用 (= user 反復指摘「真夏の
// ガツンとした青さが出ない」 への対応)。 wiki commons / google img 自動トレースは
// anti-bot / rate limit で 1 起動内に成功せず、 暫定で標準色相を採用:
//
//   SKY_ZENITH:  0x1e90ff (= dodgerblue、 HSL 210° / S 1.00 / L 0.56) ── 真夏快晴の defacto、
//                明度を 0.40 → 0.56 に上げて「明るく飽和した夏空」 感を出す
//   SKY_HORIZON: 0x87cefa (= lightskyblue、 HSL 203° / S 0.92 / L 0.75) ── 薄水色、
//                真夏の地平線に滲む水色、 旧 0xeef4fb 朝霞よりも青寄り
//
// 両者とも CSS named color。 user の手元 chrome で確認後、 「もっと深く」 「もっと淡く」
// 等あれば iteration で SKY_ZENITH / SKY_HORIZON を調整する分岐に持ち込む。
// b71-fixup-7: user 指示「赤成分がもう少し増えていい」 ── R を +30 程度上げて青に紫味を
// 足す (= 群青 / ultramarine 寄りの夏空)。 dodgerblue (R=30) → 0x4090ff (R=64) で
// hue を 210° (= 純青) から 217° (= わずか紫寄り) へシフト。 同様に horizon も R 増で紫味。
const SKY_ZENITH = 0x4090ff;    // 天頂 (= R 30→64 で紫寄り、 HSL ~217° / S 1.00 / L 0.62)
const SKY_HORIZON = 0xa7d0fa;   // 地平線 (= R 135→167 で薄紫寄り水色、 HSL ~209° / S 0.91 / L 0.82)
// 遠景フォグの色 (= COMMON_SKY の fog-color)。 リボン / ラベル等の遠景をこの色へ溶かす。
// b61: 地形メッシュは atmosphere3d.js の物理 aerial perspective に置き換わり、 この灰色
// フォグは地形には効かない (= enableAtmosphere が地形 material の fog を false にする)。
const FOG_COLOR = 0xd8d0c8;
// b61: ACES tone mapping の露出。 1.0 だと ACES で全体が沈むので僅かに持ち上げる。
const TONE_MAPPING_EXPOSURE = 1.15;
// 空ドームの半径 = 地形 span の倍率。 カメラの near(1)〜far(span*6) の内側に必ず収まる値。
const SKY_DOME_SPAN_FACTOR = 1.5;
// 太陽の既定方位。 MapLibre の hillshade-illumination-direction 既定 135 に合わせる
// (= 同じ deg を viewer から受け取るので MapLibre 実装と見えの起点を揃える)。
// 仰角は固定せず sun_model.js が方位 (= 時間帯) から計算する。
const DEFAULT_SUN_AZIMUTH_DEG = 135;
// configureScale() 前に render されても破綻しないための span 既定値 (m)。
const DEFAULT_SPAN_M = 10000;
// 影オルソカメラの半幅・光源距離の定数と算出 (shadowCameraConfig) は sun_model.js に
// 集約済 (= THREE 非依存の純ロジック、 node test 可能)。 ここでは import して使う。

/**
 * 方位 (deg) と仰角 (deg) と距離から太陽光源のワールド座標を返す.
 *
 * 座標系は terrain3d.js と同一 ── 東 = +X、 上 = +Y、 北 = -Z。 方位は北を 0、
 * 時計回りに増やす (= MapLibre の illumination-direction と同じ向きの定義)。
 *
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @param {number} dist
 * @returns {{x:number, y:number, z:number}}
 */
function sunPosition(azimuthDeg, elevationDeg, dist) {
  const az = azimuthDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  const horiz = Math.cos(el) * dist;
  return {
    x: horiz * Math.sin(az),       // 東 = +X
    y: Math.sin(el) * dist,        // 上 = +Y
    z: -horiz * Math.cos(az),      // 北 = -Z (= 方位 0 で真北の上空)
  };
}

/**
 * MapLibre 版の sky-color → horizon-color のグラデーション青空ドームを生成する.
 *
 * 大きな球の内側 (BackSide) に頂点カラーで縦グラデーションを乗せたメッシュ。 天頂が青 /
 * 地平線が青白。 scene.background のテクスチャ方式と違い「ただのメッシュ」 なので確実に
 * 描画される。 カメラに追従させ (= render() で position 更新)、 fog 無効・renderOrder -1・
 * depthWrite 無効で純粋な背景として振る舞う (= 地形は常にこのドームの手前に描かれる)。
 *
 * @returns {THREE.Mesh} 青空ドームメッシュ (単位球、 呼び出し側が span に応じて scale する)
 */
// b71: skyIntensity スライダーで使う「天頂の青の濃さ」 を HSL 経由で動かす純関数。
// 直感: 上げると「青が濃く飽和」、 下げると「白く彩度が抜ける」。 単純な RGB lerp で
// 黒紺方向に振ると視覚的に「色味が消えて灰色っぽく」 見えて user 期待と逆になるため、
// saturation × lightness の組合せで「青の彩度と深さ」 を同時に動かす。
//
//   intensity = 0: saturation 0 + lightness 1.0 = 白 (空の青さゼロ)
//   intensity = 1: 現状の SKY_ZENITH (= HSL(~202°, 0.60, 0.60) の水色)
//   intensity = 2: saturation を 1.0 へ飽和 + lightness を base の半分まで下げる
//                  = HSL(~202°, 1.0, 0.30) ≒ 深く濃い青
//
// horizon (= SKY_HORIZON、 地平線の朝霞色) は固定、 zenith だけ動く ── 「空の青さ」 は
// 天頂部分の調整、 地平線は霞の色なので分離する。
function zenithColorForIntensity(intensity) {
  const t = Number.isFinite(intensity) ? Math.max(0, Math.min(2, intensity)) : 1;
  const base = new THREE.Color(SKY_ZENITH);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // saturation: t に比例で 0 → base.s → min(1, base.s * t)。 t=0 で無彩色、 t=2 で飽和。
  const s = Math.min(1, hsl.s * t);
  // lightness: t<=1 では 1.0 (= 白) → base.l へ、 t>1 では base.l → base.l * 0.5 (深い青) へ。
  let l;
  if (t <= 1) {
    l = 1.0 * (1 - t) + hsl.l * t;
  } else {
    l = hsl.l * (1 - (t - 1) * 0.5);
  }
  return new THREE.Color().setHSL(hsl.h, s, l);
}

// b71: 頂点カラーを再生成する純関数 (= dome rebuild、 setSkyIntensity から呼ぶ)。
// b76: elevationDeg を optional 追加 ── 太陽 elevation が低い (= 朝夕) と sunset
// オレンジを混ぜて夕焼け空、 高い (= 昼) は base 水色のまま。 既存 setSkyIntensity 経路
// (= elevationDeg=90 default) は base 水色維持で後方互換。
function paintSkyDomeColors(dome, intensity, elevationDeg = 90) {
  const geo = dome.geometry;
  const pos = geo.attributes.position;
  const attr = geo.attributes.color;
  const baseZenith = zenithColorForIntensity(intensity);
  const baseHorizon = new THREE.Color(SKY_HORIZON);
  // b76: sunset blend factor (= elevation 25° 以上で 0、 -5° 以下で 1、 線形)
  // 閾値を 25°/30° に拡大 ── 夏至 5:30 / 18:30 でも elevation 10-15° なので
  // ここまで取らないと夕焼けオレンジが効かない (= b76 第 1 round で判明)。
  const sunsetFactor = Math.max(0, Math.min(1, (25 - elevationDeg) / 30));
  // 夕焼け色 (= 朱赤 zenith、 鮮橙 horizon)、 elevation 低下で base から lerp で混ぜる
  const SUNSET_ZENITH = new THREE.Color(0xff6030);
  const SUNSET_HORIZON = new THREE.Color(0xffaa50);
  const zenith = baseZenith.clone().lerp(SUNSET_ZENITH, sunsetFactor);
  const horizon = baseHorizon.clone().lerp(SUNSET_HORIZON, sunsetFactor);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.max(0, Math.min(1, pos.getY(i))) ** 0.4;
    c.copy(horizon).lerp(zenith, t);
    attr.setXYZ(i, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

function buildSkyDome() {
  // 単位球。 高さ方向の分割を多めにしてグラデーションのバンディングを抑える。
  const geo = new THREE.SphereGeometry(1, 32, 64);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,  // 球の内側を見る
    fog: false,            // 空自体は fog で霞ませない
    depthWrite: false,     // 深度を書かない = 地形が常にドームの手前に描かれる
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1;       // 最初に描く純粋な背景
  dome.frustumCulled = false;  // 常にカメラを包むのでカリング対象外
  dome.scale.setScalar(DEFAULT_SPAN_M * SKY_DOME_SPAN_FACTOR);  // configureScale で実 span に更新
  // 初期色は intensity=1.0 (= 現状の SKY_ZENITH / SKY_HORIZON グラデーション)。
  paintSkyDomeColors(dome, 1);
  return dome;
}

/**
 * Three.js のシーン一式 (Scene / Renderer / Fog / 太陽光) を生成する.
 *
 * @param {{container: HTMLElement}} args - container は canvas を載せる DOM 要素。
 * @returns {object} シーン操作 API
 */
// opts.capture: true なら WebGLRenderer を preserveDrawingBuffer 付きで生成する。
// これで描画 buffer が合成後もクリアされず、 canvas.toBlob() でいつでも実画面を
// PNG 化できる (= ?cap=1 のデバッグ画面送信用)。 既定 false ── 通常運用では
// preserveDrawingBuffer の僅かなコストを払わない。
export function createScene({ container, capture = false }) {
  const scene = new THREE.Scene();
  // 背景はグラデーション青空ドーム (= MapLibre 版 sky の移植)。 単色 Color やテクスチャ背景
  // ではなく BackSide 球メッシュなので確実に描画され、 カメラを回しても天頂/地平線が正しい。
  // scene.background は万一ドームに隙間が出た時の保険として地平線色の単色を置く。
  scene.background = new THREE.Color(SKY_HORIZON);
  const skyDome = buildSkyDome();
  scene.add(skyDome);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!capture });
  // 影を shadow map で描く (= 自機の影を地形へ投影する)。 PCFSoft で影の縁を柔らかく。
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // b61: ACES tone mapping をグローバル有効化。 大気散乱の内部散乱は加算 HDR で 1 を
  // 超えうるので、 linear HDR を最終段で 1 回 ACES で LDR に畳んで白飛びを防ぐ。
  // atmosphere3d.js の注入点 (<tonemapping_fragment> 直前) が linear なのは保たれ、
  // ACES は地表 (物理散乱) と空ドームを同じ tone curve に通して地平線の色連続を担保する。
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
  container.appendChild(renderer.domElement);

  // b61: 物理ベース大気散乱。 地形 material への注入は enableAtmosphere() 経由で行う
  // (= 地形メッシュは index.js boot で後から構築されるため、 ここでは生成のみ)。
  const atmosphere = createAtmosphere(THREE);

  // 太陽 (= 平行光源)。 位置は configureScale() / setSunlightDirection() で更新する。
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  scene.add(sun);
  // 太陽光に shadow map を持たせ、 自機の影を地形へ落とす。 影オルソカメラは自機を
  // 覆う狭い範囲に絞って解像度を確保し、 focusShadowOn が毎フレーム自機へ追従させる。
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // shadow acne (影の縞ノイズ) 対策。 bias を強くすると影が物体から離れ
  // (peter panning)、 接地点で影が欠けるので、 bias は小さめにして法線方向へ
  // ずらす normalBias を主に使う ── normalBias は peter panning を起こしにくい。
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.left = -SHADOW_CAM_BASE;
  sun.shadow.camera.right = SHADOW_CAM_BASE;
  sun.shadow.camera.top = SHADOW_CAM_BASE;
  sun.shadow.camera.bottom = -SHADOW_CAM_BASE;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SHADOW_LIGHT_DIST * 2.2;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun.target);  // target は focusShadowOn が動かすので scene グラフに乗せる
  // 環境光 + 半球光 (= 陰側が真っ黒に潰れないための底上げ、 強さは固定)。
  // b61: ACES tone mapping で中間調が沈むぶんを見越し、 旧値 (ambient 0.35 / hemi 0.6)
  // より持ち上げて ACES 下で旧来の明るさに寄せた。
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202820, 0.85));

  // 光源状態。 azimuth / strength はスライダー由来、 span は地形サイズ由来。
  let sunAzimuthDeg = DEFAULT_SUN_AZIMUTH_DEG;
  let sunStrength = 1.0;   // MapLibre hillshade-exaggeration 相当 (0..1)、 既定 1.0
  let span = DEFAULT_SPAN_M;
  // b76: 現在の sky intensity を closure 保持 (= setSkyIntensity で更新、 applySun から
  // sky dome 再 paint 時に同 intensity を維持。 elevation だけ変えて base 水色濃度は不変)。
  let currentSkyIntensity = 1;
  // b75: 仰角 override。 null なら sun_model.sunElevationFromAzimuth(sunAzimuthDeg)
  // 派生 (= 既存 lightDir スライダー手動操作経路)、 数値なら NOAA 注入値で上書き
  // (= setSolarPosition 経由)。 1 軸 SoT を 2 軸に拡張する選択経路 (= C7 二重定義回避)。
  let sunElevationOverrideDeg = null;
  // b75: volumetric clouds (= subscriber)。 setCloudInstance で配線、 applySun 末尾と
  // setCloudInstance 内部で emitSunToCloud を呼び sun direction を雲に流す。
  let cloudInstanceRef = null;

  // b75: 現在の elevation を返す純関数 (= override null なら派生、 数値なら override)。
  // applySun / focusShadowOn / getSolarPosition / emitSunToCloud の 4 箇所で参照する
  // ことで SoT 単一性を保つ (= 同じ分岐式を 4 箇所に書き散らさない)。
  function currentElevationDeg() {
    return (sunElevationOverrideDeg != null)
      ? sunElevationOverrideDeg
      : sunElevationFromAzimuth(sunAzimuthDeg);
  }

  // b75: cloud の uSunDir に現在の (方位 + 仰角) 由来 direction を流す。
  // setCloudInstance / applySun の両方から呼ばれる ── どちらが先でも最新値が流れる。
  function emitSunToCloud() {
    if (!cloudInstanceRef) return;
    const el = currentElevationDeg();
    // shadow と同じ Math.max(el, 2) クランプは「光源 y が地中に潜らない」 ための制限、
    // cloud light direction は地平線下 (夜) の方向ベクトルを素直に流して shader 側で
    // HG lighting が暗くなるに任せる (= 雲の陰影が時刻連動して暗くなる)。
    const p = sunPosition(sunAzimuthDeg, el, 1);
    cloudInstanceRef.setSunDir(p.x, p.y, p.z);
  }

  function applySun() {
    // b75: elevation は override-aware (= sun_model 派生 or NOAA 注入)。 太陽が地平線下
    // (夜) でも光源 y がマイナスだと地中から照らすので、 位置計算は最低 2° でクランプ。
    const elevation = currentElevationDeg();
    const p = sunPosition(sunAzimuthDeg, Math.max(elevation, 2), span);
    sun.position.set(p.x, p.y, p.z);
    // exaggeration 0..1 を光の強度 0..2 に線形マップ。 さらに太陽が地平線下 (夜) は
    // 平行光をほぼ消す ── 北回りの「ありえない方向」では陽が差さない。
    const daylight = elevation > 0 ? 1 : 0.18;
    // b61: ACES tone mapping で中間調が沈むぶん、 旧基準 2.0 から 2.6 に持ち上げた。
    sun.intensity = Math.max(0, sunStrength) * 2.6 * daylight;
    // b76: sun color を elevation 連動 ── 高 elevation (= 昼) は cool white、
    // 低 elevation (= 朝夕) は warm orange、 朝夕の斜光が地形 hillshade で観て分かる。
    // factor = clamp((25 - elevation) / 30, 0, 1) (= elevation 25 以上で 0、 -5 で 1)
    // 閾値を 25° に拡大 ── 夏至 5:30 / 18:30 でも elevation 10-15° なので。
    const warmFactor = Math.max(0, Math.min(1, (25 - elevation) / 30));
    const COOL_WHITE = { r: 1.0, g: 1.0, b: 1.0 };
    const WARM_ORANGE = { r: 1.0, g: 0.65, b: 0.35 };
    sun.color.setRGB(
      COOL_WHITE.r * (1 - warmFactor) + WARM_ORANGE.r * warmFactor,
      COOL_WHITE.g * (1 - warmFactor) + WARM_ORANGE.g * warmFactor,
      COOL_WHITE.b * (1 - warmFactor) + WARM_ORANGE.b * warmFactor,
    );
    // b76: sky dome を elevation 連動で再 paint (= 夕焼け空グラデーション)。
    // currentSkyIntensity を維持しつつ elevation だけ変動。
    paintSkyDomeColors(skyDome, currentSkyIntensity, elevation);
    // b61: 大気散乱の太陽を地表照明と同じ太陽へ同期する。
    // b75: SoT は sunAzimuthDeg + sunElevationOverrideDeg、 currentElevationDeg() で
    // 一本化。 atmosphere は受け取るだけ。
    atmosphere.setSun(sunAzimuthDeg, Math.max(elevation, 2), daylight);
    // b75: cloud subscriber へ sun direction を流す (= 配線済なら propagate)。
    emitSunToCloud();
  }
  applySun();

  return {
    scene,
    renderer,

    // 地形メッシュ / コースリボン / マーカー等を scene に足す (= 他部品の成果物を載せる)。
    add(obj) { scene.add(obj); },
    remove(obj) { scene.remove(obj); },

    // b61: 地形 material に物理ベース大気散乱 (aerial perspective) を注入する。
    // 地形メッシュは index.js boot で後から構築されるため、 boot がメッシュ構築直後に
    // 一度だけ呼ぶ。 material.fog は false にされ、 灰色 scene.fog は地形では無効化されて
    // 物理散乱に一本化する (= リボン / ラベルは従来どおり scene.fog のまま)。
    enableAtmosphere(material) {
      if (material) atmosphere.applyTo(material);
    },

    // b62: 大気散乱パラメータ (density / betaMie / rayleighScale / mieG / sunScale) を
    // 実行時に差し替える ── 機器設定パネルの調整スライダーの配線口。uniform は共有参照
    // なので setParams の .value 書き換えが次フレームの描画に即反映される。
    setAtmosphereParams(params) {
      atmosphere.setParams(params);
    },

    // b62: 大気散乱の uniform を読む口 (= e2e がスライダー操作で uniform が実際に
    // 変わったことを観測するため)。createAtmosphere の uniforms をそのまま返す。
    getAtmosphereUniforms() {
      return atmosphere.uniforms;
    },

    // b71: 背景スフィア (= skyDome) の天頂色濃度を実行時に変える ── 機器設定パネル
    // スライダー「大気 空の青さ」 の配線口。 intensity = 0 で天頂白 (青なし)、 1.0 で現状、
    // 2.0 で深い青。 頂点カラー attribute を in-place 更新、 needsUpdate で次フレーム反映。
    setSkyIntensity(intensity) {
      currentSkyIntensity = intensity;  // b76: applySun の再 paint で同値を維持
      paintSkyDomeColors(skyDome, intensity, currentElevationDeg());
    },

    // 影オルソカメラを自機 (pos) 中心へ寄せる。 太陽光の向き (= hillshade) は変えず、
    // light の position と target を pos 基準に平行移動するだけ ── 影カメラだけが自機を
    // 覆う狭い範囲に収まり、 shadow map の解像度を自機へ集中できる。 facade が render
    // の直前に毎フレーム呼ぶ。
    focusShadowOn(pos, riderScale) {
      if (!pos) return;
      // 影オルソカメラの半幅と光源距離は自機倍率に比例させる (= shadowCameraConfig)。
      // riderScale 3.6 基準で測った錐台・光源距離を k=riderScale/3.6 倍する ── 巨大
      // ライダーでも影が錐台に収まって四角く切れず、 光源が自機の全高より高く保たれる。
      // b75: elevation は override-aware (= applySun と同 currentElevationDeg() 経由で
      // 太陽光本体と shadow camera setup の elevation を常に一致させる、 SoT 二重定義回避)。
      const elevation = currentElevationDeg();
      const elevForCalc = Math.max(elevation, 2);
      const { reach, lightDist } = shadowCameraConfig(riderScale, elevation);
      const cam = sun.shadow.camera;
      cam.left = -reach; cam.right = reach;
      cam.top = reach; cam.bottom = -reach;
      // far も光源距離に追従させる ── 巨大ライダーで光源が遠ざかっても影が near/far の
      // 外に出て消えない。 near は 1 固定 (= オルソは深度が線形、 far を伸ばしても精度安定)。
      cam.far = lightDist * 2.2;
      cam.updateProjectionMatrix();
      const d = sunPosition(sunAzimuthDeg, elevForCalc, lightDist);
      sun.position.set(pos.x + d.x, pos.y + d.y, pos.z + d.z);
      sun.target.position.set(pos.x, pos.y, pos.z);
      sun.target.updateMatrixWorld();
    },

    // 1 フレーム描画する。 camera は別部品が作るので引数で受け取る。
    // viewer 本体の tick がこれを毎フレーム呼ぶ (= 差し替え口の render())。
    render(camera) {
      // 空ドームをカメラへ追従させる ── カメラを常に球の中心に置くことで、 ドーム面が
      // 必ず near〜far の内側に収まり (= 半径は span 比例)、 視点移動でも空が破綻しない。
      skyDome.position.copy(camera.position);
      // b61: 大気散乱の透過 / 内部散乱はカメラ→地表点の距離で決まる。 カメラ位置 uniform
      // を毎フレーム更新する (= skyDome 追従と同型)。
      atmosphere.setCameraPosition(camera.position);
      renderer.render(scene, camera);
    },

    // container サイズに renderer を合わせる。 camera を渡すと aspect も更新する。
    // resize イベントの購読は facade 側が持つ (= camera と一括で扱うため)。
    resize(camera) {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
      if (camera && typeof camera.updateProjectionMatrix === 'function') {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      return { width: w, height: h };
    },

    // 地形メッシュ生成後に呼ぶ。 span (= 地形の最大辺、 m) から fog 距離と太陽距離を
    // 決める。 fog は span 比例で遠景を地平線フォグ色 (FOG_COLOR) へ溶かす ──
    // 青空の地平線と遠くの地形が霞でなじむ (= 旧来は背景の暗色へ溶かしていた)。
    configureScale(terrainSpan) {
      if (Number.isFinite(terrainSpan) && terrainSpan > 0) span = terrainSpan;
      scene.fog = new THREE.Fog(FOG_COLOR, span * 0.9, span * 2.6);
      // 空ドーム半径を地形 span に合わせる (= near 1 〜 far span*6 の内側、 span*1.5)。
      skyDome.scale.setScalar(span * SKY_DOME_SPAN_FACTOR);
      applySun();
    },

    // 太陽の方位 (0..360°)。 差し替え口 setSunlightDirection の実装。
    // b75: 手動操作経路 ── elevation override をリセットして sun_model 派生に戻す。
    // user が lightDir スライダーを触ったら NOAA 注入値を破棄して従来挙動 (= 方位 1 軸 SoT
    // + 派生仰角) に戻る、 という user 期待を encode する。
    setSunlightDirection(deg) {
      if (Number.isFinite(deg)) {
        sunAzimuthDeg = ((deg % 360) + 360) % 360;
        sunElevationOverrideDeg = null;
        applySun();
      }
    },

    // b75: NOAA 注入経路 ── 方位と仰角を独立に受ける。 viewer-maplibre.js が boot 後に
    // computeSolarPosition の戻りをそのまま流す。 null / undefined / 非 object は安全
    // no-op (= map3d_index.test.js が pin)、 azimuth / elevation のどちらか非数の場合も
    // 既存値を保つ (= NaN 防御)。
    setSolarPosition(pos) {
      if (!pos || typeof pos !== 'object') return;
      const az = pos.azimuthDeg;
      const el = pos.elevationDeg;
      if (Number.isFinite(az)) sunAzimuthDeg = ((az % 360) + 360) % 360;
      if (Number.isFinite(el)) sunElevationOverrideDeg = el;
      applySun();
    },

    // b75: 現在の太陽位置を返す (= e2e + debug 用、 integration test が override
    // リセットの挙動を pin する経路)。 override が null なら sun_model 派生値、 数値
    // なら override 値を返す。
    getSolarPosition() {
      return {
        azimuthDeg: sunAzimuthDeg,
        elevationDeg: currentElevationDeg(),
      };
    },

    // b75: volumetric clouds を subscriber として配線 ── facade boot 内で cloud 生成後に
    // 1 回だけ呼ぶ。 配線時に「現在の sun 状態を即 emit」 ── boot 順序 (= pending
    // solarPosition 反映が cloud 配線より先) でも sun が cloud に流れる。
    setCloudInstance(inst) {
      cloudInstanceRef = inst;
      emitSunToCloud();
    },

    // 陰影の強さ (0..1、 MapLibre hillshade-exaggeration 相当)。
    // 差し替え口 setSunlightStrength の実装。
    setSunlightStrength(exaggeration) {
      if (Number.isFinite(exaggeration)) {
        sunStrength = exaggeration;
        applySun();
      }
    },

    // WebGL コンテキストと DOM を解放する (= ページ離脱 / 再初期化時)。
    dispose() {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
  };
}
