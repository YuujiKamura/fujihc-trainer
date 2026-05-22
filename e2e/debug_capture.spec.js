// b49: ?cap=1 画面送信モードの E2E。
//
// OS のウィンドウキャプチャは WebGL canvas で白飛びするため、 viewer 自身が描画
// buffer を PNG 化して bridge の POST /debug/frame に送り、 data/debug-frame.png に
// 保存する。 開発時に viewer の実レンダリング結果を実ファイルとして観るための入口。
// この test は ?cap=1 で実ブラウザを動かし、 実フレームが保存されることを確認する。
import { test, expect } from './base-test.js';
import { readFileSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';

const VIEWER_URL = 'http://127.0.0.1:8000/?cap=1';
const FRAME_PATH = resolve(process.cwd(), 'data', 'debug-frame.png');
const GSI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

test('b49: ?cap=1 で viewer の描画フレームが data/debug-frame.png に保存される', async ({ page }) => {
  // 前回 frame を消して、 この run が確かに書いたことを示す。
  if (existsSync(FRAME_PATH)) rmSync(FRAME_PATH);

  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_PNG }));
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  // 地形ロード完了 → map3d boot 完了で送信ループ (1.5s 間隔) が始まる。
  await page.waitForFunction(() => {
    const b = document.getElementById('btnSetupGoView');
    return b && !b.disabled;
  }, { timeout: 60_000 });
  // 送信ループが数フレーム POST するまで待つ。
  await page.waitForTimeout(5_000);

  expect(existsSync(FRAME_PATH), 'data/debug-frame.png が保存される').toBe(true);
  const png = readFileSync(FRAME_PATH);
  // PNG マジックヘッダ + 単色 1x1 fixture より十分大きい (= 実描画フレーム)。
  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  expect(png.length).toBeGreaterThan(5_000);
});
