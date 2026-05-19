// E2E test: テストモード ⇄ 本番モード 切替ボタン (task-testmode-toggle)
//
// 方式: Playwright + system Chrome (channel: 'chrome')、 ?test=1&consent=dev で起動。
//   - ?test=1     → initTestMode: fake client、 500ms 後に自動 ride → state-riding
//   - ?consent=dev → intro overlay を物理 bypass
//
// 何を担保するか:
//   1. テストモード起動時、 #mode-toggle が「テストモード」を表示する。
//   2. 切替ボタン click → reload → URL から test が外れ consent=dev は残る (= 引数保持)
//      → initBleMode に到達 (#ble-section hidden=false / #bridge-scan-section hidden=true)
//      = 本番モード。
//   3. 再度 click → reload → URL に test=1 が戻る = テストモードに復帰。
//
// viewer-maplibre.js の #mode-toggle-btn 配線は module-scoped (非 export) で unit import
// 不能。 実ブラウザで動かして behavioral に pin する ── location.search 書換行や
// buildToggledSearch 呼出を壊せばこのテストが落ちる。
// 文言は web/lib/mode_toggle.js の定数を import して照合 (= 文字列直書きの drift を防ぐ)。

import { test, expect } from '@playwright/test';
import { MODE_LABEL_TEST, MODE_LABEL_PROD } from '../web/lib/mode_toggle.js';

test('切替ボタンでテストモード ⇄ 本番モードを行き来できる', async ({ page }) => {
  // confirm ダイアログは accept する (= 本番モードは pairing 止まりで通常は発火しないが、
  // 防御的に登録 ── 走行中ガードが誤発火してもテストが hang しない)。
  page.on('dialog', (d) => d.accept());

  // --- テストモードで起動 ---
  await page.goto('http://127.0.0.1:8000/?test=1&consent=dev');
  // initTestMode → 500ms タイマー → startRideConfirmed → state-riding。
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  // 切替ボタンが可視で「テストモード」を表示。
  await expect(page.locator('#mode-toggle')).toBeVisible();
  await expect(page.locator('#mode-toggle-label')).toHaveText(MODE_LABEL_TEST);

  // --- 本番モードへ切替 ---
  await page.click('#mode-toggle-btn');
  // 本番モードは initBleMode → #ble-section を unhide / #bridge-scan-section を hide。
  // hidden プロパティを直接観測する (= overlay の display CSS に依存しない強い観測点)。
  await expect(page.locator('#ble-section')).toHaveJSProperty('hidden', false, { timeout: 20_000 });
  await expect(page.locator('#bridge-scan-section')).toHaveJSProperty('hidden', true);
  // URL: test が外れ、 consent=dev は保持されている (= buildToggledSearch の引数保持)。
  const prodUrl = new URL(page.url());
  expect(prodUrl.searchParams.has('test')).toBe(false);
  expect(prodUrl.searchParams.get('consent')).toBe('dev');
  // 切替ボタンが「本番モード」を表示。
  await expect(page.locator('#mode-toggle-label')).toHaveText(MODE_LABEL_PROD);

  // --- テストモードへ復帰 ---
  await page.click('#mode-toggle-btn');
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  const testUrl = new URL(page.url());
  expect(testUrl.searchParams.get('test')).toBe('1');
  expect(testUrl.searchParams.get('consent')).toBe('dev');
  await expect(page.locator('#mode-toggle-label')).toHaveText(MODE_LABEL_TEST);
});
