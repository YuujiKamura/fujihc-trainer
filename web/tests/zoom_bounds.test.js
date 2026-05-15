// brief 34 ε-7: zoom 範囲問題の解決 (= hillshade / osm source bounds + center 寄せ).
// DB bbox (= 138.65/35.30/138.85/35.50) 外の tile 要求を MapLibre に抑制させ、
// 404 量産と外部サーバ負担を避ける (= GSI 再アクセスなし、 既得 DB をフル活用).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');

describe('brief 34 ε-7: FUJIHC_DB_BOUNDS const (= tile_constants.py:MINIMAP_BBOX と同値)', () => {
  it('FUJIHC_DB_BOUNDS が [138.65, 35.30, 138.85, 35.50] で export 済', () => {
    expect(VIEWER).toMatch(/export\s+const\s+FUJIHC_DB_BOUNDS\s*=\s*\[\s*138\.65\s*,\s*35\.30?\s*,\s*138\.85\s*,\s*35\.50?\s*\]/);
  });

  it('FUJIHC_DB_CENTER が [138.75, 35.40] (= bbox 中央) で export 済', () => {
    expect(VIEWER).toMatch(/export\s+const\s+FUJIHC_DB_CENTER\s*=\s*\[\s*138\.75\s*,\s*35\.40?\s*\]/);
  });
});

describe('brief 34 ε-7: 各 source に bounds が設定済 (= 範囲外 tile 要求を MapLibre が抑制)', () => {
  it('bridge mode の osm source に bounds: FUJIHC_DB_BOUNDS', () => {
    // bridge / static の 2 つの osm source object 内に bounds: FUJIHC_DB_BOUNDS が現れる
    const matches = VIEWER.match(/bounds:\s*FUJIHC_DB_BOUNDS/g) || [];
    // bridge.osm + bridge.gsi-terrain + static.osm + static.gsi-terrain = 4 箇所
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('bridge mode の gsi-terrain も bounds: FUJIHC_DB_BOUNDS を持つ (= source 隣接 grep)', () => {
    // gsi-terrain source は内部に template literal `${BASE_URL}` を含み balanced brace
    // matching が regex で困難 (= `}` が path 内に現れる)。 「'gsi-terrain' → type:
    // raster-dem → bounds: FUJIHC_DB_BOUNDS」の連続出現を構造的隣接で check
    // (= 2 箇所: bridge / static)。
    const matches = VIEWER.match(/['"]gsi-terrain['"]:\s*\{[\s\S]{0,500}?type:\s*['"]raster-dem['"][\s\S]{0,500}?bounds:\s*FUJIHC_DB_BOUNDS/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('static mode の osm (= pmtiles) source も bounds: FUJIHC_DB_BOUNDS', () => {
    // static mode の osm source は `url: pmtiles://${STATIC_TILE_BASE_URL}/map.pmtiles`、
    // template literal `}` を含むため source 隣接で check.
    const m = VIEWER.match(/['"]osm['"]:\s*\{[\s\S]{0,200}?url:\s*`pmtiles:\/\/[\s\S]{0,500}?bounds:\s*FUJIHC_DB_BOUNDS/);
    expect(m).not.toBeNull();
  });
});

describe('brief 34 ε-7: map 初期化の center は FUJIHC_DB_CENTER (= bbox 中央)', () => {
  it('new maplibregl.Map の center に FUJIHC_DB_CENTER が指定済', () => {
    expect(VIEWER).toMatch(/center:\s*FUJIHC_DB_CENTER/);
  });

  it('旧 hardcoded center [138.7587, 35.4521] は撤回済 (= 中央寄せに変更)', () => {
    // 新 center FUJIHC_DB_CENTER は const 経由、 旧 inline literal は撤回.
    expect(VIEWER).not.toMatch(/center:\s*\[\s*138\.7587\s*,\s*35\.4521\s*\]/);
  });
});

describe('brief 34 ε-7: 外部サーバ負担評価 (= GSI / OSM への再アクセスなし)', () => {
  it('bounds 設定により MapLibre は範囲外 tile を要求しない (= viewer source 上の constraint)', () => {
    // bounds は MapLibre が範囲外 tile を要求しない constraint、 これにより GSI 再アクセス / 404
    // 量産が止まる。 既存 DB をフル活用、 外部 fetch 発生量ゼロ (= v3 設計図 line 230-234)。
    // 構造 grep で確認、 behavioral test は MapLibre instance が必要なので integration テスト範囲外。
    expect(VIEWER).toMatch(/FUJIHC_DB_BOUNDS/);
    // bounds 設定箇所が 4 箇所以上 (= bridge/static × osm/gsi-terrain)
    const boundsCount = (VIEWER.match(/bounds:\s*FUJIHC_DB_BOUNDS/g) || []).length;
    expect(boundsCount).toBeGreaterThanOrEqual(4);
  });

  it('brief 17b の外部 fetch ゼロ規律は維持 (= ε-7 で破られない)', () => {
    // 既存 viewer_url_audit.test.js の外部 URL gate と整合、 ε-7 で外部 URL を追加しない.
    expect(VIEWER).not.toMatch(/https?:\/\/unpkg\.com/);
    expect(VIEWER).not.toMatch(/https?:\/\/cdn\.jsdelivr\.net/);
  });
});

describe('brief 34 ε-7 integration: course.json と DB bbox の整合 (= 課題 source 側の妥当性)', () => {
  const COURSE = JSON.parse(readFileSync(resolve(__dirname, '..', 'course.json'), 'utf8'));

  it('course.json の全 lat/lon が DB bbox 内 (= bounds が tight すぎないかの sanity check)', () => {
    const [minLon, minLat, maxLon, maxLat] = [138.65, 35.30, 138.85, 35.50];
    for (const p of COURSE) {
      expect(p.lat).toBeGreaterThanOrEqual(minLat);
      expect(p.lat).toBeLessThanOrEqual(maxLat);
      expect(p.lon).toBeGreaterThanOrEqual(minLon);
      expect(p.lon).toBeLessThanOrEqual(maxLon);
    }
  });

  it('course start point と bbox 中央の距離が 0.2 度以内 (= default view から start が見える)', () => {
    const start = COURSE[0];
    const [cLon, cLat] = [138.75, 35.40];
    const dLat = Math.abs(start.lat - cLat);
    const dLon = Math.abs(start.lon - cLon);
    expect(dLat).toBeLessThan(0.2);
    expect(dLon).toBeLessThan(0.2);
  });
});
