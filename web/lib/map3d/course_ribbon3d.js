// b12 Phase3 部品3: コースリボン (Three.js 描画層).
//
// 担当する差し替え口メソッド: なし (= renderCourse から呼ばれる内部部品)。
// 地形メッシュ上に「勾配色の道路リボン」を 1 本の Mesh として組む。
//
// 薄い描画層に徹する:
//   - リボン頂点 (course 点ごとに左右 2 点) の XZ / index / uv は terrain3d.js の
//     buildCourseRibbon (純関数、 node test 済) が出す。
//   - 各頂点の色は route_styling.js の gradeColorContinuous (純関数) が course 点の
//     slope_pct から決める。
//   本 module はこの純関数の出力を Three.js の BufferGeometry に詰めるだけで、
//   幾何計算・色計算のロジックは自前で持たない。
//
// 1 点だけ Y (標高) を補正する: buildCourseRibbon はフル解像度 DEM で drape するが、
// 表示される地形メッシュ (terrain_mesh3d.js) は meshGridStep で間引いた粗い面なので、
// 凹凸区間でリボンが地形メッシュに埋まる / 浮く。 conformRibbonToMesh で各頂点 Y を
// 「間引き面」(terrain_surface.js の sampleMeshHeight) の高さに再計算し、 地形メッシュ
// 表面そのものへ沿わせる ── これが「コースが地形に埋まる」バグの修正。
//
// terrain3d.js は無改造で使う (= 設計メモ 2-1)。 buildCourseRibbon は頂点色を出力
// せず Y もフル解像度のままだが、 色付けと Y 補正は描画の責務なので terrain3d.js に
// 足さず描画側のここで付ける。 これで terrain3d.test.js への影響はゼロ。
//
// THREE は引数で受け取る (= 'three' を import しない)。 markers3d.js と同じ理由
// ── vitest (environment: node、 'three' alias なし) で純関数を素直にテストするため。
// terrain_surface.js も 3-free なので import しても node test 可能性を壊さない。
//
// 座標系 SoT: 東 = +X、 上 = +Y、 北 = -Z。 terrain3d.js / buildCourseRibbon と一致。

import { buildCourseRibbon } from '../terrain3d.js';
import { gradeColorContinuous } from '../route_styling.js';
import { sampleMeshHeight, meshGridStep } from './terrain_surface.js';

// 緯度 1 度あたりのメートル (= terrain3d.js / terrain_surface.js と同値)。
const M_PER_DEG_LAT = 111320;

/**
 * course 各点の slope_pct を頂点色 (RGB 0..1) の Float32Array に変換する純関数.
 *
 * buildCourseRibbon は course 点 i ごとに左右 2 頂点 (index 2i = 左、 2i+1 = 右) を
 * 出す。 その頂点順に合わせ、 点 i の勾配色を左右両頂点へ同色で入れる。
 * 色は gradeColorContinuous (route_styling.js) が SoT ── MapLibre 版の道路 polygon と
 * 同じ勾配色パレットを使うので、 レンダラを変えても走路の色は一致する。
 *
 * gradeColorContinuous は null / undefined / NaN を flat (緑) 扱いするため、
 * slope_pct 欠損点もそのまま渡してよい (= NaN が色に漏れない)。
 *
 * @param {Array<{slope_pct?:number}>} course - コース点列 (2 点以上)
 * @returns {Float32Array} 長さ course.length*2*3 の RGB (各成分 0..1)
 */
export function ribbonVertexColors(course) {
  if (!Array.isArray(course) || course.length < 2) {
    throw new RangeError('ribbonVertexColors: course needs >= 2 points');
  }
  const n = course.length;
  const colors = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const hex = gradeColorContinuous(course[i].slope_pct);
    // '#rrggbb' → 0..1 の RGB。 GPU の頂点色 attribute は 0..1 正規化値を取る。
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    for (let s = 0; s < 2; s++) {  // s=0 左頂点 / s=1 右頂点、 同色
      const vi = (i * 2 + s) * 3;
      colors[vi] = r;
      colors[vi + 1] = g;
      colors[vi + 2] = b;
    }
  }
  return colors;
}

/**
 * リボン頂点の Y (標高) を、 地形メッシュが実際に描く「間引き面」の高さで上書きする.
 *
 * buildCourseRibbon はフル解像度 DEM (sampleHeightBilinear) で頂点を drape するが、
 * 表示される地形メッシュ (buildTerrainGeometry) は meshGridStep で間引いた粗い面。
 * 解像度が違うので凹凸区間でリボンが地形メッシュへ埋まる / 浮く。 ここで各頂点を
 * 間引き面 (sampleMeshHeight) の高さに再計算し、 リボンを地形メッシュ表面そのものへ
 * 沿わせる ── これで一律の大きなオフセットに頼らず全区間で埋まらなくなる。
 *
 * X/Z は buildCourseRibbon の投影で正しいので触らず Y だけ書き換える。 緯度経度は
 * X/Z から逆投影で復元する (= buildCourseRibbon 内部の投影と同じ式)。
 *
 * @param {Float32Array} positions - buildCourseRibbon が出した XYZ 頂点列 (in-place 上書き)
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number}} geo
 * @param {{drapeOffset?:number, exaggeration?:number}} opts
 */
function conformRibbonToMesh(positions, geo, opts) {
  const { range, stitched, centerLat, centerLon } = geo;
  const tileSize = geo.tileSize || 256;
  // buildCourseRibbon と同じ既定値 (= drapeOffset 15 / exaggeration 1.0)。
  const drapeOffset = opts.drapeOffset != null ? opts.drapeOffset : 15;
  const exaggeration = opts.exaggeration != null ? opts.exaggeration : 1.0;
  const step = meshGridStep(stitched.width, stitched.height);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  for (let k = 0; k < positions.length; k += 3) {
    // X/Z → 緯度経度 (= buildCourseRibbon の投影の逆)。
    const lon = centerLon + positions[k] / mPerDegLon;
    const lat = centerLat - positions[k + 2] / M_PER_DEG_LAT;
    const h = sampleMeshHeight(stitched, range, lat, lon, step, tileSize);
    positions[k + 1] = h * exaggeration + drapeOffset;
  }
}

/**
 * 勾配色の道路リボン Mesh を組む factory.
 *
 * @param {object} THREE - vendored three.module.js の名前空間 (= 呼び出し側が import)
 * @param {Array} course - コース点列 (2 点以上、 各点 lat/lon/slope_pct/distance_m)
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number}} geo - buildCourseRibbon に渡す投影パラメータ
 * @param {{widthM?:number, drapeOffset?:number, exaggeration?:number}} [opts]
 *        道幅 / 地形からの持ち上げ / 標高誇張。 buildCourseRibbon の同名 opts に渡す。
 * @returns {{mesh:object, dispose:()=>void}}
 *   mesh = scene.add() する Three.js Mesh (BufferGeometry + 頂点色 MeshBasicMaterial)。
 */
export function createCourseRibbon(THREE, course, geo, opts = {}) {
  const ribbon = buildCourseRibbon(course, { ...geo, ...opts });
  // buildCourseRibbon はフル解像度 DEM で drape するため、 間引いた地形メッシュと
  // 凹凸区間で食い違いリボンが埋まる。 頂点 Y を間引き面の高さへ再計算する。
  conformRibbonToMesh(ribbon.positions, geo, opts);
  const colors = ribbonVertexColors(course);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));

  // 頂点色 material (= 陰影なし)。 リボンは勾配色そのものを見せるのが目的で、
  // 地形メッシュのような太陽光陰影は載せない。 走行カメラがリボンの下へ回り込む
  // ことがあるため DoubleSide で裏面も描く。
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    /** geometry / material を解放する (= course 再読込時の GPU リソース leak 防止)。 */
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
