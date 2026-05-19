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

  // 走行後画面「保存予定の内容」の先頭行 = 時間。 0:00:00 でないこと
  // (= 表示パネルの走行時間 0 バグの pin。 保存値とは別経路なので別途確認する)
  const panelTime = (await page.locator('#save-summary-list dd').first().innerText()).trim();
  expect(panelTime, '走行後画面パネルの時間').not.toBe('0:00:00');

  // 「履歴に保存」を押す → 保存完了の status が出るまで待つ
  await page.locator('#btnSaveHistory').click();
  await expect(page.locator('#postride-upload-status')).toContainText('履歴に保存', { timeout: 5_000 });

  // 「履歴を見る」→ 履歴画面に遷移
  await page.locator('#btnViewHistory').click();
  await expect(page.locator('body')).toHaveClass(/state-history/, { timeout: 5_000 });

  // 保存したライドが履歴一覧に 1 件出ている
  await expect(page.locator('#history-list li')).toHaveCount(1, { timeout: 5_000 });

  // 保存されたライドの生データ (走行距離 m / 走行時間 s / 走行ログ点数) を IndexedDB から読む。
  const saved = await page.evaluate(async ({ dbName, dbVersion, store }) => {
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
    if (!rides.length) return null;
    const r = rides[0];
    return {
      distM: r.summary ? r.summary.distance_m : null,
      durS: r.summary ? r.summary.duration_s : null,
      trkptN: Array.isArray(r.trkpts) ? r.trkpts.length : null,
    };
  }, { dbName: RIDE_DB_NAME, dbVersion: RIDE_DB_VERSION, store: RIDE_STORE });

  // 走行が記録に正しく入っているかを 距離・時間・走行ログ点数 の 3 つで確認する。
  // どれか 1 つでも 0 なら「ライダーは動いたのに記録は 0」── テストが掴んで赤くなる。
  expect(liveDistM, 'ライド中に rider が前進したか').toBeGreaterThan(0);
  expect(saved, '保存されたライドがあるか').not.toBeNull();
  expect(saved.distM, '保存された走行距離(m)').toBeGreaterThan(0);
  expect(Math.abs(saved.distM - liveDistM), '画面の距離と保存距離の差(m)').toBeLessThan(3);
  expect(saved.trkptN, '保存された走行ログの点数').toBeGreaterThan(0);
  expect(saved.durS, '保存された走行時間(秒)').toBeGreaterThan(0);
});

test('ゴール到達: viewer が固まらず、走行データが履歴に保存され閲覧できる', async ({ page }) => {
  // ?test=1 でライドが自動開始する (= トレーナー不要のテストモード)。
  await page.goto(`${VIEWER_URL}?test=1&consent=dev`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  await page.waitForFunction(() => window.__goalTest?.info?.active === true, { timeout: 20_000 });

  // 実際に 10 秒走らせて走行ログ (trkpt) を貯める。
  await page.waitForTimeout(10_000);
  // rider をゴール手前 15m へ置き、 そこから最後の区間を実際に走らせてゴール到達
  // させる (= ゴール直前から走った走行データを残す、 TEST_MODE 限定フック)。
  await page.evaluate(() => window.__goalTest.seekToNearGoal());
  await page.waitForFunction(() => window.__goalTest?.info?.atGoal === true, { timeout: 30_000 });

  // ゴール到達後も描画ループ (tick の requestAnimationFrame) が回り続けている =
  // viewer が固まっていない。 旧バグ: tick がゴールで rAF を再予約せずループが死んだ。
  const f1 = await page.evaluate(() => window.__goalTest.frames);
  await page.waitForTimeout(800);
  const f2 = await page.evaluate(() => window.__goalTest.frames);
  expect(f2 - f1, 'ゴール後も描画ループが回り続けている (= viewer が固まっていない)').toBeGreaterThan(10);

  // ゴール後は ride が非アクティブなので trkpt 蓄積は止まる ── ループが回り続けても
  // 完走後の履歴データ (lat/lon/power/hr) が IndexedDB へ増え続けないことを pin する。
  const trk1 = await page.evaluate(() => window.__goalTest.info.trkpts);
  await page.waitForTimeout(1500);
  const trk2 = await page.evaluate(() => window.__goalTest.info.trkpts);
  expect(trk2, 'ゴール後は trkpt 蓄積が止まる (= 完走後に履歴データが増え続けない)').toBe(trk1);
  expect(trk1, 'ゴールまでに実走行ログ (trkpt) が貯まっている').toBeGreaterThan(0);

  // 完走 → 既存の自動終了経路で postride オーバーレイが出る。
  await expect(page.locator('#postride-overlay')).toHaveClass(/visible/, { timeout: 10_000 });

  // 「履歴に保存」→ 保存完了の status が出る。
  await page.locator('#btnSaveHistory').click();
  await expect(page.locator('#postride-upload-status')).toContainText('履歴に保存', { timeout: 5_000 });

  // 「履歴を見る」→ 履歴画面に遷移し、 保存したライドが 1 件出ている。
  await page.locator('#btnViewHistory').click();
  await expect(page.locator('body')).toHaveClass(/state-history/, { timeout: 5_000 });
  await expect(page.locator('#history-list li')).toHaveCount(1, { timeout: 5_000 });

  // 保存されたライドが実走行データ (走行時間・走行ログ点数) を持つ
  // (= ゴール直前から走った記録が、 0 件ではなく実データとして履歴に残っている)。
  const saved = await page.evaluate(async ({ dbName, dbVersion, store }) => {
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
    if (!rides.length) return null;
    const r = rides[0];
    return {
      durS: r.summary ? r.summary.duration_s : null,
      trkptN: Array.isArray(r.trkpts) ? r.trkpts.length : null,
    };
  }, { dbName: RIDE_DB_NAME, dbVersion: RIDE_DB_VERSION, store: RIDE_STORE });
  expect(saved, '保存されたライドがある').not.toBeNull();
  expect(saved.trkptN, '保存された走行ログ (trkpt) の点数').toBeGreaterThan(0);
  expect(saved.durS, '保存された走行時間 (秒)').toBeGreaterThan(0);
});
