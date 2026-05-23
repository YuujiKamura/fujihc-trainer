// b72 weather step 1: 気象庁 AMeDAS 現在気象を fetch する純 client。
//
// 起動時 1 回 latest_time.txt → map/<timestamp>.json で全 1286 観測点の最新値を取得し、
// 富士山周辺 5 観測点 (= 河口湖 / 山中 / 古関 / 御殿場 / 富士山頂) の気温・湿度・風・気圧・
// 降水を抽出して返す。 配布元 (= 気象庁オープンデータ、 JMA bosai) への通信は 1 起動 2 req
// (= latest_time + map)、 出典: 「気象庁 アメダス」 必須。
//
// 富士山頂は elems = 10001011 で気温と風向風速だけ持つ (= 湿度・気圧センサーなし)。
// API spec: https://www.jma.go.jp/bosai/amedas/

const JMA_AMEDAS_BASE = 'https://www.jma.go.jp/bosai/amedas/data';

// 富士山周辺の固定観測点 (= hardcoded、 ふじよし湖 + 富士山頂 ± 4 周辺)。
// lat/lon は amedastable.json から度分秒を 10 進度に換算した参考値。
export const FUJI_AMEDAS_STATIONS = [
  { code: '49251', name: '河口湖',   lat: 35.5000, lon: 138.7600, alt: 860 },
  { code: '49256', name: '山中',     lat: 35.4367, lon: 138.8367, alt: 992 },
  { code: '49196', name: '古関',     lat: 35.5283, lon: 138.6150, alt: 552 },
  { code: '50136', name: '御殿場',   lat: 35.3050, lon: 138.9267, alt: 472 },
  { code: '50066', name: '富士山頂', lat: 35.3600, lon: 138.7267, alt: 3775 },
];

/**
 * 最新の AMeDAS タイムスタンプを取得する。
 * @returns {Promise<string>} 'YYYYMMDDHHMMSS' 形式 (= map endpoint の filename)
 */
export async function fetchLatestTime(fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(`${JMA_AMEDAS_BASE}/latest_time.txt`);
  if (!resp.ok) throw new Error(`AMeDAS latest_time HTTP ${resp.status}`);
  const text = await resp.text();
  // 例: "YYYY-MM-DDTHH:MM:SS+09:00" → "YYYYMMDDHHMMSS" (= 14 桁 timestamp)
  const iso = text.trim();
  return iso.replace(/[-:T]/g, '').slice(0, 14);
}

/**
 * 全観測点の最新値 map を fetch する。
 * @returns {Promise<Object>} { stationCode: { temp:[val,q], humidity:[val,q], ... }, ... }
 */
export async function fetchAmedasMap(timestamp, fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(`${JMA_AMEDAS_BASE}/map/${timestamp}.json`);
  if (!resp.ok) throw new Error(`AMeDAS map HTTP ${resp.status}`);
  return await resp.json();
}

/**
 * 富士山周辺 5 観測点の値を抽出する純関数。
 * @param {Object} map - fetchAmedasMap の戻り
 * @returns {Array<{code,name,lat,lon,alt,temp?,humidity?,wind?,windDirection?,pressure?,precipitation10m?}>}
 */
export function pickFujiStations(map) {
  return FUJI_AMEDAS_STATIONS.map((s) => {
    const v = map[s.code] || {};
    // AMeDAS は値ごとに [数値, 品質コード] の 2 要素配列。 品質 0 = 正常、 それ以外は欠測等。
    const pick = (key) => {
      const arr = v[key];
      if (!Array.isArray(arr) || arr[1] !== 0) return null;
      return arr[0];
    };
    return {
      ...s,
      temp: pick('temp'),
      humidity: pick('humidity'),
      wind: pick('wind'),
      windDirection: pick('windDirection'),
      pressure: pick('pressure'),
      precipitation10m: pick('precipitation10m'),
    };
  });
}

/**
 * 1 起動 1 回呼ぶ高レベル wrapper。 latest_time → map → 富士山周辺 5 観測点。
 * @returns {Promise<{timestamp:string, stations:Array}>}
 */
export async function fetchFujiWeather(fetchImpl = globalThis.fetch) {
  const timestamp = await fetchLatestTime(fetchImpl);
  const map = await fetchAmedasMap(timestamp, fetchImpl);
  return { timestamp, stations: pickFujiStations(map) };
}
