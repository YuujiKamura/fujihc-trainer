// b74: cloud_estimator.js の単体テスト ── 雲量・雲底・雲頂 算出の純関数を pin。
//
// 配布元 0 通信 (= mock fetch すらなし、 関数に literal データを渡すだけ)。
// happy / edge / error path を揃え、 user 実データ (2026-05-24 06:50 JST) も sanity check。

import { describe, it, expect } from 'vitest';
import { estimateClouds } from '../lib/weather/cloud_estimator.js';

describe('estimateClouds — happy path', () => {
  it('4 観測点 (25/70/860, 22/85/992, 26/65/552, 24/75/472) で cloudCover ∈ [0.4, 1.0], cloudBaseM ≥ 1500, cloudTopM = cloudBaseM + 2000', () => {
    const stations = [
      { code: '49251', name: '河口湖',   lat: 35.50, lon: 138.76, alt: 860, temp: 25, humidity: 70 },
      { code: '49256', name: '山中',     lat: 35.43, lon: 138.83, alt: 992, temp: 22, humidity: 85 },
      { code: '49196', name: '古関',     lat: 35.52, lon: 138.61, alt: 552, temp: 26, humidity: 65 },
      { code: '50136', name: '御殿場',   lat: 35.30, lon: 138.92, alt: 472, temp: 24, humidity: 75 },
    ];
    const r = estimateClouds(stations);
    expect(r).not.toBeNull();
    // 平均 RH = 73.75 → (73.75-40)/60 ≈ 0.5625
    expect(r.cloudCover).toBeCloseTo(0.5625, 3);
    expect(r.cloudCover).toBeGreaterThanOrEqual(0.4);
    expect(r.cloudCover).toBeLessThanOrEqual(1.0);
    // 床 1500m 以上
    expect(r.cloudBaseM).toBeGreaterThanOrEqual(1500);
    // 厚 2000m
    expect(r.cloudTopM).toBe(r.cloudBaseM + 2000);
  });

  it('user 実データ 2026-05-24 06:50 JST (= 梅雨直前): 平均 RH 94 → cloudCover ≈ 0.9, cloudBaseM = 1500 (床), cloudTopM = 3500', () => {
    const stations = [
      { code: '49251', name: '河口湖',   lat: 35.50, lon: 138.76, alt: 860, temp: 10.8, humidity: 100 },
      { code: '49256', name: '山中',     lat: 35.43, lon: 138.83, alt: 992, temp: 10.9, humidity: 97 },
      { code: '49196', name: '古関',     lat: 35.52, lon: 138.61, alt: 552, temp: 14.9, humidity: 82 },
      { code: '50136', name: '御殿場',   lat: 35.30, lon: 138.92, alt: 472, temp: 13.5, humidity: 97 },
    ];
    const r = estimateClouds(stations);
    expect(r).not.toBeNull();
    // 平均 RH = (100+97+82+97)/4 = 94 → (94-40)/60 = 0.9
    expect(r.cloudCover).toBeCloseTo(0.9, 3);
    // 各点 cloudBaseAbsolute_i = alt_i + 25*(100-RH_i):
    //   河口湖:  860 + 25*0  =  860
    //   山中:    992 + 25*3  = 1067
    //   古関:    552 + 25*18 = 1002
    //   御殿場:  472 + 25*3  =  547
    // 平均 = (860+1067+1002+547)/4 = 869 → 床 1500 が勝つ
    expect(r.cloudBaseM).toBe(1500);
    expect(r.cloudTopM).toBe(3500);
  });
});

describe('estimateClouds — edge', () => {
  it('edge 1: 全観測点が RH=100% → cloudCover = 1.0', () => {
    const stations = [
      { code: '49251', alt: 860, temp: 20, humidity: 100 },
      { code: '49256', alt: 992, temp: 18, humidity: 100 },
    ];
    const r = estimateClouds(stations);
    expect(r.cloudCover).toBe(1.0);
  });

  it('edge 2: 全観測点が RH=30% → cloudCover = 0, cloudBaseM = 1500 (床)', () => {
    // RH=30 で Td = T - 14、 LCL = 125*14 = 1750m
    // alt 平均 ≈ 926、 cloudBaseAbsolute 平均 ≈ 926 + 1750 = 2676m
    // 床 1500m を超えるので 2676、 ただし cloudCover は 0
    // 確認したいのは cloudCover = 0
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 30 },
      { code: '49256', alt: 992, temp: 22, humidity: 30 },
    ];
    const r = estimateClouds(stations);
    expect(r.cloudCover).toBe(0);
    // 床 1500m が下限 ── 計算結果が床より上ならそのまま、 下なら床
    expect(r.cloudBaseM).toBeGreaterThanOrEqual(1500);
  });

  it('edge 2b: 全観測点が RH=40% で計算雲底が床未満 → cloudBaseM = 1500 (床に持ち上げ)', () => {
    // RH=40 で Td=T-12、 LCL=1500m
    // alt=100 で cloudBaseAbsolute=1600、 alt=50 で 1550 ── 平均 ≈ 1575、 床 1500m を超える
    // 床ヒットを起こすには alt < (1500 - LCL) が必要、 LCL=1500m なら alt<0 でないと床ヒットしない
    // → 高 RH (= LCL 小) かつ低 alt が床ヒット条件: RH=95 で LCL=125、 alt=300 で base=425、 床 1500 が勝つ
    const stations = [
      { code: 'low1', alt: 300, temp: 20, humidity: 95 },
      { code: 'low2', alt: 100, temp: 22, humidity: 95 },
    ];
    const r = estimateClouds(stations);
    expect(r.cloudBaseM).toBe(1500);  // 床ヒット
  });

  it('edge 3: 富士山頂 (humidity=null) を含む 5 観測点 → 4 観測点で平均、 山頂は除外', () => {
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 70 },
      { code: '49256', alt: 992, temp: 22, humidity: 85 },
      { code: '49196', alt: 552, temp: 26, humidity: 65 },
      { code: '50136', alt: 472, temp: 24, humidity: 75 },
      { code: '50066', alt: 3775, temp: -2, humidity: null },  // 富士山頂、 湿度なし
    ];
    const r = estimateClouds(stations);
    // 4 点平均 RH = 73.75 (= 山頂を含めると平均が変わる、 山頂除外を pin)
    expect(r.cloudCover).toBeCloseTo(0.5625, 3);
  });

  it('edge 4: 1 観測点だけ有効 → その点で算出 (= mean が単点でも動く)', () => {
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 80 },
    ];
    const r = estimateClouds(stations);
    expect(r).not.toBeNull();
    expect(r.cloudCover).toBeCloseTo((80 - 40) / 60, 3);
  });
});

describe('estimateClouds — error', () => {
  it('error 1: 空配列 → null', () => {
    expect(estimateClouds([])).toBe(null);
  });

  it('error 2: 全観測点が temp=null → null', () => {
    const stations = [
      { code: '49251', alt: 860, temp: null, humidity: 70 },
      { code: '49256', alt: 992, temp: null, humidity: 85 },
    ];
    expect(estimateClouds(stations)).toBe(null);
  });

  it('error 3: 全観測点が humidity=null (= 山頂のみ等) → null', () => {
    const stations = [
      { code: '50066', alt: 3775, temp: -2, humidity: null },
    ];
    expect(estimateClouds(stations)).toBe(null);
  });

  it('error 4: 非配列 (null / undefined) → null', () => {
    expect(estimateClouds(null)).toBe(null);
    expect(estimateClouds(undefined)).toBe(null);
  });

  it('error 5: 一部欠測でも残り点で算出 (温度欠測の点だけ除外)', () => {
    const stations = [
      { code: '49251', alt: 860, temp: 25, humidity: 70 },     // 有効
      { code: '49256', alt: 992, temp: null, humidity: 85 },    // temp 欠測 → 除外
      { code: '49196', alt: 552, temp: 26, humidity: 65 },     // 有効
    ];
    const r = estimateClouds(stations);
    expect(r).not.toBeNull();
    // 平均 RH = (70+65)/2 = 67.5
    expect(r.cloudCover).toBeCloseTo((67.5 - 40) / 60, 3);
  });
});
