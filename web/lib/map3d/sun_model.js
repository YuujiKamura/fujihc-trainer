// 太陽の日周モデル ── 方位 (= 時間帯) から太陽の仰角を計算する純ロジック。
// THREE / DOM 非依存。 scene.js がこの仰角で太陽光源と影 (shadow map) を駆動する。
// (rider_placement.js と同じ規律 ── 描画から純計算を分け、 node test 可能にする)

// 南中 (方位 180° = 真南) での太陽仰角 (度)。 富士の緯度・春の南中高度に寄せた値。
export const MAX_SUN_ELEVATION_DEG = 70;

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
