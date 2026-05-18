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

// 自転車 unit モデルの寸法定数 (terrain3d.html L342-343)。
// 全長が 1.0 になるよう front/rear の車軸 Z 位置と車輪半径を決めてある。
export const BIKE_DIMENSIONS = {
  wheelR: 0.22,   // 車輪半径 (m)
  tubeR: 0.04,    // フレームチューブ半径 (m)
  frontZ: -0.28,  // 前輪ハブの Z (m、 -Z 前方)
  rearZ: 0.28,    // 後輪ハブの Z (m)
};

// 自転車 unit モデルの全長 (m)。 設計上ちょうど 1.0:
// (rearZ + wheelR) - (frontZ - wheelR) = 0.50 - (-0.50) = 1.0。
export function bikeTotalLength(d = BIKE_DIMENSIONS) {
  return (d.rearZ + d.wheelR) - (d.frontZ - d.wheelR);
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

// 自転車 mesh (= THREE.Group) を組む。 terrain3d.html buildBikeMesh (L331-379) の移植。
// 車輪 2 枚 (トーラス) + フレーム 6 本 (円柱) + サドル / ハンドル (箱)。
function buildBikeMesh(THREE) {
  const group = new THREE.Group();
  // 陰影で 3D の形が読めるよう StandardMaterial (= シーンの太陽光 + 環境光を受ける)。
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x18c8ff, roughness: 0.4, metalness: 0.3 });   // 明るいシアン
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x14181f, roughness: 0.75, metalness: 0.1 });  // ほぼ黒のタイヤ
  const partMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a, roughness: 0.6, metalness: 0.2 });    // サドル / ハンドル

  const { wheelR, tubeR, frontZ, rearZ } = BIKE_DIMENSIONS;
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
  const bb = new THREE.Vector3(0, hubY * 0.7, 0.05);   // ボトムブラケット
  const saddle = new THREE.Vector3(0, 0.60, 0.20);
  const bar = new THREE.Vector3(0, 0.54, -0.24);       // ハンドル付近
  const ft = 0.038;
  addBikeTube(THREE, group, frameMat, rearHub, bb, ft);     // チェーンステー
  addBikeTube(THREE, group, frameMat, bb, saddle, ft);      // シートチューブ
  addBikeTube(THREE, group, frameMat, rearHub, saddle, ft); // シートステー
  addBikeTube(THREE, group, frameMat, bb, bar, ft);         // ダウンチューブ
  addBikeTube(THREE, group, frameMat, saddle, bar, ft);     // トップチューブ
  addBikeTube(THREE, group, frameMat, frontHub, bar, ft);   // フォーク

  // サドル / ハンドルバー (= 自転車と読めるための小さな箱)。
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.18), partMat);
  seat.position.copy(saddle);
  group.add(seat);
  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.05), partMat);
  handlebar.position.copy(bar);
  group.add(handlebar);

  return group;
}

// rider_mesh3d を生成する。 戻り値 group を facade が scene に add する。
export function createRiderMesh3d(THREE) {
  const group = buildBikeMesh(THREE);

  return {
    // facade が scene に追加する自転車 mesh (= THREE.Group)。
    group,

    // 毎フレーム、 走行距離からライダーを course 上の現在位置へ置く。
    // ribbonPositions / course はコース描画部品が用意する (= 部品3 の出力)。
    // 純ロジック (距離→位置/向き) は riderPlacementAtDistance、 ここは mesh への適用だけ。
    updatePose(ribbonPositions, course, distanceM) {
      const pl = riderPlacementAtDistance(ribbonPositions, course, distanceM);
      group.position.set(pl.position[0], pl.position[1], pl.position[2]);
      // lookAt で −Z を forward3d 方向へ向け、up=+Y でロール 0 に固定。
      // setFromUnitVectors の最短回転は坂+カーブで横傾き(ロール)が出るため置き換え。
      // カメラ追従は水平の pl.forward を引き続き使う。
      group.lookAt(
        group.position.x + pl.forward3d[0],
        group.position.y + pl.forward3d[1],
        group.position.z + pl.forward3d[2]);
      return pl;
    },
  };
}
