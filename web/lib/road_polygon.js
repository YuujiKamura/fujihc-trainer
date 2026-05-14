// brief 25: course 各点列を「一定幅の道路 polygon」として buffer 化.
//
// MapLibre の `line` layer は pixel 単位幅で zoom に応じて表示幅が変わるが、
// 「現実の道路幅 (= meter 単位)」を持たない. 本 module は course を segment 単位の
// Polygon (= 進行方向に直交する左右 offset で囲った 4 頂点の strip) に変換し、
// MapLibre `fill` / `fill-extrusion` layer で「meter 幅の路面」を描画可能にする.
//
// lat/lon → meter 換算は緯度依存. 富士山緯度 (= 35.4°) 付近では:
//   1 度 latitude  ≈ 111320 m
//   1 度 longitude ≈ 111320 * cos(35.4°) m ≈ 90730 m
//
// brief 24 (= route_styling.js の classifyGrade) と統合した
// buildGradeColoredRoadPolygons で、 1 source / 1 layer で「grade 色分け + 道幅 polygon」
// を MapLibre に渡せる.

import { classifyGrade } from './route_styling.js';

// 1 度 latitude あたりの meter 数 (= 地球を球で近似、 WGS84 平均).
const METERS_PER_DEG_LAT = 111320;

/**
 * 2 点 A, B (= 隣接する course 点) から、 進行方向に直交する左右 offset
 * widthM/2 を持つ 4 頂点 Polygon の各座標 (lon, lat) を返す.
 *
 * 算法:
 *   1. midLat = (A.lat + B.lat) / 2 で cos 補正係数を決める.
 *   2. A→B を meter 系の vector (dx, dy) に変換.
 *   3. 単位 perpendicular vector (-dy, dx) / |v| を作る (= 進行方向の左 90°).
 *   4. perp * (widthM / 2) を A, B にそれぞれ ± 加算 → 4 角.
 *   5. degree 系に戻して [lon, lat] で返す. 末尾に start を repeat して閉じる.
 *
 * 退化 segment (= A == B、 dx=dy=0) の場合は A 点を 5 回返す (= 縮退 polygon).
 * MapLibre は無視するし、 segment 数を保ったまま安全に通せる.
 *
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 * @param {number} widthM - 道路幅 (m).
 * @returns {Array<[number, number]>} - [topLeft, topRight, bottomRight, bottomLeft, topLeft] (closed, length 5).
 */
export function offsetSegment(a, b, widthM) {
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const metersPerDegLon = METERS_PER_DEG_LAT * cosLat;

  // A→B vector in meters.
  const dxM = (b.lon - a.lon) * metersPerDegLon;
  const dyM = (b.lat - a.lat) * METERS_PER_DEG_LAT;
  const lenM = Math.hypot(dxM, dyM);

  if (lenM === 0) {
    // 退化 segment: 4 頂点とも A に縮退、 closed なので 5 個返す.
    const p = [a.lon, a.lat];
    return [p, p, p, p, p];
  }

  // 単位 perpendicular vector (進行方向の左 90°).
  // 進行方向 (dxM, dyM) を 90° CCW 回転 → (-dyM, dxM).
  const halfW = widthM / 2;
  const perpXM = (-dyM / lenM) * halfW;
  const perpYM = (dxM / lenM) * halfW;

  // perp を degree に戻す.
  const perpLon = perpXM / metersPerDegLon;
  const perpLat = perpYM / METERS_PER_DEG_LAT;

  // 4 頂点 (A_left, B_left, B_right, A_right) を CCW で並べる + 閉じる.
  const aLeft  = [a.lon + perpLon, a.lat + perpLat];
  const bLeft  = [b.lon + perpLon, b.lat + perpLat];
  const bRight = [b.lon - perpLon, b.lat - perpLat];
  const aRight = [a.lon - perpLon, a.lat - perpLat];

  return [aLeft, bLeft, bRight, aRight, aLeft];
}

/**
 * brief 25: course 各点列を「一定幅の道路 polygon」として buffer 化.
 *
 * 各 segment (= 隣接 2 点間) を offsetSegment で 4 頂点 Polygon に変換.
 * segment 数 = course.length - 1.
 *
 * @param {Array<{lat: number, lon: number, slope_pct?: number, distance_m?: number}>} course
 * @param {number} [widthM=5] - 道路幅 (m). 1 車線 + 路肩で 5m が default.
 * @returns {{type: string, features: Array}} - GeoJSON FeatureCollection.
 *   各 feature: { type: 'Feature',
 *                  geometry: { type: 'Polygon', coordinates: [[[lon, lat], ...]] },
 *                  properties: { slope_pct, distance_m_start, distance_m_end } }
 */
export function buildRoadPolygons(course, widthM = 5) {
  if (!Array.isArray(course) || course.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i];
    const b = course[i + 1];
    const ring = offsetSegment(a, b, widthM);

    // brief 24 と同じ「次区間の勾配」semantics.
    let slope = b.slope_pct;
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = a.slope_pct;
    }
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = 0;
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [ring],
      },
      properties: {
        slope_pct: slope,
        distance_m_start: a.distance_m ?? null,
        distance_m_end: b.distance_m ?? null,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * brief 24 の grade 色分けと統合した版.
 * 各 polygon feature の properties に slope_pct / grade / color を含める.
 * viewer 側は 1 source / 1 fill layer の paint expression (= properties.color を使う)
 * で grade 色分け済の道幅 polygon を描画できる.
 *
 * classifyGrade は route_styling.js から import 再利用 (= 重複実装するな、
 * drift catalog NG-R1-11 同型回避).
 *
 * @param {Array<{lat: number, lon: number, slope_pct?: number, distance_m?: number}>} course
 * @param {number} [widthM=5]
 * @returns {{type: string, features: Array}}
 */
export function buildGradeColoredRoadPolygons(course, widthM = 5) {
  const fc = buildRoadPolygons(course, widthM);
  for (const f of fc.features) {
    const { name, color } = classifyGrade(f.properties.slope_pct);
    f.properties.grade = name;
    f.properties.color = color;
  }
  return fc;
}
