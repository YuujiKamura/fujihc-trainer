// b74: viewer の volumetric clouds を 3 視点 (A 正面遠景 / B 雲アップ / C ride 開始位置) で
// 撮影、 main が後で Read tool で目視批評する。
//
// 配布元負荷ゼロ:
//   - 視点 A/B: `?noterrain=1` で viewer の地形 fetch を skip (= GSI / OSM を一切叩かない)
//   - 視点 C: `?noterrain` なし通常 mode、 GSI / OSM への request を page.route で fake 1x1 PNG
//     に hijack (= tile_load_budget.spec.js 同型 pattern)、 配布元 host へは 1 byte も出ない。
//   - AMeDAS は `?weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500` で skip。
//
// base-test.js の distributorAccessGate auto fixture は viewport で配布元 host への request を
// abort + violations 記録、 視点 C では fake fulfill 経由で violations ゼロを担保する。

import { test, expect } from './base-test.js';
import path from 'node:path';
import os from 'node:os';

const URL_BASE = 'http://127.0.0.1:8000/?weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500';
const SCRATCH = path.join(os.homedir(), '.agents', 'scratch', 'fujihc-trainer-project');

// Chromium の createImageBitmap が decode できる最小 valid PNG (= tile_load_budget と同 fixture)
const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

async function setupTileHijack(page) {
  // GSI / OSM への request を全て valid 1x1 PNG で fulfill (= viewer は decode 成功で進める)
  await page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: VALID_PNG_BYTES });
  });
}

async function goThroughIntros(page) {
  // 段 1: 地形データ intro
  const startBtn = page.locator('#btnTerrainLoaderStart');
  if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(2_000);
  }
  // 段 2: BLE モード intro → 「コースを観る」 で観るモードへ
  const viewBtn = page.locator('button:has-text("コースを観る")');
  if (await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await viewBtn.click();
    await page.waitForTimeout(6_000);  // 観るモード遷移 + 3D 描画 + ray-march 安定化
  }
}

test('b74-A: 雲遠景 (= ?noterrain=1、 デフォカメラ)', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.text().includes('[weather]') || msg.text().includes('[b74]') || msg.type() === 'error') {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  await page.goto(`${URL_BASE}&noterrain=1`);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await goThroughIntros(page);
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-A.png'), fullPage: false });
  console.log('[b74] A saved');
});

test('b74-B: 雲アップ (= ?noterrain=1、 wheel zoom in で雲層に近づく)', async ({ page }) => {
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  await page.goto(`${URL_BASE}&noterrain=1`);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await goThroughIntros(page);
  // canvas に対して wheel zoom in (= 雲アップ視点)
  const canvas = page.locator('canvas').nth(0);
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // 雲層 (= cloudBaseM=1500m) に視点を近づける ── orbit camera を高角度 + 短半径に
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, -200);  // 負方向 = zoom in
      await page.waitForTimeout(100);
    }
    // 視線をやや上向きに ── drag で pitch 上げ
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 150, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(2_000);
  }
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-B.png'), fullPage: false });
  console.log('[b74] B saved');
});

test('b74-C: ride 開始位置 (= ?noterrain なし通常 mode、 GSI/OSM hijack、 デフォカメラ)', async ({ page }) => {
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  // 配布元 host への通信を物理的に fake 1x1 PNG に置き換える (= 配布元 host へは 1 byte も出ない)
  await setupTileHijack(page);
  await page.goto(URL_BASE);  // ?noterrain なし通常 mode
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await goThroughIntros(page);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot-C.png'), fullPage: false });
  console.log('[b74] C saved');
});

// 互換用: 既存 b74-screenshot.png path も維持 (= 視点 A のコピー先)
test('b74: legacy alias (= b74-screenshot.png に視点 A コピー保存) + mini-overlay visible 確認', async ({ page }) => {
  await page.goto(`${URL_BASE}&noterrain=1`);
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
  await goThroughIntros(page);
  await page.waitForTimeout(2_000);
  // 雲行 textContent assertion (= b74 brief 完了条件 §3 の panel 雲量行 pin)
  const cloudRow = page.locator('[data-row="clouds"]');
  await expect(cloudRow).toContainText('雲量 90%');
  await expect(cloudRow).toContainText('雲底 1500 m');
  await expect(cloudRow).toContainText('雲頂 3500 m');
  // b74 fixup: mini-overlay (= 観るモードで常時 visible な fixed overlay) も rendered + visible
  const miniOverlay = page.locator('#weather-cloud-mini');
  await expect(miniOverlay).toHaveAttribute('data-clouds-state', 'rendered');
  await expect(miniOverlay).toContainText('雲量 90%');
  await expect(miniOverlay).toBeVisible();  // 観るモードでも visible
  await page.screenshot({ path: path.join(SCRATCH, 'b74-screenshot.png'), fullPage: false });
  console.log('[b74] legacy alias saved');
});
