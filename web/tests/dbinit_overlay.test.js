// brief 26b: dbinit-overlay DOM の物理 grep gate + index.html 構造の pin.
// viewer-maplibre.js を直接 import すると maplibre-gl global が無くて落ちるため、
// DOM 構造は source-grep で確認 + 状態遷移は単体 unit を抽出して test する.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');

describe('brief 26b: dbinit-overlay DOM 構造', () => {
  const html = readFileSync(INDEX_PATH, 'utf8');

  it('dbinit-overlay が role=dialog + aria-modal で宣言済', () => {
    expect(html).toMatch(/id="dbinit-overlay"[^>]*role="dialog"/);
    expect(html).toMatch(/id="dbinit-overlay"[^>]*aria-modal="true"/);
  });

  it('progress-bar に fill / label の 2 要素を持つ', () => {
    expect(html).toMatch(/id="dbinit-gsi-bar"[\s\S]*?class="fill"[\s\S]*?class="label"/);
    expect(html).toMatch(/id="dbinit-osm-bar"[\s\S]*?class="fill"[\s\S]*?class="label"/);
  });

  it('GSI fetch button のラベルに「約 36 秒」記載 (= brief 数値見積もり)', () => {
    expect(html).toMatch(/btnFetchGsi[\s\S]*?約 36 秒/);
  });

  it('OSM PMTiles の path input が type=text で存在', () => {
    expect(html).toMatch(/id="osmPmtilesPath"[^>]*type="text"/);
  });

  it('z-index は setup-overlay (1500) より下 (= 排他制御で隠す前提)', () => {
    expect(html).toMatch(/#dbinit-overlay\s*\{[^}]*z-index:\s*1400/);
  });
});

describe('brief 26b: viewer-maplibre.js dbinit logic snippets', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('startGsiFetch / startOsmExtract / skipDbinit の 3 関数が定義済', () => {
    expect(viewer).toMatch(/function\s+startGsiFetch\s*\(/);
    expect(viewer).toMatch(/function\s+startOsmExtract\s*\(/);
    expect(viewer).toMatch(/function\s+skipDbinit\s*\(/);
  });

  it('skipDbinit は setAppState("pairing") に遷移し、 overlay を閉じる', () => {
    // 単体 grep: skipDbinit 関数の中に hideDbinit() と setAppState('pairing') が含まれる
    const m = viewer.match(/function\s+skipDbinit\s*\(\s*\)[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/hideDbinit\(\)/);
    expect(m[0]).toMatch(/setAppState\(['"]pairing['"]\)/);
  });

  it('maybeAdvanceToPairing は idempotent flag (_advancedFromDbinit) で再入防止', () => {
    expect(viewer).toMatch(/_advancedFromDbinit/);
    const m = viewer.match(/function\s+maybeAdvanceToPairing[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/_advancedFromDbinit\s*=\s*true/);
  });

  it('updateDbinitBar / handleDbinitProgress / showDbinit / hideDbinit が定義済', () => {
    expect(viewer).toMatch(/function\s+updateDbinitBar\s*\(/);
    expect(viewer).toMatch(/function\s+handleDbinitProgress\s*\(/);
    expect(viewer).toMatch(/function\s+showDbinit\s*\(/);
    expect(viewer).toMatch(/function\s+hideDbinit\s*\(/);
  });

  it('handleDbinitProgress は phase=done で maybeAdvanceToPairing を呼ぶ', () => {
    const m = viewer.match(/function\s+handleDbinitProgress[\s\S]*?\n\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/phase\s*===?\s*['"]done['"]/);
    expect(m[0]).toMatch(/maybeAdvanceToPairing\(\)/);
  });
});
