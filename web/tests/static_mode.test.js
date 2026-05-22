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
  it('minimap.js の loadOsmTile は env.mode !== "bridge" なら early return', () => {
    // b51: loadOsmTile は web/lib/minimap.js に切り出し済。env は引数で渡る。
    const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');
    const m = minimapSrc.match(/function\s+loadOsmTile\s*\([\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/if\s*\(\s*!env\s*\|\|\s*env\.mode\s*!==?\s*['"]bridge['"]\s*\)/);
    expect(body).toMatch(/resolve\(\s*\)\s*;/);
  });

  it('OSM 公式直叩き URL が viewer / minimap.js とも無い (= static mode 第三者 harm ゼロ)', () => {
    // 2026-05-15 fix で tile.openstreetmap.org 直叩きは完全撤去、bridge osm_raster のみ。
    const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');
    expect((viewer.match(/tile\.openstreetmap\.org/g) || []).length).toBe(0);
    expect((minimapSrc.match(/tile\.openstreetmap\.org/g) || []).length).toBe(0);
  });
});

describe('brief 31: BASE_PATH 計算 (= location.pathname から末尾 file 名を除外)', () => {
  // viewer 本体の `location.pathname.replace(/\/[^/]*$/, '/')` と同じ logic を再現
  function basePath(pathname) {
    return pathname.replace(/\/[^/]*$/, '/');
  }
  it('/ → /', () => { expect(basePath('/')).toBe('/'); });
  it('/index.html → /', () => { expect(basePath('/index.html')).toBe('/'); });
  it('/fujihill-trainer/ → /fujihill-trainer/', () => {
    expect(basePath('/fujihill-trainer/')).toBe('/fujihill-trainer/');
  });
  it('/fujihill-trainer/index.html → /fujihill-trainer/', () => {
    expect(basePath('/fujihill-trainer/index.html')).toBe('/fujihill-trainer/');
  });
  it('/foo/bar/index.html → /foo/bar/', () => {
    expect(basePath('/foo/bar/index.html')).toBe('/foo/bar/');
  });
});

describe('brief 31 commit γ: checkSetupStatus は lib に抽出済、 viewer は wrapper のみ', () => {
  // 旧 grep gate (= 出現回数 == N の literal counting) は撤廃。
  // 仕様 5 経路の decision table は web/tests/check_setup_status.test.js (= behavioral test) で
  // fetch stub 経由で直接検証する。 viewer 側はそれを import して使う wrapper のみ持つ。
  it('viewer は lib/check_setup_status.js を import (= 実装本体は lib 側)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/check_setup_status\.js['"]/);
    expect(viewer).toMatch(/import\s+\{[^}]*checkSetupStatus[^}]*\}\s+from\s+['"]\.\/lib\/check_setup_status\.js['"]/);
  });

  it('viewer の checkSetupStatus は lib helper への thin wrapper (= HTTP_BASE_URL bind のみ)', () => {
    const m = viewer.match(/async\s+function\s+checkSetupStatus\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/checkSetupStatusLib\(\s*HTTP_BASE_URL\s*\)/);
  });
});

describe('brief 31 commit β: bootCheckSetupStatus が env.mode で static / bridge を分岐 (brief 34 ε-2 で initBleMode に rewire)', () => {
  it('bootCheckSetupStatus の body 内に bootEnv 呼出 + env.mode === "static" 分岐 + initBleMode 呼出 (= brief 34 ε-2)', () => {
    const m = viewer.match(/function\s+bootCheckSetupStatus\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/bootEnv\(\)/);
    expect(body).toMatch(/env\.mode\s*===?\s*['"]static['"]/);
    // brief 34 ε-2 (= 2026-05-15 user 方向修正): 旧 initMapMode 撤回、 initBleMode に rewire.
    expect(body).toMatch(/initBleMode\(\)/);
    // dbinit-overlay は bridge mode 経路でのみ呼ばれる
    expect(body).toMatch(/showDbinit\(/);
  });

  it('static mode 経路は showDbinit を skip + connectBridge skip + bootMap(env) + initBleMode のみ (= brief 34 ε-2)', () => {
    // env.mode === 'static' の branch 内では showDbinit / connectBridge を呼ばないことを構造的に確認
    const m = viewer.match(/if\s*\(\s*env\.mode\s*===?\s*['"]static['"]\s*\)\s*\{[\s\S]*?return;\s*\n?\s*\}/);
    expect(m).not.toBeNull();
    const branchBody = m[0];
    expect(branchBody).not.toMatch(/showDbinit\(/);
    expect(branchBody).not.toMatch(/connectBridge\(/);
    // bootMap(env) + initBleMode() が必ず呼ばれる (= 旧 initMapMode は撤回)
    expect(branchBody).toMatch(/bootMap\(\s*env\s*\)/);
    expect(branchBody).toMatch(/initBleMode\(/);
    // static branch 内で initMapMode は呼ばれない (= 一般訪問者にデモを提供しない)
    expect(branchBody).not.toMatch(/initMapMode\(/);
  });
});

// b46: 旧「brief 34 ε-2: introConsented guard」 describe を全面改訂。
//   起動シーンを地形データローダー画面の一本道に作り変え、 intro consent guard
//   (= introConsented / CONSENT_DEV_BYPASS / showIntroOverlay) を撤去した。
//   新しい起動経路 (= 地形データローダー画面 → 「開始」 → dispatchAfterIntro) を pin する。
describe('b46: 起動シーンの一本道化 (= 地形データローダー画面 → 「開始」 → dispatchAfterIntro)', () => {
  it('dispatchAfterIntro は MAP_MODE / TEST_MODE / BRIDGE_MODE / default=initBleMode で分岐', () => {
    const m = viewer.match(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
    expect(body).toMatch(/else\s+if\s*\(\s*TEST_MODE\s*\)\s*initTestMode\(\)/);
    expect(body).toMatch(/else\s+if\s*\(\s*BRIDGE_MODE\s*\)\s*bootCheckSetupStatus\(\)/);
    expect(body).toMatch(/else\s+initBleMode\(\)/);
  });

  it('defaultDispatch は URL 引数 (MAP/TEST/BLE/BRIDGE) なら dispatchAfterIntro、 それ以外は showTerrainLoader', () => {
    // b46: 一般訪問者は地形データローダー画面 (= showTerrainLoader) を経由し、
    //   開発者用 URL 引数経路のみ地形ローダー画面を介さず即 dispatchAfterIntro。
    const m = viewer.match(/function\s+defaultDispatch\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/MAP_MODE\s*\|\|\s*TEST_MODE\s*\|\|\s*BLE_MODE\s*\|\|\s*BRIDGE_MODE/);
    expect(body).toMatch(/dispatchAfterIntro\(\)/);
    expect(body).toMatch(/showTerrainLoader\(\)/);
  });

  it('bootCheckSetupStatus は intro consent guard を持たない (= b46 撤去)', () => {
    const m = viewer.match(/function\s+bootCheckSetupStatus\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).not.toMatch(/introConsented\(/);
    expect(body).not.toMatch(/showIntroOverlay\(/);
  });

  it('viewer source に intro consent guard 関数 / 定数が残っていない (= b46 撤去の物理 pin)', () => {
    expect(viewer).not.toMatch(/function\s+introConsented\s*\(/);
    expect(viewer).not.toMatch(/CONSENT_DEV_BYPASS/);
    expect(viewer).not.toMatch(/function\s+showIntroOverlay\s*\(/);
  });

  it('consent.js を import (= ride consent の getRideConsent / setRideConsent、 intro consent は撤去済)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/consent\.js['"]/);
    expect(viewer).toMatch(/getRideConsent/);
    expect(viewer).toMatch(/setRideConsent/);
    // intro consent の import は撤去済
    expect(viewer).not.toMatch(/import\s+\{[^}]*getIntroConsent[^}]*\}\s+from\s+['"]\.\/lib\/consent\.js['"]/);
  });
});

describe('brief 31 commit β: ENV (= immutable env object) と bootEnv が race door を構造消去', () => {
  it('module-scope に `let ENV = null` (= bootEnv が freeze 済 instance を代入する hook)', () => {
    expect(viewer).toMatch(/^let\s+ENV\s*=\s*null/m);
  });

  it('旧 `let _bridgeReachable = true` の mutable 宣言は撤去済 (= module top の宣言のみ pin)', () => {
    expect(viewer).not.toMatch(/^let\s+_bridgeReachable\s*=/m);
  });

  it('bootEnv() 関数が定義されていて、 内部で Object.freeze を呼ぶ (= mutation 不可)', () => {
    expect(viewer).toMatch(/async\s+function\s+bootEnv\s*\(\s*\)/);
    // 全 source 上で bootEnv 内の Object.freeze と mode 三項演算を pin する
    // (= body 抽出は brace nesting で誤動作するため、 全 viewer 上での grep に簡素化)
    expect(viewer).toMatch(/Object\.freeze\(/);
    expect(viewer).toMatch(/s\.bridgeReachable\s*\?\s*['"]bridge['"]\s*:\s*['"]static['"]/);
  });
});

describe('brief 31 / b12 Phase 2: bootMap helper (= 地図生成は map_renderer に委譲)', () => {
  const RENDERER_PATH = resolve(__dirname, '..', 'lib', 'map_renderer.js');
  const renderer = readFileSync(RENDERER_PATH, 'utf8');

  it('viewer は map インスタンスを直接持たず、 createMapRenderer() の renderer 経由で操作する', () => {
    // b12 Phase 2: 旧 `let map = null` は撤去、 viewer は mapRenderer 1 個だけ持つ。
    expect(viewer).not.toMatch(/^let\s+map\s*=\s*null/m);
    expect(viewer).toMatch(/const\s+mapRenderer\s*=\s*createMapRenderer\(\)/);
    // b12 Phase 4: 描画エンジンを Three.js 実装に差し替え。 createMapRenderer の
    // import 元が map_renderer.js (MapLibre) から map3d/index.js (Three.js) に変わった。
    expect(viewer).toMatch(/import\s+\{\s*createMapRenderer\s*\}\s+from\s+['"]\.\/lib\/map3d\/index\.js['"]/);
  });

  it('function bootMap(env) は map_renderer.boot に委譲する (= 地図生成を地図描画モジュールに集約)', () => {
    expect(viewer).toMatch(/function\s+bootMap\s*\(\s*env\s*\)/);
    const m = viewer.match(/function\s+bootMap\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/mapRenderer\.boot\(/);
  });

  it('new maplibregl.Map + buildMapStyle は map_renderer.js が持つ (= 地図描画モジュールの内側)', () => {
    expect(renderer).toMatch(/new\s+maplibregl\.Map\(/);
    expect(renderer).toMatch(/buildMapStyle\(/);
  });

  it('旧 const map = new maplibregl.Map(...) の viewer module-top inline 生成は撤回', () => {
    expect(viewer).not.toMatch(/^const\s+map\s*=\s*new\s+maplibregl\.Map/m);
    // viewer 本体に maplibregl 直接参照が残っていない (= b12 Phase 2 完了条件)。
    expect(viewer).not.toMatch(/\bmaplibregl\./);
  });
});

describe('brief 31 commit β: course.json fetch URL は ENV.courseUrl 経由', () => {
  it('loadCourse 内で ENV.courseUrl を使う (= bootEnv が mode 別に予め resolve 済)', () => {
    expect(viewer).toMatch(/ENV\s*\?\s*ENV\.courseUrl\s*:/);
  });

  it('bootEnv 内で courseUrl が bridge / static 別に設定される', () => {
    const m = viewer.match(/async\s+function\s+bootEnv\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    // b12 Phase 1: course.json リテラルは course 定義 (fujihill.courseFile) 経由に。
    // bridge / static で別 URL になる構造は不変。
    expect(m[0]).toMatch(/courseUrl:\s*s\.bridgeReachable\s*\?\s*fujihill\.courseFile\s*:\s*`\$\{BASE_PATH\}static\/\$\{fujihill\.courseFile\}`/);
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
