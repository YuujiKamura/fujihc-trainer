// b99 chart buffer ── ride 中の trainer 値 / 物理速度 を時系列で保持する純データ層。
// hud.js (= 整形 + DOM 書き込み SoT) からは独立、 chart panel 専用の SoT。
// DOM / canvas / fetch 依存ゼロ ── node test で全 method の境界を pin できる。
//
// 配列 append 設計 (= ring buffer ではない):
//   ride 全長は富士ヒル本コース 90 分 + 余裕 30 分 = 最大 120 min = 7200 sec
//   1 Hz sample で 7200 sample、 各 sample 5 値 (t/speed/power/hr/cadence) × float64
//   = 7200 × 5 × 8 byte = 288 KB ── ride 1 回ぶんなら配列 append で十分、 ring 不要
//   ride 終了 (= postride) 後に buffer 全捨て (= clear)、 次の ride で空からスタート

function isValidNumber(v) {
  // null / undefined / NaN を除外、 有限数のみ true。
  return typeof v === 'number' && Number.isFinite(v);
}

export function createChartBuffer() {
  const samples = []; // [{ t, speed, power, hr, cadence }, ...]
  return {
    push(sample) {
      samples.push(sample);
    },
    get() {
      return samples;
    },
    clear() {
      samples.length = 0;
    },
    avgOf(field) {
      // 有効値 (= 有限数のみ) の平均、 空 / 全無効なら null。
      let sum = 0;
      let count = 0;
      for (const s of samples) {
        const v = s[field];
        if (isValidNumber(v)) {
          sum += v;
          count += 1;
        }
      }
      if (count === 0) return null;
      return sum / count;
    },
    maxOf(field) {
      // 有効値 (= 有限数のみ) の最大、 空 / 全無効なら null。
      let max = -Infinity;
      let count = 0;
      for (const s of samples) {
        const v = s[field];
        if (isValidNumber(v)) {
          if (v > max) max = v;
          count += 1;
        }
      }
      if (count === 0) return null;
      return max;
    },
    minTime() {
      return samples.length > 0 ? samples[0].t : 0;
    },
    maxTime() {
      return samples.length > 0 ? samples[samples.length - 1].t : 0;
    },
  };
}

// 1 sample 単位の push 入力 schema (= 純データ)。
// trainer 由来の値は null 許容 (= センサ不在 / 接続前)、 chart 描画側で null を skip する。
//   t        : number (= ride 開始からの経過秒、 Number、 0 以上)
//   speed    : number | null (km/h、 物理速度)
//   power    : number | null (W、 trainer)
//   hr       : number | null (bpm、 trainer)
//   cadence  : number | null (rpm、 trainer)
export function pushSample(buffer, t, { speed, power, hr, cadence } = {}) {
  // t<0 / NaN / undefined / 非数 は無視 (= early return、 buffer 不変)。
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return;
  buffer.push({ t, speed, power, hr, cadence });
}

export function avgInRange(samples, field, tStart, tEnd) {
  // tStart..tEnd 範囲 (= 両端含む) の sample の field 有効値の平均。
  // 空 / 範囲内ゼロ件 / 全無効 / tStart>tEnd → null。
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (typeof tStart !== 'number' || typeof tEnd !== 'number') return null;
  if (tStart > tEnd) return null;
  let sum = 0;
  let count = 0;
  for (const s of samples) {
    if (s.t < tStart || s.t > tEnd) continue;
    const v = s[field];
    if (isValidNumber(v)) {
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return sum / count;
}

export function maxInRange(samples, field, tStart, tEnd) {
  // tStart..tEnd 範囲 (= 両端含む) の sample の field 有効値の最大。
  // 空 / 範囲内ゼロ件 / 全無効 / tStart>tEnd → null。
  if (!Array.isArray(samples) || samples.length === 0) return null;
  if (typeof tStart !== 'number' || typeof tEnd !== 'number') return null;
  if (tStart > tEnd) return null;
  let max = -Infinity;
  let count = 0;
  for (const s of samples) {
    if (s.t < tStart || s.t > tEnd) continue;
    const v = s[field];
    if (isValidNumber(v)) {
      if (v > max) max = v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return max;
}

// viewer-map3d.js の maybePushAndRenderChart() の push 判定を pure 化。
// 入力: { paused, elapsedSec, lastPushSec, snapshot: {speed, power, hr, cadence} }
// 戻り: { push: boolean, sample: {t,speed,power,hr,cadence}|null, nextLastPushSec: number }
//
// 規則:
//   paused=true                           → 何もしない (lastPushSec 維持)
//   elapsedSec<0 / NaN / 非数            → 何もしない (lastPushSec 維持)
//   Math.floor(elapsedSec) > lastPushSec  → push、 snapshot を sample に同梱、 nextLastPushSec=floor
//   それ以外 (= 同秒内)                   → 何もしない (lastPushSec 維持)
export function decideChartPush(state) {
  const { paused, elapsedSec, lastPushSec, snapshot } = state || {};
  if (paused) {
    return { push: false, sample: null, nextLastPushSec: lastPushSec };
  }
  if (typeof elapsedSec !== 'number' || !Number.isFinite(elapsedSec) || elapsedSec < 0) {
    return { push: false, sample: null, nextLastPushSec: lastPushSec };
  }
  const floor = Math.floor(elapsedSec);
  if (floor > lastPushSec) {
    const { speed = null, power = null, hr = null, cadence = null } = snapshot || {};
    return {
      push: true,
      sample: { t: floor, speed, power, hr, cadence },
      nextLastPushSec: floor,
    };
  }
  return { push: false, sample: null, nextLastPushSec: lastPushSec };
}
