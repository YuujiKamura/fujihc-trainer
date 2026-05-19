// E2E test: ユーザーが通るべき道筋を規定する (= 起動 → モード選択 → モード選び直し)
//
// なぜ要るか:
//   富士ヒル viewer は初回に「走る / 観る」を選ぶ。選んだモードは localStorage に
//   保存され、次に開いたときはイントロを飛ばしてそのモードに直行する。
//   ところが「観る」を選ぶと、画面に出るのは右上の区間リストパネルだけで、
//   そこからモードを抜ける道が無い。結果、一度「観る」を選んだユーザーは
//   二度と走行(記録)モードに行けず、走行ログも保存できない trap になっていた。
//
// このテストが規定する正しい道筋:
//   1. 初回訪問: イントロ overlay が出て「走る / 観る」を選べる。
//   2. 観るモードに入った再訪ユーザーでも、画面に見える操作で
//      モード選択(イントロ)に戻れる。
//   3. 戻ったイントロで「走る」を選ぶと観るモード(body.mode-view)を抜け、
//      走行後の「履歴に保存」ボタンが使える状態になる。
//
// viewer-maplibre.js の実コードをブラウザで動かすので、導線が壊れれば落ちる。
import { test, expect } from '@playwright/test';
import { INTRO_CONSENT_HASH, INTRO_CONSENT_LS_KEY } from '../web/lib/consent.js';

const VIEWER_URL = 'http://127.0.0.1:8000/';

// localStorage に intro consent を seed して「前回そのモードを選んだ再訪ユーザー」を再現する。
// key / hash は consent.js の export 定数を使う (= 文字列を直書きしない)。
async function seedIntroConsent(page, mode) {
  await page.addInitScript(({ key, hash, m }) => {
    localStorage.setItem(key, JSON.stringify({
      hash, accepted_at: '2026-01-01T00:00:00Z', mode: m,
    }));
  }, { key: INTRO_CONSENT_LS_KEY, hash: INTRO_CONSENT_HASH, m: mode });
}

test('初回訪問: イントロが出て走る/観るを選べる', async ({ page }) => {
  // consent 未保存 (= まっさらな初回訪問) → イントロ overlay が表示される
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroStart')).toBeVisible();
  await expect(page.locator('#btnIntroView')).toBeVisible();
});

test('観るモードの再訪ユーザーが走行モードへ抜けられる', async ({ page }) => {
  // 前回「観る」を選んだ再訪ユーザーを再現
  await seedIntroConsent(page, 'view');
  await page.goto(VIEWER_URL);

  // 観るモードに入る (body.mode-view + 区間リスト panel が表示)
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 20_000 });
  await expect(page.locator('#section-list-panel')).toBeVisible();
  // 観るモードでは区間リストが並ぶ
  await expect(page.locator('#section-list li').first()).toBeVisible({ timeout: 15_000 });

  // 区間リスト panel に「最初の画面に戻る」抜け道が見えている (= trap 解消の核)
  const exitBtn = page.locator('#section-list-panel #btnViewModeExit');
  await expect(exitBtn).toBeVisible();

  // 抜け道を押す → イントロ overlay が再表示される
  await exitBtn.click();
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 5_000 });

  // イントロで「走る」を選ぶ → 観るモード (body.mode-view) を抜ける
  await page.locator('#btnIntroStart').click();
  await expect(page.locator('body')).not.toHaveClass(/mode-view/, { timeout: 10_000 });

  // 走行モードに切り替わったので「履歴に保存」ボタンが隠れていない
  // (= 観るモードでは hidden にされていた。「履歴が残らない」元凶の解消を pin する)
  const saveHidden = await page.locator('#btnSaveHistory').evaluate((el) => el.hidden);
  expect(saveHidden).toBe(false);
});
