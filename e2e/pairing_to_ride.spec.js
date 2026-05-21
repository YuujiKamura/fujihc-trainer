// E2E test: ペアリング → ライド開始 → state-riding の一気通貫テスト
//
// 方式: Playwright + system Chrome (channel: 'chrome')
// viewer は ?test=1&consent=dev で起動:
//   - ?test=1    → initTestMode: fake client (WebSocket 不要)、500ms 後に自動 ride 開始
//   - ?consent=dev → intro overlay を物理 bypass
//
// 何を担保するか:
//   1. initTestMode → (fake client isOpen=true) → 500ms 後 startRideConfirmed() が呼ばれる
//   2. startRideConfirmed → client.sendRideStart() → ride_status:{state:'started'} が dispatch される
//   3. wsHandlers.ride_status → hidePairing() → setAppState('riding') → body.classList に state-riding
//
// shim 再実装との違い: viewer-maplibre.js の実コードをブラウザで動かしているため、
// hidePairing / setAppState / wsHandlers.ride_status を壊せばこのテストが落ちる。
// 既存 shim テスト (integration_ble_ride_start.test.js 等) は viewer のコードを import しないため
// 本体のバグを検出できない。

import { test, expect } from './base-test.js';

test('ペアリング完了 → ライド開始 → state-riding に遷移する', async ({ page }) => {
  // console.error をキャプチャして致命的 JS エラーを検出
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ?noterrain=1: 地形タイルを取得しない (= 配布元を叩かない)。 ペアリング → ライド開始の
  // 導線は地形と無関係なので、 地形ゼロでこのテストは成立する (= b40 / handoff 方針)。
  await page.goto('http://127.0.0.1:8000/?test=1&consent=dev&noterrain=1');

  // initTestMode が 500ms タイマー + ride_status:started → setAppState('riding') を経由して
  // body に state-riding を付与するまで待つ。
  // タイムアウト 20s: bootEnv (setup_status fetch) + MapLibre init + 500ms timer の合計。
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // 走行画面でクリティカルな JS エラーが出ていないこと。
  // MapLibre の tile 404 (DB が空ないし一部欠損) は許容するためフィルタする。
  // bridge の tile 系 endpoint は e2e 環境で tile DB を持たないため 404/500/501/503 を
  // 返すことがある。 これは「リソースの取得失敗」 であって viewer の JS 致命エラーでは
  // ない ── fatalErrors (= JS 致命エラーの検出) の対象から外す。 viewer 本体の JS が
  // 壊れていれば state 遷移など他の assertion が必ず先に落ちるので、 検出力は落ちない。
  const fatalErrors = consoleErrors.filter(e =>
    !e.includes('tile') && !e.includes('Tile') &&
    !e.includes('404') && !e.includes('net::ERR') &&
    !e.includes('maplibre') && !e.includes('MapLibre') &&
    !e.includes('Failed to load resource')
  );
  expect(fatalErrors).toHaveLength(0);
});
