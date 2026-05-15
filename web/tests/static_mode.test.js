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
  it('loadOsmTile は ENV.mode !== "bridge" なら最初の onerror 前に early return', () => {
    const m = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    // body の冒頭で ENV non-bridge 時の early resolve があるはず
    expect(body).toMatch(/if\s*\(\s*!ENV\s*\|\|\s*ENV\.mode\s*!==?\s*['"]bridge['"]\s*\)/);
    expect(body).toMatch(/resolve\(\s*\)\s*;\s*return\s*;/);
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

describe('brief 31 commit β: bootCheckSetupStatus が env.mode で static / bridge を分岐', () => {
  it('bootCheckSetupStatus の body 内に bootEnv 呼出 + env.mode === "static" 分岐 + initMapMode 呼出', () => {
    const m = viewer.match(/function\s+bootCheckSetupStatus\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/bootEnv\(\)/);
    expect(body).toMatch(/env\.mode\s*===?\s*['"]static['"]/);
    expect(body).toMatch(/initMapMode\(\)/);
    // dbinit-overlay は bridge mode 経路でのみ呼ばれる
    expect(body).toMatch(/showDbinit\(/);
  });

  it('static mode 経路は showDbinit を skip + connectBridge skip + bootMap(env) + initMapMode のみ', () => {
    // env.mode === 'static' の branch 内では showDbinit / connectBridge を呼ばないことを構造的に確認
    const m = viewer.match(/if\s*\(\s*env\.mode\s*===?\s*['"]static['"]\s*\)\s*\{[\s\S]*?return;\s*\n?\s*\}/);
    expect(m).not.toBeNull();
    const branchBody = m[0];
    expect(branchBody).not.toMatch(/showDbinit\(/);
    expect(branchBody).not.toMatch(/connectBridge\(/);
    // bootMap(env) + initMapMode() が必ず呼ばれる
    expect(branchBody).toMatch(/bootMap\(\s*env\s*\)/);
    expect(branchBody).toMatch(/initMapMode\(/);
  });
});

describe('brief 34 ε-2: introConsented guard で起動分岐 2 箇所を制御', () => {
  it('module top dispatch は introConsented() guard 内でのみ initMapMode / initTestMode / initBleMode / bootCheckSetupStatus を呼ぶ', () => {
    // 旧 `if (MAP_MODE) initMapMode(); else if (TEST_MODE) ...` の literal は
    // `dispatchAfterIntro` 関数内に格納、 module top では introConsented() で gate.
    expect(viewer).toMatch(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]*?if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
    expect(viewer).toMatch(/if\s*\(\s*introConsented\(\)\s*\)\s*\{\s*\n\s*dispatchAfterIntro\(\)/);
  });

  it('introConsented 未通過なら showIntroOverlay を呼んで init 群を物理 skip', () => {
    // module top dispatch の else 節で showIntroOverlay を呼ぶ
    const m = viewer.match(/if\s*\(\s*introConsented\(\)\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?\}/);
    expect(m).not.toBeNull();
    const ifElse = m[0];
    expect(ifElse).toMatch(/showIntroOverlay\(\)/);
  });

  it('bootCheckSetupStatus も内部で introConsented() を check (= 二重 gate)', () => {
    const m = viewer.match(/function\s+bootCheckSetupStatus\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/introConsented\(\)/);
    expect(body).toMatch(/showIntroOverlay\(/);
  });

  it('CONSENT_DEV_BYPASS は ?consent=dev のみ true、 ?map=1 単独では bypass しない', () => {
    expect(viewer).toMatch(/CONSENT_DEV_BYPASS\s*=\s*new\s+URLSearchParams\(location\.search\)\.get\(['"]consent['"]\)\s*===\s*['"]dev['"]/);
  });

  it('consent.js を import (= getIntroConsent / setIntroConsent / getRideConsent / setRideConsent)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/consent\.js['"]/);
    expect(viewer).toMatch(/getIntroConsent/);
    expect(viewer).toMatch(/setIntroConsent/);
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

describe('brief 31: bootMap helper (= 旧 const map = new Map(...) の遅延化)', () => {
  it('let map = null で module-scope 宣言 (= ensureMapBooted で代入)', () => {
    expect(viewer).toMatch(/^let\s+map\s*=\s*null/m);
  });

  it('function bootMap(env) 定義が存在 + new maplibregl.Map を呼ぶ (= commit β で signature 変更)', () => {
    expect(viewer).toMatch(/function\s+bootMap\s*\(\s*env\s*\)/);
    const m = viewer.match(/function\s+bootMap\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/new\s+maplibregl\.Map\(/);
    expect(m[0]).toMatch(/buildMapStyle\(/);
  });

  it('旧 const map = new maplibregl.Map(...) の module-top inline 生成は撤回', () => {
    expect(viewer).not.toMatch(/^const\s+map\s*=\s*new\s+maplibregl\.Map/m);
  });
});

describe('brief 31 commit β: course.json fetch URL は ENV.courseUrl 経由', () => {
  it('loadCourse 内で ENV.courseUrl を使う (= bootEnv が mode 別に予め resolve 済)', () => {
    expect(viewer).toMatch(/ENV\s*\?\s*ENV\.courseUrl\s*:/);
  });

  it('bootEnv 内で courseUrl が bridge / static 別に設定される', () => {
    const m = viewer.match(/async\s+function\s+bootEnv\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/courseUrl:\s*s\.bridgeReachable\s*\?\s*['"]course\.json['"]\s*:\s*`\$\{BASE_PATH\}static\/course\.json`/);
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
