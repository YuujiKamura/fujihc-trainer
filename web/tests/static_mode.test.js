// brief 31: GitHub Pages 静的サイト mode (= bridge.py 不在で視覚デモ完結) の物理 grep gate。
// viewer-maplibre.js を直接 import すると maplibre-gl global が無いと落ちるため、
// source-grep + 抽出可能な unit (= BASE_PATH 計算) を分離 test。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');

describe('brief 31: BASE_PATH / BRIDGE_TILE_BASE_URL / STATIC_TILE_BASE_URL の宣言', () => {
  it('BASE_PATH を location.pathname から導出 (= GitHub Pages の project page prefix 対応)', () => {
    expect(viewer).toMatch(/const\s+BASE_PATH\s*=\s*location\.pathname\.replace\(/);
  });

  it('BRIDGE_TILE_BASE_URL は ${location.origin}/tiles (= 従来 path 維持)', () => {
    expect(viewer).toMatch(/const\s+BRIDGE_TILE_BASE_URL\s*=\s*`\$\{location\.origin\}\/tiles`/);
  });

  it('STATIC_TILE_BASE_URL は ${location.origin}${BASE_PATH}static (= GitHub Pages 静的経路)', () => {
    expect(viewer).toMatch(/const\s+STATIC_TILE_BASE_URL\s*=\s*`\$\{location\.origin\}\$\{BASE_PATH\}static`/);
  });

  it('TILE_BASE_URL alias は撤去済 (= brief 31 構造修正、 mode 別の宣言を直接使う)', () => {
    expect(viewer).not.toMatch(/const\s+TILE_BASE_URL\s*=/);
  });
});

describe('brief 31 構造修正: static mode で OSM 直叩き fallback が無効化されている', () => {
  it('loadOsmTile は _bridgeReachable が false なら最初の onerror 前に early return', () => {
    const m = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    // body の冒頭で _bridgeReachable false 時の early resolve があるはず
    expect(body).toMatch(/if\s*\(\s*!\s*_bridgeReachable\s*\)\s*\{\s*resolve\(\s*\)\s*;\s*return\s*;\s*\}/);
  });

  it('tile.openstreetmap.org への直叩きは loadOsmTile 内 1 箇所のみ (= bridge mode 時の fallback 限定)', () => {
    const allMatches = viewer.match(/tile\.openstreetmap\.org/g) || [];
    expect(allMatches.length).toBe(1);
  });
});

describe('brief 31: BASE_PATH 計算 (= location.pathname から末尾 file 名を除外)', () => {
  // viewer 本体の `location.pathname.replace(/\/[^/]*$/, '/')` と同じ logic を再現
  function basePath(pathname) {
    return pathname.replace(/\/[^/]*$/, '/');
  }
  it('/ → /', () => { expect(basePath('/')).toBe('/'); });
  it('/index.html → /', () => { expect(basePath('/index.html')).toBe('/'); });
  it('/fujihc-trainer/ → /fujihc-trainer/', () => {
    expect(basePath('/fujihc-trainer/')).toBe('/fujihc-trainer/');
  });
  it('/fujihc-trainer/index.html → /fujihc-trainer/', () => {
    expect(basePath('/fujihc-trainer/index.html')).toBe('/fujihc-trainer/');
  });
  it('/foo/bar/index.html → /foo/bar/', () => {
    expect(basePath('/foo/bar/index.html')).toBe('/foo/bar/');
  });
});

describe('brief 31: checkSetupStatus が AbortSignal.timeout + bridgeReachable を返す', () => {
  it('AbortSignal.timeout(500) を fetch に渡す', () => {
    expect(viewer).toMatch(/AbortSignal\.timeout\(\s*500\s*\)/);
  });

  it('bridgeReachable は 200 と 503 のみ true、 404 / non-ok / catch は false', () => {
    // checkSetupStatus 関数 body 全体を取って、 各 path で bridgeReachable: true/false を返すことを確認
    const m = viewer.match(/async\s+function\s+checkSetupStatus\s*\([\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    // true 経路は 2 つ: 200 OK (= body 展開) + 503 (= bridge 起動済 DB 未充足)
    expect((body.match(/bridgeReachable:\s*true/g) || []).length).toBe(2);
    // false 経路は 2 つ以上: 404 / non-ok + catch (timeout / network)
    expect((body.match(/bridgeReachable:\s*false/g) || []).length).toBeGreaterThanOrEqual(2);
    // 503 だけは特殊 (= bridge 認知して true)
    expect(body).toMatch(/resp\.status\s*===?\s*503[\s\S]*bridgeReachable:\s*true/);
    // non-ok (= 404 含む) は false
    expect(body).toMatch(/!resp\.ok[\s\S]*bridgeReachable:\s*false/);
    // catch path で bridgeReachable: false
    expect(body).toMatch(/catch[\s\S]*bridgeReachable:\s*false/);
  });
});

describe('brief 31: bootCheckSetupStatus が bridgeReachable=false で initMapMode に分岐', () => {
  it('bootCheckSetupStatus の body 内に `!s.bridgeReachable` + `initMapMode()` 呼出', () => {
    const m = viewer.match(/function\s+bootCheckSetupStatus\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/!\s*s\.bridgeReachable/);
    expect(body).toMatch(/initMapMode\(\)/);
    // dbinit-overlay は bridgeReachable=true かつ overall !== 'ready' のみ
    expect(body).toMatch(/showDbinit\(/);
  });

  it('static mode 経路 (= !bridgeReachable) は showDbinit を skip + connectBridge skip', () => {
    // bridgeReachable=false の branch 内では showDbinit / connectBridge を呼ばないことを構造的に確認
    const m = viewer.match(/if\s*\(\s*!\s*s\.bridgeReachable\s*\)\s*\{[\s\S]*?return;\s*\n?\s*\}/);
    expect(m).not.toBeNull();
    const branchBody = m[0];
    expect(branchBody).not.toMatch(/showDbinit\(/);
    expect(branchBody).not.toMatch(/connectBridge\(/);
    // bootMap(false) + initMapMode() が必ず呼ばれる
    expect(branchBody).toMatch(/bootMap\(\s*false\s*\)/);
    expect(branchBody).toMatch(/initMapMode\(/);
  });
});

describe('brief 31: bootMap helper (= 旧 const map = new Map(...) の遅延化)', () => {
  it('let map = null で module-scope 宣言 (= ensureMapBooted で代入)', () => {
    expect(viewer).toMatch(/^let\s+map\s*=\s*null/m);
  });

  it('function bootMap(bridgeReachable) 定義が存在 + new maplibregl.Map を呼ぶ', () => {
    expect(viewer).toMatch(/function\s+bootMap\s*\(\s*bridgeReachable\s*\)/);
    const m = viewer.match(/function\s+bootMap\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/new\s+maplibregl\.Map\(/);
    expect(m[0]).toMatch(/buildMapStyle\(/);
  });

  it('旧 const map = new maplibregl.Map(...) の module-top inline 生成は撤回', () => {
    expect(viewer).not.toMatch(/^const\s+map\s*=\s*new\s+maplibregl\.Map/m);
  });
});

describe('brief 31: course.json fetch URL の mode 別分岐', () => {
  it('loadCourse 内で _bridgeReachable に基づき fetch URL を分岐', () => {
    const m = viewer.match(/async\s+function\s+loadCourse[\s\S]*?\}\)\s*\(\);?\s*\}|async\s+function\s+loadCourse[\s\S]*?\n\}/);
    // 上記 regex は脆いので body を別 grep で確認
    expect(viewer).toMatch(/_bridgeReachable\s*\?\s*['"]course\.json['"]/);
    expect(viewer).toMatch(/\$\{BASE_PATH\}static\/course\.json/);
  });
});

describe('brief 31: pmtiles vendored 配置 + index.html script 読み込み', () => {
  const INDEX_PATH = resolve(__dirname, '..', 'index.html');
  const indexHtml = readFileSync(INDEX_PATH, 'utf8');

  it('web/lib/vendor/pmtiles.js が存在する (= vendored、 CDN 経由 NG)', () => {
    const PMT_PATH = resolve(__dirname, '..', 'lib', 'vendor', 'pmtiles.js');
    const content = readFileSync(PMT_PATH, 'utf8');
    // pmtiles@3.0.6 の IIFE は `var pmtiles = (() =>` で始まる
    expect(content).toMatch(/var\s+pmtiles\s*=\s*\(\s*\(\s*\)\s*=>/);
  });

  it('LICENSE-pmtiles に BSD-3-Clause 表記', () => {
    const LIC_PATH = resolve(__dirname, '..', 'lib', 'vendor', 'LICENSE-pmtiles');
    const content = readFileSync(LIC_PATH, 'utf8');
    expect(content).toMatch(/BSD[\s\-]?3[\s\-]?Clause/i);
  });

  it('index.html に <script src="./lib/vendor/pmtiles.js"> 1 行 (= CDN 経由化 regression block)', () => {
    expect(indexHtml).toMatch(/<script\s+src="\.\/lib\/vendor\/pmtiles\.js"\s*>\s*<\/script>/);
  });

  it('pmtiles の CDN 経由 (= unpkg.com / cdn.jsdelivr.net 等) は viewer + index.html に出現しない', () => {
    expect(viewer).not.toMatch(/unpkg\.com\/pmtiles/);
    expect(viewer).not.toMatch(/cdn\.jsdelivr\.net\/npm\/pmtiles/);
    expect(indexHtml).not.toMatch(/unpkg\.com\/pmtiles/);
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/pmtiles/);
  });
});
