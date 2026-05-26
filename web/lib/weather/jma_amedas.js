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

// b117: AMeDAS fetch の localStorage cache。 user 2026-05-26 訂正:「気象庁の配布元を
// 毎回フェッチしてると思うが、 これも頻繁になり過ぎると迷惑掛かりそうなんで、 更新頻度を
// 決めて、 起動のたびに取って来るとかはしない方がいい」「10 分に一回とかに決めておいて、
// それ以上 (= 以内) はキャッシュを使うようにしろ」。 配布元 (= 気象庁オープンデータ) の
// 観測値自体が 10 分 granularity で更新されるため、 10 分以内の再アクセスは値も変わらない、
// cache TTL = 10 分が物理的にも妥当。
export const AMEDAS_CACHE_KEY = 'fujihill.amedas.cache.v1';
export const AMEDAS_CACHE_TTL_MS = 10 * 60 * 1000;

function readCache(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(AMEDAS_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.savedAtMs !== 'number') return null;
    if (typeof obj.timestamp !== 'string') return null;
    if (!Array.isArray(obj.stations)) return null;
    return obj;
  } catch { return null; }
}

function writeCache(storage, savedAtMs, timestamp, stations) {
  if (!storage) return;
  try {
    storage.setItem(AMEDAS_CACHE_KEY, JSON.stringify({ savedAtMs, timestamp, stations }));
  } catch { /* quota 超過等は無視 ── 配布元再 fetch にだけ影響、 観測値は再構築可能 */ }
}

/**
 * 1 起動 1 回 (= cache 経由なら 10 分に 1 回) 呼ぶ高レベル wrapper。
 * latest_time → map → 富士山周辺 5 観測点。
 *
 * cache 規律 (b117): 第 2 引数 opts.storage を渡したら localStorage cache を使う ──
 *   cache hit (= savedAtMs が ttlMs 以内) なら fetch 行わず cache 返す、 戻り値に fromCache:true。
 *   cache miss なら fetch して保存、 戻り値に fromCache 無し。
 *   fetch 失敗 + stale cache (= ttl 超過の保存値) があれば stale 返す (= 配布元 down 時の保険)、
 *     戻り値に fromCache:true + stale:true。
 *   opts.storage 未指定 (= 既存 caller / test 経路) は cache off、 旧挙動と同等で backward compatible。
 *
 * @param {Function} [fetchImpl] globalThis.fetch 既定。 test で mock 注入。
 * @param {object} [opts]
 * @param {object|null} [opts.storage] localStorage 互換 (getItem/setItem)。 null/省略で cache off。
 * @param {number} [opts.ttlMs] cache 有効期間 (= 10 分既定)。 0 で常に fetch。
 * @param {()=>number} [opts.now] 現在時刻取得 (= test 用、 Date.now 既定)。
 * @returns {Promise<{timestamp:string, stations:Array, fromCache?:boolean, stale?:boolean}>}
 */
export async function fetchFujiWeather(fetchImpl = globalThis.fetch, opts = {}) {
  const { storage = null, ttlMs = AMEDAS_CACHE_TTL_MS, now = Date.now } = opts;
  const nowMs = now();
  const cached = readCache(storage);
  if (cached && nowMs - cached.savedAtMs >= 0 && nowMs - cached.savedAtMs <= ttlMs) {
    return { timestamp: cached.timestamp, stations: cached.stations, fromCache: true };
  }
  try {
    const timestamp = await fetchLatestTime(fetchImpl);
    const map = await fetchAmedasMap(timestamp, fetchImpl);
    const stations = pickFujiStations(map);
    writeCache(storage, nowMs, timestamp, stations);
    return { timestamp, stations };
  } catch (e) {
    // 配布元 down / network 失敗 + stale cache (= ttl 超過してても保存値はある) を保険で返す。
    // 「観測値が古いまま表示」 と「気象 panel が error 表示で気象情報が消える」 の比較で
    // stale を返す方が画面の連続性が高い、 user 体験を維持。
    if (cached) {
      return { timestamp: cached.timestamp, stations: cached.stations, fromCache: true, stale: true };
    }
    throw e;
  }
}
