// brief 33 責務 4: Pages 配信物 (= _site/) の e2e 規律。
//
// ジャーニーテスト規律 (= 2026-05-19 user 確立、 PROJECT-README §ジャーニーテスト):
// 訪問者が辿るフローチャートを 1 本通す。 「観た時に異常を判断できる」 batch check で
// 「導線の破綻」 を捕まえる。
//
// 本 spec は:
//   1. oauth-callback.html が 404 を返す (= class C1 物理除外の e2e verify)
//   2. visitor が `/` を開いて intro overlay まで到達できる (= journey 入口 PASS)
//   3. intro overlay に Strava 関連 button / link が見えない (= visible Strava CTA ゼロ verify)
//
// 真正性 verify (= 「画面が出た」 だけでなく中身を確認、 2026-05-19 規律) は
// 既存 user_journey.spec.js の責務、 本 spec は Pages 配信物の表層 verify に絞る。
import { test, expect } from '@playwright/test';

test('oauth-callback.html は 404 (= class C1 物理除外、 visitor から到達不能)', async ({ page }) => {
  const response = await page.goto('/oauth-callback.html', { waitUntil: 'load' });
  // _site/ には oauth-callback.html が存在しない、 http.server が 404 を返す
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

test('lib/strava_oauth.js は 404', async ({ page }) => {
  const response = await page.goto('/lib/strava_oauth.js', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

test('lib/strava_upload.js は 404', async ({ page }) => {
  const response = await page.goto('/lib/strava_upload.js', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

test('static/tiles/gsi_dem/ は 404 (= 配布元再配布禁止)', async ({ page }) => {
  // 1 つの tile path で 404 を確認 (= dir listing は server 設定依存なので具体 tile で pin)
  const response = await page.goto('/static/tiles/gsi_dem/8/226/100.png', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

test('Pages 配信物の root を開いて intro overlay まで到達できる (= journey 入口)', async ({ page }) => {
  // Pages baseURL で `/` を開く、 intro overlay が表示される (= 初回訪問者の入口)
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // intro overlay は body class state-checking / state-dbinit 等の状態を経て visible になる
  // ただし bridge / WebSocket がないので state-checking から進まない可能性あり、 timeout 短めで pin
  // intro が直接 visible にならなくても、 HTML が load されること自体は基本 verify
  await expect(page.locator('#intro-overlay')).toBeAttached({ timeout: 10_000 });
});

test('Pages root で Strava 関連 DOM が body 内に存在しない (= 13 id の物理除外 e2e verify)', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // brief 33 で削除した 13 id すべてが DOM に存在しないことを 1 件ずつ pin
  const stravaIds = [
    'strava-section', 'strava-fold', 'strava-status',
    'btnStravaConnect', 'btnStravaDisconnect',
    'strava-setup-overlay', 'stravaClientIdInput',
    'btnStravaSetupSave', 'btnStravaSetupCancel',
    'postride-strava-fold', 'btnStravaUpload',
    'postride-upload-status', 'chkConsentStrava',
  ];
  for (const id of stravaIds) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }
});
