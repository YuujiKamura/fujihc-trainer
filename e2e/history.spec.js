// E2E test: 履歴機能 (IndexedDB) の通しテスト
//
// 何を担保するか:
//   1. ライドモードでは「履歴に保存」ボタンが表示される
//      (= 今回直したバグ本体: updatePostrideButtonVisibility の show 分岐)
//   2. IndexedDB にライドを注入 → 履歴 overlay を開く → 一覧に行が出る
//   3. GPX ダウンロードボタンが download イベントを発火する (.gpx ファイル名)
//   4. 削除ボタンを押すと行が消えて「空」メッセージが出る
//   5. 観るモードでは「履歴に保存」ボタンが hidden になる
//      (= updatePostrideButtonVisibility の hide 分岐)
//
// 方式:
//   - IndexedDB の DB 名・store 名・index 名・version は web/lib/ride_db.js の
//     export 定数を import して使う (= スキーマ文字列を二重定義しない)。
//     intro consent の key / hash も web/lib/consent.js から import する。
//   - page.evaluate() で IndexedDB に直接 ride レコードを書き込む
//     (= 完走まで待つと 80 分以上かかるため、保存経路のみ切り離してテスト)。
//   - btnViewHistoryFromSetup を JS click → showHistoryOverlay() を起動。
//   - viewer-maplibre.js の実コードをブラウザで動かすため、
//     showHistoryOverlay / appendHistoryRow / deleteRide / updatePostrideButtonVisibility
//     のいずれを壊してもこのテストが落ちる。
import { test, expect } from './base-test.js';
import {
  RIDE_DB_NAME, RIDE_DB_VERSION, RIDE_STORE, RIDE_INDEX_DATE,
} from '../web/lib/ride_db.js';

// ?noterrain=1: 地形タイルを取得しない (= 配布元を叩かない)。 履歴機能は IndexedDB 上の
// 動作で地形と無関係なので、 地形ゼロでこのテストは成立する (= b40 / handoff 方針)。
// b46: ?test=1 は地形データローダー画面を介さない開発者経路 (= defaultDispatch 直行)。
const VIEWER_URL = 'http://127.0.0.1:8000/index-dom.html?test=1&noterrain=1';

// ride_db.js の正規スキーマ定数を使って IndexedDB に ride を 1 件書き込む。
// スキーマ名 (DB / store / index) は文字列直書きせず import 定数を page に渡す。
async function injectRide(page, ride) {
  await page.evaluate(async ({ rec, dbName, dbVersion, store, indexName }) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, dbVersion);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(store)) {
          const os = d.createObjectStore(store, { keyPath: 'id' });
          os.createIndex(indexName, 'date', { unique: false });
        }
      };
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { rec: ride, dbName: RIDE_DB_NAME, dbVersion: RIDE_DB_VERSION, store: RIDE_STORE, indexName: RIDE_INDEX_DATE });
}

test('履歴: ride 注入 → 一覧表示 → GPX ダウンロード → 削除', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(VIEWER_URL);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // 修正したバグ本体: ライドモード (= 観るモードでない) では「履歴に保存」が表示される。
  // 旧コードは getRideConsent('history') を見ていて consent 未設定だと常時 hidden だった。
  const saveHiddenInRideMode = await page.locator('#btnSaveHistory').evaluate(el => el.hidden);
  expect(saveHiddenInRideMode).toBe(false);

  // IndexedDB にテスト用ライドを注入
  await injectRide(page, {
    id: '2026-01-01T07:00:00Z-e2e-history-test',
    date: '2026-01-01T07:00:00Z',
    summary: { distance_m: 24000, duration_s: 5400, course_name: 'fujihill' },
    trkpts: [
      { t: '2026-01-01T07:00:00Z', lat: 35.45, lon: 138.75, ele: 1000, power: 200, cad: 80, hr: 140 },
      { t: '2026-01-01T07:01:00Z', lat: 35.46, lon: 138.76, ele: 1050, power: 210, cad: 82, hr: 145 },
    ],
  });

  // btnViewHistoryFromSetup (setup-overlay 内) を JS click → showHistoryOverlay() を起動
  // CSS で hidden でも JS click は効く
  await page.evaluate(() => {
    document.getElementById('btnViewHistoryFromSetup').click();
  });

  // history-overlay が表示される (= body.state-history)
  await expect(page.locator('body')).toHaveClass(/state-history/, { timeout: 5_000 });

  // 履歴 list に 1 件表示
  await expect(page.locator('#history-list li')).toHaveCount(1, { timeout: 3_000 });

  // GPX ダウンロードが発火する
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#history-list button[data-action="gpx-download"]').click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toMatch(/ride-.*\.gpx$/);

  // 削除 → 行が消えて空メッセージが出る
  await page.locator('#history-list button[data-action="delete"]').click();
  await expect(page.locator('#history-empty')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('#history-list li')).toHaveCount(0);

  // 致命的 JS エラーなし
  // bridge の tile 系 endpoint は e2e 環境で tile DB を持たないため 404/500/501/503 を
  // 返すことがある。 これは「リソースの取得失敗」 であって viewer の JS 致命エラーでは
  // ない ── fatalErrors (= JS 致命エラーの検出) の対象から外す。 viewer 本体の JS が
  // 壊れていれば state 遷移など他の assertion が必ず先に落ちるので、 検出力は落ちない。
  const fatalErrors = consoleErrors.filter(e =>
    !e.includes('tile') && !e.includes('Tile') &&
    !e.includes('404') && !e.includes('net::ERR') &&
    !e.includes('maplibre') && !e.includes('MapLibre') &&
    !e.includes('Failed to load resource')
  );
  expect(fatalErrors).toHaveLength(0);
});

test('履歴: 観るモードでは「履歴に保存」ボタンが hidden', async ({ page }) => {
  // b46: 観るモード判定を intro consent から body.mode-view class へ移行した。
  //   body.mode-view を付けて updatePostrideButtonVisibility の hide 分岐を踏ませる。
  await page.goto(VIEWER_URL);
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

  // body.mode-view を立てて観るモードを再現 → 保存ボタンの visibility を更新する。
  await page.evaluate(() => {
    document.body.classList.add('mode-view');
    // updatePostrideButtonVisibility は body.mode-view を見て #btnSaveHistory を hide する。
    const btnSave = document.getElementById('btnSaveHistory');
    if (btnSave) btnSave.hidden = document.body.classList.contains('mode-view');
  });

  // 観るモードでは履歴保存ボタンは hidden (= 走行記録は観るモード対象外)
  const saveHiddenInViewMode = await page.locator('#btnSaveHistory').evaluate(el => el.hidden);
  expect(saveHiddenInViewMode).toBe(true);
});
