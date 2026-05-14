// 進行方位の計算 (pure functions).
// viewer-maplibre.js の atan2 ベースの heading 計算と同 logic.
// 戻り値は degrees, 0=北, 90=東, 180=南, 270=西 (時計回り).

/**
 * idx を [0, length-1] にクランプ.
 */
export function clampIndex(idx, length) {
  if (length <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= length) return length - 1;
  return idx;
}

/**
 * course[idx] から lookAhead 先を見て進行方位 (deg) を返す.
 * 0=北, 90=東, 180=南, 270=西. course が 1 点以下なら 0 を返す.
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {number} idx
 * @param {number} lookAhead
 * @returns {number} degrees in [0, 360)
 */
export function computeTravelHeading(course, idx, lookAhead = 5) {
  if (!course || course.length < 2) return 0;
  const i = clampIndex(idx, course.length);
  const j = clampIndex(i + lookAhead, course.length);
  // 同一点なら 1 つ前にずらして方位を確定 (= goal で停止しても heading が 0 にリセットされない)
  const a = course[i];
  const b = course[j];
  if (a.lat === b.lat && a.lon === b.lon) {
    // i を 1 つ前にずらして再試行
    const k = clampIndex(i - 1, course.length);
    const a2 = course[k];
    const b2 = course[i];
    if (a2.lat === b2.lat && a2.lon === b2.lon) return 0;
    return atan2Heading(a2, b2);
  }
  return atan2Heading(a, b);
}

function atan2Heading(from, to) {
  const dLon = to.lon - from.lon;
  const dLat = to.lat - from.lat;
  // 経度方向は cos(lat) で距離補正
  const x = dLon * Math.cos(from.lat * Math.PI / 180);
  const y = dLat;
  // atan2(東, 北) → 北=0, 東=π/2 ラジアン
  const rad = Math.atan2(x, y);
  let deg = rad * 180 / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}
