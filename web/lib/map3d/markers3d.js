// b12 Phase3 部品6: 起点 / 終点マーカー (Three.js 描画層).
//
// 担当する差し替え口メソッド: setStartGoalVisible(visible)。
// renderCourse 時にコース両端へマーカー mesh を置き、 ride 中はメイン地図から
// 起点 / 終点ピンを退ける (= minimap には残す。 退避の判断は viewer 本体の tick)。
//
// 薄い描画層に徹する: コース点列の地形上 3D 座標は terrain3d.js の buildCoursePath
// (純関数、 node test 済) が出す。 本 module はその両端を Three.js の球 mesh に
// するだけで、 投影ロジックは自前で持たない。
//
// THREE は引数で受け取る (= 'three' を import しない)。 viewer / 部品0 ファサードが
// vendored three.module.js を import して渡す。 これで本 module は Three.js 非依存の
// vitest 環境 (vitest.config.js は environment: node) でも素直に import でき、
// 純関数 courseEndpoints を単体テストできる。
//
// 座標系 SoT: 東 = +X、 上 = +Y (標高 m)、 北 = -Z。 terrain3d.js と一致。

import { buildCoursePath } from '../terrain3d.js';

// MapLibre viewer の起点 / 終点 Marker 色に合わせる
// (viewer-maplibre.js: 起点 = 緑 #7fff00 / 終点 = 赤 #ff3030)。
// Three.js 版もこの 2 色で「起点 = 緑、 終点 = 赤」を踏襲する。
export const START_MARKER_COLOR = 0x7fff00;
export const GOAL_MARKER_COLOR = 0xff3030;

/**
 * コース両端 (起点 / 終点) の地形上ワールド XYZ 座標を返す純関数.
 *
 * buildCoursePath が出す course 全点の 3D 座標列 (= Float32Array、 3 要素 / 点) から、
 * 先頭点と末尾点を取り出すだけ。 Three.js 非依存なので vitest でそのままテストできる。
 *
 * @param {Array<{lat:number,lon:number}>} course - コース点列 (2 点以上)
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number, drapeOffset?:number, exaggeration?:number}} geo
 *   buildCoursePath に渡す投影パラメータ。 buildTerrainGeometry の戻り値由来。
 * @returns {{start:[number,number,number], goal:[number,number,number]}}
 */
export function courseEndpoints(course, geo) {
  const path = buildCoursePath(course, geo);
  const n = path.length;
  if (n < 6) {
    // 3 要素 / 点なので 2 点 = 6 要素。 1 点以下では起点 / 終点を区別できない。
    throw new RangeError('courseEndpoints: course needs >= 2 points');
  }
  return {
    start: [path[0], path[1], path[2]],
    goal: [path[n - 3], path[n - 2], path[n - 1]],
  };
}

/**
 * 起点 / 終点マーカーの Three.js group を組み、 可視制御 API を返す factory.
 *
 * @param {object} THREE - vendored three.module.js の名前空間 (= 呼び出し側が import)
 * @param {Array} course - コース点列
 * @param {object} geo - courseEndpoints / buildCoursePath に渡す投影パラメータ
 * @param {{radiusM?:number}} [opts] - マーカー球の半径 (m)。 地形 span 由来の値を
 *        呼び出し側 (部品0) が渡す想定。 省略時は 60m。
 * @returns {{group:object, setStartGoalVisible:(visible:boolean)=>void,
 *            dispose:()=>void}}
 *   group = scene.add() する Three.js Group。 起点 / 終点の 2 球 mesh を含む。
 */
export function createMarkers3d(THREE, course, geo, opts = {}) {
  const radiusM = opts.radiusM != null ? opts.radiusM : 60;
  const { start, goal } = courseEndpoints(course, geo);

  const group = new THREE.Group();
  // 起点 / 終点で同じ球 geometry を共有する (= 半径が同じ、 位置だけ違う)。
  const sphere = new THREE.SphereGeometry(radiusM, 16, 12);

  const startMesh = new THREE.Mesh(
    sphere, new THREE.MeshBasicMaterial({ color: START_MARKER_COLOR }));
  startMesh.position.set(start[0], start[1], start[2]);
  group.add(startMesh);

  const goalMesh = new THREE.Mesh(
    sphere, new THREE.MeshBasicMaterial({ color: GOAL_MARKER_COLOR }));
  goalMesh.position.set(goal[0], goal[1], goal[2]);
  group.add(goalMesh);

  return {
    group,
    /** ride 中はメイン地図から起点 / 終点ピンを退ける (= group ごと不可視化)。 */
    setStartGoalVisible(visible) {
      group.visible = !!visible;
    },
    /** geometry / material を解放する (= course 再読込時の GPU リソース leak 防止)。 */
    dispose() {
      sphere.dispose();
      startMesh.material.dispose();
      goalMesh.material.dispose();
    },
  };
}
