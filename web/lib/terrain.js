// brief 35: Terrain (= 地形・経路・区間の客観モデル).
//
// 役割:
// - course (= GPX 由来 {distance_m, lat, lon, elevation_m, slope_pct}[]) を保有し、
//   「ある distance において位置/標高/勾配/進行方位がどうか」 を返す read-only query 層.
// - Rider が持つのは distanceTraveled / speed / sensor 値だけ、 「今の lat/lon/heading」 は
//   Terrain への query で取得する (= 第一級モデル Terrain ⊃ Rider の責務分離).
//
// 設計:
// - immutable: course array は内部参照、 外向け mutation API は持たない.
// - pure: DOM / browser global / 時計依存ゼロ (= node test 容易).
// - course は内部隠蔽、 必要なら getPointAtIdx(idx) で取り出せる (= viewer 側で polyline 構築等).
// - 既存 lib/heading.js (= computeTravelHeading) / lib/course_sections.js
//   (= splitCourseIntoSections) を委譲利用、 二重実装しない.

import { computeTravelHeading, clampIndex } from './heading.js';
import { splitCourseIntoSections } from './course_sections.js';

/**
 * Terrain を生成する.
 *
 * @param {{course: Array<{lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number}>}} opts
 * @returns {{
 *   length: number,
 *   totalDistance: number,
 *   bounds: {latMin:number, latMax:number, lonMin:number, lonMax:number, eleMin:number, eleMax:number},
 *   getPositionAtDistance: (d:number) => {lat:number, lon:number, elevation:number, slope_pct:number, heading:number, segmentIdx:number, fracInSegment:number, distance:number},
 *   getPointAtIdx: (idx:number) => {lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number},
 *   getCourse: () => Array<object>,
 *   idxAtDistance: (d:number) => number,
 *   distanceAtIdx: (idx:number) => number,
 *   getSections: (n?:number) => Array<object>,
 * }}
 */
export function createTerrain({ course } = {}) {
  if (!Array.isArray(course)) {
    throw new TypeError('createTerrain: course must be an array');
  }

  const length = course.length;
  const totalDistance = length > 0
    ? (Number.isFinite(course[length - 1].distance_m) ? course[length - 1].distance_m : 0)
    : 0;
  const lastIdx = Math.max(0, length - 1);

  // bounds は 1 度だけ算出 (= immutable、 minimap / debug HUD で再利用).
  let latMin = Infinity, latMax = -Infinity;
  let lonMin = Infinity, lonMax = -Infinity;
  let eleMin = Infinity, eleMax = -Infinity;
  for (const p of course) {
    if (Number.isFinite(p.lat)) {
      if (p.lat < latMin) latMin = p.lat;
      if (p.lat > latMax) latMax = p.lat;
    }
    if (Number.isFinite(p.lon)) {
      if (p.lon < lonMin) lonMin = p.lon;
      if (p.lon > lonMax) lonMax = p.lon;
    }
    if (Number.isFinite(p.elevation_m)) {
      if (p.elevation_m < eleMin) eleMin = p.elevation_m;
      if (p.elevation_m > eleMax) eleMax = p.elevation_m;
    }
  }
  // 空 course の bounds は 0 で固定 (= NaN/Infinity を外に漏らさない).
  if (!Number.isFinite(latMin)) latMin = 0;
  if (!Number.isFinite(latMax)) latMax = 0;
  if (!Number.isFinite(lonMin)) lonMin = 0;
  if (!Number.isFinite(lonMax)) lonMax = 0;
  if (!Number.isFinite(eleMin)) eleMin = 0;
  if (!Number.isFinite(eleMax)) eleMax = 0;
  const bounds = Object.freeze({ latMin, latMax, lonMin, lonMax, eleMin, eleMax });

  function clampDist(d) {
    if (!Number.isFinite(d) || d < 0) return 0;
    if (d > totalDistance) return totalDistance;
    return d;
  }

  function idxAtDistance(d) {
    if (length === 0) return 0;
    const target = clampDist(d);
    // distance_m は単調増加前提 (= GPX 由来), 線形 scan で十分.
    // 「distance_m <= target を満たす最大 idx」 を返す.
    let i = 0;
    while (i < lastIdx && course[i + 1].distance_m <= target) i++;
    return i;
  }

  function distanceAtIdx(idx) {
    if (length === 0) return 0;
    const i = clampIndex(idx, length);
    return Number.isFinite(course[i].distance_m) ? course[i].distance_m : 0;
  }

  function getPointAtIdx(idx) {
    if (length === 0) return null;
    const i = clampIndex(idx, length);
    return course[i];
  }

  /**
   * ある distance での位置/標高/勾配/進行方位を返す.
   *
   * - lat/lon/elevation は当該 segment 内で frac 線形補間 (= viewer tick の中身を移送).
   * - heading は course[segmentIdx] から lookAhead=5 先の travel heading (degrees, 0=北).
   * - slope_pct は course[segmentIdx] の値 (= segment 内 1 値、 GPX 由来精度).
   *
   * @param {number} d
   * @param {number} [lookAhead=5]
   */
  function getPositionAtDistance(d, lookAhead = 5) {
    if (length === 0) {
      return {
        lat: 0, lon: 0, elevation: 0, slope_pct: 0,
        heading: 0, segmentIdx: 0, fracInSegment: 0, distance: 0,
      };
    }
    const distance = clampDist(d);
    const idx = idxAtDistance(distance);
    const p = course[idx];
    const pNext = course[Math.min(idx + 1, lastIdx)];
    const segLen = pNext.distance_m - p.distance_m;
    const frac = segLen > 0
      ? Math.min(1, Math.max(0, (distance - p.distance_m) / segLen))
      : 0;
    const lat = p.lat + (pNext.lat - p.lat) * frac;
    const lon = p.lon + (pNext.lon - p.lon) * frac;
    const elevation = p.elevation_m + (pNext.elevation_m - p.elevation_m) * frac;
    const slope_pct = Number.isFinite(p.slope_pct) ? p.slope_pct : 0;
    const heading = computeTravelHeading(course, idx, lookAhead);
    return {
      lat, lon, elevation, slope_pct, heading,
      segmentIdx: idx, fracInSegment: frac, distance,
    };
  }

  // course を外から扱う必要のある場面 (= polyline 構築 / minimap 描画) 用に shallow copy を返す.
  // 内部参照を直接漏らすと viewer 側で誤って mutation する事故が起きる、 浅 copy で防ぐ.
  function getCourse() {
    return course.slice();
  }

  function getSections(n = 10) {
    return splitCourseIntoSections(course, n);
  }

  return {
    length,
    totalDistance,
    bounds,
    getPositionAtDistance,
    getPointAtIdx,
    getCourse,
    idxAtDistance,
    distanceAtIdx,
    getSections,
  };
}
