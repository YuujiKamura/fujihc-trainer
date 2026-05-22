// 配布元境界規律 (= b36 配布元境界): 本 spec は実 GSI / OSM endpoint を叩く。
// CI 自動経路 (= push / pull_request / schedule trigger) からは絶対に走らせない、
// `workflow_dispatch` (= .github/workflows/pages-live-verify.yml) からの手動 trigger のみ。
// extraHTTPHeaders の User-Agent には開発者本人の email を埋める (= 配布元が連絡できる form)。
// 詳細: CLAUDE.md § 考え方 / b36-tile-distributor-courtesy.md
//
// brief 35 root cause 調査: 「プログレスバー 100% なのに地形が出ない」 を Pages live で再現。
// 「コースを観る」 click 後に地形 mesh が描画されるか目視 + canvas pixel で機械 verify する。

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const PAGES_URL = 'https://yuujikamura.github.io/fujihc-trainer/';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTDIR = resolve(__dirname, '..', 'test-results', 'pages-live-terrain');

// b36 配布元境界規律: extraHTTPHeaders で email を User-Agent に埋め込み、 配布元が heavy user に
// 連絡できる form を強制する。
test.use({
  extraHTTPHeaders: {
    'User-Agent': `fujihc-trainer-live-verify/0.1 (${process.env.LIVE_VERIFY_EMAIL || 'no-email-set-running-locally'})`,
  },
});

test.beforeAll(() => { try { mkdirSync(OUTDIR, { recursive: true }); } catch {} });

test('Pages live: 「コースを観る」 click 後に view モードに到達し canvas が真っ黒でない', async ({ page }) => {
  const consoleLog = [];
  const failedRequests = [];
  page.on('console', (msg) => consoleLog.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => consoleLog.push(`[pageerror] ${err.message}`));
  page.on('response', (resp) => {
    if (!resp.ok() && resp.status() !== 304) {
      failedRequests.push(`${resp.status()} ${resp.url()}`);
    }
  });

  await page.goto(PAGES_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.screenshot({ path: `${OUTDIR}/01-intro-overlay.png`, fullPage: false });

  // b46: 「開始」 押下で地形ロード起動 → 完了でトレーナー接続画面 (#setup-overlay) へ。
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 60_000 });
  await page.screenshot({ path: `${OUTDIR}/02-setup-overlay.png`, fullPage: false });

  // トレーナー接続画面の「コースを観る」 で観るモードへ入る (= 地形 mesh 描画を観る)。
  await expect(page.locator('#btnSetupGoView')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 10_000 });
  await page.waitForTimeout(8000);  // map.idle + mesh build までの猶予
  await page.screenshot({ path: `${OUTDIR}/03-after-view-click.png`, fullPage: false });

  const bytes = await screenshotBytes(page);
  console.log(`[terrain render] viewport screenshot bytes = ${bytes.length} (threshold = ${RENDERED_SIZE_THRESHOLD})`);
  console.log('[terrain render] failed requests count:', failedRequests.length);
  console.log('[terrain render] browser console (tail 10):', consoleLog.slice(-10).join('\n'));
  expect(bytes.length, `viewport screenshot bytes (= intro state ≒ 64KB / 地形描画 ≒ 227KB、 ${RENDERED_SIZE_THRESHOLD} byte 超で描画あり)`).toBeGreaterThan(RENDERED_SIZE_THRESHOLD);
});

// 画面 screenshot の PNG bytes で「地形描画あり vs intro state」 を判別する。
// WebGL canvas の readPixels は context option (= preserveDrawingBuffer) が後付け効かず
// 空 buffer を返すため、 playwright 経由の screenshot bytes で判定する。 baseline:
// intro overlay 表示中の viewport screenshot ≒ 64 KB、 地形描画後 ≒ 227 KB と 3 倍以上の差、
// threshold 150 KB で明確に判別可能。
const RENDERED_SIZE_THRESHOLD = 150_000;

async function screenshotBytes(page) {
  return await page.screenshot({ type: 'png', fullPage: false });
}

test('Pages live: 初回 fresh load (= cache 全 clear) で地形 mesh が canvas に描画される (= 「初回出ない」 user 報告の切り分け)', async ({ page, context }) => {
  // Service Worker / Cache API / IndexedDB を全 clear して fresh fetch 経路を強制する。
  // user 訂正「初回の時は出来てなかったと思う」 の切り分けで、 cache に依存しないで描画が成り立つか
  // pin する。 SW がタイルを cache 配信して「動いている」 ように見える幻を排除する verify。
  await page.goto(PAGES_URL);
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch {} }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) { try { await caches.delete(k); } catch {} }
    }
    await new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase('fujihc-tile-cache');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      } catch { resolve(); }
    });
  });
  // 再度 navigate で fresh state を確定 (= SW unregister 後の clean load)。
  await page.goto(`${PAGES_URL}?_fresh=${Date.now()}`);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  // b46: 「開始」 押下で地形ロード → 完了でトレーナー接続画面 → 「コースを観る」 で観るモード。
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 90_000 });
  await page.screenshot({ path: `${OUTDIR}/fresh-01-setup-overlay.png` });
  await expect(page.locator('#btnSetupGoView')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 10_000 });
  await page.waitForTimeout(10_000);
  await page.screenshot({ path: `${OUTDIR}/fresh-02-after-view-click.png` });
  const bytes = await screenshotBytes(page);
  console.log(`[fresh load] viewport screenshot bytes = ${bytes.length}`);
  expect(bytes.length, '初回 fresh load (= cache 全 clear) で viewport screenshot が地形描画 baseline (150KB) 超').toBeGreaterThan(RENDERED_SIZE_THRESHOLD);
});

test('Pages live: 再訪 (= cache hit) でも地形 mesh が canvas に描画される', async ({ page }) => {
  // 1 回目: cache 充填まで走らせる
  await page.goto(PAGES_URL);
  // b46: 「開始」 → 地形ロード → トレーナー接続画面 → 「コースを観る」 で観るモード。
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 90_000 });
  await expect(page.locator('#btnSetupGoView')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 10_000 });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: `${OUTDIR}/cache-01-first-visit-rendered.png` });
  const firstBytes = await screenshotBytes(page);
  console.log(`[cache 1st] viewport screenshot bytes = ${firstBytes.length}`);
  expect(firstBytes.length, '1 回目で地形描画').toBeGreaterThan(RENDERED_SIZE_THRESHOLD);

  // 2 回目: 再訪で IndexedDB cache hit。 b46 で起動シーンが一本道のため journey を再度踏む。
  await page.goto(PAGES_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 60_000 });
  await expect(page.locator('#btnSetupGoView')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 20_000 });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: `${OUTDIR}/cache-02-second-visit-rendered.png` });
  const secondBytes = await screenshotBytes(page);
  console.log(`[cache 2nd] viewport screenshot bytes = ${secondBytes.length}`);
  expect(secondBytes.length, '2 回目 (= cache hit) でも地形描画').toBeGreaterThan(RENDERED_SIZE_THRESHOLD);
});
