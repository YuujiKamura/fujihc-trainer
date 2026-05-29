import { test, expect } from './base-test.js';
import { waitForPaintComplete } from './_helpers/paint_complete.js';

const SVELTE_URL = 'http://127.0.0.1:8000/index-svelte.html?svelte_map=1';

// b118: 配布元 (= 国土地理院 GSI / OpenStreetMap) への通信を物理 block。 Svelte Map3D
// は地形タイルを fetch する経路を持ち、 ?noterrain=1 抑止が svelte ENV gate を尊重するか
// 不明なため、 page.route mock で物理的に intercept する (= 他 e2e と同方式)。
const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

async function mockDistributorTiles(page) {
  await page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: VALID_PNG_BYTES }));
}

test('Svelte Map3D mode boots up, connects to test client, and starts ride', async ({ page }) => {
  await mockDistributorTiles(page);
  // Visit Svelte map mode
  await page.goto(SVELTE_URL);
  
  // Wait for the Map3D canvas to be mounted and the initial loading text to disappear
  await expect(page.locator('canvas#s-minimap-top')).toBeVisible({ timeout: 20_000 });

  // b130: svelte mode は __mapIdle hook を export しない、 canvas pixel だけ pin.
  // svelte 移行が完了して Svelte Map3D が定着すれば idle hook を svelte 側にも追加.
  await waitForPaintComplete(page, {
    waitMapIdle: false,
    canvasSelector: 'canvas#s-minimap-top',
    waitTerrainMesh: false,
  });
  
  // Wait for test BLE client to connect (Start button becomes enabled)
  const btnStart = page.locator('#s-btnRideStart');
  await expect(btnStart).toBeVisible();
  await expect(btnStart).toBeEnabled({ timeout: 10_000 });
  
  // Click Start
  await btnStart.click();
  
  // Check if HUD time starts ticking (e.g. from 00:00 to 00:01)
  const timeText = page.locator('#s-hud-time');
  await expect(timeText).not.toHaveText('00:00', { timeout: 5000 });
  
  // Verify speed is greater than 0 (physics is working)
  const speedText = page.locator('#s-rider-hud-speed');
  await expect(speedText).not.toHaveText('0.0', { timeout: 5000 });
});

test('Svelte Map3D mode mouse controls work without error', async ({ page }) => {
  await mockDistributorTiles(page);
  await page.goto(SVELTE_URL);
  await expect(page.locator('canvas#s-minimap-top')).toBeVisible({ timeout: 20_000 });
  
  // Get the main 3D canvas (Map3D creates a canvas inside the mapContainer div)
  // mapContainer is bound to the div in Map3D.svelte
  const mapDiv = page.locator('div[style*="background: #87CEEB"]');
  const canvas = mapDiv.locator('canvas');
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // Test Left Drag (Pan)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100, { steps: 10 });
  await page.mouse.up({ button: 'left' });

  // Test Right Drag (Rotate)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 100, { steps: 10 });
  await page.mouse.up({ button: 'right' });

  // Test Scroll (Zoom)
  await page.mouse.wheel(0, 500);
  
  // Ensure we didn't crash (no JS errors normally, but we can verify HUD still exists)
  await expect(page.locator('#s-hud')).toBeVisible();
});
