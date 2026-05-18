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
 * rider の 3D 自転車 mesh を任意距離に置くための配置を返す.
 *
 * position は distanceM を挟む course 区間のリボン中心を線形補間した点。
 * forward は区間の XZ 方向を正規化した単位ベクトル (Y=0 ── 路面に水平)。
 * 退化区間 (XZ 差が零) は forward = [0,0,-1] (北向き) に fallback。
 * 終端到達時は最終区間 (lastIdx-1 → lastIdx) の向きを使う。
 *
 * @param {Float32Array|number[]} positions - buildCourseRibbon の positions
 * @param {Array<{distance_m: number}>} course - course 点列 (distance_m 単調増加)
 * @param {number} distanceM - 配置したい距離 (m、 [0, 総距離] に clamp)
 * @returns {{position:[number,number,number], forward:[number,number,number]}}
 * @throws {RangeError} course が 2 点未満
 */
export function riderPlacementAtDistance(positions, course, distanceM) {
  if (!Array.isArray(course) || course.length < 2) {
    throw new RangeError(
      `riderPlacementAtDistance: course must have >= 2 points, got ${Array.isArray(course) ? course.length : '?'}`);
  }
  const lastIdx = course.length - 1;
  const total = course[lastIdx].distance_m;
  const d = Math.min(Math.max(0, distanceM), total);

  // 「distance_m <= d を満たす最大 idx」 を線形 scan (= terrain.js idxAtDistance と同手法)
  let i = 0;
  while (i < lastIdx && course[i + 1].distance_m <= d) i++;

  const i1 = Math.min(i + 1, lastIdx);
  const c0 = ribbonCenterAt(positions, i);
  const c1 = ribbonCenterAt(positions, i1);

  // 区間内比 t で position を線形補間
  const seg = course[i1].distance_m - course[i].distance_m;
  const t = seg > 0 ? Math.min(1, Math.max(0, (d - course[i].distance_m) / seg)) : 0;
  const position = [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
  ];

  // forward: 終端 (i == lastIdx) は最終区間 (lastIdx-1 → lastIdx) の向きを使う
  const fi = i < lastIdx ? i : lastIdx - 1;
  const fc0 = fi === i ? c0 : ribbonCenterAt(positions, fi);
  const fc1 = fi + 1 === i1 ? c1 : ribbonCenterAt(positions, fi + 1);
  const fx = fc1[0] - fc0[0];
  const fz = fc1[2] - fc0[2];
  const len = Math.hypot(fx, fz);
  const forward = len > 1e-9
    ? [fx / len, 0, fz / len]
    : [0, 0, -1];  // XZ 退化 → 北向き fallback

  return { position, forward };
}
