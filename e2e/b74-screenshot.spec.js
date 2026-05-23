// b74: viewer に volumetric clouds が描画されることをスクショで pin する e2e。
//
// URL gate 構成:
//   `?noterrain=1` ── viewer の地形 fetch を skip (= 配布元 GSI / OSM を一切叩かない、
//     b41 既存 ?noterrain 入口、 base-test.js distributorAccessGate が auto fixture で
//     検出する配布元 host への request を物理ゼロにする)。 地形は平坦 (= Y=0)、 雲は
//     cloudBaseM..cloudTopM の AABB に描画される。
//   `?weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500` ── AMeDAS fetch も
//     skip、 b74 で追加した固定 weather 入口経由で mapRenderer.setWeatherClouds に流れる。
//
// e2e の検証範囲: panel の data-clouds-state="rendered" + 雲行 textContent + 3D canvas が
// DOM に出現 + screenshot 保存。 視覚的な「富士山地形と雲の位置関係」 は b74 prototype の
// scope 外 (= 地形 fetch を 配布元 から取らない e2e では地形が平坦になるため)、 後段 user の
// 手動 viewer 起動 + main の Read 目視批評で確認する。

import { test, expect } from './base-test.js';
import path from 'node:path';
import os from 'node:os';

const URL = 'http://127.0.0.1:8000/?noterrain=1&weather=fixed&cloudCover=0.9&cloudBaseM=1500&cloudTopM=3500';

const SCREENSHOT_PATH = path.join(
  os.homedir(),
  '.agents',
  'scratch',
  'fujihc-trainer-project',
  'b74-screenshot.png',
);

test('b74: panel に rendered 状態 + 雲行表示、 3D canvas が DOM に出現、 screenshot 撮影', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('[weather]') || msg.text().includes('[b74]')) {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

  // viewer 起動 (= URL gate `?noterrain=1` で地形 fetch skip + `?weather=fixed` で AMeDAS skip)
  await page.goto(URL);

  // weather panel が rendered 状態に達するのを待つ (= URL gate forceWeather が
  // mapRenderer.setWeatherClouds に流れた pin)。 visible でなく attached で十分。
  await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({
    state: 'attached',
    timeout: 15_000,
  });

  // 雲行 (= data-row="clouds") が panel に追加されている (= textContent assertion)
  const cloudRow = page.locator('[data-row="clouds"]');
  await expect(cloudRow).toContainText('雲量 90%', { timeout: 5_000 });
  await expect(cloudRow).toContainText('雲底 1500 m');
  await expect(cloudRow).toContainText('雲頂 3500 m');

  // intro panel 2 段遷移: (1) 地形データロード intro → (2) BLE モード intro → 「コースを観る」 → 観るモード
  // (= 観るモードは trainer 不要、 3D シーンが describe されるので雲 + 平坦地形が viewport に映る)
  // 段 1: 「地形データを読み込んで開始」 button (= #btnTerrainLoaderStart)
  const startBtn = page.locator('#btnTerrainLoaderStart');
  if (await startBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await startBtn.click();
    // ?noterrain=1 でも terrain phase の同期遷移を待つ
    await page.waitForTimeout(2_000);
  }
  // 段 2: 「コースを観る」 button (= BLE モード intro 内、 trainer 不要で観るモードに飛ぶ)
  const viewBtn = page.locator('button:has-text("コースを観る")');
  if (await viewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await viewBtn.click();
    // 観るモード遷移 + 3D scene 描画 + ray-march 安定化
    await page.waitForTimeout(6_000);
  }

  // canvas が DOM に attached されていることだけ確認
  const canvasCount = await page.locator('canvas').count();
  console.log(`[b74] canvas count: ${canvasCount}`);
  expect(canvasCount).toBeGreaterThan(0);

  // viewport スクショを保存
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(`[b74] screenshot saved: ${SCREENSHOT_PATH}`);
});
