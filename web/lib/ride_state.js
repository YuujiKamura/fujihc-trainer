// brief 19: ride 進行 state を pure state machine に集約 (= NG-R1-7 解消).
// viewer-maplibre.js 内に散在していた curIdx / curDist / paused / active を
// 1 module に閉じ込め、 tick 関数の更新ロジックを advance() に集約する.
//
// pure module、 DOM / browser global 依存ゼロ.

import { computeTravelHeading } from './heading.js';

/**
 * ride 進行 state machine を生成する.
 *
 * @param {Array<{lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number}>} course
 * @returns {{
 *   advance: (dt:number, speedMps:number) => void,
 *   getCurrentSlope: () => number,
 *   getHeading: (lookAhead?:number) => number,
 *   start: () => void,
 *   end: () => void,
 *   togglePause: () => void,
 *   reset: () => void,
 *   snapshot: () => {idx:number, distance:number, paused:boolean, active:boolean, slope:number},
 *   isAtEnd: () => boolean,
 * }}
 */
export function createRideState(course) {
  if (!Array.isArray(course)) {
    throw new TypeError('createRideState: course must be an array');
  }

  let curIdx = 0;
  let curDist = 0;
  let paused = true;
  let active = false;

  const totalDist = course.length > 0
    ? course[course.length - 1].distance_m
    : 0;
  const lastIdx = Math.max(0, course.length - 1);

  function clampDist(d) {
    if (d < 0) return 0;
    if (d > totalDist) return totalDist;
    return d;
  }

  function advanceIdx() {
    // curDist に追従して curIdx を前進させる (= viewer の tick と同 logic).
    while (curIdx < lastIdx && course[curIdx + 1].distance_m < curDist) {
      curIdx++;
    }
  }

  return {
    advance(dt, speedMps) {
      if (paused) return;
      if (course.length === 0) return;
      if (!(dt > 0) || !(speedMps >= 0)) return;
      if (curDist >= totalDist) return;
      curDist = clampDist(curDist + speedMps * dt);
      advanceIdx();
    },

    getCurrentSlope() {
      if (course.length === 0) return 0;
      const p = course[curIdx];
      return (p && Number.isFinite(p.slope_pct)) ? p.slope_pct : 0;
    },

    getHeading(lookAhead = 5) {
      return computeTravelHeading(course, curIdx, lookAhead);
    },

    start() {
      curIdx = 0;
      curDist = 0;
      paused = false;
      active = true;
    },

    end() {
      paused = true;
      active = false;
    },

    togglePause() {
      paused = !paused;
    },

    reset() {
      curIdx = 0;
      curDist = 0;
    },

    snapshot() {
      // immutable copy (= 呼び出し側が mutate しても内部 state に影響しない)
      return {
        idx: curIdx,
        distance: curDist,
        paused,
        active,
        slope: this.getCurrentSlope(),
      };
    },

    isAtEnd() {
      // distance ベースで判定 (= viewer の `curDist < totalDist` 終端条件と整合).
      // curIdx は `course[curIdx+1].distance_m < curDist` を満たすときだけ前進するため、
      // ちょうど末尾 distance に到達したときは curIdx = lastIdx - 1 で止まる.
      // 「進めるか」ではなく「進む先が残ってないか」を distance で見るのが意味的に正しい.
      if (course.length === 0) return true;
      return curDist >= totalDist;
    },
  };
}
