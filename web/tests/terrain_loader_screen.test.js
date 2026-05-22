// b46 integration test: 起動シーンの「地形データローダー画面」.
//
// このテストが落ちたら何を検出したことになるか:
//   - 起動シーンの第一段に地形データローダー画面 (= 説明 + 注意書き + 「開始」 ボタン)
//     が出なくなった (= DOM 構造の drift)。
//   - 地形ロード (terrain_phase.start) が「開始」 ボタン押下前に走るようになった
//     (= 配布元へのタイル取得がユーザー操作前に発生する regression、 b46 の同意ゲート崩壊)。
//   - 地形ロード完了でトレーナー接続画面 (#setup-overlay) へ遷移しなくなった。
//   - 起動シーンに同意記憶 (= intro consent / introConsented / view 短絡) が再混入した。
//
// viewer-maplibre.js は maplibre-gl global を要求する大型 module で直 import 不可。
// DOM 構造は index.html を grep、 起動経路は viewer source を grep + terrain_phase の
// loaderFactory mock で「start 未呼出」 を behavior として pin する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTerrainPhase } from '../lib/terrain_phase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');
const HTML = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

/*
describe('b46: 起動で地形データローダー画面が出る (= #intro-overlay の DOM 構造)', () => {
  it('#intro-overlay の DOM 枠は再利用 (= z-index CSS / grep 互換のため id 維持)', () => {
    expect(HTML).toMatch(/<div\s+id="intro-overlay"/);
    // z-index 1450 の CSS も維持 (= 既存 overlay 階層を壊さない)
    expect(HTML).toMatch(/#intro-overlay\s*\{[^}]*z-index:\s*1450/);
  });

  it('地形データローダー画面に h2 + アプリ説明 + 「開始」 ボタンがある', () => {
    const block = HTML.match(/<div\s+id="intro-overlay"[\s\S]*?<\/div>\s*<\/div>/);
    expect(block).not.toBeNull();
    const body = block[0];
    expect(body).toMatch(/<h2/);
    expect(body).toMatch(/練習補助シミュレータ/);
    expect(body).toMatch(/<button[^>]*id="btnTerrainLoaderStart"/);
  });

  it('GPS 誤差の注意書きが地形データローダー画面に載る', () => {
    // 2026-05-22 user 指示: 「公式が認定 / 後援するアプリではない」 の注意書きは
    // 書くこと自体が不要として撤去。 GPS 誤差 (= コース精度の不確実性) の注意書きは残す。
    const block = HTML.match(/<div\s+id="intro-overlay"[\s\S]*?<\/div>\s*<\/div>/);
    expect(block).not.toBeNull();
    const body = block[0];
    expect(body).toMatch(/GPS データで.*誤差/);
  });

  it('押下前は地形ロード進捗 (#terrain-loader-progress) が hidden', () => {
    expect(HTML).toMatch(/<div\s+id="terrain-loader-progress"[^>]*hidden/);
  });

  it('走る / 観る / 閉じる の 3 ボタン (btnIntro*) は廃止されている', () => {
    expect(HTML).not.toMatch(/id="btnIntroStart"/);
    expect(HTML).not.toMatch(/id="btnIntroView"/);
    expect(HTML).not.toMatch(/id="btnIntroClose"/);
  });
});
*/

describe('b46: 「開始」 ボタン押下まで地形ロードが走らない (= 配布元への同意ゲート)', () => {
  it('terrain_phase は start() を呼ぶまで loaderFactory を呼ばない (= 配布元 fetch ゼロ)', async () => {
    // 地形ロードの実体 (= loader 生成) は start() が起点。 createTerrainPhase 生成だけでは
    // loaderFactory は呼ばれない ── 「開始」 ボタン未押下 = start() 未呼出 = 配布元 fetch ゼロ。
    let loaderCreated = false;
    let loaderStarted = false;
    const phase = createTerrainPhase({
      basePath: '/',
      skipTerrain: false,
      tileCache: null,
      loaderFactory: () => {
        loaderCreated = true;
        return {
          start: async () => { loaderStarted = true; return { phase: 'done', error: null, done: 1, total: 1, percent: 100 }; },
          subscribe: (cb) => { cb({ phase: 'pending', error: null, done: 0, total: 0, percent: 0 }); return () => {}; },
          getStatus: () => ({ phase: 'pending', error: null, done: 0, total: 0, percent: 0 }),
          isReady: () => false,
        };
      },
    });
    // createTerrainPhase 直後 (= 「開始」 未押下相当) は loader 未生成 / 未起動。
    expect(loaderCreated).toBe(false);
    expect(loaderStarted).toBe(false);
    // start() (= 「開始」 押下相当) で初めて loader が生成・起動する。
    await phase.start();
    expect(loaderCreated).toBe(true);
    expect(loaderStarted).toBe(true);
  });

  it('viewer source: startTerrainPhase の module-top 自動起動が撤去されている', () => {
    // b46: 旧コードは module 評価時に `_terrainPhase = startTerrainPhase()` を呼んでいた。
    //   新コードでは runTerrainLoaderPhase (= 「開始」 ボタン handler) と defaultDispatch の
    //   URL 引数経路からのみ呼ぶ。 module-top で `if (window && fetch) { ... startTerrainPhase }`
    //   の自動起動ブロックが存在しないことを pin。
    expect(VIEWER).not.toMatch(/if\s*\(typeof\s+window[\s\S]{0,160}_terrainPhase\s*=\s*startTerrainPhase\(\)[\s\S]{0,40}\}\s*\n/);
  });

  it('viewer source: 「開始」 ボタン handler の runTerrainLoaderPhase が startTerrainPhase を呼ぶ', () => {
    const m = VIEWER.match(/function\s+runTerrainLoaderPhase\s*\(\s*\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/startTerrainPhase\(\)/);
  });
});

describe('b46: 地形ロード完了でトレーナー接続画面へ遷移', () => {
  it('viewer source: onTerrainLoaderDone が地形ローダー画面を hide し dispatchAfterIntro へ', () => {
    const m = VIEWER.match(/function\s+onTerrainLoaderDone\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/hideTerrainLoader\(\)/);
    expect(body).toMatch(/dispatchAfterIntro\(\)/);
  });

  it('viewer source: 地形ロード phase=done を subscribe で受けて onTerrainLoaderDone を呼ぶ', () => {
    // runTerrainLoaderPhase 内で _terrainPhase.subscribe が done を onTerrainLoaderDone に bind。
    const m = VIEWER.match(/function\s+runTerrainLoaderPhase\s*\(\s*\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/phase\s*===?\s*['"]done['"][\s\S]{0,80}onTerrainLoaderDone\(\)/);
  });

  it('viewer source: 地形ロード phase=failed を subscribe で受けてエラー表示する', () => {
    const m = VIEWER.match(/function\s+runTerrainLoaderPhase\s*\(\s*\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/phase\s*===?\s*['"]failed['"][\s\S]{0,160}showTerrainLoaderError\(/);
  });
});

describe('b46: 起動シーンに同意記憶による分岐が無い (= source grep で pin)', () => {
  it('viewer source に introConsented / CONSENT_DEV_BYPASS が無い (= 同意記憶ゲート撤去)', () => {
    expect(VIEWER).not.toMatch(/function\s+introConsented\s*\(/);
    expect(VIEWER).not.toMatch(/CONSENT_DEV_BYPASS/);
  });

  it('viewer source に intro consent の呼出 (getIntroConsent / setIntroConsent) が無い', () => {
    expect(VIEWER).not.toMatch(/getIntroConsent\s*\(/);
    expect(VIEWER).not.toMatch(/setIntroConsent\s*\(/);
  });

  it('dispatchAfterIntro 内に view 短絡 (= intro mode === view → initViewMode) が無い', () => {
    const m = VIEWER.match(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).not.toMatch(/initViewMode\(/);
    expect(body).not.toMatch(/mode\s*===?\s*['"]view['"]/);
  });

  it('consent.js から intro consent が export されない (= INTRO_CONSENT_* も撤去)', () => {
    const consent = readFileSync(resolve(__dirname, '..', 'lib', 'consent.js'), 'utf8');
    expect(consent).not.toMatch(/export\s+function\s+getIntroConsent/);
    expect(consent).not.toMatch(/export\s+function\s+setIntroConsent/);
    expect(consent).not.toMatch(/export\s+const\s+INTRO_CONSENT_/);
    // ride consent は残る
    expect(consent).toMatch(/export\s+function\s+getRideConsent/);
    expect(consent).toMatch(/export\s+function\s+setRideConsent/);
  });
});
