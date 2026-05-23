import { test, expect } from './base-test.js';

const SVELTE_URL = 'http://127.0.0.1:8000/index-svelte.html?svelte_map=1';

test('Svelte Map3D mode boots up, connects to test client, and starts ride', async ({ page }) => {
  // Visit Svelte map mode
  await page.goto(SVELTE_URL);
  
  // Wait for the Map3D canvas to be mounted and the initial loading text to disappear
  await expect(page.locator('canvas#s-minimap-top')).toBeVisible({ timeout: 20_000 });
  
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
