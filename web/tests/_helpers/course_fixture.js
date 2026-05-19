// rider-position-model: haversine 自己整合な course fixture を組むテストヘルパ.
//
// 新モデルの terrain は course.json の `distance_m` フィールドを無視し、 lat/lon の
// haversine 実長を距離スケールにする. テスト fixture が `distance_m: i*111` のような
// 幾何と無関係な値を持つと「fixture が嘘をつく」状態になるため、 distance_m を実際の
// haversine 累積で埋めて自己整合にする ── これで `course[i].distance_m` が
// 「点 i の正しい累積距離」 の handle として assertion に使える.
//
// terrain.js の haversineMeters を共有する (= terrain 内部の距離計算と同一式).

import { haversineMeters } from '../../lib/terrain.js';

// 緯線方向 1m あたりの緯度 (度). metre スケール fixture 用 ── lat をこの刻みで
// 動かすとセグメント長が約 1.0m になる (= seek / idx 境界テストを 1m 粒度で書ける).
export const DEG_LAT_PER_M = 1 / ((Math.PI / 180) * 6371000);

/**
 * points (lat/lon ほかを持つ) の隣接 haversine 累積を distance_m に書き込んで返す.
 * 入力は破壊しない (= shallow copy).
 *
 * @param {Array<{lat:number, lon:number}>} points
 * @returns {Array<object>} distance_m を haversine 累積で埋めた course
 */
export function withCumulativeDistance(points) {
  const out = points.map((p) => ({ ...p }));
  let cum = 0;
  for (let i = 0; i < out.length; i++) {
    if (i > 0) cum += haversineMeters(out[i - 1], out[i]);
    out[i].distance_m = cum;
  }
  return out;
}

/**
 * course の haversine 累積長配列を返す. cumulativeLengths(course)[i] = 点 i の距離.
 *
 * @param {Array<{lat:number, lon:number}>} course
 * @returns {number[]} 長さ course.length の累積距離 (m)
 */
export function cumulativeLengths(course) {
  const cum = [0];
  for (let i = 1; i < course.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(course[i - 1], course[i]));
  }
  return cum;
}
