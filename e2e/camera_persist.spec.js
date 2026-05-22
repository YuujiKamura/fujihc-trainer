// b48: orbit カメラ視点 (bearing/pitch/radius) の永続化を pin する E2E。
//
// user が drag / wheel で合わせた視点を localStorage('fujihill.cameraOrbit') に保存し、
// 次回起動で初期カメラとして復元する ──「最後に置いた視点が初期カメラになる」。
// この test は実ブラウザで viewer を動かし、 (1) drag で保存されること、 (2) reload を
// 跨いで復元されることを確認する。
import { test, expect } from './base-test.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html';
const GSI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
  'base64',
);

// 起動 → 地形ロード → トレーナー接続画面 → 「コースを観る」 で観るモードに入る。
// 観るモードは右上の区間パネル以外が地図むき出しなので、 中央を drag して orbit できる。
async function reachViewModeMap(page) {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  await page.locator('#btnTerrainLoaderStart').click();
  await page.waitForFunction(() => {
    const el = document.getElementById('loading-indicator');
    return el && el.dataset.loadingState === 'done';
  }, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('btnSetupGoView');
    return b && !b.disabled;
  }, { timeout: 20_000 });
  await page.locator('#btnSetupGoView').click();
  await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 5_000 });
}

// 地図中央を右ボタンで水平 dx px ドラッグして orbit (= bearing) を回す。
// カメラ操作はボタン問わず drag=orbit 回転 (map3d wireCameraInput、左右の使い分けは取り下げ)。
async function dragMap(page, dx, button = 'right') {
  const box = await page.locator('#map').boundingBox();
  const cx = box.x + box.width * 0.4;   // 右上の区間パネルを避けて左寄り中央
  const cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button });
  await page.mouse.move(cx + dx, cy, { steps: 8 });
  await page.mouse.up({ button });
}

const readOrbit = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('fujihill.cameraOrbit');
  return raw ? JSON.parse(raw) : null;
});

test('b48: drag した orbit 視点が localStorage に保存される', async ({ page }) => {
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_PNG }));
  await reachViewModeMap(page);

  expect(await readOrbit(page), 'drag 前は未保存').toBeNull();
  await dragMap(page, 300);  // 300px 水平 → bearing ≈ +150°

  const saved = await readOrbit(page);
  expect(saved, 'drag 後に保存される').not.toBeNull();
  expect(Number.isFinite(saved.bearing)).toBe(true);
  expect(Number.isFinite(saved.pitch)).toBe(true);
  expect(Number.isFinite(saved.radius)).toBe(true);
  expect(saved.bearing).toBeGreaterThan(10);  // 0 (= 初期 default) から確かに動いた
});

test('b48: 保存した orbit 視点が reload を跨いで初期カメラに復元される', async ({ page }) => {
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_PNG }));

  // 1 回目: 300px ドラッグ (= bearing ≈ 150°) して保存。
  await reachViewModeMap(page);
  await dragMap(page, 300);
  const first = await readOrbit(page);
  expect(first.bearing).toBeGreaterThan(10);

  // reload して再び観るモードへ。 起動時に保存視点が初期カメラへ復元されるはず。
  await reachViewModeMap(page);
  expect(await readOrbit(page), 'reload を跨いで保存値は残る').not.toBeNull();

  // 復元の確証: ここで 100px (= bearing +50°) 追加ドラッグする。 復元されていれば
  // 新しい保存値は first.bearing + 50 付近、 復元されず default 0 から始まったなら 50 付近。
  await dragMap(page, 100);
  const second = await readOrbit(page);
  const expected = ((first.bearing + 50) % 360 + 360) % 360;
  // bearing は 0..360 周回するので最短角度差で比較する。
  const diff = Math.min(
    Math.abs(second.bearing - expected),
    360 - Math.abs(second.bearing - expected),
  );
  expect(diff, `復元後 bearing=${second.bearing} は first+50=${expected} に近いはず`).toBeLessThan(8);
});

test('左ドラッグでも orbit (bearing) が回る ── 左右ボタンの使い分けは無い', async ({ page }) => {
  await page.route('https://cyberjapandata.gsi.go.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: GSI_PNG }));
  await reachViewModeMap(page);

  expect(await readOrbit(page), 'drag 前は未保存').toBeNull();
  await dragMap(page, 300, 'left');  // 左ボタンで水平ドラッグ

  // 左ドラッグでも bearing が動く = onDrag (回転) が呼ばれた証拠。
  // 左=パン (onPan) のままなら bearing は初期 0 から動かない。
  const saved = await readOrbit(page);
  expect(saved, '左 drag でも orbit が保存される').not.toBeNull();
  expect(saved.bearing).toBeGreaterThan(10);
});
