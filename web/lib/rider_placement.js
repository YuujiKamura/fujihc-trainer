// brief b11-Phase3: rider の 3D 自転車 mesh をコース道路のどこに・どの向きで
// 置くかを決める純ロジック.
//
// terrain3d.js の buildCourseRibbon が返すリボン mesh の頂点配列 (positions) を
// 入力に、 自転車 mesh の配置 (= 位置 position と進行方向 forward) を返す。
// DOM / Three.js / fetch には依存しない (= node test 容易、 terrain3d.js と同じ規律)。
//
// リボン頂点のレイアウト (buildCourseRibbon 準拠): course 点 i ごとに 2 頂点、
// 頂点 2i = 左端、 2i+1 = 右端、 各頂点 3 float (x,y,z)。 投影は terrain3d と同一
// (= 東 +X、 上 +Y、 北 -Z)。
//
// 参照:
//   - Object3D.lookAt: https://threejs.org/docs/#api/en/core/Object3D.lookAt

/**
 * リボンの course 点 i の中心座標 (= 左端頂点と右端頂点の中点) を返す.
 *
 * @param {Float32Array|number[]} positions - buildCourseRibbon の positions
 * @param {number} i - course 点 index
 * @returns {[number, number, number]} [x, y, z]
 * @throws {RangeError} i が範囲外 (= 該当する左右頂点が positions に無い)
 */
export function ribbonCenterAt(positions, i) {
  const pointCount = Math.floor(positions.length / 6);  // 1 点 = 2 頂点 × 3 float
  if (!Number.isInteger(i) || i < 0 || i >= pointCount) {
    throw new RangeError(
      `ribbonCenterAt: point index ${i} out of range [0, ${pointCount})`);
  }
  const l = i * 2 * 3;        // 左端頂点 (2i)
  const r = (i * 2 + 1) * 3;  // 右端頂点 (2i+1)
  return [
    (positions[l] + positions[r]) / 2,
    (positions[l + 1] + positions[r + 1]) / 2,
    (positions[l + 2] + positions[r + 2]) / 2,
  ];
}

/**
 * rider の 3D 自転車 mesh をコース始点に置くための配置を返す.
 *
 * position = 始点 (course 点 0) のリボン中心。 forward = 始点から次点 (course 点
 * 1) へ向かう方向の XZ 成分を正規化した単位ベクトル (Y は 0 ── 自転車を路面に
 * 対し水平に置くため。 地形勾配へのピッチ追従は Phase 4/5 の領域)。 始点と次点が
 * XZ で同一 (= 退化) なら forward は [0,0,-1] (北向き) に fallback。
 *
 * @param {Float32Array|number[]} positions - buildCourseRibbon の positions
 * @param {number} vertexCount - buildCourseRibbon の vertexCount (= course 点数×2)
 * @returns {{position:[number,number,number], forward:[number,number,number]}}
 * @throws {RangeError} vertexCount < 4 (= course 2 点未満で進行方向を出せない)
 */
export function riderStartPlacement(positions, vertexCount) {
  if (!(vertexCount >= 4)) {
    throw new RangeError(
      `riderStartPlacement: needs >= 4 vertices (2 course points), got ${vertexCount}`);
  }
  const position = ribbonCenterAt(positions, 0);
  const next = ribbonCenterAt(positions, 1);
  const fx = next[0] - position[0];
  const fz = next[2] - position[2];
  const len = Math.hypot(fx, fz);
  const forward = len > 1e-9
    ? [fx / len, 0, fz / len]
    : [0, 0, -1];  // 始点・次点が XZ で同一 → 北向き fallback
  return { position, forward };
}
