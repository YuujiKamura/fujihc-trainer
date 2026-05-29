// model: 過去 ride 1 件を選んで「続きから」 走るための復元処理。 純粋関数寄り、
// DOM / window / performance.now を直接参照せず、 deps と nowMs を引数で受ける.
// history-overlay の各行に置かれる「続きから」 button click から (= Controller =
// viewer-map3d.js) 呼ばれ、 rider 位置と物理速度を旧 ride の末尾に合わせて、
// 新規 ride として開始する.
//
// 旧 ride 自体は履歴に残る (= 削除しない)、 続きから走った分は新 ride として別行に保存される.
// 経過秒 / trkpts は新 ride として 0 から記録 (= 旧 trkpts は再生しない、 新ライドの記録対象).
//
// 純粋関数寄り: DOM / window / performance.now を直接参照しない、 deps と nowMs を引数で受ける.
// node test では rider / physicsState / rideClock を stub 渡しで pin 可能.

/**
 * 過去 ride record を復元して「続きから」 走り出す.
 *
 * @param {object|null|undefined} record  ride_db の 1 record. 期待 field:
 *   { id, date, trkpts, summary: {distance_m}, schemaVersion?, physicsSnap?, riderDistance? }
 * @param {{
 *   rider: { placeAtDistance: (d:number) => void, distanceTraveled?: number },
 *   physicsState: { restoreFromSnapshot: (snap:object|null, args?:object) => void },
 *   rideClock: { start: (args:{nowMs:number, isoString?:string}) => void },
 *   nowMs: number,
 * }} deps
 * @returns {{ok:true, restored:{schemaVersion:number, riderDistance:number, physicsRestored:boolean}}
 *         | {ok:false, reason:string}}
 */
export function resumeFromRecord(record, deps) {
  if (!record) return { ok: false, reason: 'no_record' };
  if (!deps || !deps.rider || !deps.physicsState || !deps.rideClock) {
    return { ok: false, reason: 'no_deps' };
  }
  if (!Number.isFinite(deps.nowMs)) {
    return { ok: false, reason: 'no_nowMs' };
  }

  const riderDistance = resolveRiderDistance(record);
  if (riderDistance == null) {
    return { ok: false, reason: 'no_distance' };
  }

  // schemaVersion=2 record は physicsSnap を持つ、 v1 (不在) は null で渡して 0 reset.
  const schemaVersion = Number.isFinite(record.schemaVersion) ? record.schemaVersion : 1;
  const physicsSnap = (schemaVersion >= 2 && record.physicsSnap) ? record.physicsSnap : null;

  deps.rider.placeAtDistance(riderDistance);
  deps.physicsState.restoreFromSnapshot(physicsSnap, { nowMs: deps.nowMs });
  // rideClock は新 ride として start (= 経過秒は 0 から、 isoString は新たに発行).
  deps.rideClock.start({ nowMs: deps.nowMs });

  return {
    ok: true,
    restored: {
      schemaVersion,
      riderDistance,
      physicsRestored: physicsSnap != null,
    },
  };
}

/**
 * record から rider の出発距離を決める.
 * v2 で record.riderDistance があればそれを使う、 無ければ summary.distance_m に fallback、
 * それも無ければ trkpts 数や lat/lon を見るのは過剰なので null を返す (= 復元 abort).
 */
function resolveRiderDistance(record) {
  if (Number.isFinite(record.riderDistance) && record.riderDistance >= 0) {
    return record.riderDistance;
  }
  const s = record.summary || {};
  if (Number.isFinite(s.distance_m) && s.distance_m >= 0) {
    return s.distance_m;
  }
  return null;
}
