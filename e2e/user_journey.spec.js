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
  await expect(page.locator('#intro-overlay')).toHaveAttribute('data-intro-state', 'visible');
  await expect(page.locator('#btnIntroStart')).toBeVisible();
  await expect(page.locator('#btnIntroView')).toBeVisible();
  // brief 32: 文言追加分の物理 verify。
  // - 「どこでも富士ヒル」 lead = アプリ識別の核
  // - 「Web Bluetooth」 = ride モードで使う API の明示
  // - 「*.github.io」 = 配布元 origin、 訪問者に URL バー確認を促す前置 (= b30 軸 1-4 物理化)
  await expect(page.locator('#intro-overlay')).toContainText('どこでも富士ヒル');
  await expect(page.locator('#intro-overlay')).toContainText('Web Bluetooth');
  await expect(page.locator('#intro-overlay')).toContainText('.github.io');
});

test('brief 32: BLE 未対応訪問者が ride を阻まれて view モードへ完走する (= ジャーニー 1 本通し + 真正性)', async ({ page }) => {
  // brief 32 軸 7: Firefox / Safari 等の navigator.bluetooth 不在訪問者を Chromium で mock 再現。
  // ジャーニー: URL を開く → イントロ表示 → 走る を押す → 未対応 message → 観る を押す → view モードに到達。
  // 真正性: localStorage に mode='view' が永続保存されたことを最後に verify (= UI 表示だけでなく保存中身)。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { get: () => undefined });
  });
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  // terrain ready で button が一度 enabled になる (= 既存 terrain gate)。
  await expect(page.locator('#btnIntroStart')).toBeEnabled({ timeout: 20_000 });
  // click → navigator.bluetooth undefined 判定 → 未対応 message visible + button 再 disable。
  await page.locator('#btnIntroStart').click();
  await expect(page.locator('#intro-ble-unsupported')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#btnIntroStart')).toBeDisabled();
  // btnIntroView は active 維持、 ここから view モードへ実際に遷移する (= ジャーニー完走)。
  await expect(page.locator('#btnIntroView')).toBeEnabled();
  await page.locator('#btnIntroView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 10_000 });
  await expect(page.locator('#section-list-panel')).toBeVisible();

  // 真正性 verify: localStorage の intro consent に mode='view' が永続保存され、 ride モードに
  // 戻る経路 (= 再訪 → view 起動) が成立する。 「画面が出た」 だけでなく保存中身を確認 (2026-05-19 規律)。
  const consent = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), 'fujihill.consent.intro.v1');
  expect(consent.mode).toBe('view');
  expect(consent.hash).toBe('v2-fujihill-intro-2026-05-20');

  // 案内パネル抜けた直後の viewer でも配布元出典が常時可視であることを pin (= 国土地理院 + OpenStreetMap
  // 利用規約の出典クレジット義務、 view モード state でも全 state を train 通して可視を保つ規律)。
  const attrib = page.locator('#attrib');
  await expect(attrib).toBeVisible();
  await expect(attrib).toContainText('国土地理院');
  await expect(attrib).toContainText('OpenStreetMap');
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

// ============================================================
// J: 一定の力で漕ぐと、記録される速度はなめらか (スパイクしない)
//
// Actor:
//   トレーナーにまたがったライダー。胸に心拍計も着けている。
//   富士の登りを走行モードで、力を緩めず一定の強さで上っている。
//
// Narrative (ユーザ視点):
//   1. ライダーは走行モードでライドを始めた。トレーナーを漕いで進む。
//      胸に心拍計も着けている。
//   2. 富士の登りを、ずっと同じ強さで漕ぎ続けた ── 力を緩めも強めもしない。
//   3. 走り終えて、記録された速度の移り変わりを見た。一定の力で漕いだの
//      だから、速度はなめらかに上がって落ち着くはず ── 1 秒ごとに上下へ
//      跳ねるギザギザの記録ではおかしい。
//   4. 走った記録を履歴に保存した。
//   5. 履歴に残った速度の記録は、跳ねずになめらかだった。
//
// Catches (落ちたら何の regression か):
//   - 物理計算が心拍メッセージで「パワー 0」を掴み、足を止めた扱いの減速が
//     1 秒おきに混入して、記録速度がギザギザに振動する回帰。パワー計と
//     心拍計は別デバイスで、state メッセージが power だけ / hr だけ と
//     部分的に届くために起きる。
//   - fake trainer が「全部入り 1 メッセージ」へ戻り、部分メッセージ経路が
//     テストで歩かれなくなる回帰 (= 上のバグが再び不可視になる)。
//
// 物理は決定的 (乱数なし)。 速度倍率スライダーは localStorage 既定の 1.0 倍
// なので、 コースは物理速度そのもので進む (= 復元した速度 = 物理速度)。
// ============================================================

// 巡航中、 1 秒ごとの速度変化がこの値 (m/s) を超えたら「スパイク」とみなす。
// 較正値 (本テストの console.log で計測):
//   修正後 (物理が sticky power を使う): 巡航の最大ステップ 約 ?.?? m/s
//   バグ時 (物理が生 msg.power_w=0 を掴む): 約 ?.?? m/s
const SPIKE_STEP_MPS = 0.4;

test('一定の力で漕ぐと記録速度はなめらか — 1 秒おきに跳ねるスパイクが出ない', async ({ page }) => {
  // 30 秒走行 + 保存 + 履歴 で既定 30s timeout を超えるため延長。
  test.setTimeout(80_000);

  // 1. 走行モードでライド開始 (?test=1 = fake trainer + 心拍計、 自動 ride start)。
  await page.goto(`${VIEWER_URL}?test=1&consent=dev`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // 2. 富士の登りを 30 秒、 一定の力 (fake trainer = 150W) で漕ぎ続ける。
  //   fake trainer はパワー計 message と心拍計 message を交互に分けて送る
  //   (= 実機の複数デバイス構成、 ws_client.js)。 旧バグでは心拍 message のたびに
  //   物理が power=0 を掴み、 速度が 1 秒おきに上下へ振動して記録されていた。
  const RIDE_SEC = 30;
  await page.waitForTimeout(RIDE_SEC * 1000);
  const liveDistM = Number(await page.locator('#dist').innerText());

  // 4. ライド終了 → 走行後画面 → 履歴に保存。
  await page.locator('#btnRideEnd').click();
  await expect(page.locator('#postride-overlay')).toHaveClass(/visible/, { timeout: 10_000 });
  await page.locator('#btnSaveHistory').click();
  await expect(page.locator('#postride-upload-status')).toContainText('履歴に保存', { timeout: 5_000 });

  // 5. 履歴画面へ → 保存したライドが 1 件出ている。
  await page.locator('#btnViewHistory').click();
  await expect(page.locator('body')).toHaveClass(/state-history/, { timeout: 5_000 });
  await expect(page.locator('#history-list li')).toHaveCount(1, { timeout: 5_000 });

  // 保存されたライドの走行ログ (trkpt) を IndexedDB から読む。
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
    const powers = Array.isArray(r.trkpts)
      ? r.trkpts.map((p) => p.power).filter((v) => Number.isFinite(v)) : [];
    return {
      distM: r.summary ? r.summary.distance_m : null,
      durS: r.summary ? r.summary.duration_s : null,
      trkpts: Array.isArray(r.trkpts)
        ? r.trkpts.map((p) => ({ t: p.t, lat: p.lat, lon: p.lon })) : [],
      avgPower: powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : null,
    };
  }, { dbName: RIDE_DB_NAME, dbVersion: RIDE_DB_VERSION, store: RIDE_STORE });

  // --- まともな記録が残っているか (基本健全性) ---
  expect(saved, '保存されたライドがある').not.toBeNull();
  expect(saved.distM, '保存された走行距離(m)').toBeGreaterThan(10);
  expect(saved.durS, '保存された走行時間(秒)').toBeGreaterThan(0);
  expect(Math.abs(saved.distM - liveDistM), '画面の距離と保存距離の差(m)').toBeLessThan(3);
  // 物理が壊れても power 記録自体は正しい (= バグは速度側) ことを pin する。
  expect(saved.avgPower, '記録された平均パワー(W)').toBeGreaterThan(120);

  // --- 速度グラフ: 走行ログの位置から 1 秒ごとの速度を復元する ---
  // trkpt は緯度経度しか持たないので、 連続 2 点の距離 ÷ 経過秒 = その秒の速度。
  // (Strava が結果ページで描く速度グラフと同じ導出。)
  const tp = saved.trkpts;
  expect(tp.length, '速度を復元できる走行ログ点数').toBeGreaterThan(15);
  const speeds = [];
  const dts = [];
  let pathLen = 0;  // 記録された位置 (緯度経度) を順につないだ総道のり (m)
  for (let i = 1; i < tp.length; i++) {
    const dtSec = (new Date(tp[i].t) - new Date(tp[i - 1].t)) / 1000;
    if (!(dtSec > 0)) continue;
    // 数 m スケールでは平面近似で十分 (緯度 35 度)。
    const latRad = (tp[i].lat * Math.PI) / 180;
    const dx = (tp[i].lon - tp[i - 1].lon) * Math.cos(latRad) * 111320;
    const dy = (tp[i].lat - tp[i - 1].lat) * 111320;
    const segM = Math.hypot(dx, dy);
    pathLen += segM;
    dts.push(dtSec);
    speeds.push(segM / dtSec);
  }

  // 漕ぎ出しの加速 (最初の数秒) はなめらかに上がって当然なので除外し、
  // 巡航に入ったあとの「秒ごとの速度変化」を見る。 一定パワーで巡航中なら
  // コース勾配の変化につれてゆるやかに動くだけ ── 1 秒で大きく跳ねたら
  // それがスパイク (= 物理 0W バグの 1 秒おきの振動)。
  const RAMP_SKIP = 6;
  const cruise = speeds.slice(RAMP_SKIP);
  expect(cruise.length, '巡航区間の速度サンプル数').toBeGreaterThan(10);
  const steps = [];
  for (let i = 1; i < cruise.length; i++) steps.push(Math.abs(cruise[i] - cruise[i - 1]));
  const maxStep = Math.max(...steps);
  const spikeCount = steps.filter((s) => s > SPIKE_STEP_MPS).length;

  // 記録された速度グラフをそのまま出す (= 「まともかどうか」を目で見られるように)。
  console.log(`[J-spike] trkpt=${tp.length} dist=${saved.distM.toFixed(1)}m `
    + `avgPower=${saved.avgPower.toFixed(0)}W maxCruiseStep=${maxStep.toFixed(3)}m/s `
    + `spike=${spikeCount}/${steps.length}`);
  console.log(`[J-spike] 復元速度 km/h: ${speeds.map((v) => (v * 3.6).toFixed(1)).join(' ')}`);
  const totalDt = dts.reduce((a, b) => a + b, 0);
  console.log(`[J-diag] saved.distM=${saved.distM.toFixed(1)}m liveDist=${liveDistM}m `
    + `位置の総道のり pathLen=${pathLen.toFixed(1)}m trkpt=${tp.length} `
    + `totalDt=${totalDt.toFixed(1)}s dt[min/max]=${Math.min(...dts).toFixed(2)}/${Math.max(...dts).toFixed(2)}s`);

  // --- 記録の距離と、記録された位置がたどる道のりが一致するか (= まともな記録の核) ---
  // 距離欄に 52m と書いてあるのに、 記録された緯度経度が 16m ぶんしか動いていない、
  // のような食い違いは「壊れた記録」── Strava 等は位置から地図/距離を再構成するので、
  // 距離欄ではなく位置が正なら、 ライドは丸ごと縮む。 連続 trkpt の haversine を
  // 足した pathLen は、 記録距離 distM とほぼ一致するはず (差は道の曲がりぶんのみ)。
  expect(pathLen, '記録された位置の総道のり(m) — 走行距離(m) と一致しない = 壊れた記録')
    .toBeGreaterThan(saved.distM * 0.9);

  // 一定パワーで巡航中、 速度が 1 秒で大きく跳ねる箇所は無い。
  // 旧バグ (心拍 message で物理 power=0) では 1 秒おきに振動 → spike が多発する。
  expect(spikeCount, '巡航中に速度が跳ねた秒数 (= スパイク、 0 が正常)').toBe(0);
});

// ====== brief 35: ロード overlay ジャーニーテスト (happy 3 + edge 3) ======
// 公開後実画面で「タイルのロード画面自体がない」 と発見された UX 問題への対策を
// pin する。 案内パネル抜け直後の view モード起動で、 訪問者がタイル取得進捗を
// 進捗数値 + 進捗バー + 注記で確認できる導線を 1 本通す。 真正性 (= 保存中身) は
// tile_load_budget.spec.js 側で別途 pin する。

// 進捗が永遠に来ない時の挙動を mock するための GSI fetch delay。
// 30s で fulfill するが、 viewer 側の 10s 無音 detector がそれ以前に発火する。
const GSI_DELAY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

test('brief 35 happy: view モード起動でロード overlay が表示される', async ({ page }) => {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 5_000 });
  // 初期 state は idle / loading / no-cache (= IndexedDB 環境依存) のいずれか。
  await expect(page.locator('#loading-indicator')).toHaveAttribute('data-loading-state', /(idle|loading|no-cache)/);
  // 「地形タイルを取得中」 lead が出ている (= 「描画準備中...」 の旧文言を上書き)。
  await expect(page.locator('#loading-indicator')).toContainText('地形タイルを取得中');
});

test('brief 35 happy: ロード overlay の進捗数値が 0 から増えて den は course 動的算出値', async ({ page }) => {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 5_000 });
  // num が 1 以上に上がる (= onProgress 発火、 fetch が走ったか cache hit か)
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-progress-num');
    return el && Number(el.textContent) >= 1;
  }, { timeout: 60_000 });
  // den は tileRangeForBounds で動的算出、 1 <= den <= MAX_TILES (200)
  const den = Number(await page.locator('#loading-progress-den').textContent());
  expect(den, '`#loading-progress-den` は tileRangeForBounds(course bounds, DEM_ZOOM).count').toBeGreaterThanOrEqual(1);
  expect(den, '`#loading-progress-den` は MAX_TILES = 200 を超えない').toBeLessThanOrEqual(200);
});

test('brief 35 happy: タイル取得完了でロード overlay が fade out して viewer に到達', async ({ page }) => {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  // done state に遷移 (= 全タイル取得 + map.idle or 8s fallback)。 60s 寛大 timeout。
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-indicator');
    return el && el.dataset.loadingState === 'done';
  }, { timeout: 60_000 });
  // fade out 完了で visible class が外れる。
  await expect(page.locator('#loading-indicator')).not.toHaveClass(/visible/, { timeout: 5_000 });
  // view モードに完走 (= body.mode-view + 区間リスト visible)。
  await expect(page.locator('body')).toHaveClass(/mode-view/);
  await expect(page.locator('#section-list-panel')).toBeVisible();
});

test('brief 35 edge: GSI 通信無音 10s でロード overlay が silent state + 諦め button visible', async ({ page }) => {
  // GSI / bridge の全タイル fetch を 30s delay (= 進捗が 10s 以内に来ない状況を mock)
  const delayFulfill = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.fulfill({ status: 200, contentType: 'image/png', body: GSI_DELAY_PNG });
  };
  // bridge と同梱経路は 404、 GSI direct のみ delay。 bridge fail → GSI direct fallback → 30s wait
  // 経路で「onProgress 発火しない」 = 無音状態を mock する。 既存 simulatePagesNoBridge と同じ
  // 設計だが、 GSI direct を 404 ではなく 30s delay にしている (= 「fetch 中、 応答が返らない」 を再現)。
  await page.route(`${VIEWER_URL}static/tiles/gsi_dem/**`, route => route.fulfill({ status: 404 }));
  await page.route(`${VIEWER_URL}tiles/gsi_dem/**`, route => route.fulfill({ status: 404 }));
  await page.route('https://cyberjapandata.gsi.go.jp/**', delayFulfill);
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 5_000 });
  // 10s 無音 → silent state 遷移 + 警告文言 + 諦め button visible
  await expect(page.locator('#loading-indicator')).toHaveAttribute('data-loading-state', 'silent', { timeout: 15_000 });
  await expect(page.locator('#loading-warning')).toBeVisible();
  await expect(page.locator('#btnLoadingGiveUp')).toBeVisible();
});

test('brief 35 edge: IndexedDB 不在環境でロード overlay に「キャッシュが使えない」 警告 + 続行', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined });
  });
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 5_000 });
  await expect(page.locator('#loading-indicator')).toHaveAttribute('data-loading-state', 'no-cache');
  await expect(page.locator('#loading-warning')).toBeVisible();
  await expect(page.locator('#loading-warning')).toContainText('キャッシュが使えない');
});

test('brief 35 edge: 諦め button click でロード overlay が即時消えて viewer 続行', async ({ page }) => {
  const delayFulfill = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.fulfill({ status: 200, contentType: 'image/png', body: GSI_DELAY_PNG });
  };
  // bridge と同梱経路は 404、 GSI direct のみ delay。 bridge fail → GSI direct fallback → 30s wait
  // 経路で「onProgress 発火しない」 = 無音状態を mock する。 既存 simulatePagesNoBridge と同じ
  // 設計だが、 GSI direct を 404 ではなく 30s delay にしている (= 「fetch 中、 応答が返らない」 を再現)。
  await page.route(`${VIEWER_URL}static/tiles/gsi_dem/**`, route => route.fulfill({ status: 404 }));
  await page.route(`${VIEWER_URL}tiles/gsi_dem/**`, route => route.fulfill({ status: 404 }));
  await page.route('https://cyberjapandata.gsi.go.jp/**', delayFulfill);
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#btnIntroView')).toBeEnabled({ timeout: 20_000 });
  await page.locator('#btnIntroView').click();
  // 10s 無音で諦め button visible
  await expect(page.locator('#btnLoadingGiveUp')).toBeVisible({ timeout: 15_000 });
  await page.locator('#btnLoadingGiveUp').click();
  // overlay が fade out して visible class が外れる
  await expect(page.locator('#loading-indicator')).not.toHaveClass(/visible/, { timeout: 3_000 });
});
