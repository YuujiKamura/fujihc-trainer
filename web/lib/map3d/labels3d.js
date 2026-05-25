// b12 Phase3 部品7: 距離ラベル (Three.js 描画層) ── terrain3d.html に下敷きが無い純新規.
//
// 担当する差し替え口メソッド: setLabelScale(scale) / updateLabelWindow(riderDistM)。
// コースに沿って約 50m 間隔の「距離+勾配」標識を billboard sprite として立てる。
//
// 薄い描画層に徹する:
//   - ラベル点列 (= 約 50m 間隔の lon/lat/text/distance_m/slope_pct) は
//     segment_labels.js の buildSegmentLabels (純関数) が出す。 数値ロジック
//     (どの距離にどのセグメントを選び、 文字をどう整形するか) はそこが SoT。
//   - ラベル位置のワールド座標化は sampleHeightBilinear (terrain3d.js、 純関数) で
//     地形標高を引く。
//   本 module が新規に持つのは billboard sprite 描画と表示窓制御だけで、
//   ロジック部分 (窓判定 / bucket 間引き / sprite スケール) は純関数に切り出す。
//
// THREE は引数で受け取る (= 'three' を import しない)。 markers3d.js / course_ribbon3d.js
// と同じ理由 ── vitest (environment: node) で純関数を素直にテストするため。
//
// MapLibre 版 (viewer-maplibre.js) は canvas 画像 + symbol レイヤーの icon-image 方式。
// Three.js では canvas → CanvasTexture → SpriteMaterial → Sprite で「常にカメラを
// 向く立て看板」を作る ── viewer から見た「距離ラベルを出す」意味は同じ。
//
// 座標系 SoT: 東 = +X、 上 = +Y、 北 = -Z。 terrain3d.js と一致。

import { buildSegmentLabels } from '../segment_labels.js';
import { sampleHeightBilinear } from '../terrain3d.js';

// 緯度 1 度あたりのメートル (= terrain3d.js / segment_labels.js と同値)。
const M_PER_DEG_LAT = 111320;

// ラベル目標間隔 (m)。 設計メモ部品7「約 50m 間隔」。
export const LABEL_INTERVAL_M = 50;
// ラベルをコース路面の脇に逃がす量 (m)。 勾配色リボンを文字で隠さないため。
// 2026-05-18: ラベル同士・コースとの重なりを user 指摘、 6m → 12m に拡げて横へ逃がす。
export const LABEL_SIDE_OFFSET_M = 12;
// 表示窓: ライダー現在地の後方 / 前方 (m)。 窓外のラベルは非表示にする。
export const LABEL_WINDOW_BACK_M = 150;
export const LABEL_WINDOW_FWD_M = 450;
// 表示窓更新の間引き刻み (m)。 ライダーがこの刻みの bucket を跨いだ時だけ
// 窓を再計算する (= 毎フレーム全 sprite を走査しない、 MapLibre 版の lastLabelBucket 相当)。
export const LABEL_BUCKET_M = 50;
// 倍率 1.0 のときの看板の高さ (m)。 道路リボン (widthM 10m) の脇に立つ標識として、
// ride 視点 (= カメラがコース上、 看板が前方数十 m) で読めて画面を覆わない大きさ。
// 旧値 40m → 8m → 4m → 2m と段階的に縮小。 2026-05-19: 4m は道幅 10m を幅 16m で超えると指摘、 2m (幅 8m) に。
export const LABEL_BASE_HEIGHT_M = 2;

/**
 * ライダー距離を表示窓更新の bucket index に量子化する純関数.
 * updateLabelWindow はこの bucket が変わった時だけ窓を再計算する。
 *
 * @param {number} distM - ライダー現在距離 (m)
 * @returns {number} bucket index (= floor(distM / LABEL_BUCKET_M))
 */
export function labelDistanceBucket(distM) {
  return Math.floor((distM || 0) / LABEL_BUCKET_M);
}

/**
 * 各ラベルがライダー近傍の表示窓 [riderDistM - backM, riderDistM + fwdM] 内かを返す純関数.
 *
 * @param {Array<{distance_m:number}>} labels - buildSegmentLabels の戻り値
 * @param {number} riderDistM - ライダー現在距離 (m)
 * @param {number} [backM=LABEL_WINDOW_BACK_M] - 後方の窓幅 (m)
 * @param {number} [fwdM=LABEL_WINDOW_FWD_M] - 前方の窓幅 (m)
 * @returns {boolean[]} labels と同じ長さ、 各要素 = 窓内なら true
 */
export function labelWindowFlags(labels, riderDistM, backM = LABEL_WINDOW_BACK_M,
                                 fwdM = LABEL_WINDOW_FWD_M) {
  const lo = riderDistM - backM;
  const hi = riderDistM + fwdM;
  return labels.map((l) => l.distance_m >= lo && l.distance_m <= hi);
}

/**
 * 看板 sprite の scale (幅 / 高さ、 ワールド m) を返す純関数.
 * 文字 canvas のアスペクト比を保ったまま、 倍率 labelScale で高さを変える。
 *
 * @param {number} labelScale - 表示倍率 (1.0 = 既定)
 * @param {number} aspect - 文字 canvas の幅 / 高さ比
 * @param {number} [baseHeightM=LABEL_BASE_HEIGHT_M] - 倍率 1.0 の看板高さ (m)
 * @returns {[number, number]} [幅 m, 高さ m]
 */
export function labelSpriteScale(labelScale, aspect, baseHeightM = LABEL_BASE_HEIGHT_M) {
  const h = baseHeightM * labelScale;
  return [h * aspect, h];
}

/**
 * ラベル点列を地形上のワールド XYZ 座標に変換する純関数.
 *
 * 投影は terrain3d.js と同一 (= 東 +X / 北 -Z、 同じ centerLat/centerLon)。
 * 高さは sampleHeightBilinear で DEM 標高を引き、 heightOffset だけ持ち上げて
 * 看板が地形にめり込まないようにする。
 *
 * @param {Array<{lon:number, lat:number}>} labels - buildSegmentLabels の戻り値
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number, heightOffset?:number}} geo
 * @returns {Array<[number,number,number]>} 各ラベルの [x, y, z]
 */
export function labelWorldPositions(labels, geo) {
  const { range, stitched, centerLat, centerLon } = geo;
  const tileSize = geo.tileSize || 256;
  // exaggeration を掛けて地形メッシュの頂点 Y と揃える (exaggeration≠1 でのズレを防ぐ)。
  const exaggeration = geo.exaggeration != null ? geo.exaggeration : 1.0;
  // 看板中心の地面からの高さ。 既定は看板高さの半分 ── 看板の下端が地形に接して
  // 「地面に立つ立て看板」に見える。 旧既定 LABEL_BASE_HEIGHT_M は看板高さ 1 個ぶん
  // 持ち上げて宙に浮かせていた。
  const heightOffset = geo.heightOffset != null ? geo.heightOffset : LABEL_BASE_HEIGHT_M / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return labels.map((l) => {
    const x = (l.lon - centerLon) * mPerDegLon;          // 東 = +X
    const z = -(l.lat - centerLat) * M_PER_DEG_LAT;      // 北 = -Z
    const demH = sampleHeightBilinear(stitched, range, l.lat, l.lon, tileSize);
    return [x, demH * exaggeration + heightOffset, z];
  });
}

/**
 * ラベル文字を白字 + 暗い縁取りで描いた canvas を返す (= billboard sprite のテクスチャ源).
 * 勾配色リボン (緑〜紫) のどの色の上でも読めるよう縁取りでコントラストを確保する。
 * document 依存 (= ブラウザ専用)。 createLabels3d からのみ呼ぶ。
 */
function makeLabelCanvas(text) {
  const fontPx = 48;
  const padX = 16, padY = 12;
  const font = `bold ${fontPx}px ui-monospace, "Segoe UI", monospace`;
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
  ctx.lineWidth = Math.max(4, fontPx * 0.16);
  ctx.strokeStyle = 'rgba(15,20,30,0.92)';
  ctx.strokeText(text, padX, canvas.height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, padX, canvas.height / 2);
  return canvas;
}

/**
 * 距離ラベルの billboard sprite 群を組み、 倍率 / 表示窓の制御 API を返す factory.
 *
 * @param {object} THREE - vendored three.module.js の名前空間 (= 呼び出し側が import)
 * @param {{polygonFC:object, range:object, stitched:object, centerLat:number,
 *          centerLon:number, tileSize?:number, heightOffset?:number,
 *          labelScale?:number}} opts
 *   polygonFC = buildGradeColoredRoadPolygons の戻り値 (Polygon FeatureCollection)。
 *   range/stitched/centerLat/centerLon = ラベル位置のワールド座標化に使う投影パラメータ。
 * @returns {{group:object, labelCount:number,
 *            setLabelScale:(scale:number)=>void,
 *            updateLabelWindow:(riderDistM:number)=>boolean,
 *            dispose:()=>void}}
 *   group = scene.add() する Three.js Group。 全ラベル sprite を含む。
 */
export function createLabels3d(THREE, opts) {
  const labels = buildSegmentLabels(opts.polygonFC, LABEL_INTERVAL_M, LABEL_SIDE_OFFSET_M);
  const positions = labelWorldPositions(labels, opts);

  const group = new THREE.Group();
  // entry = { sprite, texture, material, aspect, distance_m }。 sprite 操作と
  // dispose のため、 純関数の出力 (labels) と Three.js オブジェクトを 1 対 1 で持つ。
  const entries = [];
  for (let i = 0; i < labels.length; i++) {
    const canvas = makeLabelCanvas(labels[i].text);
    const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
    const texture = new THREE.CanvasTexture(canvas);
    // transparent: true が要る ── makeLabelCanvas は背景を塗らず文字以外を alpha 0
    // (透明) にしている。 transparent を付けないと Three.js が alpha ブレンドせず、
    // 透明部分が黒く描かれて看板が黒い四角になる。
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    // user 指示「テキスト矩形の左端揃え」 ── Three.js Sprite の anchor は default
    // {0.5, 0.5} (= 中央)、 これだと数字の桁数で sprite 中央点が動き、 連続する距離
    // ラベル (= 0.05km / 0.10km / 1.20km ...) が桁ぐりで揃わない。 center.x=0 に
    // すると position 座標が canvas (= テキスト矩形) の左端に対応、 全ラベルが
    // 始端揃いになる。 y=0.5 で縦中央は維持 (= 地形上の高さ計算は中央基準のまま)。
    if (sprite.center && typeof sprite.center.set === 'function') {
      sprite.center.set(0, 0.5);
    }
    sprite.position.set(positions[i][0], positions[i][1], positions[i][2]);
    group.add(sprite);
    entries.push({ sprite, texture, material, aspect, distance_m: labels[i].distance_m });
  }

  let labelScale = opts.labelScale != null ? opts.labelScale : 1;
  let currentBaseHeightM = LABEL_BASE_HEIGHT_M;
  let lastBucket = null;

  function applyScale() {
    for (const e of entries) {
      const [w, h] = labelSpriteScale(labelScale, e.aspect, currentBaseHeightM);
      e.sprite.scale.set(w, h, 1);
    }
  }
  applyScale();  // 初期倍率を反映 (= sprite のデフォルト 1x1 のままにしない)。

  return {
    group,
    labelCount: entries.length,
    /** ラベル表示倍率を変える (= 機器設定の slider 連動)。 全 sprite に即反映。 */
    setLabelScale(scale) {
      labelScale = scale;
      applyScale();
    },
    /** ラベル基準高さを変える。 全 sprite の scale と position を更新する。 */
    setLabelHeight(heightM) {
      const delta = (heightM - currentBaseHeightM) / 2;
      for (const e of entries) {
        e.sprite.position.y += delta;
      }
      currentBaseHeightM = heightM;
      applyScale();
    },
    /** 全 sprite の Y 座標を deltaY だけシフトする (= setRoadHeight から呼ばれる)。 */
    shiftY(deltaY) {
      for (const e of entries) {
        e.sprite.position.y += deltaY;
      }
    },
    /**
     * 表示窓をライダー現在地に追従させる。 bucket (50m 刻み) が変わった時だけ
     * 全 sprite の visible を窓判定で更新する。
     * @returns {boolean} 実際に窓を更新したら true、 bucket 不変で skip したら false
     */
    updateLabelWindow(riderDistM) {
      const bucket = labelDistanceBucket(riderDistM);
      if (bucket === lastBucket) return false;
      lastBucket = bucket;
      const flags = labelWindowFlags(labels, riderDistM);
      for (let i = 0; i < entries.length; i++) {
        entries[i].sprite.visible = flags[i];
      }
      return true;
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
