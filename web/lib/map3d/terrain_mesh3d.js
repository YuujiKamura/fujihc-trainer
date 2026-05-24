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

  // b76-polish-2: photo の luminance を bumpMap に流用して細部凹凸を太陽方向の
  // 陰影に乗せる (= DEM 由来法線では出ない木々・岩肌の質感)。 photo に既存陰影が
  // 乗ってるので bumpScale は控えめ (= 過剰だと shading 二重で破綻)、 観て調整。
  const bumpCanvas = buildBumpCanvasFromPhoto(photoCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;  // 高さマップは linear、 sRGB 変換不要
  bumpMap.anisotropy = 4;

  // roughness 1 / metalness 0 = つや消し ── 航空写真の地表が金属反射しないように。
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap,
    bumpScale: 4,  // b76-polish-3: user 「効きをもう少しやわらげた方が」 で 8→4
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  return { mesh, geo };
}

/**
 * photoCanvas から luminance ベースの高さ近似 canvas を作る純関数.
 *
 * RGB → ITU-R BT.709 luminance (= 0.2126R + 0.7152G + 0.0722B) を抽出して 1ch
 * grayscale を返す。 Three.js の bumpMap が内部 sobel で normal を計算するので、
 * ここでは平滑化せず原色 luminance のまま渡す (= 平滑化したいなら GPU shader 側で)。
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} photoCanvas
 * @returns {HTMLCanvasElement} 同サイズの grayscale canvas
 */
export function buildBumpCanvasFromPhoto(photoCanvas) {
  const w = photoCanvas.width;
  const h = photoCanvas.height;
  const src = photoCanvas.getContext('2d').getImageData(0, 0, w, h);
  const dst = document.createElement('canvas');
  dst.width = w;
  dst.height = h;
  const dstCtx = dst.getContext('2d');
  const out = dstCtx.createImageData(w, h);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const lum = Math.round(0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2]);
    d[i] = lum;
    d[i + 1] = lum;
    d[i + 2] = lum;
    d[i + 3] = 255;
  }
  dstCtx.putImageData(out, 0, 0);
  return dst;
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
    if (mesh.material.bumpMap) mesh.material.bumpMap.dispose();
    mesh.material.dispose();
  }
}
