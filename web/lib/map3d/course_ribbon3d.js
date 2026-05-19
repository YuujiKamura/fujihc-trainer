// b12 Phase3 部品3: コースリボン (Three.js 描画層).
//
// 担当する差し替え口メソッド: なし (= renderCourse から呼ばれる内部部品)。
// 地形メッシュ上に「勾配色の道路リボン」を 1 本の Mesh として組む。
//
// 配色は区間フラット塗り: 隣り合う 2 つの course 点が作る帯 (= 区間) を、 1 つの
// 勾配色のべた塗りで描く。 区間の中で色は混ざらず、 色が変わる区間境界で色が段差
// (不連続) で切り替わる。 区間色は route_styling.js の gradeColorContinuous ──
// 勾配を 0.5% 刻み (GRADE_STEP_PCT) に量子化した連続 RGB ランプ色なので、 勾配が
// 0.5% 変わるごとに色が 1 段変わる。 同じ 0.5% バケットの区間は同色。 6 段階の粗い
// グレード bin ではなく 0.5% 刻みの細かい色変化で勾配差を見せる。
//
// 仕組み: リボンの頂点 (course 点ごとに左右 2 点) と三角形 index は terrain3d.js の
// buildCourseRibbon (純関数、 node test 済) が出す。 同じ index を「同色の連続区間
// (= 区間ラン) ごとの geometry group」に畳み、 各ランにその勾配色の単色 material を
// 割り当てる。 単色 material (vertexColors なし) は group 内の全三角形を一様な色で
// 塗るため、 頂点が隣の区間と共有されていても色が補間されない ── これが「区間内で
// 混色しない / 区間境界で段差」を生む。 頂点色 attribute を 1 本の Mesh に詰めて
// vertexColors で描くと、 GPU が区間両端の頂点色を面上で線形補間して混色になる
// (= b2eef1b までの挙動)、 それを material 分割で断つ。
//
// 重要 (= 壊すな): createCourseRibbon の戻り mesh.geometry の position 属性は、
// course 点 i ごとに左右 2 頂点 (2i / 2i+1)、 長さ n*2*3 のレイアウト。 map3d/index.js
// がこの属性をそのまま取り出して rider 配置 (rider_placement.js の ribbonCenterAt は
// positions.length/6 で点数を出し i*2*3 で頂点を引く) と setRoadHeight に渡す。 配色を
// 区間べた塗りにするのに頂点を複製 (de-index) するとこの属性長が n*2*3 から変わり、
// rider 配置が静かに壊れる ── だから頂点・index は buildCourseRibbon の出力のまま
// 一切変えず、 色は group + material でのみ区間別に切り替える。
//
// 1 点だけ Y (標高) を補正する: buildCourseRibbon はフル解像度 DEM で drape するが、
// 表示される地形メッシュ (terrain_mesh3d.js) は meshGridStep で間引いた粗い面なので、
// 凹凸区間でリボンが地形メッシュに埋まる / 浮く。 conformRibbonToMesh で各頂点 Y を
// 「間引き面」(terrain_surface.js の sampleMeshHeight) の高さに再計算し、 地形メッシュ
// 表面そのものへ沿わせる。 頂点を複製しないので補正対象は n*2 頂点のまま。
//
// terrain3d.js は無改造で使う。 buildCourseRibbon は頂点色・group を出力せず Y も
// フル解像度のままだが、 色付けと Y 補正は描画の責務なので terrain3d.js に足さず
// 描画側のここで付ける。 これで terrain3d.test.js への影響はゼロ。
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
 * course 各区間の代表勾配を勾配色 (hex) に変換する純関数.
 *
 * buildCourseRibbon は course 点 i と i+1 の間を 1 区間 (= 2 三角形) として描く。
 * 区間は course.length-1 個。 区間 i の代表勾配は始点 course[i].slope_pct を採る。
 *
 * なぜ始点か (= 色と勾配区間のズレ修正): course.py は slope_pct を「その点に至るまで
 * の後方ウィンドウ平滑勾配」として出す ── slope_pct[k] は点 k へ入ってくる road の
 * 勾配。 viewer の rider HUD・物理・トレーナー負荷はいずれも rider 位置の
 * pos.slope_pct を使い、 点 i での pos.slope_pct = course[i].slope_pct。 区間 i
 * (点 i→i+1 の road) を course[i].slope_pct で塗ると、 rider が点 i から区間 i に
 * 入る時に「車輪の下の色 = HUD の勾配」が一致する。 終点 course[i+1].slope_pct を
 * 採ると色が rider の体感勾配より 1 区間後ろにずれ、 急勾配の色が実際に急な区間より
 * 1 つ手前の区間に乗る (= MapLibre 版 buildGradeColoredRoute と同じ既知のズレ)。
 *
 * 代表勾配 → 色は gradeColorContinuous (route_styling.js) が SoT ── slope_pct を
 * GRADE_STEP_PCT (0.5%) 刻みに量子化してから 10 色の連続 RGB ランプをサンプルした
 * hex 色を返す。 勾配が 0.5% 変わるごとに色が 1 段変わり、 同じ 0.5% バケットの区間は
 * 同色。 road_polygon.js / road_texture.js の道路配色と同じ色モデル。
 *
 * fallback: course[i].slope_pct が null/undefined/NaN なら course[i+1].slope_pct、
 * それも無効なら 0。 gradeColorContinuous も欠損を 0 (flat) 扱いするため色に漏れない。
 *
 * @param {Array<{slope_pct?:number}>} course - コース点列 (2 点以上)
 * @returns {string[]} 長さ course.length-1 の hex 色文字列 (区間 i の色)
 */
export function ribbonSegmentBins(course) {
  if (!Array.isArray(course) || course.length < 2) {
    throw new RangeError('ribbonSegmentBins: course needs >= 2 points');
  }
  const out = [];
  for (let i = 0; i < course.length - 1; i++) {
    let slope = course[i].slope_pct;      // 始点の勾配 (= rider が区間 i に入る時の slope)
    if (slope === null || slope === undefined || Number.isNaN(slope)) {
      slope = course[i + 1].slope_pct;    // fallback: 終点の勾配
    }
    if (slope === null || slope === undefined || Number.isNaN(slope)) {
      slope = 0;                          // fallback: flat (緑)
    }
    out.push(gradeColorContinuous(slope));
  }
  return out;
}

/**
 * 区間色配列を、 同色の連続区間 (= 区間ラン) ごとの geometry group 配列に畳む純関数.
 *
 * buildCourseRibbon の index バッファは区間順に並び、 区間 i は index [i*6, i*6+6)
 * を占める (= 2 三角形 / 6 index)。 同色が連続する区間をまとめて 1 つの group にし、
 * Three.js の addGroup(start, count, materialIndex) にそのまま渡せる形で返す。
 *
 * 不変条件: 各 group の start / count は 6 の倍数 (= group が区間を分断しない、
 * 1 区間は必ず 1 group に丸ごと入る = 区間内で混色しない)。 group は index 0 から
 * 隙間なく連続し、 count の総和 = segmentColors.length*6 (= 全区間が必ず描画される、
 * 塗り残しなし)。
 *
 * @param {string[]} segmentColors - ribbonSegmentBins の出力 (区間ごとの hex 色)
 * @returns {Array<{start:number, count:number, color:string}>}
 *   start/count は index バッファ上の位置、 color はその区間ランの hex 色。
 */
export function ribbonColorGroups(segmentColors) {
  if (!Array.isArray(segmentColors) || segmentColors.length < 1) {
    throw new RangeError('ribbonColorGroups: needs >= 1 segment');
  }
  const groups = [];
  let runStart = 0;
  for (let i = 1; i <= segmentColors.length; i++) {
    // 色が変わった所、 または末尾で、 [runStart, i) を 1 つの区間ランとして確定する。
    if (i === segmentColors.length || segmentColors[i] !== segmentColors[runStart]) {
      groups.push({
        start: runStart * 6,
        count: (i - runStart) * 6,
        color: segmentColors[runStart],
      });
      runStart = i;
    }
  }
  return groups;
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
 * 区間フラット塗りの道路リボン Mesh を組む factory.
 *
 * 頂点 (position) と三角形 index は buildCourseRibbon の出力をそのまま使う
 * (= course 点 i → 頂点 2i/2i+1、 position 長 n*2*3、 index 長 (n-1)*6)。 配色は
 * index を区間ラン単位の geometry group に分割し、 各ランに勾配色の単色 material を
 * 割り当てて行う ── 頂点は複製しないので map3d/index.js が読む mesh.geometry の
 * position 属性レイアウトを保ち、 rider 配置を壊さない。
 *
 * @param {object} THREE - vendored three.module.js の名前空間 (= 呼び出し側が import)
 * @param {Array} course - コース点列 (2 点以上、 各点 lat/lon/slope_pct/distance_m)
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number}} geo - buildCourseRibbon に渡す投影パラメータ
 * @param {{widthM?:number, drapeOffset?:number, exaggeration?:number}} [opts]
 *        道幅 / 地形からの持ち上げ / 標高誇張。 buildCourseRibbon の同名 opts に渡す。
 * @returns {{mesh:object, dispose:()=>void}}
 *   mesh = scene.add() する Three.js Mesh (BufferGeometry + 単色 material の配列)。
 */
export function createCourseRibbon(THREE, course, geo, opts = {}) {
  const ribbon = buildCourseRibbon(course, { ...geo, ...opts });
  // buildCourseRibbon はフル解像度 DEM で drape するため、 間引いた地形メッシュと
  // 凹凸区間で食い違いリボンが埋まる。 頂点 Y を間引き面の高さへ再計算する。
  // 頂点を複製しないので補正対象は n*2 頂点のまま (= 順序・順番ともに従来と同一)。
  conformRibbonToMesh(ribbon.positions, geo, opts);

  // 区間ごとの代表勾配色 → 同色連続区間 (区間ラン) を畳んだ group 配列。
  const segmentColors = ribbonSegmentBins(course);
  const groups = ribbonColorGroups(segmentColors);

  const geometry = new THREE.BufferGeometry();
  // position / index は buildCourseRibbon の出力そのまま (= 不可侵、 rider 配置が読む
  // n*2*3 レイアウト)。 頂点色 (color) attribute は単色 material 方式では使わないので
  // 詰めない。
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
  // MeshLambertMaterial の拡散光に頂点法線が要る (= 旧 MeshBasicMaterial は法線不要
  // だったので詰めていなかった)。 これが無いとリボンが真っ黒に潰れる。
  geometry.computeVertexNormals();

  // 出現する勾配色ごとに単色 material を 1 つ作る (= 同色 group は material を共有)。
  // vertexColors を使わない単色 material は group 内の三角形を一様に塗るので、
  // 隣接区間と頂点を共有していても色が補間されない。
  // 走行カメラがリボンの下へ回り込むため DoubleSide で裏面も描く。 MeshLambertMaterial
  // を使い自機の影 (shadow map) を受ける ── リボンはほぼ水平なので拡散光は一様に効き、
  // 区間ごとの勾配色の段差・非混色は単色 material のまま保たれる。
  const palette = [];
  for (const g of groups) {
    if (palette.indexOf(g.color) === -1) palette.push(g.color);
  }
  const materials = palette.map((hex) => new THREE.MeshLambertMaterial({
    color: hex,
    side: THREE.DoubleSide,
  }));

  // 各区間ランを、 その色の material を指す geometry group として登録する。
  for (const g of groups) {
    geometry.addGroup(g.start, g.count, palette.indexOf(g.color));
  }

  const mesh = new THREE.Mesh(geometry, materials);

  return {
    mesh,
    /** geometry / 全 material を解放する (= course 再読込時の GPU リソース leak 防止)。 */
    dispose() {
      geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
