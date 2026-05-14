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
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
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

describe('brief 29: viewer-maplibre.js は旧 OSM 直叩き minimap を持つ', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('function loadOsmTile 定義が存在する (= 旧版踏襲、 1-shot tile fetch)', () => {
    expect(viewer).toMatch(/function\s+loadOsmTile\s*\(/);
  });

  it('function buildMinimapTopBase 定義が存在する (= 上半分の OSM + course polyline base 画像)', () => {
    expect(viewer).toMatch(/function\s+buildMinimapTopBase\s*\(/);
  });

  it('function buildMinimapBottomBase 定義が存在する (= 下半分の標高プロファイル base 画像)', () => {
    expect(viewer).toMatch(/function\s+buildMinimapBottomBase\s*\(/);
  });

  it('function drawDirTriangle 定義が存在する (= rider 進行方向三角形、 旧版踏襲)', () => {
    expect(viewer).toMatch(/function\s+drawDirTriangle\s*\(/);
  });

  it('loadOsmTile 内に tile.openstreetmap.org URL literal が現れる (= 旧版踏襲、 ToS 範囲内)', () => {
    const m = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/tile\.openstreetmap\.org/);
  });

  it('tile_math から lonToTileX / latToTileY / tileXToLon / tileYToLat を import (= lib 経由)', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*lonToTileX[^}]*\}\s+from\s+['"]\.\/lib\/tile_math\.js['"]/);
    expect(viewer).toMatch(/import\s+\{[^}]*latToTileY[^}]*\}\s+from\s+['"]\.\/lib\/tile_math\.js['"]/);
    expect(viewer).toMatch(/import\s+\{[^}]*tileXToLon[^}]*\}\s+from\s+['"]\.\/lib\/tile_math\.js['"]/);
    expect(viewer).toMatch(/import\s+\{[^}]*tileYToLat[^}]*\}\s+from\s+['"]\.\/lib\/tile_math\.js['"]/);
  });

  it('updateMinimap 内で minimapTopBase + minimapBottomBase の両方を drawImage', () => {
    const m = viewer.match(/function\s+updateMinimap[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/drawImage\(minimapTopBase/);
    expect(m[0]).toMatch(/drawImage\(minimapBottomBase/);
  });

  it('module-scope に let minimapTopBase / minimapBottomBase が存在する', () => {
    expect(viewer).toMatch(/let\s+minimapTopBase\s*=\s*null/);
    expect(viewer).toMatch(/let\s+minimapBottomBase\s*=\s*null/);
  });
});

describe('brief 29: brief 28 の MapLibre 2nd instance 関連は完全削除', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('function initMinimapMap は不在 (= brief 28 撤回、 NG-R1-11 二重実装回避)', () => {
    expect(viewer).not.toMatch(/function\s+initMinimapMap\s*\(/);
  });

  it('function buildMapStyle は不在 (= 共有 helper 廃止、 main map に inline 化)', () => {
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

  it('main viewer 内に OSM URL literal が複数箇所無い (= loadOsmTile 1 箇所のみ)', () => {
    // tile.openstreetmap.org の出現が loadOsmTile 関数内の 1 箇所のみ
    const all = (viewer.match(/tile\.openstreetmap\.org/g) || []).length;
    expect(all).toBe(1);
  });
});
