// E2E test: ユーザーが通るべき道筋を規定する (= 起動 → 地形データローダー画面 →
//   「開始」 → 地形ロード → トレーナー接続画面)。
//
// b46: 起動シーンを「地形データローダー画面」に作り変えた。 旧コードは初回に
//   「走る / 観る」 を選ばせ、 選択を localStorage (intro consent) に保存して再訪時に
//   分岐していた ── 同意記憶の有無・版による分岐が「接続 UI が出ない」 trap を生んでいた。
//   新コードでは起動シーンが一本道:
//     起動 → 地形データローダー画面 (説明 + 注意書き + 「開始」 ボタン)
//          → 「開始」 押下で地形ロード (= 進捗を画面に表示)
//          → 完了でトレーナー接続画面 (#setup-overlay) → ライド
//   観るモードはトレーナー接続画面の「コースを観る」 ボタンから入る。
//
// このテストが規定する正しい道筋:
//   1. 初回訪問: 地形データローダー画面が出て「開始」 ボタンが押せる。
//   2. 「開始」 押下で地形ロードが走り、 進捗が画面に出る。
//   3. ライド開始 → 終了 → 「履歴に保存」 → 「履歴を見る」 で履歴に出る。
//
// viewer-maplibre.js の実コードをブラウザで動かすので、 導線が壊れれば落ちる。
import { test, expect } from './base-test.js';
import { RIDE_DB_NAME, RIDE_DB_VERSION, RIDE_STORE } from '../web/lib/ride_db.js';
import { waitForPaintComplete } from './_helpers/paint_complete.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html';

test('初回訪問: 地形データローダー画面が出て「開始」 ボタンが押せる', async ({ page }) => {
  // 起動 → 地形データローダー画面 (= #intro-overlay の DOM 枠を再利用) が表示される
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await expect(page.locator('#intro-overlay')).toHaveAttribute('data-intro-state', 'visible');
  await expect(page.locator('#btnTerrainLoaderStart')).toBeVisible();
  // 走る / 観る / 閉じる の 3 ボタンは廃止されている
  await expect(page.locator('#btnIntroStart')).toHaveCount(0);
  await expect(page.locator('#btnIntroView')).toHaveCount(0);
  // アプリ説明 + GPS 誤差の注意書きが地形データローダー画面に載っている
  await expect(page.locator('#intro-overlay')).toContainText('練習補助シミュレータ');
  await expect(page.locator('#intro-overlay')).toContainText('誤差');
});

test('「開始」 ボタン押下まで地形ロード進捗が出ない (= 配布元への同意ゲート)', async ({ page }) => {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  // 押下前: 地形ロード進捗ブロックは hidden、 ロード overlay も出ていない
  await expect(page.locator('#terrain-loader-progress')).toBeHidden();
  await expect(page.locator('#loading-indicator')).not.toHaveClass(/visible/);
});

test('地形ロード完了でトレーナー接続画面 (#setup-overlay) へ遷移する', async ({ page }) => {
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_DELAY_PNG }));
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  // 地形ロード完了 → 地形ローダー画面が hide され、 トレーナー接続画面が出る。
  await expect(page.locator('#intro-overlay')).not.toHaveClass(/visible/, { timeout: 60_000 });
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 10_000 });
  // 配布元出典が常時可視 (= 国土地理院 + OpenStreetMap 利用規約の出典クレジット義務)。
  const attrib = page.locator('#attrib');
  await expect(attrib).toBeVisible();
  await expect(attrib).toContainText('国土地理院');
  await expect(attrib).toContainText('OpenStreetMap');
});

test('ライド開始 → 終了 → 履歴に保存 → 履歴を見る (= 履歴機能の通しジャーニー)', async ({ page }) => {
  // ?test=1 でライドが自動開始する (= トレーナー不要のテストモード、 地形ローダー画面を介さない開発者経路)。
  await page.goto(`${VIEWER_URL}?test=1&noterrain=1`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // b130: state-riding 遷移だけでなく実 paint 完了も pin (= MapLibre idle + minimap canvas).
  await waitForPaintComplete(page, { waitTerrainMesh: false });

  // 20 秒走らせる (= 慣性設定が大きく漕ぎ出しが遅いので、 動いたと分かる距離まで走らせる)
  await page.waitForTimeout(20_000);

  // 走行中の実距離 (= HUD の #dist、 メートル)。 user 観察「ライダーは動いた」に相当。
  const liveDistM = Number(await page.locator('#dist').innerText());

  // 「ライド終了」→ 走行後画面 (postride-overlay) が出る
  await page.locator('#btnRideEnd').click();
  await expect(page.locator('#postride-overlay')).toHaveClass(/visible/, { timeout: 10_000 });

  // 走行後画面「保存予定の内容」の先頭行 = 時間。 0:00:00 でないこと
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
  expect(liveDistM, 'ライド中に rider が前進したか').toBeGreaterThan(0);
  expect(saved, '保存されたライドがあるか').not.toBeNull();
  expect(saved.distM, '保存された走行距離(m)').toBeGreaterThan(0);
  expect(Math.abs(saved.distM - liveDistM), '画面の距離と保存距離の差(m)').toBeLessThan(3);
  expect(saved.trkptN, '保存された走行ログの点数').toBeGreaterThan(0);
  expect(saved.durS, '保存された走行時間(秒)').toBeGreaterThan(0);
});

test('ゴール到達: viewer が固まらず、走行データが履歴に保存され閲覧できる', async ({ page }) => {
  // ?test=1 でライドが自動開始する (= トレーナー不要のテストモード)。
  await page.goto(`${VIEWER_URL}?test=1&noterrain=1`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });
  await page.waitForFunction(() => window.__goalTest?.info?.active === true, { timeout: 20_000 });

  // 実際に 10 秒走らせて走行ログ (trkpt) を貯める。
  await page.waitForTimeout(10_000);
  // rider をゴール手前 15m へ置き、 そこから最後の区間を実際に走らせてゴール到達させる。
  await page.evaluate(() => window.__goalTest.seekToNearGoal());
  await page.waitForFunction(() => window.__goalTest?.info?.atGoal === true, { timeout: 30_000 });

  // ゴール到達後も描画ループ (tick の requestAnimationFrame) が回り続けている =
  // viewer が固まっていない。
  const f1 = await page.evaluate(() => window.__goalTest.frames);
  await page.waitForTimeout(800);
  const f2 = await page.evaluate(() => window.__goalTest.frames);
  expect(f2 - f1, 'ゴール後も描画ループが回り続けている (= viewer が固まっていない)').toBeGreaterThan(10);

  // ゴール後は ride が非アクティブなので trkpt 蓄積は止まる。
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

  // 保存されたライドが実走行データ (走行時間・走行ログ点数) を持つ。
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
// Narrative (ユーザ視点):
//   1. ライダーは走行モードでライドを始めた。トレーナーを漕いで進む。
//      胸に心拍計も着けている。
//   2. 富士の登りを、ずっと同じ強さで漕ぎ続けた。
//   3. 走り終えて、記録された速度の移り変わりを見た。一定の力で漕いだの
//      だから、速度はなめらかに上がって落ち着くはず。
//   4. 走った記録を履歴に保存した。
//   5. 履歴に残った速度の記録は、跳ねずになめらかだった。
//
// Catches (落ちたら何の regression か):
//   - 物理計算が心拍メッセージで「パワー 0」を掴み、足を止めた扱いの減速が
//     1 秒おきに混入して、記録速度がギザギザに振動する回帰。
//   - fake trainer が「全部入り 1 メッセージ」へ戻り、部分メッセージ経路が
//     テストで歩かれなくなる回帰。
// ============================================================

// 巡航中、 1 秒ごとの速度変化がこの値 (m/s) を超えたら「スパイク」とみなす。
const SPIKE_STEP_MPS = 0.4;

test('一定の力で漕ぐと記録速度はなめらか — 1 秒おきに跳ねるスパイクが出ない', async ({ page }) => {
  // 30 秒走行 + 保存 + 履歴 で既定 30s timeout を超えるため延長。
  test.setTimeout(80_000);

  // 1. 走行モードでライド開始 (?test=1 = fake trainer + 心拍計、 自動 ride start)。
  await page.goto(`${VIEWER_URL}?test=1&noterrain=1`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // 2. 富士の登りを 30 秒、 一定の力 (fake trainer = 150W) で漕ぎ続ける。
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
  expect(saved.avgPower, '記録された平均パワー(W)').toBeGreaterThan(120);

  // --- 速度グラフ: 走行ログの位置から 1 秒ごとの速度を復元する ---
  const tp = saved.trkpts;
  expect(tp.length, '速度を復元できる走行ログ点数').toBeGreaterThan(15);
  const speeds = [];
  const dts = [];
  let pathLen = 0;
  for (let i = 1; i < tp.length; i++) {
    const dtSec = (new Date(tp[i].t) - new Date(tp[i - 1].t)) / 1000;
    if (!(dtSec > 0)) continue;
    const latRad = (tp[i].lat * Math.PI) / 180;
    const dx = (tp[i].lon - tp[i - 1].lon) * Math.cos(latRad) * 111320;
    const dy = (tp[i].lat - tp[i - 1].lat) * 111320;
    const segM = Math.hypot(dx, dy);
    pathLen += segM;
    dts.push(dtSec);
    speeds.push(segM / dtSec);
  }

  const RAMP_SKIP = 6;
  const cruise = speeds.slice(RAMP_SKIP);
  expect(cruise.length, '巡航区間の速度サンプル数').toBeGreaterThan(10);
  const steps = [];
  for (let i = 1; i < cruise.length; i++) steps.push(Math.abs(cruise[i] - cruise[i - 1]));
  const maxStep = Math.max(...steps);
  const spikeCount = steps.filter((s) => s > SPIKE_STEP_MPS).length;

  console.log(`[J-spike] trkpt=${tp.length} dist=${saved.distM.toFixed(1)}m `
    + `avgPower=${saved.avgPower.toFixed(0)}W maxCruiseStep=${maxStep.toFixed(3)}m/s `
    + `spike=${spikeCount}/${steps.length}`);
  console.log(`[J-spike] 復元速度 km/h: ${speeds.map((v) => (v * 3.6).toFixed(1)).join(' ')}`);
  const totalDt = dts.reduce((a, b) => a + b, 0);
  console.log(`[J-diag] saved.distM=${saved.distM.toFixed(1)}m liveDist=${liveDistM}m `
    + `位置の総道のり pathLen=${pathLen.toFixed(1)}m trkpt=${tp.length} `
    + `totalDt=${totalDt.toFixed(1)}s dt[min/max]=${Math.min(...dts).toFixed(2)}/${Math.max(...dts).toFixed(2)}s`);

  expect(pathLen, '記録された位置の総道のり(m) — 走行距離(m) と一致しない = 壊れた記録')
    .toBeGreaterThan(saved.distM * 0.9);

  expect(spikeCount, '巡航中に速度が跳ねた秒数 (= スパイク、 0 が正常)').toBe(0);
});

// ====== b46 (旧 brief 35): ロード overlay の残る e2e ======
// ロード overlay の「出して、 ちゃんと消えて、 接続画面に着く」 振る舞いと、 配布元への
// 同意ゲート / IndexedDB 不在の警告だけを通す。 進捗数値 N/M や data-loading-state の
// 過渡を遅延 mock で固定するテストは廃止した ── ユーザーが見るのは「ロード中の手応え →
// 接続画面に着く」 であって、 内部カウンタ値や状態名ではない。 配布元は偽 PNG で
// intercept し 1 byte も叩かない。
const GSI_DELAY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

test('b46 happy: タイル取得完了でロード overlay が fade out してトレーナー接続画面に到達', async ({ page }) => {
  // 配布元 (GSI) を実際には叩かない ── 地形タイルを偽 PNG で intercept する。
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_DELAY_PNG }));
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  // done state に遷移 (= 全タイル取得 + map.idle or 8s fallback)。 60s 寛大 timeout。
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-indicator');
    return el && el.dataset.loadingState === 'done';
  }, { timeout: 60_000 });
  // fade out 完了で visible class が外れる。
  await expect(page.locator('#loading-indicator')).not.toHaveClass(/visible/, { timeout: 5_000 });
  // 地形ローダー画面が hide され、 トレーナー接続画面 (#setup-overlay) に到達。
  await expect(page.locator('#intro-overlay')).not.toHaveClass(/visible/);
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 10_000 });
});

test('b46 edge: IndexedDB 不在環境でロード overlay に「キャッシュが使えない」 警告 + 続行', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined });
  });
  // 配布元 (GSI) は偽 PNG で intercept ── 1 byte も叩かない。 no-cache 警告は
  // showLoadingOverlay 内で IndexedDB 不在を検出した瞬間に同期で出る (= 遅延 mock 不要)。
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_DELAY_PNG }));
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#loading-indicator')).toHaveClass(/visible/, { timeout: 10_000 });
  await expect(page.locator('#loading-indicator')).toHaveAttribute('data-loading-state', 'no-cache');
  await expect(page.locator('#loading-warning')).toBeVisible();
  await expect(page.locator('#loading-warning')).toContainText('キャッシュが使えない');
});

// ============================================================
// b124: sensor SoT 統一の振る舞い pin (= 妥協 1 の e2e 観測)
//
// 旧 viewer は trainer 報告速度を module-global currentSpeedMps 経由で #p-speed に出して
// いた。 b124 で sensor 4 値 (power / cadence / hr / trainer 報告速度) を rider に一本化した
// ため、 #p-speed は rider.speed 経由で出る。 観測対象は trainer 報告速度 (#p-speed)、
// power ではない (= 妥協 1 の対象)。
//
// test mode (?test=1) は fake trainer が 1Hz で speed_mps 付き state を push する。 ride
// 開始後、 #p-speed が初期 '--' (= index.html の静的値) から数値表記に変わることを pin。
// これが落ちる時: rider.speed への流入が壊れた / sticky 集約が cad キー違いで silent no-op に
// なった / handleTrainerStatePush の呼び順が崩れた、 のいずれか。 grep gate (= 静的解析) では
// 拾えない実 DOM の振る舞い regression を捕まえる。
//
// 配布元配慮: ?noterrain=1 で GSI 地形 fetch を skip、 base-test.js の auto fixture が
// GSI / OSM を物理 abort + 接触で fail させる。 AMeDAS (jma) は base-test の見張り対象外
// なので、 ?weather=fixed で起動時 AMeDAS fetch を designed skip し、 さらに jma host を
// page.route で明示 abort して二重に塞ぐ (= fujihc CLAUDE.md「AMeDAS を含む spec は mock
// 無しで commit しない」)。
// ============================================================
test('b124: ride 中に trainer 報告速度の HUD (#p-speed) が -- でなく数値表記になる', async ({ page }) => {
  // AMeDAS (気象庁 bosai) への起動時 fetch を物理 block (= ?weather=fixed の designed skip に
  // 加えた belt-and-suspenders、 万一 gate が regress しても配布元に 1 byte も出さない)。
  await page.route(/www\.jma\.go\.jp/, (route) => route.abort('blockedbyclient'));

  // ?test=1: fake trainer + 自動 ride 開始 (= WebSocket / BLE / DB 不要)。
  // ?noterrain=1: GSI 地形 fetch を skip。
  // ?weather=fixed&cloud*: AMeDAS fetch を skip して固定雲量を流す (= 配布元非接触)。
  await page.goto(`${VIEWER_URL}?test=1&noterrain=1&weather=fixed&cloudCover=0.3&cloudBaseM=1500&cloudTopM=3000`);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // fake trainer の state push (1Hz) が rider.speed に流れ、 #p-speed が '--' から数値表記に
  // 変わるまで待つ (= b124 の rider.speed → #p-speed 流入の物理確認)。
  await page.waitForFunction(() => {
    const el = document.getElementById('p-speed');
    return el && /^\d+(\.\d+)?$/.test((el.textContent || '').trim());
  }, { timeout: 20_000 });

  const speedText = ((await page.locator('#p-speed').textContent()) || '').trim();
  expect(speedText, 'b124: #p-speed は rider.speed 経由で数値表記 (= 妥協 1 受容、 旧 -- を出さない)').not.toBe('--');
  expect(speedText, 'b124: #p-speed は数値 (= 0.0 / 20.0 等)').toMatch(/^\d+(\.\d+)?$/);
});
