// brief 24: Zwift Climb Portal 風の勾配グレード別色分け.
//
// 富士ヒル course 各点の slope_pct を 6 段階のグレードに分類し、
// MapLibre の LineString feature properties + paint expression で
// 動的に色を変える substrate を提供する pure functions.
//
// 1 segment = 隣接 2 点間の LineString (= viewer 側の polyline を
// segment 単位 FeatureCollection に分解する)、 properties に区間の
// 平均 slope_pct と grade name と hex color を持たせる.

/**
 * 勾配グレード閾値テーブル.
 * 富士ヒル平均 5.2%、 最大区間勾配 7-9% の特性に合わせた境界.
 * min は inclusive、 max は exclusive (= [min, max) の半開区間).
 *
 * grade name      slope_pct 範囲    hex color (近似)
 *   flat          <= 1%            #3aa055  (緑)
 *   gentle        1-4%             #a3c853  (黄緑)
 *   moderate      4-7%             #f4d03f  (黄)
 *   hard          7-10%            #e67e22  (橙)
 *   very_hard     10-15%           #e74c3c  (赤)
 *   extreme       > 15%            #8e44ad  (紫)
 */
export const GRADE_THRESHOLDS = [
  { name: 'flat',      min: -Infinity, max: 1,        color: '#3aa055' },
  { name: 'gentle',    min: 1,         max: 4,        color: '#a3c853' },
  { name: 'moderate',  min: 4,         max: 7,        color: '#f4d03f' },
  { name: 'hard',      min: 7,         max: 10,       color: '#e67e22' },
  { name: 'very_hard', min: 10,        max: 15,       color: '#e74c3c' },
  { name: 'extreme',   min: 15,        max: Infinity, color: '#8e44ad' },
];

const DEFAULT_GRADE = GRADE_THRESHOLDS[0]; // flat / 緑 (安全側 default).

/**
 * 勾配 % を grade name / color に分類.
 *
 * null / undefined / NaN は flat 扱い (= 安全側 default、 緑).
 * 境界は min inclusive / max exclusive (= 1.0% は gentle、 4.0% は moderate).
 * 負値は flat 扱い (= 下り、 富士ヒル climb では想定外だが扱う).
 *
 * @param {number|null|undefined} slope_pct
 * @returns {{name: string, color: string}}
 */
export function classifyGrade(slope_pct) {
  if (slope_pct === null || slope_pct === undefined || Number.isNaN(slope_pct)) {
    return { name: DEFAULT_GRADE.name, color: DEFAULT_GRADE.color };
  }
  for (const g of GRADE_THRESHOLDS) {
    if (slope_pct >= g.min && slope_pct < g.max) {
      return { name: g.name, color: g.color };
    }
  }
  return { name: DEFAULT_GRADE.name, color: DEFAULT_GRADE.color };
}

/**
 * course を segment 単位の GeoJSON FeatureCollection に分解.
 * 1 segment = course[i] - course[i+1] の LineString.
 * segment 数 = course.length - 1.
 *
 * 各 segment の slope_pct は course[i+1].slope_pct を採用
 * (= viewer 側の altitude profile と同じ「次区間の勾配」semantics).
 * course[i+1] が無ければ course[i].slope_pct、 それも無ければ 0.
 *
 * @param {Array<{lat: number, lon: number, slope_pct?: number, distance_m?: number}>} course
 * @returns {{type: string, features: Array}} - GeoJSON FeatureCollection
 */
export function buildGradeColoredRoute(course) {
  if (!Array.isArray(course) || course.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i];
    const b = course[i + 1];
    // 「次区間の勾配」(= b の slope_pct) を採用. fallback chain.
    let slope = b.slope_pct;
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = a.slope_pct;
    }
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = 0;
    }
    const { name, color } = classifyGrade(slope);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
      properties: {
        slope_pct: slope,
        grade: name,
        color: color,
        distance_m_start: a.distance_m ?? null,
        distance_m_end: b.distance_m ?? null,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * MapLibre の line-color paint expression を返す (= properties.grade で分岐).
 * 戻り値は MapLibre style spec の case expression、 そのまま
 * map.setPaintProperty(layerId, 'line-color', expr) で使える.
 *
 * Output 形:
 *   ['case',
 *     ['==', ['get', 'grade'], 'flat'],      '#3aa055',
 *     ['==', ['get', 'grade'], 'gentle'],    '#a3c853',
 *     ...
 *     '#3aa055'   // default (= flat / 緑、 safe fallback).
 *   ]
 *
 * @returns {Array}
 */
export function makeGradeColorExpression() {
  const expr = ['case'];
  for (const g of GRADE_THRESHOLDS) {
    expr.push(['==', ['get', 'grade'], g.name]);
    expr.push(g.color);
  }
  expr.push(DEFAULT_GRADE.color); // default = flat 緑.
  return expr;
}
