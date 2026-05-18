// 地図描画モジュール (b12 Phase 2 / Phase 2.5).
//
// viewer-maplibre.js が地図を触る唯一の窓口。 viewer 本体は map インスタンスを持たず、
// createMapRenderer() が返す renderer の「意味メソッド」経由でしか地図を操作しない。
//
// Phase 2.5 の要点: 差し替え口を MapLibre API 寄りの粒度 (addSource / setData 的) から
// 「意味ベースの粒度」に切り直した。viewer は「コースを描け」「ライダーをここに置け」
// 「カメラをライダーに追随させろ」と頼むだけで、 GeoJSON 組み立て・レイヤー定義・
// カメラオブジェクト生成といった MapLibre 形のロジックは全部この中に閉じる。
// Phase 3 の Three.js 実装は同じ意味メソッド群を満たすだけでよい (= 描画エンジンの seam)。
//
// この Phase では中身は MapLibre のまま (= 動作不変)。
//
// maplibregl は index.html の <script src="...maplibre-gl.js"> が立てる global を参照する。

import { gsiToTerrariumUpsampled } from './terrain_mesh.js';
import { parseTileCoord, terrainTileKey, terrainCacheKind, riderFrameChanged } from './frame_diff.js';
import { getMeshCache, setMeshCache, computeCourseHash } from './mesh_cache.js';
import { registerPmtilesProtocol } from './pmtiles_loader.js';
import { buildGradeColoredRoadPolygons } from './road_polygon.js';
import { buildSegmentLabels } from './segment_labels.js';
import { buildRiderFeatures } from './rider_styles.js';
import { computeCameraParams, adjustZoom, adjustPitch } from './camera_controller.js';
import { computeTravelHeading } from './heading.js';

// upsample 倍率. 2 で 256x256 -> 512x512。 bilinear upsample は元 DEM に無い情報を
// 生まない (= ただの補間)、 4 は 1 タイル 4 MB RGBA を生んで VRAM / 転送帯域を浪費する。
const TERRAIN_UPSAMPLE_FACTOR = 2;

// タイル取得経路の base URL (= viewer-maplibre.js と同一の location 由来導出)。
const BASE_PATH = location.pathname.replace(/\/[^/]*$/, '/');
const BRIDGE_TILE_BASE_URL = `${location.origin}/tiles`;
const STATIC_TILE_BASE_URL = `${location.origin}${BASE_PATH}static`;

// 距離ラベル文字の基準サイズ (px)。 小さめ = billboard の衝突箱が小さく、 標識が多く並ぶ。
const SEG_LABEL_FONT_PX = 22;
// ラベルは rider 近傍の距離窓 (= 後方 LABEL_BACK_M 〜 前方 LABEL_AHEAD_M) だけ表示する。
const LABEL_BACK_M = 150;
const LABEL_AHEAD_M = 450;

// 1 つのラベル文字列を「透明背景 + 白文字 + 黒ハロー、 左揃え」の画像に描き、
// MapLibre addImage 用の ImageData を返す (= glyphs 配信 infra 不要の icon-image 方式)。
function makeSegLabelImage(text) {
  const font = `bold ${SEG_LABEL_FONT_PX}px ui-monospace, "Courier New", monospace`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const haloW = Math.round(SEG_LABEL_FONT_PX * 0.16); // ハロー幅 (= 縁取りの太さ)
  const pad = haloW + 4; // ハローが端で切れないための余白
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = Math.ceil(SEG_LABEL_FONT_PX * 1.35) + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = haloW;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.strokeText(text, pad, h / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, pad, h / 2);
  return ctx.getImageData(0, 0, w, h);
}

// === GSI 標高 PNG を terrarium 形式 PNG に変換するカスタムプロトコル ===
// brief 21: 変換ロジックは web/lib/terrain_mesh.js に切出し済 (= test 6 件で pin)、
// ここはタイル DL + Canvas decode + lib 呼出 + Blob 出力の thin adapter のみ.
maplibregl.addProtocol('gsidem', (params) => {
  const url = params.url.replace(/^gsidem:\/\//, '');
  return new Promise((resolve, reject) => {
    // brief b2 Critical-2: terrarium 変換結果 (= 重い CPU 処理) を mesh_cache に persist。
    const coord = parseTileCoord(url);
    const cacheKind = terrainCacheKind(TERRAIN_UPSAMPLE_FACTOR);
    const tileKey = coord ? terrainTileKey(coord.z, coord.x, coord.y) : null;

    const decodeAndUpsample = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const W = img.width, H = img.height;
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = W; srcCanvas.height = H;
        const sctx = srcCanvas.getContext('2d');
        sctx.drawImage(img, 0, 0);
        let srcImage;
        try { srcImage = sctx.getImageData(0, 0, W, H); }
        catch (e) { reject(e); return; }
        const result = gsiToTerrariumUpsampled(srcImage.data, W, H, TERRAIN_UPSAMPLE_FACTOR);
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = result.width;
        dstCanvas.height = result.height;
        const dctx = dstCanvas.getContext('2d');
        const dstImage = dctx.createImageData(result.width, result.height);
        dstImage.data.set(result.data);
        dctx.putImageData(dstImage, 0, 0);
        dstCanvas.toBlob((blob) => {
          if (!blob) { reject(new Error('toBlob failed')); return; }
          blob.arrayBuffer().then((buf) => {
            const bytes = new Uint8Array(buf);
            if (tileKey) {
              setMeshCache(tileKey, cacheKind, { png: bytes }).catch(() => {});
            }
            resolve({ data: bytes });
          }).catch(reject);
        }, 'image/png');
      };
      img.onerror = () => reject(new Error('GSI tile load failed: ' + url));
      img.src = url;
    };

    if (tileKey) {
      getMeshCache(tileKey, cacheKind).then((rec) => {
        if (rec && rec.arrays && rec.arrays.png) {
          resolve({ data: rec.arrays.png });
        } else {
          decodeAndUpsample();
        }
      }).catch(() => decodeAndUpsample());
    } else {
      decodeAndUpsample();
    }
  });
});

// === Map style 構築 ===
// COMMON_LAYERS / COMMON_SKY は mode 非依存 (= layers は source.id 名で参照、
// 物理化された 1 コピー、 NG-R1-11 双子コピペ回避)。
export const COMMON_LAYERS = [
  // 背景の単色 (= PMTiles 未整備時の fallback、 灰白で地形の凹凸が見える)
  { id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e8' } },
  { id: 'earth', type: 'fill', source: 'osm', 'source-layer': 'earth',
    paint: { 'fill-color': '#f5f5f0' } },
  { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water',
    paint: { 'fill-color': '#a8d8ea' } },
  { id: 'landuse-forest', type: 'fill', source: 'osm', 'source-layer': 'landuse',
    filter: ['in', 'kind', 'forest', 'wood', 'park'],
    paint: { 'fill-color': '#cfe7c8', 'fill-opacity': 0.7 } },
  { id: 'roads', type: 'line', source: 'osm', 'source-layer': 'roads',
    paint: { 'line-color': '#888', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1.5, 22, 6] } },
  { id: 'roads-major', type: 'line', source: 'osm', 'source-layer': 'roads',
    filter: ['in', 'kind', 'highway', 'major_road'],
    paint: { 'line-color': '#ffb84d', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 15, 3, 22, 12] } },
  // 地形シェーディング + 光源方向 (= 朝の太陽を南東から、 山の片面を明るく / 反対面を陰に).
  { id: 'hillshade', type: 'hillshade', source: 'gsi-terrain',
    paint: {
      'hillshade-exaggeration': 1.0,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': '#404040',
      'hillshade-illumination-direction': 135,
      'hillshade-illumination-anchor': 'map',
    } },
];

// 空のグラデ: 上が濃青、 下 (= 水平線寄り) が白っぽい (= 朝/昼の自然な空).
export const COMMON_SKY = { 'sky-color': '#3a7cc4', 'horizon-color': '#e8f0f8', 'fog-color': '#d8d0c8' };

// 地図 style を組み立てる。 dbBounds は course 定義由来の DB bbox
// [sw_lon, sw_lat, ne_lon, ne_lat]、 source に bounds として渡すと「この範囲外は
// 要求しない」を MapLibre に伝えられる (= 範囲外 tile の 404 量産抑制、 brief 34 ε-7)。
export function buildMapStyle(env, dbBounds) {
  const bridgeReachable = env && (env.mode === 'bridge' || env.bridgeReachable === true);
  const sources = bridgeReachable
    ? {
        'osm': {
          type: 'vector',
          tiles: [`${BRIDGE_TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf`],
          minzoom: 13,
          maxzoom: 15,
          bounds: dbBounds,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${BRIDGE_TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: dbBounds,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      }
    : {
        'osm': {
          type: 'vector',
          url: `pmtiles://${STATIC_TILE_BASE_URL}/map.pmtiles`,
          bounds: dbBounds,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: dbBounds,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      };
  return { version: 8, sources, layers: COMMON_LAYERS, sky: COMMON_SKY };
}

// === Renderer factory ===
// viewer 本体は createMapRenderer() を 1 回呼んで renderer を得る。 地図インスタンスは
// renderer の内側に閉じ、 viewer は下記「意味メソッド」でのみ地図を操作する。
export function createMapRenderer() {
  let map = null;
  // 'idle' (= viewport 内の全 tile load + render 完了) は MapLibre 仕様上 1 度だけ発火する。
  let idleFired = false;
  const idleCbs = [];
  // start / goal の MapLibre Marker (= ride 中 hide 用)。
  let startGoalMarkers = [];
  // カメラ状態 (= 旧 viewer の userZoom / userPitch / userBearingOffset)。
  // ホイール / ドラッグ入力で更新し、 updateCamera が毎フレーム参照する。
  // 2026-05-15 user 判断: zoom 21 / pitch 85 を default に (= 走行視点として親密)。
  let userZoom = 21;
  let userPitch = 85;
  let userBearingOffset = 0;
  // 距離ラベルの倍率 (= route-labels symbol layer の icon-size)。 localStorage 永続。
  let labelScale = 1;
  try {
    const ls = parseFloat(localStorage.getItem('fujihill.labelSize'));
    if (Number.isFinite(ls) && ls > 0) labelScale = ls;
  } catch { /* localStorage 不可は default のまま */ }
  // 距離窓フィルタの間引き用 (= setFilter を 50m 刻みでしか呼ばない)。
  let lastLabelBucket = -1;
  let riderDistForLabels = 0;
  // コース描画の冪等ガード + rider 差分検出の前フレーム state。
  let courseRendered = false;
  let lastRiderFrame = null;

  function fireIdle() {
    if (idleFired) return;
    idleFired = true;
    const cbs = idleCbs.splice(0);
    for (const cb of cbs) {
      try { cb(); } catch (e) { console.warn('[map_renderer] idle callback failed:', e); }
    }
  }

  // ホイール = zoom、 縦ドラッグ = pitch、 横ドラッグ = bearing offset。
  // 旧 viewer の setupWheelZoom / setupPitchDrag をそのまま renderer 内へ移設
  // (= カメラ操作機構はレンダラ固有、 Phase 3 は Three.js 側で作り直す)。
  function wireCameraInput() {
    const el = map.getContainer();
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      // wheel 1 回 = zoom ±0.5、 center は触らない (次フレームで rider に戻る)。
      const delta = -Math.sign(e.deltaY) * 0.5;
      userZoom = adjustZoom(userZoom, delta);
      map.setZoom(userZoom);
    }, { passive: false });
    let drag = null;
    el.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, pitch: map.getPitch(), bearingOffset: userBearingOffset };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      const dx = e.clientX - drag.x;
      // 下ドラッグで水平に近づく、 上ドラッグで真上へ。 感度 5 倍 (= -dy * 2.0)。
      const newPitch = adjustPitch(drag.pitch, -dy * 2.0);
      userPitch = newPitch;
      map.setPitch(newPitch);
      // 横移動で bearing offset を加算 (= 1 pixel = 0.5 度、 360 で正規化)。
      userBearingOffset = ((drag.bearingOffset + dx * 0.5) % 360 + 360) % 360;
    });
    window.addEventListener('mouseup', () => { drag = null; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // route-labels layer の距離窓フィルタを rider 現在地に合わせて更新する。
  function applyLabelFilter() {
    if (!map || !map.getLayer || !map.getLayer('route-labels')) return;
    const lo = riderDistForLabels - LABEL_BACK_M;
    const hi = riderDistForLabels + LABEL_AHEAD_M;
    map.setFilter('route-labels', [
      'all',
      ['>=', ['get', 'distance_m'], lo],
      ['<=', ['get', 'distance_m'], hi],
    ]);
  }

  return {
    // --- ライフサイクル ---
    isBooted() { return map !== null; },

    // 地図インスタンスを生成し、 load / idle / error / カメラ入力を結線する。
    // opts: { dbBounds, dbCenter, onLoaded }。 onLoaded は setTerrain + 操作系 disable +
    // カメラ入力結線が終わった後に呼ばれ、 viewer 側の起動継続 (= status / loadCourse) を回す。
    boot(env, opts) {
      opts = opts || {};
      if (typeof window !== 'undefined' && window.pmtiles) {
        try { registerPmtilesProtocol(maplibregl, window.pmtiles); }
        catch (e) { console.warn('pmtiles protocol register failed:', e && e.message); }
      }
      map = new maplibregl.Map({
        container: 'map',
        style: buildMapStyle(env, opts.dbBounds),
        center: opts.dbCenter,
        zoom: 13,
        pitch: 60,
        bearing: 0,
        maxPitch: 85,  // MapLibre 仕様上の最大値 (= 89 にすると new Map で throw)。
        minPitch: 0,
        maxZoom: 24,
        minZoom: 13,
        maxTileCacheSize: 50,
        fadeDuration: 0,
      });
      let _loadHandled = false;
      function onMapLoad() {
        if (_loadHandled) return;
        _loadHandled = true;
        // setTerrain は style 読込後でないと throw する。 fail-open。
        try { map.setTerrain({ source: 'gsi-terrain', exaggeration: 1.0 }); }
        catch (e) { console.warn('setTerrain skipped:', e && e.message); }
        map.dragRotate.disable();
        map.touchZoomRotate.disableRotation();
        map.dragPan.disable();
        map.scrollZoom.disable();
        wireCameraInput();
        map.once('idle', fireIdle);
        if (typeof opts.onLoaded === 'function') opts.onLoaded();
      }
      map.on('load', onMapLoad);
      // fallback: 8 秒待っても 'load' が来なければ強制で onMapLoad を実行。
      setTimeout(() => {
        if (!_loadHandled) {
          console.warn('[fujihill] map load イベント 8 秒未発火、 fallback で起動続行');
          onMapLoad();
        }
      }, 8000);
      map.on('error', (e) => {
        const err = e && e.error;
        const detail = err && (err.message || err.url) ? (err.message || err.url) : (err ?? e);
        console.warn('maplibre error:', detail);
      });
      return map;
    },

    // 'idle' を購読する。 既に idle 発火済なら即時 cb を呼ぶ。
    onceIdle(cb) {
      if (typeof cb !== 'function') return;
      if (idleFired) { try { cb(); } catch (e) { console.warn('[map_renderer] idle callback failed:', e); } }
      else idleCbs.push(cb);
    },

    // --- カメラ ---
    // 初期 zoom / pitch を指定する (= 通常起動は走行視点 21/85、 MAP MODE は URL 引数)。
    setCameraDefaults({ zoom, pitch } = {}) {
      if (Number.isFinite(zoom)) userZoom = zoom;
      if (Number.isFinite(pitch)) userPitch = pitch;
    },

    // 毎フレーム、 カメラをライダー現在位置に追随させる。
    // params: { course, curIdx, fracInSegment, lon, lat, lookAhead, apply }。
    // apply=false なら camera は動かさず、 進行方位だけ計算して返す (= ride 開始前は
    // map state を動かさず idle 発火を妨げない、 旧 tick の active||mapFullyLoaded ガード)。
    // 戻り値 { headingRad } は viewer の minimap が rider の向きを描くのに使う。
    updateCamera({ course, curIdx, fracInSegment, lon, lat, lookAhead = 5, apply = true }) {
      const cam = computeCameraParams(course, { curIdx }, { userZoom, userPitch, lookAhead });
      const nextIdx = Math.min(curIdx + 1, course.length - 1);
      const camNext = computeCameraParams(course, { curIdx: nextIdx }, { userZoom, userPitch, lookAhead });
      // GPS 点間が不均一でも curIdx 変化の瞬間に視線がカクッと回らないよう線形補間。
      const bearingDiff = ((camNext.bearing - cam.bearing + 540) % 360) - 180;
      const courseBearing = cam.bearing + bearingDiff * fracInSegment;
      // user 横ドラッグ分を camera の旋回 offset として加算 (= 進行方位には足さない)。
      const smoothBearing = (courseBearing + userBearingOffset + 360) % 360;
      if (apply) {
        map.jumpTo({ ...cam, center: [lon, lat], bearing: smoothBearing });
      }
      // headingRad: minimap の矢印用 (= 横ドラッグ offset を含まない進行方位)。
      // bearingDeg: debug HUD 用 (= offset を含む実カメラ方位)。
      return {
        headingRad: (courseBearing + 360) % 360 * Math.PI / 180,
        bearingDeg: smoothBearing,
      };
    },

    // 地理座標を画面 pixel に投影する (= rider 追随 HUD の座標計算)。
    projectToScreen(lon, lat) {
      const pt = map.project([lon, lat]);
      return { x: pt.x, y: pt.y };
    },

    // デバッグ HUD 用の現在カメラ値。
    getCameraInfo() {
      const c = map.getCenter();
      return { zoom: map.getZoom(), pitch: map.getPitch(), centerLng: c.lng, centerLat: c.lat };
    },

    // 1 フレーム描画する。 MapLibre は状態変化で自動再描画するため no-op。
    // Three.js 実装ではここで scene を描く (= viewer tick から毎フレーム呼ばれる)。
    render() { /* MapLibre: 自動再描画。 Three.js: ここで描く。 */ },

    // --- コース描画 ---
    // course 点列から地形上のコース (= 勾配色の道路リボン + 距離ラベル + 起点終点マーカー
    // + ライダー層) を組み、 初期カメラをコース起点に寄せる。 起動時 1 回のみ (冪等)。
    async renderCourse(course) {
      if (courseRendered) return;
      courseRendered = true;

      // brief 24/25: 各 segment を 5m 幅の polygon に展開、 勾配グレード別色分け。
      // brief 34 ε-F: polygon 計算結果を IndexedDB に persist、 2 回目以降は skip。
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const courseHash = computeCourseHash(course);
      let polygonData = null;
      let cacheHit = false;
      if (courseHash) {
        try {
          const rec = await getMeshCache(courseHash, 'polygon');
          if (rec && rec.arrays && rec.arrays.geojson) {
            polygonData = rec.arrays.geojson;
            cacheHit = true;
          }
        } catch { /* fail-open: 既存経路に倒す */ }
      }
      if (!polygonData) {
        polygonData = buildGradeColoredRoadPolygons(course, 5);
        if (courseHash) {
          setMeshCache(courseHash, 'polygon', { geojson: polygonData }).catch(() => {});
        }
      }
      const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
      console.log(`[mesh_cache] polygon ${cacheHit ? 'HIT' : 'MISS'} ${dt.toFixed(1)}ms hash=${courseHash}`);
      map.addSource('route', { type: 'geojson', data: polygonData });
      // Fix2: 道路 polygon を最前面に挿入 (= beforeId 削除、 OSM roads-major の貫通回避)。
      map.addLayer({
        id: 'route-fill',
        type: 'fill',
        source: 'route',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.95,
          'fill-antialias': false,
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#222', 'line-width': 0.5, 'line-opacity': 0.6 },
      });

      // brief b-segment-labels / b9: コース脇に「距離+勾配」標識を約 50m 間隔で並べる。
      // 文字は canvas 画像にして icon-image (= glyphs 不要)、 billboard で立てる。
      const segLabels = buildSegmentLabels(polygonData, 50, 6);
      const segLabelFeatures = [];
      segLabels.forEach((lbl, i) => {
        const imageId = `seg-label-${i}`;
        if (!map.hasImage(imageId)) {
          map.addImage(imageId, makeSegLabelImage(lbl.text));
        }
        segLabelFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lbl.lon, lbl.lat] },
          properties: { icon: imageId, distance_m: lbl.distance_m },
        });
      });
      map.addSource('route-labels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: segLabelFeatures },
      });
      map.addLayer({
        id: 'route-labels',
        type: 'symbol',
        source: 'route-labels',
        minzoom: 13,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotation-alignment': 'viewport',
          'icon-pitch-alignment': 'viewport',
          'icon-anchor': 'left',
          'icon-size': labelScale,
          'symbol-sort-key': ['get', 'distance_m'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
      applyLabelFilter();

      // start (緑) / goal (赤) のピン。 ride 中はメイン map から hide する。
      for (const m of startGoalMarkers) { try { m.remove(); } catch {} }
      startGoalMarkers = [
        new maplibregl.Marker({ color: '#7fff00' })
          .setLngLat([course[0].lon, course[0].lat]).addTo(map),
        new maplibregl.Marker({ color: '#ff3030' })
          .setLngLat([course[course.length - 1].lon, course[course.length - 1].lat]).addTo(map),
      ];

      // ライダーの層 (= fill-extrusion で 3D 立体)。 中身は updateRider が毎フレーム更新。
      map.addSource('rider', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'rider-body',
        type: 'fill-extrusion',
        source: 'rider',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.95,
        },
      });

      // 初期カメラ: コース起点に寄せる (= 起動直後から走行視点っぽい絵)。
      map.jumpTo(computeCameraParams(course, { curIdx: 0 }, { userZoom, userPitch, lookAhead: 20 }));
    },

    // --- ライダー ---
    // ライダーを course 上の現在位置に置く。 位置 / 向き / スピンが前フレームから
    // 動いた時だけ geometry を再構築 (= 停止中は重い setData を skip)。
    updateRider({ course, curIdx, lat, lon, spin }) {
      // rider マーカーは今いる道路タイルに重なるので、 局所セグメント方位で向ける。
      const headingRad = computeTravelHeading(course, curIdx, 1) * Math.PI / 180;
      const frame = { lat, lon, heading: headingRad, spin };
      if (riderFrameChanged(lastRiderFrame, frame)) {
        const src = map && map.getSource && map.getSource('rider');
        if (src && src.setData) {
          src.setData(buildRiderFeatures(lat, lon, headingRad, spin));
        }
        lastRiderFrame = frame;
      }
    },

    // --- 距離ラベル ---
    // ラベル表示倍率を変える (= 機器設定の slider 連動)。
    setLabelScale(scale) {
      labelScale = scale;
      if (map && map.getLayer && map.getLayer('route-labels')) {
        map.setLayoutProperty('route-labels', 'icon-size', scale);
      }
    },

    // ラベルの表示窓を rider 現在地に追従させる。 50m 刻みの bucket 変化時だけ実反映。
    updateLabelWindow(riderDistM) {
      const bucket = Math.floor(riderDistM / 50);
      if (bucket === lastLabelBucket) return;
      lastLabelBucket = bucket;
      riderDistForLabels = riderDistM;
      applyLabelFilter();
    },

    // --- 光源 (= hillshade) ---
    // 太陽の方位 (0..360°)。 旧 viewer の applyLightDir の地図反映部。
    setSunlightDirection(deg) {
      if (map && map.getLayer && map.getLayer('hillshade')) {
        map.setPaintProperty('hillshade', 'hillshade-illumination-direction', deg);
      }
    },
    // 陰影の強さ (= MapLibre exaggeration、 0..1)。 旧 viewer の applyLightStr の地図反映部。
    setSunlightStrength(exaggeration) {
      if (map && map.getLayer && map.getLayer('hillshade')) {
        map.setPaintProperty('hillshade', 'hillshade-exaggeration', exaggeration);
      }
    },

    // --- 起点 / 終点マーカー ---
    // ride 中はメイン map から start/goal を退ける (= minimap には残る)。
    setStartGoalVisible(visible) {
      for (const m of startGoalMarkers) {
        const el = m.getElement && m.getElement();
        if (el) el.style.display = visible ? 'block' : 'none';
      }
    },
  };
}
