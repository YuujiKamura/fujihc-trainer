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

// 背景色 (= terrain3d.html と同じ暗いネイビー、 富士の地形が映える)。
const BG_COLOR = 0x0d1117;
// 太陽の既定方位。 MapLibre の hillshade-illumination-direction 既定 135 に合わせる
// (= 同じ deg を viewer から受け取るので MapLibre 実装と見えの起点を揃える)。
const DEFAULT_SUN_AZIMUTH_DEG = 135;
// 太陽の仰角 (度)。 朝〜昼の斜め光で地形の凹凸が陰影として読める角度。
const SUN_ELEVATION_DEG = 50;
// configureScale() 前に render されても破綻しないための span 既定値 (m)。
const DEFAULT_SPAN_M = 10000;

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
 * Three.js のシーン一式 (Scene / Renderer / Fog / 太陽光) を生成する.
 *
 * @param {{container: HTMLElement}} args - container は canvas を載せる DOM 要素。
 * @returns {object} シーン操作 API
 */
export function createScene({ container }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  container.appendChild(renderer.domElement);

  // 太陽 (= 平行光源)。 位置は configureScale() / setSunlightDirection() で更新する。
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  scene.add(sun);
  // 環境光 + 半球光 (= 陰側が真っ黒に潰れないための底上げ、 強さは固定)。
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x202820, 0.6));

  // 光源状態。 azimuth / strength はスライダー由来、 span は地形サイズ由来。
  let sunAzimuthDeg = DEFAULT_SUN_AZIMUTH_DEG;
  let sunStrength = 1.0;   // MapLibre hillshade-exaggeration 相当 (0..1)、 既定 1.0
  let span = DEFAULT_SPAN_M;

  function applySun() {
    const p = sunPosition(sunAzimuthDeg, SUN_ELEVATION_DEG, span);
    sun.position.set(p.x, p.y, p.z);
    // exaggeration 0..1 を光の強度 0..2 に線形マップする。 強度 0 = 平行光が消え
    // 環境光だけ ── MapLibre で hillshade を弱めたときの「陰影が薄い」見えに対応する。
    sun.intensity = Math.max(0, sunStrength) * 2.0;
  }
  applySun();

  return {
    scene,
    renderer,

    // 地形メッシュ / コースリボン / マーカー等を scene に足す (= 他部品の成果物を載せる)。
    add(obj) { scene.add(obj); },
    remove(obj) { scene.remove(obj); },

    // 1 フレーム描画する。 camera は別部品が作るので引数で受け取る。
    // viewer 本体の tick がこれを毎フレーム呼ぶ (= 差し替え口の render())。
    render(camera) {
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
    // 決める。 fog は terrain3d.html と同じく span 比例で遠景を背景色へ溶かす。
    configureScale(terrainSpan) {
      if (Number.isFinite(terrainSpan) && terrainSpan > 0) span = terrainSpan;
      scene.fog = new THREE.Fog(BG_COLOR, span * 0.9, span * 2.6);
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
