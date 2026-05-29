// web/lib/ride_clock.js

const POSITION_SEND_INTERVAL_MS = 1000;
const TRKPT_INTERVAL_MS         = 1000;
const AUTOSAVE_INTERVAL_MS      = 30_000;  // autosave: 30 秒毎に IndexedDB へ進行状態を save

/**
 * ride 時計の closure factory。
 * 内部に 6 state (rideStartedAt / rideStartedIso / lastRideDurationS /
 * lastPositionSendT / lastTrkptT / lastAutosaveT) を閉じ込め、 viewer から
 * 6 module-global を撤去する足場にする。
 *
 * 副作用ゼロ、 DOM / window / performance.now / Date 参照なし。
 * 「今の時刻」 は全 method で引数 (nowMs / isoString) として受け、 caller が決める。
 *
 * @returns {{
 *   start(args: {nowMs:number, isoString:string}): void,
 *   end(args: {nowMs:number}): {durationS:number},
 *   restore(args: {nowMs:number, isoString:string}): void,
 *   elapsedSec(nowMs:number): number|null,
 *   isActive(): boolean,
 *   shouldPushPosition(nowMs:number): boolean,
 *   shouldPushTrkpt(nowMs:number): boolean,
 *   shouldRunAutosave(nowMs:number): boolean,
 *   getDurationS(): number,
 *   getRideStartedIso(): string|null,
 *   snapshot(): {rideStartedAt:number|null, rideStartedIso:string|null, lastRideDurationS:number, lastPositionSendT:number, lastTrkptT:number, lastAutosaveT:number}
 * }}
 */
export function createRideClock() {
  let rideStartedAt     = null;
  let rideStartedIso    = null;
  let lastRideDurationS = 0;
  let lastPositionSendT = 0;
  let lastTrkptT        = 0;
  let lastAutosaveT     = 0;

  return {
    start({ nowMs, isoString }) {
      // 軸 7 セキュリティ: 内部 boundary で NaN / Infinity / 非文字列を reject、
      // 後続の elapsedSec / cadence 判定が NaN 汚染しないよう closure を守る。
      if (!Number.isFinite(nowMs)) return;
      rideStartedAt     = nowMs;
      rideStartedIso    = (typeof isoString === 'string' && isoString) ? isoString : null;
      lastRideDurationS = 0;
      lastPositionSendT = 0;
      lastTrkptT        = 0;
      lastAutosaveT     = nowMs;  // autosave 30s cadence は start 直後を 0 秒地点にする (= 即発火しない)
    },
    end({ nowMs }) {
      // duration は rideStartedAt が non-null の時だけ計算、 そうでなければ前回確定値を保持。
      // 2026-05-19 fix の移送: 旧 viewer は ended で rideStartedAt=null にした後 showPostride →
      // buildRideSummary が呼ばれ、 保存される duration_s が常に 0 だった (=「記録の時間が 0」の正体)。
      // ここで duration を「先に確定してから null clear」 する順序を本 module 内で構造的に保証する。
      if (Number.isFinite(nowMs) && rideStartedAt !== null) {
        lastRideDurationS = Math.round((nowMs - rideStartedAt) / 1000);
      }
      rideStartedAt  = null;
      rideStartedIso = null;
      return { durationS: lastRideDurationS };
    },
    restore({ nowMs, isoString }) {
      // restore 経路 (= autosave からの中断再開) は rideStartedAt を「今この瞬間」 に
      // 再起算する。 旧 ride の wall-clock は isoString に保存済、 viewer 側の
      // 経過時間は restore 後 0 秒から再開する設計。 cadence 群も全部「今」 に揃える
      // (= restore 直後に trkpt / autosave / position が即発火しない gate)。
      if (!Number.isFinite(nowMs)) return;
      rideStartedAt     = nowMs;
      rideStartedIso    = (typeof isoString === 'string' && isoString) ? isoString : null;
      lastPositionSendT = nowMs;
      lastTrkptT        = nowMs;
      lastAutosaveT     = nowMs;
    },
    elapsedSec(nowMs) {
      // ride 未開始 = null を返す (= 旧 elapsedSec=null → hud "00:00:00" 経路と互換)。
      // NaN nowMs 防御 + rideStartedAt null 防御。
      if (rideStartedAt === null || !Number.isFinite(nowMs)) return null;
      return Math.floor((nowMs - rideStartedAt) / 1000);
    },
    isActive() {
      return rideStartedAt !== null;
    },
    // === 以下 3 method は副作用付き cadence gate ===
    // trigger (= true 返却) の瞬間に内部 lastXxxT を nowMs で更新する。 caller は
    // `if (clock.shouldXxx(now) && other) { ... }` のような短絡 && で使うな ──
    // `other` が false でも cadence 側 true なら `lastXxxT` が無音で進む。 単独 if で gate して
    // 他条件は内部に積むか、 cadence 判定の前に早期 return すること。
    shouldPushPosition(nowMs) {
      if (!Number.isFinite(nowMs)) return false;
      if (nowMs - lastPositionSendT < POSITION_SEND_INTERVAL_MS) return false;
      lastPositionSendT = nowMs;
      return true;
    },
    shouldPushTrkpt(nowMs) {
      if (!Number.isFinite(nowMs)) return false;
      if (nowMs - lastTrkptT < TRKPT_INTERVAL_MS) return false;
      lastTrkptT = nowMs;
      return true;
    },
    shouldRunAutosave(nowMs) {
      if (!Number.isFinite(nowMs)) return false;
      if (nowMs - lastAutosaveT < AUTOSAVE_INTERVAL_MS) return false;
      lastAutosaveT = nowMs;
      return true;
    },
    getDurationS() {
      return lastRideDurationS;
    },
    getRideStartedIso() {
      return rideStartedIso;
    },
    snapshot() {
      return {
        rideStartedAt, rideStartedIso, lastRideDurationS,
        lastPositionSendT, lastTrkptT, lastAutosaveT,
      };
    },
  };
}
