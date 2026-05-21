// b39 区間名標識 ── 富士ヒル公式 7 landmark を Three.js billboard sprite で 3D 走路に立てる factory.
//
// 既存 labels3d.js (= 50m 間隔 segment label 約 480 個) と同型構造、 ただし入力 data が
// snapLandmarksToCourse の戻り (= snappedLandmarks 7 件) に変わる。 既存 labels3d を
// 改変せず兄弟 factory として並べる (= b39 brief § 不可侵契約)。
//
// font は landmark の方が segment label より読ませたい (= 地名認識が主目的)、
// font-size を labels3d.js の 48px から 64px に拡大、 文字色は黄色系 (#ffe066) で
// segment label の白と差別化。
//
// 位置は landmark の lat/lon そのまま (= path 上、 segment label の sideOffset 系の
// 脇逃がしは無し、 landmark は地名なので path 上で目立たせる方が認識に効く)。
//
// 表示窓制御 (= bucket 間引き) は landmark が 7 個と少ないので不要、 常時 visible。
//
// THREE は引数で受け取る (= 'three' を import しない)、 labels3d.js と同じ理由
// (= vitest environment: node で純関数を素直にテストするため)。
//
// 詳細: ~/.agents/scratch/fujihc-trainer-project/b39-section-markers-and-finish-eta.md

import { sampleHeightBilinear } from '../terrain3d.js';

// 緯度 1 度あたりのメートル (= labels3d / segment_labels.js と同値)。
const M_PER_DEG_LAT = 111320;

// 倍率 1.0 のときの landmark 標識の高さ (m)。 segment label の 2m より大きく取って
// 「区間 marker」 として一目で識別できる size。 道幅 10m を超えないため 4m に。
export const LANDMARK_BASE_HEIGHT_M = 4;

/**
 * landmark sprite の scale (幅 / 高さ、 ワールド m) を返す純関数。
 * 文字 canvas のアスペクト比を保ったまま、 倍率 labelScale で高さを変える。
 *
 * @param {number} labelScale - 表示倍率 (1.0 = 既定)
 * @param {number} aspect - 文字 canvas の幅 / 高さ比
 * @param {number} [baseHeightM=LANDMARK_BASE_HEIGHT_M] - 倍率 1.0 の landmark 高さ (m)
 * @returns {[number, number]} [幅 m, 高さ m]
 */
export function landmarkSpriteScale(labelScale, aspect, baseHeightM = LANDMARK_BASE_HEIGHT_M) {
  const h = baseHeightM * labelScale;
  return [h * aspect, h];
}

/**
 * snappedLandmarks をワールド XYZ 座標に変換する純関数。
 * 投影は terrain3d.js / labels3d.js と同一 (= 東 +X / 北 -Z、 同じ centerLat/centerLon)。
 *
 * @param {Array<{lon:number, lat:number}>} snappedLandmarks
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number, heightOffset?:number, exaggeration?:number}} geo
 * @returns {Array<[number,number,number]>}
 */
export function landmarkWorldPositions(snappedLandmarks, geo) {
  const { range, stitched, centerLat, centerLon } = geo;
  const tileSize = geo.tileSize || 256;
  const exaggeration = geo.exaggeration != null ? geo.exaggeration : 1.0;
  // landmark 中心の地面からの高さ。 既定は landmark 高さの半分 ── landmark の下端が
  // 地形に接して「地面に立つ標識」 に見える。
  const heightOffset = geo.heightOffset != null ? geo.heightOffset : LANDMARK_BASE_HEIGHT_M / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return snappedLandmarks.map((lm) => {
    const x = (lm.lon - centerLon) * mPerDegLon;       // 東 = +X
    const z = -(lm.lat - centerLat) * M_PER_DEG_LAT;   // 北 = -Z
    const demH = sampleHeightBilinear(stitched, range, lm.lat, lm.lon, tileSize);
    return [x, demH * exaggeration + heightOffset, z];
  });
}

/**
 * landmark 文字を黄色 + 暗い縁取りで描いた canvas を返す (= billboard sprite のテクスチャ源)。
 * segment label (= 白文字) と差別化するため文字色 #ffe066、 font-size 64px (= segment 48px より大)。
 * 勾配色リボン (緑〜紫) のどの色の上でも読めるよう縁取りでコントラストを確保。
 * document 依存 (= ブラウザ専用)、 createLandmarks3d からのみ呼ぶ。
 */
function makeLandmarkCanvas(text) {
  const fontPx = 64;
  const padX = 20, padY = 14;
  const font = `bold ${fontPx}px ui-monospace, "Segoe UI", "Yu Gothic", "Hiragino Sans", sans-serif`;
  const canvas = document.createElement('canvas');
  // 1 度目の getContext は文字幅の計測用。
  let ctx = canvas.getContext('2d');
  ctx.font = font;
  const textW = ctx.measureText(text).width;
  canvas.width = Math.ceil(textW + padX * 2);
  canvas.height = fontPx + padY * 2;
  // canvas のサイズ変更で 2D 描画状態がリセットされるため、 ctx を取り直して再設定。
  ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(5, fontPx * 0.18);
  ctx.strokeStyle = 'rgba(10,15,25,0.95)';
  ctx.strokeText(text, padX, canvas.height / 2);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(text, padX, canvas.height / 2);
  return canvas;
}

/**
 * landmark の billboard sprite 群を組み、 倍率制御 + dispose API を返す factory。
 *
 * @param {object} THREE - vendored three.module.js の名前空間
 * @param {{snappedLandmarks:Array<{id:string,name:string,lon:number,lat:number}>,
 *          range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number, heightOffset?:number, labelScale?:number}} opts
 * @returns {{group:object, landmarkCount:number,
 *            setLabelScale:(scale:number)=>void, dispose:()=>void}}
 */
export function createLandmarks3d(THREE, opts) {
  const snappedLandmarks = opts.snappedLandmarks || [];
  const positions = landmarkWorldPositions(snappedLandmarks, opts);

  const group = new THREE.Group();
  // entry = { sprite, texture, material, aspect, landmark }。 sprite 操作と dispose のため、
  // snappedLandmarks と Three.js オブジェクトを 1 対 1 で持つ。
  const entries = [];
  for (let i = 0; i < snappedLandmarks.length; i++) {
    // name が空の landmark は標識を出さない ── course 起点 (id='start' 等) のように
    // id は要るが viewer に出す地名が無い landmark。 course_landmarks.js を参照。
    if (!snappedLandmarks[i].name) continue;
    const canvas = makeLandmarkCanvas(snappedLandmarks[i].name);
    const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
    const texture = new THREE.CanvasTexture(canvas);
    // transparent: true が要る ── makeLandmarkCanvas は背景を塗らず文字以外を alpha 0 にする。
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(positions[i][0], positions[i][1], positions[i][2]);
    group.add(sprite);
    entries.push({ sprite, texture, material, aspect, landmark: snappedLandmarks[i] });
  }

  let labelScale = opts.labelScale != null ? opts.labelScale : 1;

  function applyScale() {
    for (const e of entries) {
      const [w, h] = landmarkSpriteScale(labelScale, e.aspect);
      e.sprite.scale.set(w, h, 1);
    }
  }
  applyScale();

  return {
    group,
    landmarkCount: entries.length,
    /** landmark 表示倍率を変える (= 機器設定の slider 連動)。 全 sprite に即反映。 */
    setLabelScale(scale) {
      labelScale = scale;
      applyScale();
    },
    /** texture / material を解放する (= course 再読込時の GPU リソース leak 防止)。 */
    dispose() {
      for (const e of entries) {
        e.texture.dispose();
        e.material.dispose();
      }
    },
  };
}
