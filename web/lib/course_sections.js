// brief 34 ε-8: 「観る」モード (= Zwift Climb Portal 風) の区間分割 module.
//
// 設計:
// - course (= ride_state.js が消費する {distance_m, elevation_m, slope_pct, lat, lon} の列) を
//   distance 等分で n 個に区切り、 各区間の平均勾配を算出。
// - pure module、 DOM / browser global 依存ゼロ (= node test 容易).
// - 「コース全 24km を 10 区間に分割」という仕様の core lib、 UI 側は section[].start_idx を
//   rideState に inject して fake-state ride loop を起こす想定。
// - 「観るモード」は trainer 不要 / 走行ログ保存なし / Strava upload なし (= 区間勾配を眺めるだけ).
//
// 仕様:
// - n 等分は **距離ベース** (= time / point count ではない、 富士ヒル 24km なら 1 区間 2.4km).
// - 各区間の start_idx は「区間始点 distance 以上の最初の course point」、 end_idx は「区間終点 distance 以下の最後の course point」.
// - end_idx は次区間 start_idx の 1 つ手前、 最終区間 end_idx は course.length - 1.
// - avg_slope_pct = (end_ele - start_ele) / (end_dist - start_dist) * 100.
//   区間長 (= end_dist - start_dist) が 0 の場合は 0 を返す (= div-by-zero guard).
// - max_slope_pct = 区間内の course point の slope_pct の最大値 (= 既存 avg と同じ粒度、
//   GPX 由来 slope_pct をそのまま max してて、 短 segment 由来の noise smoothing はしない).
//   slope_pct が無い point は無視、 全 point に slope_pct が無ければ avg_slope_pct を fallback.
// - course が空 / 1 点なら空配列を返す (= 区間切れない).
// - n < 1 なら空配列、 n が course point 数を超えても区間は n 個作る (= ただし point 数 < n の場合は
//   一部区間が同 idx を持つ degenerate ケース、 通常 24km / 1968 点なら n=10 で十分余裕).
//
// 区間の {start_dist, end_dist, start_ele, end_ele} は実際の course point の値を採用、
// 「ちょうど 2400m」を補間して点を作る方式は採らない (= 簡潔さ優先、 GPX 由来精度上限 LOAD-BEARING).

/**
 * course を distance 等分で n 区間に分割する.
 *
 * @param {Array<{distance_m:number, elevation_m:number, slope_pct?:number, lat?:number, lon?:number}>} course
 * @param {number} [n=10] 区間数 (= default 10、 富士ヒル 24km なら 1 区間 2.4km).
 * @returns {Array<{
 *   index: number,
 *   start_idx: number, end_idx: number,
 *   start_dist: number, end_dist: number,
 *   start_ele: number, end_ele: number,
 *   avg_slope_pct: number,
 *   max_slope_pct: number,
 * }>}
 */
export function splitCourseIntoSections(course, n = 10) {
  if (!Array.isArray(course)) return [];
  if (course.length < 2) return [];
  if (!Number.isFinite(n) || n < 1) return [];

  const total = course[course.length - 1].distance_m;
  if (!(total > 0)) return [];

  const segLen = total / n;
  const sections = [];
  let cursor = 0;  // course の検索 cursor (= start_idx 探索の効率化用)

  for (let i = 0; i < n; i++) {
    const startDistTarget = i * segLen;
    const endDistTarget = (i === n - 1) ? total : (i + 1) * segLen;

    // start_idx: cursor 以降で「distance_m >= startDistTarget」を満たす最初の idx.
    // i === 0 のとき startDistTarget = 0、 course[0].distance_m = 0 なので start_idx = 0.
    let startIdx = cursor;
    while (startIdx < course.length - 1 && course[startIdx].distance_m < startDistTarget) {
      startIdx++;
    }

    // end_idx: startIdx 以降で「distance_m <= endDistTarget」を満たす最後の idx.
    // 最終区間は course.length - 1 を必ず end_idx にする.
    let endIdx;
    if (i === n - 1) {
      endIdx = course.length - 1;
    } else {
      endIdx = startIdx;
      while (endIdx + 1 < course.length && course[endIdx + 1].distance_m <= endDistTarget) {
        endIdx++;
      }
    }

    const startPt = course[startIdx];
    const endPt = course[endIdx];
    const startDist = startPt.distance_m;
    const endDist = endPt.distance_m;
    const startEle = startPt.elevation_m;
    const endEle = endPt.elevation_m;
    const dx = endDist - startDist;
    // div-by-zero guard: 同 idx に縮退 (= course 点数が n より少ない degenerate) なら勾配 0.
    const avgSlope = (dx > 0) ? ((endEle - startEle) / dx * 100) : 0;

    // 区間内 course point の slope_pct の max。 finite な値のみ集計、 1 つも無ければ avg を fallback。
    let maxSlope = -Infinity;
    for (let k = startIdx; k <= endIdx; k++) {
      const s = course[k].slope_pct;
      if (Number.isFinite(s) && s > maxSlope) maxSlope = s;
    }
    if (!Number.isFinite(maxSlope)) maxSlope = avgSlope;

    sections.push({
      index: i,
      start_idx: startIdx,
      end_idx: endIdx,
      start_dist: startDist,
      end_dist: endDist,
      start_ele: startEle,
      end_ele: endEle,
      avg_slope_pct: avgSlope,
      max_slope_pct: maxSlope,
    });

    // 次区間の start 探索 cursor を末尾 idx 直後に進める (= O(n+m) で全区間分割完了)
    cursor = endIdx;
  }

  return sections;
}

/**
 * 1 区間を 1 行の表示用文字列に変換する (= UI helper、 lib 側で持つことで test 可能).
 *
 * 例: "区間 1: 0.0-2.4 km、 平均勾配 5.2%"
 *
 * @param {{index:number, start_dist:number, end_dist:number, avg_slope_pct:number}} section
 * @returns {string}
 */
export function formatSectionLabel(section) {
  if (!section || typeof section !== 'object') return '';
  const startKm = (section.start_dist / 1000).toFixed(1);
  const endKm = (section.end_dist / 1000).toFixed(1);
  const slope = section.avg_slope_pct.toFixed(1);
  return `区間 ${section.index + 1}: ${startKm}-${endKm} km、 平均勾配 ${slope}%`;
}
