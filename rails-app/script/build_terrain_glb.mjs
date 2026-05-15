// build_terrain_glb.mjs
//
// 富士山地形 (= GSI DEM タイル) + 富士スバルラインのコース polyline (区間色付き) を
// 1 個の Three.js Scene に組み立てて、 binary GLB 形式で
// rails-app/public/models/fuji_course.glb に焼き出す build-time script.
//
// 旧 viewer は起動毎に DEM tile fetch + heightmap 構築 + polygon 構築を毎回
// 繰り返してた。 これを build 時に一発で焼いてしまえば、 viewer 側 (= Agent B 担当)
// は GLB を load するだけで terrain + course が即出てくる。
//
// ====================================================================
// 入力
// ====================================================================
//   web/static/course.json
//     [{distance_m, elevation_m, slope_pct, lat, lon}, ...] の配列 (= 1968 点)
//   web/static/tiles/gsi_dem/{z}/{x}/{y}.png
//     GSI 標高 PNG (= 256x256, RGB encoding h = (R*65536+G*256+B)/100, h>=0x800000 で
//     符号付き、 (128,0,0) が無効値マーカー).
//
// 注: brief は「terrarium encoding = (R*256+G+B/256)-32768」と書いてあったが、
// 実際のタイルは GSI dem_png 形式 (= web/lib/terrarium.js の gsiPixelToHeight 参照).
// 既存 module の logic を JS 移植して再利用する.
//
// ====================================================================
// 出力
// ====================================================================
//   rails-app/public/models/fuji_course.glb
//   - 1 Scene、 binary GLB (= glTF 2.0 magic header)
//   - 含まれる named meshes:
//       "terrain" (= PlaneGeometry + vertex color、 標高 grid を mesh 化)
//       "course"  (= LineSegments BufferGeometry、 segment 単位 vertex color
//                  で区間ごとの slope_pct grade 色)
//       "start"   (= 緑 cone, course[0] 位置)
//       "goal"    (= 赤 cone, course[last] 位置)
//       "rider"   (= 空 Group、 viewer 側で rider mesh を attach する anchor)
//
// ====================================================================
// 座標系
// ====================================================================
//   Three.js 右手座標系 (y-up):
//     x: 東向き meter (= 経度方向)
//     y: 上向き meter (= 標高)
//     z: 南向き meter (= 緯度の南方向; lat 増 = 北 = z 減)
//   原点 = course[0] (= スタート地点) の (lat, lon, elevation_m=0).
//   標高 y は course[0].elevation_m を引かない (= 海抜そのまま保持、
//   viewer 側で必要なら shift する).
//
// ====================================================================
// 既存資産との関係
// ====================================================================
//   web/lib/terrarium.js          → gsiPixelToHeight の logic を再実装
//   web/lib/tile_math.js          → lonToTileX / latToTileY の logic を再実装
//   web/lib/route_styling.js      → classifyGrade / GRADE_THRESHOLDS を再実装
//                                   (= 2026-05-15 fix の semantics = 始点側 slope_pct で塗る)
//   web/lib/road_polygon.js       → 平面 polygon は本 script では作らない
//                                   (= viewer 側で必要なら別途、 3D mesh では LineSegments で代替)
//
// pure JS ESM (= node 22+). 依存: three (GLTFExporter), pngjs (PNG decode).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// FileReader polyfill (= GLTFExporter は browser 前提で FileReader を使う、 Node 22 には無い).
// Blob は Node 22 で global、 readAsArrayBuffer / readAsDataURL の最小限実装で足りる.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.error = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          if (this.onloadend) this.onloadend({ target: this });
        })
        .catch((err) => {
          this.error = err;
          if (this.onerror) this.onerror({ target: this });
        });
    }
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
          if (this.onloadend) this.onloadend({ target: this });
        })
        .catch((err) => {
          this.error = err;
          if (this.onerror) this.onerror({ target: this });
        });
    }
  };
}

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { PNG } from 'pngjs';

// ----- Paths --------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_WEB_STATIC = path.resolve(__dirname, '..', '..', 'web', 'static');
const COURSE_JSON_PATH = path.join(REPO_WEB_STATIC, 'course.json');
const DEM_BASE_PATH = path.join(REPO_WEB_STATIC, 'tiles', 'gsi_dem');
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'models');
const OUT_PATH = path.join(OUT_DIR, 'fuji_course.glb');

// ----- Constants ----------------------------------------------------------

// 1 度 latitude あたりの meter (= 地球を球で近似).
const METERS_PER_DEG_LAT = 111320;

// DEM タイル zoom (= z=12 で course bbox を 2x2 = 4 タイルで覆える).
// brief 注意「z=12 で 9-16 枚程度に抑える」 → 実測 4 タイル (x=3625-3626, y=1616-1617).
const DEM_ZOOM = 12;

// terrain mesh のダウンサンプル率 (= n pixel ごとに 1 vertex).
// 512x512 native pixel grid をそのまま頂点化すると ~17MB の GLB になる、
// downsample=2 で 256x256 (= 65k vert) になり ~5MB に収まる。
// z=12 1 pixel ≒ 9.5m at 緯度 35°、 stride 2 = 約 19m grid (= ride 視点で十分滑らか).
const TERRAIN_STRIDE = 2;

// 勾配グレード閾値テーブル (= web/lib/route_styling.js GRADE_THRESHOLDS と一致).
// min inclusive, max exclusive.
const GRADE_THRESHOLDS = [
  { name: 'flat',      min: -Infinity, max: 1,        color: 0x3aa055 },
  { name: 'gentle',    min: 1,         max: 4,        color: 0xa3c853 },
  { name: 'moderate',  min: 4,         max: 7,        color: 0xf4d03f },
  { name: 'hard',      min: 7,         max: 10,       color: 0xe67e22 },
  { name: 'very_hard', min: 10,        max: 15,       color: 0xe74c3c },
  { name: 'extreme',   min: 15,        max: Infinity, color: 0x8e44ad },
];
const DEFAULT_GRADE = GRADE_THRESHOLDS[0];

// ----- Pure helpers (= web/lib mirror) -----------------------------------

// web/lib/tile_math.js mirror.
function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}
function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}
function tileXToLon(x, zoom) {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}
function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// web/lib/terrarium.js mirror (= GSI dem_png decode).
function gsiPixelToHeight(r, g, b) {
  if (r === 128 && g === 0 && b === 0) return null;
  let h = r * 65536 + g * 256 + b;
  if (h >= 8388608) h -= 16777216;
  return h / 100;
}

// web/lib/route_styling.js classifyGrade mirror (= 0xRRGGBB int).
function classifyGrade(slopePct) {
  if (slopePct === null || slopePct === undefined || Number.isNaN(slopePct)) {
    return DEFAULT_GRADE;
  }
  for (const g of GRADE_THRESHOLDS) {
    if (slopePct >= g.min && slopePct < g.max) return g;
  }
  return DEFAULT_GRADE;
}

// ----- DEM loading -------------------------------------------------------

/**
 * 与えられた tile (z, x, y) の PNG を decode し、 256x256 の Float32Array
 * (= 標高 m grid、 invalid は 0) を返す。
 */
function loadDemTile(z, x, y) {
  const filePath = path.join(DEM_BASE_PATH, String(z), String(x), `${y}.png`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`DEM tile not found: ${filePath}`);
  }
  const buf = fs.readFileSync(filePath);
  const png = PNG.sync.read(buf);
  if (png.width !== 256 || png.height !== 256) {
    throw new Error(
      `DEM tile ${filePath} has unexpected dims: ${png.width}x${png.height}`,
    );
  }
  const grid = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4];
    const g = png.data[i * 4 + 1];
    const b = png.data[i * 4 + 2];
    const h = gsiPixelToHeight(r, g, b);
    grid[i] = h === null ? 0 : h;
  }
  return grid;
}

/**
 * course bbox を覆う z=DEM_ZOOM の tile 範囲 (x: xMin..xMax, y: yMin..yMax) を
 * 縦横タイル個数分 stitch して、 1 枚の大きな heightmap grid に統合。
 *
 * 戻り値:
 *   heights: Float32Array (length = (totalCols*256) * (totalRows*256))
 *   width, height: pixel 単位
 *   north, south, east, west: stitch 全体の bbox (degrees)
 *   originLat, originLon: course[0] の lat/lon (= local meters 系の原点)
 */
function stitchDem(course) {
  const lats = course.map((p) => p.lat);
  const lons = course.map((p) => p.lon);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);

  const xMin = Math.floor(lonToTileX(lonMin, DEM_ZOOM));
  const xMax = Math.floor(lonToTileX(lonMax, DEM_ZOOM));
  const yMin = Math.floor(latToTileY(latMax, DEM_ZOOM)); // 北 (大 lat) は小 y
  const yMax = Math.floor(latToTileY(latMin, DEM_ZOOM));

  const cols = xMax - xMin + 1;
  const rows = yMax - yMin + 1;
  console.log(
    `[stitchDem] course bbox lat[${latMin.toFixed(5)}, ${latMax.toFixed(
      5,
    )}], lon[${lonMin.toFixed(5)}, ${lonMax.toFixed(5)}]`,
  );
  console.log(
    `[stitchDem] z=${DEM_ZOOM} tile range x[${xMin}..${xMax}] y[${yMin}..${yMax}], total ${
      cols * rows
    } tiles`,
  );

  const tileSize = 256;
  const stitchedW = cols * tileSize;
  const stitchedH = rows * tileSize;
  const heights = new Float32Array(stitchedW * stitchedH);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const grid = loadDemTile(DEM_ZOOM, xMin + tx, yMin + ty);
      for (let py = 0; py < tileSize; py++) {
        for (let px = 0; px < tileSize; px++) {
          const dx = tx * tileSize + px;
          const dy = ty * tileSize + py;
          heights[dy * stitchedW + dx] = grid[py * tileSize + px];
        }
      }
    }
  }

  // stitch 全体の bbox (= degrees).
  const west = tileXToLon(xMin, DEM_ZOOM);
  const east = tileXToLon(xMax + 1, DEM_ZOOM);
  const north = tileYToLat(yMin, DEM_ZOOM);
  const south = tileYToLat(yMax + 1, DEM_ZOOM);

  return {
    heights,
    width: stitchedW,
    height: stitchedH,
    north,
    south,
    east,
    west,
    originLat: course[0].lat,
    originLon: course[0].lon,
  };
}

// ----- Coordinate conversion (lat/lon -> local meters) -------------------

/**
 * lat/lon を Three.js 局所メートル座標 (x 東, z 南) に変換。
 * 原点 = (originLat, originLon).
 */
function llToLocalXZ(lat, lon, originLat, originLon) {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  const x = (lon - originLon) * METERS_PER_DEG_LAT * cosLat;
  const z = -(lat - originLat) * METERS_PER_DEG_LAT; // lat 増 = 北 = z 減
  return { x, z };
}

// ----- Terrain mesh builder ----------------------------------------------

/**
 * Stitched heightmap を Three.js PlaneGeometry に変換して、 vertex 標高を
 * setZ ではなく y (= up) 軸に sets する mesh を作る。
 *
 * 重要: PlaneGeometry は default で XY 平面に貼られる (Z=0)。 これを XZ 平面
 * (= y-up) に回す = -PI/2 X 回転 + 標高は position.y に書く。
 *
 * mesh color: 標高に応じた青→緑→茶→白の terrain ramp (vertex color、
 * vertexColors=true material).
 *
 * 計算量: stitched pixel = 512x512 = 262144 頂点。 Plane segment は (w-1)*(h-1)
 * × 2 = ~52 万 triangle。 GLB 数 MB 想定。
 */
function buildTerrainMesh(dem) {
  const { heights, width, height, north, south, east, west, originLat, originLon } = dem;

  // stitched 4 隅を local meter に変換 (= mesh の x/z extent).
  const nw = llToLocalXZ(north, west, originLat, originLon);
  const se = llToLocalXZ(south, east, originLat, originLon);
  const widthM = se.x - nw.x;
  const heightM = se.z - nw.z; // SE は南なので z が大 → 正
  const centerX = (nw.x + se.x) / 2;
  const centerZ = (nw.z + se.z) / 2;

  // downsample: stride 個おきに 1 vertex を採取.
  const stride = TERRAIN_STRIDE;
  const sampledW = Math.floor((width - 1) / stride) + 1;
  const sampledH = Math.floor((height - 1) / stride) + 1;

  // PlaneGeometry の segment 数 = sampled - 1 (= 1 sample = 1 vertex)
  const segW = sampledW - 1;
  const segH = sampledH - 1;
  const geom = new THREE.PlaneGeometry(widthM, heightM, segW, segH);

  // -X 軸まわりに -PI/2 回転 → XY 平面 → XZ 平面 (y-up).
  geom.rotateX(-Math.PI / 2);
  // PlaneGeometry の vertex は原点中心、 (centerX, _, centerZ) に平行移動.
  geom.translate(centerX, 0, centerZ);

  // position.y を heights から書き込む。
  // PlaneGeometry の vertex 並び順: row 方向 (= y 軸) → col 方向 (= x 軸)。
  // rotateX(-PI/2) 後の vertex (px, py, pz):
  //   px は col 方向 (= 東)、 元 plane の x 軸
  //   pz は row 方向 (= 南)、 元 plane の -y 軸 (= rotateX 後の z)
  // つまり vertex i = row * sampledW + col.
  const pos = geom.attributes.position;
  const colorArr = new Float32Array(sampledW * sampledH * 3);
  const elevMin = 1000;
  const elevMax = 3800;
  for (let row = 0; row < sampledH; row++) {
    for (let col = 0; col < sampledW; col++) {
      // 元 pixel index (= row * stride, col * stride を最大値で clip).
      const srcRow = Math.min(height - 1, row * stride);
      const srcCol = Math.min(width - 1, col * stride);
      const h = heights[srcRow * width + srcCol];
      const i = row * sampledW + col;
      pos.setY(i, h);
      // 標高に応じた色: < 1500m=緑, 1500-2500=茶, 2500-3500=灰, > 3500=白.
      const t = Math.max(0, Math.min(1, (h - elevMin) / (elevMax - elevMin)));
      let r, g, b;
      if (t < 0.25) {
        // 緑 (#3a7a3a) → 黄緑 (#7a9a3a)
        const k = t / 0.25;
        r = (0x3a + k * (0x7a - 0x3a)) / 255;
        g = (0x7a + k * (0x9a - 0x7a)) / 255;
        b = (0x3a + k * (0x3a - 0x3a)) / 255;
      } else if (t < 0.55) {
        // 黄緑 → 茶 (#8a6a3a)
        const k = (t - 0.25) / 0.3;
        r = (0x7a + k * (0x8a - 0x7a)) / 255;
        g = (0x9a + k * (0x6a - 0x9a)) / 255;
        b = (0x3a + k * (0x3a - 0x3a)) / 255;
      } else if (t < 0.85) {
        // 茶 → 灰 (#aaaaaa)
        const k = (t - 0.55) / 0.3;
        r = (0x8a + k * (0xaa - 0x8a)) / 255;
        g = (0x6a + k * (0xaa - 0x6a)) / 255;
        b = (0x3a + k * (0xaa - 0x3a)) / 255;
      } else {
        // 灰 → 白
        const k = (t - 0.85) / 0.15;
        r = (0xaa + k * (0xff - 0xaa)) / 255;
        g = (0xaa + k * (0xff - 0xaa)) / 255;
        b = (0xaa + k * (0xff - 0xaa)) / 255;
      }
      colorArr[i * 3] = r;
      colorArr[i * 3 + 1] = g;
      colorArr[i * 3 + 2] = b;
    }
  }
  pos.needsUpdate = true;
  geom.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.9,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'terrain';
  return mesh;
}

// ----- Course polyline builder -------------------------------------------

/**
 * course を LineSegments で表現 (= 1 segment = 2 vertex)、 segment ごとに
 * 始点側 slope_pct (= 2026-05-15 fix の semantics: 視覚と体感の同期) で
 * classifyGrade して vertex color を塗る。
 *
 * y は course[i].elevation_m + offsetM (= 地面に埋めない、 数 m 浮かす).
 */
function buildCourseLine(course, originLat, originLon) {
  const offsetM = 5; // 地面から 5m 浮かす (= ride 視点で見やすく).
  const positions = new Float32Array((course.length - 1) * 2 * 3);
  const colors = new Float32Array((course.length - 1) * 2 * 3);

  for (let i = 0; i < course.length - 1; i++) {
    const a = course[i];
    const b = course[i + 1];
    const pa = llToLocalXZ(a.lat, a.lon, originLat, originLon);
    const pb = llToLocalXZ(b.lat, b.lon, originLat, originLon);

    // 2026-05-15 fix semantics: 始点側 slope_pct (= a.slope_pct) で塗る.
    let slope = a.slope_pct;
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = b.slope_pct;
    }
    if (slope === undefined || slope === null || Number.isNaN(slope)) {
      slope = 0;
    }
    const grade = classifyGrade(slope);
    const cr = ((grade.color >> 16) & 0xff) / 255;
    const cg = ((grade.color >> 8) & 0xff) / 255;
    const cb = (grade.color & 0xff) / 255;

    const baseIdx = i * 6;
    // start vertex
    positions[baseIdx] = pa.x;
    positions[baseIdx + 1] = a.elevation_m + offsetM;
    positions[baseIdx + 2] = pa.z;
    colors[baseIdx] = cr;
    colors[baseIdx + 1] = cg;
    colors[baseIdx + 2] = cb;
    // end vertex (= 同 segment 内なので同色)
    positions[baseIdx + 3] = pb.x;
    positions[baseIdx + 4] = b.elevation_m + offsetM;
    positions[baseIdx + 5] = pb.z;
    colors[baseIdx + 3] = cr;
    colors[baseIdx + 4] = cg;
    colors[baseIdx + 5] = cb;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    linewidth: 1, // GLTF spec では LineBasicMaterial の linewidth は 1 のみ保証
  });
  const line = new THREE.LineSegments(geom, mat);
  line.name = 'course';
  return line;
}

// ----- Start/Goal markers ------------------------------------------------

function buildCone(name, lat, lon, elevationM, originLat, originLon, color) {
  const { x, z } = llToLocalXZ(lat, lon, originLat, originLon);
  const geom = new THREE.ConeGeometry(40, 120, 8);
  // ConeGeometry default は base が y=-h/2、 tip が y=+h/2 → 高さ 120 の中心を
  // (x, elevationM + 60, z) に置けば base が elevationM、 tip が elevationM+120.
  geom.translate(x, elevationM + 60, z);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  return mesh;
}

// ----- Main ---------------------------------------------------------------

async function main() {
  console.log('[build_terrain_glb] start');
  const t0 = Date.now();

  // 1. course.json 読み込み
  if (!fs.existsSync(COURSE_JSON_PATH)) {
    throw new Error(`course.json not found: ${COURSE_JSON_PATH}`);
  }
  const course = JSON.parse(fs.readFileSync(COURSE_JSON_PATH, 'utf-8'));
  if (!Array.isArray(course) || course.length < 2) {
    throw new Error(`course.json invalid: length=${course.length}`);
  }
  console.log(`[build_terrain_glb] course.length = ${course.length}`);

  // 2. DEM stitch
  const dem = stitchDem(course);
  console.log(
    `[build_terrain_glb] stitched DEM: ${dem.width}x${dem.height}, ` +
      `bbox lat[${dem.south.toFixed(5)}, ${dem.north.toFixed(5)}], ` +
      `lon[${dem.west.toFixed(5)}, ${dem.east.toFixed(5)}]`,
  );

  // 3. Scene 構築
  const scene = new THREE.Scene();
  scene.name = 'fuji_course';

  // 注: lights は GLB に焼かない (= viewer 側 (Agent B) で AmbientLight + DirectionalLight
  // を attach する責務にする). GLTFExporter は AmbientLight 非対応 + DirectionalLight も
  // target が無いと方向 lost の warning が出るため、 こちらで持たせず Scene に
  // material と vertex color だけ持たせて viewer で点灯する方が分業として綺麗.

  // terrain
  console.log('[build_terrain_glb] building terrain mesh...');
  const terrain = buildTerrainMesh(dem);
  scene.add(terrain);
  console.log(
    `[build_terrain_glb] terrain: ${terrain.geometry.attributes.position.count} vertices`,
  );

  // course polyline
  console.log('[build_terrain_glb] building course polyline...');
  const courseLine = buildCourseLine(course, dem.originLat, dem.originLon);
  scene.add(courseLine);
  console.log(
    `[build_terrain_glb] course: ${
      courseLine.geometry.attributes.position.count
    } vertices, ${course.length - 1} segments`,
  );

  // start / goal markers
  const startCone = buildCone(
    'start',
    course[0].lat,
    course[0].lon,
    course[0].elevation_m,
    dem.originLat,
    dem.originLon,
    0x2ecc71, // 緑
  );
  const goalCone = buildCone(
    'goal',
    course[course.length - 1].lat,
    course[course.length - 1].lon,
    course[course.length - 1].elevation_m,
    dem.originLat,
    dem.originLon,
    0xe74c3c, // 赤
  );
  scene.add(startCone);
  scene.add(goalCone);

  // rider anchor (= 空 Group、 viewer 側で rider mesh を attach する).
  const riderAnchor = new THREE.Group();
  riderAnchor.name = 'rider';
  const startXZ = llToLocalXZ(
    course[0].lat,
    course[0].lon,
    dem.originLat,
    dem.originLon,
  );
  riderAnchor.position.set(startXZ.x, course[0].elevation_m + 5, startXZ.z);
  scene.add(riderAnchor);

  // 4. GLTFExporter で binary GLB に書き出し
  console.log('[build_terrain_glb] exporting to GLB...');
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    embedImages: true,
    includeCustomExtensions: false,
  });

  // result は binary=true なら ArrayBuffer
  if (!(result instanceof ArrayBuffer)) {
    throw new Error(
      `GLTFExporter returned non-ArrayBuffer (typeof=${typeof result}); binary export failed`,
    );
  }

  // 5. file output
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  const buf = Buffer.from(result);
  fs.writeFileSync(OUT_PATH, buf);

  const t1 = Date.now();
  const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
  console.log(
    `[build_terrain_glb] wrote ${OUT_PATH} (${buf.length} bytes = ${sizeMB} MB) in ${
      t1 - t0
    } ms`,
  );
}

main().catch((err) => {
  console.error('[build_terrain_glb] FAILED:', err);
  process.exit(1);
});
