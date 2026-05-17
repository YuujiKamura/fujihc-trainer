// brief b-segment-labels / b9: 道路の勾配色セグメント上に載せる「距離 + 勾配」ラベルの
// pure functions (formatSegmentLabel / buildSegmentLabels) を pin する。
//
// formatSegmentLabel = 距離(m)+勾配(%) → 表示文字列 (距離は実値、 偽の丸めはしない)。
// buildSegmentLabels = 勾配色 Polygon FeatureCollection を約 intervalM 間隔のラベル
//   点列にする。 各 intervalM 目標点に最も近いセグメントを 1 つ選ぶ。 ラベルが指す
//   距離 / 勾配は選ばれたセグメントの実値。 中点座標と方位 (bearing) も持つ。

import { describe, it, expect } from 'vitest';
import { formatSegmentLabel, buildSegmentLabels } from '../lib/segment_labels.js';

// road_polygon.js の Polygon ring 形 [aLeft,bLeft,bRight,aRight,aLeft] を、
// セグメント始点 a / 終点 b ([lon,lat]) から作る。 左右 offset の向きは
// segmentGeometry が a/b に平均で畳むため bearing/中点には影響しない。
function seg(distance_m_start, slope_pct, a = [138.7, 35.4], b = [138.7, 35.41]) {
  const off = 0.0001;
  const ring = [
    [a[0] - off, a[1]], // aLeft
    [b[0] - off, b[1]], // bLeft
    [b[0] + off, b[1]], // bRight
    [a[0] + off, a[1]], // aRight
    [a[0] - off, a[1]],
  ];
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      distance_m_start,
      distance_m_end: distance_m_start === null ? null : distance_m_start + 100,
      slope_pct,
    },
  };
}
function fc(features) {
  return { type: 'FeatureCollection', features };
}

describe('formatSegmentLabel — 距離+勾配の表示文字列', () => {
  it('通常: 2400m / 6.7% → "2.40km / 6.7%"', () => {
    expect(formatSegmentLabel(2400, 6.7)).toBe('2.40km / 6.7%');
  });

  it('距離は実値を 2 桁 km で出す (= 1437m → "1.44km"、 切りの良い偽値にしない)', () => {
    expect(formatSegmentLabel(1437, 6.7)).toBe('1.44km / 6.7%');
  });

  it('0 / 0 → "0.00km / 0.0%"', () => {
    expect(formatSegmentLabel(0, 0)).toBe('0.00km / 0.0%');
  });

  it('負勾配 (下り): -1.2% を素直に出す', () => {
    expect(formatSegmentLabel(5000, -1.2)).toBe('5.00km / -1.2%');
  });

  it('端数丸め: 1234m → "1.23km"、 5.67% → "5.7%"', () => {
    expect(formatSegmentLabel(1234, 5.67)).toBe('1.23km / 5.7%');
  });

  it('1km 未満: 240m → "0.24km"', () => {
    expect(formatSegmentLabel(240, 3)).toBe('0.24km / 3.0%');
  });

  it('null 入力は 0 扱い', () => {
    expect(formatSegmentLabel(null, null)).toBe('0.00km / 0.0%');
  });

  it('NaN / undefined 入力は 0 扱い', () => {
    expect(formatSegmentLabel(NaN, undefined)).toBe('0.00km / 0.0%');
    expect(formatSegmentLabel(undefined, 4.5)).toBe('0.00km / 4.5%');
  });
});

describe('buildSegmentLabels — 約 intervalM 間隔の最近傍セグメント抽出', () => {
  it('決定的 pin: starts 0,50,…,1000 / interval 100 → distance 列 [100,200,…,1000]', () => {
    // セグメント間隔 50m。 各 100m 目標点の最近傍はちょうど 100,200,… のセグメント。
    const features = [];
    for (let d = 0; d <= 1000; d += 50) features.push(seg(d, 5));
    const labels = buildSegmentLabels(fc(features), 100);
    expect(labels.map((l) => l.distance_m)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('最近傍は実セグメント距離を採る (= 70/210 を 100/200 に丸めない)', () => {
    // starts 0,70,140,210。 目標 100 の最近傍は 70 (|70-100|=30 < |140-100|=40)、
    // 目標 200 の最近傍は 210 (|210-200|=10 < |140-200|=60)。
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(70, 2), seg(140, 3), seg(210, 4)]), 100);
    expect(labels.map((l) => l.distance_m)).toEqual([70, 210]);
    // 表示文字列も実距離 (= 偽の丸めなし)。
    expect(labels[0].text).toBe('0.07km / 2.0%');
  });

  it('同距離の場合は直前セグメントを採る (タイブレーク)', () => {
    // starts 50,150。 目標 100 は両方 |.-100|=50 → 直前 (50)。
    const labels = buildSegmentLabels(fc([seg(50, 1), seg(150, 2)]), 100);
    expect(labels.map((l) => l.distance_m)).toEqual([50]);
  });

  it('gap で目標を複数段進める (= セグメントが飛んでも進む)', () => {
    // 0 の次が 1300。 目標 100..1300 を跨ぐ。 各目標の最近傍が同一なら重複 emit しない。
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(1300, 8), seg(1400, 4)]), 100);
    // 目標 100..1200 は最近傍が 0 か 1300、 連続重複は抑止 → ユニーク距離のみ残る。
    const uniq = new Set(labels.map((l) => l.distance_m));
    expect(uniq.size).toBe(labels.length);
    expect(labels.map((l) => l.distance_m)).toContain(1300);
  });

  it('default interval は 100', () => {
    const features = [];
    for (let d = 0; d <= 1000; d += 50) features.push(seg(d, 5));
    expect(buildSegmentLabels(fc(features))).toEqual(buildSegmentLabels(fc(features), 100));
  });

  it('戻り値要素は lon/lat/text/distance_m/slope_pct/bearing を持つ', () => {
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(100, 6.7)]), 100);
    expect(labels).toHaveLength(1);
    const l = labels[0];
    expect(typeof l.lon).toBe('number');
    expect(typeof l.lat).toBe('number');
    expect(l.text).toBe('0.10km / 6.7%');
    expect(l.distance_m).toBe(100);
    expect(l.slope_pct).toBe(6.7);
    expect(typeof l.bearing).toBe('number');
  });

  it('座標 = セグメント始点と終点の中点', () => {
    // a=[138.70,35.40], b=[138.70,35.41] → 中点 (138.70, 35.405)。
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(100, 5)]), 100);
    expect(labels[0].lon).toBeCloseTo(138.70, 6);
    expect(labels[0].lat).toBeCloseTo(35.405, 6);
  });

  it('sideOffsetM: 北向きセグメントを右(東)に逃がす → lon が東へずれる', () => {
    // a→b 北向き (bearing 0°)。 右 90° = 東。 sideOffsetM>0 で lon が増える、 lat は不変。
    const base = buildSegmentLabels(fc([seg(0, 1), seg(100, 5, [138.7, 35.40], [138.7, 35.41])]), 100, 0);
    const off = buildSegmentLabels(fc([seg(0, 1), seg(100, 5, [138.7, 35.40], [138.7, 35.41])]), 100, 30);
    expect(off[0].lon).toBeGreaterThan(base[0].lon);
    expect(off[0].lat).toBeCloseTo(base[0].lat, 6);
    // 30m offset ≈ 緯度35.4°で経度 30/(111320*cos) ≈ 3.3e-4 度。
    expect(off[0].lon - base[0].lon).toBeCloseTo(30 / (111320 * Math.cos(35.405 * Math.PI / 180)), 6);
  });

  it('sideOffsetM 既定は 0 (= セグメント中点そのまま)', () => {
    const a = buildSegmentLabels(fc([seg(0, 1), seg(100, 5)]), 100);
    const b = buildSegmentLabels(fc([seg(0, 1), seg(100, 5)]), 100, 0);
    expect(a).toEqual(b);
  });

  it('bearing: 北向きセグメント (a→b が北) → 0°', () => {
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(100, 5, [138.7, 35.40], [138.7, 35.41])]), 100);
    expect(labels[0].bearing).toBeCloseTo(0, 3);
  });

  it('bearing: 東向きセグメント (a→b が東) → 90°', () => {
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(100, 5, [138.70, 35.40], [138.71, 35.40])]), 100);
    expect(labels[0].bearing).toBeCloseTo(90, 3);
  });

  it('bearing は 0〜360 に正規化される (西向き → 270°)', () => {
    const labels = buildSegmentLabels(fc([seg(0, 1), seg(100, 5, [138.71, 35.40], [138.70, 35.40])]), 100);
    expect(labels[0].bearing).toBeGreaterThanOrEqual(0);
    expect(labels[0].bearing).toBeLessThan(360);
    expect(labels[0].bearing).toBeCloseTo(270, 3);
  });

  it('空 FC → []', () => {
    expect(buildSegmentLabels(fc([]), 100)).toEqual([]);
  });

  it('features 不在 / null 入力 → []', () => {
    expect(buildSegmentLabels(null, 100)).toEqual([]);
    expect(buildSegmentLabels({}, 100)).toEqual([]);
    expect(buildSegmentLabels({ type: 'FeatureCollection' }, 100)).toEqual([]);
  });

  it('distance_m_start が null / NaN のセグメントは skip', () => {
    const labels = buildSegmentLabels(
      fc([seg(null, 5), seg(100, 6), seg(NaN, 7), seg(200, 8)]),
      100,
    );
    expect(labels.map((l) => l.distance_m)).toEqual([100, 200]);
  });

  it('properties 不在の feature は skip (crash しない)', () => {
    const labels = buildSegmentLabels(
      fc([{ type: 'Feature', geometry: null }, seg(0, 1), seg(100, 5)]),
      100,
    );
    expect(labels.map((l) => l.distance_m)).toEqual([100]);
  });
});
