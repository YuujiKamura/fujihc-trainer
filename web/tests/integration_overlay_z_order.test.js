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
    // brief 34 ε-8: section-overlay (= 観るモードの区間リスト) は consent (1460) と setup (1500) の間.
    expect(getZIndex('#section-overlay')).toBe(1470);
    expect(getZIndex('#setup-overlay')).toBe(1500);
    expect(getZIndex('#history-overlay')).toBe(1550);
    expect(getZIndex('#postride-overlay')).toBe(1600);
    expect(getZIndex('#confirm-overlay')).toBe(1700);
  });

  it('z 順序: dbinit (1400) < intro (1450) < consent (1460) < section (1470) < setup (1500) < history (1550) < postride (1600) < confirm (1700) (= 単調増加)', () => {
    const zs = [
      getZIndex('#dbinit-overlay'),
      getZIndex('#intro-overlay'),
      getZIndex('#consent-overlay'),
      getZIndex('#section-overlay'),  // brief 34 ε-8
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

  it('map load ハンドラ (onMapLoad) 内で verifyAttributionVisible を呼ぶ (= 起動 1 回限定)', () => {
    // 2026-05-17: load handler 本体を onMapLoad() に括り出した (= 'load' 永遠未発火時の
    // fallback から再利用するため)。 verifyAttributionVisible は onMapLoad 内で呼ばれ、
    // onMapLoad は map.on('load') に結線される。 起動 1 回限定の意図は不変。
    const m = VIEWER.match(/function\s+onMapLoad\s*\(\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/verifyAttributionVisible\(\)/);
    expect(VIEWER).toMatch(/map\.on\(['"]load['"]\s*,\s*onMapLoad\)/);
  });
});

describe('2026-05-17: loadCourse 起動が map "load" イベント単独依存でない (= 起動不全 regression)', () => {
  // バグ: loadCourse() が map.on('load') ハンドラ内でしか呼ばれず、 vector/pmtiles source の
  // 致命的初期化失敗 (= Range request 非対応サーバで byte-serving 失敗) で 'load' が永遠に
  // 発火しないと loadCourse が一度も走らず、 rideState 未生成 → 「描画準備中...」 overlay が
  // 永久に残る。 修正は load handler を onMapLoad() に括り出し fallback timeout から再実行。
  it('onMapLoad は 多重実行ガード (_mapLoadHandled) を持つ', () => {
    const m = VIEWER.match(/function\s+onMapLoad\s*\(\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/_mapLoadHandled/);
  });

  it("'load' 未発火に備えた fallback timeout から onMapLoad を呼ぶ", () => {
    // setTimeout(...) 内で _mapLoadHandled を見て onMapLoad() を呼ぶ fallback が存在する。
    expect(VIEWER).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}!_mapLoadHandled[\s\S]{0,200}onMapLoad\(\)/);
  });

  it('onMapLoad 内で loadCourse を呼ぶ (= course/rideState 生成は load イベント成否に非依存)', () => {
    const m = VIEWER.match(/function\s+onMapLoad\s*\(\)\s*\{[\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/loadCourse\(\)/);
  });

  it('maplibre error ログは e.error の中身 (message/url) を出す (= [object Object] にしない)', () => {
    expect(VIEWER).toMatch(/maplibre error:/);
    // e.error.message / e.error.url を拾う detail 抽出が存在する。
    expect(VIEWER).toMatch(/err\.message\s*\|\|\s*err\.url/);
  });
});

describe('brief 34 ε-6 integration: 全 overlay の HTML 初期 state (= default deny)', () => {
  it('body 初期 class は "state-checking" (= 起動直後の最小 UI)', () => {
    expect(HTML).toMatch(/<body\s+class="state-checking"/);
  });

  it('intro / consent / section / dbinit / history / postride / confirm / clear-confirm / clear-done は default で visible class 無し', () => {
    // 各 overlay の opening tag に visible class が含まれないことを確認 (= 起動直後は全 hidden、
    // setup-overlay のみ visible class が default で付く = 既存 brief 26b の挙動).
    // brief 34 ε-8: section-overlay も追加 (= default hidden、 「コースを観る」click で visible).
    for (const id of [
      'intro-overlay', 'consent-overlay', 'section-overlay', 'dbinit-overlay',
      'history-overlay', 'postride-overlay', 'confirm-overlay',
      'clear-confirm-overlay', 'clear-done-overlay',
    ]) {
      const re = new RegExp(`<div\\s+id="${id}"[^>]*class="[^"]*visible`);
      expect(HTML).not.toMatch(re);
    }
  });

  it('setup-overlay は default で class="visible" を持たない (= intro 通過後に initBleMode / connectBridge で明示付与、 2026-05-15 fix)', () => {
    // 旧 ε-1 で setup-overlay の `class="visible"` を残したまま intro-overlay を追加したため、
    // setup-overlay (z=1500) が intro-overlay (z=1450) より上に来て intro が見えない bug が発生。
    // fix: setup-overlay の default visible を撤去、 必要時 (= initBleMode / connectBridge) に
    // 明示的に classList.add('visible') する形に変更。
    expect(HTML).toMatch(/<div\s+id="setup-overlay"\s+role="dialog"/);
    expect(HTML).not.toMatch(/<div\s+id="setup-overlay"\s+class="visible"/);
  });

  it('CSP script-src self (= ε-6 で attribution 監視と同列に重要、 既存 brief 33 から維持)', () => {
    expect(HTML).toMatch(/Content-Security-Policy[^>]*script-src 'self'/);
  });

  it('brief 34 ε-10: CSP worker-src self blob (= vendored maplibre-gl.js の `setWorkerUrl(URL.createObjectURL(new Blob(...)))` 起動を許可、 観るモード遷移後の地図描画 fix)', () => {
    // script-src の fallback だけでは blob worker が block されて map 描画が空白になる症状を fix.
    // 撤回時の CI 検知用 grep pin (= directive を消したら本 test で fail).
    expect(HTML).toMatch(/Content-Security-Policy[^>]*worker-src 'self' blob:/);
  });

  it('brief 34 ε-10: CSP に script-src 維持と worker-src 追加が共存 (= 4 重 gate 維持)', () => {
    // script-src 'self' / worker-src 'self' blob: の両方が同 meta 内に存在することを直接 assert.
    // ToS-bearing な 4 重 gate (a) script-src 'self' (b) no unsafe-inline (c) vendoring (d) revokeLocalToken の
    // (a) は維持、 (b) は brief33_grep_gate で別 pin、 (c) は §11.6 で別 pin。 worker-src は (a) と独立 directive.
    const cspMatch = HTML.match(/Content-Security-Policy"\s+content="([^"]+)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch[1];
    expect(csp).toMatch(/script-src 'self'/);
    expect(csp).toMatch(/worker-src 'self' blob:/);
    // unsafe-inline が script-src / worker-src に紛れていないこと.
    const scriptSrcMatch = csp.match(/script-src[^;]*/);
    const workerSrcMatch = csp.match(/worker-src[^;]*/);
    expect(scriptSrcMatch).not.toBeNull();
    expect(workerSrcMatch).not.toBeNull();
    expect(scriptSrcMatch[0]).not.toMatch(/unsafe-inline/);
    expect(workerSrcMatch[0]).not.toMatch(/unsafe-inline/);
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
