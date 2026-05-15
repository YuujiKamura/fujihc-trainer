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
 * course 各点に対する「miter 法線 offset 点」を事前計算する.
 *
 * 隣接 segment が共通の端点 offset を **共有** することで、
 * segment ごとに独立計算した時に発生する微小な隙間 / 重なり (= 累積誤差)
 * を物理的にゼロ化する.
 *
 * 各点 i の進行方向 dir(i) は:
 *   - 端点 i=0:        course[0] → course[1] 方向
 *   - 端点 i=N-1:      course[N-2] → course[N-1] 方向
 *   - 中間 0<i<N-1:    (dirPrev + dirNext) を normalize した bisector
 * 法線 = dir を 90° CCW 回転 (-dy, dx).
 *
 * meter ↔ degree 換算は各点の lat に応じた cosLat で個別に計算
 * (= 富士スバルラインの緯度幅は無視できないほどではないが、 整合性のため per-point).
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {number} halfWidthM
 * @returns {Array<{leftLon, leftLat, rightLon, rightLat}>} length === course.length
 */
export function computeMiterOffsets(course, halfWidthM) {
  const n = course.length;
  if (n < 2) return [];

  // unit vector in meter-space (cosLat 補正済) from p → q.
  function unitVec(p, q) {
    const cosLat = Math.cos((p.lat * Math.PI) / 180);
    const dx = (q.lon - p.lon) * 111320 * cosLat;
    const dy = (q.lat - p.lat) * 111320;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = course[i];
    const dPrev = i > 0 ? unitVec(course[i - 1], course[i]) : null;
    const dNext = i < n - 1 ? unitVec(course[i], course[i + 1]) : null;

    let dx, dy;
    if (dPrev && dNext) {
      // bisector = dPrev + dNext, then normalize.
      dx = dPrev.x + dNext.x;
      dy = dPrev.y + dNext.y;
      const blen = Math.hypot(dx, dy);
      if (blen === 0) {
        // 180° 折返し (= ありえないが) → 進行方向を dNext で代用.
        dx = dNext.x;
        dy = dNext.y;
      } else {
        dx /= blen;
        dy /= blen;
      }
    } else if (dNext) {
      dx = dNext.x;
      dy = dNext.y;
    } else if (dPrev) {
      dx = dPrev.x;
      dy = dPrev.y;
    } else {
      dx = 0;
      dy = 1;
    }

    // 法線 (= 進行方向の左 90°): (-dy, dx)
    const nx = -dy;
    const ny = dx;

    // 法線方向に halfWidthM (meter) → degree 変換.
    const cosLat = Math.cos((p.lat * Math.PI) / 180);
    const metersPerDegLon = METERS_PER_DEG_LAT * cosLat;
    const offLon = (nx * halfWidthM) / metersPerDegLon;
    const offLat = (ny * halfWidthM) / METERS_PER_DEG_LAT;

    result[i] = {
      leftLon: p.lon + offLon,
      leftLat: p.lat + offLat,
      rightLon: p.lon - offLon,
      rightLat: p.lat - offLat,
    };
  }
  return result;
}

/**
 * brief 25 + Fix1: course 各点列を「一定幅の道路 polygon」として buffer 化.
 *
 * miter offset で **隣接 segment が頂点を共有** (= 隙間ゼロ).
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
  const halfW = widthM / 2;
  const offsets = computeMiterOffsets(course, halfW);
  const features = [];
  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i];
    const b = course[i + 1];
    const oa = offsets[i];
    const ob = offsets[i + 1];

    // 4 頂点 CCW + close: aLeft, bLeft, bRight, aRight, aLeft.
    const ring = [
      [oa.leftLon, oa.leftLat],
      [ob.leftLon, ob.leftLat],
      [ob.rightLon, ob.rightLat],
      [oa.rightLon, oa.rightLat],
      [oa.leftLon, oa.leftLat],
    ];

    // 2026-05-15 fix (= user 指摘「路面の色が先に変わって、 しばらく進んでから負荷が
    // 遅れてくる」): 旧版は b.slope_pct (= 次区間の勾配) で polygon を塗っていたが、
    // viewer-maplibre.js の maybeSendSlope は course[curIdx].slope_pct (= 始点側) を
    // 送信していたため、 視覚 (1 segment 先) と体感 (今の segment) が 1 段ずれていた。
    // segment [i → i+1] は「rider が i から i+1 へ進む区間」、 a.slope_pct (= 始点側) で
    // 塗ると trainer 負荷と同期する (= 物理直感に一致).
    let slope = a.slope_pct;
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = b.slope_pct;
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
