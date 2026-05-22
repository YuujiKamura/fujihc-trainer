// 配布元境界規律 (= b36 配布元境界): 本 spec は実 GSI / OSM endpoint を叩く。
// CI 自動経路 (= push / pull_request / schedule trigger) からは絶対に走らせない、
// `workflow_dispatch` (= .github/workflows/pages-live-verify.yml) からの手動 trigger のみ。
// extraHTTPHeaders の User-Agent には開発者本人の email を埋める (= 配布元が連絡できる form)。
// 詳細: CLAUDE.md § 考え方 / b36-tile-distributor-courtesy.md
//
// brief 35 fix verify: Pages baseURL `https://yuujikamura.github.io/fujihc-trainer/` を
// 直に開いて、 配信物の fetch 経路と b35 ロード overlay の visible 化を実走 verify する。
// 既存 e2e は localhost (http://127.0.0.1:8000/) を相手に走るが、 本 spec は absolute URL で
// Pages を相手にする。 webServer 経由ではないので「配布元の本物」 が動いてるか即判別できる。

import { test, expect } from '@playwright/test';

const PAGES_URL = 'https://yuujikamura.github.io/fujihc-trainer/';

// b36 配布元境界規律: extraHTTPHeaders で email を User-Agent に埋め込み、 配布元が heavy user に
// 連絡できる form を強制する。 `LIVE_VERIFY_EMAIL` 不在のローカル実行では `no-email-set-running-locally`
// が出て開発者が気付く手がかりになる。 CI からは pages-live-verify.yml workflow が env を渡す。
test.use({
  extraHTTPHeaders: {
    'User-Agent': `fujihc-trainer-live-verify/0.1 (${process.env.LIVE_VERIFY_EMAIL || 'no-email-set-running-locally'})`,
  },
});

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
    // GSI 公式の PNG 形式 DEM endpoint (= b59 で dem5a_png、 z15 が native 上限で PNG を返す)。
    // `dem` は txt 形式の endpoint で `.png` 拡張子を付けても 404 になる ── 2026-05-20 user 訂正
    // 「地形データが読み込まれてないだろ」 の root cause。
    // b40 直し2: タイル本体 (PNG 数 KB) を丸ごと落とす GET をやめ、 HEAD で status と
    // レスポンスヘッダだけ取る (= 配布元への負荷を最小化、 user 指示「ハンドシェイクだけでいい」)。
    // 座標は富士スバルライン中腹の z15 dem5a タイル (= viewer の実 fallback 経路と一致)。
    const r = await fetch('https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/15/29012/12935.png', { method: 'HEAD' });
    const ct = r.headers.get('content-type') || '';
    const len = r.headers.get('content-length');
    return { status: r.status, contentType: ct, contentLength: len };
  });
  expect(result.status, 'GSI direct DEM タイル取得は Pages 環境で 200').toBe(200);
  expect(result.contentType, 'GSI direct DEM は PNG content-type').toMatch(/image\/(png|x-png)/i);
  // 死活検知は弱めない: content-length が返ればタイル本体が在る証拠として正の整数を確認する。
  // HEAD に content-length を返さないサーバの時のみ status + content-type に留め、
  // GET でのタイル本体ダウンロードには戻さない (= 配布元負荷を増やさない)。
  if (result.contentLength !== null) {
    expect(Number(result.contentLength), 'GSI direct DEM の content-length が正の整数').toBeGreaterThan(0);
  }
});

test('Pages live: viewer 起動で地形データローダー画面が表示される', async ({ page }) => {
  // b46: 起動シーンの第一段は地形データローダー画面 (= #intro-overlay の DOM 枠を再利用)。
  await page.goto(PAGES_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#intro-overlay')).toContainText('どこでも富士ヒル');
  await expect(page.locator('#btnTerrainLoaderStart')).toBeVisible();
});

test('Pages live: 「開始」 押下で terrain probe が走りロード overlay が visible 化する', async ({ page }) => {
  // b46: 地形ロードの起点を module-top 自動起動から「開始」 ボタン押下へ移した。
  //   「開始」 を押すと startTerrainPhase が走り → showLoadingOverlay 発火 →
  //   #loading-indicator が visible class を獲得する (= 配布元への取得がユーザー操作の後)。
  await page.goto(PAGES_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 15_000 });
  await expect(page.locator('#loading-indicator')).toContainText('地形タイルを取得中');
});
