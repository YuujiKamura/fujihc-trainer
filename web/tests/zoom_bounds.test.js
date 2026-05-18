// brief 34 ε-7: zoom 範囲問題の解決 (= hillshade / osm source bounds + center 寄せ).
// DB bbox (= 138.65/35.30/138.85/35.50) 外の tile 要求を MapLibre に抑制させ、
// 404 量産と外部サーバ負担を避ける (= GSI 再アクセスなし、 既得 DB をフル活用).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// b12 Phase 1: 富士ヒル固有値の正本は course 定義オブジェクト.
import { fujihill } from '../courses/fujihill.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');
// b12 Phase 2: buildMapStyle / 地図生成は web/lib/map_renderer.js に移設済。 source の
// bounds / center 設定はそちらを grep する。 buildMapStyle は course 定義由来の dbBounds を
// 引数受けし、 source に `bounds: dbBounds` として渡す (= 値は fujihill.dbBounds)。
const RENDERER = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');

describe('b12 Phase 1: 富士ヒル DB bbox / center は course 定義 (web/courses/fujihill.js) が正本', () => {
  // brief 34 ε-7 で viewer に inline されていた定数を b12 で course 定義へ移動。
  // 値そのものを定義オブジェクトに対して検証する (= ソース文字列照合より頑健)。
  it('fujihill.dbBounds が [138.65, 35.30, 138.85, 35.50] (= tile_constants.py:MINIMAP_BBOX と同値)', () => {
    expect(fujihill.dbBounds).toEqual([138.65, 35.30, 138.85, 35.50]);
  });

  it('fujihill.dbCenter が [138.75, 35.40] (= bbox 中央)', () => {
    expect(fujihill.dbCenter).toEqual([138.75, 35.40]);
  });

  it('viewer-maplibre.js は FUJIHILL_DB_BOUNDS / FUJIHILL_DB_CENTER を course 定義から re-export 済 (= 後方互換)', () => {
    expect(VIEWER).toMatch(/export\s+const\s+FUJIHILL_DB_BOUNDS\s*=\s*fujihill\.dbBounds/);
    expect(VIEWER).toMatch(/export\s+const\s+FUJIHILL_DB_CENTER\s*=\s*fujihill\.dbCenter/);
  });
});

describe('brief 34 ε-7 / b12 Phase 2: 各 source に bounds が設定済 (= 範囲外 tile 要求を抑制)', () => {
  it('buildMapStyle の osm / gsi-terrain source に bounds: dbBounds (= 4 箇所)', () => {
    // b12 Phase 2: buildMapStyle(env, dbBounds) は course 定義由来の dbBounds を
    // bridge / static × osm / gsi-terrain の 4 source に `bounds: dbBounds` で渡す。
    const matches = RENDERER.match(/bounds:\s*dbBounds/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('bridge mode の gsi-terrain も bounds: dbBounds を持つ (= source 隣接 grep)', () => {
    // 「'gsi-terrain' → type: raster-dem → bounds: dbBounds」の連続出現を構造的隣接で
    // check (= 2 箇所: bridge / static)。
    const matches = RENDERER.match(/['"]gsi-terrain['"]:\s*\{[\s\S]{0,500}?type:\s*['"]raster-dem['"][\s\S]{0,500}?bounds:\s*dbBounds/g);
    expect(matches).not.toBeNull();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('static mode の osm (= pmtiles) source も bounds: dbBounds', () => {
    const m = RENDERER.match(/['"]osm['"]:\s*\{[\s\S]{0,200}?url:\s*`pmtiles:\/\/[\s\S]{0,500}?bounds:\s*dbBounds/);
    expect(m).not.toBeNull();
  });
});

describe('brief 34 ε-7 / b12 Phase 2: map 初期化の center は course 定義の dbCenter (= bbox 中央)', () => {
  it('map_renderer.boot は new maplibregl.Map の center に opts.dbCenter を渡す', () => {
    // b12 Phase 2: viewer は fujihill.dbCenter を renderer.boot に渡し、 renderer が
    // new maplibregl.Map({ center: opts.dbCenter }) で適用する。
    expect(RENDERER).toMatch(/center:\s*opts\.dbCenter/);
  });

  it('viewer は bootMap で fujihill.dbCenter を renderer.boot に渡す', () => {
    expect(VIEWER).toMatch(/dbCenter:\s*fujihill\.dbCenter/);
  });

  it('旧 hardcoded center [138.7587, 35.4521] は撤回済 (= 中央寄せに変更)', () => {
    expect(VIEWER).not.toMatch(/center:\s*\[\s*138\.7587\s*,\s*35\.4521\s*\]/);
    expect(RENDERER).not.toMatch(/center:\s*\[\s*138\.7587\s*,\s*35\.4521\s*\]/);
  });
});

describe('brief 34 ε-7: 外部サーバ負担評価 (= GSI / OSM への再アクセスなし)', () => {
  it('bounds 設定により MapLibre は範囲外 tile を要求しない (= map_renderer source 上の constraint)', () => {
    // bounds は MapLibre が範囲外 tile を要求しない constraint、 これにより GSI 再アクセス / 404
    // 量産が止まる。 b12 Phase 2 で buildMapStyle は map_renderer.js に移設、 bounds 設定箇所も
    // そちらにある。 値は course 定義由来の dbBounds (= fujihill.dbBounds)。
    expect(VIEWER).toMatch(/FUJIHILL_DB_BOUNDS/);
    const boundsCount = (RENDERER.match(/bounds:\s*dbBounds/g) || []).length;
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
