// brief 34 ε-6 integration test: 全 overlay の z-index 順序を pin + attribution 監視を pin.
//
// 帰属表示 (= 国土地理院 / OSM / MapLibre) の動的消失監視と、 全 overlay (intro/consent/
// dbinit/setup/history/postride/confirm/clear-confirm/clear-done) の重なり順序が壊れないことを
// CSS 直 grep で固定。 z-index の数値関係を test で chain して、 1 つでも逆転したら fail。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
const VIEWER = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');

// CSS 内の z-index 抽出 helper.
function getZIndex(selector) {
  // `#selector { ... z-index: NNN ... }` を非貪欲に拾う.
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*z-index:\\s*(\\d+)', 'i');
  const m = HTML.match(re);
  return m ? parseInt(m[1], 10) : null;
}

describe('brief 34 ε-6: 全 overlay の z-index 順序が単調 (= 重なり順の不変条件)', () => {
  it('z-index 数値を CSS から抽出可能', () => {
    expect(getZIndex('#dbinit-overlay')).toBe(1400);
    expect(getZIndex('#intro-overlay')).toBe(1450);
    expect(getZIndex('#consent-overlay')).toBe(1460);
    expect(getZIndex('#setup-overlay')).toBe(1500);
    expect(getZIndex('#history-overlay')).toBe(1550);
    expect(getZIndex('#postride-overlay')).toBe(1600);
    expect(getZIndex('#confirm-overlay')).toBe(1700);
  });

  it('z 順序: dbinit (1400) < intro (1450) < consent (1460) < setup (1500) < history (1550) < postride (1600) < confirm (1700) (= 単調増加)', () => {
    const zs = [
      getZIndex('#dbinit-overlay'),
      getZIndex('#intro-overlay'),
      getZIndex('#consent-overlay'),
      getZIndex('#setup-overlay'),
      getZIndex('#history-overlay'),
      getZIndex('#postride-overlay'),
      getZIndex('#confirm-overlay'),
    ];
    for (const z of zs) expect(z).not.toBeNull();
    for (let i = 1; i < zs.length; i += 1) {
      expect(zs[i]).toBeGreaterThan(zs[i - 1]);
    }
  });

  it('clear-confirm-overlay (= ε-5 確認 dialog) は confirm-overlay と同 z-index 階層 (1700)、 clear-done-overlay はその上 (1710)', () => {
    // clear-confirm-overlay と clear-done-overlay は inline style に z-index、 CSS rule じゃない.
    const confirmMatch = HTML.match(/<div\s+id="clear-confirm-overlay"[^>]*style="[^"]*z-index:\s*(\d+)/);
    const doneMatch = HTML.match(/<div\s+id="clear-done-overlay"[^>]*style="[^"]*z-index:\s*(\d+)/);
    expect(confirmMatch).not.toBeNull();
    expect(doneMatch).not.toBeNull();
    const confirmZ = parseInt(confirmMatch[1], 10);
    const doneZ = parseInt(doneMatch[1], 10);
    expect(confirmZ).toBeGreaterThanOrEqual(1700);
    expect(doneZ).toBeGreaterThan(confirmZ);
  });

  it('loading-indicator (= z 2000) が overlay より上 (= ride 開始直前 progress 表示用)', () => {
    expect(getZIndex('#loading-indicator')).toBe(2000);
    expect(getZIndex('#loading-indicator')).toBeGreaterThan(getZIndex('#confirm-overlay'));
  });
});

describe('brief 34 ε-6: 帰属表示 (= attribution control) の動的消失監視', () => {
  it('viewer に verifyAttributionVisible 関数が定義済', () => {
    expect(VIEWER).toMatch(/function\s+verifyAttributionVisible\s*\(\s*\)/);
  });

  it('verifyAttributionVisible は .maplibregl-ctrl-attrib の display / visibility / opacity を check', () => {
    const m = VIEWER.match(/function\s+verifyAttributionVisible[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/querySelector\(['"]\.maplibregl-ctrl-attrib['"]\)/);
    expect(body).toMatch(/getComputedStyle\(/);
    expect(body).toMatch(/display\s*===?\s*['"]none['"]/);
    expect(body).toMatch(/visibility\s*===?\s*['"]hidden['"]/);
    expect(body).toMatch(/opacity/);
  });

  it('違反時は showAttributionWarning で warning banner (= block ではない、 LOAD-BEARING 上限)', () => {
    expect(VIEWER).toMatch(/function\s+showAttributionWarning\s*\(/);
    const m = VIEWER.match(/function\s+showAttributionWarning[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/console\.warn/);
    // 既存 #status を借りる軽量実装 (= 別 DOM 追加せず)
    expect(m[0]).toMatch(/getElementById\(['"]status['"]\)/);
  });

  it('map.on("load") 直後に verifyAttributionVisible を呼ぶ (= 起動 1 回限定)', () => {
    expect(VIEWER).toMatch(/map\.on\(['"]load['"][\s\S]{0,2000}verifyAttributionVisible\(\)/);
  });
});

describe('brief 34 ε-6 integration: 全 overlay の HTML 初期 state (= default deny)', () => {
  it('body 初期 class は "state-checking" (= 起動直後の最小 UI)', () => {
    expect(HTML).toMatch(/<body\s+class="state-checking"/);
  });

  it('intro / consent / dbinit / history / postride / confirm / clear-confirm / clear-done は default で visible class 無し', () => {
    // 各 overlay の opening tag に visible class が含まれないことを確認 (= 起動直後は全 hidden、
    // setup-overlay のみ visible class が default で付く = 既存 brief 26b の挙動).
    for (const id of [
      'intro-overlay', 'consent-overlay', 'dbinit-overlay',
      'history-overlay', 'postride-overlay', 'confirm-overlay',
      'clear-confirm-overlay', 'clear-done-overlay',
    ]) {
      const re = new RegExp(`<div\\s+id="${id}"[^>]*class="[^"]*visible`);
      expect(HTML).not.toMatch(re);
    }
  });

  it('setup-overlay は default visible (= 既存挙動、 brief 26b)、 ただし state-checking で hide される CSS が effective', () => {
    // setup-overlay 自体は class="visible" を持つ、 ただし body.state-checking で CSS rule
    // により hide される (= 既存 brief 26b の挙動、 ε-2 で intro overlay 通過後の遷移先).
    expect(HTML).toMatch(/<div\s+id="setup-overlay"\s+class="visible"/);
  });

  it('CSP script-src self (= ε-6 で attribution 監視と同列に重要、 既存 brief 33 から維持)', () => {
    expect(HTML).toMatch(/Content-Security-Policy[^>]*script-src 'self'/);
  });
});

describe('brief 34 ε-6 integration: intro / footer の帰属メッセージ整合 (= 公開可否の最終 gate)', () => {
  it('intro-overlay 内の帰属メッセージは「公式が認定 / 後援するアプリではなく」を含む', () => {
    expect(HTML).toMatch(/公式が認定\s*\/\s*後援するアプリではなく/);
  });

  it('intro-overlay 内の帰属メッセージは「コース起伏は富士ヒルクライム公式が一般公開している GPX を派生変換」を含む (= GPX 由来明示)', () => {
    expect(HTML).toMatch(/コース起伏は富士ヒルクライム公式が一般公開している GPX を派生変換/);
  });

  it('build_map_style の attribution に「国土地理院」「OpenStreetMap contributors」両方を含む (= ε-6 で動的消失監視と並ぶ静的 attribution)', () => {
    expect(VIEWER).toMatch(/attribution:\s*['"]国土地理院 標高タイル['"]/);
    expect(VIEWER).toMatch(/attribution:\s*['"]© OpenStreetMap contributors['"]/);
  });
});
