import { test, expect } from '@playwright/test';

// b118: 配布元 (= 国土地理院 GSI / OpenStreetMap) への通信を物理 block。
// 旧 spec は #btnTerrainLoaderStart を click して地形 fetch を発火していたが、
// page.route mock も ?noterrain=1 抑止も無く、 ローカル `npx playwright test` で
// 走るたびに配布元へ通信が出ていた (= 規律違反、 b36 の趣旨に反する)。
// 1x1 PNG fixture を返す mock で intercept する ── 他 e2e (b74-screenshot 等) と同方式。
const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

test('debug capture', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  // b118: 配布元への通信を mock で物理 block (= 規律: 実 endpoint を test から叩かない)。
  await page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: VALID_PNG_BYTES }));

  await page.goto('http://127.0.0.1:8000/index.html');
  await page.waitForTimeout(1000);
  console.log('HTML BEFORE CLICK:', await page.content());

  await page.click('#btnTerrainLoaderStart');
  await page.waitForTimeout(3000);
  console.log('HTML AFTER CLICK:', await page.content());
});
