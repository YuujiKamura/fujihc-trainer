// b12 Phase 3 部品2: 地形メッシュ.
//
// 連結済み標高グリッド (tile_loader3d.js が返す stitched) と航空写真 Canvas から、
// Three.js の地形 Mesh を組む。 頂点格子の組み立て (投影・間引き・winding) は
// terrain3d.js の buildTerrainGeometry が SoT ── 本モジュールはその typed array を
// BufferGeometry に詰め、 テクスチャを貼り、 Mesh にするだけの薄い描画層。
//
// 差し替え口メソッドは持たない (= renderCourse / boot から facade が呼ぶ内部部品)。

import * as THREE from 'three';
import { buildTerrainGeometry } from '../terrain3d.js';

// 頂点格子の片辺の目標上限。 数枚 × 256px を 1:1 で頂点化すると数百万頂点になるため、
// stitch 後のグリッドを step 間引きしてこの程度に収める (= terrain3d.html 準拠)。
const TARGET_GRID_DIM = 400;

/**
 * 標高グリッドの大きさから頂点格子の間引き step を決める.
 *
 * 長辺を targetGridDim 程度に収める最小の step。 1 未満にはしない (= 間引き無し下限)。
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [targetGridDim=TARGET_GRID_DIM]
 * @returns {number}
 */
export function terrainStep(width, height, targetGridDim = TARGET_GRID_DIM) {
  return Math.max(1, Math.ceil(Math.max(width, height) / targetGridDim));
}

/**
 * 連結標高グリッド + 航空写真 Canvas から地形メッシュを組む.
 *
 * @param {{stitched:{grid:Float32Array,width:number,height:number},
 *          range:object, photoCanvas:HTMLCanvasElement,
 *          exaggeration?:number}} args
 * @returns {{mesh: THREE.Mesh, geo: object}}
 *   geo は buildTerrainGeometry の戻り (= minH/maxH/sizeX/sizeZ/centerLat/centerLon/
 *   vertexCount)。 カメラ初期化・fog 距離・コースリボン投影が参照する。
 */
export function buildTerrainMesh({ stitched, range, photoCanvas, exaggeration = 1.0 }) {
  const step = terrainStep(stitched.width, stitched.height);
  const geo = buildTerrainGeometry(stitched, range, { tileSize: 256, step, exaggeration });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(geo.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(geo.indices, 1));
  // 法線は頂点格子から算出 ── 太陽光 (DirectionalLight) の陰影が地形の凹凸に乗る。
  geometry.computeVertexNormals();

  // 航空写真を地形に貼るテクスチャ。 colorSpace を sRGB にしないと色が眠くなる。
  const texture = new THREE.CanvasTexture(photoCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // roughness 1 / metalness 0 = つや消し ── 航空写真の地表が金属反射しないように。
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, geo };
}

/**
 * 地形メッシュの GPU リソースを解放する (= コース再読込・再初期化時の後始末).
 *
 * @param {THREE.Mesh} mesh - buildTerrainMesh が返した mesh
 */
export function disposeTerrainMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
  }
}
