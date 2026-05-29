// b47: 観るモード (body.mode-view) の脱出経路を pin する E2E。
//
// 観るモードの区間ライド中、 走るモードへ切り替える唯一の押せるボタンが
// btnOpenPairing。 旧コードはここで showPairing() を呼ぶだけで body.mode-view を
// 外さず、 トレーナー接続画面・実ライドへ移っても観るモードのままになる bug が
// あった (user 報告「一度走るモードに切り替えても観るモードのまま、二回やると
// 切り替わる」)。 b47 で btnOpenPairing を観るモード中は exitViewModeToSetup
// 経由にした。 この test は観る→走る遷移が 1 回で mode-view を外すことを pin する。
import { test, expect } from './base-test.js';
import { waitForPaintComplete } from './_helpers/paint_complete.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html';

// 地形タイルを偽 PNG で intercept (= 配布元 GSI を実際には叩かない)。
const GSI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

async function reachSetup(page) {
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
}

test('b47: 観るモード区間ライド → btnOpenPairing で mode-view が 1 回で外れる', async ({ page }) => {
  await reachSetup(page);

  // 観るモードに入る
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 5_000 });

  // 区間リストの行をクリック → 観るモードの区間ライド開始 (= mode-view state-riding)
  await page.locator('#section-list li').first().click();
  await expect(page.locator('body')).toHaveClass(/state-riding/, { timeout: 5_000 });
  await expect(page.locator('body')).toHaveClass(/mode-view/);

  // b130: 描画エンジン (= map3d / Three.js) の onceIdle で描画完了を待つ. minimap canvas
  // は本 spec の関心外、 terrain mesh も off (= 観るモードの区間ライド画面、 地形タイルは
  // GSI mock 経由).
  await waitForPaintComplete(page, { waitCanvasPixels: false, waitTerrainMesh: false });

  // 区間ライド中に押せる脱出ボタンは btnOpenPairing。 JS click (= 他 fixed 要素に
  // 重なって actionability check を通らないため、 実発火だけ検証する)。
  await page.evaluate(() => document.getElementById('btnOpenPairing').click());

  // 走るモードへ抜けた = body から mode-view が外れ、 トレーナー接続画面が出る。
  await expect(page.locator('body')).not.toHaveClass(/mode-view/, { timeout: 5_000 });
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/);
  // 観るモード専用 UI (区間リストパネル) が CSS で消えている。
  await expect(page.locator('#section-list-panel')).toBeHidden();
});
