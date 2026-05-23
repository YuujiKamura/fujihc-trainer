// b75: 太陽位置を現在時刻から計算する純関数 (NOAA Solar Position アルゴリズム).
//
// 入力: 緯度経度 (WGS84 deg) + 観測時刻 (Date オブジェクト、 UTC 内部換算)
// 出力: { azimuthDeg, elevationDeg } ── 北基準時計回り (N=0, E=90, S=180, W=270)
//
// scene.js / sun_model.js / atmosphere3d.js と同 azimuth 定義 (= 北基準時計回り)、
// viewer 座標系 (= 東+X / 上+Y / 北-Z) との変換は computeSunDirVec が担う。
//
// 外部 library 依存なし、 配布元への新規 fetch なし (= b75 配布元負荷ゼロ)。
//
// 一次資料: NOAA Earth System Research Laboratory
//   <https://gml.noaa.gov/grad/solcalc/calcdetails.html>
//
// 誤差 ±0.5° 程度、 fujihc viewer の視覚用途には十分。

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Date → Julian Day (UTC 基準).
 *
 * Unix epoch 1970-01-01T00:00:00 UTC は Julian Day 2440587.5。
 * 内部で TZ を一切扱わない (= UTC ms から直接換算)。
 *
 * @param {Date} date
 * @returns {number} JD
 */
function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * 太陽位置 (方位角・高度) を計算する純関数.
 *
 * NOAA Solar Calculator アルゴリズム (Meeus "Astronomical Algorithms" 章 25 + 28 ベース)
 * の主要 13 式を 1 関数に閉じた実装。 nutation 補正なし (= 簡易版、 viewer 用途で十分)。
 *
 * @param {{lat:number, lon:number, dateJst:Date}} args
 * @returns {{azimuthDeg:number, elevationDeg:number}}
 */
export function computeSolarPosition({ lat, lon, dateJst }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new TypeError('computeSolarPosition: lat / lon は有限数が必須');
  }
  if (!(dateJst instanceof Date) || Number.isNaN(dateJst.getTime())) {
    throw new TypeError('computeSolarPosition: dateJst は有効な Date オブジェクトが必須');
  }

  const JD = julianDay(dateJst);
  const T = (JD - 2451545.0) / 36525;  // Julian Century from J2000.0

  // 太陽平均黄経 (deg、 0..360)
  const L0 = ((280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360 + 360) % 360;
  // 太陽平均近点角 (deg)
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const Mrad = M * DEG_TO_RAD;
  // 太陽中心方程式
  const C = Math.sin(Mrad) * (1.914602 - 0.004817 * T - 0.000014 * T * T)
          + Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T)
          + Math.sin(3 * Mrad) * 0.000289;
  // 真黄経 (deg)
  const trueLong = L0 + C;
  const trueLongRad = trueLong * DEG_TO_RAD;
  // 黄道傾斜 (deg、 nutation 補正なし)
  const obliquity = 23.43929111 - 0.013004167 * T;
  const obliquityRad = obliquity * DEG_TO_RAD;
  // 太陽赤緯 (deg)
  const declRad = Math.asin(Math.sin(obliquityRad) * Math.sin(trueLongRad));
  const declDeg = declRad * RAD_TO_DEG;
  // 均時差 (min) ── 簡易近似 (Meeus 章 28、 短縮形)
  const y = Math.tan(obliquityRad / 2) ** 2;
  const eotRad = y * Math.sin(2 * L0 * DEG_TO_RAD)
               - 2 * 0.016708634 * Math.sin(Mrad)
               + 4 * 0.016708634 * y * Math.sin(Mrad) * Math.cos(2 * L0 * DEG_TO_RAD)
               - 0.5 * y * y * Math.sin(4 * L0 * DEG_TO_RAD)
               - 1.25 * 0.016708634 * 0.016708634 * Math.sin(2 * Mrad);
  const eotMin = eotRad * RAD_TO_DEG * 4;

  // UTC hour (= 内部 UTC 基準、 JST 等の TZ は dateJst の getTime() に既に反映済)
  const utcHour = dateJst.getUTCHours()
                + dateJst.getUTCMinutes() / 60
                + dateJst.getUTCSeconds() / 3600;
  // 真太陽時 (hour)
  const trueSolarTime = utcHour + lon / 15 + eotMin / 60;
  // 時角 (deg)
  const hourAngleDeg = (trueSolarTime - 12) * 15;
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;

  const latRad = lat * DEG_TO_RAD;
  // 太陽高度 (deg)
  const elevationRad = Math.asin(
    Math.sin(latRad) * Math.sin(declRad)
    + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad)
  );
  const elevationDeg = elevationRad * RAD_TO_DEG;
  // 太陽方位 (NOAA atan2 = 南基準時計回り) → 北基準時計回りに変換
  const azimuthSouthRad = Math.atan2(
    Math.sin(hourAngleRad),
    Math.cos(hourAngleRad) * Math.sin(latRad) - Math.tan(declRad) * Math.cos(latRad)
  );
  const azimuthSouthDeg = azimuthSouthRad * RAD_TO_DEG;
  // + 180: 南基準 → 北基準、 + 360 + % 360: 負値正規化 (-180..180 → 0..360)
  const azimuthDeg = (azimuthSouthDeg + 180 + 360) % 360;

  return { azimuthDeg, elevationDeg };
}

/**
 * 太陽位置 (方位 + 仰角) → viewer 座標系の正規化方向ベクトル.
 *
 * viewer 座標系: 東 = +X、 上 = +Y、 北 = -Z (= b71 既存 SoT)。
 * 方位は北基準時計回り (= sun_model.js 既存定義と同じ)。
 *
 * 同式が 3 経路に散在: scene.js:70 sunPosition / atmosphere3d.js:169 sunDirection /
 * 本関数。 戻り値型のみ異なる (= plain object / array / 距離スケール)、 値は同じ。
 *
 * @param {{azimuthDeg:number, elevationDeg:number}} pos
 * @returns {{x:number, y:number, z:number}} 正規化方向ベクトル (plain object)
 */
export function computeSunDirVec({ azimuthDeg, elevationDeg }) {
  const azRad = azimuthDeg * DEG_TO_RAD;
  const elRad = elevationDeg * DEG_TO_RAD;
  const cosEl = Math.cos(elRad);
  return {
    x: cosEl * Math.sin(azRad),         // 東 +X
    y: Math.sin(elRad),                  // 上 +Y
    z: -cosEl * Math.cos(azRad),         // 北 -Z (= 方位 0 で真北、 azRad=0 → z=-1)
  };
}

// ISO 8601 末尾の offset (= +09:00 / -05:00 / Z) を必須要求する regex。
// offset 欠落 (= naive datetime) はローカル TZ 暗黙解釈になり viewer の JST contract を
// 破るため reject。
const ISO_8601_WITH_OFFSET = /(?:[+-]\d{2}:\d{2}|Z)$/;

/**
 * URL gate `?datetime=` の入力検証 helper.
 *
 * 既存 cameraMode() (index.js:243-248) と同型の whitelist hardening。 不正値は
 * console.warn + null 返却で viewer に流さない (= NaN 伝搬による directional light
 * 暴走を物理 block、 ローカル TZ 解釈での JST contract 違反を物理 block)。
 *
 * @param {URLSearchParams|null} urlParams
 * @returns {Date|null} 有効な Date or null (= 現在時刻 fallback)
 */
export function parseDatetimeFromUrl(urlParams) {
  if (!urlParams || typeof urlParams.get !== 'function') return null;
  const raw = urlParams.get('datetime');
  if (raw == null || raw === '') return null;
  if (!ISO_8601_WITH_OFFSET.test(raw)) {
    console.warn('[sun_position] ?datetime= に offset (+09:00 / Z) が必須、 fallback to now:', raw);
    return null;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    console.warn('[sun_position] ?datetime= が Invalid Date、 fallback to now:', raw);
    return null;
  }
  return d;
}
