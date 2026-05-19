// b13-2: 地表高さの一元管理 + 地形メッシュ表面サンプラ.
//
// terrain3d.js は無改造規約 (= 理由は配布元配慮ではなく「terrain3d.test.js で広く
// テストされ terrain3d.html と共有の SoT」だから)。 その純関数を import して使う。
//
// 本モジュールが持つもの:
//   - ROAD_OFFSET_M    : 路面オフセット (m)
//   - TARGET_GRID_DIM  : 地形メッシュ頂点格子の片辺目標上限
//   - meshGridStep     : 地形メッシュ間引き step の SoT (terrain_mesh3d.js も参照)
//   - sampleMeshHeight : 地形メッシュが実際に描く「間引き面」の標高サンプラ
//   - TerrainSurface   : フル解像度 DEM の地表高さクラス
//
// 座標系 SoT: 東 = +X、 上 = +Y、 北 = -Z (terrain3d.js と一致)。

import { sampleHeightBilinear } from '../terrain3d.js';
import { lonToTileX, latToTileY } from '../tile_math.js';

const M_PER_DEG_LAT = 111320;

/**
 * コースリボン / マーカー / ラベルの路面オフセット (m)。
 * 地表に密着しつつ z-fighting チラつきを防ぐ最小量。
 * 旧値 15m (リボン) / 25m (マーカー) は過大、 2m で統一。
 * b13-4 でスライダー化して実画面で詰める。
 */
export const ROAD_OFFSET_M = 2;

/**
 * 地形メッシュ頂点格子の片辺の目標上限。
 * 数枚 × 256px を 1:1 で頂点化すると数百万頂点になるため、 stitch 後のグリッドを
 * meshGridStep の step で間引いてこの程度に収める (= terrain3d.html 準拠)。
 */
export const TARGET_GRID_DIM = 400;

/**
 * 標高グリッドの大きさから地形メッシュの頂点間引き step を決める純関数.
 *
 * 長辺を targetGridDim 程度に収める最小の step。 1 未満にはしない (= 間引き無し下限)。
 * 地形メッシュ (terrain_mesh3d.js / buildTerrainGeometry) とコースリボンの drape
 * (sampleMeshHeight) が同じ間引き面を共有するための SoT ── 2 箇所で別々に式を持つと
 * 食い違ってコースが地形メッシュに埋まる。
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [targetGridDim=TARGET_GRID_DIM]
 * @returns {number}
 */
export function meshGridStep(width, height, targetGridDim = TARGET_GRID_DIM) {
  return Math.max(1, Math.ceil(Math.max(width, height) / targetGridDim));
}

/**
 * 地形メッシュが実際に描く「間引き面」の標高 (m) を緯度経度で返す純関数.
 *
 * sampleHeightBilinear はフル解像度 DEM グリッドを補間するが、 表示される地形メッシュ
 * (buildTerrainGeometry) は step で間引いた粗い三角形面。 コースリボンをフル解像度で
 * drape すると、 凹凸区間でこの間引き面と食い違い帯が地形に埋まる / 浮く。 そこで
 * コース側はフル解像度ではなく「間引き面」をこの関数でサンプルし、 地形メッシュ表面
 * そのものへ沿わせる。
 *
 * buildTerrainGeometry (terrain3d.js L104-181) の頂点写像・三角形分割を厳密になぞる:
 *   - 頂点 (i,j) の画素 = (min(width-1, i*step), min(height-1, j*step))
 *   - セルの三角形分割 = tri1 (a,c,b) / tri2 (b,c,d)、 対角は b-c
 * これで sampleMeshHeight × exaggeration が地形メッシュの頂点 Y と一致する。
 *
 * @param {{grid:Float32Array, width:number, height:number}} stitched
 * @param {{zoom:number, xMin:number, yMin:number}} range
 * @param {number} lat
 * @param {number} lon
 * @param {number} step - 地形メッシュの間引き step (= meshGridStep の戻り)
 * @param {number} [tileSize=256]
 * @returns {number} 間引き面の標高 m (= グリッド範囲外は端へ clamp)
 */
export function sampleMeshHeight(stitched, range, lat, lon, step, tileSize = 256) {
  const { grid, width, height } = stitched;
  const { zoom, xMin, yMin } = range;
  const s = Math.max(1, Math.floor(step));
  // 連続タイル画素座標 (= sampleHeightBilinear / buildTerrainGeometry と同じ写像)。
  const fx = Math.max(0, Math.min(width - 1, (lonToTileX(lon, zoom) - xMin) * tileSize));
  const fy = Math.max(0, Math.min(height - 1, (latToTileY(lat, zoom) - yMin) * tileSize));
  // 間引き頂点格子の寸法 (= buildTerrainGeometry の gw/gh と同一式)。
  const gw = Math.floor((width - 1) / s) + 1;
  const gh = Math.floor((height - 1) / s) + 1;
  // 画素座標を間引き格子座標へ。 セル index は [0, g-2]、 セル内比率は [0,1] にクランプ。
  const gx = fx / s, gy = fy / s;
  const i0 = Math.max(0, Math.min(gw - 2, Math.floor(gx)));
  const j0 = Math.max(0, Math.min(gh - 2, Math.floor(gy)));
  const tu = Math.max(0, Math.min(1, gx - i0));
  const tv = Math.max(0, Math.min(1, gy - j0));
  // 間引き頂点 (i,j) の標高 (= buildTerrainGeometry の px=min(width-1,i*step) 写像)。
  const vh = (i, j) => grid[Math.min(height - 1, j * s) * width + Math.min(width - 1, i * s)];
  const ha = vh(i0, j0), hb = vh(i0 + 1, j0);
  const hc = vh(i0, j0 + 1), hd = vh(i0 + 1, j0 + 1);
  // buildTerrainGeometry と同じ三角形分割: 対角 b-c で 2 枚に割る。
  //   tri1 = a,c,b (tu+tv<=1) / tri2 = b,c,d (tu+tv>1)。
  if (tu + tv <= 1) {
    return ha + tu * (hb - ha) + tv * (hc - ha);
  }
  return hd + (1 - tu) * (hc - hd) + (1 - tv) * (hb - hd);
}

/**
 * 地表高さのサンプルと XZ 投影を提供するクラス.
 *
 * terrain3d.js の sampleHeightBilinear を内部で呼び、 exaggeration を掛けて
 * ワールド Y (地表高さ) を返す。 project は buildTerrainGeometry と同一投影。
 */
export class TerrainSurface {
  /**
   * @param {{stitched:object, range:object, centerLat:number, centerLon:number,
   *          tileSize?:number, exaggeration?:number}} opts
   */
  constructor({ stitched, range, centerLat, centerLon, tileSize = 256, exaggeration = 1.0 }) {
    this._stitched = stitched;
    this._range = range;
    this._centerLat = centerLat;
    this._centerLon = centerLon;
    this._tileSize = tileSize;
    this._exaggeration = exaggeration;
  }

  /**
   * 地表ワールド Y (標高 m × exaggeration) を返す.
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {number}
   */
  heightAt(lat, lon) {
    return sampleHeightBilinear(
      this._stitched, this._range, lat, lon, this._tileSize,
    ) * this._exaggeration;
  }

  /**
   * 地理座標を XZ ワールド座標に変換する (Y は含めない).
   *
   * buildTerrainGeometry と同一投影 (東 = +X、 北 = -Z)。
   *
   * @param {number} lat
   * @param {number} lon
   * @returns {{x:number, z:number}}
   */
  project(lat, lon) {
    const mPerDegLon = M_PER_DEG_LAT * Math.cos((this._centerLat * Math.PI) / 180);
    return {
      x: (lon - this._centerLon) * mPerDegLon,
      z: -(lat - this._centerLat) * M_PER_DEG_LAT,
    };
  }
}
