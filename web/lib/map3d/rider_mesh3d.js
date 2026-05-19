// b12 Phase 3 部品5: Three.js ライダー 3D mesh 部品。
//
// terrain3d.html L320-379 の自転車 mesh 組立と L713-718 の配置更新を、 受け身の
// 描画 API として切り出したもの。 物理・速度は持たない ── 走行距離は viewer 本体の
// rider / 物理モジュールが出す。 ここは「距離 → mesh の置き場所」だけを担う。
//
// 座標系: 東=+X, 上=+Y(標高 m), 北=-Z。 bike model は -Z 前方。
//
// THREE は createRiderMesh3d の引数で注入する (= camera3d.js と同じ理由、 node 単体
// テスト可 + facade が単一 THREE instance を配る)。 配置の純ロジックは既存 lib の
// riderPlacementAtDistance、 ここは THREE オブジェクト生成と毎フレーム更新の薄い層。

import { riderPlacementAtDistance } from '../rider_placement.js';

// === 純関数 / 定数 (three 非依存、 単体テスト対象) ===

// 実ロードバイクのジオメトリ (= 外部検索で取得した 56cm レース用ロードバイクの実測値)。
// 出典: Trek Madone SL6 / Specialized Tarmac の 56cm ジオメトリチャート + 標準ロード値。
//   ホイールベース 983mm / チェーンステー 410mm / BB ドロップ 70mm /
//   ヘッド角・シート角 73.5° / フォークオフセット 40mm / スタック 565mm / リーチ 395mm /
//   700×28c ホイール (外径 約 678mm、 タイヤ幅 28mm)。
export const REAL_BIKE_GEOMETRY_MM = {
  wheelbase: 983, chainstay: 410, bbDrop: 70, wheelOuterDia: 678, tireWidth: 28,
};

// 自転車 unit モデルの寸法定数。 上の実ジオメトリを「実バイク全長 (ホイールベース +
// 車輪外径 ≒ 1661mm) を約 1.0 に正規化」 した値 (実 mm × 約 0.602)。 こう正規化すると
// riderScale 既定 3.6 がそのまま使え、 旧来の手書きモデルから絵の大きさが変わらない。
// wheelR は車輪トーラスの主半径、 frontZ/rearZ は前後ハブ Z (-Z 前方)。
export const BIKE_DIMENSIONS = {
  wheelR: 0.19,   // 車輪トーラス主半径 (= 700c の外半径相当を正規化)
  tubeR: 0.012,   // タイヤ太さ = トーラスのチューブ半径 (= 実タイヤ 28mm 相当、 細い)
  frontZ: -0.30,  // 前輪ハブの Z (m、 -Z 前方。 前後ハブ間隔 0.60 = 実ホイールベース正規化)
  rearZ: 0.30,    // 後輪ハブの Z (m)
};

// 自転車 unit モデルの全長 (m)。 (rearZ + wheelR) - (frontZ - wheelR)。
// 実ジオメトリ正規化で約 0.98 (= 旧来の便宜上 1.0 から実プロポーションへ寄せた)。
export function bikeTotalLength(d = BIKE_DIMENSIONS) {
  return (d.rearZ + d.wheelR) - (d.frontZ - d.wheelR);
}

// === 形状パラメータ (= 部品ごとの形状バランス、 control panel から編集) ===

// 編集可能な自転車形状パラメータの既定値。 wheelbase はホイールベース倍率
// (1.0 = 既定の前後ハブ間隔)、 他は m。 unit モデル寸法 BIKE_DIMENSIONS と整合する。
// 既定値は実ロードバイクのジオメトリ正規化値 (= BIKE_DIMENSIONS と整合)。
export const BIKE_SHAPE_DEFAULTS = {
  wheelR: 0.19,      // 車輪トーラス主半径 (= 実 700c を正規化)
  tubeR: 0.012,      // タイヤ太さ = トーラスのチューブ半径 (= 実タイヤ 28mm 相当)
  wheelbase: 1.0,    // ホイールベース倍率 (前後ハブ Z に掛ける)
  frameThick: 0.016, // フレームチューブ半径 (= 実フレームチューブ相当、 細い)
  saddleY: 0.58,     // サドルの高さ (= 実シート高 + シート角 73.5° から)
  barY: 0.50,        // ハンドルの高さ (= 実スタック 565mm 正規化から)
  barW: 0.25,        // ハンドルバーの幅 (= 実ロードバー 約 420mm 正規化)
};

// 各形状パラメータの許容範囲 [min, max]。 編集パネルのスライダー範囲と揃える。
// resolveBikeShape が範囲外の値を内側へクランプし、 壊れた mesh を作らせない。
// 既定値 (実ジオメトリ) を中央寄りに置き、 太いタイヤ等の誇張もできる幅にしてある。
export const BIKE_SHAPE_RANGE = {
  wheelR: [0.10, 0.30], tubeR: [0.006, 0.04], wheelbase: [0.6, 1.6],
  frameThick: [0.008, 0.05], saddleY: [0.40, 0.85], barY: [0.35, 0.72],
  barW: [0.15, 0.45],
};

/**
 * 部分指定の形状を既定値で補完し、 各値を許容範囲にクランプした完全な形状を返す純関数.
 *
 * control panel のスライダーは 1 個ずつ値を出すので setShape には部分オブジェクトが来る。
 * ここで既定値マージ + クランプして「常に全フィールドが揃い範囲内」 の形状にする。
 *
 * @param {object} [shape] - 部分的な形状パラメータ
 * @returns {object} 全フィールドが揃いクランプ済の形状
 */
export function resolveBikeShape(shape = {}) {
  const out = {};
  for (const key of Object.keys(BIKE_SHAPE_DEFAULTS)) {
    const v = Number(shape[key]);
    const raw = Number.isFinite(v) ? v : BIKE_SHAPE_DEFAULTS[key];
    const [lo, hi] = BIKE_SHAPE_RANGE[key];
    out[key] = Math.max(lo, Math.min(hi, raw));
  }
  return out;
}

// === ファクトリ (THREE 注入、 描画グルー) ===

// from→to を結ぶ円柱 (= フレームチューブ) を group に足す。 CylinderGeometry は
// +Y 軸基準なので quaternion で from→to 方向へ回す (terrain3d.html L320-329)。
function addBikeTube(THREE, group, material, from, to, radius) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, 10), material);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.normalize());
  group.add(mesh);
}

// 自転車の 10 部品 (車輪 2 + フレーム 6 + サドル/ハンドル 2) を group に組み付ける。
// terrain3d.html buildBikeMesh (L331-379) の移植を、 形状パラメータ shape 駆動 + 既存
// group へ追加する形に変えたもの。 shape は resolveBikeShape 済 (全フィールド揃い範囲内)。
function buildBikeParts(THREE, group, shape) {
  // 陰影で 3D の形が読めるよう StandardMaterial (= シーンの太陽光 + 環境光を受ける)。
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x18c8ff, roughness: 0.4, metalness: 0.3 });   // 明るいシアン
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x14181f, roughness: 0.75, metalness: 0.1 });  // ほぼ黒のタイヤ
  const partMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a, roughness: 0.6, metalness: 0.2 });    // サドル / ハンドル

  const { wheelR, tubeR, wheelbase, frameThick, saddleY, barY, barW } = shape;
  // 前後ハブ Z は unit モデルの値にホイールベース倍率を掛けて前後対称に伸縮する。
  const frontZ = BIKE_DIMENSIONS.frontZ * wheelbase;
  const rearZ = BIKE_DIMENSIONS.rearZ * wheelbase;
  const hubY = wheelR + tubeR;  // トーラス最下点 (= hubY - (wheelR+tubeR) = 0) が group y=0 になる高さ

  // 車輪 2 枚 (トーラス)。 既定で XY 平面のリングなので rotation.y=π/2 で
  // 車軸を X 方向にし、 車輪の円盤が進行方向 (Z) を含む面に立つ。
  for (const z of [frontZ, rearZ]) {
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(wheelR, tubeR, 12, 28), wheelMat);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(0, hubY, z);
    group.add(wheel);
  }

  // フレーム: 前後ハブ・ボトムブラケット・サドル・ハンドルを円柱で繋ぐ。
  const frontHub = new THREE.Vector3(0, hubY, frontZ);
  const rearHub = new THREE.Vector3(0, hubY, rearZ);
  // BB / サドル / ハンドルの位置は実ロードバイクのジオメトリ由来 (正規化値):
  //   BB    = 車軸線より BB ドロップ 0.042 下、 チェーンステー長で後輪寄りの Z 0.05
  //   saddle Z = 実シート setback 正規化、  bar Z = 実リーチ 395mm 正規化。
  const bb = new THREE.Vector3(0, hubY - 0.042, 0.05); // ボトムブラケット
  const saddle = new THREE.Vector3(0, saddleY, 0.17);  // サドル (高さは編集可)
  const bar = new THREE.Vector3(0, barY, -0.19);       // ハンドル付近 (高さは編集可)
  const ft = frameThick;
  addBikeTube(THREE, group, frameMat, rearHub, bb, ft);     // チェーンステー
  addBikeTube(THREE, group, frameMat, bb, saddle, ft);      // シートチューブ
  addBikeTube(THREE, group, frameMat, rearHub, saddle, ft); // シートステー
  addBikeTube(THREE, group, frameMat, bb, bar, ft);         // ダウンチューブ
  addBikeTube(THREE, group, frameMat, saddle, bar, ft);     // トップチューブ
  addBikeTube(THREE, group, frameMat, frontHub, bar, ft);   // フォーク

  // サドル / ハンドルバー (= 自転車と読めるための小さな箱)。 ハンドル幅は編集可。
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.18), partMat);
  seat.position.copy(saddle);
  group.add(seat);
  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.04, 0.05), partMat);
  handlebar.position.copy(bar);
  group.add(handlebar);
}

// rider_mesh3d を生成する。 戻り値 group を facade が scene に add する。
export function createRiderMesh3d(THREE) {
  const group = new THREE.Group();
  let currentShape = resolveBikeShape();
  buildBikeParts(THREE, group, currentShape);

  return {
    // facade が scene に追加する自転車 mesh (= THREE.Group)。
    group,

    // 部品ごとの形状を差し替えて自転車を組み直す。 group 自体 (位置 / 向き / scale) は
    // 据え置き、 子の 10 部品だけ作り直す ── facade の scene 管理 / updatePose は無改造。
    // shape は部分指定可 (= スライダー 1 個分)、 既定値マージ + クランプは resolveBikeShape。
    setShape(shape) {
      currentShape = resolveBikeShape({ ...currentShape, ...shape });
      // 旧部品の GPU リソースを解放してから作り直す (= 形状変更を繰り返してもリークしない)。
      for (const child of group.children) {
        if (child.geometry && child.geometry.dispose) child.geometry.dispose();
        if (child.material && child.material.dispose) child.material.dispose();
      }
      group.clear();
      buildBikeParts(THREE, group, currentShape);
    },

    // 毎フレーム、 走行距離からライダーを course 上の現在位置へ置く。
    // ribbonPositions / course はコース描画部品が用意する (= 部品3 の出力)。
    // 純ロジック (距離→位置/向き) は riderPlacementAtDistance、 ここは mesh への適用だけ。
    updatePose(ribbonPositions, course, distanceM) {
      const pl = riderPlacementAtDistance(ribbonPositions, course, distanceM);
      group.position.set(pl.position[0], pl.position[1], pl.position[2]);
      // bike は −Z 前方。通常オブジェクトの lookAt は +Z を対象へ向けるため、
      // 後方の点 (position − forward3d) を lookAt することで −Z が進行方向を向く。
      // up=+Y でロール 0 に固定。カメラ追従は水平の pl.forward を引き続き使う。
      group.lookAt(
        group.position.x - pl.forward3d[0],
        group.position.y - pl.forward3d[1],
        group.position.z - pl.forward3d[2]);
      return pl;
    },
  };
}
