// brief b11-Phase2: コース道路リボンのテクスチャに距離・勾配の数字を焼き込むための
// データ経路 (純関数).
//
// terrain3d.js の buildCourseRibbon が返すリボン mesh の uv (u = コース始点からの
// 距離 0..1、 v = 幅方向 0..1) を使い、 道路の路面そのものに距離 km と勾配 % を焼く。
// 本 module は「どこに何の数字を焼くか」を course データの実値から決める純ロジック
// だけを担う ── canvas 描画 (DOM) は呼び出し側 (= terrain3d.html) の責務。
// DOM / Three.js / fetch には依存しない (= node test 容易、 terrain3d.js と同じ規律)。
//
// slopeAtDistance が勾配値の唯一の SoT: テクスチャ背景の勾配色も、 マークに焼く
// 勾配数字も、 全てこの 1 関数を通す ── 算出式が 1 つなので両者は必ず一致する。
//
// 参照:
//   - CanvasTexture:        https://threejs.org/docs/#api/en/textures/CanvasTexture
//   - route_styling.js gradeColorContinuous (= 勾配色の SoT、 背景色に使う)

/**
 * course の総距離 (= 最終点の distance_m) を返す.
 *
 * @param {Array<{distance_m?: number}>} course
 * @returns {number} 総距離 m
 * @throws {RangeError} course が空、 または最終点の distance_m が非有限
 */
export function courseTotalDistance(course) {
  if (!Array.isArray(course) || course.length === 0) {
    throw new RangeError('courseTotalDistance: course must be a non-empty array');
  }
  const last = course[course.length - 1].distance_m;
  if (!Number.isFinite(last)) {
    throw new RangeError('courseTotalDistance: last point has no finite distance_m');
  }
  return last;
}

/**
 * course の指定距離における勾配 (slope_pct) を、 隣接 2 点の線形補間で返す.
 *
 * これが勾配値の唯一の SoT。 distanceM がちょうど course 点に当たればその点の値、
 * 2 点間なら distance_m に比例した線形補間値。 範囲外 (始点前 / 終点後) は端へ
 * clamp する。 slope_pct 欠損 (null/undefined/NaN) は 0 扱い (= route_styling /
 * courseRingSlopes と同じ安全側 default)。
 *
 * course の distance_m は単調増加 (= GPX 累積距離) を前提とする。
 *
 * @param {Array<{distance_m?: number, slope_pct?: number}>} course
 * @param {number} distanceM - コース始点からの距離 m
 * @returns {number} 勾配 %
 * @throws {RangeError} course が空
 */
export function slopeAtDistance(course, distanceM) {
  if (!Array.isArray(course) || course.length === 0) {
    throw new RangeError('slopeAtDistance: course must be a non-empty array');
  }
  const slopeOf = (p) => {
    const s = p.slope_pct;
    return (s == null || Number.isNaN(s)) ? 0 : s;
  };
  if (course.length === 1) return slopeOf(course[0]);
  // 始点前 / 終点後は端へ clamp。
  if (distanceM <= course[0].distance_m) return slopeOf(course[0]);
  const last = course[course.length - 1];
  if (distanceM >= last.distance_m) return slopeOf(last);
  // distanceM を挟む 2 点を探し、 distance_m 比で slope_pct を線形補間。
  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i], b = course[i + 1];
    if (distanceM >= a.distance_m && distanceM <= b.distance_m) {
      const span = b.distance_m - a.distance_m;
      const t = span > 0 ? (distanceM - a.distance_m) / span : 0;
      return slopeOf(a) + (slopeOf(b) - slopeOf(a)) * t;
    }
  }
  // 単調増加の前提下では到達しないが、 沈黙 NaN を避け終点値を返す。
  return slopeOf(last);
}

/**
 * 道路テクスチャに焼く距離マークの列を course データから組む.
 *
 * major マーク = 数字 (距離 km + 勾配 %) を焼く点。 minor マーク = 位置の刻み線
 * のみで数字なし。 u = distance_m / 総距離 (= リボン uv の u と同じ正規化、
 * テクスチャの横座標に直結する)。
 *
 * major マークの slope_pct は slopeAtDistance の値をそのまま格納する ── 描画側が
 * 数字を出すとき再計算しなくて済むようにした convenience で、 算出式は 1 つ
 * (= slopeAtDistance)。
 *
 * @param {Array<{distance_m?: number, slope_pct?: number}>} course
 * @param {{majorIntervalM?: number, minorIntervalM?: number}} [opts]
 * @returns {{totalDistanceM: number,
 *            major: Array<{distance_m: number, u: number, slope_pct: number}>,
 *            minor: Array<{distance_m: number, u: number}>}}
 * @throws {RangeError} course が空、 または interval が非正
 */
export function buildRoadMarks(course, opts = {}) {
  const majorIntervalM = opts.majorIntervalM != null ? opts.majorIntervalM : 1000;
  const minorIntervalM = opts.minorIntervalM != null ? opts.minorIntervalM : 100;
  if (!(majorIntervalM > 0) || !(minorIntervalM > 0)) {
    throw new RangeError('buildRoadMarks: intervals must be positive');
  }
  const totalDistanceM = courseTotalDistance(course);

  const major = [];
  for (let d = majorIntervalM; d <= totalDistanceM; d += majorIntervalM) {
    major.push({
      distance_m: d,
      u: d / totalDistanceM,
      slope_pct: slopeAtDistance(course, d),
    });
  }
  const minor = [];
  for (let d = minorIntervalM; d <= totalDistanceM; d += minorIntervalM) {
    minor.push({ distance_m: d, u: d / totalDistanceM });
  }
  return { totalDistanceM, major, minor };
}
