// brief 32: FTMS / HRM binary parser の port が bridge.py 挙動と一致するか.
import { describe, it, expect } from 'vitest';
import {
  parseIndoorBikeData,
  parseHeartRate,
  parseControlResponse,
  encodeSetIndoorBikeSimulation,
} from '../lib/ftms_parse.js';

function bytesToDv(arr) {
  const u8 = new Uint8Array(arr);
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

describe('parseIndoorBikeData', () => {
  it('flags=0x0044 + speed + cadence + power の happy path (= bridge.py L221 fake と同 binary)', () => {
    // flags=0x0044 (bit2=cadence, bit6=power, bit0=0 で speed プレゼント)
    // speed_raw = 25 km/h * 100 = 2500 = 0x09C4
    // cadence_raw = 85*2 = 170 = 0x00AA
    // power = 150 = 0x0096
    // little-endian: <HHHh: flags speed cadence power
    const out = parseIndoorBikeData(bytesToDv([
      0x44, 0x00,   // flags
      0xC4, 0x09,   // speed = 2500
      0xAA, 0x00,   // cadence = 170 (= 85 rpm)
      0x96, 0x00,   // power = 150
    ]));
    expect(out.speed_mps).toBeCloseTo(25 / 3.6, 5);
    expect(out.cadence_rpm).toBeCloseTo(85.0, 5);
    expect(out.power_w).toBe(150);
    expect(out.distance_m).toBeUndefined();
  });

  it('more_data flag set (bit0=1) で speed_mps が不在', () => {
    const out = parseIndoorBikeData(bytesToDv([
      0x01, 0x00,   // flags bit0 set
    ]));
    expect(out.speed_mps).toBeUndefined();
  });

  it('短すぎる payload (< 2 byte) は空 dict', () => {
    expect(parseIndoorBikeData(bytesToDv([]))).toEqual({});
    expect(parseIndoorBikeData(bytesToDv([0x44]))).toEqual({});
  });

  it('flags=0x0010 (distance のみ) で uint24 LE が decode される', () => {
    // flags=0x0010 (distance bit), bit0=1 (more_data) で speed skip
    // distance_raw bytes = 0x10 0x27 0x00 = 10000 m
    const out = parseIndoorBikeData(bytesToDv([
      0x11, 0x00,   // flags: more_data + distance
      0x10, 0x27, 0x00,
    ]));
    expect(out.distance_m).toBe(10000);
  });

  it('power_w は signed (= 負値を取り得る、 brake regen 等)', () => {
    // flags = 0x0041 (more_data + power), payload: power = -50 = 0xFFCE
    const out = parseIndoorBikeData(bytesToDv([
      0x41, 0x00,
      0xCE, 0xFF,
    ]));
    expect(out.power_w).toBe(-50);
  });
});

describe('parseHeartRate', () => {
  it('uint8 mode (bit0=0) で hr_bpm decode', () => {
    const out = parseHeartRate(bytesToDv([0x00, 75]));
    expect(out.hr_bpm).toBe(75);
  });

  it('uint16 mode (bit0=1) で hr_bpm decode', () => {
    // 280 bpm (= 16-bit が要る大値): 0x0118
    const out = parseHeartRate(bytesToDv([0x01, 0x18, 0x01]));
    expect(out.hr_bpm).toBe(280);
  });

  it('空 payload は空 dict', () => {
    expect(parseHeartRate(bytesToDv([]))).toEqual({});
  });
});

describe('parseControlResponse', () => {
  it('0x80 + req_op + result=0x01 (OK) → result_name="OK"', () => {
    const r = parseControlResponse(bytesToDv([0x80, 0x11, 0x01]));
    expect(r).not.toBeNull();
    expect(r.req_op).toBe(0x11);
    expect(r.result).toBe(0x01);
    expect(r.result_name).toBe('OK');
  });

  it('result=0x04 → "Operation-Failed"', () => {
    const r = parseControlResponse(bytesToDv([0x80, 0x07, 0x04]));
    expect(r.result_name).toBe('Operation-Failed');
  });

  it('Response Op Code が 0x80 でないと null', () => {
    expect(parseControlResponse(bytesToDv([0x7F, 0x11, 0x01]))).toBeNull();
  });

  it('payload が 3 byte 未満なら null', () => {
    expect(parseControlResponse(bytesToDv([0x80, 0x11]))).toBeNull();
  });
});

describe('encodeSetIndoorBikeSimulation', () => {
  it('gradePct=2.5 の hex が bridge.py と一致 (= opcode 0x11 + LE pack)', () => {
    // expected: opcode 0x11, wind=0 (0x0000), grade=250 (0x00FA LE = FA 00), crr_raw=40 (=0.004/0.0001), cw_raw=51 (=0.51/0.01)
    const out = encodeSetIndoorBikeSimulation(2.5);
    expect(Array.from(out)).toEqual([0x11, 0x00, 0x00, 0xFA, 0x00, 0x28, 0x33]);
  });

  it('clamp: 100.0 → +32.0, -100.0 → -32.0', () => {
    const hi = encodeSetIndoorBikeSimulation(100.0);
    // grade_raw = 3200 = 0x0C80 LE → 80 0C
    expect(hi[3]).toBe(0x80);
    expect(hi[4]).toBe(0x0C);
    const lo = encodeSetIndoorBikeSimulation(-100.0);
    // grade_raw = -3200 = 0xF380 (LE = 80 F3)
    expect(lo[3]).toBe(0x80);
    expect(lo[4]).toBe(0xF3);
  });

  it('default 引数 (wind=0, crr=0.004, cw=0.51) が bridge.py 規定値と一致', () => {
    const out = encodeSetIndoorBikeSimulation(0);
    expect(out[5]).toBe(0x28);   // 40
    expect(out[6]).toBe(0x33);   // 51
    expect(out[1]).toBe(0x00); expect(out[2]).toBe(0x00);  // wind=0
  });

  it('7 bytes 固定長で返る', () => {
    expect(encodeSetIndoorBikeSimulation(5.0).length).toBe(7);
  });
});
