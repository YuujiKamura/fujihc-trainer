// web/lib/physics_state.js
import { integratePhysics } from './bike_physics.js';

const EXPECTED_STATE_DT_S = 1.0;  // state push 期待間隔 (秒)、 fake state interval と整合
const DT_CLAMP_MIN_S = 0.1;
const DT_CLAMP_MAX_S = 2.0;

/**
 * 物理積分 state の closure factory。
 * 内部に 4 state (physicsSpeedMps / lastPhysicsStateT / displaySpeedMps / prevPhysicsSpeedMps)
 * を閉じ込め、 viewer から 4 つの module-global を撤去する足場にする。
 *
 * 副作用ゼロ、 DOM / window / performance.now 参照なし。 「時刻」 は全 method で引数として受ける。
 *
 * @param {object} [opts]
 * @param {number} [opts.initialSpeedMps=0]
 * @returns {{
 *   advance(args: {nowMs:number, power:number, slopePct:number, physicsOpts:object}): void,
 *   interpolate(nowMs:number): number,
 *   reset(args: {nowMs:number, speedMps:number}): void,
 *   snapshot(): {physicsSpeedMps:number, displaySpeedMps:number, prevPhysicsSpeedMps:number, lastPhysicsStateT:number|null},
 *   restoreFromSnapshot(snap: object|null, args?: {nowMs?:number}): void
 * }}
 */
export function createPhysicsState({ initialSpeedMps = 0 } = {}) {
  // 物理速度の内部状態 (m/s)。 state push 1Hz 毎に integratePhysics で更新する「目標速度」。
  // 2026-05-17: ?restore 復元経路では autosave データに速度が無いため (= trkpts は t/power/cad/hr
  // のみ、 distanceM も速度を持たない) seed できず 0 始動とする。 復元直後の 1 state メッセージ分
  // だけ速度が低めに出るが、 1Hz で即積分されるため軽微 (= 数百 ms で復帰)。
  let physicsSpeedMps = initialSpeedMps;
  // 直近 state メッセージの受信時刻 (= dt 算出用、 state push は約 1Hz)。
  let lastPhysicsStateT = null;
  // rAF tick で 60Hz 線形補間して rider.setSpeed に流す現在表示値。
  let displaySpeedMps = initialSpeedMps;
  // state push 受信時に「補間開始 seed = 現在表示値」 として pin される値 (= b83-fix で導入)。
  let prevPhysicsSpeedMps = initialSpeedMps;

  return {
    advance({ nowMs, power, slopePct, physicsOpts }) {
      // nowMs=NaN / Infinity は dt の clamp を bypass して closure state を NaN 汚染するため
      // 物理 module の boundary で即 reject (= 軸 7 セキュリティ、 caller 信頼に頼らず internal guard)
      if (!Number.isFinite(nowMs)) return;
      let dt = (lastPhysicsStateT != null) ? (nowMs - lastPhysicsStateT) / 1000 : 1.0;
      lastPhysicsStateT = nowMs;
      if (dt < DT_CLAMP_MIN_S) dt = DT_CLAMP_MIN_S;
      if (dt > DT_CLAMP_MAX_S) dt = DT_CLAMP_MAX_S;
      physicsSpeedMps = integratePhysics(physicsSpeedMps, dt, power, slopePct, physicsOpts);
      // b83-fix の seed pin: 補間 origin を「今表示してる値」 に固定。 tick が次の advance まで
      // これを起点に新 physicsSpeedMps へ EXPECTED_STATE_DT_S 秒で線形補間する。
      prevPhysicsSpeedMps = displaySpeedMps;
    },
    interpolate(nowMs) {
      // 軸 7 セキュリティ: nowMs=NaN / Infinity は guard で displaySpeedMps を返す。
      // 振る舞い不変保証 (= b125a 以前の viewer tick 補間ブロック `Math.min(1, Math.max(0, ...))`
      // をそのまま移送、 計算は完全一致):
      // elapsed が負 (= clock skew で nowMs < lastPhysicsStateT) でも frac=0 で floor、
      // displaySpeedMps が逆走しない設計を Math.max(0, ...) で物理 pin する。
      if (!Number.isFinite(nowMs) ||
          !Number.isFinite(physicsSpeedMps) || physicsSpeedMps < 0 ||
          lastPhysicsStateT == null) {
        return displaySpeedMps;
      }
      const elapsed = (nowMs - lastPhysicsStateT) / 1000;
      const frac = Math.min(1, Math.max(0, elapsed / EXPECTED_STATE_DT_S));
      displaySpeedMps = prevPhysicsSpeedMps + (physicsSpeedMps - prevPhysicsSpeedMps) * frac;
      return displaySpeedMps;
    },
    reset({ nowMs, speedMps }) {
      physicsSpeedMps = speedMps;
      prevPhysicsSpeedMps = speedMps;
      displaySpeedMps = speedMps;
      lastPhysicsStateT = nowMs;
    },
    snapshot() {
      return { physicsSpeedMps, displaySpeedMps, prevPhysicsSpeedMps, lastPhysicsStateT };
    },
    // b127: 過去 ride の snapshot から 4 state を一括復元する (= 履歴続きから機能).
    // snap が null / 必須 field 欠落 / 非数値の時は 0 速度で reset、 lastPhysicsStateT は
    // 復元直後に「次の state push を遅延扱いさせない」 ため args.nowMs を入れる (= 与えられなければ null).
    // 復元成功でも lastPhysicsStateT は args.nowMs で上書きする (= 過去 ride 終了時刻のまま残すと
    // 次 advance で dt が異常値になり物理が荒れる).
    restoreFromSnapshot(snap, args = {}) {
      const nowMs = Number.isFinite(args?.nowMs) ? args.nowMs : null;
      const validSnap = snap
        && Number.isFinite(snap.physicsSpeedMps)
        && Number.isFinite(snap.displaySpeedMps)
        && Number.isFinite(snap.prevPhysicsSpeedMps)
        && snap.physicsSpeedMps >= 0
        && snap.displaySpeedMps >= 0
        && snap.prevPhysicsSpeedMps >= 0;
      if (!validSnap) {
        physicsSpeedMps = 0;
        prevPhysicsSpeedMps = 0;
        displaySpeedMps = 0;
      } else {
        physicsSpeedMps = snap.physicsSpeedMps;
        prevPhysicsSpeedMps = snap.prevPhysicsSpeedMps;
        displaySpeedMps = snap.displaySpeedMps;
      }
      lastPhysicsStateT = nowMs;
    },
  };
}
