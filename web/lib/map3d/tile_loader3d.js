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
// 取得経路 (b12 Phase3 設計メモ §3 tile_loader3d / fujihc CLAUDE.md GSI 配慮):
//   - DEM: bridge のローカル DB `${origin}/tiles/gsi_dem/{z}/{x}/{y}.png` 一本。
//     bridge が gsi_dem source を持つので GSI online への外部 fallback は持たない。
//     bridge 配信の DEM は GSI dem_png 形式そのままなので decodeGsiHeightGrid が通る。
//   - 航空写真 (seamlessphoto): bridge は seamlessphoto を配信しない (tile_server.py の
//     VALID_SOURCES は osm / gsi_dem / osm_raster のみ)。 よって GSI online から取得する。
//     GSI 利用規約の許容範囲を守る ── コース外接矩形を覆う数十枚のみ、 同時接続を
//     GSI_FETCH_LIMIT 本に絞り、 取得結果を IndexedDB (openTileCache) に persist して
//     TTL 内は再取得しない。 自動再取得・ループ取得はしない。

import { tileRangeForBounds, stitchHeightGrid, decodeGsiHeightGrid } from '../terrain3d.js';

// GSI dem_png の native zoom は 14 (= 256x256 で約 6m grid、 terrain3d.html 準拠)。
export const DEM_ZOOM = 14;
export const TILE_PX = 256;
// GSI への同時接続数。 fujihc CLAUDE.md「同時接続 6 本以下」── 減らす方向のみ可、増やし禁止。
export const GSI_FETCH_LIMIT = 6;
// 取得タイル数の上限。 fujihc CLAUDE.md「タイル数上限 200」── 超えたら地形を組まずエラー。
export const MAX_TILES = 200;

// 航空写真タイルの取得元 (= GSI online、 seamlessphoto 固定。 std/relief/hybrid 追加禁止)。
const GSI_SEAMLESSPHOTO_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto';

// DEM タイルの取得元 (= bridge のローカル DB)。 location は実行時にのみ参照する。
function demBaseUrl() {
  return `${location.origin}/tiles/gsi_dem`;
}

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
 * コース外接 bbox から DEM タイル群を取得し、 範囲全体の連続標高グリッドを返す.
 *
 * 取得元は bridge のローカル DB 一本 (= GSI online への外部 fallback は持たない)。
 * range.count が MAX_TILES を超えたら地形を組まずに RangeError を投げる (= 規約配慮の gate)。
 *
 * @param {{bounds:[number,number,number,number], onProgress?:(done:number,total:number)=>void}} args
 *   bounds = [west, south, east, north] (度)。 courseBounds() の戻り値を渡す。
 * @returns {Promise<{stitched:{grid:Float32Array,width:number,height:number},
 *                     range:object, missing:number}>}
 */
export async function loadDemStitched({ bounds, onProgress }) {
  const range = tileRangeForBounds(bounds, DEM_ZOOM);
  if (range.count > MAX_TILES) {
    throw new RangeError(
      `DEM タイルが ${range.count} 枚で上限 ${MAX_TILES} 超過 (= 取得を中止)`);
  }
  const coords = tileCoordsForRange(range);
  const base = demBaseUrl();
  const grids = await mapLimit(coords, GSI_FETCH_LIMIT, async ({ tx, ty }) => {
    const img = await loadImage(`${base}/${DEM_ZOOM}/${tx}/${ty}.png`);
    return { tx, ty, grid: img ? imageToHeightGrid(img) : null };
  }, onProgress);

  const tileMap = new Map();
  let missing = 0;
  for (const g of grids) {
    if (g.grid) tileMap.set(`${g.tx}/${g.ty}`, g.grid);
    else missing++;
  }
  if (tileMap.size === 0) {
    throw new Error('DEM タイルが 1 枚も取得できませんでした (= bridge / ネットワークを確認)');
  }
  const stitched = stitchHeightGrid(tileMap, range, TILE_PX);
  return { stitched, range, missing };
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
 *          onProgress?:(done:number,total:number)=>void}} args
 *   range = loadDemStitched() が返した range (= DEM と同じ範囲・同じ z)。
 *   tileCache = openTileCache() の戻り。 null なら毎回 GSI から取得する。
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function loadPhotoCanvas({ range, tileCache, onProgress }) {
  const coords = tileCoordsForRange(range);
  const canvas = document.createElement('canvas');
  canvas.width = range.tilesX * TILE_PX;
  canvas.height = range.tilesY * TILE_PX;
  const ctx = canvas.getContext('2d');
  // 欠損タイルが透けても暗灰で埋まるよう下地を塗る。
  ctx.fillStyle = '#3b424c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await mapLimit(coords, GSI_FETCH_LIMIT, async ({ tx, ty }) => {
    let img = null;
    let bytes = tileCache ? await tileCache.get('seamlessphoto', DEM_ZOOM, tx, ty) : null;
    if (bytes) {
      const objUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      img = await loadImage(objUrl);
      URL.revokeObjectURL(objUrl);
    } else {
      const tileUrl = `${GSI_SEAMLESSPHOTO_BASE}/${DEM_ZOOM}/${tx}/${ty}.jpg`;
      try {
        const resp = await fetch(tileUrl);
        if (resp.ok) {
          bytes = new Uint8Array(await resp.arrayBuffer());
          if (tileCache) await tileCache.set('seamlessphoto', DEM_ZOOM, tx, ty, bytes);
          const objUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
          img = await loadImage(objUrl);
          URL.revokeObjectURL(objUrl);
        }
      } catch { /* fetch 失敗は欠損扱い (= 下地のまま) */ }
    }
    if (img) {
      ctx.drawImage(img, (tx - range.xMin) * TILE_PX, (ty - range.yMin) * TILE_PX,
        TILE_PX, TILE_PX);
    }
  }, onProgress);

  return canvas;
}
