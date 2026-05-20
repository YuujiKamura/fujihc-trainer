// ライド HUD の表示更新を 1 モジュールに集約 (Path B 移行の Phase 0)。
//
// 旧来 viewer-maplibre.js 本体に setText でべた書きだった HUD 更新 (時間/距離/標高/
// 勾配/速度/パワー/ケイデンス/心拍/trainer 応答) を、 値の整形と DOM 書き込みだけを
// 担う純モジュールに括り出す。 MapLibre にも Three.js にも依存しない ── 値の計算と
// rider-hud の画面座標は呼び出し側の責務で、 hud は受け取った値を整形して書くだけ。
// これで MapLibre 版 viewer と Three.js 版 viewer が同じ hud.js を import できる。
//
// DOM 書き込みは frame_diff.createTextWriter 経由 (= textContent 代入、 innerHTML は
// 一切使わない)。 trainer / bridge 由来の文字列を書いても XSS 経路は入らない。

import { createTextWriter } from './frame_diff.js';

// === 整形 (純関数、 単体テスト対象) ===

/** 経過秒 → "HH:MM:SS"。 null/undefined は "00:00:00" (= ride 未開始)。 */
export function formatElapsed(sec) {
  if (sec == null) return '00:00:00';
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/**
 * 速度 (km/h) → #r-speed (rider-hud の速度行) の表示文字列。
 * paused 中は接続有無で「待機中」(bridge 接続) /「paused」(demo)、
 * 走行中は「N km/h (bridge)」/「N km/h (demo)」。
 */
export function formatSpeed(speedKmh, { paused, connected } = {}) {
  if (paused) return connected ? '待機中' : 'paused';
  return `${speedKmh.toFixed(1)} km/h${connected ? ' (bridge)' : ' (demo)'}`;
}

/** trainer パワー (W)。 null/欠損は "--"。 */
export function formatPower(powerW) {
  return powerW != null ? String(powerW) : '--';
}

/** trainer ケイデンス (rpm)。 null/欠損は "--"。 */
export function formatCadence(cadenceRpm) {
  return cadenceRpm != null ? cadenceRpm.toFixed(0) : '--';
}

/** 心拍 (bpm)。 null/欠損は "--"。 */
export function formatHr(hrBpm) {
  return hrBpm != null ? String(hrBpm) : '--';
}

/** trainer 速度 (m/s) → "N km/h"。 負値/欠損は "--"。 */
export function formatTrainerSpeed(speedMps) {
  return (speedMps != null && speedMps >= 0)
    ? `${(speedMps * 3.6).toFixed(1)} km/h`
    : '--';
}

/**
 * trainer 応答 (last_ack 文字列) → 表示テキストと成否。
 * "OK" を含めば成功 (✓)、 さもなくば失敗 (✗)。
 */
export function formatAck(lastAck) {
  const ok = String(lastAck).includes('OK');
  return { text: `${ok ? '✓' : '✗'} ${lastAck}`, ok };
}

export const ACK_OK_COLOR = '#7fff00';
export const ACK_NG_COLOR = '#ff5050';

/**
 * 残り距離と平均速度から「フィニッシュまであと N」 を整形 (b39)。
 *
 * hud SoT 規律 = 整形 + DOM 書き込みのみ。 paused / elapsedSec / 30 秒境界の状態判定は
 * 呼び出し側 (= ride loop) で済ませた上で、 ここには数値だけを渡す。 本関数は
 * 「avgSpeed_kmh の妥当性」 のみ判定 (= 0 / NaN / 負 / undefined → "--")。
 *
 * 表示 spec (= b39 brief 確定、 60 分 = 1 時間扱い):
 *  - avgSpeed_kmh ≤ 0 / NaN / 負 / undefined → "--"
 *  - remainingDist_m ≤ 0 → "00:00" (= ゴール後 / 完走)
 *  - 残り時間 = (remainingDist_m / 1000) / avgSpeed_kmh [hours]、 分への round (= 30 秒以上で +1 分)
 *  - 0-59 分 → "あと N 分"
 *  - 60 分以上 → "あと N 時間 M 分" (= hours = floor(N/60), mins = N % 60)
 */
export function formatEta(remainingDist_m, avgSpeed_kmh) {
  if (avgSpeed_kmh == null || !Number.isFinite(avgSpeed_kmh) || avgSpeed_kmh <= 0) return '--';
  if (remainingDist_m == null || !Number.isFinite(remainingDist_m) || remainingDist_m <= 0) return '00:00';
  const minutes = Math.round((remainingDist_m / 1000) / avgSpeed_kmh * 60);
  if (minutes < 60) return `あと ${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `あと ${hours} 時間 ${mins} 分`;
}

/**
 * ライド HUD の更新メソッド束を作る。
 *
 * @param {(id:string)=>(Element|null)} getEl - id から要素を引く関数 (test では fake)
 * @returns HUD 更新メソッド束
 */
export function createHud(getEl) {
  const write = createTextWriter(getEl);
  return {
    /** #hud + #rider-hud のライド数値。 elapsedSec が null なら "00:00:00"。 */
    ride({ elapsedSec, dist, ele, slope }) {
      write('elapsed', formatElapsed(elapsedSec));
      write('dist', dist.toFixed(0));
      write('ele', ele.toFixed(0));
      write('r-slope', slope.toFixed(1));
    },

    /** コース総距離 (#total、 起動時 1 回)。 */
    total(totalDist) {
      write('total', totalDist.toFixed(0));
    },

    /**
     * #r-speed (= rider-hud の速度行)。 物理速度を km/h で書く ── ライダーが
     * 実際に進む速度 (= 保存される速度) で、 trainer 生速度ではない。
     * flags は { paused, connected }。
     */
    speed(speedKmh, flags) {
      write('r-speed', formatSpeed(speedKmh, flags));
    },

    /**
     * trainer 値 → #power/#cadence/#hr と #rider-hud の r-power/r-cadence/r-hr。
     * 引数は生の数値 (or null)。 ペアリングパネル p-* は対象外だが、 そちらも
     * 整形は本モジュールの export 関数 (formatPower 等) を使うこと (= 整形の SoT)。
     * 速度はここでは書かない ── rider-hud の r-speed は speed() が物理速度で書く
     * (= trainer 生速度は平地 + power のみで坂を見ず、 実際の走行速度と食い違う)。
     * trainer 生速度はペアリングパネル #p-speed にのみ出す。
     */
    trainer({ powerW, cadenceRpm, hrBpm }) {
      const pw = formatPower(powerW);
      const cd = formatCadence(cadenceRpm);
      const hr = formatHr(hrBpm);
      write('power', pw); write('cadence', cd); write('hr', hr);
      write('r-power', pw); write('r-cadence', cd); write('r-hr', hr);
    },

    /** trainer 応答 (#ack)。 last_ack の生文字列を渡す。 成否で色を変える。 */
    ack(lastAck) {
      const { text, ok } = formatAck(lastAck);
      const el = getEl('ack');
      if (el) {
        el.textContent = text;
        el.style.color = ok ? ACK_OK_COLOR : ACK_NG_COLOR;
      }
    },

    /**
     * #rider-hud の表示/非表示を切り替える。 CSS で固定した位置はそのまま (left/top に触れない)。
     * 画面中央上部固定レイアウト用。
     */
    riderHudVisible(visible) {
      const el = getEl('rider-hud');
      if (!el) return;
      el.style.display = visible ? 'block' : 'none';
    },

    /**
     * #rider-hud を画面座標 (x, y) に置く。 visible=false で非表示。
     * 座標は呼び出し側が projection (MapLibre map.project / Three.js) で算出して渡す
     * ── hud は座標系を一切知らない。 (terrain3d.html で使用中)
     */
    riderHudAt(x, y, visible) {
      const el = getEl('rider-hud');
      if (!el) return;
      if (visible) {
        el.style.display = 'block';
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      } else {
        el.style.display = 'none';
      }
    },

    /**
     * フィニッシュまでの残り時間予想を #eta に書く (b39)。
     * 数値の妥当性判定は呼び出し側 (= ride loop)、 本 method は formatEta の結果を
     * textContent に書くだけ。 paused / 開始 30 秒以内は ride loop 側で avgSpeed_kmh を
     * NaN にして渡す = hud は「avgSpeed が NaN なら '--'」 を 1 規則で扱う。
     */
    eta({ remainingDist_m, avgSpeed_kmh }) {
      write('eta', formatEta(remainingDist_m, avgSpeed_kmh));
    },
  };
}
