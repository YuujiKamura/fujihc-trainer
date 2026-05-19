// brief 35 / rider-position-model: Terrain (= 地形・経路・区間の客観モデル).
//
// 役割:
// - course (= GPX 由来 {distance_m, lat, lon, elevation_m, slope_pct}[]) を保有し、
//   「センターライン上のある一点 (segmentIdx, fracInSegment) において位置/標高/勾配/
//   進行方位がどうか」 を返す read-only query 層.
// - Rider が持つのは位置 (segmentIdx, fracInSegment) と speed / sensor 値だけ、
//   「今の lat/lon/heading」 は Terrain への query で取得する (= Terrain ⊃ Rider).
//
// 距離スケール (= rider-position-model で作り直した核):
// - course の `distance_m` フィールドは **使わない**. smoothCourse が lat/lon を平滑化
//   しても distance_m を再計算しないため、 メモリ内では lat/lon と distance_m が
//   食い違う (= 走行記録が壊れる root-cause).
// - 構築時に course の緯度経度から haversine でセグメント長 (_segLen) と累積長
//   (_cumLen) を 1 度だけ計算し、 これを唯一の距離スケールにする. totalDistance /
//   distanceAtIdx / idxAtDistance / getPositionAtDistance はすべて _cumLen ベース.
// - これで「距離 = センターライン上を実際に歩いた haversine 道のり」 が保証され、
//   位置と距離が構造的に食い違えない.
//
// 設計:
// - immutable: course array は内部参照、 外向け mutation API は持たない.
// - pure: DOM / browser global / 時計依存ゼロ (= node test 容易).
// - 既存 lib/heading.js (= computeTravelHeading) / lib/course_sections.js
//   (= splitCourseIntoSections) を委譲利用、 二重実装しない.

import { computeTravelHeading, clampIndex } from './heading.js';
import { splitCourseIntoSections } from './course_sections.js';

// 地球半径 (m). haversine 距離計算に使う (= WGS84 平均半径).
const EARTH_RADIUS_M = 6371000;

/**
 * 2 点間の haversine 実距離 (m). 緯度経度の球面距離、 course の distance_m は使わない.
 * 参照: https://www.movable-type.co.uk/scripts/latlong.html
 *
 * @param {{lat:number, lon:number}} a
 * @param {{lat:number, lon:number}} b
 * @returns {number} メートル (= 不正入力なら 0)
 */
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  return Number.isFinite(d) ? d : 0;
}

/**
 * Terrain を生成する.
 *
 * @param {{course: Array<{lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number}>}} opts
 * @returns {{
 *   length: number,
 *   segmentCount: number,
 *   totalDistance: number,
 *   bounds: {latMin:number, latMax:number, lonMin:number, lonMax:number, eleMin:number, eleMax:number},
 *   segmentLength: (i:number) => number,
 *   getPositionAt: (segIdx:number, frac:number, lookAhead?:number) => object,
 *   distanceAt: (segIdx:number, frac:number) => number,
 *   locate: (d:number) => {segmentIdx:number, fracInSegment:number},
 *   getPositionAtDistance: (d:number, lookAhead?:number) => object,
 *   getPointAtIdx: (idx:number) => object,
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
  const lastIdx = Math.max(0, length - 1);
  // セグメント数 = 点数 - 1 (= ポリラインの辺の数). 0/1 点 course は 0.
  const segmentCount = Math.max(0, length - 1);

  // === haversine 距離スケール (= 構築時 1 度だけ、 immutable) ===
  // _segLen[i] = course[i] → course[i+1] の haversine 実距離 (m).
  // _cumLen[i] = course[0] から course[i] までの累積 (m)、 _cumLen[0] = 0.
  const _segLen = new Array(segmentCount);
  const _cumLen = new Array(length);
  if (length > 0) _cumLen[0] = 0;
  for (let i = 0; i < segmentCount; i++) {
    const d = haversineMeters(course[i], course[i + 1]);
    _segLen[i] = d;
    _cumLen[i + 1] = _cumLen[i] + d;
  }
  const totalDistance = length > 0 ? _cumLen[lastIdx] : 0;

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

  // d を [0, totalDistance] にクランプ.
  function clampDist(d) {
    if (!Number.isFinite(d) || d < 0) return 0;
    if (d > totalDistance) return totalDistance;
    return d;
  }

  // segIdx を [0, segmentCount-1] の整数にクランプ. segment が無い (0/1 点) なら 0.
  function clampSeg(segIdx) {
    if (segmentCount <= 0) return 0;
    const i = Math.floor(Number(segIdx));
    if (!Number.isFinite(i) || i < 0) return 0;
    if (i >= segmentCount) return segmentCount - 1;
    return i;
  }

  // frac を [0, 1] にクランプ (= 非有限は 0).
  function clampFrac(frac) {
    const f = Number(frac);
    if (!Number.isFinite(f)) return 0;
    if (f < 0) return 0;
    if (f > 1) return 1;
    return f;
  }

  /**
   * セグメント i の haversine 実長 (m). 範囲外 / segment 無しは 0.
   */
  function segmentLength(i) {
    if (segmentCount <= 0) return 0;
    const idx = Math.floor(Number(i));
    if (!Number.isFinite(idx) || idx < 0 || idx >= segmentCount) return 0;
    return _segLen[idx];
  }

  /**
   * 位置 (segmentIdx, fracInSegment) → distanceTraveled (= _cumLen ベースの haversine
   * 累積距離). 「距離は位置から読み取る getter」 の core.
   */
  function distanceAt(segIdx, frac) {
    if (segmentCount <= 0) return 0;
    const si = clampSeg(segIdx);
    const f = clampFrac(frac);
    return _cumLen[si] + f * _segLen[si];
  }

  /**
   * distance (m) → 位置 (segmentIdx, fracInSegment). placeAtDistance / seekToward /
   * 旧 distance ベース API のための一発変換. per-tick 移動には使わない (= rider が
   * ポリラインを直接歩く).
   */
  function locate(d) {
    if (segmentCount <= 0) return { segmentIdx: 0, fracInSegment: 0 };
    const dist = clampDist(d);
    // _cumLen は単調増加. 「_cumLen[i+1] <= dist を満たす最大セグメント i」 を線形 scan.
    let i = 0;
    while (i < segmentCount - 1 && _cumLen[i + 1] <= dist) i++;
    const sl = _segLen[i];
    const frac = sl > 0 ? Math.min(1, Math.max(0, (dist - _cumLen[i]) / sl)) : 0;
    return { segmentIdx: i, fracInSegment: frac };
  }

  /**
   * 位置 (segmentIdx, fracInSegment) での lat/lon/標高/勾配/進行方位/距離を返す.
   *
   * - lat/lon/elevation は当該 segment 内で frac 線形補間.
   * - heading は course[segmentIdx] から lookAhead 先の travel heading (degrees, 0=北).
   * - slope_pct は course[segmentIdx] の値 (= segment 始点、 GPX 由来精度).
   * - distance は distanceAt(segIdx, frac) (= _cumLen ベース).
   *
   * @param {number} segIdx
   * @param {number} frac
   * @param {number} [lookAhead=5]
   */
  function getPositionAt(segIdx, frac, lookAhead = 5) {
    if (length === 0) {
      return {
        lat: 0, lon: 0, elevation: 0, slope_pct: 0,
        heading: 0, segmentIdx: 0, fracInSegment: 0, distance: 0,
      };
    }
    if (segmentCount === 0) {
      // 単一点 course: segment が無い、 位置は course[0] 固定.
      const p = course[0];
      return {
        lat: Number.isFinite(p.lat) ? p.lat : 0,
        lon: Number.isFinite(p.lon) ? p.lon : 0,
        elevation: Number.isFinite(p.elevation_m) ? p.elevation_m : 0,
        slope_pct: Number.isFinite(p.slope_pct) ? p.slope_pct : 0,
        heading: 0, segmentIdx: 0, fracInSegment: 0, distance: 0,
      };
    }
    const si = clampSeg(segIdx);
    const f = clampFrac(frac);
    const p = course[si];
    const pNext = course[si + 1];
    const lat = p.lat + (pNext.lat - p.lat) * f;
    const lon = p.lon + (pNext.lon - p.lon) * f;
    const elevation = p.elevation_m + (pNext.elevation_m - p.elevation_m) * f;
    const slope_pct = Number.isFinite(p.slope_pct) ? p.slope_pct : 0;
    const heading = computeTravelHeading(course, si, lookAhead);
    return {
      lat, lon, elevation, slope_pct, heading,
      segmentIdx: si, fracInSegment: f, distance: distanceAt(si, f),
    };
  }

  /**
   * distance (m) での位置. locate → getPositionAt の合成 (= 旧 API 互換).
   */
  function getPositionAtDistance(d, lookAhead = 5) {
    const loc = locate(d);
    return getPositionAt(loc.segmentIdx, loc.fracInSegment, lookAhead);
  }

  /**
   * distance (m) を含むセグメントの始点 course 点 index (0..lastIdx) を返す.
   * 「_cumLen[idx] <= d を満たす最大の点 index」、 d=totalDistance では lastIdx.
   */
  function idxAtDistance(d) {
    if (length === 0) return 0;
    const dist = clampDist(d);
    let i = 0;
    while (i < lastIdx && _cumLen[i + 1] <= dist) i++;
    return i;
  }

  /**
   * course 点 idx の累積 haversine 距離 (m). idx は [0, lastIdx] にクランプ.
   */
  function distanceAtIdx(idx) {
    if (length === 0) return 0;
    const i = clampIndex(idx, length);
    return _cumLen[i];
  }

  function getPointAtIdx(idx) {
    if (length === 0) return null;
    const i = clampIndex(idx, length);
    return course[i];
  }

  // course を外から扱う必要のある場面 (= polyline 構築 / minimap 描画) 用に shallow copy.
  function getCourse() {
    return course.slice();
  }

  // 「観る」 モードの区間分割. course_sections.js に委譲 (= distance_m ベースの区間
  // パーティション、 rider 移動とは別系統の表示機能、 本モデルの距離スケールとは独立).
  function getSections(n = 10) {
    return splitCourseIntoSections(course, n);
  }

  return {
    length,
    segmentCount,
    totalDistance,
    bounds,
    segmentLength,
    getPositionAt,
    distanceAt,
    locate,
    getPositionAtDistance,
    getPointAtIdx,
    getCourse,
    idxAtDistance,
    distanceAtIdx,
    getSections,
  };
}
