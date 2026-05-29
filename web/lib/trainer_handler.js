// b124: trainer state push の sensor 値を Rider に sticky 反映する pure 関数。
//
// viewer-maplibre.js から切り出した理由 ── viewer は top-level で document.getElementById を
// 呼ぶため、node 環境 (vitest は environment:'node') で import すると ReferenceError で落ちる。
// sensor の単一 source を Rider に統一する入口を DOM 非依存の lib に置くことで、vitest から
// 直接 import して振る舞いを pin できる。後続 (物理 intermediate state の剥離) の足場にもなる。
//
// sticky 仕様: パワーメーターと心拍計は別デバイスで、power_w だけ / hr_bpm だけ の message が
// 別タイミングで届く。各 field が数値でなければ undefined を渡し、rider.setSensors の
// 「undefined は前値保持」で sticky (= 直近値の保持) を実現する。null を渡すと Number(null)=0 で
// 0 にリセットされる (rider.setSensors の落とし穴) ため、必ず undefined を渡すこと。

/**
 * trainer state message の sensor 値を rider に流し込む。rider が null の間は捨てる
 * (= terrain ready 前 / ride 起動前は HUD にも反映されないので振る舞い差なし)。
 *
 * @param {{power_w?:number, cadence_rpm?:number, hr_bpm?:number, speed_mps?:number}} msg
 * @param {{rider: object|null}} ctx
 */
export function handleTrainerStatePush(msg, { rider } = {}) {
  if (!rider) return;
  rider.setSensors({
    power: typeof msg.power_w === 'number' ? msg.power_w : undefined,
    cad: typeof msg.cadence_rpm === 'number' ? msg.cadence_rpm : undefined,
    hr: typeof msg.hr_bpm === 'number' ? msg.hr_bpm : undefined,
  });
  if (typeof msg.speed_mps === 'number') rider.setSpeed(msg.speed_mps);
}
