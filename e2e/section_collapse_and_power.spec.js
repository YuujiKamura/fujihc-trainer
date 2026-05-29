// b53: 観るモードの 2 機能を実ブラウザで pin する E2E。
//   1. 区間リストパネル (#section-list-panel) のヘッダ折りたたみトグル
//      (#btnSectionCollapse) ── 押下で区間リスト本体が隠れる / 出る、 aria-expanded 追従。
//   2. パワースライダー (#rng_power) ── 観るモードで操作でき、 動かすと rider の
//      速度が変わる (= 固定 fake 速度ではなく integratePhysics 駆動)。
//
// 観るモードの rider 駆動: fake trainer (createFakeStateGenerator) が 1Hz で出す
// power_w が manualPowerW (= スライダー値) になり、 wsHandlers.state → integratePhysics
// → rider.setSpeed に届く。 スライダーを変えれば収束速度が変わる。
import { test, expect } from './base-test.js';
import { waitForPaintComplete } from './_helpers/paint_complete.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html';

// 地形タイルを偽 PNG で intercept (= 配布元 GSI を実際には叩かない)。
// createImageBitmap が decode できる 1x1 RGB PNG (= 標高ゼロの平坦タイル相当)。
// tile_load_budget.spec.js と同じ ── 透過 PNG だと Chromium の decode が reject し
// DEM 構築が「タイル 0 枚」で throw、 terrain 未準備で rider が置けなくなる。
const GSI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

async function reachViewMode(page) {
  // bridge tile 経路を 404 にして viewer の GSI fallback (intercept 済) に乗せる。
  await page.route('http://127.0.0.1:8000/static/tiles/gsi_dem/**', (r) => r.fulfill({ status: 404 }));
  await page.route('http://127.0.0.1:8000/tiles/gsi_dem/**', (r) => r.fulfill({ status: 404 }));
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_PNG }));
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-indicator');
    return el && el.dataset.loadingState === 'done';
  }, { timeout: 60_000 });
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 10_000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('btnSetupGoView');
    return b && !b.disabled;
  }, { timeout: 20_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 5_000 });
  // b130: 区間 panel / slider 操作の前に MapLibre 描画完了 + minimap canvas 描画を待つ.
  await waitForPaintComplete(page, { waitTerrainMesh: false });
}

test('b53: 区間パネルの折りたたみトグルで区間リスト本体が隠れる / 出る', async ({ page }) => {
  await reachViewMode(page);

  const panel = page.locator('#section-list-panel');
  const list = page.locator('#section-list');
  const hint = page.locator('#section-list-panel .panel-hint');
  const toggle = page.locator('#btnSectionCollapse');

  // 既定は展開 ── 区間リストとヒントが見えている。
  await expect(list).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // トグル押下で折りたたみ ── 本体が消え、 ヘッダ / トグルは残る。
  await toggle.click();
  await expect(list).toBeHidden();
  await expect(hint).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveClass(/collapsed/);
  await expect(toggle).toBeVisible();  // 再展開の導線は残る

  // もう一度押すと再展開。
  await toggle.click();
  await expect(list).toBeVisible();
  await expect(hint).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('b53: パワースライダーを動かすと観るモードの rider 速度が変わる', async ({ page }) => {
  test.setTimeout(60_000);
  await reachViewMode(page);

  // 区間を選んで観るモードのライド開始 ── controls パネル (調整スライダー) が出る。
  await page.locator('#section-list li').first().click();
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 5_000 });

  // パワースライダー (#rng_power) が存在し、 既定値 250W。
  const slider = page.locator('#rng_power');
  await expect(slider).toHaveCount(1);
  await expect(slider).toHaveValue('250');

  // スライダー値を range input に流し込むヘルパ (= fill は range に効かないため evaluate)。
  const setPower = (w) => slider.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, w);
  // #r-speed は rider-hud の速度表示 ("12.2 km/h (bridge)" 形式)。 tick() が
  // 物理速度を書く。 parseFloat で先頭の数値 (km/h) を取り出す。
  const readSpeedKmh = () => page.locator('#r-speed').evaluate(
    (el) => parseFloat(el.textContent) || 0);

  // 低出力 (50W) に設定 → 1Hz fake state を数回受けて物理積分が落ち着くのを待つ。
  await setPower(50);
  await page.waitForTimeout(8_000);
  const speedLow = await readSpeedKmh();

  // 高出力 (600W) に設定 → 同じだけ待つ。
  await setPower(600);
  await page.waitForTimeout(8_000);
  const speedHigh = await readSpeedKmh();

  // パワーを上げれば物理積分の収束速度が上がる ── 固定 fake 速度ではない証拠。
  expect(speedHigh).toBeGreaterThan(speedLow);
});
