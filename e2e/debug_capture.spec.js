import { test, expect } from '@playwright/test';

test('debug capture', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

  await page.goto('http://127.0.0.1:8000/index-dom.html');
  await page.waitForTimeout(1000);
  console.log('HTML BEFORE CLICK:', await page.content());
  
  await page.click('#btnTerrainLoaderStart');
  await page.waitForTimeout(3000);
  console.log('HTML AFTER CLICK:', await page.content());
});
