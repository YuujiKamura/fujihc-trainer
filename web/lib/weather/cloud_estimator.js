// b74: AMeDAS 観測点の温度・湿度・観測点標高 (alt) から雲量・雲底・雲頂を算出する純関数。
//
// 設計の核: LCL (持ち上げ凝結高度) は観測点からの相対高度なので、 観測点標高 alt を必ず
// 加算してから 4 観測点平均で「絶対海抜雲底」 を求める。 viewer の地形メッシュ Y 軸は
// 海抜 m なので、 同単位で直接比較可能。
//
// 算出式 (一次資料根拠は b74 brief §算出根拠 節):
//   Td_i = T_i - (100 - RH_i) / 5                     (Magnus 簡易近似、 露点)
//   cloudBaseAbove_i = 125 * (T_i - Td_i)             (LCL 経験式、 観測点相対)
//   cloudBaseAbsolute_i = alt_i + cloudBaseAbove_i    (絶対海抜雲底)
//   cloudBaseM = max(1500, mean(cloudBaseAbsolute_i)) (4 点平均 + 床 1500m)
//   cloudCover = clamp((mean(RH_i) - 40) / 60, 0, 1)
//   cloudTopM = cloudBaseM + 2000                      (積雲想定固定厚 2 km)
//
// 入力 shape は b72 既存 pickFujiStations の戻り (= alt, temp, humidity を含む station 配列)。
// 富士山頂は湿度センサーなしのため、 humidity == null の観測点は自動除外して 4 点平均。

const CLOUD_BASE_FLOOR_M = 1500;     // 富士山周辺の典型最低雲底 (河口湖湖面 833m より上)
const CLOUD_LAYER_THICKNESS_M = 2000; // 積雲典型厚 1-3km の中央値
const RH_THRESHOLD = 40;              // RH 40% 以下で cloudCover=0
const RH_RANGE = 60;                  // RH 40-100 を 0-1 に線形マップ

/**
 * AMeDAS station 配列から雲量・雲底・雲頂を算出する純関数。
 *
 * 湿度センサーあり (humidity != null) かつ温度・標高あり の観測点のみで平均を取る。
 * 該当観測点がゼロなら null を返す (= viewer は雲を出さない)。
 *
 * @param {Array<{alt:number, temp:number|null, humidity:number|null}>} stations - pickFujiStations 戻り相当
 * @returns {{cloudCover:number, cloudBaseM:number, cloudTopM:number} | null}
 */
export function estimateClouds(stations) {
  if (!Array.isArray(stations) || stations.length === 0) return null;

  // 湿度・温度・標高すべて数値の観測点に絞る (= 富士山頂は humidity=null で除外)
  const valid = stations.filter((s) =>
    s
    && typeof s.temp === 'number' && Number.isFinite(s.temp)
    && typeof s.humidity === 'number' && Number.isFinite(s.humidity)
    && typeof s.alt === 'number' && Number.isFinite(s.alt));
  if (valid.length === 0) return null;

  let baseSum = 0;
  let rhSum = 0;
  for (const s of valid) {
    // Magnus 簡易近似で露点
    const td = s.temp - (100 - s.humidity) / 5;
    // LCL 経験式: 露点降下 1°C で約 125 m 上昇
    const cloudBaseAbove = 125 * (s.temp - td);
    // 観測点標高に LCL を加算した絶対海抜雲底
    const cloudBaseAbsolute = s.alt + cloudBaseAbove;
    baseSum += cloudBaseAbsolute;
    rhSum += s.humidity;
  }
  const meanBase = baseSum / valid.length;
  const meanRh = rhSum / valid.length;

  const cloudBaseM = Math.max(CLOUD_BASE_FLOOR_M, meanBase);
  const cloudCover = Math.max(0, Math.min(1, (meanRh - RH_THRESHOLD) / RH_RANGE));
  const cloudTopM = cloudBaseM + CLOUD_LAYER_THICKNESS_M;

  return { cloudCover, cloudBaseM, cloudTopM };
}
