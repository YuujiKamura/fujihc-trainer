// brief 28: minimap 上半分を MapLibre 2nd instance 化、 下半分は標高プロファイル canvas。
// 過去 NG (= NG-R1-3 命名混在 / NG-R1-7 1 関数 multi 責務 / NG-R1-11 inline 二重定義) の再演を
// source-grep gate で物理的に止める。 旧 buildMinimapBase の単色 '#e8e8e8' fill が grep で
// 不在なことを pin、 復活した瞬間に test fail。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');

describe('brief 28: index.html minimap DOM 分割', () => {
  const indexHtml = readFileSync(INDEX_PATH, 'utf8');

  it('#minimap-container div が存在する (= 旧単一 canvas の置換)', () => {
    expect(indexHtml).toMatch(/<div\s+id="minimap-container"/);
  });

  it('#minimap-top div が存在する (= 上半分の MapLibre 2nd instance container)', () => {
    expect(indexHtml).toMatch(/<div\s+id="minimap-top"/);
  });

  it('#minimap-bottom canvas が存在する (= 下半分の標高プロファイル)', () => {
    expect(indexHtml).toMatch(/<canvas\s+id="minimap-bottom"/);
  });

  it('旧 <canvas id="minimap"> 単一 canvas は廃止 (= NG-R1-11 二重実装ガード)', () => {
    // 旧コード <canvas id="minimap" width="320" height="720"> は消えている
    expect(indexHtml).not.toMatch(/<canvas\s+id="minimap"\s/);
  });

  it('CSS は #minimap-container / #minimap-top / #minimap-bottom の 3 規則を定義', () => {
    expect(indexHtml).toMatch(/#minimap-container\s*\{/);
    expect(indexHtml).toMatch(/#minimap-top\s*\{/);
    expect(indexHtml).toMatch(/#minimap-bottom\s*\{/);
  });
});

describe('brief 28: viewer-maplibre.js 構造分割', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('function buildMapStyle 定義が存在する (= main + minimap で共有、 NG-R1-11 回避)', () => {
    expect(viewer).toMatch(/function\s+buildMapStyle\s*\(/);
  });

  it('function initMinimapMap 定義が存在する (= 上半分の 2nd MapLibre instance)', () => {
    expect(viewer).toMatch(/function\s+initMinimapMap\s*\(/);
  });

  it('function buildMinimapBottom 定義が存在する (= 下半分の標高プロファイル)', () => {
    expect(viewer).toMatch(/function\s+buildMinimapBottom\s*\(/);
  });

  it('旧 function buildMinimapBase は廃止 (= 上下責務同居解消、 NG-R1-7 回避)', () => {
    expect(viewer).not.toMatch(/function\s+buildMinimapBase\s*\(/);
  });

  it('minimap の interaction 7 系を全 disable している (= fitBounds 維持)', () => {
    // ハマる罠で挙げた 7 系を 1 つでも忘れたら test fail
    expect(viewer).toMatch(/minimapMap\.dragRotate\.disable/);
    expect(viewer).toMatch(/minimapMap\.scrollZoom\.disable/);
    expect(viewer).toMatch(/minimapMap\.dragPan\.disable/);
    expect(viewer).toMatch(/minimapMap\.keyboard\.disable/);
    expect(viewer).toMatch(/minimapMap\.doubleClickZoom\.disable/);
    expect(viewer).toMatch(/minimapMap\.boxZoom\.disable/);
    expect(viewer).toMatch(/minimapMap\.touchZoomRotate\.disable/);
  });

  it('updateMinimap 内に setLngLat 呼出が存在する (= marker 経由で rider 更新)', () => {
    expect(viewer).toMatch(/function\s+updateMinimap[\s\S]{0,1200}setLngLat\(/);
  });

  it('旧 ctx.fillStyle = \'#e8e8e8\' の単色塗り literal は廃止 (= 17b 制約解除、 NG-R1-11)', () => {
    // brief 17b の苦肉策 fill 全廃止、 OSM vector layer 経由で塗る
    expect(viewer).not.toMatch(/ctx\.fillStyle\s*=\s*['"]#e8e8e8['"]/);
  });

  it('旧 drawDirTriangle は廃止 (= rider marker は MapLibre 任せ)', () => {
    expect(viewer).not.toMatch(/function\s+drawDirTriangle\s*\(/);
  });

  it('旧 minimapBase グローバル変数は廃止 (= minimapBottomBase に置換)', () => {
    // 旧コード `let minimapBase = null;` は消えている
    expect(viewer).not.toMatch(/^let\s+minimapBase\s*=\s*null/m);
    expect(viewer).toMatch(/let\s+minimapBottomBase\s*=\s*null/);
  });

  it('minimap 2nd instance は document.getElementById で container "minimap-top" を取る', () => {
    expect(viewer).toMatch(/getElementById\(['"]minimap-top['"]\)/);
  });

  it('minimap rider marker は cyan (= 主 map と同色規約)', () => {
    // initMinimapMap 内で maplibregl.Marker({color:'#00ffff'}) を生成
    expect(viewer).toMatch(/function\s+initMinimapMap[\s\S]{0,2500}maplibregl\.Marker\(\{[^}]*color:\s*['"]#00ffff['"]/);
  });
});
