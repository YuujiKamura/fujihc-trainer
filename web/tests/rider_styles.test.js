// rider マーカー (web/lib/rider_styles.js) の単体テスト。
//
// rider マーカーの GeoJSON 生成を viewer 内のローカル関数から純粋関数に切り出した件の
// 回帰 gate。 マーカーは「上から見たリング + 進行方向を向いた三角」。 pin するもの:
//   - FeatureCollection が リング (annulus polygon) + 三角形 の 2 feature
//   - リングは外周 + 内周の 2 リングを持つ annulus
//   - 三角形の先端が heading 方向を向く
//   - 全 feature が地面から少し浮く (base > 0)
//   - ring 閉合 / 座標有限
//   - viewer-maplibre.js が rider_styles.js を import し、 旧インライン実装が残らないこと

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildRiderFeatures } from '../lib/rider_styles.js';

const LAT = 35.36, LON = 138.59;

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

describe('buildRiderFeatures — リング + 進行方向の三角', () => {
  const fc = buildRiderFeatures(LAT, LON, 0, 0);

  it('FeatureCollection で feature 2 個 (リング + 三角形)', () => {
    expect(fc.type).toBe('FeatureCollection');
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

  it('全 feature が地面から少し浮く (base > 0、 height > base)', () => {
    for (const f of fc.features) {
      expect(f.properties.base).toBeGreaterThan(0);
      expect(f.properties.height).toBeGreaterThan(f.properties.base);
    }
  });

  it('全 feature の座標は有限', () => {
    for (const f of fc.features) expect(allFinite(f)).toBe(true);
  });
});

describe('buildRiderFeatures — 三角形の先端が heading 方向を向く', () => {
  it('heading 0 で先端は北 (lat 増)、 東西はほぼ中心', () => {
    const tri = buildRiderFeatures(LAT, LON, 0, 0).features[1];
    const apex = tri.geometry.coordinates[0][0];
    expect(apex[1]).toBeGreaterThan(LAT);
    expect(apex[0]).toBeCloseTo(LON, 6);
  });

  it('heading π/2 で先端は東 (lon 増)、 南北はほぼ中心', () => {
    const tri = buildRiderFeatures(LAT, LON, Math.PI / 2, 0).features[1];
    const apex = tri.geometry.coordinates[0][0];
    expect(apex[0]).toBeGreaterThan(LON);
    expect(apex[1]).toBeCloseTo(LAT, 6);
  });

  it('heading π で先端は南 (lat 減)', () => {
    const tri = buildRiderFeatures(LAT, LON, Math.PI, 0).features[1];
    const apex = tri.geometry.coordinates[0][0];
    expect(apex[1]).toBeLessThan(LAT);
  });
});

describe('viewer-maplibre.js への landing (= source 走査、 二重実装防止)', () => {
  const viewer = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '..', 'viewer-maplibre.js'), 'utf8');

  it('rider_styles.js を import している', () => {
    expect(viewer).toMatch(/from '\.\/lib\/rider_styles\.js'/);
  });

  it('旧自転車シルエット (#23272f の直書き) が viewer に残存しない', () => {
    expect(viewer).not.toContain('#23272f');
  });
});
