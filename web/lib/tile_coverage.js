// course 沿いのタイル列挙 + 外接矩形 (pure functions).
// Python `src/fujihill/tile_coverage.py` と同 logic.
// JS では (z, x, y) tuple の代わりに `"z/x/y"` 文字列 set を返す.

import { lonToTileX, latToTileY } from './tile_math.js';

/**
 * course (lat/lon を持つ点列) を corridor 込みで覆うタイル集合を返す.
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {Array<number>} zoomLevels
 * @param {number} corridorTiles 各 course 点周辺の何タイルか.
 *        3 → 3x3 (= 中央 + 周辺 8), 1 → 中央のみ. 偶数は中央寄せで切り捨て.
 * @returns {Set<string>} `"z/x/y"` 文字列の set.
 */
export function enumerateCoverageTiles(course, zoomLevels, corridorTiles = 3) {
  const tiles = new Set();
  if (!course || course.length === 0) return tiles;
  // corridor=3 → radius=1 (中央±1), corridor=1 → radius=0, corridor=5 → radius=2
  const radius = Math.floor(corridorTiles / 2);
  for (const z of zoomLevels) {
    const scale = Math.pow(2, z);
    for (const p of course) {
      const tx0 = Math.floor(lonToTileX(p.lon, z));
      const ty0 = Math.floor(latToTileY(p.lat, z));
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const tx = tx0 + dx;
          const ty = ty0 + dy;
          // タイル座標が有効範囲内かチェック (Web Mercator は 0..2^z-1)
          if (tx < 0 || tx >= scale || ty < 0 || ty >= scale) continue;
          tiles.add(`${z}/${tx}/${ty}`);
        }
      }
    }
  }
  return tiles;
}

/**
 * course から外接矩形 [west, south, east, north] を返す.
 * buffer_m: 矩形に対する余白 (m). 緯度 1 度 ≒ 111320 m で換算, 経度は cos(midLat) で補正.
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {number} bufferM
 * @returns {[number, number, number, number]} [W, S, E, N]
 */
export function computeBounds(course, bufferM = 1000) {
  if (!course || course.length === 0) {
    throw new RangeError('computeBounds: course must be non-empty');
  }
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of course) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const midLat = (minLat + maxLat) / 2;
  const latBuf = bufferM / 111320;
  const lonBuf = bufferM / (111320 * Math.cos(midLat * Math.PI / 180));
  return [
    minLon - lonBuf,
    minLat - latBuf,
    maxLon + lonBuf,
    maxLat + latBuf,
  ];
}

/**
 * enumerateCoverageTiles の結果を zoom 別 count に集約.
 * DL 前見積もり用. brief 14 の総量見積もり表との一致を test で担保する.
 *
 * Python 側 `src/fujihill/tile_coverage.py` の `estimate_tile_count` と同 signature /
 * 同 logic. 戻り型は Python の list of (zoom, count) tuple と等価な
 * Array<[zoom, count]>.
 *
 * @param {Array<{lat: number, lon: number}>} course
 * @param {Iterable<number>} zoomLevels - 例: [17] or [14, 15, 16, 17, 18]
 * @param {number} corridorTiles - default 3 (= 3x3)
 * @returns {Array<[number, number]>} - [[zoom, count], ...] 入力 zoom_levels の順序維持
 */
export function estimateTileCount(course, zoomLevels, corridorTiles = 3) {
  const zooms = Array.from(zoomLevels);
  return zooms.map(z => {
    const tiles = enumerateCoverageTiles(course, [z], corridorTiles);
    return [z, tiles.size];
  });
}
