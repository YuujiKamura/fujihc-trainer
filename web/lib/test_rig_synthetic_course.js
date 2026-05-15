// 担当 D: 検証用合成 course の生成.
//
// terrain.js の createTerrain({course}) が受ける形式 (= {distance_m, lat, lon, elevation_m, slope_pct} 列)
// を、 単純な kind 指定で量産する. 鉄道模型のテストレーンと同じ位置付け、 物理 model の挙動を
// 単独で目視確認するために使う.

const REF_LAT = 35.45;
const REF_LON = 138.75;
const REF_ELE_M = 1000;
const M_PER_DEG_LAT = 111320;

/**
 * 線形 course (= 平地 / 一定勾配 登り / 下り) を生成する.
 * 起点を REF, 終点を真北 length_m m 先に置く. 30m 間隔.
 *
 * @param {{length_m:number, slope_pct:number, step_m?:number}} opts
 * @returns {Array<{distance_m:number, lat:number, lon:number, elevation_m:number, slope_pct:number}>}
 */
function generateLinear({ length_m, slope_pct, step_m = 30 }) {
  if (!(length_m > 0)) throw new Error('length_m must be positive');
  const out = [];
  for (let d = 0; d <= length_m; d += step_m) {
    out.push({
      distance_m: d,
      lat: REF_LAT + d / M_PER_DEG_LAT,
      lon: REF_LON,
      elevation_m: REF_ELE_M + d * slope_pct / 100,
      slope_pct,
    });
  }
  // 末尾を厳密に length_m に合わせる (= step で割り切れない場合の保険).
  const last = out[out.length - 1];
  if (last.distance_m !== length_m) {
    out.push({
      distance_m: length_m,
      lat: REF_LAT + length_m / M_PER_DEG_LAT,
      lon: REF_LON,
      elevation_m: REF_ELE_M + length_m * slope_pct / 100,
      slope_pct,
    });
  }
  return out;
}

/**
 * 蛇行 course (= lat を sin 波で揺らす). 進行は真東.
 *
 * @param {{length_m:number, amplitude_m:number, wavelength_m:number, step_m?:number}} opts
 */
function generateSine({ length_m, amplitude_m, wavelength_m, step_m = 10 }) {
  if (!(length_m > 0)) throw new Error('length_m must be positive');
  const lonScale = Math.cos(REF_LAT * Math.PI / 180);
  const out = [];
  for (let d = 0; d <= length_m; d += step_m) {
    const offset_m = amplitude_m * Math.sin(2 * Math.PI * d / wavelength_m);
    out.push({
      distance_m: d,
      lat: REF_LAT + offset_m / M_PER_DEG_LAT,
      lon: REF_LON + d / (M_PER_DEG_LAT * lonScale),
      elevation_m: REF_ELE_M,
      slope_pct: 0,
    });
  }
  const last = out[out.length - 1];
  if (last.distance_m !== length_m) {
    const offset_m = amplitude_m * Math.sin(2 * Math.PI * length_m / wavelength_m);
    out.push({
      distance_m: length_m,
      lat: REF_LAT + offset_m / M_PER_DEG_LAT,
      lon: REF_LON + length_m / (M_PER_DEG_LAT * lonScale),
      elevation_m: REF_ELE_M,
      slope_pct: 0,
    });
  }
  return out;
}

/**
 * 既存 course から先頭 N 点を切り出す (= 富士ヒル前半).
 * 浅 copy で返す、 元配列を mutation しない.
 *
 * @param {Array<object>} course
 * @param {number} [n=500]
 */
export function slicePrefix(course, n = 500) {
  if (!Array.isArray(course)) throw new TypeError('slicePrefix: course must be an array');
  return course.slice(0, n).map((p) => ({ ...p }));
}

/**
 * kind 名から合成 course を sync 生成する. 'fuji-prefix' のみ async 取得が要るので
 * 本関数からは外し、 loadFujiPrefix() 経由にした.
 *
 * @param {'flat'|'up5'|'down5'|'up10'|'sine'} kind
 */
export function generateCourse(kind) {
  switch (kind) {
    case 'flat':  return generateLinear({ length_m: 1000, slope_pct: 0 });
    case 'up5':   return generateLinear({ length_m: 1000, slope_pct: 5 });
    case 'down5': return generateLinear({ length_m: 1000, slope_pct: -5 });
    case 'up10':  return generateLinear({ length_m: 500,  slope_pct: 10 });
    case 'sine':  return generateSine({ length_m: 2000, amplitude_m: 30, wavelength_m: 500 });
    default: throw new Error(`generateCourse: unknown kind "${kind}"`);
  }
}

/**
 * 実 course.json の先頭 N 点を取得する. browser は fetch、 test は fetcher 注入.
 *
 * @param {{url?:string, count?:number, fetcher?:(url:string)=>Promise<Array<object>>}} [opts]
 */
export async function loadFujiPrefix(opts = {}) {
  const url = opts.url || './course.json';
  const count = opts.count || 500;
  const fetcher = opts.fetcher || (async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`loadFujiPrefix: fetch failed (${r.status})`);
    return r.json();
  });
  const data = await fetcher(url);
  return slicePrefix(data, count);
}

export const COURSE_KINDS = Object.freeze([
  'flat', 'up5', 'down5', 'up10', 'sine', 'fuji-prefix',
]);
