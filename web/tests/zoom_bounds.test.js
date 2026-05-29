// brief 34 ε-7: zoom 範囲問題の解決 (= hillshade / osm source bounds + center 寄せ).
// DB bbox (= 138.65/35.30/138.85/35.50) 外の tile 要求を MapLibre に抑制させ、
// 404 量産と外部サーバ負担を避ける (= GSI 再アクセスなし、 既得 DB をフル活用).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// b12 Phase 1: 富士ヒル固有値の正本は course 定義オブジェクト.
import { fujihill } from '../courses/fujihill.js';
// b59: demBounds の z15 タイル数 pin 用.
import { tileRangeForBounds } from '../lib/terrain3d.js';
import { MAX_TILES } from '../lib/map3d/tile_loader3d.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER = readFileSync(resolve(__dirname, '..', 'viewer-map3d.js'), 'utf8');
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

  it('viewer-map3d.js は FUJIHILL_DB_BOUNDS / FUJIHILL_DB_CENTER を course 定義から re-export 済 (= 後方互換)', () => {
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

describe('b71: demBounds (= Three.js 地形メッシュ用の DEM 取得範囲、 terrainConfig 派生)', () => {
  // 富士山頂 (tile_constants.py / dbinit の covers_fuji_summit と同じ点)。
  const FUJI_SUMMIT = [138.7274, 35.3606];
  const COURSE = JSON.parse(readFileSync(resolve(__dirname, '..', 'course.json'), 'utf8'));
  // b71: demBounds は fujihill.terrainConfig からの算出値、 値は変わりうるので
  // 範囲条件 (= 富士山頂・コース全点を覆う、 dbBounds 内、 MAX_TILES 内) で pin する。
  // terrainConfig.zoom / bboxKm を変えれば demBounds も連動して変わる。

  it('fujihill.terrainConfig が SoT として存在 (= zoom / bboxKm / 中央点 を持つ)', () => {
    expect(fujihill.terrainConfig).toBeDefined();
    expect(typeof fujihill.terrainConfig.zoom).toBe('number');
    expect(typeof fujihill.terrainConfig.bboxKm).toBe('number');
    expect(typeof fujihill.terrainConfig.centerLon).toBe('number');
    expect(typeof fujihill.terrainConfig.centerLat).toBe('number');
  });

  it('fujihill.demBounds が computeDemBounds(terrainConfig) と一致 (= 派生関係 pin)', async () => {
    const { computeDemBounds } = await import('../courses/fujihill.js');
    expect(fujihill.demBounds).toEqual(computeDemBounds(fujihill.terrainConfig));
  });

  it('demBounds は dbBounds に内包される (= MapLibre source 範囲の内側)', () => {
    const [dw, ds, de, dn] = fujihill.demBounds;
    const [bw, bs, be, bn] = fujihill.dbBounds;
    expect(dw).toBeGreaterThanOrEqual(bw);
    expect(ds).toBeGreaterThanOrEqual(bs);
    expect(de).toBeLessThanOrEqual(be);
    expect(dn).toBeLessThanOrEqual(bn);
  });

  it('demBounds は course 全点を覆う (= コース地形が欠けない)', () => {
    const [w, s, e, n] = fujihill.demBounds;
    for (const p of COURSE) {
      expect(p.lon).toBeGreaterThanOrEqual(w);
      expect(p.lon).toBeLessThanOrEqual(e);
      expect(p.lat).toBeGreaterThanOrEqual(s);
      expect(p.lat).toBeLessThanOrEqual(n);
    }
  });

  it('demBounds は富士山頂を覆う (= 3D 地形に富士山体が乗る、 南で切れない)', () => {
    const [w, s, e, n] = fujihill.demBounds;
    expect(FUJI_SUMMIT[0]).toBeGreaterThanOrEqual(w);
    expect(FUJI_SUMMIT[0]).toBeLessThanOrEqual(e);
    expect(FUJI_SUMMIT[1]).toBeGreaterThanOrEqual(s);
    expect(FUJI_SUMMIT[1]).toBeLessThanOrEqual(n);
  });

  it('demBounds の terrainConfig.zoom タイル数が MAX_TILES 以下 (= loadDemStitched が RangeError を投げない)', () => {
    const range = tileRangeForBounds(fujihill.demBounds, fujihill.terrainConfig.zoom);
    expect(range.count).toBeGreaterThan(0);
    expect(range.count).toBeLessThanOrEqual(MAX_TILES);
  });

  it('viewer-map3d.js の bootMap は DEM 範囲に fujihill.demBounds を渡す (= dbBounds 流用への回帰防止)', () => {
    expect(VIEWER).toMatch(/dbBounds:\s*fujihill\.demBounds/);
  });
});
