// b50: viewer-maplibre.js の loadCourse() から「fetch → 平滑化 → terrain 構築」の
// 純粋部を切り出した course ローダ。
//
// DOM・モジュールグローバルに一切触れない framework 非依存モジュール ── 現行 viewer も
// 将来の殻 (Svelte 等) も同じこれを import して course を読む。viewer 固有の配線
// (rideState 生成 / renderCourse / minimap / tick 起動) は呼び出し側に残す。

import { smoothCourse } from './gpx_smooth.js';
import { createTerrain } from './terrain.js';

/**
 * course.json を取得し、GPS ジッターを平滑化して terrain を構築する純粋ローダ。
 *
 * 失敗は Error を投げる ── HTTP エラーは `HTTP <status>`、空 course は
 * `course.json empty`。status 文言の表示は呼び出し側の責務 (= この module は UI を持たない)。
 *
 * @param {string} url course.json の URL
 * @param {{fetchImpl?: typeof fetch}} [opts] fetchImpl は test 用の注入口
 *   (= node から実 fetch せず検証できるようにする)。
 * @returns {Promise<{course: object[], terrain: object, totalDist: number}>}
 *   totalDist は terrain の haversine 累積長 (= viewer / rider / minimap が共有する
 *   唯一の距離スケール、terrain.totalDistance と同値)。
 */
export async function loadCourseData(url, { fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch;
  const resp = await doFetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  let course = await resp.json();
  if (!course || !course.length) throw new Error('course.json empty');
  // brief 23: GPS ジッター除去。lat/lon の short-window moving average で短距離
  // ジグザグだけ補正、道路カーブは保存。distance_m / slope_pct / elevation_m は不変。
  course = smoothCourse(course);
  // brief 35: terrain は course の lat/lon の haversine 実長を距離スケールにする。
  const terrain = createTerrain({ course });
  return { course, terrain, totalDist: terrain.totalDistance };
}
