// brief 35 / rider-position-model: ride_state は Terrain + Rider 2 層モデルの
// **後方互換 shim**.
//
// 経緯:
// - brief 19 で viewer-maplibre.js から curIdx/curDist/paused/active を吸い出して
//   pure state machine 化 (= createRideState({course})) した. brief 33 で trkpts も移送.
// - brief 35 で「Terrain (= 客観地形/経路) ⊃ Rider (= 主体)」 という上位モデル分離。
// - rider-position-model で rider の位置を (segIdx, segFrac) 保持・距離を haversine
//   累積長に作り直した. 旧 shim は curIdx を `course[i].distance_m` 比較で持っていたが、
//   distance_m は壊れた距離目盛りなので新モデルでは使わない ── shim の `idx` /
//   slope / heading は rider.position (= rider の実 segmentIdx から terrain query) に
//   委譲する形へ作り直した.
//
// 旧 caller (= viewer-maplibre.js, ride_state*.test.js) を破壊しないため、 旧
// createRideState の API surface (advance / snapshot / getTrkpts 等) は維持する.
//
// 新規 caller は本 module ではなく Terrain + Rider を直接使え:
//   import { createTerrain } from './terrain.js';
//   import { createRider } from './rider.js';

import { createTerrain } from './terrain.js';
import { createRider } from './rider.js';
import { computeTravelHeading } from './heading.js';

/**
 * 後方互換 shim. 内部で Terrain + Rider を生成、 旧 API を表面に出す.
 *
 * @param {Array<{lat:number, lon:number, distance_m:number, elevation_m:number, slope_pct:number}>} course
 */
export function createRideState(course) {
  if (!Array.isArray(course)) {
    throw new TypeError('createRideState: course must be an array');
  }

  const terrain = createTerrain({ course });
  const rider = createRider({ terrain });
  // 旧 trkpts buffer (= shim 専用). viewer の tick は rideState.appendTrkpt 経由で
  // こちらに貯める. Rider 内部の trkpts とは別 buffer (= 旧挙動の維持).
  let legacyTrkpts = [];

  function _legacyAppendTrkpt(extras) {
    // brief 32: view モードでは record しない (= UI hide だけでなく buffer-level 物理 gate).
    // mode-view CSS は UI 露出を hide するだけ、 内部 buffer (= legacyTrkpts) に lat/lon/power/hr が
    // 貯まる経路を物理 disable する。 jsdom / node test (= document 不在) では skip しない (= 既存 test 互換).
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('mode-view')) return;
    if (course.length === 0) return;
    // rider.position (= terrain query 経由の interpolated lat/lon/elevation) を
    // SoT に使う. rider が advance か直 tick かに関わらず位置が正しく動く.
    const pos = rider.position;
    if (!pos) return;
    const lat = Number.isFinite(pos.lat) ? pos.lat : null;
    const lon = Number.isFinite(pos.lon) ? pos.lon : null;
    if (lat === null || lon === null) return;
    const ele = Number.isFinite(pos.elevation) ? pos.elevation : null;
    const ex = extras || {};
    legacyTrkpts.push({
      t: typeof ex.t === 'string' && ex.t ? ex.t : new Date().toISOString(),
      lat, lon, ele,
      power: (ex.power === null || ex.power === undefined || !Number.isFinite(Number(ex.power))) ? null : Number(ex.power),
      cad: (ex.cad === null || ex.cad === undefined || !Number.isFinite(Number(ex.cad))) ? null : Number(ex.cad),
      hr: (ex.hr === null || ex.hr === undefined || !Number.isFinite(Number(ex.hr))) ? null : Number(ex.hr),
    });
  }

  return {
    /**
     * 旧 advance(dt, speedMps[, extras]):
     *   - speedMps を内部 speed としてセット
     *   - tick(dt) で 1 step 進める (= paused なら no-op)
     *   - extras 引数があれば trkpt 1 件追加 (= raw point ベース、 paused 中は追加しない)
     */
    advance(dt, speedMps, extras) {
      if (!(dt > 0) || !(speedMps >= 0)) return;
      rider.setSpeed(speedMps);
      if (extras) {
        rider.setSensors({ power: extras.power, cad: extras.cad, hr: extras.hr });
      }
      const wasPaused = rider.paused;
      rider.tick(dt, {});
      if (!wasPaused && extras !== undefined) {
        _legacyAppendTrkpt(extras);
      }
    },

    appendTrkpt(extras) {
      _legacyAppendTrkpt(extras);
    },

    getTrkpts() {
      // immutable shallow copy (= 旧仕様、 caller が mutate しても内部影響なし).
      return legacyTrkpts.map((p) => ({ ...p }));
    },

    getCurrentSlope() {
      // rider 現在位置の勾配 (= terrain query、 course[segmentIdx].slope_pct).
      return terrain.length === 0 ? 0 : rider.position.slope_pct;
    },

    getHeading(lookAhead = 5) {
      // rider 現在セグメントから lookAhead 先の travel heading.
      return computeTravelHeading(course, rider.segmentIdx, lookAhead);
    },

    start() {
      rider.start();
      legacyTrkpts = [];
    },

    startFrom(idx) {
      rider.startFromIdx(idx);
      legacyTrkpts = [];
    },

    end() {
      rider.end();
    },

    togglePause() {
      rider.togglePause();
    },

    reset() {
      rider.reset();
      legacyTrkpts = [];
    },

    snapshot() {
      // 旧 snapshot: { idx, distance, paused, active, slope, trkptCount } の 6 fields.
      // idx は rider の実 segmentIdx、 slope は course[segmentIdx].slope_pct.
      const pos = rider.position;
      return {
        idx: pos.segmentIdx,
        distance: rider.distanceTraveled,
        paused: rider.paused,
        active: rider.active,
        slope: pos.slope_pct,
        trkptCount: legacyTrkpts.length,
      };
    },

    isAtEnd() {
      return rider.atGoal;
    },

    seekToward(targetDist, dt, speedMps) {
      return rider.seekToward(targetDist, dt, speedMps);
    },

    // 内部 Rider / Terrain への参照 (= viewer 等 新 path 用).
    _rider: rider,
    _terrain: terrain,
  };
}
