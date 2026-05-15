// brief 35: ride_state は Terrain + Rider 2 層モデルの **後方互換 shim** に格下げ.
//
// 経緯:
// - brief 19 で viewer-maplibre.js から curIdx/curDist/paused/active を吸い出して
//   pure state machine 化 (= createRideState({course})) した. brief 33 で trkpts も移送.
// - brief 35 で「Terrain (= 客観地形/経路) ⊃ Rider (= 主体)」 という上位モデル分離を実装、
//   ride_state.js が持っていた責務 (= 進行カウンタ + position 算出 + trkpts) は
//   Terrain と Rider に正しく振り分けられた.
// - 既存 caller (= viewer-maplibre.js, ride_state*.test.js x3 ファイル 29 件) を破壊しないため、
//   旧 createRideState は内部で Terrain + Rider を生成して旧 API surface を維持する shim 化.
//
// 旧 vs 新の差分メモ (= shim が吸収する責務):
//   1. 旧 curIdx は「course[curIdx+1].distance_m < curDist (= 厳密 <)」 で前進、 末尾到達時に
//      curIdx = lastIdx - 1 で留まる. 新 Terrain.idxAtDistance は <= で計算、 境界で +1 ずれる.
//      shim は _legacyIdx で旧 logic を再現.
//   2. 旧 appendTrkpt は course[curIdx] の raw 値 (= 補間なし) を使う. 新 Rider.appendTrkpt は
//      補間後 position を使う. shim は内部に独自 trkpts buffer を持って旧挙動を再現.
//
// 新規 caller は本 module ではなく Terrain + Rider を直接使え:
//   import { createTerrain } from './terrain.js';
//   import { createRider } from './rider.js';
//   const terrain = createTerrain({ course });
//   const rider = createRider({ terrain });

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
  // 旧 trkpts buffer (= shim 専用). Rider 内部の trkpts と並存させる代わりに、
  // 旧 API caller には「shim 自身が保持する legacy trkpts」 だけを露出する.
  let legacyTrkpts = [];

  // 旧 ride_state は curIdx を「advance では <、 seekToward では <=」 で更新する内部不整合があった.
  // shim はその挙動を byte-同等に再現するため、 curIdx を独立 field で持つ. Rider の position
  // 算出には使わない、 旧 snapshot().idx の値だけのため.
  const lastIdx = Math.max(0, course.length - 1);
  let _idx = 0;

  function _idxAdvance() {
    // 旧 advanceIdx (= 厳密 <) と同 logic.
    while (_idx < lastIdx && course[_idx + 1].distance_m < rider.distanceTraveled) _idx++;
  }

  function _idxRefreshLooseLE() {
    // 旧 seekToward 内の idx 再計算 (= <=) と同 logic.
    let i = 0;
    while (i < lastIdx && course[i + 1].distance_m <= rider.distanceTraveled) i++;
    _idx = i;
  }

  function _legacyIdx() {
    // snapshot 経路の idx (= advance 経由で更新されている前提). seekToward が呼ばれた直後は
    // _idxRefreshLooseLE で <= ベースに更新済.
    return _idx;
  }

  function _legacyAppendTrkpt(extras) {
    if (course.length === 0) return;
    const idx = _legacyIdx();
    const p = course[idx];
    if (!p) return;
    const lat = Number.isFinite(p.lat) ? p.lat : null;
    const lon = Number.isFinite(p.lon) ? p.lon : null;
    if (lat === null || lon === null) return;
    const ele = Number.isFinite(p.elevation_m) ? p.elevation_m : null;
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
     *   - extras 引数があれば trkpt 1 件追加 (= brief 33 既存挙動、 raw point ベース)
     */
    advance(dt, speedMps, extras) {
      if (!(dt > 0) || !(speedMps >= 0)) return;
      rider.setSpeed(speedMps);
      if (extras) {
        rider.setSensors({ power: extras.power, cad: extras.cad, hr: extras.hr });
      }
      const wasPaused = rider.paused;
      rider.tick(dt, {});
      if (!wasPaused) {
        _idxAdvance();  // 旧 advance 経路の idx 更新 (= 厳密 <).
        if (extras !== undefined) {
          _legacyAppendTrkpt(extras);
        }
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
      if (terrain.length === 0) return 0;
      const idx = _legacyIdx();
      const p = course[idx];
      return (p && Number.isFinite(p.slope_pct)) ? p.slope_pct : 0;
    },

    getHeading(lookAhead = 5) {
      const idx = _legacyIdx();
      return computeTravelHeading(course, idx, lookAhead);
    },

    start() {
      rider.start();
      _idx = 0;
      legacyTrkpts = [];
    },

    startFrom(idx) {
      rider.startFromIdx(idx);
      // 旧 startFrom は curIdx = safeIdx でセットしていた、 seekToward と違って <= 再計算不要.
      let safeIdx = Math.floor(Number(idx));
      if (!Number.isFinite(safeIdx)) safeIdx = 0;
      if (safeIdx < 0) safeIdx = 0;
      if (safeIdx > lastIdx) safeIdx = lastIdx;
      _idx = safeIdx;
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
      _idx = 0;
      legacyTrkpts = [];
    },

    snapshot() {
      // 旧 snapshot: { idx, distance, paused, active, slope, trkptCount } の 6 fields.
      // idx は legacy 厳密 < semantics、 slope は course[legacyIdx].slope_pct.
      const idx = _legacyIdx();
      const p = course[idx];
      const slope = (p && Number.isFinite(p.slope_pct)) ? p.slope_pct : 0;
      return {
        idx,
        distance: rider.distanceTraveled,
        paused: rider.paused,
        active: rider.active,
        slope,
        trkptCount: legacyTrkpts.length,
      };
    },

    isAtEnd() {
      return rider.atGoal;
    },

    seekToward(targetDist, dt, speedMps) {
      const reached = rider.seekToward(targetDist, dt, speedMps);
      // 旧 seekToward は paused / 不正引数で false return + idx 不変、 そうでなければ <= で idx 再計算.
      if (!rider.paused && course.length > 0 && dt > 0 && speedMps > 0) {
        _idxRefreshLooseLE();
      }
      return reached;
    },

    // 内部 Rider / Terrain への参照 (= brief 35 過渡期の viewer 等 新 path 用).
    // 既存 caller は使わない、 viewer-maplibre.js の rewire 後に追加 export.
    _rider: rider,
    _terrain: terrain,
  };
}
