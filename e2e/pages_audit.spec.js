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
//
// b130: 本 spec は配信物の HTTP / DOM 表層検証中心、 paint 完了 assert は不要 (= YAGNI).
import { test, expect } from './base-test.js';

test('oauth-callback.html は 404 (= class C1 物理除外、 visitor から到達不能)', async ({ page }) => {
  const response = await page.goto('/oauth-callback.html', { waitUntil: 'load' });
  // _site/ には oauth-callback.html が存在しない、 http.server が 404 を返す
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

// 2026-05-20 fix: viewer-maplibre.js が strava_oauth.js を import するので source 配信維持、
// Strava endpoint への通信は CSP で block する 2 段構え (= 既存 test「strava CDN URL が
// 消えている」 + CSP の connect-src から *.strava.com 削除で物理化済)。
test('lib/strava_oauth.js は 200 配信 (= viewer import 経路維持)', async ({ page }) => {
  const response = await page.goto('/lib/strava_oauth.js', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(200);
});

test('lib/strava_upload.js は 200 配信 (= 同上)', async ({ page }) => {
  const response = await page.goto('/lib/strava_upload.js', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(200);
});

test('static/tiles/gsi_dem/ は 404 (= 配布元再配布禁止)', async ({ page }) => {
  // 1 つの tile path で 404 を確認 (= dir listing は server 設定依存なので具体 tile で pin)
  const response = await page.goto('/static/tiles/gsi_dem/8/226/100.png', { waitUntil: 'load' });
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
});

test('Pages 配信物の root を開いて intro overlay まで到達できる (= journey 入口)', async ({ page }) => {
  // Pages baseURL で `/` を開く、 intro overlay が表示される (= 初回訪問者の入口)。
  // ?noterrain=1: pages.yml は push 連動で走る ── viewer に配布元 (国土地理院) タイルを
  // 取得させない。 push のたびに実 GSI を叩くのは repo CLAUDE.md「実 endpoint を叩く test は
  // 手動 trigger のみ」 違反、 base-test.js の見張りもそれを赤で出す。 intro overlay の
  // 到達確認は地形と無関係なので noterrain で成立する。
  await page.goto('/?noterrain=1', { waitUntil: 'domcontentloaded' });
  // intro overlay は body class state-checking / state-dbinit 等の状態を経て visible になる
  // ただし bridge / WebSocket がないので state-checking から進まない可能性あり、 timeout 短めで pin
  // intro が直接 visible にならなくても、 HTML が load されること自体は基本 verify
  await expect(page.locator('#intro-overlay')).toBeAttached({ timeout: 10_000 });
});

test('Pages root で Strava 関連 DOM が body 内に存在しない (= 13 id の物理除外 e2e verify)', async ({ page }) => {
  // ?noterrain=1: 上と同じ ── push 連動 CI で配布元を叩かない。 Strava DOM の不在確認は地形と無関係。
  await page.goto('/?noterrain=1', { waitUntil: 'domcontentloaded' });
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
