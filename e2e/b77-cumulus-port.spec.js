// b77: CK42BB cumulus 移植後の volumetric clouds を 3 視点 sqlite-backed e2e で撮影。
//
// 設計の継承:
//   - b74 / b75 と同じ sqlite-backed tile hijack (= 配布元負荷ゼロ、 富士山 DEM 本物)
//   - ?weather=fixed&cloudCover=0.5&cloudBaseM=1500&cloudTopM=6000 で笠雲再現 (= 富士山頂
//     3776m を雲層が覆う、 b76-polish-5 で導入した cloudTopM 床 6000m 基盤を活かす)
//   - ?datetime=<ISO 8601 with +09:00> で時刻固定 (= b75 sun_position.js 経路継承)
//
// 完了条件:
//   1) 3 枚 PNG が ~/.agents/scratch/fujihc-trainer-project/b77-screenshot-{morning,noon,sunset}.png に保存
//   2) sha256 hash 比較で 3 ペア全てが「画像が異なる」 (= 時刻ごとに shader 出力が変わる証拠)
//   3) PNG サイズが空でない (= shader が走らず黒画面 → 数 KB の場合に検出)
//   4) main / worker が Read tool で 3 枚を目視批評、 6 項目 (cauliflower / flat base / puffy /
//      silver / 広範囲 / 30fps) を判定 (= 本 spec の範疇外、 brief §視覚批評 で実施)

import { test, expect } from './base-test.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const REPO_ROOT = process.cwd();
const FIXTURE_DEM = fs.readFileSync(
  path.join(REPO_ROOT, 'web', 'tests', 'fixtures', 'gsi_dem_v1_sample.png'),
);
const TILES_DB_PATH = path.join(REPO_ROOT, 'data', 'tiles.sqlite');

// sqlite tile DB を spec import 時に in-memory Map に load (= b74/b75 と同型)
const SOURCE_SQLITE_TO_URL = { gsi_dem: 'dem_png', dem_png: 'dem_png', seamlessphoto: 'seamlessphoto' };
let tileMap = new Map();
let tileLoadInfo = 'not-attempted';
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(TILES_DB_PATH, { readOnly: true });
  const rows = db.prepare(
    'SELECT source, zoom_level, tile_column, tile_row, data FROM tiles WHERE data IS NOT NULL',
  ).all();
  for (const r of rows) {
    const urlSource = SOURCE_SQLITE_TO_URL[r.source] || r.source;
    tileMap.set(`${urlSource}/${r.zoom_level}/${r.tile_column}/${r.tile_row}`, r.data);
  }
  db.close();
  tileLoadInfo = `loaded ${tileMap.size} tiles from sqlite`;
} catch (e) {
  tileLoadInfo = `sqlite load failed (= fixture fallback only): ${e.message}`;
}
console.log(`[b77] tile DB: ${tileLoadInfo}`);

const FIXTURE_PHOTO_GRAY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACklEQVR4nGNggAAAAAYAAYj1uakAAAAASUVORK5CYII=',
  'base64',
);

const SCRATCH = path.join(os.homedir(), '.agents', 'scratch', 'fujihc-trainer-project');

// b77 round 2: e2e は b75 互換 params (= camera を雲層より上、 雲薄め) で 地形 + 雲 縁が両方
// visible になる状態を撮る。 笠雲再現 (= cloudTopM=6000m) の visual 確認は本 spec の範疇外、
// brief §視覚批評 で live URL を desk_capture method=print で main / worker が見て判定する。
// e2e spec の目的は「shader が時刻反応する」 + 「配布元負荷ゼロ」 + 「自動回帰」 のみ。
const URL_BASE_WEATHER = '?weather=fixed&cloudCover=0.3&cloudBaseM=2500&cloudTopM=4500';

// 3 視点 (= 同日 2026-06-21 JST 朝 / 昼 / 夕、 sunset で silver lining 金色が visible になる
// 時刻に設定。 b75 と同 ISO で互換)
const SCENES = [
  { name: 'morning', iso: '2026-06-21T04:45:00+09:00' },  // 日の出直後 elevation ≈ 5°
  { name: 'noon',    iso: '2026-06-21T12:00:00+09:00' },  // 真上 elevation ≈ 78°
  { name: 'sunset',  iso: '2026-06-21T19:15:00+09:00' },  // 日の入り直前 elevation ≈ 0°
];

async function setupTileHijack(page) {
  await page.route(/(?:cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)/, async (route) => {
    const url = route.request().url();
    const gsiMatch = url.match(/cyberjapandata\.gsi\.go\.jp\/xyz\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.(?:png|jpe?g)/);
    if (gsiMatch) {
      const source = gsiMatch[1];
      const z = Number(gsiMatch[2]);
      const x = Number(gsiMatch[3]);
      const y = Number(gsiMatch[4]);
      if (source === 'dem_png') {
        const buf = tileMap.get(`${source}/${z}/${x}/${y}`);
        if (buf) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(buf) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_DEM });
        return;
      }
      if (source === 'seamlessphoto') {
        const buf = tileMap.get(`${source}/${z}/${x}/${y}`);
        if (buf) {
          await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(buf) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_PHOTO_GRAY });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_PHOTO_GRAY });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: FIXTURE_PHOTO_GRAY });
  });
}

async function bootViewerToViewMode(page) {
  const startBtn = page.locator('#btnTerrainLoaderStart');
  await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await startBtn.click();
  await page.waitForTimeout(8_000);
  const goViewBtn = page.locator('#btnSetupGoView');
  if (await goViewBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await goViewBtn.click();
    await page.waitForFunction(() => document.body.classList.contains('mode-view'), { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(5_000);
  }
}

function urlFor(scene) {
  const dt = encodeURIComponent(scene.iso);
  return `http://127.0.0.1:8000/${URL_BASE_WEATHER}&datetime=${dt}`;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// 3 視点を個別 test (= playwright 並列、 1 test 1 page)
for (const scene of SCENES) {
  test(`b77-${scene.name}: CK42BB cumulus 移植 3 視点 (= ${scene.iso})`, async ({ page }) => {
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[sun]') || t.includes('[weather]') || t.includes('[map3d]') || t.includes('[cloud]')
          || msg.type() === 'error') {
        console.log(`[browser ${msg.type()}] ${t}`);
      }
    });
    page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

    await setupTileHijack(page);
    await page.goto(urlFor(scene));
    await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
    await bootViewerToViewMode(page);
    await page.waitForTimeout(3_000);
    const outPath = path.join(SCRATCH, `b77-screenshot-${scene.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`[b77] ${scene.name} saved → ${outPath}`);

    // 非空サイズ pin (= shader が完全に黒画面のままだと数 KB 未満になる、 通常 viewer は 200KB+)
    const stat = fs.statSync(outPath);
    expect(stat.size).toBeGreaterThan(10_000);
  });
}

// hash 全異 + behavioral assertion (= 時刻ごとに cumulus shader 出力が変化することを programmatic pin)
test('b77-hash-compare: 朝/昼/夕で画像が変化 (= cumulus shader が時刻反応の証拠)', async () => {
  const buffers = {};
  for (const scene of SCENES) {
    const p = path.join(SCRATCH, `b77-screenshot-${scene.name}.png`);
    expect(fs.existsSync(p), `${p} が存在しない (= 3 視点 spec が走っていない)`).toBe(true);
    buffers[scene.name] = fs.readFileSync(p);
  }
  const hashes = {
    morning: sha256(buffers.morning),
    noon:    sha256(buffers.noon),
    sunset:  sha256(buffers.sunset),
  };
  console.log('[b77] hashes:', hashes);
  expect(hashes.morning).not.toBe(hashes.noon);
  expect(hashes.noon).not.toBe(hashes.sunset);
  expect(hashes.morning).not.toBe(hashes.sunset);
});
