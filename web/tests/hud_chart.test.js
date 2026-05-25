// hud_chart.test.js ── b99 chart renderer の純関数 test.
// 落ちたら何の表示崩れか を 1 行 コメント で pin (= hud.test.js 規律踏襲)。

import { describe, it, expect } from 'vitest';
import {
  SUBCHART_SPECS,
  SUBCHART_HEIGHT_PX,
  TIME_RULER_HEIGHT_PX,
  CANVAS_HEIGHT_PX,
  formatSubchartLabel,
  formatTimeRulerTicks,
  sampleToCanvasX,
  valueToCanvasY,
} from '../lib/hud_chart.js';

describe('formatSubchartLabel', () => {
  const speedSpec = SUBCHART_SPECS[0];

  it('数値が入っていれば 3 行ラベルを返す (= ride 中の通常表示)', () => {
    expect(formatSubchartLabel(speedSpec, 24.3, 12.8)).toBe('スピード\n最大 24.3\n平均 12.8');
  });

  it('max/avg 両方 null なら "--" が出る (= ride 開始前の有効値ゼロ表示)', () => {
    expect(formatSubchartLabel(speedSpec, null, null)).toBe('スピード\n最大 --\n平均 --');
  });

  it('max=null だけでも avg は数値を出す (= max/avg 独立判定、 互いに巻き添えにしない)', () => {
    expect(formatSubchartLabel(speedSpec, null, 12.8)).toBe('スピード\n最大 --\n平均 12.8');
  });
});

describe('formatTimeRulerTicks', () => {
  it('maxT=1800, tickInterval=200 → 10 tick で M:SS 形式 (= Strava 画面と一致)', () => {
    const ticks = formatTimeRulerTicks(1800, 200);
    expect(ticks).toHaveLength(10);
    expect(ticks[0]).toEqual({ t: 0, label: '0 秒' });
    expect(ticks[1]).toEqual({ t: 200, label: '3:20' });
    expect(ticks[9]).toEqual({ t: 1800, label: '30:00' });
  });

  it('maxT=0 なら最初の 1 tick のみ (= 空 chart の境界)', () => {
    expect(formatTimeRulerTicks(0, 200)).toEqual([{ t: 0, label: '0 秒' }]);
  });

  it('maxT=60, tickInterval=200 → 0 と 60 の 2 tick で M:SS (= 1 分以下の境界)', () => {
    const ticks = formatTimeRulerTicks(60, 200);
    expect(ticks).toEqual([
      { t: 0, label: '0 秒' },
      { t: 60, label: '1:00' },
    ]);
  });
});

describe('sampleToCanvasX', () => {
  it('中央値 (= t=10, range=0..20, px=100..700) → 400 (= 線形 mapping pin)', () => {
    expect(sampleToCanvasX(10, 0, 20, 100, 700)).toBe(400);
  });

  it('t<minT は leftPx に clamp (= 範囲外左を画面左端で止める)', () => {
    expect(sampleToCanvasX(-5, 0, 20, 100, 700)).toBe(100);
  });

  it('t>maxT は rightPx に clamp (= 範囲外右を画面右端で止める)', () => {
    expect(sampleToCanvasX(30, 0, 20, 100, 700)).toBe(700);
  });

  it('maxT===minT は leftPx を返す (= 0 除算回避、 ride 開始直後の同秒境界)', () => {
    expect(sampleToCanvasX(10, 10, 10, 100, 700)).toBe(100);
  });
});

describe('valueToCanvasY', () => {
  it('v=minV → bottomPx (= 値が小さいほど画面下、 反転 y axis)', () => {
    expect(valueToCanvasY(0, 0, 100, 10, 80)).toBe(80);
  });

  it('v=maxV → topPx (= 値が大きいほど画面上)', () => {
    expect(valueToCanvasY(100, 0, 100, 10, 80)).toBe(10);
  });

  it('v=null → null (= 描画 skip 信号、 未接続 sensor で path を切る)', () => {
    expect(valueToCanvasY(null, 0, 100, 10, 80)).toBeNull();
  });

  it('v=NaN → null (= NaN は描画 skip、 既存 it と重複だが NaN 独立 pin)', () => {
    expect(valueToCanvasY(NaN, 0, 100, 10, 80)).toBeNull();
  });

  it('v=undefined → null (= undefined も描画 skip、 schema 不完全 sample 防御)', () => {
    expect(valueToCanvasY(undefined, 0, 100, 10, 80)).toBeNull();
  });

  it('maxV===minV → bottomPx (= 平坦値は下端、 NaN 返さない、 ride 開始直後の power=[100,100,100] 等の境界)', () => {
    expect(valueToCanvasY(50, 100, 100, 0, 70)).toBe(70);
  });

  it('maxV===minV でも NaN を返さない (= 0 除算境界の physical pin)', () => {
    const y = valueToCanvasY(50, 100, 100, 0, 70);
    expect(Number.isNaN(y)).toBe(false);
  });
});

describe('SUBCHART_SPECS 順序 pin (= 「上から speed/power/hr/cadence」 の physical pin)', () => {
  it('4 sub-chart ある (= 完了条件 11 の数 pin)', () => {
    expect(SUBCHART_SPECS).toHaveLength(4);
  });

  it('SUBCHART_SPECS[0] は speed (= 順序逆転を physical 排除)', () => {
    expect(SUBCHART_SPECS[0].field).toBe('speed');
  });

  it('SUBCHART_SPECS[1] は power', () => {
    expect(SUBCHART_SPECS[1].field).toBe('power');
  });

  it('SUBCHART_SPECS[2] は hr', () => {
    expect(SUBCHART_SPECS[2].field).toBe('hr');
  });

  it('SUBCHART_SPECS[3] は cadence', () => {
    expect(SUBCHART_SPECS[3].field).toBe('cadence');
  });
});

describe('CANVAS_HEIGHT_PX 算式 pin (= マジックナンバー化防止)', () => {
  it('CANVAS_HEIGHT_PX === TIME_RULER_HEIGHT_PX + SUBCHART_HEIGHT_PX * 4', () => {
    expect(CANVAS_HEIGHT_PX).toBe(TIME_RULER_HEIGHT_PX + SUBCHART_HEIGHT_PX * 4);
    expect(CANVAS_HEIGHT_PX).toBe(14 + 52 * 4);
    expect(CANVAS_HEIGHT_PX).toBe(222);
  });
});
