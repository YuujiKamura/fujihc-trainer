// brief 19: MapLibre camera パラメータ計算 (pure functions).
// viewer-maplibre.js の tick 内 `map.jumpTo({...})` の入力計算をここに集約する。
// MapLibre オブジェクト依存ゼロ、 viewer 側で `map.jumpTo(this returns)` する。

import { computeTravelHeading, clampIndex } from './heading.js';

const DEFAULT_USER_ZOOM = 23.95;
const DEFAULT_USER_PITCH = 85;
const DEFAULT_LOOK_AHEAD = 5;

const DEFAULT_MIN_ZOOM = 13;
const DEFAULT_MAX_ZOOM = 24;
const DEFAULT_MIN_PITCH = 0;
// 2026-05-16: user 「mouse 視点の上下可動域はまだ広くていい」 → 85 → 95 に拡張.
// MapLibre 内部上限は 85、 95 で打つと自動 clamp されるが UI 体感上は「これ以上ない」 と分かる.
const DEFAULT_MAX_PITCH = 95;

/**
 * ride state + user 設定 → MapLibre camera params.
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {{curIdx: number}} rideState - createRideState の snapshot もしくは互換 object
 * @param {{userZoom?: number, userPitch?: number, lookAhead?: number}} [options]
 * @returns {{center: [number, number], zoom: number, pitch: number, bearing: number}}
 */
export function computeCameraParams(course, rideState, options = {}) {
  const userZoom = options.userZoom !== undefined ? options.userZoom : DEFAULT_USER_ZOOM;
  const userPitch = options.userPitch !== undefined ? options.userPitch : DEFAULT_USER_PITCH;
  const lookAhead = options.lookAhead !== undefined ? options.lookAhead : DEFAULT_LOOK_AHEAD;

  // course が空なら fallback (= viewer 側で course load 前に呼ばれた事故への耐性).
  if (!course || course.length === 0) {
    return {
      center: [0, 0],
      zoom: userZoom,
      pitch: userPitch,
      bearing: 0,
    };
  }

  const rawIdx = (rideState && typeof rideState.curIdx === 'number') ? rideState.curIdx : 0;
  const idx = clampIndex(rawIdx, course.length);
  const p = course[idx];
  const bearing = computeTravelHeading(course, idx, lookAhead);

  return {
    center: [p.lon, p.lat],
    zoom: userZoom,
    pitch: userPitch,
    bearing,
  };
}

/**
 * userZoom を増減 (= wheel zoom 経由), 範囲 [minZoom, maxZoom] に clamp.
 *
 * @param {number} currentZoom
 * @param {number} delta
 * @param {number} [minZoom]
 * @param {number} [maxZoom]
 * @returns {number}
 */
export function adjustZoom(currentZoom, delta, minZoom = DEFAULT_MIN_ZOOM, maxZoom = DEFAULT_MAX_ZOOM) {
  const next = currentZoom + delta;
  if (next < minZoom) return minZoom;
  if (next > maxZoom) return maxZoom;
  return next;
}

/**
 * userPitch を増減 (= drag 経由), 範囲 [minPitch, maxPitch] に clamp.
 *
 * @param {number} currentPitch
 * @param {number} delta
 * @param {number} [minPitch]
 * @param {number} [maxPitch]
 * @returns {number}
 */
export function adjustPitch(currentPitch, delta, minPitch = DEFAULT_MIN_PITCH, maxPitch = DEFAULT_MAX_PITCH) {
  const next = currentPitch + delta;
  if (next < minPitch) return minPitch;
  if (next > maxPitch) return maxPitch;
  return next;
}
