// E2E test: 履歴機能 (IndexedDB) の通しテスト
//
// 何を担保するか:
//   1. IndexedDB にライドを注入 → 履歴 overlay を開く → 一覧に行が出る
//   2. GPX ダウンロードボタンが download イベントを発火する (.gpx ファイル名)
//   3. 削除ボタンを押すと行が消えて「空」メッセージが出る
//
// 方式:
//   - page.evaluate() で IndexedDB に直接 ride レコードを書き込む
//     (= 完走まで待つと 80 分以上かかるため、保存経路のみ切り離してテスト)
//   - btnViewHistoryFromSetup を JS click → showHistoryOverlay() を起動
//     (= postride overlay 経由の btnViewHistory でも同じ関数が呼ばれる)
//   - viewer-maplibre.js の実コードをブラウザで動かすため、
//     shim 再実装とは異なり showHistoryOverlay / appendHistoryRow / deleteRide を
//     壊せばこのテストが落ちる
import { test, expect } from '@playwright/test';

async function injectRide(page, ride) {
  await page.evaluate(async (rec) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('fujihill-trainer', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('rides')) {
          const store = d.createObjectStore('rides', { keyPath: 'id' });
          store.createIndex('by_date', 'date', { unique: false });
        }
      };
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('rides', 'readwrite');
      tx.objectStore('rides').put(rec);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, ride);
}

test('履歴: ride 注入 → 一覧表示 → GPX ダウンロード → 削除', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://127.0.0.1:8000/?test=1&consent=dev');
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 20_000 });

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
  const fatalErrors = consoleErrors.filter(e =>
    !e.includes('tile') && !e.includes('Tile') &&
    !e.includes('404') && !e.includes('net::ERR') &&
    !e.includes('maplibre') && !e.includes('MapLibre')
  );
  expect(fatalErrors).toHaveLength(0);
});
