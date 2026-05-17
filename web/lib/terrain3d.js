// brief b7: 地形を Three.js の 3D メッシュとして組むためのデータ経路 (純関数).
//
// Path B viewer の基礎石。 DEM (= 国土地理院 GSI dem_png 標高タイル) を、
// MapLibre の raster-dem (terrarium) 経由ではなく、 標高グリッド → BufferGeometry
// 頂点格子へ直接組む。 DOM / Three.js / fetch には依存しない (= node test 容易)。
//
// 経路: DEM タイル群 → decodeGsiHeightGrid (terrain_mesh.js) → stitchHeightGrid
//       → buildTerrainGeometry。 描画 (Three.js mesh 化) と fetch は呼び出し側
//       (= terrain3d.html) の責務。
//
// 参照 (= 後段の API drift 防止、 公式 doc):
//   - Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
//   - computeVertexNormals:    https://threejs.org/docs/#api/en/core/BufferGeometry.computeVertexNormals
//   - GSI 標高タイル (dem_png) 仕様: https://maps.gsi.go.jp/development/demtile.html
//   - 地理院タイル一覧・利用規約:     https://maps.gsi.go.jp/development/ichiran.html

import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from './tile_math.js';
import { decodeGsiHeightGrid } from './terrain_mesh.js';

// decode は terrain_mesh.js の SoT を再 export (= 呼び出し側が 1 module から取れるように).
export { decodeGsiHeightGrid };

// 緯度 1 度あたりのメートル (= WGS84 平均)。 経度は cos(lat) で別途補正する。
const M_PER_DEG_LAT = 111320;

/**
 * bbox [W, S, E, N] と zoom から、 それを覆う DEM タイルの矩形範囲を返す.
 *
 * Web Mercator の XYZ タイルは y が北で小さく南で大きい (= 上方向が y 小)。
 * よって yMin は北端 (N)、 yMax は南端 (S) から算出する。
 *
 * @param {[number,number,number,number]} bounds - [west, south, east, north] (度)
 * @param {number} zoom
 * @returns {{zoom:number, xMin:number, xMax:number, yMin:number, yMax:number,
 *            tilesX:number, tilesY:number, count:number}}
 */
export function tileRangeForBounds(bounds, zoom) {
  const [w, s, e, n] = bounds;
  if (!(e >= w) || !(n >= s)) {
    throw new RangeError('tileRangeForBounds: bounds must satisfy E>=W, N>=S');
  }
  const xMin = Math.floor(lonToTileX(w, zoom));
  const xMax = Math.floor(lonToTileX(e, zoom));
  const yMin = Math.floor(latToTileY(n, zoom));  // 北 = y 小
  const yMax = Math.floor(latToTileY(s, zoom));  // 南 = y 大
  const tilesX = xMax - xMin + 1;
  const tilesY = yMax - yMin + 1;
  return { zoom, xMin, xMax, yMin, yMax, tilesX, tilesY, count: tilesX * tilesY };
}

/**
 * タイルごとの decode 済み標高グリッドを範囲全体の連続グリッドへ連結する.
 *
 * 欠損タイル (= map に key 無し) は標高 0m で埋める (= 1 枚 404 でも全体は組める)。
 *
 * @param {Map<string, Float32Array>} tileGrids - key = "x/y"、 値 = tileSize^2 の標高 grid
 * @param {{xMin:number,xMax:number,yMin:number,yMax:number,tilesX:number,tilesY:number}} range
 * @param {number} [tileSize=256]
 * @returns {{grid: Float32Array, width: number, height: number}}
 */
export function stitchHeightGrid(tileGrids, range, tileSize = 256) {
  const width = range.tilesX * tileSize;
  const height = range.tilesY * tileSize;
  const grid = new Float32Array(width * height);
  for (let ty = range.yMin; ty <= range.yMax; ty++) {
    for (let tx = range.xMin; tx <= range.xMax; tx++) {
      const tile = tileGrids.get(`${tx}/${ty}`);
      if (!tile) continue;  // 欠損 → 0m のまま
      const ox = (tx - range.xMin) * tileSize;
      const oy = (ty - range.yMin) * tileSize;
      for (let py = 0; py < tileSize; py++) {
        const dstRow = (oy + py) * width + ox;
        const srcRow = py * tileSize;
        for (let px = 0; px < tileSize; px++) {
          grid[dstRow + px] = tile[srcRow + px];
        }
      }
    }
  }
  return { grid, width, height };
}

/**
 * 標高グリッドから Three.js BufferGeometry 用の typed array 群を組む.
 *
 * - グリッド画素 (px, py) を XYZ タイル座標経由で緯度経度に直し、 equirectangular
 *   近似 (= 緯度 1 度 ≒ 111320m, 経度は cos(中心緯度) 補正) で局所メートル平面へ投影。
 *   対象範囲は ~10km 角なので equirectangular 誤差は 0.1% 未満で十分。
 * - 軸: X = 東、 Y = 上 (標高 m)、 Z = 南 (= +Z が南、 北は -Z)。
 *   緯度を +Z=北 に写すと (東,上,北) は実世界 ENU (東,北,上) の奇置換になり、
 *   地形が東西鏡像で描画される (= 上空から見た地図が左右反転)。 北を -Z に写すと
 *   (東,上,南) となり実世界と同じキラリティ ── 上空俯瞰で東が右、 北が上に揃う。
 * - step で間引く (= 256x256 タイル数枚を 1:1 で頂点化すると数百万頂点になるため)。
 * - 三角形は +Y 向き法線になる winding (= a,c,b / b,c,d) で index を張る
 *   (北 -Z 化で頂点の並進向きが変わるため winding も対で決まる)。
 *
 * @param {{grid:Float32Array, width:number, height:number}} stitched - stitchHeightGrid の戻り
 * @param {{zoom:number, xMin:number, yMin:number}} range
 * @param {{tileSize?:number, step?:number, exaggeration?:number}} [opts]
 * @returns {{positions:Float32Array, indices:Uint32Array, uvs:Float32Array,
 *            vertexCount:number, gw:number, gh:number, minH:number, maxH:number,
 *            sizeX:number, sizeZ:number, centerLat:number, centerLon:number}}
 */
export function buildTerrainGeometry(stitched, range, opts = {}) {
  const { grid, width, height } = stitched;
  if (!(width > 1) || !(height > 1)) {
    throw new RangeError('buildTerrainGeometry: stitched grid must be > 1x1');
  }
  const tileSize = opts.tileSize || 256;
  const step = Math.max(1, Math.floor(opts.step || 1));
  const exaggeration = opts.exaggeration != null ? opts.exaggeration : 1.0;
  const { zoom, xMin, yMin } = range;

  // 間引き後の頂点格子サイズ (= 端の画素を必ず含む)。
  const gw = Math.floor((width - 1) / step) + 1;
  const gh = Math.floor((height - 1) / step) + 1;

  // 投影中心 = グリッド中心画素の緯度経度。
  const centerLon = tileXToLon(xMin + (width / 2) / tileSize, zoom);
  const centerLat = tileYToLat(yMin + (height / 2) / tileSize, zoom);
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);

  const positions = new Float32Array(gw * gh * 3);
  const uvs = new Float32Array(gw * gh * 2);
  let minH = Infinity, maxH = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let j = 0; j < gh; j++) {
    const py = Math.min(height - 1, j * step);
    const lat = tileYToLat(yMin + py / tileSize, zoom);
    // 北を -Z に写す (= 南が +Z)。 こうすると (東=+X, 上=+Y, 南=+Z) が実世界と同じ
    // キラリティになり、 地形が東西鏡像で描画されない (= 上空俯瞰で東が右に来る)。
    const z = -(lat - centerLat) * M_PER_DEG_LAT;
    for (let i = 0; i < gw; i++) {
      const px = Math.min(width - 1, i * step);
      const lon = tileXToLon(xMin + px / tileSize, zoom);
      const x = (lon - centerLon) * mPerDegLon;   // 東 = +X
      const h = grid[py * width + px];
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const vi = (j * gw + i) * 3;
      positions[vi] = x;
      positions[vi + 1] = h * exaggeration;
      positions[vi + 2] = z;
      const ui = (j * gw + i) * 2;
      uvs[ui] = px / (width - 1);
      uvs[ui + 1] = 1 - py / (height - 1);  // 画素 y 下向き → uv v は上向きに反転
    }
  }

  // 三角形 index。 各セル (i,j) を 2 枚に分割、 法線が +Y を向く winding。
  //   a = (i,j)  b = (i+1,j)  c = (i,j+1)  d = (i+1,j+1)
  //   tri1 = a,c,b   tri2 = b,c,d
  //   (j が増える = py が増える = 南 = +Z 増加。 北 -Z 化に対応した winding。)
  const indices = new Uint32Array((gw - 1) * (gh - 1) * 6);
  let k = 0;
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const a = j * gw + i;
      const b = a + 1;
      const c = a + gw;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  return {
    positions, indices, uvs,
    vertexCount: gw * gh,
    gw, gh,
    minH, maxH,
    sizeX: maxX - minX,
    sizeZ: maxZ - minZ,
    centerLat, centerLon,
  };
}

/**
 * course (lat/lon 点列) の外接矩形に余白を足した bbox を返す.
 *
 * @param {Array<{lat:number, lon:number}>} course
 * @param {number} [bufferM=500] - 余白 (m)。 b7 基礎ページは富士ヒルコースの起伏が
 *        見えれば十分なので 500m。 大きくすると DEM タイル枚数が増える。
 * @returns {[number,number,number,number]} [W, S, E, N]
 */
export function courseBounds(course, bufferM = 500) {
  if (!Array.isArray(course) || course.length === 0) {
    throw new RangeError('courseBounds: course must be a non-empty array');
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of course) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const midLat = (minLat + maxLat) / 2;
  const latBuf = bufferM / M_PER_DEG_LAT;
  const lonBuf = bufferM / (M_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180));
  return [minLon - lonBuf, minLat - latBuf, maxLon + lonBuf, maxLat + latBuf];
}

/**
 * 連結済み標高グリッドを緯度経度で bilinear サンプルして標高 (m) を返す.
 *
 * コースを地形に沿わせる (= drape) ために使う。 course の elevation_m は GPX 由来で
 * DEM とは数十 m ずれることがあるため、 ライン高さは DEM をサンプルした値に統一する。
 *
 * @param {{grid:Float32Array, width:number, height:number}} stitched
 * @param {{zoom:number, xMin:number, yMin:number}} range
 * @param {number} lat
 * @param {number} lon
 * @param {number} [tileSize=256]
 * @returns {number} 標高 m (= グリッド範囲外は端へ clamp)
 */
export function sampleHeightBilinear(stitched, range, lat, lon, tileSize = 256) {
  const { grid, width, height } = stitched;
  const { zoom, xMin, yMin } = range;
  // 連続タイル画素座標 (= buildTerrainGeometry と同じ写像)。
  const fx = (lonToTileX(lon, zoom) - xMin) * tileSize;
  const fy = (latToTileY(lat, zoom) - yMin) * tileSize;
  const cx = Math.max(0, Math.min(width - 1, fx));
  const cy = Math.max(0, Math.min(height - 1, fy));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = cx - x0, ty = cy - y0;
  const h00 = grid[y0 * width + x0], h10 = grid[y0 * width + x1];
  const h01 = grid[y1 * width + x0], h11 = grid[y1 * width + x1];
  return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) +
         h01 * (1 - tx) * ty + h11 * tx * ty;
}

/**
 * course (lat/lon 点列) を地形メッシュ上の 3D ライン頂点列に変換する.
 *
 * 投影は buildTerrainGeometry と同一 (= 同じ centerLat/centerLon、 北 -Z)。 高さは
 * DEM を sampleHeightBilinear でサンプルし、 drapeOffset だけ持ち上げて地形に密着
 * させつつ z-fighting を避ける。
 *
 * @param {Array<{lat:number, lon:number}>} course
 * @param {{range:object, stitched:object, centerLat:number, centerLon:number,
 *          tileSize?:number, drapeOffset?:number, exaggeration?:number}} opts
 *   centerLat/centerLon は buildTerrainGeometry の戻り値をそのまま渡す (= メッシュと一致)。
 * @returns {Float32Array} course.length*3 の XYZ 頂点列
 */
export function buildCoursePath(course, opts) {
  if (!Array.isArray(course) || course.length === 0) {
    throw new RangeError('buildCoursePath: course must be a non-empty array');
  }
  const { range, stitched, centerLat, centerLon } = opts;
  const tileSize = opts.tileSize || 256;
  const drapeOffset = opts.drapeOffset != null ? opts.drapeOffset : 25;
  const exaggeration = opts.exaggeration != null ? opts.exaggeration : 1.0;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(centerLat * Math.PI / 180);
  const out = new Float32Array(course.length * 3);
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const demH = sampleHeightBilinear(stitched, range, p.lat, p.lon, tileSize);
    out[i * 3] = (p.lon - centerLon) * mPerDegLon;        // 東 = +X
    out[i * 3 + 1] = demH * exaggeration + drapeOffset;   // 標高 + 持ち上げ
    out[i * 3 + 2] = -(p.lat - centerLat) * M_PER_DEG_LAT; // 北 = -Z
  }
  return out;
}

/**
 * コースチューブの ring ごとの勾配 (slope_pct) を返す.
 *
 * TubeGeometry は曲線に沿って ringCount 個の輪 (= ring) で頂点を生成する。 各 ring を
 * course の slope_pct で塗り分ける (= GPX 由来の勾配色分け) ために、 ring index を
 * course index へ写して slope を引く純関数。 slope 欠損は 0 扱い。
 *
 * @param {Array<{slope_pct?: number}>} course
 * @param {number} ringCount - tubularSegments + 1
 * @returns {Float32Array} 長さ ringCount の slope_pct 列
 */
export function courseRingSlopes(course, ringCount) {
  if (!Array.isArray(course) || course.length === 0) {
    throw new RangeError('courseRingSlopes: course must be a non-empty array');
  }
  const n = Math.max(1, Math.floor(ringCount));
  const out = new Float32Array(n);
  const last = course.length - 1;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const idx = Math.max(0, Math.min(last, Math.round(t * last)));
    let s = course[idx].slope_pct;
    if (s == null || Number.isNaN(s)) s = 0;
    out[i] = s;
  }
  return out;
}
