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

// 連続グレード色用のアンカー: [slope_pct, [r,g,b]]。 代表色を slope 軸上に並べ、
// 中間は RGB 線形補間する。
//
// 富士ヒルの実勾配はほぼ 0〜10% に集中するため、 旧 6 段階では road がほぼ
// 緑〜黄〜橙の狭い帯にしか見えなかった。 0〜10% の登坂域に stop を密に置き、
// 緑 → 黄緑 → ライム → 黄 → 山吹 → 橙 → 朱 → 赤 → 赤紫 → 紫 と色相を広く取って、
// 同じ course でも勾配差が豊かな色変化として出るようにした (= 色変化の多様化)。
// 両端 (0% = 緑 #3aa055 / 17% = 紫 #8e44ad) は据え置き、 間を密化・多色化している。
const GRADE_COLOR_STOPS = [
  [0,    [58, 160, 85]],   // #3aa055 緑     (flat)
  [1.5,  [120, 200, 70]],  // 黄緑
  [3,    [180, 215, 50]],  // ライム
  [4.5,  [240, 220, 40]],  // 黄
  [6,    [250, 180, 30]],  // 山吹
  [7.5,  [240, 130, 30]],  // 橙
  [9,    [235, 85, 35]],   // 朱
  [11,   [225, 55, 55]],   // 赤
  [13.5, [210, 50, 110]],  // 赤紫
  [17,   [142, 68, 173]],  // #8e44ad 紫     (extreme)
];

function rgbToHex(rgb) {
  return '#' + rgb.map((c) => {
    const v = Math.max(0, Math.min(255, Math.round(c)));
    return v.toString(16).padStart(2, '0');
  }).join('');
}

// 色を変える勾配の刻み (%)。 slope をこの幅で量子化してから GRADE_COLOR_STOPS の
// 連続ランプをサンプルする。 0.5% ごとに 1 色 ── 同じ 0.5% 区間内は同色、 区間が
// 変わると色が 1 段変わる。 完全連続だと隣接 segment がほぼ同色に溶けて勾配差が
// 読み取りにくいため、 0.5% 刻みの段で勾配の変化をはっきり見せる。
export const GRADE_STEP_PCT = 0.5;

/**
 * 勾配 % を色に変換する (= classifyGrade の 6 段階離散 bin ではなく、
 * GRADE_COLOR_STOPS の連続 RGB ランプを 0.5% 刻みでサンプルした色)。
 * slope を GRADE_STEP_PCT (0.5%) に量子化してからランプを補間するので、
 * 同じ 0.5% 区間は同色、 区間境界で色が 1 段変わる。
 *
 * null / undefined / NaN は flat (= 緑) 扱い。 最小 stop 以下は最初の色、
 * 最大 stop 以上は最後の色でクランプ。
 *
 * @param {number|null|undefined} slope_pct
 * @returns {string} hex color
 */
export function gradeColorContinuous(slope_pct) {
  let s = slope_pct;
  if (s === null || s === undefined || Number.isNaN(s)) s = 0;
  // 0.5% 刻みに量子化 ── これで色が 0.5% ごとの段で変わる。
  s = Math.round(s / GRADE_STEP_PCT) * GRADE_STEP_PCT;
  const stops = GRADE_COLOR_STOPS;
  if (s <= stops[0][0]) return rgbToHex(stops[0][1]);
  const last = stops[stops.length - 1];
  if (s >= last[0]) return rgbToHex(last[1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return rgbToHex([
        c0[0] + (c1[0] - c0[0]) * t,
        c0[1] + (c1[1] - c0[1]) * t,
        c0[2] + (c1[2] - c0[2]) * t,
      ]);
    }
  }
  return rgbToHex(stops[0][1]);
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
