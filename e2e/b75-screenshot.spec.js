// b75: 太陽位置時刻連動 ── 3 視点 (朝 05:30 / 昼 12:00 / 夕 18:30 JST 2026-06-21) で
// viewer をスクショ、 太陽の azimuth + elevation が時刻ごとに変化することを画像 hash 比較で
// programmatic pin (= L4-5 misleading test 回避)。
//
// 設計の継承:
//   - b74-screenshot.spec.js と同じ sqlite-backed tile hijack (= 配布元負荷ゼロ、 富士山 DEM 本物)
//   - ?weather=fixed&cloudCover=...&cloudBaseM=...&cloudTopM=... で AMeDAS fetch skip (= 雲条件 3 時刻で同一に固定、 太陽だけ変えて陰影連動を見る)
//   - 新: ?datetime=<ISO 8601 with +09:00> で時刻固定 (= sun_position.js parseDatetimeFromUrl 経路)
//
// 完了条件:
//   1) 3 枚 PNG が ~/.agents/scratch/fujihc-trainer-project/b75-screenshot-{morning,noon,sunset}.png に保存
//   2) sha256 hash 比較で 3 ペア全てが「画像が異なる」 (= 太陽が動いた証拠)
//   3) main が Read tool で 3 枚を目視批評 (= 朝は東斜光、 昼は真上、 夕は西斜光)

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

// sqlite tile DB を spec import 時に in-memory Map に load (= b74 と同型)
// gsi_dem (= legacy 名) と dem_png (= 正式 source 名) 両方を URL の dem_png に投影、
// seamlessphoto は同名でそのまま投影 (= main 側で oneshot fetch 済、 49 tiles z=14)
const SOURCE_SQLITE_TO_URL = { gsi_dem: 'dem_png', dem_png: 'dem_png', seamlessphoto: 'seamlessphoto' };
let tileMap = new Map();
let tileLoadInfo = 'not-attempted';
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(TILES_DB_PATH, { readOnly: true });
  const rows = db.prepare(
    'SELECT source, zoom_level, tile_column, tile_row, data FROM tiles WHERE data IS NOT NULL'
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
console.log(`[b75] tile DB: ${tileLoadInfo}`);

const FIXTURE_PHOTO_GRAY = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACklEQVR4nGNggAAAAAYAAYj1uakAAAAASUVORK5CYII=',
  'base64',
);

const SCRATCH = path.join(os.homedir(), '.agents', 'scratch', 'fujihc-trainer-project');
// b75: 雲量は薄め (cloudCover=0.2) で「ほぼ晴れ」 ── 太陽光が地形まで届く状態にして
// 朝/昼/夕の斜光の方向差を地形 hillshade で目視判別できるようにする。
// 雲は b74 確認用の遠景アクセント程度の量だけ残す。
const URL_BASE_WEATHER = '?weather=fixed&cloudCover=0.2&cloudBaseM=2500&cloudTopM=4500';

// 3 視点 (= 同日 2026-06-21 JST 朝 / 昼 / 夕、 朝夕は太陽 elevation を更に低く取って
// 夕焼けオレンジが視覚的に出る時刻に設定)
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
        // sqlite ミス → 灰色 fallback (= b74 と同等の defensive、 配布元 host へは絶対叩かない)
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
  // 1. 地形ローダー開始 (= GSI fetch + DEM decode + mesh build)
  const startBtn = page.locator('#btnTerrainLoaderStart');
  await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await startBtn.click();
  await page.waitForTimeout(8_000);
  // 2. trainer 接続画面 (= setup-overlay) の「コースを観る」 ボタンを ID 直指定で click
  // (= 観るモード唯一の入口、 b46 で集約済、 viewer-maplibre.js:1215 参照)
  const goViewBtn = page.locator('#btnSetupGoView');
  if (await goViewBtn.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await goViewBtn.click();
    // 3. body.mode-view class が立つのを待つ (= 観るモード判定の唯一の signal、 viewer-maplibre.js:1217)
    await page.waitForFunction(() => document.body.classList.contains('mode-view'), { timeout: 8_000 }).catch(() => {});
    // 4. 観るモード 3D シーンが描画安定するまで wait
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

// 3 視点を個別 test (= playwright の並列実行で 3 worker、 1 test 1 page)。
// hash 比較は最終 test で 3 枚を全 read して assert する。
for (const scene of SCENES) {
  test(`b75-${scene.name}: 太陽位置時刻連動 (= ${scene.iso})`, async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.text().includes('[sun]') || msg.text().includes('[weather]') || msg.type() === 'error') {
        console.log(`[browser ${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => console.log(`[browser error] ${err.message}`));

    await setupTileHijack(page);
    await page.goto(urlFor(scene));
    await page.locator('#weather-panel[data-clouds-state="rendered"]').waitFor({ state: 'attached', timeout: 15_000 });
    await bootViewerToViewMode(page);
    await page.waitForTimeout(3_000);
    const outPath = path.join(SCRATCH, `b75-screenshot-${scene.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`[b75] ${scene.name} saved → ${outPath}`);
  });
}

// hash 比較 (= 「画像が時刻ごとに変化していること」 を programmatic pin、 L4-5 fix)。
// 上記 3 test が完了している前提で、 ファイルから読んで 3 ペア assert。
test('b75-hash-compare: 朝/昼/夕で画像が変化していること (= sun が動いた証拠)', async () => {
  const buffers = {};
  for (const scene of SCENES) {
    const p = path.join(SCRATCH, `b75-screenshot-${scene.name}.png`);
    expect(fs.existsSync(p), `${p} が存在しない (= 3 視点 spec が走っていない)`).toBe(true);
    buffers[scene.name] = fs.readFileSync(p);
  }
  const hashes = {
    morning: sha256(buffers.morning),
    noon:    sha256(buffers.noon),
    sunset:  sha256(buffers.sunset),
  };
  console.log('[b75] hashes:', hashes);
  // 3 ペア全てが異なるはず (= 太陽位置が変われば光源・大気散乱・雲陰影が変わる、 同 hash は NOAA 計算が壊れている証拠)
  expect(hashes.morning).not.toBe(hashes.noon);
  expect(hashes.noon).not.toBe(hashes.sunset);
  expect(hashes.morning).not.toBe(hashes.sunset);
});
