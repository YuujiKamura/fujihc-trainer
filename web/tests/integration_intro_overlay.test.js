// brief 34 ε-1 integration test: intro overlay の DOM 動作 + consent 保存 round-trip.
// 既存 vitest default (= node 環境 + 軽量 DOM mock) で書く、 happy-dom 等は導入しない。
// 検証範囲: index.html 内 overlay 構造、 consent.js の get/set/clear 一連、 hash 版管理。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  INTRO_CONSENT_HASH, INTRO_CONSENT_LS_KEY,
  getIntroConsent, setIntroConsent, clearIntroConsent,
} from '../lib/consent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const html = readFileSync(INDEX_PATH, 'utf8');

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _all() { return [...m.entries()]; },
  };
}

describe('brief 34 ε-1 integration: intro overlay 構造 + consent 保存 round-trip', () => {
  it('index.html 初期 state: <body class="state-checking"> + intro-overlay は visible class 無し (= ε-2 で起動分岐から visible 化)', () => {
    // intro-overlay は default display:none、 viewer が introConsented() === false なら
    // showIntroOverlay() で visible class を追加する設計。 HTML 初期状態は visible 無し。
    expect(html).toMatch(/<body\s+class="state-checking"/);
    // intro-overlay の素の HTML は visible class を持たない (= ε-2 で動的追加)
    const introDiv = html.match(/<div\s+id="intro-overlay"[^>]*>/);
    expect(introDiv).not.toBeNull();
    expect(introDiv[0]).not.toMatch(/visible/);
  });

  it('intro-overlay の DOM 構造: 必須 5 要素 (h2 / 4 段落以上 / btnIntroStart / btnIntroView / btnIntroClose)', () => {
    const introBlock = html.match(/<div\s+id="intro-overlay"[\s\S]*?<\/div>\s*<\/div>/);
    expect(introBlock).not.toBeNull();
    const body = introBlock[0];
    expect(body).toMatch(/<h2/);
    // 4 段落以上 (= 練習補助 / 公式無関係 / 不確実性 / ローカル完結 + trainer 必要 etc.)
    const pCount = (body.match(/<p[\s>]/g) || []).length;
    expect(pCount).toBeGreaterThanOrEqual(4);
    expect(body).toMatch(/<button[^>]*id="btnIntroStart"/);
    // brief 34 ε-8: 「コースを観る」button が追加された (= 3 ボタン化)
    expect(body).toMatch(/<button[^>]*id="btnIntroView"/);
    expect(body).toMatch(/<button[^>]*id="btnIntroClose"/);
  });

  it('round-trip: setIntroConsent → getIntroConsent で hash 一致値が返る (= 「自分の trainer で走る」click 経路)', () => {
    const storage = memStorage();
    expect(getIntroConsent({ storage })).toBe(null);
    setIntroConsent({ storage, now: () => new Date('2026-05-15T12:00:00Z') });
    const v = getIntroConsent({ storage });
    expect(v.hash).toBe(INTRO_CONSENT_HASH);
    expect(v.accepted_at).toBe('2026-05-15T12:00:00.000Z');
  });

  it('「閉じる」シナリオ (= setIntroConsent を呼ばない) → 次回 reload で再表示する状態が維持', () => {
    const storage = memStorage();
    // 「閉じる」click 経路は viewer の btnIntroClose handler 内で setIntroConsent を呼ばない設計.
    // → storage は空のまま、 次回 introConsented() は false.
    expect(getIntroConsent({ storage })).toBe(null);
    // 万が一 introConsented を check しても null (= 再表示すべき状態)
  });

  it('文言改訂時 (= hash 不一致) は再 consent 要求 → 旧 storage 値は無視される', () => {
    const storage = memStorage();
    storage.setItem(INTRO_CONSENT_LS_KEY, JSON.stringify({
      hash: 'pre-v1-older-version-hash',
      accepted_at: '2025-12-01T00:00:00Z',
    }));
    expect(getIntroConsent({ storage })).toBe(null);
  });

  it('clearIntroConsent → storage から削除 (= ε-5 の全データ削除で使う想定)', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    expect(getIntroConsent({ storage })).not.toBeNull();
    clearIntroConsent({ storage });
    expect(getIntroConsent({ storage })).toBe(null);
  });
});

describe('brief 34 ε-1 integration: intro 文言 4 軸 (= 公開ガードレールの核心メッセージ)', () => {
  it('intro 文言に「練習補助シミュレータ」 + 「公式が認定 / 後援するアプリではなく」 + 「GPS データで.*誤差」 + 「サーバ送信なし」が揃う', () => {
    expect(html).toMatch(/練習補助シミュレータ/);
    expect(html).toMatch(/公式が認定\s*\/\s*後援するアプリではなく/);
    expect(html).toMatch(/GPS データで.*誤差/);
    expect(html).toMatch(/サーバ送信なし/);
  });

  it('intro に「FTMS 対応 trainer」 + 「Web Bluetooth で直接繋」 + 「走る」モード説明が揃う (= trainer 必要の選択肢を明示)', () => {
    // brief 34 ε-8: 2 モード (= 走る / 観る) 説明に変更。 旧 「trainer 無しで出来ることはありません」は撤回、
    // 観るモードで trainer 無し訪問者にも価値を提供する設計。
    expect(html).toMatch(/FTMS 対応 trainer/);
    expect(html).toMatch(/Web Bluetooth で直接繋/);  // 「繋ぎ」「繋いで」両対応
    expect(html).toMatch(/走る/);
  });

  it('brief 34 ε-8: intro に「観る」モードの説明 (= trainer 不要 + 区間勾配 + ログなし) が含まれる', () => {
    expect(html).toMatch(/観る/);
    expect(html).toMatch(/trainer 不要/);
    expect(html).toMatch(/10 区間/);
    expect(html).toMatch(/ログ保存なし/);
  });
});

describe('brief 32 intro overlay 改修: 文言 + state attribute + BLE 未対応 message', () => {
  it('INTRO_CONSENT_HASH が v2 に bump 済 (= 文言改訂で旧 v1 の localStorage を自動 invalidation)', () => {
    expect(INTRO_CONSENT_HASH).toBe('v2-fujihill-intro-2026-05-20');
  });

  it('「どこでも富士ヒル」 lead 文言が intro-panel に landing', () => {
    expect(html).toMatch(/どこでも富士ヒル/);
  });

  it('Pages origin 誤認回避文言: URL バー / *.github.io 確認指示が intro-panel に landing', () => {
    // brief 32: Web Bluetooth chooser 前置で訪問者が URL バーの origin を確認できるよう案内する
    // (= spoof サイト経由の同意誤認回避、 b30 軸 1-4 物理化).
    expect(html).toMatch(/URL バー/);
    expect(html).toMatch(/\*\.github\.io/);
  });

  it('BLE 未対応 message DOM (#intro-ble-unsupported) が hidden 状態で landing', () => {
    // brief 32: navigator.bluetooth === undefined のブラウザ向け message。 default hidden、
    // click handler が visible 化 (= ride モード遷移を物理 block する gate の UI 部分).
    expect(html).toMatch(/<p[^>]*id="intro-ble-unsupported"[^>]*hidden/);
    expect(html).toMatch(/Web Bluetooth 未対応/);
  });

  it('#intro-overlay 初期 data-intro-state 属性 (= hidden、 showIntroOverlay で visible に書換)', () => {
    // brief 32: state を data-intro-state 属性に expose して e2e は toHaveAttribute で pin
    // (= 文言 grep だけの misleading test を回避、 drift catalog NG-R5-14 mitigation).
    const introDiv = html.match(/<div\s+id="intro-overlay"[^>]*>/);
    expect(introDiv).not.toBeNull();
    expect(introDiv[0]).toMatch(/data-intro-state="hidden"/);
  });

  it('btnIntroClose / btnIntroView / btnIntroStart の 3 ボタン構成は維持 (= 既存 DOM 破壊なし)', () => {
    // brief 32 は既存 3 button を変えない (= PROJECT-README § 既存資産優先、 brief 内「既存 DOM 名は維持」).
    expect(html).toMatch(/<button[^>]*id="btnIntroClose"/);
    expect(html).toMatch(/<button[^>]*id="btnIntroView"/);
    expect(html).toMatch(/<button[^>]*id="btnIntroStart"/);
  });
});
