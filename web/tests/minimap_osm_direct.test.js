// brief 29: minimap を旧 OSM 直叩き方式に rollback (= brief 28 MapLibre 2nd instance 撤回)。
// ToS 範囲内 1-shot 9-16 タイル (= z=11)、 起動時 1 回限り、 ride 中 再 fetch ゼロ。
// 旧 buildMinimapBase 復活 / loadOsmTile 復活 / 上下 2 canvas 構造維持 を grep gate で物理 pin。
// brief 28 で landed した MapLibre 2nd instance (= initMinimapMap / buildMapStyle) が
// 復活した瞬間に test fail。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-map3d.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');

describe('brief 29: index.html minimap DOM 構成 (= 2 canvas、 brief 28 の div+canvas を rollback)', () => {
  const indexHtml = readFileSync(INDEX_PATH, 'utf8');

  it('#minimap-container div が存在する (= brief 28 で landed した container 構造は維持)', () => {
    expect(indexHtml).toMatch(/<div\s+id="minimap-container"/);
  });

  it('#minimap-top は canvas (= 旧 OSM 直叩き drawImage 用、 brief 28 の div を rollback)', () => {
    expect(indexHtml).toMatch(/<canvas\s+id="minimap-top"/);
  });

  it('#minimap-top は div ではない (= brief 28 の MapLibre 2nd instance container 化を撤回)', () => {
    expect(indexHtml).not.toMatch(/<div\s+id="minimap-top"/);
  });

  it('#minimap-bottom canvas が存在する (= 標高プロファイル、 brief 28 と同仕様)', () => {
    expect(indexHtml).toMatch(/<canvas\s+id="minimap-bottom"/);
  });

  it('旧 <canvas id="minimap"> 単一 canvas は不在 (= NG-R1-11 二重実装ガード、 brief 28 の分離は維持)', () => {
    expect(indexHtml).not.toMatch(/<canvas\s+id="minimap"\s/);
  });
});

describe('b51: minimap は web/lib/minimap.js が OSM 直叩き minimap を持つ', () => {
  // b51: minimap (loadOsmTile / 上下 base 画像 / update) は viewer-map3d.js から
  //   web/lib/minimap.js の createMinimap() factory へ切り出し済。
  const viewer = readFileSync(VIEWER_PATH, 'utf8');
  const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');

  it('viewer は createMinimap を minimap.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createMinimap[^}]*\}\s+from\s+['"]\.\/lib\/minimap\.js['"]/);
  });

  it('function loadOsmTile 定義が minimap.js に存在する (= 1-shot tile fetch)', () => {
    expect(minimapSrc).toMatch(/function\s+loadOsmTile\s*\(/);
  });

  it('buildTopBase / buildBottomBase / drawDirTriangle / update が minimap.js に存在する', () => {
    expect(minimapSrc).toMatch(/function\s+buildTopBase\s*\(/);
    expect(minimapSrc).toMatch(/function\s+buildBottomBase\s*\(/);
    expect(minimapSrc).toMatch(/function\s+drawDirTriangle\s*\(/);
    expect(minimapSrc).toMatch(/function\s+update\s*\(/);
  });

  it('loadOsmTile は bridge osm_raster 経路を一次に使い、 OSM 公式直叩きはしない', () => {
    expect(minimapSrc).toMatch(/osm_raster/);
    // 2026-05-15 fix で OSM 公式 (tile.openstreetmap.org) への直叩き fallback は撤去済。
    expect(minimapSrc).not.toMatch(/tile\.openstreetmap\.org/);
  });

  it('minimap.js は tile_math から座標変換を import (= lib 経由)', () => {
    expect(minimapSrc).toMatch(/import\s+\{[^}]*lonToTileX[^}]*\}\s+from\s+['"]\.\/tile_math\.js['"]/);
    expect(minimapSrc).toMatch(/import\s+\{[^}]*tileYToLat[^}]*\}\s+from\s+['"]\.\/tile_math\.js['"]/);
  });

  it('minimap.js は update で minimapTopBase + minimapBottomBase の両方を drawImage', () => {
    expect(minimapSrc).toMatch(/drawImage\(minimapTopBase/);
    expect(minimapSrc).toMatch(/drawImage\(minimapBottomBase/);
  });

  it('minimap.js の closure に minimapTopBase / minimapBottomBase がある', () => {
    expect(minimapSrc).toMatch(/let\s+minimapTopBase\s*=\s*null/);
    expect(minimapSrc).toMatch(/let\s+minimapBottomBase\s*=\s*null/);
  });
});

describe('brief 29: brief 28 の MapLibre 2nd instance 関連は完全削除', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('function initMinimapMap は不在 (= brief 28 撤回、 NG-R1-11 二重実装回避)', () => {
    expect(viewer).not.toMatch(/function\s+initMinimapMap\s*\(/);
  });

  it('function buildMapStyle は map_renderer.js に存在 (= b12 Phase 2 で地図描画モジュールへ移設)', () => {
    // brief 29 段階では buildMapStyle 不在を pin、 brief 31 で main map の bridge / static
    // mode 分岐のため再導入。 b12 Phase 2 で viewer 本体から map_renderer.js へ移設済。
    // ここでは存在のみ確認、 内容は build_map_style.test.js が map_renderer.js 上で pin する。
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/function\s+buildMapStyle\s*\(/);
    // viewer 本体には buildMapStyle 定義が残っていない (= 二重実装防止)。
    expect(viewer).not.toMatch(/function\s+buildMapStyle\s*\(/);
  });

  it('module-scope の minimapMap / minimapRider グローバル変数は不在', () => {
    expect(viewer).not.toMatch(/^let\s+minimapMap\s*=/m);
    expect(viewer).not.toMatch(/^let\s+minimapRider\s*=/m);
  });

  it('minimapMap.dragRotate.disable 等の 2nd instance interaction 抑止は不在', () => {
    expect(viewer).not.toMatch(/minimapMap\.dragRotate/);
    expect(viewer).not.toMatch(/minimapMap\.scrollZoom/);
    expect(viewer).not.toMatch(/minimapMap\.dragPan/);
  });

  it('new maplibregl.Map で container: \'minimap-top\' を立てる呼出が不在', () => {
    expect(viewer).not.toMatch(/container:\s*['"]minimap-top['"]/);
  });

  it('brief 17b の苦肉策 ctx.fillStyle = \'#e8e8e8\' は不在 (= 単色塗り回避は維持)', () => {
    expect(viewer).not.toMatch(/ctx\.fillStyle\s*=\s*['"]#e8e8e8['"]/);
  });
});

describe('brief 29: prefetchTilesAlongCourse の物理 freeze 維持 (= brief 13)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('function prefetchTilesAlongCourse は不在 (= ride hot path への OSM 直叩き復活絶対 NG)', () => {
    expect(viewer).not.toMatch(/function\s+prefetchTilesAlongCourse\s*\(/);
    expect(viewer).not.toMatch(/prefetchTilesAlongCourse\s*=\s*function/);
  });

  it('viewer / minimap.js とも OSM 公式直叩き URL literal が無い (= 第三者 heavy use ゼロ)', () => {
    // 2026-05-15 fix で tile.openstreetmap.org への直叩きは完全撤去。minimap の OSM
    // raster は bridge の osm_raster 経路のみ (= static mode は取得せず)。
    const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');
    expect((viewer.match(/tile\.openstreetmap\.org/g) || []).length).toBe(0);
    expect((minimapSrc.match(/tile\.openstreetmap\.org/g) || []).length).toBe(0);
  });
});
