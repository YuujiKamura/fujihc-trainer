// brief 23: GPS ジッター除去のための moving average smoothing.
//
// GPX 由来の course データは lat/lon に GPS ジッターが乗って小刻みに左右へぶれる.
// zoom 23 級の道路 1 車線視点で滑らかに見えるように、 隣接点平均で smoothing する.
//
// 設計:
//   - 既存の distance_m / slope_pct / elevation_m は再計算せず保持
//     (= 距離・勾配は累積誤差が出やすい / elevation は DEM が真値)
//   - default は lat / lon のみ smooth (options.smoothFields で上書き可)
//   - 終端境界は window が縮む (fade): course 先頭 / 末尾は近傍が少ない分、
//     原データに近い結果になる ── 端点が変な方向に飛ぶのを防ぐ.
//
// Python 版 (src/fujihc/gpx_smooth.py) と同 logic / 同 signature.
// cross-language fixture (tests/test_dump_for_gpx_smooth_js.py) で同値性 pin.

/**
 * 一次元配列の moving average smoothing.
 *
 * window=N で各点を「自分を中心に最大 N 点 (端では縮む)」の平均で置換.
 * 奇数 window 推奨 (= 中央が定義しやすい). 偶数でも動作するが左右の重みが
 * 1 ずれる: half_left = floor((window-1)/2), half_right = window-1-half_left.
 *
 * window >= length の時は全要素が全体平均と等しくなる (= 完全平均化).
 *
 * @param {number[]} values - smoothing 対象の数値列.
 * @param {number} window - 平均化窓 (1 以上の整数、 奇数推奨).
 * @returns {number[]} - 同 length の smoothed 値.
 */
export function movingAverage(values, window) {
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError(`movingAverage: window must be positive integer, got ${window}`);
  }
  const n = values.length;
  if (n === 0) return [];
  if (window === 1) return values.slice();

  // window >= length → 全要素同じ平均.
  if (window >= n) {
    let total = 0;
    for (let i = 0; i < n; i++) total += values[i];
    const mean = total / n;
    return new Array(n).fill(mean);
  }

  const halfLeft = Math.floor((window - 1) / 2);
  const halfRight = (window - 1) - halfLeft;

  // O(n) prefix sum で各 window 平均を計算.
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfLeft);
    const hi = Math.min(n, i + halfRight + 1); // exclusive
    const count = hi - lo;
    out[i] = (prefix[hi] - prefix[lo]) / count;
  }
  return out;
}

/**
 * GPX course の moving average smoothing.
 *
 * default で lat / lon のみ smooth. distance_m / slope_pct / elevation_m は
 * 不変 (= ride 視点で「道路がギザギザ」なのは lat/lon 由来、 距離 / 勾配 /
 * 標高は別系統の値なので smooth しない).
 *
 * 偶数 window でも動作するが (window-1)/2 前後の非対称になる. 奇数推奨.
 *
 * やりすぎ禁止 / 短距離ジグザグ補正のみ:
 *   default window=5 (= 各点で前後 2 + 自分、 約 20-30m スケール) は
 *   GPS ジッター (= 通常 5-10m 級の 1-2 点ぶれ) を除去する用. window を
 *   大きくしすぎる (= 11 以上) と、 50m 級の道路カーブも平滑化されて
 *   course が直線化 → ride 視点で「道路がコースから外れている」見え方
 *   になる. window 11 を渡す事は可能だが調査用、 default では使うな.
 *
 * @param {Array<Object>} course - [{lat, lon, distance_m, elevation_m, slope_pct}, ...]
 * @param {number} window - default 5 (= 各点で前後 2 + 自分、 ジグザグ補正
 *   程度に留める). 大きくしすぎ禁止 ── 道路カーブも消える.
 * @param {Object} [options]
 * @param {string[]} [options.smoothFields] - smooth 対象 field. default ['lat', 'lon'].
 * @returns {Array<Object>} - 同 length の course、 smoothed 後の field が更新.
 */
export function smoothCourse(course, window = 5, options = {}) {
  if (!Array.isArray(course)) {
    throw new TypeError('smoothCourse: course must be an array');
  }
  if (course.length === 0) return [];
  if (!Number.isInteger(window) || window < 1) {
    throw new RangeError(`smoothCourse: window must be positive integer, got ${window}`);
  }
  const smoothFields = (options.smoothFields && options.smoothFields.length > 0)
    ? options.smoothFields
    : ['lat', 'lon'];

  // window=1 は identity (= shallow clone でも値は同じ).
  if (window === 1) {
    return course.map(p => ({ ...p }));
  }

  // 各 smoothFields について movingAverage を取って差し替え.
  const out = course.map(p => ({ ...p }));
  for (const field of smoothFields) {
    const values = course.map(p => p[field]);
    const smoothed = movingAverage(values, window);
    for (let i = 0; i < out.length; i++) {
      out[i][field] = smoothed[i];
    }
  }
  return out;
}
