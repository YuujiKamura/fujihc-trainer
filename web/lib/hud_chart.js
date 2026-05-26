// b99 chart renderer ── chart_buffer の samples を canvas に 4 sub-chart として描く.
// buffer の責務 = データ保持、 本 module の責務 = データ→pixel 変換、 SoT 分離。
//
// canvas は <canvas id="hud-chart-canvas"> 1 個に 4 sub-chart を縦積みする (= Strava
// と同型 form)。 各 sub-chart は独立した sub region (= y 帯) を持つ:
//   time ruler:  y=0..14
//   sub-chart 0: y=14..64   ── スピード (cyan)
//   sub-chart 1: y=64..114  ── パワー (purple)
//   sub-chart 2: y=114..164 ── 心拍 (red)
//   sub-chart 3: y=164..214 ── ケイデンス (magenta)
// 横軸 = ride elapsed 0 〜 maxT (= buffer.maxTime())、 全 sub-chart で共有。
//
// 寸法は user 訂正「縦幅もっと取って良い、 テキスト大きく」 反映で 50/14/70/32 + font 12.
// 折りたたみは index.html の #hud-chart-fold-btn + body.chart-folded で canvas を隠す層.

export const SUBCHART_SPECS = [
  { field: 'speed', label: 'スピード', unit: 'km/h', color: '#5fb8e6', avgColor: 'rgba(95,184,230,0.55)' },
  { field: 'power', label: 'パワー', unit: 'W', color: '#b39ddb', avgColor: 'rgba(179,157,219,0.55)' },
  { field: 'hr', label: '心拍数', unit: 'bpm', color: '#e94e77', avgColor: 'rgba(233,78,119,0.55)' },
  { field: 'cadence', label: 'ケイデンス', unit: 'rpm', color: '#e879b6', avgColor: 'rgba(232,121,182,0.55)' },
];

export const SUBCHART_HEIGHT_PX = 50;
// user 訂正「それぞれのチャートエリアが重なって見えるので、 間に僅かなマージンを取ろう」
// 反映で gap 0 → 4 に。 4 sub-chart の間に 3 個の透明 gap が入る (= 上下 sub-chart の
// grid 線が近接して「くっついて見える」 状態を解消).
export const SUBCHART_GAP_PX = 4;
export const TIME_RULER_HEIGHT_PX = 14;
export const LEFT_LABEL_WIDTH_PX = 70;
export const RIGHT_UNIT_WIDTH_PX = 32;
export const CANVAS_HEIGHT_PX = TIME_RULER_HEIGHT_PX + SUBCHART_HEIGHT_PX * 4 + SUBCHART_GAP_PX * 3; // = 226

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatNumberForLabel(v) {
  // null / undefined / NaN / 非数 → '--'。 有限数は toFixed(1)。
  if (!isValidNumber(v)) return '--';
  return v.toFixed(1);
}

function formatTickLabel(t) {
  // t=0 → '0 秒' (= 単位明示で ride 開始時刻を視覚化)。
  // t>0 → 'M:SS' (Strava 形式)。
  if (t === 0) return '0 秒';
  const totalSec = Math.floor(t);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatSubchartLabel(spec, max, avg) {
  // 戻り: `${spec.label}\n最大 ${max ?? '--'}\n平均 ${avg ?? '--'}`
  // max / avg は独立判定、 数値は toFixed(1) で 1 桁。
  const maxStr = formatNumberForLabel(max);
  const avgStr = formatNumberForLabel(avg);
  return `${spec.label}\n最大 ${maxStr}\n平均 ${avgStr}`;
}

export function formatTimeRulerTicks(maxT, tickIntervalSec) {
  // 戻り: [{t, label}, ...]、 t=0 から maxT までを tickIntervalSec 間隔で。
  // maxT=0 → [{t:0,label:'0 秒'}] のみ。
  // maxT>0 → 最後の tick が maxT と一致するように生成 (= 整数倍)。
  if (!isValidNumber(maxT) || maxT < 0) return [{ t: 0, label: '0 秒' }];
  if (!isValidNumber(tickIntervalSec) || tickIntervalSec <= 0) return [{ t: 0, label: '0 秒' }];
  if (maxT === 0) return [{ t: 0, label: '0 秒' }];
  const ticks = [];
  for (let t = 0; t <= maxT; t += tickIntervalSec) {
    ticks.push({ t, label: formatTickLabel(t) });
  }
  // 最終 tick が maxT 未満なら maxT を追加 (= 端を pin)。
  if (ticks[ticks.length - 1].t < maxT) {
    ticks.push({ t: maxT, label: formatTickLabel(maxT) });
  }
  return ticks;
}

export function sampleToCanvasX(t, minT, maxT, leftPx, rightPx) {
  // 線形 mapping、 端 clamp、 maxT===minT 時は leftPx (= 0 除算回避)。
  if (maxT === minT) return leftPx;
  if (t < minT) return leftPx;
  if (t > maxT) return rightPx;
  const ratio = (t - minT) / (maxT - minT);
  return leftPx + ratio * (rightPx - leftPx);
}

export function valueToCanvasY(v, minV, maxV, topPx, bottomPx) {
  // 反転 Y (= v 大 → topPx、 v 小 → bottomPx)。
  // v が null / undefined / NaN / 非数 → null (= 描画 skip 信号)。
  // maxV===minV → bottomPx (= 平坦値は下端、 0 除算回避、 NaN 返さない)。
  if (!isValidNumber(v)) return null;
  if (maxV === minV) return bottomPx;
  const ratio = (v - minV) / (maxV - minV);
  // 反転: ratio=0 (v=minV) → bottomPx、 ratio=1 (v=maxV) → topPx
  return bottomPx - ratio * (bottomPx - topPx);
}

export function createChartRenderer(canvas, buffer) {
  const ctx = canvas.getContext('2d');
  let disposed = false;

  function drawTimeRuler(width, ticks) {
    // ruler 帯 (y=0..18) の下端に tick の short tick + label を描く。
    ctx.fillStyle = '#bcd';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const leftPx = LEFT_LABEL_WIDTH_PX;
    const rightPx = width - RIGHT_UNIT_WIDTH_PX;
    const maxT = ticks[ticks.length - 1].t;
    const minT = ticks[0].t;
    for (const tick of ticks) {
      const x = sampleToCanvasX(tick.t, minT, maxT, leftPx, rightPx);
      ctx.fillText(tick.label, x + 2, TIME_RULER_HEIGHT_PX / 2);
    }
  }

  function drawSubchartBackground(spec, top, bottom, width, ticks) {
    // 横 grid 3 本 (= 上 / 中 / 下) と、 vertical grid (= ruler tick 位置) を薄く。
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const leftPx = LEFT_LABEL_WIDTH_PX;
    const rightPx = width - RIGHT_UNIT_WIDTH_PX;
    // horizontal
    for (let i = 0; i <= 2; i++) {
      const y = top + ((bottom - top) * i) / 2;
      ctx.beginPath();
      ctx.moveTo(leftPx, y);
      ctx.lineTo(rightPx, y);
      ctx.stroke();
    }
    // vertical (ruler tick 位置)
    if (ticks.length >= 2) {
      const maxT = ticks[ticks.length - 1].t;
      const minT = ticks[0].t;
      for (const tick of ticks) {
        const x = sampleToCanvasX(tick.t, minT, maxT, leftPx, rightPx);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
    }
  }

  function drawAvgLine(spec, avg, minV, maxV, top, bottom, width) {
    // 平均値の点線 (= 横一本)。
    const y = valueToCanvasY(avg, minV, maxV, top, bottom);
    if (y === null) return;
    ctx.strokeStyle = spec.avgColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const leftPx = LEFT_LABEL_WIDTH_PX;
    const rightPx = width - RIGHT_UNIT_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(leftPx, y);
    ctx.lineTo(rightPx, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPolyline(spec, samples, minT, maxT, minV, maxV, top, bottom, width) {
    // samples の field 値を polyline で描く。 null は path を切る (= moveTo)。
    const leftPx = LEFT_LABEL_WIDTH_PX;
    const rightPx = width - RIGHT_UNIT_WIDTH_PX;
    let anyDrawn = false;
    let started = false;
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const s of samples) {
      const v = s[spec.field];
      const y = valueToCanvasY(v, minV, maxV, top, bottom);
      if (y === null) {
        started = false; // path を切る
        continue;
      }
      const x = sampleToCanvasX(s.t, minT, maxT, leftPx, rightPx);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
        anyDrawn = true;
      }
    }
    if (anyDrawn) ctx.stroke();
  }

  function drawLabels(spec, max, avg, top, bottom, width, axisMin, axisMax) {
    // 左端: "ラベル名\n最大 N\n平均 N" を 3 行 fillText.
    // 右端: 上端に axisMax (= 縦軸上限) / 中段に 単位 / 下端に axisMin (= 縦軸下限).
    ctx.fillStyle = '#dfe';
    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const label = formatSubchartLabel(spec, max, avg);
    const lines = label.split('\n');
    const lineHeight = 14;  // 3 行 × 14px = 42px = sub-chart 50px に収まる
    const startY = top + 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 3, startY + i * lineHeight);
    }
    // 右端: 縦軸の上限/単位/下限 を 3 段表示 (= Strava 形式の y-axis 値ラベル).
    const rightX = width - RIGHT_UNIT_WIDTH_PX + 2;
    const maxStr = formatNumberForLabel(axisMax);
    const minStr = formatNumberForLabel(axisMin);
    ctx.fillStyle = '#bcd';
    ctx.fillText(maxStr, rightX, top + 2);  // 上端
    ctx.fillStyle = '#dfe';
    ctx.fillText(spec.unit, rightX, top + (bottom - top) / 2 - 6);  // 中段
    ctx.fillStyle = '#bcd';
    ctx.fillText(minStr, rightX, bottom - 13);  // 下端
  }

  return {
    render() {
      if (disposed) return;
      const width = canvas.width || 800;
      const height = canvas.height || CANVAS_HEIGHT_PX;
      // 1. clearRect
      ctx.clearRect(0, 0, width, height);

      const samples = buffer.get();
      const minT = buffer.minTime();
      const maxT = buffer.maxTime();

      // 2. time ruler
      const rulerInterval = maxT > 0 ? Math.max(1, Math.ceil(maxT / 10)) : 1;
      const ticks = formatTimeRulerTicks(maxT, rulerInterval);
      drawTimeRuler(width, ticks);

      // 3. 4 sub-chart
      const hasSamples = samples.length > 0;
      for (let i = 0; i < SUBCHART_SPECS.length; i++) {
        const spec = SUBCHART_SPECS[i];
        const subTop = TIME_RULER_HEIGHT_PX + i * (SUBCHART_HEIGHT_PX + SUBCHART_GAP_PX);
        const top = subTop + 2;
        const bottom = subTop + SUBCHART_HEIGHT_PX - 2;

        // 値の範囲 (= max は sample から、 min は常に 0 固定).
        // user 訂正「チャートの最下部が常にゼロ基準で計算されてない。 区間を飛んだ時に、
        // はじめから一定のスピードとかパワーが出てた場合、 チャートが下端に張り付くけど、
        // 下端はあくまでゼロにしてほしい」 反映。 minV を 0 で固定すれば、 一定値 v でも
        // 「0..v」 の縦軸で v 線は top 寄りに描かれ、 sample 内変動も「0 から伸びる graph」
        // として読める. hr/cadence/power/speed すべて 0 が物理的に意味ある下限なので 0 固定 OK.
        const minV = 0;
        let maxV = -Infinity;
        let hasValid = false;
        for (const s of samples) {
          const v = s[spec.field];
          if (isValidNumber(v)) {
            if (v > maxV) maxV = v;
            hasValid = true;
          }
        }

        const avg = buffer.avgOf(spec.field);
        const max = buffer.maxOf(spec.field);

        // ラベル (= 左端 + 右端、 polyline 有無に関わらず描く、 fillText のみで lineTo は呼ばない).
        // axisMin/Max は有効値ゼロ時 null (= '--' 表示) を formatNumberForLabel で処理.
        drawLabels(spec, max, avg, top, bottom, width, hasValid ? minV : null, hasValid ? maxV : null);

        if (!hasSamples) continue; // 空 buffer は背景 grid も含めて何も描かない (= ride 開始前の clean state)

        // 背景 grid (= 1 sample 以上ある時のみ)
        drawSubchartBackground(spec, top, bottom, width, ticks);

        if (!hasValid) continue; // sample あるが当該 metric が全 null → polyline skip

        // avg line
        drawAvgLine(spec, avg, minV, maxV, top, bottom, width);

        // polyline
        drawPolyline(spec, samples, minT, maxT, minV, maxV, top, bottom, width);
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
