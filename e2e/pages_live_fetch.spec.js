// brief 35 fix verify: Pages baseURL `https://yuujikamura.github.io/fujihc-trainer/` を
// 直に開いて、 配信物の fetch 経路と b35 ロード overlay の visible 化を実走 verify する。
// 既存 e2e は localhost (http://127.0.0.1:8000/) を相手に走るが、 本 spec は absolute URL で
// Pages を相手にする。 webServer 経由ではないので「配布元の本物」 が動いてるか即判別できる。
//
// 2026-05-20 user 指示「簡単なフェッチテストを書いてPages上で実行してみろ」 反映。

import { test, expect } from '@playwright/test';

const PAGES_URL = 'https://yuujikamura.github.io/fujihc-trainer/';

test('Pages live: Pages 配信物に DEM 同梱がない (= 同梱再配布禁止規律、 404 が正常)', async ({ page }) => {
  await page.goto(PAGES_URL);
  const status = await page.evaluate(async (base) => {
    const r = await fetch(`${base}static/tiles/gsi_dem/12/3622/1611.png`);
    return r.status;
  }, PAGES_URL);
  expect(status, 'Pages 配信物に DEM タイルが同梱されている = 同梱再配布で配布元規律違反').toBe(404);
});

test('Pages live: bridge endpoint は Pages 配信に存在しない (= bridge.py は別 process、 404 が正常)', async ({ page }) => {
  await page.goto(PAGES_URL);
  const status = await page.evaluate(async (base) => {
    const r = await fetch(`${base}tiles/gsi_dem/12/3622/1611.png`);
    return r.status;
  }, PAGES_URL);
  expect(status, 'Pages 配信に bridge endpoint がある = 誤った同梱経路').toBe(404);
});

test('Pages live: GSI direct DEM タイルが 200 + PNG で返る (= 訪問者単位 fetch の実 fallback 経路)', async ({ page }) => {
  await page.goto(PAGES_URL);
  const result = await page.evaluate(async () => {
    // GSI 公式の PNG 形式 DEM endpoint (= dem_png、 z=1-14 で PNG を返す)。
    // `dem` は txt 形式の endpoint で `.png` 拡張子を付けても 404 になる ── 2026-05-20 user 訂正
    // 「地形データが読み込まれてないだろ」 の root cause。
    const r = await fetch('https://cyberjapandata.gsi.go.jp/xyz/dem_png/14/14506/6418.png');
    const ct = r.headers.get('content-type') || '';
    const bytes = r.ok ? (await r.arrayBuffer()).byteLength : 0;
    return { status: r.status, contentType: ct, bytes };
  });
  expect(result.status, 'GSI direct DEM タイル取得は Pages 環境で 200').toBe(200);
  expect(result.contentType, 'GSI direct DEM は PNG content-type').toMatch(/image\/(png|x-png)/i);
  expect(result.bytes, 'GSI direct DEM PNG bytes > 0').toBeGreaterThan(0);
});

test('Pages live: viewer 起動でイントロ overlay が表示される', async ({ page }) => {
  await page.goto(PAGES_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#intro-overlay')).toContainText('どこでも富士ヒル');
  await expect(page.locator('#intro-overlay')).toContainText('.github.io');
});

test('Pages live: b35 ロード overlay が click 前の terrain probe 中に visible 化する (= 2026-05-20 fix の物理 verify)', async ({ page }) => {
  await page.goto(PAGES_URL);
  // intro overlay 表示と並行に、 module top で startTerrainProbe が走る → showLoadingOverlay 発火 →
  // #loading-indicator が visible class を獲得する。 訪問者は intro panel と進捗 overlay を同時に
  // 見ることになる (= 「動いている」 signal、 brief 35 R3 完了条件の核)。
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 15_000 });
  await expect(page.locator('#loading-indicator')).toContainText('地形タイルを取得中');
});
