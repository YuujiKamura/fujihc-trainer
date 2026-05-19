// 太陽と影の幾何モデル ── 方位 (= 時間帯) から太陽仰角を、 自機倍率と仰角から影
// オルソカメラの設定を計算する純ロジック。 THREE / DOM 非依存。 scene.js がこの値で
// 太陽光源と影 (shadow map) を駆動する。
// (rider_placement.js / camera3d.js と同じ規律 ── 描画から純計算を分け node test 可能にする)

// 南中 (方位 180° = 真南) での太陽仰角 (度)。 富士の緯度・春の南中高度に寄せた値。
export const MAX_SUN_ELEVATION_DEG = 70;

// 影オルソカメラ / 光源距離を測った基準の自機倍率 (= riderScale スライダーの既定値)。
// shadowCameraConfig は実 riderScale をこの値で割った比 k で影設定を相似に拡大する。
export const RIDER_SCALE_BASE = 3.6;
// 影の長さ計算に使う自機の高さ (m、 riderScale 3.6 の bike 全高ぶん)。
const RIDER_HEIGHT_M = 2.6;
// 影用の太陽光と自機の距離 (m、 riderScale 3.6 基準)。 影は shadow map で落とす ──
// 太陽本体は hillshade 用に span 距離へ置くが、 影オルソカメラは自機を狭い範囲で
// 覆うため別にこの距離へ置く。 巨大ライダーでは shadowCameraConfig が k 倍する。
export const SHADOW_LIGHT_DIST = 60;
// 影オルソカメラの半幅 (m、 riderScale 3.6 基準) ── 基本 (自機本体ぶん) と上限。
// 太陽が低い (朝夕) ほど影が長いので、 shadowCameraConfig が仰角から半幅を
// SHADOW_CAM_MAX まで可変に広げる。
export const SHADOW_CAM_BASE = 3;
const SHADOW_CAM_MAX = 18;

/**
 * 方位 (deg) から太陽の仰角 (deg) を返す ── 方位を時間帯と見なした日周モデル.
 *
 * 太陽は東 (方位 90°) で日の出 (仰角 0°)、 南 (180°) で南中 (MAX_SUN_ELEVATION_DEG)、
 * 西 (270°) で日の入り (0°) を通る。 90〜270° の外 (= 北回り) は地平線下 = 夜で
 * 負の仰角を返す ── これで「北からは陽が差さない」を保証する。 方位は北 0°、
 * 時計回り (terrain3d.js / MapLibre illumination-direction と同じ定義)。
 *
 * @param {number} azimuthDeg - 方位 (北 0°、 時計回り)
 * @returns {number} 仰角 (度)。 昼は 0〜MAX、 夜 (北回り) は負。
 */
export function sunElevationFromAzimuth(azimuthDeg) {
  const a = ((azimuthDeg % 360) + 360) % 360;
  if (a < 90 || a > 270) return -8;  // 北側 = 太陽は地平線下 (夜)
  // 東 90°→0°、 南 180°→最大、 西 270°→0° の山なり (sin カーブ)。
  return MAX_SUN_ELEVATION_DEG * Math.sin(((a - 90) / 180) * Math.PI);
}

/**
 * 影オルソカメラの設定 (半幅 reach と光源距離 lightDist、 m) を自機倍率と太陽仰角から出す純関数.
 *
 * RIDER_HEIGHT_M / SHADOW_CAM_BASE / SHADOW_CAM_MAX / SHADOW_LIGHT_DIST はいずれも
 * riderScale 3.6 (= RIDER_SCALE_BASE) の自機を基準に測った値。 巨大ライダー (倍率最大 50)
 * では影も錐台も光源距離も k = riderScale / 3.6 倍して相似に拡大する ── こうして影の
 * 見えが全倍率で相似になり、 固定サイズの錐台から影がはみ出て四角く切れることがない。
 *
 * 素の半幅 (k=1) は太陽が低い (朝夕) ほど影が長いので、 影長 (≒ 自機高さ / tan(仰角))
 * に合わせて広げ、 上限を SHADOW_CAM_MAX で抑える。 elevationDeg は太陽仰角 (deg) ──
 * 地平線下や非有限は最低 2° にクランプする (= tan が 0 に近づき影長が発散しないため)。
 * riderScale が非有限 / 0 以下なら k=1 (= 既定倍率扱い、 壊れた値で影を消さない)。
 *
 * @param {number} riderScale - 自機の表示倍率 (= rider mesh group の scale)
 * @param {number} elevationDeg - 太陽仰角 (deg)
 * @returns {{reach:number, lightDist:number}} 影オルソカメラの半幅と光源距離 (m)
 */
export function shadowCameraConfig(riderScale, elevationDeg) {
  const k = (Number.isFinite(riderScale) && riderScale > 0)
    ? riderScale / RIDER_SCALE_BASE : 1;
  const elev = Math.max(Number.isFinite(elevationDeg) ? elevationDeg : 2, 2);
  const reach = k * Math.min(
    SHADOW_CAM_BASE + RIDER_HEIGHT_M / Math.tan((elev * Math.PI) / 180),
    SHADOW_CAM_MAX);
  return { reach, lightDist: SHADOW_LIGHT_DIST * k };
}
