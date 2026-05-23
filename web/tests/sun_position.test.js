// b75: sun_position.js 純関数のユニットテスト.
//
// computeSolarPosition の天文学的正しさを NOAA 基準値 (= 富士山中心、 各季節 / 時間帯) で
// pin、 computeSunDirVec の座標変換を viewer SoT (東+X / 上+Y / 北-Z) で pin、
// parseDatetimeFromUrl の入力検証を 5 ケース (happy / null / offset 欠落 / Invalid Date /
// 非 URLSearchParams) で pin。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeSolarPosition,
  computeSunDirVec,
  parseDatetimeFromUrl,
} from '../lib/weather/sun_position.js';

// 富士山中心 (= b75 観測点 SoT)
const FUJI_LAT = 35.36;
const FUJI_LON = 138.72;

describe('computeSolarPosition (= NOAA 太陽位置算法)', () => {
  it('夏至 12:00 JST 富士山中心: elevation ≈ 78°、 azimuth ≈ 真南やや西 (185-205°)', () => {
    // 2026-06-21 12:00 JST = 03:00 UTC。
    // 富士山は東経 138.72° で日本標準時 (= 東経 135°) より 14.9 分東、 さらに夏至前後の
    // 均時差 ≈ -1.5 min → 真太陽時 ≈ 12.22 hour で南中過ぎ、 azimuth は真南 180° から
    // 約 14° 西寄り (= ≈ 194°)、 物理現実に合致。 期待 range 185-205° で許容 ±10°。
    const date = new Date('2026-06-21T12:00:00+09:00');
    const { azimuthDeg, elevationDeg } = computeSolarPosition({
      lat: FUJI_LAT, lon: FUJI_LON, dateJst: date,
    });
    expect(elevationDeg).toBeGreaterThanOrEqual(75);
    expect(elevationDeg).toBeLessThanOrEqual(80);
    expect(azimuthDeg).toBeGreaterThanOrEqual(185);
    expect(azimuthDeg).toBeLessThanOrEqual(205);
  });

  it('夏至 05:00 JST: 朝の太陽 (北東〜東、 elevation 5-20°)', () => {
    const date = new Date('2026-06-21T05:00:00+09:00');
    const { azimuthDeg, elevationDeg } = computeSolarPosition({
      lat: FUJI_LAT, lon: FUJI_LON, dateJst: date,
    });
    expect(elevationDeg).toBeGreaterThan(0);
    expect(elevationDeg).toBeLessThanOrEqual(20);
    expect(azimuthDeg).toBeGreaterThanOrEqual(55);
    expect(azimuthDeg).toBeLessThanOrEqual(85);
  });

  it('夏至 18:30 JST: 夕の太陽 (西〜北西、 elevation 5-20°)', () => {
    const date = new Date('2026-06-21T18:30:00+09:00');
    const { azimuthDeg, elevationDeg } = computeSolarPosition({
      lat: FUJI_LAT, lon: FUJI_LON, dateJst: date,
    });
    expect(elevationDeg).toBeGreaterThan(0);
    expect(elevationDeg).toBeLessThanOrEqual(20);
    expect(azimuthDeg).toBeGreaterThanOrEqual(275);
    expect(azimuthDeg).toBeLessThanOrEqual(305);
  });

  it('冬至 12:00 JST 富士山中心: elevation ≈ 25-35° (冬至は低い)、 azimuth ≈ 真南', () => {
    const date = new Date('2026-12-22T12:00:00+09:00');
    const { azimuthDeg, elevationDeg } = computeSolarPosition({
      lat: FUJI_LAT, lon: FUJI_LON, dateJst: date,
    });
    expect(elevationDeg).toBeGreaterThanOrEqual(25);
    expect(elevationDeg).toBeLessThanOrEqual(35);
    expect(azimuthDeg).toBeGreaterThanOrEqual(175);
    expect(azimuthDeg).toBeLessThanOrEqual(185);
  });

  it('夏至 02:00 JST: 夜 (地平線下 = elevation < 0)', () => {
    const date = new Date('2026-06-21T02:00:00+09:00');
    const { elevationDeg } = computeSolarPosition({
      lat: FUJI_LAT, lon: FUJI_LON, dateJst: date,
    });
    expect(elevationDeg).toBeLessThan(0);
  });

  it('error: lat が非数 → throw TypeError', () => {
    const date = new Date('2026-06-21T12:00:00+09:00');
    expect(() => computeSolarPosition({ lat: NaN, lon: FUJI_LON, dateJst: date })).toThrow(TypeError);
    expect(() => computeSolarPosition({ lat: 'foo', lon: FUJI_LON, dateJst: date })).toThrow(TypeError);
    expect(() => computeSolarPosition({ lat: undefined, lon: FUJI_LON, dateJst: date })).toThrow(TypeError);
  });

  it('error: dateJst が Date 以外 (string / null / number) → throw TypeError', () => {
    expect(() => computeSolarPosition({ lat: FUJI_LAT, lon: FUJI_LON, dateJst: '2026-06-21' })).toThrow(TypeError);
    expect(() => computeSolarPosition({ lat: FUJI_LAT, lon: FUJI_LON, dateJst: null })).toThrow(TypeError);
    expect(() => computeSolarPosition({ lat: FUJI_LAT, lon: FUJI_LON, dateJst: 1234567890 })).toThrow(TypeError);
  });

  it('error: dateJst が Invalid Date → throw TypeError', () => {
    expect(() => computeSolarPosition({ lat: FUJI_LAT, lon: FUJI_LON, dateJst: new Date('not-a-date') })).toThrow(TypeError);
  });
});

describe('computeSunDirVec (= viewer 座標系への変換、 SoT pin)', () => {
  const EPS = 1e-6;

  it('天頂 (az=180, el=90) → (0, 1, 0)', () => {
    const v = computeSunDirVec({ azimuthDeg: 180, elevationDeg: 90 });
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('東水平 (az=90, el=0) → (1, 0, 0)', () => {
    const v = computeSunDirVec({ azimuthDeg: 90, elevationDeg: 0 });
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('北水平 (az=0, el=0) → (0, 0, -1)', () => {
    const v = computeSunDirVec({ azimuthDeg: 0, elevationDeg: 0 });
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(-1, 6);
  });

  it('南水平 (az=180, el=0) → (0, 0, +1)', () => {
    const v = computeSunDirVec({ azimuthDeg: 180, elevationDeg: 0 });
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(1, 6);
  });

  it('戻り値は plain object (THREE.Vector3 ではない)', () => {
    const v = computeSunDirVec({ azimuthDeg: 135, elevationDeg: 45 });
    expect(v).toEqual({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
    // THREE.Vector3 由来のメソッド (normalize / dot / cross) を持たないことを確認
    expect(v.normalize).toBeUndefined();
    expect(v.dot).toBeUndefined();
  });

  it('正規化されている (= 長さ ≈ 1)', () => {
    const v = computeSunDirVec({ azimuthDeg: 135, elevationDeg: 45 });
    const len = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
    expect(len).toBeCloseTo(1, 6);
  });
});

describe('parseDatetimeFromUrl (= URL gate 入力検証)', () => {
  let warnSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('happy: ISO 8601 with +09:00 offset → Date 返却', () => {
    const params = new URLSearchParams('datetime=2026-06-21T05:30:00%2B09:00');
    const d = parseDatetimeFromUrl(params);
    expect(d).toBeInstanceOf(Date);
    expect(d.getTime()).toBe(new Date('2026-06-21T05:30:00+09:00').getTime());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('happy: Z 末尾 (UTC) → Date 返却', () => {
    const params = new URLSearchParams('datetime=2026-06-21T05:30:00Z');
    const d = parseDatetimeFromUrl(params);
    expect(d).toBeInstanceOf(Date);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('null / 未指定 → null 返却、 warn なし', () => {
    expect(parseDatetimeFromUrl(null)).toBeNull();
    expect(parseDatetimeFromUrl(undefined)).toBeNull();
    const params = new URLSearchParams('foo=bar');
    expect(parseDatetimeFromUrl(params)).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('error: offset 欠落 (naive datetime) → null + warn', () => {
    const params = new URLSearchParams('datetime=2026-06-21T05:30:00');
    expect(parseDatetimeFromUrl(params)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/offset/);
  });

  it('error: Invalid Date 形式 → null + warn', () => {
    const params = new URLSearchParams('datetime=not-a-date');
    expect(parseDatetimeFromUrl(params)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('error: 非 URLSearchParams (= get メソッド非保有) → null、 warn なし', () => {
    expect(parseDatetimeFromUrl({})).toBeNull();
    expect(parseDatetimeFromUrl('foo')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
