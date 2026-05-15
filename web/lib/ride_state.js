// brief 19: ride 進行 state を pure state machine に集約 (= NG-R1-7 解消).
// viewer-maplibre.js 内に散在していた curIdx / curDist / paused / active を
// 1 module に閉じ込め、 tick 関数の更新ロジックを advance() に集約する.
//
// brief 33: trkpts (= ride 中の {t,lat,lon,ele,power,cad,hr} 時系列) 蓄積を追加.
// advance(dt, speedMps, extras?) で extras={power,cad,hr} を渡せば trkpt 1 件追加.
// pure module、 DOM / browser global 依存ゼロ.

import { computeTravelHeading } from './heading.js';

/**
 * ride 進行 state machine を生成する.
 *
 * @param {Array<{lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number}>} course
 * @returns {{
 *   advance: (dt:number, speedMps:number, extras?:object) => void,
 *   getCurrentSlope: () => number,
 *   getHeading: (lookAhead?:number) => number,
 *   start: () => void,
 *   end: () => void,
 *   togglePause: () => void,
 *   reset: () => void,
 *   snapshot: () => {idx:number, distance:number, paused:boolean, active:boolean, slope:number, trkptCount:number},
 *   isAtEnd: () => boolean,
 *   appendTrkpt: (extras:object) => void,
 *   getTrkpts: () => Array<object>,
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
  let trkpts = [];

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

  function appendTrkptInternal(extras) {
    // 現在位置 (= course[curIdx] の lat/lon/ele) を trkpt として記録する.
    // extras は {power, cad, hr} の任意 subset、 ISO8601 の t は呼び出し側か Date.now() で埋める.
    if (course.length === 0) return;
    const p = course[curIdx];
    if (!p) return;
    const lat = Number.isFinite(p.lat) ? p.lat : null;
    const lon = Number.isFinite(p.lon) ? p.lon : null;
    if (lat === null || lon === null) return;
    const ele = Number.isFinite(p.elevation_m) ? p.elevation_m : null;
    const ex = extras || {};
    trkpts.push({
      t: typeof ex.t === 'string' && ex.t ? ex.t : new Date().toISOString(),
      lat, lon, ele,
      power: (ex.power === null || ex.power === undefined || !Number.isFinite(Number(ex.power))) ? null : Number(ex.power),
      cad: (ex.cad === null || ex.cad === undefined || !Number.isFinite(Number(ex.cad))) ? null : Number(ex.cad),
      hr: (ex.hr === null || ex.hr === undefined || !Number.isFinite(Number(ex.hr))) ? null : Number(ex.hr),
    });
  }

  return {
    advance(dt, speedMps, extras) {
      if (paused) return;
      if (course.length === 0) return;
      if (!(dt > 0) || !(speedMps >= 0)) return;
      if (curDist >= totalDist) return;
      curDist = clampDist(curDist + speedMps * dt);
      advanceIdx();
      // brief 33: extras が渡されたとき trkpt を 1 件 push (= ride 中の時系列蓄積).
      // 既存 caller (= advance(dt, speedMps) の 2 引数) は extras=undefined で副作用ゼロ、
      // 12 件の ride_state.test.js を壊さない後方互換.
      if (extras !== undefined) {
        appendTrkptInternal(extras);
      }
    },

    appendTrkpt(extras) {
      // 明示 push API (= viewer 側の tick から advance とは別 cadence で呼べる).
      appendTrkptInternal(extras);
    },

    getTrkpts() {
      // immutable shallow copy. 各要素も新規 object で返す (= caller が mutate しても内部に影響しない).
      return trkpts.map((p) => ({ ...p }));
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
      trkpts = [];  // brief 33: ride 開始ごとに trkpt 蓄積を初期化
    },

    /**
     * brief 34 ε-8: 「観るモード」用の区間始点 inject 経路.
     * 指定 idx の course point から ride を開始する (= 通常 start は idx=0 リセット).
     * 観るモード以外で呼ばれる場合は無いが、 汎用 API として有効. trkpts は通常 start 同様クリア.
     *
     * idx の正規化: 0..course.length-1 にクランプ、 course が空なら no-op.
     * curDist は course[idx].distance_m を採用 (= advance ロジックが distance ベースのため整合).
     *
     * @param {number} idx
     */
    startFrom(idx) {
      if (course.length === 0) return;
      let safeIdx = Math.floor(Number(idx));
      if (!Number.isFinite(safeIdx)) safeIdx = 0;
      if (safeIdx < 0) safeIdx = 0;
      if (safeIdx > lastIdx) safeIdx = lastIdx;
      curIdx = safeIdx;
      curDist = course[safeIdx].distance_m;
      paused = false;
      active = true;
      trkpts = [];
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
      trkpts = [];  // brief 33: reset でも trkpt クリア
    },

    snapshot() {
      // immutable copy (= 呼び出し側が mutate しても内部 state に影響しない)
      return {
        idx: curIdx,
        distance: curDist,
        paused,
        active,
        slope: this.getCurrentSlope(),
        trkptCount: trkpts.length,  // brief 33
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
