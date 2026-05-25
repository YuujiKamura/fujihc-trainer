// hud_chart_buffer.js ── chart 用時系列バッファの純データ層を pin する。
// 各 test は「落ちたら画面で何が起きるか」を 1 行コメントで言える形にする。

import { describe, it, expect } from 'vitest';
import {
  createChartBuffer,
  pushSample,
  avgInRange,
  maxInRange,
  decideChartPush,
} from '../lib/hud_chart_buffer.js';

// === createChartBuffer factory ===

describe('createChartBuffer factory', () => {
  it('戻り値は 7 method (push/get/clear/avgOf/maxOf/minTime/maxTime) を持つ (= API 欠落で chart panel 全滅)', () => {
    const buf = createChartBuffer();
    expect(typeof buf.push).toBe('function');
    expect(typeof buf.get).toBe('function');
    expect(typeof buf.clear).toBe('function');
    expect(typeof buf.avgOf).toBe('function');
    expect(typeof buf.maxOf).toBe('function');
    expect(typeof buf.minTime).toBe('function');
    expect(typeof buf.maxTime).toBe('function');
  });

  it('push した sample が get() の先頭に deep equal で出る (= sample が読み出せないと chart 線が描けない)', () => {
    const buf = createChartBuffer();
    const sample = { t: 0, speed: 10, power: 100, hr: 120, cadence: 80 };
    buf.push(sample);
    expect(buf.get()[0]).toEqual(sample);
  });

  it('100 sample 連続 push で length=100、 minTime=0、 maxTime=99 (= 配列 append、 ring で先頭が消える事故防止)', () => {
    const buf = createChartBuffer();
    for (let i = 0; i < 100; i += 1) {
      buf.push({ t: i, speed: i, power: i, hr: i, cadence: i });
    }
    expect(buf.get().length).toBe(100);
    expect(buf.minTime()).toBe(0);
    expect(buf.maxTime()).toBe(99);
  });

  it('clear() 後 length=0、 minTime=0、 maxTime=0 (= ride 跨ぎで前 ride の sample が残ると chart に幽霊線が出る)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 10, power: 100, hr: 120, cadence: 80 });
    buf.push({ t: 1, speed: 11, power: 110, hr: 121, cadence: 81 });
    buf.clear();
    expect(buf.get().length).toBe(0);
    expect(buf.minTime()).toBe(0);
    expect(buf.maxTime()).toBe(0);
  });
});

// === avgOf ===

describe('avgOf', () => {
  it('空 buffer → null (= ride 開始前画面に NaN W が表示されるのを止める)', () => {
    const buf = createChartBuffer();
    expect(buf.avgOf('power')).toBeNull();
  });

  it('power=[100,200,300] → 200 (= 単純平均、 chart の「平均」 表示の SoT)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 0, power: 100, hr: 0, cadence: 0 });
    buf.push({ t: 1, speed: 0, power: 200, hr: 0, cadence: 0 });
    buf.push({ t: 2, speed: 0, power: 300, hr: 0, cadence: 0 });
    expect(buf.avgOf('power')).toBe(200);
  });

  it('power=[100,null,200,NaN,300] → 200 (= null/NaN 除外、 sensor 未接続期を 0 で薄めない)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 0, power: 100, hr: 0, cadence: 0 });
    buf.push({ t: 1, speed: 0, power: null, hr: 0, cadence: 0 });
    buf.push({ t: 2, speed: 0, power: 200, hr: 0, cadence: 0 });
    buf.push({ t: 3, speed: 0, power: NaN, hr: 0, cadence: 0 });
    buf.push({ t: 4, speed: 0, power: 300, hr: 0, cadence: 0 });
    expect(buf.avgOf('power')).toBe(200);
  });

  it('power=[null,null,null] → null (= 有効値ゼロで NaN/0 を返さない物理 gate)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 0, power: null, hr: 0, cadence: 0 });
    buf.push({ t: 1, speed: 0, power: null, hr: 0, cadence: 0 });
    buf.push({ t: 2, speed: 0, power: null, hr: 0, cadence: 0 });
    expect(buf.avgOf('power')).toBeNull();
  });
});

// === maxOf ===

describe('maxOf', () => {
  it('空 buffer → null (= 「最大」 表示が NaN にならない)', () => {
    const buf = createChartBuffer();
    expect(buf.maxOf('hr')).toBeNull();
  });

  it('hr=[120,150,145] → 150 (= 単純最大、 chart の「最大」 表示の SoT)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 0, power: 0, hr: 120, cadence: 0 });
    buf.push({ t: 1, speed: 0, power: 0, hr: 150, cadence: 0 });
    buf.push({ t: 2, speed: 0, power: 0, hr: 145, cadence: 0 });
    expect(buf.maxOf('hr')).toBe(150);
  });

  it('hr=[120,null,200,NaN,145] → 200 (= null/NaN 除外でも 200 を拾える)', () => {
    const buf = createChartBuffer();
    buf.push({ t: 0, speed: 0, power: 0, hr: 120, cadence: 0 });
    buf.push({ t: 1, speed: 0, power: 0, hr: null, cadence: 0 });
    buf.push({ t: 2, speed: 0, power: 0, hr: 200, cadence: 0 });
    buf.push({ t: 3, speed: 0, power: 0, hr: NaN, cadence: 0 });
    buf.push({ t: 4, speed: 0, power: 0, hr: 145, cadence: 0 });
    expect(buf.maxOf('hr')).toBe(200);
  });
});

// === pushSample 入力検証 ===

describe('pushSample 入力検証', () => {
  it('t<0 → push されない (= 負の経過秒で chart が左端より外に描かれる事故防止)', () => {
    const buf = createChartBuffer();
    pushSample(buf, -1, { speed: 10, power: 100, hr: 120, cadence: 80 });
    expect(buf.get().length).toBe(0);
  });

  it('t=NaN → push されない (= NaN sample が chart の time 軸を壊さない)', () => {
    const buf = createChartBuffer();
    pushSample(buf, NaN, { speed: 10, power: 100, hr: 120, cadence: 80 });
    expect(buf.get().length).toBe(0);
  });

  it('t=undefined → push されない (= 入力欠落で sample 列が壊れない)', () => {
    const buf = createChartBuffer();
    pushSample(buf, undefined, { speed: 10, power: 100, hr: 120, cadence: 80 });
    expect(buf.get().length).toBe(0);
  });

  it('正常値 → push される (= 正常 path で sample が積まれないと chart 全滅)', () => {
    const buf = createChartBuffer();
    pushSample(buf, 5, { speed: 10, power: 100, hr: 120, cadence: 80 });
    expect(buf.get().length).toBe(1);
    expect(buf.get()[0]).toEqual({ t: 5, speed: 10, power: 100, hr: 120, cadence: 80 });
  });
});

// === avgInRange ===

describe('avgInRange', () => {
  const samples = [
    { t: 0, speed: 0, power: 50, hr: 100, cadence: 60 },
    { t: 10, speed: 0, power: 100, hr: 120, cadence: 70 },
    { t: 15, speed: 0, power: 200, hr: 140, cadence: 80 },
    { t: 20, speed: 0, power: 300, hr: 160, cadence: 90 },
    { t: 30, speed: 0, power: 400, hr: 180, cadence: 100 },
  ];

  it('範囲内 sample のみで avg、 範囲外 skip (= 範囲指定 avg 線がずれる事故防止)', () => {
    // t=10..20 の power = [100, 200, 300]、 avg = 200
    expect(avgInRange(samples, 'power', 10, 20)).toBe(200);
  });

  it('空 samples → null (= ride 開始前の範囲 avg が NaN にならない)', () => {
    expect(avgInRange([], 'power', 0, 100)).toBeNull();
  });

  it('範囲内 sample 0 件 → null (= 該当区間に sample が無い時 chart の値表示が NaN にならない)', () => {
    expect(avgInRange(samples, 'power', 100, 200)).toBeNull();
  });

  it('範囲内が全 null → null (= 該当区間が sensor 未接続でも 0 平均で薄まらない)', () => {
    const nullSamples = [
      { t: 10, power: null },
      { t: 15, power: NaN },
      { t: 20, power: null },
    ];
    expect(avgInRange(nullSamples, 'power', 10, 20)).toBeNull();
  });

  it('tStart > tEnd 逆順 → null (= 範囲逆転で undefined 動作を起こさない防御)', () => {
    expect(avgInRange(samples, 'power', 20, 10)).toBeNull();
  });

  it('tStart === tEnd で該当 1 件 → その値 (= 1 点だけの範囲指定が壊れない)', () => {
    expect(avgInRange(samples, 'power', 15, 15)).toBe(200);
  });
});

// === maxInRange ===

describe('maxInRange', () => {
  const samples = [
    { t: 0, speed: 0, power: 50, hr: 100, cadence: 60 },
    { t: 10, speed: 0, power: 100, hr: 120, cadence: 70 },
    { t: 15, speed: 0, power: 200, hr: 140, cadence: 80 },
    { t: 20, speed: 0, power: 300, hr: 160, cadence: 90 },
    { t: 30, speed: 0, power: 400, hr: 180, cadence: 100 },
  ];

  it('範囲内 sample のみで max、 範囲外 skip (= 範囲指定 max 線がずれる事故防止)', () => {
    // t=10..20 の power = [100, 200, 300]、 max = 300
    expect(maxInRange(samples, 'power', 10, 20)).toBe(300);
  });

  it('空 samples → null (= ride 開始前の範囲 max が NaN にならない)', () => {
    expect(maxInRange([], 'power', 0, 100)).toBeNull();
  });

  it('範囲内 sample 0 件 → null (= 該当区間に sample が無い時 NaN にならない)', () => {
    expect(maxInRange(samples, 'power', 100, 200)).toBeNull();
  });

  it('範囲内が全 null → null (= 該当区間が全 sensor 未接続で max が undefined にならない)', () => {
    const nullSamples = [
      { t: 10, power: null },
      { t: 15, power: NaN },
      { t: 20, power: null },
    ];
    expect(maxInRange(nullSamples, 'power', 10, 20)).toBeNull();
  });

  it('tStart > tEnd 逆順 → null (= 範囲逆転で undefined 動作を起こさない防御)', () => {
    expect(maxInRange(samples, 'power', 20, 10)).toBeNull();
  });

  it('tStart === tEnd で該当 1 件 → その値 (= 1 点だけの範囲指定で max がその値になる)', () => {
    expect(maxInRange(samples, 'power', 15, 15)).toBe(200);
  });
});

// === decideChartPush ===

describe('decideChartPush', () => {
  it('paused=true → push せず lastPushSec 維持 (= paused 中 sample 蓄積で chart が止まって見えない事故防止)', () => {
    const result = decideChartPush({
      paused: true,
      elapsedSec: 10,
      lastPushSec: -1,
      snapshot: { speed: 25, power: 200, hr: 140, cadence: 85 },
    });
    expect(result).toEqual({ push: false, sample: null, nextLastPushSec: -1 });
  });

  it('paused=false、 elapsedSec=10.5、 lastPushSec=10 → 同秒内 throttle、 push しない (= 1 sec に複数 sample 入れて chart が震えない)', () => {
    const result = decideChartPush({
      paused: false,
      elapsedSec: 10.5,
      lastPushSec: 10,
      snapshot: { speed: 25, power: 200, hr: 140, cadence: 85 },
    });
    expect(result).toEqual({ push: false, sample: null, nextLastPushSec: 10 });
  });

  it('paused=false、 elapsedSec=11.0、 lastPushSec=10 → push、 t=11 (= 整数秒境界で確実に進む)', () => {
    const result = decideChartPush({
      paused: false,
      elapsedSec: 11.0,
      lastPushSec: 10,
      snapshot: { speed: 25, power: 200, hr: 140, cadence: 85 },
    });
    expect(result).toEqual({
      push: true,
      sample: { t: 11, speed: 25, power: 200, hr: 140, cadence: 85 },
      nextLastPushSec: 11,
    });
  });

  it('paused=false、 elapsedSec=11.7、 lastPushSec=10 → push、 t=11 (= Math.floor 規律、 t が小数で chart 軸が崩れない)', () => {
    const result = decideChartPush({
      paused: false,
      elapsedSec: 11.7,
      lastPushSec: 10,
      snapshot: { speed: 25, power: 200, hr: 140, cadence: 85 },
    });
    expect(result).toEqual({
      push: true,
      sample: { t: 11, speed: 25, power: 200, hr: 140, cadence: 85 },
      nextLastPushSec: 11,
    });
  });

  it('elapsedSec<0 → push せず lastPushSec 維持 (= 経過秒が負で chart に幽霊 sample が乗らない)', () => {
    const result = decideChartPush({
      paused: false,
      elapsedSec: -5,
      lastPushSec: 10,
      snapshot: { speed: 25, power: 200, hr: 140, cadence: 85 },
    });
    expect(result).toEqual({ push: false, sample: null, nextLastPushSec: 10 });
  });
});
