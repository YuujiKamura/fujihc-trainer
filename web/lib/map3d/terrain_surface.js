// b13-2: 地表高さの一元管理クラス。
// terrain3d.js は配布元配慮の無改造規約のため、その純関数を import して使う。
//
// 座標系 SoT: 東 = +X、 上 = +Y、 北 = -Z (terrain3d.js と一致)。

import { sampleHeightBilinear } from '../terrain3d.js';

const M_PER_DEG_LAT = 111320;

/**
 * コースリボン / マーカー / ラベルの路面オフセット (m)。
 * 地表に密着しつつ z-fighting チラつきを防ぐ最小量。
 * 旧値 15m (リボン) / 25m (マーカー) は過大、 2m で統一。
 * b13-4 でスライダー化して実画面で詰める。
 */
export const ROAD_OFFSET_M = 2;

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
