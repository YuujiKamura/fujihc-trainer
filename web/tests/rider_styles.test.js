// rider 表示スタイル (web/lib/rider_styles.js) の単体テスト。
//
// rider マーカーの GeoJSON 生成を viewer 内のローカル関数からスタイル別の純粋関数に
// 切り出した件の回帰 gate。 pin するもの:
//   - RIDER_STYLES / DEFAULT / isValidRiderStyle の allowlist 契約
//   - bike: 旧 viewer の自転車シルエットを property まで保ったままか (= 移植の回帰)
//   - gits: リング (annulus polygon) + 進行方向を向いた三角形
//   - arrow: 進行方向を向いた矢印 polygon
//   - 不正 / 空 / null / 予約キー style の bike フォールバック (= 信頼境界外データ防御)
//   - 三角形 / 矢印の先端が heading 方向を向くこと
//   - viewer-maplibre.js に旧インライン実装が残存しないこと (= source 走査、 二重実装防止)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  RIDER_STYLES, DEFAULT_RIDER_STYLE, isValidRiderStyle, buildRiderFeatures,
} from '../lib/rider_styles.js';

const LAT = 35.36, LON = 138.59;

// ring が閉じているか (= 先頭 == 末尾) を全リングについて確認.
function ringsClosed(feature) {
  return feature.geometry.coordinates.every((ring) => {
    const a = ring[0], b = ring[ring.length - 1];
    return a[0] === b[0] && a[1] === b[1];
  });
}
function allFinite(feature) {
  return feature.geometry.coordinates.every((ring) =>
    ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

describe('RIDER_STYLES / allowlist 契約', () => {
  it('スタイルは 2 種以上、 ID は一意', () => {
    expect(RIDER_STYLES.length).toBeGreaterThanOrEqual(2);
    const ids = RIDER_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bike / gits を含み、 各 entry は id と label を持つ', () => {
    const ids = RIDER_STYLES.map((s) => s.id);
    expect(ids).toContain('bike');
    expect(ids).toContain('gits');
    for (const s of RIDER_STYLES) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_RIDER_STYLE は有効な ID', () => {
    expect(isValidRiderStyle(DEFAULT_RIDER_STYLE)).toBe(true);
  });

  it('isValidRiderStyle: 有効 ID は true', () => {
    expect(isValidRiderStyle('bike')).toBe(true);
    expect(isValidRiderStyle('gits')).toBe(true);
  });

  it('isValidRiderStyle: 不正 / 空 / null / 型不一致 / 予約キーは false', () => {
    expect(isValidRiderStyle('')).toBe(false);
    expect(isValidRiderStyle('xxx')).toBe(false);
    expect(isValidRiderStyle('arrow')).toBe(false);  // arrow は廃止済
    expect(isValidRiderStyle(null)).toBe(false);
    expect(isValidRiderStyle(undefined)).toBe(false);
    expect(isValidRiderStyle(123)).toBe(false);
    expect(isValidRiderStyle('__proto__')).toBe(false);
    expect(isValidRiderStyle('constructor')).toBe(false);
  });
});

describe('buildRiderFeatures — bike (= 現行シルエットの移植回帰)', () => {
  const fc = buildRiderFeatures('bike', LAT, LON, 0, 0);

  it('FeatureCollection で feature 2 個 (車体 + rider)', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.length).toBe(2);
  });

  it('車体は暗色 #23272f / base 0 / height 0.55', () => {
    expect(fc.features[0].properties).toEqual({ color: '#23272f', base: 0, height: 0.55 });
  });

  it('rider は cyan #00ffff / base 0.55 / height 1.9 (= 車体上に立つ)', () => {
    expect(fc.features[1].properties).toEqual({ color: '#00ffff', base: 0.55, height: 1.9 });
  });

  it('全 feature が閉じた Polygon で座標は有限', () => {
    for (const f of fc.features) {
      expect(f.geometry.type).toBe('Polygon');
      expect(ringsClosed(f)).toBe(true);
      expect(allFinite(f)).toBe(true);
    }
  });
});

describe('buildRiderFeatures — gits (= リング + 進行方向の三角)', () => {
  const fc = buildRiderFeatures('gits', LAT, LON, 0, 0);

  it('feature 2 個 ── リング (annulus) と三角形', () => {
    expect(fc.features.length).toBe(2);
  });

  it('リングは外周 + 内周の 2 リングを持つ annulus polygon', () => {
    const ring = fc.features[0];
    expect(ring.geometry.type).toBe('Polygon');
    expect(ring.geometry.coordinates.length).toBe(2);  // 外円 + 内円の穴
    expect(ringsClosed(ring)).toBe(true);
  });

  it('三角形は 1 リングの Polygon (頂点 3 + 閉合 = 4 座標)', () => {
    const tri = fc.features[1];
    expect(tri.geometry.type).toBe('Polygon');
    expect(tri.geometry.coordinates.length).toBe(1);
    expect(tri.geometry.coordinates[0].length).toBe(4);
    expect(ringsClosed(tri)).toBe(true);
  });

  it('三角形の先端が heading 方向を向く: heading 0 で北 (lat 増)', () => {
    const tri = buildRiderFeatures('gits', LAT, LON, 0, 0).features[1];
    const apex = tri.geometry.coordinates[0][0];
    expect(apex[1]).toBeGreaterThan(LAT);              // 北 = lat が増える
    expect(apex[0]).toBeCloseTo(LON, 6);               // 東西方向はほぼ中心
  });

  it('三角形の先端が heading 方向を向く: heading π/2 で東 (lon 増)', () => {
    const tri = buildRiderFeatures('gits', LAT, LON, Math.PI / 2, 0).features[1];
    const apex = tri.geometry.coordinates[0][0];
    expect(apex[0]).toBeGreaterThan(LON);              // 東 = lon が増える
    expect(apex[1]).toBeCloseTo(LAT, 6);
  });

  it('全 feature の座標は有限', () => {
    for (const f of fc.features) expect(allFinite(f)).toBe(true);
  });
});

describe('buildRiderFeatures — 不正スタイルは bike にフォールバック', () => {
  const bike = buildRiderFeatures('bike', LAT, LON, 0, 0);
  for (const bad of ['xxx', '', null, undefined, 123, '__proto__']) {
    it(`style=${JSON.stringify(bad)} は bike と同じ 2 feature を返す`, () => {
      const fc = buildRiderFeatures(bad, LAT, LON, 0, 0);
      expect(fc.features.length).toBe(2);
      expect(fc.features[0].properties).toEqual(bike.features[0].properties);
      expect(fc.features[1].properties).toEqual(bike.features[1].properties);
    });
  }
});

describe('viewer-maplibre.js への landing (= source 走査、 二重実装防止)', () => {
  const viewer = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'viewer-maplibre.js'), 'utf8');

  it('rider_styles.js を import している', () => {
    expect(viewer).toMatch(/from '\.\/lib\/rider_styles\.js'/);
  });

  it('旧インライン rider ビルダー (#23272f の直書き) が viewer に残存しない', () => {
    // 自転車車体の色 #23272f は rider_styles.js に移譲済。 viewer 本体には残っていないこと。
    expect(viewer).not.toContain('#23272f');
  });
});
