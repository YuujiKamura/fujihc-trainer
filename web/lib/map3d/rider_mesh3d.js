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

// 1 輪 (タイヤ + ハブ + スポーク) を target グループの原点中心に組む。 target は
// updatePose が rotation.x で回す = 走行中に車輪が転がる。 スポークの組み方は実車
// どおり前後で変える (= 外部検索で確認):
//  - 前輪 = ラジアル組: ハブから真っ直ぐリムへ放射状 (駆動トルクが無く軽さ優先)。
//  - 後輪 = クロス組: ハブ側を接線方向へずらし隣のスポークと交差 (駆動トルクを伝える)。
function buildWheel(THREE, target, wheelMat, spokeMat, wheelR, tubeR, isFront) {
  const hubR = wheelR * 0.12;       // ハブ (フランジ) 半径
  const flangeHalf = 0.024;         // 左右フランジの X 半幅 (= スポークを左右へ振り分ける)
  const rimR = wheelR - tubeR;      // スポークが届くリム面 (= タイヤ内縁)
  const SPOKE_N = 16;               // スポーク本数 (実車 20-28、 描画は間引き)
  const tyre = new THREE.Mesh(
    new THREE.TorusGeometry(wheelR, tubeR, 12, 28), wheelMat);
  tyre.rotation.y = Math.PI / 2;    // トーラスの軸を X (車軸) 方向へ
  target.add(tyre);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubR, hubR, flangeHalf * 2, 12), spokeMat);
  hub.rotation.z = Math.PI / 2;     // 円筒の軸を X (車軸) 方向へ
  target.add(hub);
  // クロス組はハブ側の角度を接線方向へ 3 本分ずらす (= 3 クロス相当)、 ラジアルは 0。
  const cross = isFront ? 0 : (Math.PI * 2 / SPOKE_N) * 3;
  for (let i = 0; i < SPOKE_N; i++) {
    const rim = (i / SPOKE_N) * Math.PI * 2;               // リム側の円周角
    const side = (i % 2 === 0) ? flangeHalf : -flangeHalf;  // 左右フランジ交互
    const from = new THREE.Vector3(
      side, hubR * Math.sin(rim + cross), hubR * Math.cos(rim + cross));
    const to = new THREE.Vector3(
      0, rimR * Math.sin(rim), rimR * Math.cos(rim));
    addBikeTube(THREE, target, spokeMat, from, to, 0.0035);  // 細いスポーク
  }
}

// ペダル 1 つ (= スピンドル + 踏み面) をグループにして返す。 グループ原点 = クランク
// 先端。 side = +1 (右、 スピンドルが +X 外側へ) / -1 (左)。 SPD-SL は片面クリップレス
// ── スピンドルがクランクにねじ込まれ、 その外側に前後へ長い平たい踏み面が付く。
function buildPedal(THREE, mat, side) {
  const g = new THREE.Group();
  const axleLen = 0.035;  // スピンドル長 (クランク先端から車軸と平行に外側へ)
  addBikeTube(THREE, g, mat,
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(side * axleLen, 0, 0), 0.007);
  // 踏み面: SPD-SL の前後に長い平たいプラットフォーム。
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.085), mat);
  body.position.set(side * (axleLen + 0.026), 0, 0);
  g.add(body);
  return g;
}

// クランク 2 本 + ペダル + チェーンリングを target グループの原点 (= BB) 中心に組む。
// target は updatePose が rotation.x で回す = 走行中に駆動系が回る。 クランクは 180°
// 位相差。 X はチェーンステー端より外に置き、 後三角と干渉させない。 戻り値はペダル
// グループ 2 つ ── updatePose が crankSet 回転を打ち消す逆回転を与え、 踏み面を常に
// コースと水平に保つ (= 実車のペダルがスピンドルで自由回転し踏み面を保つのと同じ)。
function buildCrankset(THREE, target, mat, wheelR) {
  const crankHalf = 0.052;          // BB からクランクが出る X 半幅 (= チェーンステー端より外)
  const crankLen = 0.10;            // クランクアーム長 (= 実 165-175mm を正規化)
  const ringR = wheelR * 0.34;      // チェーンリング半径 (= 50t 相当、 車輪の約 1/3 径)
  // 右クランク = 真下、 左クランク = 真上 (180° 位相)。 グループ回転で両方が回る。
  const endR = new THREE.Vector3(crankHalf, -crankLen, 0);
  const endL = new THREE.Vector3(-crankHalf, crankLen, 0);
  addBikeTube(THREE, target, mat, new THREE.Vector3(crankHalf, 0, 0), endR, 0.013);
  addBikeTube(THREE, target, mat, new THREE.Vector3(-crankHalf, 0, 0), endL, 0.013);
  // ペダル: クランク先端にスピンドルで付くペダルグループ。 向きは updatePose が水平に保つ。
  const pedalR = buildPedal(THREE, mat, 1);
  pedalR.position.copy(endR);
  target.add(pedalR);
  const pedalL = buildPedal(THREE, mat, -1);
  pedalL.position.copy(endL);
  target.add(pedalL);
  // チェーンリング: 車軸 X 向きの薄い円盤。 チェーンステー端より外の X に置く。
  const chainring = new THREE.Mesh(
    new THREE.CylinderGeometry(ringR, ringR, 0.006, 24), mat);
  chainring.rotation.z = Math.PI / 2;
  chainring.position.set(crankHalf, 0, 0);
  target.add(chainring);
  return [pedalR, pedalL];
}

// リムブレーキ (サイドプルキャリパー) を 1 つ group に足す。 実車では前ブレーキは
// フォーククラウン、 後ブレーキはシートステーに本体が留まり、 中央ピボットから左右の
// アームが車輪リムを挟む (= 外部検索で確認)。 mountZ = フレーム取り付け側の Z、
// wheelCenterZ = 車輪中心の Z、 rimTopY = 車輪リム最上部の Y。 車輪とは回らない。
function addRimBrake(THREE, group, mat, mountZ, wheelCenterZ, rimTopY) {
  const bodyY = rimTopY + 0.024;
  // 本体 (中央ピボット) はフレーム取り付け点 (クラウン / シートステー) 側に寄せる。
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.042, 0.02), mat);
  body.position.set(0, bodyY, mountZ);
  group.add(body);
  const armX = 0.027;  // アーム下端がリムを左右から挟む幅
  // 左右アーム: 本体から車輪リム最上部 (車輪中心の真上) の左右へ斜めに伸ばす。
  addBikeTube(THREE, group, mat,
    new THREE.Vector3(0, bodyY, mountZ),
    new THREE.Vector3(-armX, rimTopY, wheelCenterZ), 0.007);
  addBikeTube(THREE, group, mat,
    new THREE.Vector3(0, bodyY, mountZ),
    new THREE.Vector3(armX, rimTopY, wheelCenterZ), 0.007);
}

// グループ木を再帰的に辿り geometry / material の GPU リソースを解放する。
function disposeTree(obj) {
  for (const child of obj.children || []) {
    disposeTree(child);
    if (child.geometry && child.geometry.dispose) child.geometry.dispose();
    if (child.material && child.material.dispose) child.material.dispose();
  }
}

// 自転車を group に組み付ける。 車輪 2 組と駆動系は回転サブグループにまとめて返し、
// updatePose が走行距離に応じて回す。 各部位の構造は実ロードバイクを外部検索で確認:
//  - フォーク: ステアラー → クラウン (幅のある接合部) → 左右平行なブレード 2 本 → 前ハブ。
//  - 後三角: シートステーはシートクラスタ (シートチューブ上端) で左右に枝分かれし、
//    後輪上部を ±X で挟んで後ハブへ。 チェーンステーも BB シェル幅から末広がりで挟む。
//  - サドル: 後ろが太く前が細いテーパー形状 (= 上下異径の円柱を倒し平たく潰す)。
//  - ハンドル: ブルホーンバー。 中央の水平トップ + 左右端から前方かつ上向きに伸びる角。
//  - 駆動系: BB から左右へクランクアーム 2 本 (180° 位相) + ペダル + チェーンリング。
//  - リムブレーキ: 前後輪のリム上に跨がるキャリパー 2 セット (本体 + 左右アーム)。
//  - 影: 全 Mesh に castShadow。 さらに bike 足元に影専用の透明ボード (ShadowMaterial)
//    を bike にくっつけて置き、 自機の影をそこで受ける ── 影が常に bike に追従する。
// group 直下 = 前輪/後輪/駆動系の 3 グループ + フレーム 14 + サドル 1 + ハンドル 3 +
//   リムブレーキ 6 + 影ボード 1 = 計 28。 shape は resolveBikeShape 済。
function buildBikeParts(THREE, group, shape) {
  // 陰影で 3D の形が読めるよう StandardMaterial (= シーンの太陽光 + 環境光を受ける)。
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x18c8ff, roughness: 0.4, metalness: 0.3 });   // 明るいシアン (フレーム)
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x14181f, roughness: 0.75, metalness: 0.1 });  // ほぼ黒のタイヤ
  const partMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f3a, roughness: 0.6, metalness: 0.2 });    // サドル / ハンドル / 駆動系
  const spokeMat = new THREE.MeshStandardMaterial({
    color: 0xaeb6c0, roughness: 0.35, metalness: 0.7 });   // 銀色 (ハブ / スポーク)

  const { wheelR, tubeR, wheelbase, frameThick, saddleY, barY, barW } = shape;
  // 前後ハブ Z は unit モデルの値にホイールベース倍率を掛けて前後対称に伸縮する。
  const frontZ = BIKE_DIMENSIONS.frontZ * wheelbase;
  const rearZ = BIKE_DIMENSIONS.rearZ * wheelbase;
  const hubY = wheelR + tubeR;  // トーラス最下点 (= hubY - (wheelR+tubeR) = 0) が group y=0 になる高さ

  // 車輪 2 組。 各組は回転グループに入れ、 グループ position でハブ位置へ運ぶ。
  const frontWheel = new THREE.Group();
  buildWheel(THREE, frontWheel, wheelMat, spokeMat, wheelR, tubeR, true);
  frontWheel.position.set(0, hubY, frontZ);
  group.add(frontWheel);
  const rearWheel = new THREE.Group();
  buildWheel(THREE, rearWheel, wheelMat, spokeMat, wheelR, tubeR, false);
  rearWheel.position.set(0, hubY, rearZ);
  group.add(rearWheel);

  // フレーム結節点 ── 実ロードバイクの三面図のレイアウトに合わせた正規化座標。
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const ft = frameThick;
  const hubHalf = 0.045;      // 車軸端の X 半幅 (= ブレード/ステーが車輪を挟む量)
  const bbHalf = 0.025;       // BB シェルの X 半幅 (= チェーンステーの起点)
  const clusterHalf = 0.020;  // シートクラスタの X 半幅 (= シートステーの枝分かれ元)
  const bb = V(0, hubY - 0.042, 0.05);                   // BB (車軸線より BB ドロップ下)
  const seatTubeTop = V(0, bb.y + 0.29, bb.z + 0.085);   // シートチューブ上端 (シート角 73.5°)
  const headTop = V(0, bb.y + 0.34, bb.z - 0.238);       // head tube 上端 (実スタック/リーチ)
  const headBottom = V(0, headTop.y - 0.086, headTop.z - 0.026); // head tube 下端 = クラウン位置
  const saddle = V(0, saddleY, seatTubeTop.z + 0.04);    // サドル中心 (高さは編集可)
  const bar = V(0, barY, headTop.z - 0.06);              // ハンドル中心 (高さは編集可、 ステム先)
  // 前後ハブ・BB シェル・フォーククラウン・シートクラスタの左右端。
  const frontHubL = V(-hubHalf, hubY, frontZ), frontHubR = V(hubHalf, hubY, frontZ);
  const rearHubL = V(-hubHalf, hubY, rearZ), rearHubR = V(hubHalf, hubY, rearZ);
  const bbL = V(-bbHalf, bb.y, bb.z), bbR = V(bbHalf, bb.y, bb.z);
  const crownL = V(-hubHalf, headBottom.y, headBottom.z), crownR = V(hubHalf, headBottom.y, headBottom.z);
  const clstrL = V(-clusterHalf, seatTubeTop.y, seatTubeTop.z);
  const clstrR = V(clusterHalf, seatTubeTop.y, seatTubeTop.z);

  // 中央 1 本のフレーム 6 本 (前三角 + head tube + シートポスト + ステム)。
  addBikeTube(THREE, group, frameMat, bb, seatTubeTop, ft);          // シートチューブ
  addBikeTube(THREE, group, frameMat, bb, headBottom, ft);           // ダウンチューブ
  addBikeTube(THREE, group, frameMat, seatTubeTop, headTop, ft);     // トップチューブ
  addBikeTube(THREE, group, frameMat, headTop, headBottom, ft * 1.4); // head tube (ステアラー)
  addBikeTube(THREE, group, frameMat, seatTubeTop, saddle, ft);      // シートポスト
  addBikeTube(THREE, group, frameMat, headTop, bar, ft);             // ステム
  // フォーク 3 本: クラウン (幅のある接合部) + 左右平行なブレード 2 本。
  addBikeTube(THREE, group, frameMat, crownL, crownR, ft * 1.4);     // フォーククラウン
  addBikeTube(THREE, group, frameMat, crownL, frontHubL, ft);        // フォークブレード (左)
  addBikeTube(THREE, group, frameMat, crownR, frontHubR, ft);        // フォークブレード (右)
  // 後三角 5 本: シートクラスタブリッジ + チェーンステー 2 + シートステー 2。
  // シートステーはクラスタの ±X 端から出る = 後輪上部を挟む「枝分かれ」、 1 点 V 字ではない。
  addBikeTube(THREE, group, frameMat, clstrL, clstrR, ft * 1.4);     // シートクラスタブリッジ
  addBikeTube(THREE, group, frameMat, bbL, rearHubL, ft);            // チェーンステー (左)
  addBikeTube(THREE, group, frameMat, bbR, rearHubR, ft);            // チェーンステー (右)
  addBikeTube(THREE, group, frameMat, clstrL, rearHubL, ft);         // シートステー (左)
  addBikeTube(THREE, group, frameMat, clstrR, rearHubR, ft);         // シートステー (右)

  // サドル: 後ろが太く前 (-Z) が細いテーパー。 上下異径の円柱を前後 (Z) に倒し、
  // scale で上下に潰して平たくする。 CylinderGeometry(後径, 前径, 長さ)。
  const saddleMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.018, 0.22, 16), partMat);
  saddleMesh.rotation.x = Math.PI / 2;     // 円柱の軸 (+Y) を Z (前後) 方向へ倒す
  saddleMesh.scale.set(1, 1, 0.42);        // 上下に潰して平たいサドルに
  saddleMesh.position.copy(saddle);
  group.add(saddleMesh);

  // ハンドル 3 本: ブルホーンバー。 中央の水平トップ + 左右端から前方かつ上向きに
  // 伸びる角 2 本 (= 牛の角、 ブルホーンは端が前上方を向く)。
  const barHalf = barW / 2;
  const barL = V(bar.x - barHalf, bar.y, bar.z), barR = V(bar.x + barHalf, bar.y, bar.z);
  const hornL = V(barL.x, bar.y + 0.05, bar.z - 0.11);   // 前 (-Z) かつ 上 (+Y)
  const hornR = V(barR.x, bar.y + 0.05, bar.z - 0.11);
  addBikeTube(THREE, group, partMat, barL, barR, 0.012);   // 中央トップバー
  addBikeTube(THREE, group, partMat, barL, hornL, 0.012);  // 角 (左)
  addBikeTube(THREE, group, partMat, barR, hornR, 0.012);  // 角 (右)

  // リムブレーキ 2 セット: 前=フォーククラウン側 / 後=シートステー側に本体を留め、
  // 左右アームが車輪リムを挟む。 車輪とは回らないので回転グループの外 (group 直下)。
  addRimBrake(THREE, group, partMat, (headBottom.z + frontZ) / 2, frontZ, hubY + wheelR);
  addRimBrake(THREE, group, partMat, rearZ - 0.04, rearZ, hubY + wheelR);

  // 影ボード: bike 足元の影専用の透明な板。 ShadowMaterial は影が落ちた所だけ
  // 半透明で描き、 板自体は透明。 bike group の子なので影が常に bike にくっつき、
  // 傾き (コース勾配) にも沿う。 bike 中心は updatePose で必ずコース面に乗るので、
  // この板もコース面 ── 浮かない・刺さらない。 crankSet より前に足し children 末尾は
  // crankSet に保つ。
  const shadowBoard = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.ShadowMaterial({ opacity: 0.38 }));
  shadowBoard.rotation.x = -Math.PI / 2;   // 水平に寝かせる
  shadowBoard.position.set(0, 0.012, 0);   // bike 足元、 コース面のわずか上
  shadowBoard.receiveShadow = true;
  shadowBoard.visible = false;             // 既定オフ (= setShadowBoard で切り替え)
  shadowBoard.name = 'shadowBoard';        // setShadowBoard / テストが children から拾う目印
  group.add(shadowBoard);

  // 駆動系: クランク 2 本 + ペダル + チェーンリングを回転グループに入れ、 BB 位置へ運ぶ。
  const crankSet = new THREE.Group();
  const pedals = buildCrankset(THREE, crankSet, partMat, wheelR);
  crankSet.position.set(0, bb.y, bb.z);
  group.add(crankSet);

  // 全 Mesh に castShadow を立てる。 影ボードだけは影を受ける側なので除外する。
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  shadowBoard.castShadow = false;

  return { frontWheel, rearWheel, crankSet, pedals, shadowBoard };
}

// 走行距離 → 車輪回転角の換算半径 (m)。 700×28c の転がり半径 ≒ 0.34m、 回転角 = 距離 / 半径。
const WHEEL_ROLL_RADIUS_M = 0.34;
// 車輪 1 回転あたりクランクは 1/CRANK_GEAR_RATIO 回転 (= チェーンリング/スプロケのギア比)。
const CRANK_GEAR_RATIO = 2.0;

// rider_mesh3d を生成する。 戻り値 group を facade が scene に add する。
export function createRiderMesh3d(THREE) {
  const group = new THREE.Group();
  let currentShape = resolveBikeShape();
  let shadowBoardOn = false;   // 影ボード (足元の影専用ボード) の表示状態 ── 既定オフ
  // 車輪 2 組 + 駆動系の回転グループ。 updatePose が走行距離に応じて回す。
  let spinners = buildBikeParts(THREE, group, currentShape);

  return {
    // facade が scene に追加する自転車 mesh (= THREE.Group)。
    group,

    // 部品ごとの形状を差し替えて自転車を組み直す。 group 自体 (位置 / 向き / scale) は
    // 据え置き、 子の部品だけ作り直す ── facade の scene 管理 / updatePose は無改造。
    // shape は部分指定可 (= スライダー 1 個分)、 既定値マージ + クランプは resolveBikeShape。
    setShape(shape) {
      currentShape = resolveBikeShape({ ...currentShape, ...shape });
      // 旧部品の GPU リソースを (グループ木を辿って) 解放してから作り直す。
      disposeTree(group);
      group.clear();
      spinners = buildBikeParts(THREE, group, currentShape);
      spinners.shadowBoard.visible = shadowBoardOn;  // 組み直し後も影ボードの表示状態を保つ
    },

    // 影ボード (足元の影専用の透明ボード) の表示を切り替える。 既定オフ ── オンにすると
    // 影が bike にくっつき、 オフでは影はコースリボンが受ける。 facade 経由で呼ばれる。
    setShadowBoard(on) {
      shadowBoardOn = !!on;
      spinners.shadowBoard.visible = shadowBoardOn;
    },

    // 毎フレーム、 走行距離からライダーを course 上の現在位置へ置き、 車輪と駆動系を回す。
    // 中心は distanceM のコース点そのもの (= 必ずコース面に乗る)、 向き (ピッチ) は前後
    // ±車軸間隔/2 の 2 点で決める。 中心を 2 点の中点にすると、 コースが曲がる急勾配
    // 区間で中点がコース曲面から浮く (弦は曲面の内側を通る) ので、 位置は中心点だけ・
    // 向きだけ 2 点。 こうして「剛体 bike をコースの傾きに沿わせつつ浮かせない」。
    updatePose(ribbonPositions, course, distanceM, spinAngle = null) {
      // 前後の車軸間隔 (m) = unit モデルの前後ハブ間隔 × wheelbase × group scale。
      const wheelbaseM = (BIKE_DIMENSIONS.rearZ - BIKE_DIMENSIONS.frontZ)
        * currentShape.wheelbase * (group.scale.x || 1);
      const half = wheelbaseM / 2;
      const center = riderPlacementAtDistance(ribbonPositions, course, distanceM);
      const front = riderPlacementAtDistance(ribbonPositions, course, distanceM + half);
      const rear = riderPlacementAtDistance(ribbonPositions, course, distanceM - half);
      // bike 中心 = distanceM のコース点 (中点ではない ── 中点はカーブで浮く)。
      const cx = center.position[0], cy = center.position[1], cz = center.position[2];
      group.position.set(cx, cy, cz);
      // bike の向き = 後輪→前輪。 bike は −Z 前方、 lookAt は +Z を対象へ向けるので
      // 後方の点 (中心 − 前方ベクトル) を lookAt する。 up=+Y でロール 0 に固定。
      let fx = front.position[0] - rear.position[0];
      let fy = front.position[1] - rear.position[1];
      let fz = front.position[2] - rear.position[2];
      const flen = Math.hypot(fx, fy, fz) || 1;
      fx /= flen; fy /= flen; fz /= flen;
      group.lookAt(cx - fx, cy - fy, cz - fz);
      // 走行距離 → 車輪回転 (= 速度 × 700C 仮定、 user 指示)。 bike は -Z 前方なので前進で
      // 車輪上部は前へ転がる = 車軸 (ローカル X) まわりの回転。 半径 0.34m は 700×28C 転がり
      // 半径標準値、 周長 ≈ 2.14m / 1 回転、 速度 20km/h ≈ 5.56m/s で約 2.6Hz の回転。
      const roll = -distanceM / WHEEL_ROLL_RADIUS_M;
      spinners.frontWheel.rotation.x = roll;
      spinners.rearWheel.rotation.x = roll;
      // user 指示「ケイデンスに合わせてペダル回転」 ── crank rotation は spinAngle (= rider.js が
      // cadence rpm × dt で累積した真の cadence ベース角) を使う。 trainer の cadence 信号が
      // そのまま反映、 ギア比固定の距離フォールバック (= roll / CRANK_GEAR_RATIO) は spinAngle
      // が無い時 (= 後方互換 / 既存 test) のみに残す。
      const crankRot = (spinAngle != null && Number.isFinite(spinAngle))
        ? -spinAngle
        : (roll / CRANK_GEAR_RATIO);
      spinners.crankSet.rotation.x = crankRot;
      // ペダルの踏み面は常にコースと水平 ── crankSet の回転を逆回転で打ち消す
      // (= 実車のペダルがスピンドルで自由回転し踏み面を保つのと同じ)。
      for (const pedal of spinners.pedals) pedal.rotation.x = -crankRot;
      // カメラ追従用 placement。 position = 中心、 forward = 水平の進行方向。
      const hlen = Math.hypot(fx, fz) || 1;
      return {
        position: [cx, cy, cz],
        forward: [fx / hlen, 0, fz / hlen],
        forward3d: [fx, fy, fz],
      };
    },
  };
}
