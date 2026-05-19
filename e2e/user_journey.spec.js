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
//   4. ライド開始 → ライド終了 → 「履歴に保存」 → 「履歴を見る」で
//      保存したライドが履歴一覧に出る (= 履歴機能の通しジャーニー)。
//
// viewer-maplibre.js の実コードをブラウザで動かすので、導線が壊れれば落ちる。
import { test, expect } from '@playwright/test';
import { INTRO_CONSENT_HASH, INTRO_CONSENT_LS_KEY } from '../web/lib/consent.js';
import { RIDE_DB_NAME, RIDE_DB_VERSION, RIDE_STORE } from '../web/lib/ride_db.js';

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

test('ライド開始 → 終了 → 履歴に保存 → 履歴を見る (= 履歴機能の通しジャーニー)', async ({ page }) => {
  // ?test=1 でライドが自動開始する (= トレーナー不要のテストモード)
  await page.goto(`${VIEWER_URL}?test=1&consent=dev`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // 20 秒走らせる (= 慣性設定が大きく漕ぎ出しが遅いので、 動いたと分かる距離まで走らせる)
  await page.waitForTimeout(20_000);

  // 走行中の実距離 (= HUD の #dist、 メートル)。 user 観察「ライダーは動いた」に相当。
  const liveDistM = Number(await page.locator('#dist').innerText());

  // 「ライド終了」→ 走行後画面 (postride-overlay) が出る
  await page.locator('#btnRideEnd').click();
  await expect(page.locator('#postride-overlay')).toHaveClass(/visible/, { timeout: 10_000 });

  // 「履歴に保存」を押す → 保存完了の status が出るまで待つ
  await page.locator('#btnSaveHistory').click();
  await expect(page.locator('#postride-upload-status')).toContainText('履歴に保存', { timeout: 5_000 });

  // 「履歴を見る」→ 履歴画面に遷移
  await page.locator('#btnViewHistory').click();
  await expect(page.locator('body')).toHaveClass(/state-history/, { timeout: 5_000 });

  // 保存したライドが履歴一覧に 1 件出ている
  await expect(page.locator('#history-list li')).toHaveCount(1, { timeout: 5_000 });

  // 保存されたライドの生の走行距離 (m) を IndexedDB から読む。
  const savedDistM = await page.evaluate(async ({ dbName, dbVersion, store }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName, dbVersion);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rides = await new Promise((res, rej) => {
      const rq = db.transaction(store, 'readonly').objectStore(store).getAll();
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return rides.length && rides[0].summary ? rides[0].summary.distance_m : null;
  }, { dbName: RIDE_DB_NAME, dbVersion: RIDE_DB_VERSION, store: RIDE_STORE });

  // ライド中に rider が前進し、 その距離が記録に正しく入っていることを確認する。
  // (= 「ライダーは動いたのに記録は 0」という症状を pin する end-to-end チェック)
  expect(liveDistM, 'ライド中に rider が前進したか').toBeGreaterThan(0);
  expect(savedDistM, '保存された記録に走行距離があるか').toBeGreaterThan(0);
  // 保存された距離が画面の走行距離と一致する (= 記録が走行を取りこぼしていない)。
  // 差の許容は ride 終了クリックまでの数 m + 表示の丸め分。
  expect(Math.abs(savedDistM - liveDistM), '画面の距離と保存距離の差(m)').toBeLessThan(3);
});
