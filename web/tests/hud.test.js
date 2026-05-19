// hud.js ── ライド HUD の整形と DOM 書き込みを pin する。
// 各 test は「落ちたら何の表示崩れを意味するか」を 1 行で言える形にする。

import { describe, it, expect } from 'vitest';
import {
  formatElapsed, formatSpeed, formatPower, formatCadence, formatHr,
  formatTrainerSpeed, formatAck, ACK_OK_COLOR, ACK_NG_COLOR, createHud,
} from '../lib/hud.js';

// id → fake 要素 を返す getEl。 textContent と style を持つ最小の偽要素。
function fakeDom() {
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      // style は実ブラウザ準拠で display/left/top を空文字初期化する。
      // riderHudVisible が位置 (left/top) を書き換えないことを「'' のまま」で
      // 検証できるようにするため (空オブジェクトだと undefined になり崩れる)。
      els.set(id, { id, textContent: '', style: { display: '', left: '', top: '' } });
    }
    return els.get(id);
  };
  return { getEl, els, text: (id) => getEl(id).textContent };
}

// === formatElapsed ===

describe('formatElapsed', () => {
  it('秒を HH:MM:SS に整形 (= 時刻表示の桁崩れを検出)', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(65)).toBe('00:01:05');
    expect(formatElapsed(3661)).toBe('01:01:01');
    expect(formatElapsed(7384)).toBe('02:03:04');
  });

  it('null は "00:00:00" (= ride 未開始、 沈黙 NaN を防ぐ)', () => {
    expect(formatElapsed(null)).toBe('00:00:00');
    expect(formatElapsed(undefined)).toBe('00:00:00');
  });

  it('負値は 00:00:00 に丸める (= 時計が負に走るのを防ぐ)', () => {
    expect(formatElapsed(-5)).toBe('00:00:00');
  });
});

// === formatSpeed ===

describe('formatSpeed', () => {
  it('走行中は "N km/h (bridge/demo)" (= 接続状態の取り違えを検出)', () => {
    expect(formatSpeed(25.4, { paused: false, connected: true })).toBe('25.4 km/h (bridge)');
    expect(formatSpeed(25.4, { paused: false, connected: false })).toBe('25.4 km/h (demo)');
  });

  it('paused 中は接続有無で「待機中」/「paused」', () => {
    expect(formatSpeed(0, { paused: true, connected: true })).toBe('待機中');
    expect(formatSpeed(0, { paused: true, connected: false })).toBe('paused');
  });
});

// === trainer 値の整形 (欠損は "--") ===

describe('formatPower / formatCadence / formatHr / formatTrainerSpeed', () => {
  it('happy: 数値をそのまま / 単位整形', () => {
    expect(formatPower(250)).toBe('250');
    expect(formatCadence(87.6)).toBe('88');          // rpm は整数へ
    expect(formatHr(145)).toBe('145');
    expect(formatTrainerSpeed(10)).toBe('36.0 km/h'); // m/s → km/h
  });

  it('欠損値 (null) は全て "--"', () => {
    expect(formatPower(null)).toBe('--');
    expect(formatCadence(null)).toBe('--');
    expect(formatHr(null)).toBe('--');
    expect(formatTrainerSpeed(null)).toBe('--');
  });

  it('境界: trainer 速度が負なら "--" (= センサ異常値を表示しない)', () => {
    expect(formatTrainerSpeed(-1)).toBe('--');
    expect(formatTrainerSpeed(0)).toBe('0.0 km/h');
  });
});

// === formatAck ===

describe('formatAck', () => {
  it('"OK" を含めば成功 (✓ + ok:true)', () => {
    expect(formatAck('slope OK')).toEqual({ text: '✓ slope OK', ok: true });
  });

  it('"OK" を含まなければ失敗 (✗ + ok:false)', () => {
    expect(formatAck('timeout')).toEqual({ text: '✗ timeout', ok: false });
  });
});

// === createHud ===

describe('createHud', () => {
  it('ride: elapsed/dist/ele/r-slope を整形して書く', () => {
    const dom = fakeDom();
    const hud = createHud(dom.getEl);
    hud.ride({ elapsedSec: 65, dist: 1234.7, ele: 1500.4, slope: 6.28 });
    expect(dom.text('elapsed')).toBe('00:01:05');
    expect(dom.text('dist')).toBe('1235');
    expect(dom.text('ele')).toBe('1500');
    expect(dom.text('r-slope')).toBe('6.3');
  });

  it('ride: elapsedSec=null は時刻 "00:00:00"', () => {
    const dom = fakeDom();
    createHud(dom.getEl).ride({ elapsedSec: null, dist: 0, ele: 0, slope: 0 });
    expect(dom.text('elapsed')).toBe('00:00:00');
  });

  it('total: コース総距離を #total に', () => {
    const dom = fakeDom();
    createHud(dom.getEl).total(23987.98);
    expect(dom.text('total')).toBe('23988');
  });

  it('speed: #r-speed (rider-hud の速度行) に物理速度の整形文字列', () => {
    const dom = fakeDom();
    createHud(dom.getEl).speed(25.4, { paused: false, connected: true });
    expect(dom.text('r-speed')).toBe('25.4 km/h (bridge)');
  });

  it('trainer: #power/#cadence/#hr と r-power/r-cadence/r-hr の 6 要素を書く', () => {
    const dom = fakeDom();
    createHud(dom.getEl).trainer({ powerW: 250, cadenceRpm: 87.6, hrBpm: 145 });
    expect(dom.text('power')).toBe('250');
    expect(dom.text('cadence')).toBe('88');
    expect(dom.text('hr')).toBe('145');
    expect(dom.text('r-power')).toBe('250');
    expect(dom.text('r-cadence')).toBe('88');
    expect(dom.text('r-hr')).toBe('145');
  });

  it('trainer: r-speed は書かない (= 物理速度は speed() の担当、 trainer 生速度で上書きしない)', () => {
    const dom = fakeDom();
    createHud(dom.getEl).trainer({ powerW: 250, cadenceRpm: 87.6, hrBpm: 145 });
    expect(dom.text('r-speed')).toBe('');
  });

  it('trainer: 欠損値は "--" で書かれる', () => {
    const dom = fakeDom();
    createHud(dom.getEl).trainer({ powerW: null, cadenceRpm: null, hrBpm: null });
    expect(dom.text('power')).toBe('--');
    expect(dom.text('r-hr')).toBe('--');
  });

  it('ack: 成功は緑、 失敗は赤 (= trainer 応答の成否色を検出)', () => {
    const dom = fakeDom();
    const hud = createHud(dom.getEl);
    hud.ack('slope OK');
    expect(dom.getEl('ack').textContent).toBe('✓ slope OK');
    expect(dom.getEl('ack').style.color).toBe(ACK_OK_COLOR);
    hud.ack('NG');
    expect(dom.getEl('ack').textContent).toBe('✗ NG');
    expect(dom.getEl('ack').style.color).toBe(ACK_NG_COLOR);
  });

  it('riderHudVisible: true で表示、 false で非表示 (CSS 固定位置は書き換えない)', () => {
    const dom = fakeDom();
    const hud = createHud(dom.getEl);
    const el = dom.getEl('rider-hud');
    hud.riderHudVisible(true);
    expect(el.style.display).toBe('block');
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
    hud.riderHudVisible(false);
    expect(el.style.display).toBe('none');
  });

  it('要素が無くても落ちない (= getEl が null を返す環境で no-op)', () => {
    const hud = createHud(() => null);
    expect(() => {
      hud.ride({ elapsedSec: 1, dist: 1, ele: 1, slope: 1 });
      hud.trainer({ powerW: 1, cadenceRpm: 1, hrBpm: 1 });
      hud.ack('OK');
      hud.riderHudVisible(true);
      hud.speed(1, { paused: false, connected: false });
      hud.total(1);
    }).not.toThrow();
  });
});
