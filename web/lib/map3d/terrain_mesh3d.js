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
import { meshGridStep } from './terrain_surface.js';

// 頂点格子の間引き step は terrain_surface.js の meshGridStep が SoT。
// コースリボンの drape (sampleMeshHeight) と同じ間引き面を共有するため、 ここで
// 別定義せず terrain_surface.js から import する (= 2 箇所定義は食い違いの元)。

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
  const step = meshGridStep(stitched.width, stitched.height);
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
  // b71-fixup-8: GSI seamlessphoto は配信 1 種で撮影時期が秋寄りに見える (= user 指摘
  // 「植生が枯れ始めてる秋富士」)。 viewer 側で multiplier color を緑微強調 (R 0.92 /
  // G 1.0 / B 0.88) に振って「夏寄り」 にシフト ── R / B を抑えて G が相対的に強く出る
  // = 茶色抑制 + 植生緑強調。 完全な季節差し替えはできないが、 視覚的に「夏」 寄りへ。
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: new THREE.Color(0.92, 1.0, 0.88),
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
