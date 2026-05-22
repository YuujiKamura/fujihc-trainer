// brief b31: 配布元負荷の実走テスト (= 2026-05-20 user 確定「配布元に迷惑をかけない
// テストを相応に手厚く整備しないと公開できない水準になる恐れがある」 反映)。
//
// unit / integration の「定数存在 + chain 動作」だけでは、 訪問者の実際のアクセスで
// 配布元 (= 国土地理院 GSI / OSM) への通信が規律内に収まっているかが verify できない。
// playwright で訪問者シナリオを走らせ、 page.route で配布元通信を intercept して
// 実測パターンを assert する。
//
// 「Pages 環境 simulate」: bridge 経由 (= `${origin}/tiles/gsi_dem/**`) と 同梱経由
// (= `${origin}/static/tiles/gsi_dem/**`) を route で 404 にし、 GSI direct fetch
// (= cyberjapandata.gsi.go.jp/xyz/dem) を強制発火させる。 bridge.py が立っていても
// route intercept が優先されるので、 既存 playwright.config.js を維持したまま動く。
//
// ジャーニーテスト規律 (= 2026-05-19 user 確立): 個別 assertion ではなく訪問者導線を
// 1 本通す + 真正性 (= IndexedDB 保存中身) で verify。 各 test 内で「観るモード state
// 到達 + body.mode-view 確認」 を共通ジャーニーとし、 配布元通信の実測を真正性 verify
// として読む。

import { test, expect } from './base-test.js';

const VIEWER_URL = 'http://127.0.0.1:8000/index.html';
const GSI_ORIGIN = 'https://cyberjapandata.gsi.go.jp';
const OSM_ORIGIN = 'https://tile.openstreetmap.org';

// 1x1 黒 PNG (= color type 2 / RGB、 base64 decode)。 標高ゼロの平坦タイル相当だが、
// fetch 経路 → bytesToBitmap (= createImageBitmap) decode → TileCache 保存 → 再訪 hit の
// chain を verify するのが目的なので 1x1 で十分。
//
// 旧 fixture (= 1x1 透過 PNG `iVBORw0KGgoAAA...RU5ErkJggg==`) は構造的には valid PNG だが
// Chromium の createImageBitmap が `InvalidStateError: The source image could not be decoded`
// で reject する ── viewer の tile_loader3d.js bytesToBitmap が createImageBitmap で
// decode する経路なので、 旧 fixture では全タイルが decode 失敗 → loadDemStitched が
// 「DEM タイルが 1 枚も取得できませんでした」 で throw → boot 失敗 → TileCache が
// loadDemStitched 経由で 1 件も書かれず、 再訪 cache hit / overlay 同期 test が落ちていた。
// createImageBitmap が確実に decode できる最小 PNG に差し替える (= 配布元への通信は増えない、
// route mock が返す byte 列を変えるだけ)。
const VALID_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);

// GSI への通信を intercept、 fetched URL と同時接続 peak を記録。
// 全 URL に対して valid PNG を返す (= viewer が decode に成功して probe done に進める)。
async function setupGsiIntercept(page) {
  const fetchedUrls = [];
  let currentConcurrent = 0;
  let concurrentMax = 0;
  await page.route(`${GSI_ORIGIN}/**`, async (route) => {
    fetchedUrls.push(route.request().url());
    currentConcurrent += 1;
    concurrentMax = Math.max(concurrentMax, currentConcurrent);
    // 同時接続を実測するため小さな delay を入れる (= 即時 fulfill だと並列 peak が観測しにくい)
    await new Promise((r) => setTimeout(r, 20));
    await route.fulfill({ status: 200, contentType: 'image/png', body: VALID_PNG_BYTES });
    currentConcurrent -= 1;
  });
  return {
    get fetchedUrls() { return fetchedUrls; },
    get concurrentMax() { return concurrentMax; },
  };
}

// bridge 経路と同梱経路を 404 にして Pages 環境 (= bridge.py 不在 + 同梱不在) を simulate する。
// これで terrain_loader.js の chain が「bridge fail → GSI direct fetch」 経路に進む。
async function simulatePagesNoBridge(page) {
  // 同梱経路 (= `${BASE_PATH}static/tiles/gsi_dem/**`) を 404
  await page.route('http://127.0.0.1:8000/static/tiles/gsi_dem/**', async (route) => {
    await route.fulfill({ status: 404 });
  });
  // bridge mode 経路 (= `${origin}/tiles/gsi_dem/**`) を 404
  await page.route('http://127.0.0.1:8000/tiles/gsi_dem/**', async (route) => {
    await route.fulfill({ status: 404 });
  });
}

// OSM への直接通信を intercept (= 期待値ゼロ)。 fetched URL が 1 件でも出れば ODbL 違反。
async function setupOsmIntercept(page) {
  const fetchedUrls = [];
  await page.route(`${OSM_ORIGIN}/**`, async (route) => {
    fetchedUrls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: VALID_PNG_BYTES });
  });
  return { get fetchedUrls() { return fetchedUrls; } };
}

// b46: 観るモードへ入る共通ジャーニー。 旧コードは intro consent (mode='view') を
//   localStorage に seed して観るモードへ直行していたが、 b46 で起動シーンを地形
//   データローダー画面の一本道に作り変え、 観るモードはトレーナー接続画面の
//   「コースを観る」 ボタンからのみ入る。 本関数は VIEWER_URL を開いて
//   地形ローダー画面の「開始」 → 地形ロード完了 → トレーナー接続画面 →
//   「コースを観る」 を踏み、 body.mode-view に到達するまでを担う。
async function gotoViewMode(page) {
  await page.goto(VIEWER_URL);
  await expect(page.locator('#intro-overlay')).toHaveClass(/visible/, { timeout: 20_000 });
  // 「開始」 押下で地形ロード起動 → 完了でトレーナー接続画面 (#setup-overlay) へ。
  await page.locator('#btnTerrainLoaderStart').click();
  await expect(page.locator('#setup-overlay')).toHaveClass(/visible/, { timeout: 60_000 });
  // トレーナー接続画面の「コースを観る」 で観るモードへ入る。
  await expect(page.locator('#btnSetupGoView')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#btnSetupGoView').click();
}

// IndexedDB の TileCache (= fujihc-tile-cache) を test 開始時に空にする。
// page.context().clearCookies() は IndexedDB を消さない、 各 test 独立性のため明示削除する。
// 注意: addInitScript で削除すると page.reload でも再発火し cache が消える ── 再訪 test では
// addInitScript ではなく 1 回目 page.goto 前に context evaluate で 1 度だけ削除する。
async function clearTileCacheOnce(page) {
  // 空 page に goto して IndexedDB + Service Worker cache を削除 (= 同 origin 上で削除しないと
  // 効かない)。 brief 35 で SW cache 経路でタイルが返って GSI direct intercept をすり抜ける
  // ケースを塞ぐため、 SW unregister + Cache API clear も合わせて実施する。
  await page.goto(VIEWER_URL, { waitUntil: 'commit' });
  await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('fujihc-tile-cache');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();  // 存在しない場合も継続
    req.onblocked = () => resolve();
  }));
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch {} }
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const k of keys) { try { await caches.delete(k); } catch {} }
    }
  });
}

test.describe('b31: 配布元負荷の実走テスト', () => {
  // 各 test 完全独立 (= 1 件目の TileCache 保存が 2 件目に漏れない)。
  // Playwright は test 単位で fresh context を作るので addInitScript で
  // indexedDB.deleteDatabase を最初に発火させる。

  test('初回訪問: 観るモードで GSI dem 取得が MAX_TILES = 200 以下', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    // 観るモード state まで到達 = 地形 probe + viewer 起動が完了している証拠
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    // 地形メッシュ load 完了まで余裕を持って待つ (= loadDemStitched + loadPhotoCanvas の取得分)
    await page.waitForTimeout(5000);
    // MAX_TILES=200 は loadDemStitched 1 回が取得する DEM tile 数の上限 (= range.count gate)。
    // 制約が掛かる「同一 source への 1 layer 分の取得」 は DEM 経路 (= `/xyz/dem_png/`)、
    // 航空写真 (= `/xyz/seamlessphoto/`) は別 layer の loadPhotoCanvas が取得する別範囲なので
    // DEM の MAX_TILES gate には合算しない。 DEM だけを抜き出して上限内かを pin する。
    const demFetches = gsi.fetchedUrls.filter((u) => u.includes('/xyz/dem_png/'));
    const totalFetches = gsi.fetchedUrls.length;
    console.log(`[b31-budget] GSI DEM fetch = ${demFetches.length} / total fetch = ${totalFetches}`);
    expect(demFetches.length, 'DEM 取得が MAX_TILES=200 以下').toBeLessThanOrEqual(200);
    expect(demFetches.length).toBeGreaterThan(0);  // 取得が走った証拠 (= chain 経路 verify)
    // 全 layer 合算でも青天井ではないことの guard。 DEM + 航空写真の 2 layer はそれぞれ
    // MAX_TILES 内なので、 合算は 2*MAX_TILES + probe 数枚に収まる (= 暴走取得の検出)。
    expect(totalFetches, '全 layer 合算でも 2*MAX_TILES + probe 余裕の範囲内').toBeLessThanOrEqual(2 * 200 + 20);
  });

  test('初回訪問: GSI への同時接続が GSI_FETCH_LIMIT = 6 以下', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    console.log(`[b31-budget] GSI concurrent max = ${gsi.concurrentMax}`);
    expect(gsi.concurrentMax).toBeLessThanOrEqual(6);
    expect(gsi.concurrentMax).toBeGreaterThan(0);  // 並列取得が実走した証拠
  });

  test('再訪: 1 回目で TileCache 保存後、 2 回目アクセスで GSI fetch ゼロ', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    // 1 回目 = TileCache 空、 GSI から取得して IndexedDB に保存
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    const firstFetchCount = gsi.fetchedUrls.length;
    expect(firstFetchCount).toBeGreaterThan(0);

    // 2 回目 = 同 origin に再訪 (= IndexedDB は永続)。 b46 で起動シーンが一本道に
    // なったため reload では地形ローダー画面に戻る ── 観るモードへは journey を再度踏む。
    // 再 fetch がゼロなら TTL 内 cache hit が効いている (= 配布元への再アクセスなし)
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    const totalAfterReload = gsi.fetchedUrls.length;
    const deltaFetches = totalAfterReload - firstFetchCount;
    console.log(`[b31-budget] 1st=${firstFetchCount}, after reload=${totalAfterReload}, delta=${deltaFetches}`);
    expect(deltaFetches).toBe(0);  // 2 回目で GSI fetch ゼロ = TTL hit
  });

  test('seamlessphoto 以外の photo layer (= std / relief / hybrid) に fetch 発火ゼロ', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    const banned = gsi.fetchedUrls.filter((u) =>
      u.includes('/xyz/std/')
      || u.includes('/xyz/relief/')
      || u.includes('/xyz/hybrid/'),
    );
    console.log(`[b31-budget] banned-layer fetches = ${banned.length}`);
    expect(banned).toEqual([]);
  });

  test('OSM tile.openstreetmap.org への直接アクセスがゼロ (= ODbL 経路維持)', async ({ page }) => {
    await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    const osm = await setupOsmIntercept(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForTimeout(5000);
    console.log(`[b31-budget] OSM direct fetches = ${osm.fetchedUrls.length}`);
    expect(osm.fetchedUrls).toEqual([]);
  });

  test('出典標記 #attrib が訪問者の最初の viewer 画面で常時可視 (= 国土地理院 + OpenStreetMap)', async ({ page }) => {
    await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    // task-g Round 2 で landed の `#attrib` 要素、 z-index 2001 で全 overlay より上、
    // 全 state で常時可視。 view モード state でも visible を維持する。
    const attrib = page.locator('#attrib');
    await expect(attrib).toBeVisible();
    await expect(attrib).toContainText('国土地理院');
    await expect(attrib).toContainText('OpenStreetMap');
  });

  test('200 タイル超を要求する coursegeometry でも配布元 fetch が始まる前に止まる', async ({ page }) => {
    // viewer の bbox SoT は courses/fujihill.js (= hard-code) で course.json から bbox は
    // 読まれない設計、 e2e から course.json mock で oversized bbox を inject する経路は無い。
    // ── 代わりに `page.evaluate` で `loadDemStitched({ bounds: [大きすぎる] })` を直接
    // 実行し、 MAX_TILES gate (= `if (range.count > MAX_TILES) throw RangeError`) が
    // 物理的に効くこと + GSI への通信ゼロを verify する。 これが「規律違反は配布元に
    // 通信せずに止まる」 の実走 pin。
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await page.goto(VIEWER_URL);  // viewer page を load (= module 解決のため)
    const fetchCountBefore = gsi.fetchedUrls.length;

    // dynamic import で loadDemStitched を呼び、 oversized bbox で RangeError を発火させる。
    const result = await page.evaluate(async () => {
      const mod = await import('/lib/map3d/tile_loader3d.js');
      try {
        // 富士山周辺の数百 km 矩形 (= z=14 で数千 tile 相当、 MAX_TILES=200 を超える)
        await mod.loadDemStitched({
          bounds: [136.0, 33.0, 141.0, 37.0],
          gsiDirectBase: 'https://cyberjapandata.gsi.go.jp/xyz/dem',
        });
        return { caught: false };
      } catch (e) {
        return { caught: true, name: e.name, message: e.message };
      }
    });
    expect(result.caught).toBe(true);
    expect(result.name).toBe('RangeError');
    expect(result.message).toMatch(/MAX_TILES|上限/);

    // gate が走る前に GSI への通信ゼロ (= viewer 起動 flow 由来の probe 等は cap として
    // 50 件未満を許容するが、 oversized bbox の取得は始まっていない)
    const deltaFetches = gsi.fetchedUrls.length - fetchCountBefore;
    console.log(`[b31-budget] MAX_TILES gate 後の追加 GSI fetch = ${deltaFetches}`);
    expect(deltaFetches).toBe(0);  // RangeError は fetch 開始前に投げられる
  });

  // ====== brief 35: ロード overlay 真正性 ======
  // ロード overlay の `#loading-progress-num` が実 GSI fetch 数と同期 + cache hit で
  // 完全 skip という 2 経路を pin する。 「画面に出た」 だけでなく保存中身・通信中身が
  // overlay の表示と一致するか (= 2026-05-19 真正性規律) を実走 verify。

  test('brief 35 真正性: 初回訪問 (cache 空) でロード overlay の num 最終値が GSI DEM fetch 数と同期', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    // overlay が done state に到達 (= 全タイル取得完了 + map.idle or 8s fallback)
    await page.waitForFunction(() => {
      const el = document.getElementById('loading-indicator');
      return el && el.dataset.loadingState === 'done';
    }, { timeout: 60_000 });
    const num = Number(await page.locator('#loading-progress-num').textContent());
    const den = Number(await page.locator('#loading-progress-den').textContent());
    expect(num, 'overlay の num 最終値 が den (= 全タイル数) と一致').toBe(den);
    // GSI DEM 経路の fetch のみ counter (= seamlessphoto / photo 等は別 layer)
    const demFetches = gsi.fetchedUrls.filter((u) => u.includes('/xyz/dem_png/'));
    console.log(`[brief 35 真正性] num=${num} den=${den} GSI DEM fetch=${demFetches.length}`);
    // num と DEM fetch 数は ±1 で同期 (= onProgress が fetch 直後に発火、 たまに ±1 ずれる
    // race を許容)。 「進捗が動いた」 が実通信に裏打ちされていることを pin。
    expect(demFetches.length, 'GSI DEM fetch 数 と overlay num が ±1 で同期').toBeGreaterThanOrEqual(num - 1);
    expect(demFetches.length).toBeLessThanOrEqual(num + 1);
  });

  test('brief 35 真正性: 再訪 (cache hit) で 2 回目は GSI DEM fetch ゼロ + overlay 即時 done', async ({ page }) => {
    const gsi = await setupGsiIntercept(page);
    await simulatePagesNoBridge(page);
    await clearTileCacheOnce(page);
    // 1 回目: cache 充填
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('loading-indicator');
      return el && el.dataset.loadingState === 'done';
    }, { timeout: 60_000 });
    const firstDemFetches = gsi.fetchedUrls.filter((u) => u.includes('/xyz/dem_png/')).length;
    expect(firstDemFetches, '1 回目は cache 空、 GSI DEM fetch が走る').toBeGreaterThan(0);
    // 2 回目: 再訪で cache hit。 b46 で起動シーンが一本道のため journey を再度踏む。
    await gotoViewMode(page);
    await expect(page.locator('body')).toHaveClass(/mode-view/, { timeout: 30_000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('loading-indicator');
      return el && el.dataset.loadingState === 'done';
    }, { timeout: 15_000 });
    const totalDemFetches = gsi.fetchedUrls.filter((u) => u.includes('/xyz/dem_png/')).length;
    const secondDemFetches = totalDemFetches - firstDemFetches;
    console.log(`[brief 35 真正性] 1 回目 DEM fetch=${firstDemFetches} / 2 回目 DEM fetch=${secondDemFetches}`);
    expect(secondDemFetches, '2 回目は cache hit で GSI DEM fetch ゼロ (= 配布元への再アクセス回避)').toBe(0);
  });
});
