// b12 Phase 3 部品: DEM タイルと航空写真テクスチャの取得 (I/O 層).
//
// 純ロジック (tileRangeForBounds / stitchHeightGrid / decodeGsiHeightGrid /
// courseBounds) は terrain3d.js が SoT。 本モジュールは fetch + Canvas decode の
// I/O 配管に徹し、 Three.js には依存しない (= テクスチャの Three 化は terrain_mesh3d.js
// の責務、 ここは生の Canvas / 標高グリッドまでを返す)。
//
// Three を import しないので node test から安全に import できる。 location / document /
// fetch / Image といったブラウザ API は module 評価時には触らず、 関数の実行時にのみ
// 参照する (= top-level に location.origin を書くと node import で即死するため)。
//
// 取得経路 (b67 で確定方針へ統一、 fujihc CLAUDE.md GSI 配慮):
//   - DEM: IndexedDB タイルキャッシュ → GSI 直 (`dem5a_png` / `dem_png`) の 2 段。
//     タイルは IndexedDB にのみ保持し、 bridge ローカル DB や `web/static/tiles/`
//     への静的同梱には依存しない。 静的同梱は `.gitignore` 済 (配布元データ同梱
//     再配布禁止) で Pages にデプロイされず、 bridge 段は静的配信モードで全タイル
//     404 を返す死んだ経路だった ── b67 で撤去。 IndexedDB hit なら GSI 通信ゼロ、
//     miss のみ GSI 直で取得して TTL 内 (90 日) は再利用。
//   - 航空写真 (seamlessphoto): GSI online から取得 (bridge は seamlessphoto を
//     配信しない)。 GSI 利用規約の許容範囲を守る ── コース外接矩形を覆う数十枚
//     のみ、 同時接続を GSI_FETCH_LIMIT 本に絞り、 取得結果を IndexedDB
//     (openTileCache) に persist して TTL 内は再取得しない。 自動再取得・ループ
//     取得はしない。

import { tileRangeForBounds, stitchHeightGrid, decodeGsiHeightGrid } from '../terrain3d.js';
import { fujihill } from '../../courses/fujihill.js';

// DEM タイルの取得 zoom。 b71 で「設定 1 箇所」 (= fujihill.terrainConfig.zoom) からの派生に
// 統一 ── ここに数字を書かない。 zoom を変えたい場合は `web/courses/fujihill.js` の
// `TERRAIN_CONFIG.zoom` を書き換えるだけで、 viewer / Python prefetch / test 全部追随する。
// dem5a_png は z9-15 配信、 値はその範囲内に保つ。 dem_png と dem5a_png は同一の標高 PNG
// エンコードなので decodeGsiHeightGrid は不変。 b71 で高精細 / 外周 2 段構成は廃止、 全 mesh
// を単一 zoom (本定数) で作る ── ring topology 関連は撤去。
export const DEM_ZOOM = fujihill.terrainConfig.zoom;
export const TILE_PX = 256;
// GSI への同時接続数。 fujihc CLAUDE.md「同時接続 6 本以下」── 減らす方向のみ可、増やし禁止。
export const GSI_FETCH_LIMIT = 6;
// 取得タイル数の上限。 fujihc CLAUDE.md「タイル数上限 200」── 超えたら地形を組まずエラー。
// b70 は ring topology 境界整列達成のため 200 → 256 に一時引き上げていたが、 b71 で外周
// ストリップ廃止 + z14 化により単一メッシュ 約 42 タイルで余裕、 200 に戻す (= 「緩めた gate
// は必要消滅で戻す」 規律)。 配布元配慮の本質 (= 1 回 fetch + IndexedDB 90 日 TTL +
// GSI_FETCH_LIMIT=6 並列で 1 wave 完了、 自動再取得・ループ取得なし、 ToS 内) は不変。
export const MAX_TILES = 200;

// 航空写真タイルの取得元 (= GSI online、 seamlessphoto 固定。 std/relief/hybrid 追加禁止)。
const GSI_SEAMLESSPHOTO_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto';

/**
 * タイル矩形範囲を 1 枚ずつの {tx, ty} 配列に展開する.
 *
 * ty (北→南) を外側、 tx (西→東) を内側に回す。 stitchHeightGrid / canvas 貼り合わせが
 * range.xMin/yMin 基準のオフセットで配置するので、 順序自体は結果に影響しないが、
 * 取得の進捗表示が地理的に素直な並びになるようこの順で返す。
 *
 * @param {{xMin:number,xMax:number,yMin:number,yMax:number}} range
 * @returns {Array<{tx:number, ty:number}>}
 */
export function tileCoordsForRange(range) {
  const coords = [];
  for (let ty = range.yMin; ty <= range.yMax; ty++) {
    for (let tx = range.xMin; tx <= range.xMax; tx++) {
      coords.push({ tx, ty });
    }
  }
  return coords;
}

/**
 * 並列数を limit に絞って items を fn に通し、 入力順を保った結果配列を返す.
 *
 * out[i] は items[i] の結果 (= 完了順ではなく入力順)。 GSI への同時接続を物理的に
 * 絞るための配管 (= 規約配慮)。 fn が throw すると mapLimit 全体が reject する。
 *
 * @param {Array<T>} items
 * @param {number} limit - 同時実行の上限 (1 以上)
 * @param {(item:T, index:number)=>Promise<R>} fn
 * @param {(done:number, total:number)=>void} [onEach] - 1 件完了ごとに呼ぶ進捗 cb
 * @returns {Promise<Array<R>>}
 * @template T, R
 */
export async function mapLimit(items, limit, fn, onEach) {
  const out = new Array(items.length);
  let idx = 0;
  let done = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
      done++;
      if (onEach) onEach(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

// crossOrigin 付きで画像を読む。 失敗 (= 404 / CORS) は null で解決する (= reject しない、
// 欠損タイルは stitchHeightGrid 側が 0m 補完するので 1 枚 404 でも全体は組める)。
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// DEM タイル画像 1 枚を Canvas 経由で decode し、 標高グリッド (Float32Array) を返す。
function imageToHeightGrid(img) {
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX);
  const rgba = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
  return decodeGsiHeightGrid(rgba, TILE_PX, TILE_PX);
}

/**
 * 指定 bbox + zoom から DEM タイル群を取得し、 範囲全体の連続標高グリッドを返す.
 *
 * b67: 取得経路を IndexedDB タイルキャッシュ → GSI 直 (`gsiDirectBase`) の 2 段に統一。
 * 旧 bridge 段 (= Pages オリジン宛の死んだ往復) は撤去 ── 静的同梱は `.gitignore` 済で
 * Pages に存在せず、 bridge mode でも実体は GSI 由来 cache、 つまり死んだ往復だった。
 * IndexedDB hit なら配布元 (GSI) 通信ゼロ、 miss のみ GSI 直で取得し TTL 内は再利用。
 *
 * b67: zoom 引数を追加 ── 高精細 (z15 dem5a_png) と広域低精細 (z12 dem_png) の両用途で
 * 同じ取得経路を再利用するため。 未指定なら DEM_ZOOM (= 15) を既定値。
 *
 * range.count が MAX_TILES を超えたら地形を組まずに RangeError を投げる (= 規約配慮の gate)。
 *
 * @param {object} args
 * @param {[number,number,number,number]} args.bounds - [west, south, east, north] (度)。
 * @param {object|null} [args.tileCache] - TileCache instance (= openTileCache() の戻り)。
 *                                          null/undefined なら hit/set を skip。
 * @param {string} args.gsiDirectBase - **必須**: GSI 直 base URL (例 `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png`
 *                                       / `dem_png`)。 b67 で必須化 ── 未指定は異常呼び出し
 *                                       (旧 bridge fallback は撤去済) なので早期エラー。
 * @param {number} [args.zoom] - DEM 取得 zoom。 未指定なら DEM_ZOOM (= 15)。
 * @param {(done:number,total:number)=>void} [args.onProgress]
 * @param {boolean} [args.skipFetch] - b41: true なら配布元 (GSI) を一切叩かず、 標高ゼロの
 *                                      平坦グリッドを合成して返す。 地形を検証しない e2e が
 *                                      viewer を起動するときの経路 (= テストで配布元を叩かない)。
 * @returns {Promise<{stitched:{grid:Float32Array,width:number,height:number},
 *                     range:object, missing:number}>}
 */
export async function loadDemStitched({ bounds, tileCache, gsiDirectBase, zoom, onProgress, skipFetch }) {
  // b67: gsiDirectBase 必須化。 旧 bridge fallback を撤去した結果、 未指定で呼ぶと
  // IndexedDB のみ・取得経路なし = 異常呼び出し。 silent fallback で隠さず即エラー。
  if (!gsiDirectBase && !skipFetch) {
    throw new Error('loadDemStitched: gsiDirectBase は必須引数です (b67 で bridge fallback 撤去済)');
  }
  const z = (typeof zoom === 'number' && Number.isFinite(zoom)) ? zoom : DEM_ZOOM;
  const range = tileRangeForBounds(bounds, z);
  if (range.count > MAX_TILES) {
    throw new RangeError(
      `DEM タイルが ${range.count} 枚で上限 ${MAX_TILES} 超過 (= 取得を中止)`);
  }
  // b41: skipFetch なら DEM タイルを 1 枚も取らず、 標高ゼロの平坦グリッドを返す。
  // stitchHeightGrid と同じ {grid,width,height} 形で返すので buildTerrainMesh は通常どおり通る。
  if (skipFetch) {
    const width = range.tilesX * TILE_PX;
    const height = range.tilesY * TILE_PX;
    return { stitched: { grid: new Float32Array(width * height), width, height }, range, missing: 0 };
  }
  const coords = tileCoordsForRange(range);
  const grids = await mapLimit(coords, GSI_FETCH_LIMIT, async ({ tx, ty }) => {
    // 1. TileCache hit → Bitmap decode → grid (= GSI への通信ゼロ)
    if (tileCache) {
      try {
        const bytes = await tileCache.get('dem_png', z, tx, ty);
        if (bytes) {
          const bitmap = await bytesToBitmap(bytes);
          if (bitmap) {
            const grid = bitmapToHeightGrid(bitmap);
            bitmap.close();
            return { tx, ty, grid };
          }
        }
      } catch { /* cache 失敗は silent skip、 GSI 直 fetch にfall back */ }
    }
    // 2. GSI 直 fetch ── dem5a_png は富士山周辺で全カバーではなく、 周辺端 (= 河口湖 /
    // 山中湖外側等) で 404 を返す穴がある。 404 のときは dem_png (= 全国 10m メッシュ
    // カバー、 z0-14 配信) に fallback して穴埋め (= viewer の「陥没」 を解消)。
    // b71: dem5a 主経路 + dem_png fallback の 2 段。 配布元負荷の本質は不変
    // (= 1 ユーザーの cold load 1 回、 dem5a 成功率分は dem_png に流れず、 失敗率分
    // だけ dem_png 追加 fetch、 IndexedDB に persist し TTL 内は再取得ゼロ)。
    const directResult = await tryFetchDemTile(`${gsiDirectBase}/${z}/${tx}/${ty}.png`);
    if (directResult.grid) {
      if (tileCache && directResult.bytes) {
        try { await tileCache.set('dem_png', z, tx, ty, directResult.bytes); } catch {}
      }
      return { tx, ty, grid: directResult.grid };
    }
    // 3. dem5a 404 のとき dem_png に fallback (= 同 zoom、 同 tile 番号で再取得)。
    // URL は gsiDirectBase の 'dem5a_png' を 'dem_png' に置換するだけ ── endpoint 知識を
    // tile_loader3d.js 外に増やさないため (= terrain_loader.js の 2 export 復活を避ける)。
    const fallbackUrl = `${gsiDirectBase.replace('dem5a_png', 'dem_png')}/${z}/${tx}/${ty}.png`;
    if (fallbackUrl !== `${gsiDirectBase}/${z}/${tx}/${ty}.png`) {
      const fallbackResult = await tryFetchDemTile(fallbackUrl);
      if (fallbackResult.grid) {
        if (tileCache && fallbackResult.bytes) {
          try { await tileCache.set('dem_png', z, tx, ty, fallbackResult.bytes); } catch {}
        }
        return { tx, ty, grid: fallbackResult.grid };
      }
    }
    return { tx, ty, grid: null };
  }, onProgress);

  const tileMap = new Map();
  let missing = 0;
  for (const g of grids) {
    if (g.grid) tileMap.set(`${g.tx}/${g.ty}`, g.grid);
    else missing++;
  }
  if (tileMap.size === 0) {
    throw new Error('DEM タイルが 1 枚も取得できませんでした (= bridge / GSI / ネットワークを確認)');
  }
  const stitched = stitchHeightGrid(tileMap, range, TILE_PX);
  return { stitched, range, missing };
}

// b31: DEM tile 1 枚 fetch → bytes + grid を返す helper.
// fetch / decode 失敗は { grid: null } を返す (= 欠損扱い、 stitchHeightGrid 側で 0m 補完)。
// bytes も grid と一緒に返すので、 fetch 成功時は TileCache に persist できる。
async function tryFetchDemTile(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { grid: null, bytes: null };
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const bitmap = await bytesToBitmap(bytes);
    if (!bitmap) return { grid: null, bytes: null };
    const grid = bitmapToHeightGrid(bitmap);
    bitmap.close();
    return { grid, bytes };
  } catch {
    return { grid: null, bytes: null };
  }
}

// b31: ImageBitmap → Canvas → RGBA → decodeGsiHeightGrid の 1 経路。
// 既存 imageToHeightGrid は HTMLImageElement 用、 createImageBitmap 由来の Bitmap も
// drawImage 可能なので同じ canvas decode で grid に変換できる。
function bitmapToHeightGrid(bitmap) {
  const c = document.createElement('canvas');
  c.width = TILE_PX;
  c.height = TILE_PX;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, TILE_PX, TILE_PX);
  const rgba = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
  return decodeGsiHeightGrid(rgba, TILE_PX, TILE_PX);
}

// 取得済みの JPEG バイト列を ImageBitmap に decode する。
// 旧実装は URL.createObjectURL で blob: URL を作り <img src=blob:...> で読んでいたが、
// blob: URL の <img> は CSP の img-src に blob: を要求する。 viewer の CSP は
// img-src に blob: を持たない設計 (= XSS 経路を絞る brief 33 の gate) で、 全タイルの
// <img> が block され地形テクスチャが下地一色になる。 img 要素を経由しない
// createImageBitmap ならバイト列を直接 decode でき、 img-src の管轄外。
// decode は connect-src で許可済の fetch 結果を相手にするだけで新規取得を伴わない。
// decode 失敗 (= 壊れたバイト列) は null を返し欠損扱いにする。
async function bytesToBitmap(bytes) {
  try {
    return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  } catch {
    return null;
  }
}

/**
 * DEM と同じタイル範囲の航空写真 (seamlessphoto) を 1 枚の Canvas に貼り合わせて返す.
 *
 * 取得元は GSI online (= bridge は seamlessphoto を配信しない)。 IndexedDB の
 * tileCache に hit すれば GSI へのリクエストは 0、 miss のみ fetch して cache.set する。
 * 戻り値は生の Canvas ── Three.js のテクスチャ化 (CanvasTexture) は terrain_mesh3d.js
 * が担う (= 本モジュールは Three 非依存を保つ)。
 *
 * @param {{range:object, tileCache:object|null,
 *          onProgress?:(done:number,total:number)=>void, skipFetch?:boolean}} args
 *   range = loadDemStitched() が返した range (= DEM と同じ範囲・同じ z)。
 *   tileCache = openTileCache() の戻り。 null なら毎回 GSI から取得する。
 *   skipFetch = b41: true なら GSI を叩かず下地一色の canvas を返す (= テストで配布元を叩かない)。
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function loadPhotoCanvas({ range, tileCache, onProgress, skipFetch }) {
  const coords = tileCoordsForRange(range);
  const canvas = document.createElement('canvas');
  canvas.width = range.tilesX * TILE_PX;
  canvas.height = range.tilesY * TILE_PX;
  const ctx = canvas.getContext('2d');
  // 欠損タイルが透けても暗灰で埋まるよう下地を塗る。
  ctx.fillStyle = '#3b424c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // b41: skipFetch なら航空写真を 1 枚も取らず、 下地一色の canvas をそのまま返す。
  if (skipFetch) return canvas;

  await mapLimit(coords, GSI_FETCH_LIMIT, async ({ tx, ty }) => {
    // tileCache hit → GSI リクエスト 0。 miss → GSI online から fetch して cache.set。
    let bytes = tileCache ? await tileCache.get('seamlessphoto', DEM_ZOOM, tx, ty) : null;
    if (!bytes) {
      const tileUrl = `${GSI_SEAMLESSPHOTO_BASE}/${DEM_ZOOM}/${tx}/${ty}.jpg`;
      try {
        const resp = await fetch(tileUrl);
        if (resp.ok) {
          bytes = new Uint8Array(await resp.arrayBuffer());
          if (tileCache) await tileCache.set('seamlessphoto', DEM_ZOOM, tx, ty, bytes);
        }
      } catch { /* fetch 失敗は欠損扱い (= 下地のまま) */ }
    }
    if (!bytes) return;
    // バイト列 → ImageBitmap で decode (= <img src=blob:> を経由せず CSP img-src に
    // 触れない)。 描いたら bitmap は閉じて GPU/メモリを早めに返す。
    const bitmap = await bytesToBitmap(bytes);
    if (bitmap) {
      ctx.drawImage(bitmap, (tx - range.xMin) * TILE_PX, (ty - range.yMin) * TILE_PX,
        TILE_PX, TILE_PX);
      bitmap.close();
    }
  }, onProgress);

  return canvas;
}
