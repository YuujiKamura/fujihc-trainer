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
const SKY_ZENITH = 0x5a9fd8;    // 天頂の青 (ACES 再調整値)
const SKY_HORIZON = 0xeef4fb;   // 地平線の青白 (ACES 再調整値)
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
// b71: skyIntensity スライダーで使う「天頂の濃さ」 を白 ↔ SKY_ZENITH ↔ 飽和深青 で
// 動かす純関数。 intensity = 0 で天頂が白 (= 空の青さゼロ)、 1.0 で現状の SKY_ZENITH、
// 2.0 で深い夜空寄りの青に振る。 horizon (地平線) はモヤの色なので不変、 zenith だけ動く。
function zenithColorForIntensity(intensity) {
  const t = Number.isFinite(intensity) ? Math.max(0, Math.min(2, intensity)) : 1;
  const base = new THREE.Color(SKY_ZENITH);
  if (t <= 1) {
    return new THREE.Color(0xffffff).lerp(base, t);
  }
  // intensity > 1 では SKY_ZENITH を深い青 (= 高高度の濃紺) 方向に lerp。
  return base.clone().lerp(new THREE.Color(0x102060), t - 1);
}

// b71: 頂点カラーを再生成する純関数 (= dome rebuild、 setSkyIntensity から呼ぶ)。
// geometry の color attribute を in-place 更新、 needsUpdate true でフレーム反映。
function paintSkyDomeColors(dome, intensity) {
  const geo = dome.geometry;
  const pos = geo.attributes.position;
  const attr = geo.attributes.color;
  const zenith = zenithColorForIntensity(intensity);
  const horizon = new THREE.Color(SKY_HORIZON);
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

  function applySun() {
    // 仰角は方位 (= 時間帯) から日周で計算する。 太陽が地平線下 (夜) でも光源の y が
    // マイナスだと地中から照らすので、 位置計算は最低 2° でクランプ。
    const elevation = sunElevationFromAzimuth(sunAzimuthDeg);
    const p = sunPosition(sunAzimuthDeg, Math.max(elevation, 2), span);
    sun.position.set(p.x, p.y, p.z);
    // exaggeration 0..1 を光の強度 0..2 に線形マップ。 さらに太陽が地平線下 (夜) は
    // 平行光をほぼ消す ── 北回りの「ありえない方向」では陽が差さない。
    const daylight = elevation > 0 ? 1 : 0.18;
    // b61: ACES tone mapping で中間調が沈むぶん、 旧基準 2.0 から 2.6 に持ち上げた。
    sun.intensity = Math.max(0, sunStrength) * 2.6 * daylight;
    // b61: 大気散乱の太陽を地表照明と同じ太陽へ同期する。 太陽の SoT は sunAzimuthDeg
    // + sun_model.js の sunElevationFromAzimuth 一本 ── atmosphere は受け取るだけ。
    atmosphere.setSun(sunAzimuthDeg, Math.max(elevation, 2), daylight);
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
      paintSkyDomeColors(skyDome, intensity);
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
      const elevation = sunElevationFromAzimuth(sunAzimuthDeg);
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
    setSunlightDirection(deg) {
      if (Number.isFinite(deg)) {
        sunAzimuthDeg = ((deg % 360) + 360) % 360;
        applySun();
      }
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
