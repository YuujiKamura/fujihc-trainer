// hud_chart_render.test.js ── render() の canvas 2D context 呼出を behavioral に pin.
// 純関数 test だけでは render 本体が空でも全 green になる (= misleading test、 catalog C2-c
// 再演 vector)、 本 file が render の behavioral 不在を物理 detect する gate。

import { describe, it, expect, vi } from 'vitest';
import { createChartRenderer } from '../lib/hud_chart.js';
import { createChartBuffer } from '../lib/hud_chart_buffer.js';

function fakeCanvas() {
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
  };
  return {
    canvas: { getContext: () => ctx, width: 800, height: 298 },
    ctx,
  };
}

describe('createChartRenderer.render() behavioral', () => {
  it('空 buffer → clearRect のみ呼ばれて folded line は描かれない (= ride 開始前の表示)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    const r = createChartRenderer(canvas, buf);
    r.render();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1); // 1 frame に 1 clear
    expect(ctx.lineTo).not.toHaveBeenCalled(); // sample ゼロなら線無し
  });

  it('1 sample 入り → 各 sub-chart で stroke が最低 4 回呼ばれる (= 4 metric が描かれる)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 10, power: 100, hr: 120, cadence: 80 });
    const r = createChartRenderer(canvas, buf);
    r.render();
    expect(ctx.stroke.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('10 sample 入り → lineTo が最低 36 回 (= 4 metric × 9 segments の物理 pin)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    for (let t = 0; t < 10; t++) {
      buf.push({ t, speed: t, power: t * 10, hr: 120 + t, cadence: 80 + t });
    }
    const r = createChartRenderer(canvas, buf);
    r.render();
    expect(ctx.lineTo.mock.calls.length).toBeGreaterThanOrEqual(36);
  });

  it('power/hr 全 null → lineTo は speed/cadence 分のみ (= 未接続 sensor は描かない)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    for (let t = 0; t < 5; t++) {
      buf.push({ t, speed: t, power: null, hr: null, cadence: t });
    }
    const r = createChartRenderer(canvas, buf);
    r.render();
    // speed/cadence 各 4 segments = 8 lineTo を含み、 grid 等で増えるが上限 50 未満。
    expect(ctx.lineTo.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(ctx.lineTo.mock.calls.length).toBeLessThan(50);
  });

  it('ラベル文字 (= スピード/パワー/心拍数/ケイデンス) + 単位が fillText で書かれる (= 左右ラベル col の physical pin)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 10, power: 100, hr: 120, cadence: 80 });
    const r = createChartRenderer(canvas, buf);
    r.render();
    const allText = ctx.fillText.mock.calls.map((c) => c[0]).join(' ');
    expect(allText).toContain('スピード');
    expect(allText).toContain('パワー');
    expect(allText).toContain('心拍数');
    expect(allText).toContain('ケイデンス');
    expect(allText).toContain('km/h');
    expect(allText).toContain('W');
    expect(allText).toContain('bpm');
    expect(allText).toContain('rpm');
  });

  it('dispose() 後 render() は no-op (= 解放後の memory leak 防止)', () => {
    const { canvas, ctx } = fakeCanvas();
    const buf = createChartBuffer();
    const r = createChartRenderer(canvas, buf);
    r.dispose();
    ctx.clearRect.mockClear();
    r.render();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });
});
