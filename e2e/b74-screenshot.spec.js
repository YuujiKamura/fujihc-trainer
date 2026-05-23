// b74: viewer の volumetric clouds + 富士山地形 + mini-overlay を 3 視点 (A/B/C) で撮影。
//
// 配布元負荷ゼロ + 富士山地形描画の解 (= user 確定 sqlite-backed path):
//   - GSI / OSM 配布元への request を page.route で intercept、 配布元 host へは 1 byte も出ない
//   - **第 1 優先**: `data/tiles.sqlite` から該当タイルを SELECT して fulfill (= 本物の富士山 DEM、
//     user が手動 `python scripts/init_tile_db.py + scripts/fetch_gsi_dem.py` で populate 済)
//   - **第 2 優先 (fallback)**: sqlite miss なら `web/tests/fixtures/gsi_dem_v1_sample.png`
//     (256x256 RGB DEM) を返す (= 配布元負荷ゼロ維持、 平坦よりマシ)
//   - sqlite アクセスは Node.js 22 stable の `node:sqlite` (= 既存依存追加なし)
//
// AMeDAS は `?weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500` で fetch skip。
// ?noterrain なし通常 mode で起動 → viewer が GSI request → hijack 経由で sqlite/fixture →
// 地形 mesh が build される (= 富士山形状 if sqlite populated)。

import { test, expect } from './base-test.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = process.cwd();
const FIXTURE_DEM = fs.readFileSync(
  path.join(REPO_ROOT, 'web', 'tests', 'fixtures', 'gsi_dem_v1_sample.png'),
);
const TILES_DB_PATH = path.join(REPO_ROOT, 'data', 'tiles.sqlite');

// === sqlite tile DB を spec import 時に in-memory Map に load (= page.route の hot path に
// sqlite I/O を持ち込まない、 1 spec 内 4 test で再利用)。 sqlite 未 populate / table 不在は
// 黙って Map 空のままにし、 fallback fixture path に乗せる ──
//
// **重要 source name mapping**:
//   sqlite (= fetch_gsi_dem.py が書く源) = 'gsi_dem'
//   URL (= viewer が request する path) = 'dem_png' (= GSI 公式 path)
//   Map key は URL 形式 (= 'dem_png/<z>/<x>/<y>') に正規化する、 page.route の hot path で
//   URL→key 引きが O(1) で済むようにする。
const SOURCE_SQLITE_TO_URL = { gsi_dem: 'dem_png' };

let tileMap = new Map();
let tileLoadInfo = 'not-attempted';
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(TILES_DB_PATH, { readOnly: true });
  const rows = db.prepare(
    'SELECT source, zoom_level, tile_column, tile_row, data FROM tiles WHERE data IS NOT NULL'
  ).all();
  for (const r of rows) {
    const urlSource = SOURCE_SQLITE_TO_URL[r.source] || r.source;
    tileMap.set(`${urlSource}/${r.zoom_level}/${r.tile_column}/${r.tile_row}`, r.data);
  }
  db.close();
  tileLoadInfo = `loaded ${tileMap.size} tiles from sqlite (= gsi_dem→dem_png 正規化済)`;
} catch (e) {
  tileLoadInfo = `sqlite load failed (= fixture fallback only): ${e.message}`;
}
console.log(`[b74] tile DB: ${tileLoadInfo}`);

const URL_BASE = 'http://127.0.0.1:8000/?weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500';
const SCRATCH = path.join(os.homedir(), '.agents', 'scratch', 'fujihc-trainer-project');

// 1x1 灰色 PNG (= 航空写真 / seamlessphoto / OSM photo タイル用、 地形 mesh の texture を
// 単色 fill して標高 displacement を見やすくする、 DEM RGB を texture に流すと緑になる)
const FIXTURE_PHOTO_GRAY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACklEQVR4nGNggAAAAAYAAYj1uakAAAAASUVORK5CYII=',
  'base64',
);

async function setupTileHijack(page) {
  await page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, async (route) => {
    const url = route.request().url();
    const gsiMatch = url.match(/cyberjapandata\.gsi\.go\.jp\/xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(?:png|jpe?g)/);
    if (gsiMatch) {
      const source = gsiMatch[1];
      const z = Number(gsiMatch[2]);
      const x = Number(gsiMatch[3]);
      const y = Number(gsiMatch[4]);
      // dem_png 経路: sqlite から本物の DEM を返す (= 富士山形状の displacement)
      if (source === 'dem_png') {
        const buf = tileMap.get(`${source}/${z}/${x}/${y}`);
        if (buf) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(buf) });
          return;
        }
        // sqlite miss は fixture DEM (= 平坦相当、 富士山の縁外)
        await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_DEM });
        return;
      }
      // 航空写真 (seamlessphoto / std / photo 系) は灰色 1x1 (= texture が DEM 色にならない)
      await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_PHOTO_GRAY });
      return;
    }
    // OSM 系 (= vector / photo) も灰色 1x1
    await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_PHOTO_GRAY });
  });
}

async function bootViewerToViewMode(page) {
  const startBtn = page.locator('#btnTerrainLoaderStart');
  await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await startBtn.click();
  // 地形 fetch + DEM decode + mesh build を待つ (= 42 タイル fixture でも数秒)
  await page.waitForTimeout(8_000);
  const viewBtn = page.locator('button:has-text("コースを観る")');
  if (await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await viewBtn.click();
    await page.waitForTimeout(6_000);
  }
}

test('b74-A: 雲遠景 + 地形 (= 通常 mode、 sqlite-backed、 デフォカメラ)', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.text().includes('[weather]') || msg.text().includes('[b74]') || msg.type() === 'error') {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  await setupTileHijack(page);
  await page.goto(URL_BASE);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await bootViewerToViewMode(page);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-A.png'), fullPage: false });
  console.log('[b74] A saved');
});

test('b74-B: 雲アップ + 地形 (= 通常 mode、 wheel zoom in)', async ({ page }) => {
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  await setupTileHijack(page);
  await page.goto(URL_BASE);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await bootViewerToViewMode(page);

  const canvas = page.locator('canvas').nth(0);
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(150);
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 200, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(2_000);
  }
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-B.png'), fullPage: false });
  console.log('[b74] B saved');
});

test('b74-C: ride 開始視点 (= 通常 mode、 デフォ camera)', async ({ page }) => {
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  await setupTileHijack(page);
  await page.goto(URL_BASE);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await bootViewerToViewMode(page);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-C.png'), fullPage: false });
  console.log('[b74] C saved');
});

test('b74: legacy alias (= b74-screenshot.png に視点 A コピー保存) + mini-overlay visible 確認', async ({ page }) => {
  await setupTileHijack(page);
  await page.goto(URL_BASE);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await bootViewerToViewMode(page);
  await page.waitForTimeout(2_000);
  const cloudRow = page.locator('[data-row="clouds"]');
  await expect(cloudRow).toContainText('雲量 90%');
  const miniOverlay = page.locator('#weather-cloud-mini');
  await expect(miniOverlay).toHaveAttribute('data-clouds-state', 'rendered');
  await expect(miniOverlay).toContainText('雲量 90%');
  await expect(miniOverlay).toBeVisible();
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot.png'), fullPage: false });
  console.log('[b74] legacy alias saved');
});
