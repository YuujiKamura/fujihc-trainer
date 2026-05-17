// fujihill viewer - MapLibre GL JS 試験版
// Cesium を廃止、 GSI 標高 + OSM raster で 3D 地形表示。
// addProtocol で GSI dem_png を terrarium 形式に変換して MapLibre の terrain に食わせる。
// brief 21: GSI 6m grid を bilinear 4x で 1.5m grid 等価に upsample、 ride 視点を滑らかに.

import { gsiToTerrariumUpsampled } from './lib/terrain_mesh.js';
// brief 23: GPS ジッター除去の moving average (= window 5、 短距離ジグザグ補正のみ)
import { smoothCourse } from './lib/gpx_smooth.js';
// brief 24 + 25: 勾配グレード別色分けで「一定幅の道路 polygon」として描画
import { buildGradeColoredRoadPolygons } from './lib/road_polygon.js';
// brief 34 ε-F: course 不変前提で polygon 計算結果を IndexedDB に persist、 2 回目以降 skip.
import { getMeshCache, setMeshCache, computeCourseHash } from './lib/mesh_cache.js';
// brief b2: per-frame コスト削減 ── 「変化した時だけ更新」 の判定純関数群。
import {
  riderFrameChanged, parseTileCoord, terrainTileKey, terrainCacheKind,
  createTextWriter, minimapDirty,
} from './lib/frame_diff.js';
// brief 19b: WebSocket / ride state / camera を lib に集約
import { createBridgeClient, createTestModeClient } from './lib/ws_client.js';
import { createBleClient, isWebBluetoothSupported } from './lib/ble_client.js';
import { createRideState } from './lib/ride_state.js';
// brief 35: Terrain + Rider 2 層モデル. viewer は terrain + rider を直接保持し、
// 移動状態 (= 速度 / 位置 / 補間 / 進行方位) はすべて rider/terrain API 経由で操作する.
// createRideState は HTML / 既存 source-grep tests が期待する API surface (= rideState 変数 /
// rideState.startFrom / rideState.appendTrkpt 等) を維持する shim 経路で残す (= 同じ Rider を
// 内側に持つため二重 state にはならない).
import { createTerrain } from './lib/terrain.js';
import { createRider } from './lib/rider.js';
import { applyPhysicsStep } from './lib/bike_physics.js';
import { computeCameraParams, adjustZoom, adjustPitch } from './lib/camera_controller.js';
// brief 29: minimap 上半分の OSM タイル 1-shot fetch 用の tile 座標変換
// (= 旧 inline 定義を web/lib/tile_math.js に切り出し済、 ride hot path には使わない)
import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from './lib/tile_math.js';
// brief 31: pmtiles:// protocol を MapLibre に登録 (= GitHub Pages 静的 mode 用)。
// vendored pmtiles.js は web/lib/vendor/pmtiles.js (BSD-3-Clause)、 index.html の
// <script> で window.pmtiles を IIFE 化、 ここでは window 経由で参照する。
import { registerPmtilesProtocol } from './lib/pmtiles_loader.js';
// brief 31 commit γ: checkSetupStatus を lib 抽出して behavioral test 可能に
import { checkSetupStatus as checkSetupStatusLib } from './lib/check_setup_status.js';
// brief 33: ride 終了時の 4 button bind (= GPX download / Strava upload / 履歴に保存 / 履歴を見る).
// IndexedDB 履歴 / Strava OAuth / 一覧 UI を viewer 側 inline 化せず module 経由で呼ぶ
// (= NG-R1-7 同型予防、 4 module 分離).
import { bindPostRideButtons } from './lib/postride_buttons.js';
import { openRideDb, addRide as rideDbAdd, listRides as rideDbList, deleteRide as rideDbDelete } from './lib/ride_db.js';
import { appendHistoryRow } from './lib/history_row.js';
import { ensureAccessToken, revokeLocalToken, STRAVA_TOKEN_LS_KEY } from './lib/strava_oauth.js';
// brief 34 ε: 公開ガードレール (= intro / consent 同意管理).
import {
  getIntroConsent, setIntroConsent, clearIntroConsent,
  getRideConsent, setRideConsent, clearRideConsent,
} from './lib/consent.js';
// brief 34 ε-5: 「全データ削除」UI 用の IndexedDB + localStorage 一括 clear.
import { clearAllLocalData } from './lib/clear_local_data.js';
// preflight + save_summary + autosave (= ride 開始前 validation / 保存予定 summary / 走行中保護).
import { runPreflight } from './lib/preflight_check.js';
import { renderPreflightPanel, hidePreflight } from './lib/preflight_panel.js';
import { buildSaveSummary, detectAnomalies, summaryToDisplay } from './lib/save_summary.js';
import { renderSaveSummary } from './lib/save_summary_panel.js';
import {
  saveAutosave, loadAutosave, clearAutosave, hasPendingAutosave,
  applyAutosaveToRideState,
} from './lib/ride_autosave.js';
// brief 34 ε-8: 「観る」モード (= 区間選択型コース分析) 用の区間分割 + UI helper.
import { splitCourseIntoSections, formatSectionLabel } from './lib/course_sections.js';
// brief 34 ε-9: 地形データ準備 loader. 起動直後 1 回 start()、 完了まで全アクションボタン disabled.
import { createTerrainLoader } from './lib/terrain_loader.js';

// upsample 倍率. 2 で 256x256 -> 512x512。 bilinear upsample は元 DEM に無い情報を
// 生まない (= ただの補間)、 4 は 1 タイル 4 MB RGBA を生んで VRAM / 転送帯域を浪費する。
// 低 VRAM GPU (= RX 6400 等) では DEM テクスチャ転送が描画の支配項になるため 2 に下げる
// (= VRAM は 4 の 1/4)。 2 でメッシュは十分滑らか、 視覚差は実質ゼロ。
const TERRAIN_UPSAMPLE_FACTOR = 2;

const status = (msg) => { document.getElementById('status').textContent = msg; };

// === タイル取得は全て同一 origin (bridge.py が proxy する /tiles/...) 経由 ===
// brief 17b: 外部第三者 endpoint への runtime fetch を物理的にゼロにする。
// web/tests/viewer_url_audit.test.js が source-grep gate で固定する。
// 違反した瞬間に CI が落ちる。
//
// brief 31: GitHub Pages 静的 mode との 2-way 化。
// - BRIDGE_TILE_BASE_URL: 従来 (= localhost で bridge.py 起動済) の /tiles/...
// - STATIC_TILE_BASE_URL: GitHub Pages 等 bridge 不在で、 ${BASE_PATH}static/ から
//   PNG / PMTiles / course.json を直接 fetch する path
// - BASE_PATH: GitHub Pages の project page prefix (= /fujihill-trainer/) 追従、
//   localhost (= /) でも動く。 `location.pathname.replace(/\/[^/]*$/, '/')` で
//   末尾 file 名を除いて parent path を取る。
const BASE_PATH = location.pathname.replace(/\/[^/]*$/, '/');
const BRIDGE_TILE_BASE_URL = `${location.origin}/tiles`;
const STATIC_TILE_BASE_URL = `${location.origin}${BASE_PATH}static`;

// === GSI 標高 PNG を terrarium 形式 PNG に変換するカスタムプロトコル ===
// brief 21: 変換ロジックは web/lib/terrain_mesh.js に切出し済 (= test 6 件で pin)、
// ここはタイル DL + Canvas decode + lib 呼出 + Blob 出力の thin adapter のみ.
maplibregl.addProtocol('gsidem', (params) => {
  const url = params.url.replace(/^gsidem:\/\//, '');
  return new Promise((resolve, reject) => {
    // brief b2 Critical-2: terrarium 変換結果 (= 重い CPU 処理) を mesh_cache に persist。
    // key = z/x/y タイル座標、 kind = terrain-u<倍率> (= 倍率変更で旧 cache を物理的に
    // hit させず stale を防ぐ)。 2 回目以降は DL + Canvas decode + upsample を完全 bypass。
    const coord = parseTileCoord(url);
    const cacheKind = terrainCacheKind(TERRAIN_UPSAMPLE_FACTOR);
    const tileKey = coord ? terrainTileKey(coord.z, coord.x, coord.y) : null;

    // 既存経路: タイル DL → Canvas decode → 純関数 upsample → PNG bytes。
    // 成功時、 PNG bytes を mesh_cache へ fire-and-forget で書く (= 書き込み失敗で
    // 起動を block しない、 次回 reload で再 attempt)。
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
        // 純関数で bilinear upsample + GSI -> terrarium 変換 (= brief 21).
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
      // cache lookup → hit で decode/upsample を bypass。 miss / 例外いずれも
      // getMeshCache は null を返すので既存経路に fail-open する。
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

// === Map 初期化 ===
// brief 31: bridge mode と GitHub Pages 静的 mode で source URL が違うため、
// style 構築を `buildMapStyle({bridgeReachable})` に切り出して 2 mode 共有。
// COMMON_LAYERS / COMMON_SKY は mode 非依存 (= layers は source.id 名で参照、
// 物理化された 1 コピー、 NG-R1-11 双子コピペ回避)。
// 旧 const map = new maplibregl.Map(...) は撤回、 `bootCheckSetupStatus` で
// bridgeReachable を確定してから `bootMap(bridgeReachable)` で生成する遅延化。
const COMMON_LAYERS = [
  // 背景の単色 (= PMTiles 未整備時の fallback、 灰白で地形の凹凸が見える)
  { id: 'bg', type: 'background', paint: { 'background-color': '#e8e8e8' } },
  // Protomaps の標準 vector layer (= name は Protomaps OpenMapTiles 互換 schema 前提)
  // PMTiles に layer が存在しない場合は MapLibre が silent skip、 fallback bg が見える
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
  // illumination-direction 135 = 南東 (= 0=北、 90=東、 180=南、 270=西)、
  // illumination-anchor 'map' で地理北基準 (= viewport rotate に追従しない).
  // exaggeration 1.0 + shadow #000000 + highlight #ffffff で凹凸クッキリ.
  { id: 'hillshade', type: 'hillshade', source: 'gsi-terrain',
    paint: {
      'hillshade-exaggeration': 1.0,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': '#404040',
      'hillshade-illumination-direction': 135,
      'hillshade-illumination-anchor': 'map',
    } },
  // brief 17b: prefetch 削除済、 fetch 経路は MapLibre on-demand のみ
];

// 空のグラデ: 上が濃青、 下 (= 水平線寄り) が白っぽい (= 朝/昼の自然な空).
const COMMON_SKY = { 'sky-color': '#3a7cc4', 'horizon-color': '#e8f0f8', 'fog-color': '#d8d0c8' };

// brief 34 ε-7: 富士スバルライン専用 DB bbox (= MapLibre の vector/DEM source 用).
// MapLibre の source に bounds として渡すと「この範囲外は要求しない」を伝えられる、
// DevTools で発覚した「viewer が DB 外 tile を要求 → 404 量産」問題の解決。
// GSI 再アクセスは無し (= 既得 DB をフル活用)、 外部 fetch 発生量ゼロ。
// 2026-05-15 注記: tile_constants.py:MINIMAP_BBOX とは概念的に分離。 ここは
// 主 map (z=13+ の vector + raster-dem) の source bounds、 MINIMAP_BBOX は
// 別 canvas (上半分 minimap) の z=11 raster pre-fetch 範囲。 minimap は
// course bbox + 20% margin + buffer=1 で 16 タイル要求するため MINIMAP_BBOX
// の方が広い (= MINIMAP_BBOX ⊃ FUJIHILL_DB_BOUNDS)。
export const FUJIHILL_DB_BOUNDS = [138.65, 35.30, 138.85, 35.50];
// center は bbox 中央 (= 138.75, 35.40)、 default view が DB 内に確実に収まる位置。
export const FUJIHILL_DB_CENTER = [138.75, 35.40];

export function buildMapStyle(env) {
  // brief 31 commit β: env (= immutable ENV object) 受け、 bridgeReachable は env.mode で判定。
  // 後方互換のため `{bridgeReachable: bool}` を渡されても動く (= env.bridgeReachable / env.mode は
  // 同一 ENV object で同期、 旧 caller を破壊しない signature 拡張)。
  const bridgeReachable = env && (env.mode === 'bridge' || env.bridgeReachable === true);
  // bridge mode: 個別 PBF / PNG file ツリーを localhost /tiles から fetch (= 従来)。
  // static mode: PMTiles 単一 file (pmtiles:// scheme) + ${BASE_PATH}static/tiles/gsi_dem 配下 PNG。
  // brief 34 ε-7: 両 mode の osm / gsi-terrain source に bounds を設定 (= 範囲外要求を抑制).
  const sources = bridgeReachable
    ? {
        'osm': {
          type: 'vector',
          tiles: [`${BRIDGE_TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf`],
          minzoom: 13,
          maxzoom: 15,
          bounds: FUJIHILL_DB_BOUNDS,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${BRIDGE_TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: FUJIHILL_DB_BOUNDS,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      }
    : {
        'osm': {
          type: 'vector',
          url: `pmtiles://${STATIC_TILE_BASE_URL}/map.pmtiles`,
          bounds: FUJIHILL_DB_BOUNDS,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          bounds: FUJIHILL_DB_BOUNDS,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      };
  return { version: 8, sources, layers: COMMON_LAYERS, sky: COMMON_SKY };
}

// map は `bootMap` で生成、 それまで null。 全 caller (= setupWheelZoom / loadCourse 等)
// は bootMap 完了後に呼ばれるため、 null 参照は起きない。
let map = null;
// brief 31 commit β: bridge/static mode 判定を immutable env object に集約
// (= 旧 `let _bridgeReachable = true` の mutable + race door を廃止)。
// ENV は `bootEnv()` 完了後に Object.freeze 済の値が入り、 以後変更されない。
// 全 caller (loadCourse / loadOsmTile / buildMapStyle 等) は `ENV.mode === 'bridge'`
// の形で参照する。 起動完了前に ENV が読まれた場合は null、 caller は ENV 未確定として扱う。
let ENV = null;

// checkSetupStatus を 1 回だけ呼び、 結果から ENV (immutable) を構築する。
// 既に呼ばれていれば同一 instance を返す (= idempotent)。
async function bootEnv() {
  if (ENV) return ENV;
  const s = await checkSetupStatus();
  const mode = s.bridgeReachable ? 'bridge' : 'static';
  ENV = Object.freeze({
    mode,
    bridgeReachable: s.bridgeReachable,
    tileBase: s.bridgeReachable ? BRIDGE_TILE_BASE_URL : STATIC_TILE_BASE_URL,
    courseUrl: s.bridgeReachable ? 'course.json' : `${BASE_PATH}static/course.json`,
    setupStatus: s,
  });
  return ENV;
}

function bootMap(env) {
  // pmtiles:// protocol は idempotent (= 冪等)、 bridge mode でも害なし。
  // index.html の <script src="./lib/vendor/pmtiles.js"> で window.pmtiles が IIFE 化済。
  if (typeof window !== 'undefined' && window.pmtiles) {
    try { registerPmtilesProtocol(maplibregl, window.pmtiles); }
    catch (e) { console.warn('pmtiles protocol register failed:', e && e.message); }
  }
  map = new maplibregl.Map({
    container: 'map',
    style: buildMapStyle(env),
    // brief 34 ε-7: default center を DB bbox 中央 (= 138.75, 35.40) に寄せて、
    // 起動直後の view が確実に DB 範囲内に収まるようにする (= 404 量産抑制).
    // 旧 [138.7587, 35.4521] (= 富士スバルライン Start 付近) は bbox 内ではあるが端寄り、
    // 中央寄せの方が default view から見える範囲が広い。
    center: FUJIHILL_DB_CENTER,
    zoom: 13,
    pitch: 60,
    bearing: 0,
    // pitch を default 60 → 85 まで拡張、 zoom 上限も MapLibre の最大 22 まで開放
    maxPitch: 85,  // MapLibre 仕様上の最大値 (= 89 にすると new Map で throw、 map 起動失敗).
    minPitch: 0,
    maxZoom: 24,
    minZoom: 13,
    // タイル memory cache. brief 21 で GSI dem を 4x upsample (1024x1024 RGBA = 4 MB/tile)、
    // 200 だと 800 MB VRAM 圧迫. 50 で 200 MB 上限、 ride viewport (= 9 タイル) には十分.
    maxTileCacheSize: 50,
    // タイルのクロスフェード短縮、 GPU 負荷軽減
    fadeDuration: 0,
  });
  // 2026-05-17 fix: loadCourse() / rider 初期化を map の 'load' イベントに結線していたが、
  // vector / pmtiles source の初期化が致命的に失敗する (= Range request 非対応サーバ等で
  // byte-serving が落ちる) と MapLibre は 'load' を永遠に発火しない。 その結果 loadCourse が
  // 一度も呼ばれず、 rideState が生成されず、 「描画準備中...」 overlay が永久に残り
  // HUD の total が "?" のまま固まる (= 実画面で確認された起動不全)。
  // 修正: load handler の本体を onMapLoad() に括り出し、 'load' 発火と 8 秒 fallback の
  // 両方から呼べるようにする。 _mapLoadHandled で多重実行を防止。 course 描画 / rideState
  // 生成は地図 tile の成否に依存しないので、 tile が落ちても rider は出て走れる。
  let _mapLoadHandled = false;
  function onMapLoad() {
    if (_mapLoadHandled) return;
    _mapLoadHandled = true;
    // setTerrain は style 読込後でないと throw する。 style 未完なら try-catch で握り潰し、
    // 地形なしでも course / rider 描画は続行する (= fail-open)。
    try { map.setTerrain({ source: 'gsi-terrain', exaggeration: 1.0 }); }
    catch (e) { console.warn('setTerrain skipped:', e && e.message); }
    status('map loaded');
    // 2026-05-15 fix: 「地形 data が出揃うまでデモ走行ボタンを押せないようにしろ」反映。
    // probe ok だけでは「最低限の起動」、 実 viewport の地図全 tile 描画完了は別。
    // map.on('idle') は viewport 内の全 source / tile load 完了で 1 度発火、
    // ここで mapFullyLoaded = true にして terrain probe ok と AND で button enable。
    map.once('idle', () => {
      mapFullyLoaded = true;
      updateActionButtonsForTerrain();
    });
    // 2026-05-15 fix: idle 永遠未発火 (= 一部 tile 404 / load 失敗で全 tile 揃わない) を
    // 想定して 5 秒 fallback。 過剰待ちで permanent disabled に陥らない安全弁。
    setTimeout(() => {
      if (!mapFullyLoaded) {
        mapFullyLoaded = true;
        updateActionButtonsForTerrain();
      }
    }, 5000);
    // 操作系: マウスホイールで zoom (default 維持)、 縦ドラッグで pitch だけ変更、
    // 横ドラッグ (bearing 回転) は AI が進行方向に自動セットするので無効化
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.dragPan.disable();
    // MapLibre 標準の scrollZoom は「マウスポインタ位置を中心に zoom」する。 これだと
    // tick で rider に center を戻すまでに毎フレーム rider がズレて見える。
    // scrollZoom を切って、 自前で「wheel → userZoom を増減 → map.setZoom (現 center 維持)」に。
    map.scrollZoom.disable();
    setupWheelZoom();
    setupPitchDrag();
    loadCourse();
    // brief 34 ε-6: 帰属表示 (= attribution control) の display を 1 度 assert。
    // CSS で `display:none` にされたら OSM ODbL / 国土地理院 規約違反、 warning を出す
    // (= block はせず flag のみ、 harm 主体は inject した訪問者本人).
    requestAnimationFrame(() => verifyAttributionVisible());
  }
  map.on('load', onMapLoad);
  // fallback: 8 秒待っても 'load' が来なければ強制で onMapLoad を実行 (= source 初期化失敗で
  // 'load' が永遠に発火しない MapLibre の挙動への安全弁)。 多重実行は _mapLoadHandled で防ぐ。
  setTimeout(() => {
    if (!_mapLoadHandled) {
      console.warn('[fujihill] map load イベント 8 秒未発火、 fallback で起動続行');
      onMapLoad();
    }
  }, 8000);
  map.on('error', (e) => {
    // e.error の中身まで出す (= '[object Object]' だけだとデバッグ不能)。
    const err = e && e.error;
    const detail = err && (err.message || err.url) ? (err.message || err.url) : (err ?? e);
    console.warn('maplibre error:', detail);
  });
  return map;
}

let course = [];
let totalDist = 0;
// brief 35: 移動モデルの第一級表現は Rider (= 主体) + Terrain (= 客観). 旧 module global
// (= playSpeed / curIdx / curDist / currentCadence / currentPower / currentHr / spinAngle) は
// すべて rider 内部に集約済. rideState は createRideState() の戻り値 (= 後方互換 shim、
// 同じ Rider を内側に持つ) で、 HTML 既存 grep gate + viewer 既存 caller の名前空間互換を取る.
let terrain = null;
let rider = null;
let rideState = null;
let lastT = performance.now();
let diffMult = (() => { try { return parseFloat(localStorage.getItem('fujihill.diff')) || 1.0; } catch { return 1.0; } })();
let speedMult = (() => { try { const v = parseFloat(localStorage.getItem('fujihill.spd')); return Number.isFinite(v) ? v : 1.0; } catch { return 1.0; } })();
// 2026-05-17: 物理駆動への切替。 旧 inertiaFactor (= EMA 係数 0..0.95) は見せかけの慣性で、
// 「下りで足を止めると減速がデカすぎる」 という user 不満を解けなかった。 新方式は
// web/lib/bike_physics.js の applyPhysicsStep で trainer の power とコース勾配から速度を
// 時間積分する。 慣性 slider は EMA 係数ではなくフライホイール慣性 (kg 相当) を指す。
// localStorage キーは旧 fujihill.inertia (= 0..0.95 を保存) と別名にする (= 読み違え防止)。
let inertiaKg = (() => {
  try { const v = parseFloat(localStorage.getItem('fujihill.inertiaKg')); return Number.isFinite(v) ? v : 800; }
  catch { return 800; }
})();
// 2026-05-17: 慣性シミュ (inertia-sim.html) と同じ自転車パラメータ。 applyPhysicsStep に渡す。
// 旧来 wsHandlers.state にハードコードしていた値 (mass:88 / c_rr:0.005 / c_d:0.35) を slider 化、
// localStorage に物理値で永続 (= mass kg / c_rr 係数 / cda m²)。
const _lsNum = (k, d) => {
  try { const v = parseFloat(localStorage.getItem(k)); return Number.isFinite(v) ? v : d; }
  catch { return d; }
};
let bikeMass = _lsNum('fujihill.mass', 88);    // kg (= rider + bike 総重量)
let bikeCrr  = _lsNum('fujihill.crr', 0.001);  // 転がり抵抗係数 (= 既定 1‰、 競技寄り)
let bikeCda  = _lsNum('fujihill.cda', 0.35);   // 空気抵抗 CdA (m^2)
// 物理速度の内部状態 (m/s)。 wsHandlers.state が applyPhysicsStep で積分し rider.setSpeed に渡す。
// 2026-05-17: ?restore 復元経路では autosave データに速度が無いため (= trkpts は t/power/cad/hr
// のみ、 distanceM も速度を持たない) seed できず 0 始動とする。 復元直後の 1 state メッセージ分
// だけ速度が低めに出るが、 1Hz で即積分されるため軽微 (= 数百 ms で復帰)。 autosave に速度を
// 足せば seed 可能になるが現状はデータが無いので 0 のまま。
let physicsSpeedMps = 0;
// 直近 state メッセージの受信時刻 (= dt 算出用、 state push は約 1Hz)。
let lastPhysicsStateT = null;
let lastPositionSendT = 0;
let rideStartedAt = null;
const POSITION_SEND_INTERVAL_MS = 1000;
let scanMode = 'ftms';

let riderMarker = null;
// brief 29: minimap を旧 OSM 直叩き方式に rollback。 brief 28 の MapLibre 2nd instance は撤回。
// minimapTopBase: 上半分 (#minimap-top canvas) の base 画像 (off-screen canvas)、
//   = z=11 周辺 9-16 OSM タイル + course polyline + start/goal dot + 180度回転、 起動時 1 回作成。
// minimapBottomBase: 下半分 (#minimap-bottom canvas) の標高プロファイル base 画像、 1 回作成。
// minimapStats: 上下共有の幾何 (= 上半分は projectLatLon / rotateTop、 下半分は
//   botInnerW / botInnerH / botBaseY / botTopY / PAD / minE / maxE / totalD)。
let minimapTopBase = null;
let minimapBottomBase = null;
let minimapStats = null;
// user が操作した zoom / pitch を覚えておく、 tick の jumpTo はこの値を使う
// 2026-05-15 user 判断 (= 視認確認後の決め値): zoom 21 / pitch 85 を default に.
// pitch 85 はほぼ水平で前方道路が遠くまで見える、 zoom 21 は道路 polygon の
// 道幅が画面 1/4 程度に収まる感覚 (= 走行視点として親密、 遠景も視認可).
let userZoom = 21;
let userPitch = 85;
// brief 35: 旧 spinAngle / currentCadence / currentPower / currentHr は rider 内部に集約.
// 互換のため symbol を残す (= brief 33 grep gate / 既存 source 経路の名前互換). 値は
// wsHandlers.state で rider.setSensors を呼ぶ際の経由口で、 単一 source of truth は rider.
// 各値の生存範囲 = wsHandlers.state ハンドラ内のみ、 tick 経路は rider.cadence/power/hr を読む.
let currentCadence = 0;
let currentPower = 0;
let currentHr = 0;
// brief 33: 1Hz cadence で rideState.appendTrkpt するための前回 push 時刻
let lastTrkptT = 0;
// autosave: 30 秒毎 cadence で IndexedDB に進行状態を保存するための前回 save 時刻
let lastAutosaveT = 0;
let rideStartedIso = null;  // ride 開始時の ISO 文字列 (= autosave に保存する rideStartedAt)

function setupWheelZoom() {
  const mapEl = map.getContainer();
  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    // wheel 1 回 = zoom ±0.5 (= 元の感度 5 倍相当)、 center は触らない (次フレームで rider に戻る)
    const delta = -Math.sign(e.deltaY) * 0.5;
    userZoom = adjustZoom(userZoom, delta);
    map.setZoom(userZoom);
  }, { passive: false });
}

// 2026-05-15 user 指示「マウスの横移動でカメラを横にも旋回できるようにしよう」:
// 横ドラッグ分を userBearingOffset に蓄積し、 tick で進行方向 + offset の bearing を適用。
// 縦ドラッグは既存通り pitch を変える。
let userBearingOffset = 0;

function setupPitchDrag() {
  const mapEl = map.getContainer();
  let drag = null;
  mapEl.addEventListener('mousedown', (e) => {
    drag = { x: e.clientX, y: e.clientY, pitch: map.getPitch(), bearingOffset: userBearingOffset };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    const dx = e.clientX - drag.x;
    // マウスを下にドラッグで水平に近づける、 上にドラッグで真上へ。 感度は user 指示で 5 倍
    // 既存式: newPitch = drag.pitch - dy * 2.0、 adjustPitch(currentPitch, delta) で同じ結果に: delta = -dy * 2.0
    const newPitch = adjustPitch(drag.pitch, -dy * 2.0);
    userPitch = newPitch;
    map.setPitch(newPitch);
    // 横移動で bearing offset を加算 (= 1 pixel = 0.5 度、 360 で正規化).
    // 進行方向に対する相対視線として持つので、 tick で smoothBearing に足し込んで適用.
    userBearingOffset = ((drag.bearingOffset + dx * 0.5) % 360 + 360) % 360;
  });
  window.addEventListener('mouseup', () => { drag = null; });
  // 右クリックメニュー抑止
  mapEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

// brief 26b: state 種は checking / dbinit / pairing / riding の 4 値。
// - checking: 起動直後、 /tiles/_setup_status を fetch 中、 UI は最小
// - dbinit: DB 不足、 #dbinit-overlay で GSI fetch / OSM extract / skip を user に提示
// - pairing: 既存 BLE flow (= state-pairing と同じ挙動)
// - riding: 既存 ride 中
// start/goal の MapLibre Marker への参照 (= ride 中 hide 用、 loadCourse で初期化)
let startGoalMarkers = [];
function updateStartGoalVisibility() {
  const hide = document.body.classList.contains('state-riding');
  for (const m of startGoalMarkers) {
    const el = m.getElement && m.getElement();
    if (el) el.style.display = hide ? 'none' : 'block';
  }
}
function setAppState(s) {
  // 2026-05-15 fix: 旧 `body.className = 'state-X'` は全クラス上書きで、 mode-view (= 観るモード)
  // クラスを副作用で消す bug。 classList で state-* だけ置換、 他クラス (= mode-view 等) は維持。
  const body = document.body;
  for (const cls of Array.from(body.classList)) {
    if (cls.startsWith('state-')) body.classList.remove(cls);
  }
  body.classList.add(`state-${s}`);
  updateStartGoalVisibility();
}
setAppState('checking');

// brief 26b: bridge への HTTP fetch base. WebSocket とは別経路 (= /tiles/* aiohttp app)。
const HTTP_BASE_URL = location.origin;

// brief 31 commit γ: 実装本体は lib/check_setup_status.js に抽出済 (= behavioral test 用)。
// ここでは viewer の HTTP_BASE_URL を bind した thin wrapper のみを残す。
// AbortSignal.timeout(500) は lib default に同梱。
async function checkSetupStatus() {
  return checkSetupStatusLib(HTTP_BASE_URL);
}

let _advancedFromDbinit = false;
async function maybeAdvanceToPairing() {
  if (_advancedFromDbinit) return;
  const s = await checkSetupStatus();
  if (s.overall === 'ready') {
    _advancedFromDbinit = true;
    hideDbinit();
    setAppState('pairing');
    connectBridge();
  }
}

function showDbinit(status) {
  setAppState('dbinit');
  // 初期 bar の状態を setup_status から埋める
  updateDbinitBar('gsi_dem', status && status.sources && status.sources.gsi_dem);
  updateDbinitBar('osm',     status && status.sources && status.sources.osm);
  const ov = document.getElementById('dbinit-overlay');
  if (ov) ov.classList.add('visible');
}
function hideDbinit() {
  const ov = document.getElementById('dbinit-overlay');
  if (ov) ov.classList.remove('visible');
}

function updateDbinitBar(source, info) {
  const bar = document.getElementById(`dbinit-${source === 'gsi_dem' ? 'gsi' : source}-bar`);
  if (!bar) return;
  const present = info && Number.isFinite(info.tiles_present) ? info.tiles_present : 0;
  const expected = info && Number.isFinite(info.tiles_expected) ? info.tiles_expected : 0;
  const fill = bar.querySelector('.fill');
  const label = bar.querySelector('.label');
  const pct = expected > 0 ? Math.min(100, (100 * present) / expected) : 0;
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${present}/${expected}`;
}

function handleDbinitProgress(msg) {
  // bridge から WS で push される { type:'dbinit_progress', source, n, total, phase }
  // brief 30: source='osm_raster' (= minimap) は backend で発火するが UI bar は持たない
  // (= 任意拡張 scope 外)、 done event での maybeAdvanceToPairing は走らせる。
  const source = msg && msg.source;
  if (source !== 'gsi_dem' && source !== 'osm' && source !== 'osm_raster') return;
  const barId = source === 'gsi_dem' ? 'gsi'
              : source === 'osm_raster' ? null
              : source;
  const bar = barId ? document.getElementById(`dbinit-${barId}-bar`) : null;
  if (!bar) {
    // osm_raster は bar 不在で正常 (= silent)、 done のみ追って維持
    if (msg.phase === 'done') maybeAdvanceToPairing();
    return;
  }
  const total = Number(msg.total) || 0;
  const n = Number(msg.n) || 0;
  const fill = bar.querySelector('.fill');
  const label = bar.querySelector('.label');
  const pct = total > 0 ? Math.min(100, (100 * n) / total) : 0;
  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${n}/${total}`;
  if (msg.phase === 'done') {
    maybeAdvanceToPairing();
  }
}

function updateStepIndicator(activeIdx, doneIdx) {
  // brief 34 ε-9: 既存 4 step (scan/connect/handshake/ready) の頭に step-terrain を追加。
  // step-terrain は本関数では触らず、 terrain_loader の subscribe callback で別途更新する
  // (= 引数の activeIdx/doneIdx は scan 以降の index のまま、 caller への破壊変更回避).
  const steps = ['step-scan', 'step-connect', 'step-handshake', 'step-ready'];
  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i <= doneIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

// brief 34 ε-9: 地形データ準備 step の表示更新 (= updateStepIndicator とは別経路).
//   phase pending/loading → active 黄、 done → done 緑、 failed → 赤.
//   既存 4 step は updateStepIndicator が触る、 terrain は単独で本関数が管理。
function updateTerrainStep(phase) {
  const el = document.getElementById('step-terrain');
  if (!el) return;
  el.classList.remove('active', 'done');
  if (phase === 'done') {
    el.classList.add('done');
  } else if (phase === 'failed') {
    // failed 用 class は無いので、 active を付けつつ赤系の inline color を当てる.
    el.classList.add('active');
    el.style.color = '#ff5050';
    el.style.borderColor = '#ff5050';
    el.style.background = '#221408';
  } else {
    el.classList.add('active');
  }
}

// brief 34 ε-9: 地形データ準備のステータステキスト更新 (= #terrain-status).
//   phase で色を変える: pending/loading=黄 / done=緑 / failed=赤.
//   brief 34 ε-10: rangeWarning (= pmtiles Range request 非対応の警告) を末尾に追記、
//   warn は console.warn にも 1 度出す (= 開発時に DevTools で気付くため).
function setTerrainStatusUI(snap) {
  const el = document.getElementById('terrain-status');
  if (!el) return;
  if (snap.phase === 'done') {
    el.textContent = `地形データ準備 完了 — 「走る」「観る」を選べるようになりました (${snap.label})`;
    el.style.color = '#7fff00';
  } else if (snap.phase === 'failed') {
    el.textContent = `地形データ準備 失敗: ${snap.error || ''} ── ページを reload してください`;
    el.style.color = '#ff5050';
  } else {
    // 2026-05-15 fix: load 中の案内文を「何をしてる / なぜ操作できない」明示に強化.
    el.textContent = `地形データを準備しています... コースの起伏を描く地図タイルを読み込み中です。 完了するまで「走る」「観る」ボタンは押せません。  ${snap.label} (${snap.percent}%)`;
    el.style.color = '#ffd54a';
  }
  // brief 34 ε-10: rangeWarning が立ったら status text に追記。 done 後でも user が
  // 「準備完了なのに地図が出ない」を疑える文言を残す (= warn を見える化)。
  if (snap.rangeWarning) {
    el.textContent += ` ${snap.rangeWarning}`;
    if (!setTerrainStatusUI._loggedRangeWarn) {
      console.warn('[fujihill] terrain_loader range probe:', snap.rangeWarning);
      setTerrainStatusUI._loggedRangeWarn = true;
    }
  }
}

// brief b2 High-4: 値が変わらないフレームは textContent 代入を skip し layout
// 無効化の連鎖を減らす。 判定ロジックは frame_diff.createTextWriter に切出し済。
const setText = createTextWriter((id) => document.getElementById(id));

// === WebSocket === (既存 viewer.js と同じ contract)
const WS_URL = 'ws://localhost:8765';
// brief 22: ?test=1 で trainer / bridge 不在の画面操作確認モード.
// WebSocket 接続を skip、 fake state を 1Hz で push、 ride/scan は即座に fake 応答.
// 起動例: python -m http.server -d web/ 8000 -> http://localhost:8000/?test=1
const TEST_MODE = new URLSearchParams(location.search).has('test');
// 2026-05-16: ?debug=1 で右上に debug HUD を表示 (= 座標 drift / camera 差分 / frame timing).
// 走行中 user が「camera が rider 中心からズレる」「慣性力おかしい」 を数値で目視できる.
// brief b2 High-4: debug HUD の有無を 1 回だけ確定。 tick() の debug 系
// setText 30 件超は DEBUG_HUD が true の時だけ実行する (= 平時は丸ごと skip)。
const DEBUG_HUD = new URLSearchParams(location.search).has('debug');
if (DEBUG_HUD) {
  document.body.classList.add('debug-on');
}
// 2026-05-16: service worker 登録 (= 2 回目以降 fetch ゼロでオフライン起動可、
// user 「毎回タイルを並べる手間」 への対応). ?nosw=1 で skip (= dev 用).
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[fujihill] service worker register failed:', err);
    });
  });
}
// ?map=1 で UI 操作なしの「地図表示だけ」モード. TEST_MODE と同じく client は
// createTestModeClient、 加えて pairing overlay を即 hide + ride を自動 start.
// 用途: AI / 自動 capture で OSM/dem/polygon の visual 検証だけしたい時.
const MAP_MODE = new URLSearchParams(location.search).has('map');
// brief 32: ?ble=1 で Web Bluetooth 経由の直接 FTMS / HRM 接続モード.
// bridge.py 無し、 viewer から Web BT API (= ble_client.js 内に閉じる) で
// trainer / 心拍計と話す. iOS Safari / Firefox は非対応で fallback UI を出す.
const BLE_MODE = new URLSearchParams(location.search).has('ble');
// 2026-05-15 fix: default は Web Bluetooth、 ?bridge=1 のときだけ旧 bridge mode (= python BLE 経由)
// に倒す。 公開時の訪問者は browser 完結、 yuuji 自宅の bridge.py 実テストは URL 引数で明示。
const BRIDGE_MODE = new URLSearchParams(location.search).has('bridge');
let client = null;
let lastSlopeSent = null;
let lastSlopeSendT = 0;
const SLOPE_SEND_INTERVAL_MS = 1000;

const wsHandlers = {
  state(msg) {
    // brief 35: speed / sensor 値はすべて rider 経由で 1 経路に集約.
    // 旧 viewer は playSpeed / currentCadence / currentPower / currentHr の 4 つを module global
    // に直書きしていた。 fake state push (1Hz) と section click (即時) が同じ場所を奪い合うため、
    // 観るモードで「click → 動かない」 体感 bug の元凶になっていた. 新 path では rider.setSpeed /
    // rider.setSensors が唯一の入口、 fake state も BLE も section click も同じ API を叩く.
    // 2026-05-17: rider の速度は trainer の speed_mps を直接使わず、 viewer 側で物理積分する。
    // trainer の speed は「平地 + power のみ」 の機種が多く、 下り勾配の重力加速や慣性が入らない
    // ため「足を止めて即減速」 の不自然挙動になっていた。 新経路は web/lib/bike_physics.js の
    // applyPhysicsStep で power とコース勾配から速度を時間積分する (= inertia-sim.html と同じ計算)。
    if (rider) {
      const now = performance.now();
      // dt = 前回 state メッセージからの経過秒。 state push は約 1Hz。 初回は 1 秒とみなす。
      let dt = (lastPhysicsStateT != null) ? (now - lastPhysicsStateT) / 1000 : 1.0;
      lastPhysicsStateT = now;
      if (dt < 0.1) dt = 0.1;
      if (dt > 2.0) dt = 2.0;
      const power = (typeof msg.power_w === 'number' && Number.isFinite(msg.power_w)) ? msg.power_w : 0;
      // 2026-05-17 (Critical fix): コース勾配は rider の現在位置から都度引く。
      // 旧経路は tick() で更新する module global を読んでいたが、
      // state push (約 1Hz) が初回 tick より先に来ると slope=0 で積分してしまい、
      // 富士ヒルの登坂で登り抵抗が抜けて速度が過大になる。 rider.snapshot().position は
      // Terrain query 経由でいつでも現在位置のコース勾配を返すので、 そこを直接 source にする。
      const riderPos = rider.snapshot().position;
      const slopePct = (riderPos && Number.isFinite(riderPos.slope_pct)) ? riderPos.slope_pct : 0;
      // 物理は固定 1/120s でサブステップ (= 大きい dt でも安定、 inertia-sim.html と同方式)。
      // 空気抵抗は CdA を 1 本にまとめるため c_d=CdA / area=1 で渡す。
      const SUB = 1 / 120;
      let remain = dt;
      while (remain > 0) {
        const h = Math.min(SUB, remain);
        physicsSpeedMps = applyPhysicsStep(physicsSpeedMps, h, power, slopePct,
          { mass: bikeMass, c_rr: bikeCrr, c_d: bikeCda, area: 1, inertia: inertiaKg });
        remain -= h;
      }
      if (Number.isFinite(physicsSpeedMps) && physicsSpeedMps >= 0) {
        rider.setSpeed(physicsSpeedMps);
      }
    }
    const pw = (msg.power_w != null) ? String(msg.power_w) : '--';
    const cd = (msg.cadence_rpm != null) ? msg.cadence_rpm.toFixed(0) : '--';
    if (typeof msg.cadence_rpm === 'number') currentCadence = msg.cadence_rpm;
    if (typeof msg.power_w === 'number') currentPower = msg.power_w;
    if (typeof msg.hr_bpm === 'number') currentHr = msg.hr_bpm;
    if (rider) rider.setSensors({ power: currentPower, cad: currentCadence, hr: currentHr });
    const sp = (msg.speed_mps != null && msg.speed_mps >= 0) ? (msg.speed_mps * 3.6).toFixed(1) : '--';
    setText('power', pw); setText('cadence', cd);
    // rider 追随 HUD (= 豆腐の下) にも同値を反映、 大きめ text で表示.
    setText('r-power', pw); setText('r-cadence', cd); setText('r-hr', (msg.hr_bpm != null) ? String(msg.hr_bpm) : '--');
    setText('r-speed', (msg.speed_mps != null && msg.speed_mps >= 0) ? `${(msg.speed_mps * 3.6).toFixed(1)} km/h` : '--');
    setText('p-power', pw); setText('p-cadence', cd); setText('p-speed', sp);
    if (msg.slope_sent_pct != null) setText('slope-sent', msg.slope_sent_pct.toFixed(1));
    if (msg.last_ack) {
      const ok = msg.last_ack.includes('OK');
      const text = `${ok ? '✓' : '✗'} ${msg.last_ack}`;
      const color = ok ? '#7fff00' : '#ff5050';
      const ackEl = document.getElementById('ack'); if (ackEl) { ackEl.textContent = text; ackEl.style.color = color; }
      const pAck = document.getElementById('p-ack'); if (pAck) { pAck.textContent = text; pAck.style.color = color; }
    }
    const hr = (msg.hr_bpm != null) ? String(msg.hr_bpm) : '--';
    setText('hr', hr); setText('p-hr', hr);
  },
  scan_status(msg) {
    if (msg.state === 'scanning') { setText('setup-status', 'BLE スキャン中... (7 秒)'); updateStepIndicator(0, -1); }
    else if (msg.state === 'failed') setText('setup-status', `スキャン失敗: ${msg.message || ''}`);
    else if (msg.state === 'busy') setText('setup-status', '前のスキャンがまだ動いてます');
  },
  scan_result(msg) {
    const devices = msg.devices || [];
    if (scanMode === 'ftms') {
      const ftms = devices.find(d => d.is_ftms);
      if (ftms && client && client.isOpen()) {
        setText('setup-status', `${ftms.name || ftms.address} を検出、 接続中...`);
        setText('p-device', ftms.name || ftms.address);
        client.sendConnect(ftms.address);
        return;
      }
    }
    showSetupResults(devices);
  },
  connect_status(msg) {
    const err = document.getElementById('setup-error'); if (err) err.textContent = '';
    if (msg.state === 'connecting') { setText('setup-status', `BLE 接続中: ${msg.address}`); setText('p-state', 'BLE 接続中'); setText('p-device', msg.address); updateStepIndicator(1, 0); }
    else if (msg.state === 'handshaking') { setText('setup-status', `ハンドシェイク中: ${msg.address}`); setText('p-state', 'ハンドシェイク中'); updateStepIndicator(2, 1); }
    else if (msg.state === 'connected') {
      setText('setup-status', `走行準備完了: ${msg.address}`);
      setText('p-state', '✓ 準備完了');
      updateStepIndicator(-1, 3);
      try { localStorage.setItem('fujihill.trainer.address', msg.address); } catch {}
      // brief 34 ε-9: pair 完了 flag を立て、 terrain gate の状態に応じて btnRideStart 制御.
      _pairConnected = true;
      const startBtn = document.getElementById('btnRideStart');
      // terrainReady === true なら enable + focus、 false なら disabled のまま (terrain が遅延中).
      if (startBtn) {
        if (terrainReady) {
          startBtn.disabled = false;
          requestAnimationFrame(() => startBtn.focus());
        } else {
          startBtn.disabled = true;  // terrain 完了で updateActionButtonsForTerrain が enable する
        }
      }
      lastSlopeSent = null; lastSlopeSendT = 0;
    }
  },
  disconnected(msg) { status(`trainer 切断 (${msg.reason || ''})`); },
  hrm_status(msg) {
    if (msg.state === 'connecting') setText('setup-status', `心拍計に接続中: ${msg.address}`);
    else if (msg.state === 'connected') setText('setup-status', `心拍計 接続済: ${msg.address}`);
    else if (msg.state === 'failed') setText('setup-status', `心拍計 接続失敗`);
    else if (msg.state === 'disconnected') setText('setup-status', `心拍計 切断`);
  },
  // brief 26b: dbinit progress (= POST /tiles/_fetch_gsi 等の 1Hz push)
  dbinit_progress(msg) { handleDbinitProgress(msg); },
  ride_status(msg) {
    if (msg.state === 'started') {
      if (rideState) rideState.start();
      rideStartedAt = performance.now();
      hidePairing();
      const endBtn = document.getElementById('btnRideEnd'); if (endBtn) endBtn.disabled = false;
    } else if (msg.state === 'ended') {
      if (rideState) rideState.end();
      rideStartedAt = null;
      rideStartedIso = null;
      // ride 終了で autosave を消す (= 復元 dialog の対象から外す).
      clearAutosave().catch((err) => console.warn('clearAutosave failed:', err));
      const endBtn = document.getElementById('btnRideEnd'); if (endBtn) endBtn.disabled = true;
      showPostride(msg.gpx_path || '', msg.points || 0);
    } else if (msg.state === 'export-failed') { status(`GPX 書き出し失敗: ${msg.message || ''}`); }
  },
};

function showPairing() {
  document.getElementById('setup-overlay').classList.add('visible');
  const back = document.getElementById('btnClosePairing');
  if (back) back.hidden = !(document.body.classList.contains('state-riding'));
}
function hidePairing() {
  document.getElementById('setup-overlay').classList.remove('visible');
  setAppState('riding');
}
function showPostride(gpxPath, points) {
  const ov = document.getElementById('postride-overlay');
  setText('post-gpx-path', gpxPath); setText('post-points', String(points)); setText('copy-status', '');
  // save_summary: 実際に保存される値の summary を冒頭に描画。 異常検出時は confirm を出す.
  try {
    const trkpts = rideState ? rideState.getTrkpts() : [];
    const snap = rideState ? rideState.snapshot() : { distance: 0 };
    const summary = buildSaveSummary({
      trkpts,
      course,
      rideStartedAt,
      distanceM: snap.distance,
      courseName: 'fujihill',
    });
    renderSaveSummary({
      summary,
      onAccept: () => {
        const el = document.getElementById('save-summary-anomaly');
        if (el) el.textContent = '✓ 異常を許容して保存可';
      },
      onAbort: () => {
        const el = document.getElementById('save-summary-anomaly');
        if (el) el.textContent = '✗ 保存を中止しました (button は無効)';
        for (const id of ['btnGpxDownload', 'btnSaveHistory', 'btnStravaUpload']) {
          const b = document.getElementById(id);
          if (b) b.disabled = true;
        }
      },
    });
  } catch (err) {
    console.warn('save summary render failed:', err);
  }
  ov.classList.add('visible');
  requestAnimationFrame(() => { const b = document.getElementById('btnBackToPairing'); if (b) b.focus(); });
}
function hidePostride() { document.getElementById('postride-overlay').classList.remove('visible'); }
function showConfirm() { document.getElementById('confirm-overlay').classList.add('visible'); }
function hideConfirm() { document.getElementById('confirm-overlay').classList.remove('visible'); }

function showSetupResults(devices) {
  const list = document.getElementById('setup-list'); if (!list) return;
  list.replaceChildren();
  const isHrmMode = scanMode === 'hrm';
  const filtered = isHrmMode ? devices.filter(d => d.is_hrm) : devices;
  if (filtered.length === 0) { setText('setup-status', isHrmMode ? '心拍計が見つかりません' : '機器が見つかりません'); return; }
  setText('setup-status', isHrmMode ? `${filtered.length} 個の心拍計候補` : `${filtered.length} 個検出`);
  for (const d of filtered) {
    const li = document.createElement('li');
    li.tabIndex = 0; li.setAttribute('role', 'option');
    if (d.is_ftms) li.classList.add('ftms');
    const n = document.createElement('span'); n.className = 'dev-name'; n.textContent = d.name || '<no-name>';
    const m = document.createElement('span'); m.className = 'dev-meta';
    const parts = []; if (d.is_ftms) parts.push('FTMS'); if (d.is_hrm) parts.push('HR'); if (d.rssi != null) parts.push(`rssi ${d.rssi}`); parts.push(d.address);
    m.textContent = parts.join(' · ');
    li.appendChild(n); li.appendChild(m);
    const pick = () => {
      if (!client || !client.isOpen()) return;
      if (isHrmMode) client.sendHrmConnect(d.address);
      else client.sendConnect(d.address);
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    list.appendChild(li);
  }
}

function copyToClipboard(text, statusEl) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => { if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; } })
    .catch((err) => { if (statusEl) { statusEl.style.color = '#ff5050'; statusEl.textContent = `失敗 (${err.message || err})`; } });
    return;
  }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; } }
  catch { if (statusEl) statusEl.textContent = '失敗'; }
}

function connectBridge() {
  try {
    client = createBridgeClient(WS_URL, wsHandlers, {
      onOpen: () => {
        status('bridge 接続済');
        updateStepIndicator(0, -1);
        const remembered = (() => { try { return localStorage.getItem('fujihill.trainer.address'); } catch { return null; } })();
        if (remembered) {
          setText('setup-status', `前回の機器に再接続中: ${remembered}`);
          setText('p-device', remembered);
          client.sendConnect(remembered);
        } else {
          client.sendScan();
        }
      },
      onClose: () => {
        status('bridge 切断');
        if (rideState) rideState.end();
      },
      onError: () => { /* silent (default) */ },
    });
  } catch (err) {
    status(`bridge 接続失敗: ${err && err.message ? err.message : err}`);
  }
}

// brief 32: ?ble=1 で Web Bluetooth 経由の直接接続モード.
// bridge.py 無し、 Web BT API (ble_client.js 内に閉じる) で trainer / 心拍計と話す.
// scan / connect は user gesture (button click) からのみ呼べる Web Bluetooth 仕様、
// setup-overlay 内に専用 button group (#ble-section) を unhide して click 起点で発火.
async function initBleMode() {
  // map は既存 default mode と同じ. bridge への HTTP 不在で static tile に倒す.
  if (!map) { ensureMapBooted().then(() => initBleMode()); return; }
  setAppState('pairing');
  // brief 34 ε-1 で setup-overlay の default class="visible" を撤去したため、
  // intro 通過後の遷移先 (= initBleMode / bootCheckSetupStatus 経由 connectBridge) で
  // 明示的に visible 付与する必要がある。 (= 起動直後 setup-overlay が前面に出る旧挙動の回避)
  document.getElementById('setup-overlay')?.classList.add('visible');
  setText('setup-status', 'BLE モード: お使いの trainer / 心拍計を直接選んでください');
  setText('p-device', '(未接続)');
  setText('p-state', 'BLE 待機中');
  // 既存 setup-overlay の scan list (= bridge mode 専用) は section ごと隠し、 #ble-section を unhide.
  // 2026-05-15 fix: 個別の #setup-buttons だけ hide すると h3「機器選択」+ #setup-list が残る、
  // 親 #bridge-scan-section で 1 個 hide に統一して bridge UI 完全消去 + BLE UI のみ表示。
  const bleSection = document.getElementById('ble-section');
  const bridgeSection = document.getElementById('bridge-scan-section');
  if (bleSection) bleSection.hidden = false;
  if (bridgeSection) bridgeSection.hidden = true;

  const supported = isWebBluetoothSupported();
  const supportMsg = document.querySelector('#ble-section .ble-support-msg');
  const btnTrainer = document.getElementById('btn-ble-trainer');
  const btnHrm = document.getElementById('btn-ble-hrm');
  if (!supported) {
    if (supportMsg) supportMsg.hidden = false;
    if (btnTrainer) btnTrainer.disabled = true;
    if (btnHrm) btnHrm.disabled = true;
    setText('setup-status', 'このブラウザは BLE 非対応 (= iOS Safari / Firefox)、 Chrome / Edge / Android Chrome をご利用ください');
    // client は test mode fake で立てて map は動くようにする (= 視覚 fallback).
    client = createTestModeClient(wsHandlers, { fakeStateInterval: 1000 });
    return;
  }
  client = createBleClient(wsHandlers);
  // brief 34 ε-9: BLE 直接接続 button にも terrain gate (= 地形未完なら何もしない).
  if (btnTrainer) btnTrainer.addEventListener('click', () => { if (!terrainReady) return; client && client.sendConnect(); });
  if (btnHrm) btnHrm.addEventListener('click', () => { if (!terrainReady) return; client && client.sendHrmConnect(); });
  // 2026-05-15 user 指示「毎回接続 button 押すのめんどくさい、 登録済 trainer は起動直後に
  // ハンドシェイクできないか」。 Web Bluetooth の getDevices 経路で過去 grant 済 device を
  // 取得して silent 接続を試みる (= 実装は ble_client.js 側に閉じる). 失敗時は何もしない
  // (= 既存 button 経路に fallback).
  if (typeof client.tryAutoReconnect === 'function') {
    client.tryAutoReconnect().catch(() => { /* silent fallback */ });
  }
}

// brief 22: trainer / bridge 不要の画面操作確認モード.
// brief 19b: createTestModeClient に置換、 fake send / state push は lib 側に集約.
// brief 31 commit β: bootEnv() で ENV を 1 回確定してから bootMap(env) を呼ぶ。
// ENV は idempotent (= bootEnv 内で freeze 済、 再呼出しても同一 instance)。
// 旧 `bootMap(s.bridgeReachable)` を `bootMap(env)` に rewire し、 引数の単一化で
// race door (= bridgeReachable bool が複数経路から渡される可能性) を構造的に消す。
async function ensureMapBooted() {
  if (map) return;
  const env = await bootEnv();
  bootMap(env);
}

function initTestMode() {
  // brief 31: bootMap が未呼出なら map を先に立ち上げる (= ?test=1 経路、 module top dispatch)。
  // 既存 bootCheckSetupStatus 経路から呼ばれた場合 map は既生成、 ensureMapBooted は no-op。
  if (!map) { ensureMapBooted().then(() => initTestMode()); return; }
  status('TEST MODE: bridge/trainer 不要、 fake state 1Hz でループ');
  setText('setup-status', 'TEST MODE: 接続スキップ、 ride 開始ボタンが押せる');
  setText('p-device', 'TEST MODE (no trainer)');
  setText('p-state', '✓ TEST MODE');
  updateStepIndicator(-1, 3);
  const startBtn = document.getElementById('btnRideStart');
  if (startBtn) startBtn.disabled = false;
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: () => {
      const snap = rideState ? rideState.snapshot() : { active: false, paused: true, distance: 0 };
      const moving = snap.active && !snap.paused;
      const movingSpeed = moving ? (20 / 3.6) : 0;
      return {
        speed_mps: movingSpeed,
        power_w: moving ? 150 : 0,
        cadence_rpm: moving ? 80 : 0,
        distance_m: snap.distance,
        slope_sent_pct: 0,
        hr_bpm: 120,
        last_ack: 'OK (TEST MODE)',
      };
    },
  });
  // 2026-05-16 fix: user 報告 「F5 すると HUD もなにもない画面で詰む」.
  // ?test=1 は元々「自動 ride start」 設計だったが、 担当 C の preflight 統合で
  // state 遷移経路 (= setAppState('riding')) が切断され body.state-checking のまま
  // 残って HUD / controls / minimap 全部 hide。 client 起動後に startRideConfirmed を
  // 呼んで state-riding に遷移、 走行画面を表示する。 setTimeout は terrainReady と
  // map idle の完了を待つ (= 5 秒 fallback と整合).
  setTimeout(() => {
    try {
      if (typeof startRideConfirmed === 'function') startRideConfirmed();
    } catch (e) {
      console.warn('[fujihill] initTestMode auto-start failed:', e);
    }
  }, 500);
}

function maybeSendSlope(slope_pct) {
  if (!client || !client.isOpen()) return;
  const now = performance.now();
  if (now - lastSlopeSendT < SLOPE_SEND_INTERVAL_MS) return;
  const scaled = slope_pct * diffMult;
  if (lastSlopeSent !== null && Math.abs(scaled - lastSlopeSent) < 0.1) return;
  client.sendSetSlope(scaled);
  lastSlopeSent = scaled; lastSlopeSendT = now;
}

// brief 34 ε-6: attribution control の display 監視.
// MapLibre の標準 attribution (= 国土地理院 / OSM / MapLibre 出典) が DevTools 経由で
// `display:none` を inject されると ODbL / 国土地理院 規約違反、 ただし harm 主体は inject
// した訪問者本人 (= 第三者には影響しない、 LOAD-BEARING 上限) なので block ではなく
// warning banner を出すだけ。 起動 1 回限定。
function verifyAttributionVisible() {
  try {
    const attribEl = document.querySelector('.maplibregl-ctrl-attrib');
    if (!attribEl) {
      // attribution control が DOM に居ない (= disable された) → これも違反
      showAttributionWarning('attribution control が DOM に存在しません');
      return;
    }
    const cs = getComputedStyle(attribEl);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
      showAttributionWarning(`attribution が表示されていません (display=${cs.display}, visibility=${cs.visibility}, opacity=${cs.opacity})`);
    }
  } catch (err) {
    // querySelector / getComputedStyle が失敗するのは jsdom 等の test 環境、 silent。
  }
}
function showAttributionWarning(detail) {
  console.warn('[fujihill] 帰属表示が表示されていません:', detail);
  // warning banner を画面上端に表示 (= 既存 #status を借りる、 別 DOM 追加せず軽量).
  const st = document.getElementById('status');
  if (st) {
    st.style.color = '#ff8866';
    st.textContent = '[警告] 帰属表示 (国土地理院 / OSM / MapLibre) が消えています';
  }
}

// brief 34 ε-2 (= 2026-05-15 user 方向修正反映): 公開ガードレール intro-overlay 表示 / ボタン bind.
// 「閉じる」= 何もしない (= overlay は閉じるが consent は保存しない、 reload 時に再表示)。
// 「自分の trainer で走る」= setIntroConsent({mode:'ride'}) 保存 + overlay 隠す + dispatchAfterIntro。
//   default 経路 (= 無 URL 引数) では bootCheckSetupStatus 経由で initBleMode に向かう
//   (= Web Bluetooth で trainer 直接接続、 brief 32 で landed 済の経路を流用)。
// brief 34 ε-8: 「コースを観る」= setIntroConsent({mode:'view'}) 保存 + initViewMode に向かう
//   (= trainer 不要、 区間選択で fake state ride、 走行ログ保存なし)。
//   ?map=1 / ?test=1 / ?ble=1 等の URL 引数経由は開発者本人の動作確認用 path、
//   一般訪問者は intro 通過後の default 経路 (= ride or view) のみに到達する。
function showIntroOverlay() {
  const ov = document.getElementById('intro-overlay');
  if (ov) ov.classList.add('visible');
}
function hideIntroOverlay() {
  const ov = document.getElementById('intro-overlay');
  if (ov) ov.classList.remove('visible');
}
// brief 34 ε-3: 公開ガードレール consent-overlay 表示 / ボタン bind.
// 「同意して ride 開始」= setRideConsent({history, strava, asked: true}) を保存 +
//                       overlay を hide + ride 開始 (= btnRideStart 相当の処理を再実行)。
// 「キャンセル」= 何も保存しない、 overlay のみ hide (= ride 開始しない)。
//
// 2026-05-15 fix: 「ライド開始押してもライド画面に遷移しない」 bug 修正。
// consent-overlay (z=1460) は setup-overlay (z=1500) より下に置く設計だが、
// setup-overlay が visible のまま consent-overlay を表示すると後者は完全に setup の
// 背後に隠れて user に見えない (= 旧 ε-1 で同型 bug、 intro vs setup の上下逆転を visible class で
// 解決した経緯と同じ)。 showConsentOverlay 時に setup-overlay を一旦隠し、 cancel 時に
// 復元する。 accept 時は ride_status:started → hidePairing で setup を二重 hide するが冪等。
function showConsentOverlay() {
  const ov = document.getElementById('consent-overlay');
  if (ov) ov.classList.add('visible');
  // setup-overlay (z=1500) を一旦 hide して consent-overlay (z=1460) を露出させる.
  const setup = document.getElementById('setup-overlay');
  if (setup) setup.classList.remove('visible');
}
function hideConsentOverlay() {
  const ov = document.getElementById('consent-overlay');
  if (ov) ov.classList.remove('visible');
  // cancel 経路で setup に戻れるよう setup-overlay を復元.
  // accept → startRideConfirmed → ride_status:started → hidePairing が後段で setup を
  // 再度 hide するため、 accept 経路でも一瞬 setup が見えてから ride 画面に遷移する.
  // ride state (= state-riding 系) でない時のみ復元 (= 既に ride 中なら setup を出さない).
  if (!document.body.classList.contains('state-riding')) {
    const setup = document.getElementById('setup-overlay');
    if (setup) setup.classList.add('visible');
  }
}
// brief 34 ε-8: 「観る」モード section-overlay 表示 / hide / list render.
// section-overlay は 10 区間のリストを表示、 行クリックで該当 section.start_idx を rideState に
// inject して fake state ride を開始する。 ride 中の「区間リストに戻る」ボタンで再表示する。
function showSectionOverlay() {
  const ov = document.getElementById('section-overlay');
  if (ov) ov.classList.add('visible');
}
function hideSectionOverlay() {
  const ov = document.getElementById('section-overlay');
  if (ov) ov.classList.remove('visible');
}
// section リストの DOM を course から再構築 (= 「コースを観る」初回 + 「区間リストに戻る」で呼ぶ).
// 各 li に role=button + data-start-idx + tabindex を付け、 click で onSelect を発火させる.
function renderSectionList(courseArr, onSelect) {
  const list = document.getElementById('section-list');
  if (!list) return;
  list.replaceChildren();
  const sections = splitCourseIntoSections(courseArr, 10);
  for (const sec of sections) {
    const li = document.createElement('li');
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('data-start-idx', String(sec.start_idx));
    li.setAttribute('data-section-index', String(sec.index));
    // 2026-05-15 fix: 行を 3 要素に分解 (= 区間/距離 / 勾配大 / 標高副).
    // 旧 formatSectionLabel は 1 文字列で詰めてたので「区間 N: km、 平均勾配 %」が水平に
       // ごちゃっとして読めなかった。 grid layout + 勾配 right-align で整理。
    const startKm = (sec.start_dist / 1000).toFixed(1);
    const endKm = (sec.end_dist / 1000).toFixed(1);
    const label = document.createElement('span');
    label.className = 'sec-label';
    label.textContent = `区間 ${sec.index + 1}: ${startKm}-${endKm} km`;
    // 2026-05-15 fix: 区間勾配は「平均」と「最大」を 2 行で表示 (= max は登坂時の体感差を伝える).
    // sec-grade を flex-column 化、 中身を 2 span に分け右寄せで縦並べる。
    const grade = document.createElement('span');
    grade.className = 'sec-grade';
    const gradeAvg = document.createElement('span');
    gradeAvg.className = 'sec-grade-avg';
    gradeAvg.textContent = `平均 ${sec.avg_slope_pct.toFixed(1)}%`;
    const gradeMax = document.createElement('span');
    gradeMax.className = 'sec-grade-max';
    gradeMax.textContent = `最大 ${sec.max_slope_pct.toFixed(1)}%`;
    grade.appendChild(gradeAvg);
    grade.appendChild(gradeMax);
    const delta = sec.end_ele - sec.start_ele;
    const deltaSign = delta >= 0 ? '+' : '';
    const meta = document.createElement('span');
    meta.className = 'sec-meta';
    meta.textContent = `${(sec.start_ele).toFixed(0)}m → ${(sec.end_ele).toFixed(0)}m (${deltaSign}${delta.toFixed(0)}m)`;
    li.appendChild(label);
    li.appendChild(grade);
    li.appendChild(meta);
    // brief 34 ε-9: terrainReady === false の間は section 行クリックを block.
    // 視覚 disable は updateActionButtonsForTerrain が pointer-events:none で行うが、
    // keyboard activation や programmatic click を物理 short-circuit するためここでも check.
    li.addEventListener('click', () => { if (!terrainReady) return; onSelect(sec); });
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (!terrainReady) return;
        onSelect(sec);
      }
    });
    list.appendChild(li);
  }
}

// 起動時に 1 回 bind (= multiple click でも 1 度しか発火しない、 addEventListener 性質).
// document が無い test 環境 (= 直 import) では skip。
if (typeof document !== 'undefined') {
  // brief 34 ε-1 (= 2026-05-15 user 方向修正反映): btnIntroStart = 「自分の trainer で走る」.
  // デモ走行ボタンは撤去、 trainer 無し試触者は default 想定外。
  // brief 34 ε-8: btnIntroView = 「コースを観る」 (= trainer 不要、 区間勾配を眺める).
  const btnIntroStart = document.getElementById('btnIntroStart');
  const btnIntroView = document.getElementById('btnIntroView');
  const btnIntroClose = document.getElementById('btnIntroClose');
  if (btnIntroStart) btnIntroStart.addEventListener('click', () => {
    // brief 34 ε-9: 地形 load 未完なら何もしない (= disabled 属性の二重 gate、 keyboard activation 経由でも block).
    if (!terrainReady) return;
    // brief 34 ε-8: 'ride' mode を明示保存 (= default だが view 切替時に区別するため).
    setIntroConsent({ mode: 'ride' });
    hideIntroOverlay();
    dispatchAfterIntro();
  });
  if (btnIntroView) btnIntroView.addEventListener('click', () => {
    // brief 34 ε-9: 地形 load 未完なら何もしない.
    if (!terrainReady) return;
    // brief 34 ε-8: 'view' mode で consent 保存 → dispatchAfterIntro で initViewMode に分岐.
    setIntroConsent({ mode: 'view' });
    hideIntroOverlay();
    dispatchAfterIntro();
  });
  // 2026-05-15 fix: setup-overlay からも「コースを観る」に切替できるボタン (= user 指摘
  // 「コースを観るボタンが消えた」反映、 intro skip 後でも走る ↔ 観る を切替可能).
  const btnSetupGoView = document.getElementById('btnSetupGoView');
  if (btnSetupGoView) btnSetupGoView.addEventListener('click', () => {
    if (!isActionableNow()) return;
    setIntroConsent({ mode: 'view' });
    document.getElementById('setup-overlay')?.classList.remove('visible');
    initViewMode();
  });
  if (btnIntroClose) btnIntroClose.addEventListener('click', () => {
    // 「閉じる」は consent を保存しない (= reload 時に再表示).
    // ride / map fetch は走らせない (= 帯域消費ゼロ).
    hideIntroOverlay();
  });

  // brief 34 ε-8: section-overlay の bind (= 「閉じる (= intro に戻る)」 button).
  // 行クリックは renderSectionList 内で onSelect callback として inject (= initViewMode 経路).
  const btnSectionClose = document.getElementById('btnSectionClose');
  if (btnSectionClose) btnSectionClose.addEventListener('click', () => {
    hideSectionOverlay();
    // intro overlay に戻る (= mode 選び直し)、 view mode の consent は残すが intro は再表示.
    showIntroOverlay();
  });
  // 「区間リストに戻る」 button (= ride 中 view mode 専用) の bind.
  // ride を end して section-overlay を再表示、 別区間選び直しの導線。
  const btnViewModeBackToList = document.getElementById('btnViewModeBackToList');
  if (btnViewModeBackToList) btnViewModeBackToList.addEventListener('click', () => {
    if (rideState) rideState.end();
    setAppState('pairing');  // ride 状態を抜ける (= state-riding を外す)
    document.body.classList.add('mode-view');  // mode-view class は維持
    showSectionOverlay();
  });

  // brief 34 ε-3: consent-overlay の bind. accept で flag を保存 + ride 再発火、
  // cancel で何もしない (= ride 開始されないまま overlay 閉じる).
  const btnConsentAccept = document.getElementById('btnConsentAccept');
  const btnConsentCancel = document.getElementById('btnConsentCancel');
  if (btnConsentAccept) btnConsentAccept.addEventListener('click', () => {
    const chkHist = document.getElementById('chkConsentHistory');
    const chkStrava = document.getElementById('chkConsentStrava');
    setRideConsent({
      history: !!(chkHist && chkHist.checked),
      strava: !!(chkStrava && chkStrava.checked),
      asked: true,
    });
    hideConsentOverlay();
    // postride button の visibility を consent flag に追随 (= 視覚的にも feedback).
    // updatePostrideButtonVisibility は module 後段で定義、 typeof check で safe call.
    if (typeof updatePostrideButtonVisibility === 'function') {
      updatePostrideButtonVisibility();
    }
    // ride 開始処理を再発火 (= btnRideStart の click が直前に return した処理を再実行)
    startRideConfirmed();
  });
  if (btnConsentCancel) btnConsentCancel.addEventListener('click', () => {
    hideConsentOverlay();
    // 何も保存しない、 ride 開始もしない (= setup 画面に戻る).
  });
}

// brief 26b: 起動時の DB 充足度チェック → 不足なら dbinit overlay、 ready なら従来 BLE.
// TEST_MODE は従来通り checking を skip (= ?test=1 は trainer / DB 不要 demo).
//
// brief 31: bridge 不在 (= s.bridgeReachable === false) なら static mode 確定、
// dbinit-overlay は出さず initMapMode() に直行 (= 視覚デモ完結)。
//
// brief 34 ε-2: 公開ガードレール introConsented guard.
// intro 未通過 (= getIntroConsent() === null) なら static / bridge 経路どちらも
// 走らせない (= 訪問者が「閉じる」を選んだ時に pmtiles / GSI PNG fetch を完全停止)。
// 開発者 bypass (= ?consent=dev) は module top の CONSENT_DEV_BYPASS で吸収済、
// この関数は dispatchAfterIntro 経由でのみ呼ばれるため、 ここでの guard は冗長 defense。
//
// brief 34 ε-2 (= 2026-05-15 user 方向修正反映): static mode (= GitHub Pages 公開サイト) では
// 旧 initMapMode (= 自動 ride デモ) ではなく initBleMode に向かう。 一般訪問者は trainer
// 持参の前提、 Web Bluetooth で自分の trainer を直接 pair する設計。
function bootCheckSetupStatus() {
  // brief 34 ε-2: intro 未通過なら何もしない (= 二重 gate、 dispatchAfterIntro 経由で
  // 通常呼ばれないが、 外部から直呼びされても fetch を発生させない物理 gate).
  if (!introConsented()) {
    showIntroOverlay();
    return;
  }
  // brief 31 commit β: bootEnv() で ENV (= freeze 済 immutable env) を確定してから分岐。
  // 旧 `bootMap(false)` / `bootMap(true)` の bool 直渡しを廃止、 全部 env 経由で統一。
  bootEnv().then((env) => {
    if (env.mode === 'static') {
      // brief 34 ε-2 (= 2026-05-15 user 方向修正): GitHub Pages 等の static mode では
      // 旧 initMapMode (= 自動 ride デモ) を撤回、 訪問者は自分の trainer 持参前提なので
      // Web Bluetooth で trainer 直接接続する initBleMode に向かう。
      // dbinit-overlay は bridge mode 専用 (= 「bridge 立ち上げて」と促す UI)、
      // static mode では bridge.py 起動を促しても無意味なため一切表示しない。
      bootMap(env);
      initBleMode();
      return;
    }
    bootMap(env);
    const s = env.setupStatus;
    if (s.overall === 'ready') {
      setAppState('pairing');
      // brief 34 ε-1 で setup-overlay の default class="visible" を撤去したので
      // bridge mode 経路でも明示的に visible 付与する。
      document.getElementById('setup-overlay')?.classList.add('visible');
      connectBridge();
    } else {
      // overall === 'empty' / 'partial': bridge は到達したが DB 不足、 dbinit overlay
      showDbinit(s);
      // bridge への WS は dbinit 中も繋ぐ (= dbinit_progress を受け取るため)
      connectBridge();
    }
  });
}

// brief 22 + 31: 3 つのモードを分岐
// - MAP_MODE (?map=1): 全 overlay を即 hide + ride 自動 start + fake state。
//   tile origin は bridgeReachable に従う (= localhost で bridge 起動済なら bridge、 不在なら static)。
// - TEST_MODE (?test=1): overlay は出すが BLE/DB を skip、 ride 開始ボタンは user 操作.
// - default: 通常起動、 setup 充足度 + bridgeReachable を見て分岐.
//
// brief 31: MAP_MODE / TEST_MODE でも tile origin 確定のために checkSetupStatus は必須、
// その結果から bootMap(bridgeReachable) を 1 回だけ呼ぶ。 map 生成は initMapMode /
// initTestMode の入口で `if (!map) ...` 経由 (= 既存 dispatch 行のリテラルを保持)。
//
// brief 34 ε-2: 公開ガードレール introConsented guard.
// `?consent=dev` のみ intro を物理 skip (= 開発者本人 bypass)、 単純な
// `?map=1` / `?test=1` / `?ble=1` も intro 必須。 default 経路も同じ guard.
// guard 未通過なら initMapMode / initTestMode / initBleMode / bootCheckSetupStatus を
// 呼ばず、 intro-overlay を表示して user の click を待つ (= 「閉じる」/「試走デモ」).
const CONSENT_DEV_BYPASS = new URLSearchParams(location.search).get('consent') === 'dev';
function introConsented() {
  if (CONSENT_DEV_BYPASS) return true;
  return getIntroConsent() !== null;
}
// dispatch を関数化: introConsented なら mode 別に init、 未通過なら showIntroOverlay。
// brief 34 ε-8: getIntroConsent().mode === 'view' なら initViewMode に分岐 (= 観るモード).
//   URL 引数 (MAP_MODE/TEST_MODE/BLE_MODE) より intro の mode 選択を優先。 そうしないと
//   ?map=1 等を URL に残したまま「コースを観る」を選んだら view mode に入れない。
function dispatchAfterIntro() {
  // 観るモード優先 (= intro の明示選択を URL 引数より上に置く).
  // 2026-05-15 fix: ?consent=dev で起動した時は localStorage の前回 consent (= 過去 session で
  // 選んだ mode='view' 等) を無視、 default (= ride) で走る。 dev session で毎回 setup-overlay に
  // 到達したい開発者の意図を満たす (= 過去訂正「最初の画面から始まらない」反映).
  const ic = CONSENT_DEV_BYPASS ? null : getIntroConsent();
  if (ic && ic.mode === 'view') {
    initViewMode();
    return;
  }
  if (MAP_MODE) initMapMode();
  else if (TEST_MODE) initTestMode();
  // 2026-05-15 fix: default 経路を bootCheckSetupStatus (= bridge mode、 python BLE) から
  // initBleMode (= Web Bluetooth、 browser 直接 BLE) に変更。 公開設計の核は訪問者が
  // browser で完結すること、 bridge mode は yuuji 本人の自宅実環境テスト用に縮退。
  // `?bridge=1` 明示時のみ旧 bridge 経路 (= bootCheckSetupStatus) に復活。
  else if (BRIDGE_MODE) bootCheckSetupStatus();
  else initBleMode();
}

// brief 34 ε-8: 観るモードの起動関数.
// trainer / bridge / Web Bluetooth 不要、 区間 list を表示して user の選択を待つ。
// section 選択 → rideState.startFrom(start_idx) で fake state ride を開始、
// 走行ログは保存しない (= IndexedDB / Strava upload を物理 disable は body.mode-view CSS + flag 経由).
function initViewMode() {
  if (!map) { ensureMapBooted().then(() => initViewMode()); return; }
  status('VIEW MODE: 観るモード (= trainer 不要、 区間勾配を眺める)');
  document.body.classList.add('mode-view');
  // 全 overlay を hide してから section-overlay を出す (= 視覚的に他 UI を排他).
  hideDbinit();
  document.getElementById('setup-overlay')?.classList.remove('visible');
  setAppState('pairing');  // riding ではない (= section 選択待ち).
  // fake state client (= TEST_MODE / MAP_MODE と同じ生成器). state-riding は section 選択後.
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: () => {
      const snap = rideState ? rideState.snapshot() : { active: false, paused: true, distance: 0 };
      const moving = snap.active && !snap.paused;
      return {
        speed_mps: moving ? (20 / 3.6) : 0,
        power_w: moving ? 150 : 0,
        cadence_rpm: moving ? 80 : 0,
        distance_m: snap.distance,
        slope_sent_pct: 0,
        hr_bpm: 120,
        last_ack: 'OK (VIEW MODE)',
      };
    },
  });

  // 2026-05-15 fix: section-overlay 全画面 modal は撤回、 右上 persistent panel
  // (#section-list-panel) を body.mode-view CSS で常時表示。 行クリックでいつでも
  // 別区間に切替可能 (= user 指摘「走行中に右上に区間リストが有って何時でも区間を選べる」反映).
  const waitForCourse = setInterval(() => {
    if (course && course.length > 0) {
      clearInterval(waitForCourse);
      renderSectionList(course, (sec) => {
        // section 行クリック → rider を section 始点から開始 (= 瞬間ジャンプ).
        // brief 35: 旧 viewer は「rideState.startFrom 直後に playSpeed = 20/3.6 を直書き」
        // という workaround を持っていた (= 1Hz fake state catch-up までの「動かない」 体感対策).
        // 新 path では rider.setSpeed を即時に呼ぶことで、 1 経路の API 経由で同じ即時始動を実現.
        // fake state push が後で同じ rider.setSpeed を呼ぶが、 idempotent なので競合しない.
        if (!rideState) return;
        rideState.startFrom(sec.start_idx);
        if (rider) rider.setSpeed(20 / 3.6);
        lastT = performance.now();
        rideStartedAt = performance.now();
        setAppState('riding');
        // 現在 active な行に視覚 marker (= .sec-active class) を付け替え.
        const list = document.getElementById('section-list');
        if (list) {
          for (const li of list.querySelectorAll('li')) li.classList.remove('sec-active');
          const activeLi = list.querySelector(`li[data-section-index="${sec.index}"]`);
          if (activeLi) activeLi.classList.add('sec-active');
        }
      });
      // 右上 panel は body.mode-view 経由で自動表示、 明示 visible 制御不要.
    }
  }, 100);
}
// brief 34 ε-9: 地形データ準備 gate.
// 起動直後 terrainReady=false の状態で全アクションボタン disabled、 terrain probe 完了で
// enabled に遷移。 「中途半端な地図で走り出せる」事故 (= 過去訂正 2026-05-14T12:19 の同型) を
// 構造的に止める前段。 dispatch (= introConsented 判定後の遷移) は terrain と並列で動かす
// (= intro overlay は terrain 未完でも表示してよい、 ボタンだけ disabled で「クリック不可」 を見せる).
//
// 監視対象ボタン (= terrainReady===false の間 disabled):
//   - btnIntroStart   (intro 「自分の trainer で走る」)
//   - btnIntroView    (intro 「コースを観る」)
//   - btnTrainerScan  (= #btnScan、 setup-overlay)
//   - btnHrmScan      (= #btnScanHrm)
//   - btnSkip         (= 「trainer なしでデモ走行」)
//   - btnRideStart    (= ride 開始、 pair 完了とも AND)
//   - section-list の各 li (= 観るモードの区間選択)
//   - btn-ble-trainer / btn-ble-hrm (= BLE 直接接続)
//   - btnIntroClose は disable しない (= 単に閉じるだけは terrain 不要、 UX 配慮)
//
// terrainReady の保存ボタン状態 (= ride 開始は pair 完了でないと disabled の既存挙動) は維持、
// 本 gate は AND 結合 (= terrainReady === false で問答無用 disable、 true で「他の不変条件が許せば enable」).
let terrainReady = false;
// 2026-05-15 fix: 「map.on('idle') = MapLibre が viewport の全 tile load 完了」を別 flag で管理。
// terrainReady (= probe ok) と AND で「実際にボタンが押せる」を判定 (= 下記 isActionableNow)。
// これで「地形 probe ok だが実画面はまだ描画中」状態でボタンが解禁される bug を防ぐ。
let mapFullyLoaded = false;
function isActionableNow() { return terrainReady && mapFullyLoaded; }
// btnRideStart は元々 HTML で disabled、 pair 完了で enabled になる既存挙動を保持するため、
// terrain gate 単独で setRideStartEnabled する場合は pair 状態を二重 check する必要がある。
// pair 状態は wsHandlers.connect_status('connected') で btn.disabled=false に遷移する DOM 直接書込、
// terrain gate は「pair が enabled にした後で再度 disable できる」+「terrain enable 時に pair の
// 過去通知を override しない」を満たすため、 「pair 完了通知を 1 度でも受けたか」の独立 flag を持つ。
let _pairConnected = false;

function updateActionButtonsForTerrain() {
  // intro
  const introStart = typeof document !== 'undefined' ? document.getElementById('btnIntroStart') : null;
  const introView = typeof document !== 'undefined' ? document.getElementById('btnIntroView') : null;
  if (introStart) introStart.disabled = !isActionableNow();
  if (introView) introView.disabled = !isActionableNow();
  // 2026-05-15 fix: setup-overlay の「コースを観る」ボタンも intro view と同じ
  // 地形 gate に乗せる (= user 指摘「観るボタンを地形 Data が揃うまで押せないようにしろ」反映).
  const setupGoView = typeof document !== 'undefined' ? document.getElementById('btnSetupGoView') : null;
  if (setupGoView) setupGoView.disabled = !isActionableNow();
  // setup
  const btnScan = typeof document !== 'undefined' ? document.getElementById('btnScan') : null;
  const btnScanHrm = typeof document !== 'undefined' ? document.getElementById('btnScanHrm') : null;
  const btnSkip = typeof document !== 'undefined' ? document.getElementById('btnSkip') : null;
  // 2026-05-15 fix (user 怒り): scan 系は地形と無関係、 disabled 制御から外す。
  // trainer / 心拍計 pair は走行と独立した話、 地形 load 完了を待たせる理由がない。
  // 「trainer なしでデモ走行」だけ走行系なので地形必須維持。
  if (btnSkip) btnSkip.disabled = !isActionableNow();
  // btnScan / btnScanHrm は元の挙動に戻す (= HTML default、 viewer が他の経路で制御).
  // BLE
  const btnBleTrainer = typeof document !== 'undefined' ? document.getElementById('btn-ble-trainer') : null;
  const btnBleHrm = typeof document !== 'undefined' ? document.getElementById('btn-ble-hrm') : null;
  // 2026-05-15 fix: BLE 系も scan 同様、 trainer pair 自体は地形と無関係、 disabled 解除。
  // (元の HTML default state に任せる、 viewer 内の他経路で必要時に制御)
  // ride start: terrainReady === false なら強制 disable、 true なら pair 通過済の場合のみ enable.
  const btnRide = typeof document !== 'undefined' ? document.getElementById('btnRideStart') : null;
  if (btnRide) {
    if (!isActionableNow()) {
      btnRide.disabled = true;
    } else if (_pairConnected) {
      btnRide.disabled = false;
    }
    // else: pair 未完なら disabled のまま (= 既存挙動).
  }
  // section list の行は terrainReady === false で pointer-events を切る (= 視覚 + 操作両方).
  // 個別 li の disabled は <li> に効かないので class + style 経由で抑止する.
  const list = typeof document !== 'undefined' ? document.getElementById('section-list') : null;
  if (list) {
    if (terrainReady) {
      list.classList.remove('terrain-gate-disabled');
      list.style.pointerEvents = '';
      list.style.opacity = '';
    } else {
      list.classList.add('terrain-gate-disabled');
      list.style.pointerEvents = 'none';
      list.style.opacity = '0.5';
    }
  }
}

// 初回適用 (= terrainReady=false の状態で全 button を disabled に強制).
// document が無い test 環境 (= 直 import) では skip.
if (typeof document !== 'undefined') {
  // DOM がまだ parse されていない場合 (= module 最上位で実行) に備えて defer.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateActionButtonsForTerrain);
  } else {
    updateActionButtonsForTerrain();
  }
}

// brief 34 ε-9: terrain loader の起動関数. URL は ENV から取り出すが、 ENV 未確定でも
// 物理 URL は static / bridge どちらでも構築できる (= location.origin + BASE_PATH 経由).
// ここで bridge 判定を避けて static 側 URL で probe する (= bridge mode でも /tiles/gsi_dem は
// 同じ位置に存在、 失敗したら failed 状態で UI 表示).
function startTerrainProbe() {
  if (typeof document === 'undefined') return null;
  // bridge / static は起動時点で判別困難 (= checkSetupStatus は async).
  // ここは「bridge / static のどちらでも到達可能な URL」 = static 側 path で probe.
  // bridge mode 起動済の localhost でも /static/* は web/static/ にあるため 404 にならない.
  // static mode (= GitHub Pages) でも同じ path で配信される。
  const courseUrl = `${BASE_PATH}static/course.json`;
  const pmtilesUrl = `${BASE_PATH}static/map.pmtiles`;
  const gsiTileBaseUrl = `${BASE_PATH}static/tiles/gsi_dem`;
  const loader = createTerrainLoader({ courseUrl, pmtilesUrl, gsiTileBaseUrl });
  loader.subscribe((snap) => {
    setTerrainStatusUI(snap);
    updateTerrainStep(snap.phase);
    if (snap.phase === 'done') {
      terrainReady = true;
      updateActionButtonsForTerrain();
      // 2026-05-16 fix: 一部環境 (= GPU 制限 / tile fetch 部分失敗) で map.on('idle') が
      // 発火せず mapFullyLoaded が永遠 false になる事故 (= user 報告「閉じるしか押せない」).
      // terrain probe done (= course / pmtiles / GSI tile 全部確認済) + 5 秒待っても
      // idle 未発火なら、 描画 sentinel を諦めて button 解禁する。 過去訂正
      // (= 中途半端な地図で走り出す) 防止は terrain probe 側で担保済、 idle gate は
      // 二重保険にすぎない。
      setTimeout(() => {
        if (!mapFullyLoaded) {
          console.warn('[fujihill] map idle 5 秒未発火、 fallback で mapFullyLoaded=true');
          mapFullyLoaded = true;
          updateActionButtonsForTerrain();
        }
      }, 5000);
    } else {
      // failed / loading / pending 中は強制 disable を維持
      terrainReady = false;
      updateActionButtonsForTerrain();
    }
  });
  // start は fire-and-forget (= 完了は subscribe 経由).
  loader.start().catch((e) => {
    console.warn('[fujihill] terrain probe error:', e);
  });
  return loader;
}
// 起動直後 1 回. test 環境 (= window 不在 / fetch 不在) では try/catch で silent skip.
let _terrainLoader = null;
if (typeof window !== 'undefined' && typeof globalThis.fetch === 'function') {
  try { _terrainLoader = startTerrainProbe(); } catch (e) { console.warn('[fujihill] terrain probe init failed:', e); }
}

// 起動時に未完了 ride (= autosave 未クリア) があれば復元 dialog を出す。
// dialog で「復元」→ dispatch 後に rideState 準備で applyPendingRestore、「破棄」→ clearAutosave して通常起動。
// test 環境 (= window 不在 / IndexedDB 不在) や ?nopreflight=1 では skip.
const SKIP_RESTORE = new URLSearchParams(location.search).get('nopreflight') === '1';
function defaultDispatch() {
  if (introConsented()) {
    dispatchAfterIntro();
  } else {
    showIntroOverlay();
  }
}
async function checkRestoreThenDispatch() {
  if (SKIP_RESTORE || typeof window === 'undefined' || !globalThis.indexedDB) {
    defaultDispatch();
    return;
  }
  // 2026-05-16 fix: F5 reload で真っ黒で詰む user 報告。 IndexedDB hang / 壊れた record /
  // showRestoreDialog の例外いずれでも defaultDispatch (= intro へ) に escape して
  // 「真っ黒で詰む」 状態を絶対作らない。 3 秒 timeout も被せる。
  let pending = false;
  let rec = null;
  try {
    const ioPromise = (async () => {
      const p = await hasPendingAutosave();
      const r = p ? await loadAutosave() : null;
      return { p, r };
    })();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), 3000));
    const result = await Promise.race([ioPromise, timeoutPromise]);
    if (result === '__timeout__') {
      console.warn('[fujihill] autosave check timeout, fallback to defaultDispatch');
      defaultDispatch();
      return;
    }
    pending = result.p;
    rec = result.r;
  } catch (err) {
    console.warn('autosave check failed:', err);
    defaultDispatch();
    return;
  }
  if (!pending || !rec) {
    defaultDispatch();
    return;
  }
  try {
    showRestoreDialog(rec);
  } catch (err) {
    console.warn('showRestoreDialog failed, fallback to intro:', err);
    defaultDispatch();
  }
}

function showRestoreDialog(rec) {
  const ov = document.getElementById('restore-overlay');
  const info = document.getElementById('restore-info');
  if (info) {
    info.textContent = `${rec.rideStartedAt || '(時刻不明)'} 開始の ride が途中で終わっています (${rec.trkpts?.length || 0} 点, ${((rec.distanceM || 0) / 1000).toFixed(2)} km).`;
  }
  if (ov) ov.classList.add('visible');
  const btnYes = document.getElementById('btnRestoreYes');
  const btnDiscard = document.getElementById('btnRestoreDiscard');
  if (btnYes) {
    const nb = btnYes.cloneNode(true);
    btnYes.parentNode.replaceChild(nb, btnYes);
    nb.addEventListener('click', () => {
      if (ov) ov.classList.remove('visible');
      _pendingRestore = rec;
      // 2026-05-17 fix (= 復元バグ root cause #1: timing desync):
      // 旧コードは _pendingRestore をセットするだけで、 復元の適用 (applyPendingRestore) は
      // loadCourse 末尾の 1 箇所からしか呼ばれなかった。 loadCourse は map 'load' で 1 度走り、
      // それは通常 user がこの「復元」を押すより前。 つまり applyPendingRestore は
      // _pendingRestore===null の状態で空振りし、 その後二度と呼ばれず復元が起きなかった。
      // ここで直接呼ぶ: rideState 準備済なら即適用、 未準備なら早期 return して
      // loadCourse 末尾の呼出が _pendingRestore を拾う (= どちらの順序でも復元される)。
      applyPendingRestore();
      defaultDispatch();
    });
  }
  if (btnDiscard) {
    const nb = btnDiscard.cloneNode(true);
    btnDiscard.parentNode.replaceChild(nb, btnDiscard);
    nb.addEventListener('click', () => {
      clearAutosave().catch((err) => console.warn('clearAutosave failed:', err));
      if (ov) ov.classList.remove('visible');
      defaultDispatch();
    });
  }
}

let _pendingRestore = null;
// rideState が初期化された後 (= bootMap → course load → createRideState 完了後) に呼ばれる.
// 呼び出し点は course load 完了後の場所 (= 後段で hook を入れる)。 暫定 module-level 関数:
function applyPendingRestore() {
  if (!_pendingRestore || !rideState) return;
  const rec = _pendingRestore;
  _pendingRestore = null;
  try {
    // 2026-05-17 fix (= 復元バグ root cause #2: getter-only への代入):
    // 旧コードは `rideState._rider.distanceTraveled = rec.distanceM` で距離を書いていたが、
    // rider.distanceTraveled は getter-only accessor。 ES module は strict mode なので
    // getter-only への代入は TypeError を throw し、 この try-catch に落ちて復元が丸ごと
    // abort していた (= distance も trkpts も復元されない)。
    // record→rideState 変換は ride_autosave.js の applyAutosaveToRideState に集約。
    // 距離は rider.placeAtDistance() 経由でセットされる。
    const applied = applyAutosaveToRideState(rideState, rec);
    if (!applied) {
      console.warn('applyPendingRestore: autosave record が不正のため復元を skip');
      return;
    }
    rideStartedAt = performance.now();  // restore 後の経過時間は再起算 (= 旧 ride の wall-clock は autosave に保存済)
    rideStartedIso = rec.rideStartedAt || new Date().toISOString();
    lastTrkptT = performance.now();
    lastAutosaveT = performance.now();
    status(`途中 ride を復元しました (${applied.trkptCount} 点, ${(applied.distanceM / 1000).toFixed(2)} km)`);
  } catch (err) {
    console.warn('applyPendingRestore failed:', err);
  }
}

checkRestoreThenDispatch();

function initMapMode() {
  if (!map) { ensureMapBooted().then(() => initMapMode()); return; }  // brief 31
  status('MAP MODE: UI 操作なしで地図表示のみ確認');
  // 全 overlay を hide (= 視界をクリアにして地図 + HUD + minimap だけ見せる)
  hideDbinit();
  document.getElementById('setup-overlay')?.classList.remove('visible');
  setAppState('riding');
  // ?map=1&z=14&pitch=30 で zoom / pitch を override 可 (= OSM 道路 / 建物の細線確認に zoom out 必須)
  const params = new URLSearchParams(location.search);
  const zParam = parseFloat(params.get('z'));
  const pitchParam = parseFloat(params.get('pitch'));
  if (Number.isFinite(zParam) && zParam >= 13 && zParam <= 24) userZoom = zParam;
  if (Number.isFinite(pitchParam) && pitchParam >= 0 && pitchParam <= 85) userPitch = pitchParam;
  // TEST_MODE と同じ fake client (= bridge / trainer 不要)
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: () => {
      const snap = rideState ? rideState.snapshot() : { active: false, paused: true, distance: 0 };
      const moving = snap.active && !snap.paused;
      return {
        speed_mps: moving ? (20 / 3.6) : 0,
        power_w: moving ? 150 : 0,
        cadence_rpm: moving ? 80 : 0,
        distance_m: snap.distance,
        slope_sent_pct: 0,
        hr_bpm: 120,
        last_ack: 'OK (MAP MODE)',
      };
    },
  });
  // 描画完了まで ride を待機 (= user 指示: 「全体描画が終わるまでスタートせずに待機」).
  // ローディングインジケータを表示、 rideState 準備済 + map.idle (= 全 tile load + render flush)
  // 両方揃ったら ride 開始 + インジケータ hide. ただし terrain dem の継続要求で idle が
  // 発火しないケースの fallback として、 6 秒で強制 start.
  const loader = document.getElementById('loading-indicator');
  if (loader) { loader.style.display = 'block'; loader.textContent = '描画準備中...'; }
  let mapIdle = false;
  let rideReady = false;
  function tryStart() {
    if (!mapIdle || !rideReady) return;
    if (loader) loader.style.display = 'none';
    rideState.start();
    rideStartedAt = performance.now();
  }
  map.once('idle', () => { mapIdle = true; tryStart(); });
  // fallback: 6 秒待っても idle が来なければ強制 start (= terrain dem の継続 fetch で
  // idle が永遠に発火しない MapLibre の挙動 workaround).
  setTimeout(() => { if (!mapIdle) { mapIdle = true; tryStart(); } }, 6000);
  const waitForRide = setInterval(() => {
    if (rideState) {
      clearInterval(waitForRide);
      rideReady = true;
      tryStart();
    }
  }, 100);
}

function startGsiFetch() {
  fetch(`${HTTP_BASE_URL}/tiles/_fetch_gsi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => { if (!r.ok && r.status !== 202) status(`GSI fetch 失敗: HTTP ${r.status}`); })
    .catch((e) => status(`GSI fetch error: ${e && e.message || e}`));
}

function startOsmExtract() {
  const input = document.getElementById('osmPmtilesPath');
  const pmtiles_path = (input && input.value || '').trim();
  if (!pmtiles_path) { status('PMTiles file path を入力してください'); return; }
  fetch(`${HTTP_BASE_URL}/tiles/_extract_osm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pmtiles_path }),
  })
    .then((r) => { if (!r.ok && r.status !== 202) status(`OSM 取込失敗: HTTP ${r.status}`); })
    .catch((e) => status(`OSM 取込 error: ${e && e.message || e}`));
}

function skipDbinit() {
  // 「スキップ (地形だけで進む)」 = OSM 抽出を後回しにして BLE pairing flow に移る。
  // dbinit overlay を閉じて state-pairing へ、 setup-overlay を明示 visible 化 (= 2026-05-15 fix)。
  _advancedFromDbinit = true;
  hideDbinit();
  setAppState('pairing');
  document.getElementById('setup-overlay')?.classList.add('visible');
}

// 2026-05-15 fix: ノーマルエグジット 2 種を追加 (= user 指摘「出口ボタンが絶対要る」反映).
// btnDbinitProceed = 「▶ 機器選択へ進む」 (= DB が揃ってる時の通常出口、 setup-overlay を表示).
// btnDbinitClose   = 「× 閉じる」 (= 何も進めない、 intro overlay に戻る or close)。
function proceedFromDbinit() {
  // DB 構築 panel から強制で機器選択画面 (setup-overlay) に進む。 自動遷移を待たない明示 exit。
  _advancedFromDbinit = true;
  hideDbinit();
  setAppState('pairing');
  document.getElementById('setup-overlay')?.classList.add('visible');
}

function closeDbinit() {
  // dbinit overlay を閉じる + intro overlay を再表示 (= 「もうやめる、 最初に戻る」)。
  // setIntroConsent は cleared、 user は intro から走る / 観る / 閉じる を再選択できる。
  _advancedFromDbinit = false;
  hideDbinit();
  setAppState('checking');
  // intro を出して訪問者が選び直せる状態に戻す。
  showIntroOverlay();
}

// === コース読み込み ===
async function loadCourse() {
  // brief 31 commit β: ENV (= immutable env object) から URL を取得。
  // bootEnv() で freeze 済の値、 caller 全部 await 経由なので未確定状態で呼ばれることはない。
  // 万一 ENV 未初期化なら bridge mode の旧 default で fallback (= localhost 起動の従来挙動)。
  const url = ENV ? ENV.courseUrl : 'course.json';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    course = await resp.json();
  } catch (err) { status(`course.json load failed: ${err.message}`); return; }
  if (!course.length) { status('course.json empty'); return; }
  // brief 23: GPS ジッター除去. lat/lon の short-window moving average (window=5)
  // で短距離ジグザグだけ補正、 道路カーブは保存. distance_m / slope_pct / elevation_m は不変.
  course = smoothCourse(course);
  // brief 35: Terrain + Rider を viewer の 1 source-of-truth として確立.
  // rideState (= 後方互換 shim) は内部で同じ Rider を保持するので、 viewer 側の rider 変数と
  // shim 内 Rider は完全同一 instance、 二重 state にならない (= _rider 公開で共有).
  terrain = createTerrain({ course });
  rideState = createRideState(course);
  // shim 内 Rider と新 viewer 経路の rider を一致させる. 別 instance を作ると進行 state が
  // 二重管理になって drift する (= 過去 brief 19 の curIdx 二重持ち bug と同型予防).
  rider = rideState._rider;
  // 起動時の autosave 復元が pending なら、 ここで rideState を進めた状態に持ち上げる.
  applyPendingRestore();
  totalDist = course[course.length - 1].distance_m;
  setText('total', totalDist.toFixed(0));
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  // brief 24 + 25: 各 segment を 5m 幅の polygon に展開、 勾配グレード別色分け.
  // Zwift Climb Portal 風: flat=緑 / gentle=黄緑 / moderate=黄 / hard=橙 / very_hard=赤 / extreme=紫.
  // brief 34 ε-F: course 不変前提で polygon 計算結果を IndexedDB に persist。 2 回目以降の
  // 起動では既存 cache を読み戻し、 buildGradeColoredRoadPolygons (= 全 segment の expansion +
  // 勾配 grade 計算) を完全 skip。 cache miss / IDB 不在は既存経路に fallback (= no-op fail-open).
  if (!map.getSource('route')) {
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
        // fire-and-forget: 書き込み失敗で起動を block しない (= 次回 reload で再 attempt)
        setMeshCache(courseHash, 'polygon', { geojson: polygonData }).catch(() => {});
      }
    }
    const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    console.log(`[mesh_cache] polygon ${cacheHit ? 'HIT' : 'MISS'} ${dt.toFixed(1)}ms hash=${courseHash}`);
    map.addSource('route', { type: 'geojson', data: polygonData });
    // brief b2 High-3: 帯ポリゴン (1968 セグメント) の zoom 連動再生成を撤去。
    // 旧実装は map.on('zoom') ごとに buildGradeColoredRoadPolygons を再実行し
    // 全頂点を GPU に再アップロードしていた (= zoom 操作中 1 回 31〜63ms の stall)。
    // polygonData は固定幅 5m で 1 回だけ生成済 (= 上の addSource / cache HIT 経路)。
    // zoom による太さの可変が必要なら meter 幅の再生成ではなく route-line 側の
    // line-width zoom 式で表現する (= 再 tessellate ゼロ)。
    // Fix2: 道路 polygon を **最前面** に挿入 (= beforeId 削除).
    // 旧仕様で beforeId='roads' にしていたが、 OSM roads-major (= 橙線) が
    // polygon を貫いて表示されてしまうため、 polygon を上に置いて道幅を露出させる.
    map.addLayer({
      id: 'route-fill',
      type: 'fill',
      source: 'route',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.95,
        // audit Round 2: anti-alias を切ると隣接 polygon 縁の半透明 compositing が消え、
        // 共有 edge での白隙 (= 背景 #e8e8e8 漏れ) が出なくなる。
        'fill-antialias': false,
      },
    });
    // 細い線で polygon の縁取り (= zoom out 時の視認性確保)
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: { 'line-color': '#222', 'line-width': 0.5, 'line-opacity': 0.6 },
    });
  }
  // start / goal markers
  // start (緑) / goal (赤) pin: pairing / dbinit 中は表示、 ride 中は hide
  // (= MapLibre Marker は DOM SVG で polygon の上に描画され「うっすら前に浮く」、
  //   ride 視点では minimap に start/goal が見えるのでメイン map から退ける).
  startGoalMarkers = [
    new maplibregl.Marker({ color: '#7fff00' }).setLngLat([course[0].lon, course[0].lat]).addTo(map),
    new maplibregl.Marker({ color: '#ff3030' }).setLngLat([course[course.length - 1].lon, course[course.length - 1].lat]).addTo(map),
  ];
  updateStartGoalVisibility();

  // rider マーカー: fill-extrusion で 3D 立体。 buildRiderFeatures が複数 part
  // (= 自転車車体 + rider) を返し、 各 part の色 / 高さ / base は feature property で持つ。
  // 2026-05-17: 旧来は cyan 1m 角の豆腐 1 個。 慣性シミュの自転車に寄せ、 低く長い暗色の
  // 車体 + その上に立つ cyan の rider のシルエットにした。 MapLibre は上方押し出しのみで
  // スポーク等の 3D 詳細は描けないため、 シルエットで「自転車に乗った rider」 を表す。
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

  // brief 29: minimap を旧 OSM 直叩き方式に rollback。 上半分 = canvas + loadOsmTile (1-shot)、
  // 下半分 = 標高プロファイル canvas。 course load 完了後 1 回だけ。
  // buildMinimapTopBase は async (= 9-16 OSM タイル fetch 完了待ち)、 await はせず fire-and-forget。
  // fetch 完了前は polyline + dot だけが見える状態 (= polylines は同期 ctx.stroke で先に描く)、
  // fetch 完了後に drawImage で OSM が overlay される。 ride 開始は OSM 完了に依存しない。
  buildMinimapTopBase();
  buildMinimapBottomBase();

  // brief 17b: prefetch を完全削除。 タイルは MapLibre が on-demand で
  // localhost /tiles/... から fetch する。 外部 fetch ゼロ。

  // 初期 camera: start 地点に寄せる、 起動直後から走行視点っぽい絵にする
  // (全体俯瞰だと goal 側ばかり映って rider が画面外になる、 user 不満を生む)
  // user 動作確認で確定した default (画面 HUD 由来、 現地の道路幅感覚に合う値)
  // MAP_MODE は ?z=N&pitch=M で override 可能にする (= UI 操作なし visual 検証用)
  // 通常起動時は ride 視点 (= 道路 1 車線 + ほぼ水平) の default を hard-set
  if (!MAP_MODE) {
    userZoom = 21;       // 2026-05-15 user 判断: 走行視点として親密、 道路 polygon が画面 1/4 程度
    userPitch = 85;      // ほぼ水平、 カーナビ的前方視野
  }
  // user が縦ドラッグ / ホイールで再調整可、 その値が以後 default になる挙動
  const cam0 = computeCameraParams(course, { curIdx: 0 }, { userZoom, userPitch, lookAhead: 20 });
  map.jumpTo(cam0);
  lastT = performance.now();
  requestAnimationFrame(tick);
}

// === minimap (course polyline + OSM 1-shot + 標高プロファイル) ===
// brief 29: brief 28 の MapLibre 2nd instance 撤回、 旧 OSM 直叩き方式 (= canvas + loadOsmTile)
// に rollback。 ToS 範囲内 1-shot 9-16 タイル fetch、 ride 中 再 fetch ゼロ。
// 上半分 (= #minimap-top canvas): z=11 周辺 OSM タイル + course polyline + start/goal dot + 180度回転。
// 下半分 (= #minimap-bottom canvas): 標高プロファイル (= brief 28 と同仕様、 関数名 rename のみ)。
// 注意: ここで OSM 直叩きが復活していたが、 brief 31 構造修正で static mode は
// 完全 disable (= GitHub Pages 訪問者全員が OSM ToS heavy use 違反になる harm vector close)。
// ride hot path には絶対戻さない、 prefetchTilesAlongCourse 復活も絶対 NG (= brief 13 物理 freeze)。

// loadOsmTile: brief 30 で DB cache 化、 brief 31 で mode 分岐。
// bridge mode: 一次 ${BRIDGE_TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png (= bridge.py が SQLite から PNG)、
//   fallback で OSM 直叩き (= localhost 単独利用、 ToS 上 heavy use ではない)
// static mode (= GitHub Pages): minimap 用 OSM raster を bridge に依存するため、
//   一次経路を最初から無効化 (= 即 resolve、 minimap は地形 PNG + 路線 polygon のみで描画)。
//   ここで bridge URL を叩くと static 訪問者が localhost を引いて 404 → onerror で OSM 直叩き
//   fallback 発火 → 訪問者全員が公式 tile server を heavy use する第三者 harm vector になる。
// 失敗時は resolve のみ (= reject しない、 旧版踏襲)。
// crossOrigin='anonymous' は canvas tainted 回避用 (= drawImage 後 getImageData は呼ばないので
// 必須ではないが旧版踏襲、 OSM 側は CORS 許可ヘッダを返すので無害)。
// User-Agent は browser が自動で送る (= bridge 側で fetch するときは fujihill-trainer/0.1 UA を明示)。
function loadOsmTile(ctx, tx, ty, z, projectLatLon, clipRect) {
  return new Promise((resolve) => {
    // brief 31: static mode (= bridge 未到達) では minimap 用 OSM raster を取得しない。
    // 第三者 harm 防止 (= 公開 viewer から OSM 公式 tile server への heavy use 発生回避)。
    // commit β: 旧 _bridgeReachable 直接参照を ENV.mode 経由に置換 (= immutable env object)。
    if (!ENV || ENV.mode !== 'bridge') {
      resolve();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let tried = false;
    img.onload = () => {
      const lonW = tileXToLon(tx, z), lonE = tileXToLon(tx + 1, z);
      const latN = tileYToLat(ty, z), latS = tileYToLat(ty + 1, z);
      const [x1, y1] = projectLatLon(latN, lonW);
      const [x2, y2] = projectLatLon(latS, lonE);
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
      ctx.clip();
      ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
      resolve();
    };
    img.onerror = () => {
      // 2026-05-15 fix: OSM 公式 (tile.openstreetmap.org) への直叩き fallback を撤去。
      // CSP の img-src は 'self' + Strava のみ、 OSM 直叩きは block されて Console に
      // 「CSP violation」 が並んでいた。 2026-05-14 user 訂正「ローカル DB にタイルを
      // 整備したらダメなんか」と整合 (= 第三者 OSM サーバへの heavy use 回避 + CSP
      // error 消滅)。 cache miss は silent resolve、 minimap の該当タイルは透明で OK。
      resolve();
    };
    // brief 30 一次経路: bridge 経由で DB tiles table から hit (= source='osm_raster')。
    // 2 回目以降の起動では完全に DB hit、 OSM サーバへの再 fetch ゼロ。
    img.src = `${BRIDGE_TILE_BASE_URL}/osm_raster/${z}/${tx}/${ty}.png`;
  });
}

// drawDirTriangle: 旧版踏襲。 rider の進行方向を示す三角形を canvas 上半分に描画。
// 180度回転後の上半分内で描くので、 heading は反転考慮済の値を渡す側で処理する。
function drawDirTriangle(ctx, x, y, heading, size) {
  const cosH = Math.cos(heading), sinH = Math.sin(heading);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  // 三角形 (= 進行方向の先端 + 後ろ 2 点)
  ctx.moveTo(sinH * size, -cosH * size);
  ctx.lineTo(sinH * -size * 0.6 + cosH * size * 0.6, -cosH * -size * 0.6 + sinH * size * 0.6);
  ctx.lineTo(sinH * -size * 0.6 - cosH * size * 0.6, -cosH * -size * 0.6 - sinH * size * 0.6);
  ctx.closePath();
  ctx.fillStyle = 'cyan';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// brief 29: 上半分 (#minimap-top canvas) の base 画像を生成。 旧 buildMinimapBase のうち
// 上半分処理だけを抽出 (= 下半分は buildMinimapBottomBase に分離)、 結果は minimapTopBase に保存。
// 9-16 OSM タイル (= z=11) を 1-shot 並列 fetch、 fetch 失敗時は単色 + polyline + dot は残す。
async function buildMinimapTopBase() {
  const onscreen = document.getElementById('minimap-top');
  if (!onscreen || course.length === 0) return;
  // brief 30: 起動時 1 回、 bridge に minimap raster の DB cache 構築を fire-and-forget で依頼。
  // 既に DB に揃っていれば 9-16 タイル分の skipped で完走 (= OSM fetch ゼロ)、
  // 不足分のみ 1 req/sec で fetch + insert。 完走後は次回起動から完全 DB hit。
  // bridge 未起動 / 失敗時は無視 (= OSM 直叩き fallback が loadOsmTile 内で動く)。
  fetch(`${HTTP_BASE_URL}/tiles/_fetch_minimap_raster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => { /* silent: fallback は loadOsmTile が担う */ });
  const W = onscreen.width, H = onscreen.height;
  const PAD = 12;
  // course bbox を 20% margin で広げる
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of course) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const latM = (maxLat - minLat) * 0.20, lonM = (maxLon - minLon) * 0.20;
  minLat -= latM; maxLat += latM; minLon -= lonM; maxLon += lonM;
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos(midLat * Math.PI / 180);
  const dLat = maxLat - minLat, dLon = (maxLon - minLon) * lonScale;
  const innerW = W - 2 * PAD, innerH = H - 2 * PAD;
  const scale = Math.min(innerW / dLon, innerH / dLat);
  const projW = dLon * scale, projH = dLat * scale;
  const offsetX = PAD + (innerW - projW) / 2;
  const offsetY = PAD + (innerH - projH) / 2;
  // 普通の projection (北上向き)、 180 度回転は最後に canvas 全体に rotate を掛けて実現
  function project(lat, lon) {
    const x = offsetX + (lon - minLon) * lonScale * scale;
    const y = offsetY + (maxLat - lat) * scale;
    return [x, y];
  }
  // 上半分の minimapStats は projectLatLon を含む (= updateMinimap の rider 描画で使う)
  // 下半分の stats は buildMinimapBottomBase が後で setup する。
  minimapStats = Object.assign(minimapStats || {}, {
    projectLatLon: project,
    rotateTop: { W, H },
  });

  // off-screen canvas に描画して minimapTopBase に保存
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = 'rgba(15,15,20,0.85)';
  ctx.fillRect(0, 0, W, H);

  // OSM タイル 1-shot 並列 fetch (= z=11 周辺、 buffer=1 で 9-16 タイル)
  // ToS 範囲内: 起動時 1 回、 ride 中 再 fetch ゼロ。 brief 29 / Rule 11 class B 扱い。
  const z = 11;
  const buffer = 1;
  const minTx = Math.floor(lonToTileX(minLon, z)) - buffer;
  const maxTx = Math.floor(lonToTileX(maxLon, z)) + buffer;
  const minTy = Math.floor(latToTileY(maxLat, z)) - buffer;
  const maxTy = Math.floor(latToTileY(minLat, z)) + buffer;
  const clip = { x: PAD, y: PAD, w: W - 2 * PAD, h: H - 2 * PAD };
  const ps = [];
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      ps.push(loadOsmTile(ctx, tx, ty, z, project, clip));
    }
  }
  await Promise.all(ps);

  // course polyline (= 黄)
  ctx.beginPath();
  for (let i = 0; i < course.length; i++) {
    const [x, y] = project(course[i].lat, course[i].lon);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ffd54a';
  ctx.lineWidth = 3;
  ctx.stroke();
  // start dot (= 緑)
  const [sx, sy] = project(course[0].lat, course[0].lon);
  ctx.fillStyle = '#7fff00';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  // goal dot (= 赤)
  const [gx, gy] = project(course[course.length - 1].lat, course[course.length - 1].lon);
  ctx.fillStyle = '#ff3030';
  ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

  // 180 度回転 (= 画面下が進行方向前方になる視覚整合、 旧版踏襲)
  const copy = document.createElement('canvas');
  copy.width = W; copy.height = H;
  copy.getContext('2d').drawImage(off, 0, 0);
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI);
  ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(copy, 0, 0);
  ctx.restore();

  minimapTopBase = off;
}

// brief 29: 下半分 (= #minimap-bottom canvas) の標高プロファイル base 画像。
// brief 28 の buildMinimapBottom と同仕様、 関数名のみ rename (= buildMinimapTopBase との対称性)。
function buildMinimapBottomBase() {
  const onscreen = document.getElementById('minimap-bottom');
  if (!onscreen || course.length === 0) return;
  const W = onscreen.width, H = onscreen.height;
  const PAD = 12;
  const eles = course.map(p => p.elevation_m);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const totalD = course[course.length - 1].distance_m;
  const botInnerW = W - 2 * PAD;
  const botInnerH = H - 2 * PAD;
  const botBaseY = H - PAD;
  const botTopY = PAD;
  minimapStats = Object.assign(minimapStats || {}, {
    minE, maxE, totalD, PAD, botInnerW, botInnerH, botBaseY, botTopY,
  });

  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = 'rgba(15,15,20,0.85)'; ctx.fillRect(0, 0, W, H);
  // 標高プロファイルの塗り (= gradient)
  ctx.beginPath(); ctx.moveTo(PAD, botBaseY);
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const x = PAD + (p.distance_m / totalD) * botInnerW;
    const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(PAD + botInnerW, botBaseY); ctx.closePath();
  const grad = ctx.createLinearGradient(0, botTopY, 0, botBaseY);
  grad.addColorStop(0, 'rgba(255,213,74,0.7)');
  grad.addColorStop(1, 'rgba(255,213,74,0.15)');
  ctx.fillStyle = grad; ctx.fill();
  // 標高プロファイルの白線
  ctx.beginPath();
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const x = PAD + (p.distance_m / totalD) * botInnerW;
    const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  // min/max 標高ラベル
  ctx.fillStyle = '#aaa'; ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(`${maxE.toFixed(0)}m`, 4, botTopY + 14);
  ctx.fillText(`${minE.toFixed(0)}m`, 4, botBaseY - 4);
  minimapBottomBase = off;
}

// brief 17b: prefetchTilesAlongCourse は完全削除。 関連する seenOsm / seenDem 等の
// 変数も使用箇所が無いため定義しない。 タイルは MapLibre の on-demand fetch (= localhost
// /tiles/... 経由) で読み込み、 外部第三者 endpoint には一切 fetch しない (= main viewer)。
// brief 29: minimap だけ例外で OSM 直叩き (= 起動時 1-shot 9-16 タイル、 z=11)、
// ride 中の再 fetch ゼロ。 prefetchTilesAlongCourse 復活は絶対 NG。

// rider の 3D 豆腐 = 1m 角の正方形、 heading に合わせて 4 辺が進行方向の前後左右を向く。
// rider を「自転車に乗った人」 のシルエットで返す (2026-05-17、 慣性シミュの自転車に寄せた)。
// local 座標は x = 進行方向に直交、 y = 進行方向 (= 前が +y)。 heading で回転して lon/lat へ。
// MapLibre fill-extrusion は地面からの上方押し出しのみ。 スポーク付き車輪のような縦の円盤は
// 描けないため、 低く長い暗色の車体 + その上に立つ cyan の rider の 2 part でシルエットを作る。
// 各 part は color / base / height を feature property で持ち、 rider-body layer が ['get'] で読む。
// spin (= 車輪回転角) は fill-extrusion では表現不可、 signature 互換のため受けるが未使用。
function buildRiderFeatures(lat, lon, heading, spin) {
  const M_LAT = 1 / 111320;
  const M_LON = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  const toLngLat = (x, y) => {
    const rx = x * cosH + y * sinH;
    const ry = -x * sinH + y * cosH;
    return [lon + rx * M_LON, lat + ry * M_LAT];
  };
  const part = (x0, x1, y0, y1, color, base, height) => {
    const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => toLngLat(x, y));
    ring.push(ring[0]);
    return { type: 'Feature', properties: { color, height, base }, geometry: { type: 'Polygon', coordinates: [ring] } };
  };
  return {
    type: 'FeatureCollection',
    features: [
      part(-0.22, 0.22, -0.95, 0.95, '#23272f', 0, 0.55),    // 車体: 低く長い暗色 (= 自転車)
      part(-0.21, 0.21, -0.28, 0.34, '#00ffff', 0.55, 1.9),  // rider: cyan、 車体上に立つ
    ],
  };
}

// brief 29: 上下 2 canvas にそれぞれ base 画像を drawImage + rider 描画。
// 上半分: 180度回転後の座標で rider 三角形を描く (= 進行方向を画面下向きに)。
// 下半分: 標高プロファイル base 画像の上に rider 縦線 + dot。
// brief b2 High-5: getContext は loop 外 (= lazy 1 回) でキャッシュ、 2D canvas の
// 全 clear + drawImage は rider が pixel 単位で動いた時だけ実行する。 停止中は skip。
let _minimapTopCtx = null;
let _minimapBotCtx = null;
let _minimapTopFrame = null;  // 前フレームの rider 位置/向き (= 上 canvas 再描画判定)
let _minimapBotFrame = null;  // 前フレームの dot 位置 (= 下 canvas 再描画判定)

function updateMinimap(curDistM, curEleM, curLat, curLon, heading) {
  if (!minimapStats) return;

  const topCanvas = document.getElementById('minimap-top');
  const botCanvas = document.getElementById('minimap-bottom');
  const hasTop = topCanvas && minimapTopBase && minimapStats.projectLatLon;
  const hasBot = botCanvas && minimapBottomBase;
  if (!hasTop && !hasBot) return;

  const { minE, maxE, totalD, PAD, botInnerW, botInnerH, botBaseY, botTopY } = minimapStats;
  // 上半分 rider 位置 (= 描画前に算出して変化検出に使う)
  let rx = 0, ry = 0;
  if (hasTop) { [rx, ry] = minimapStats.projectLatLon(curLat, curLon); }
  // 下半分 dot 位置
  const px = PAD + (curDistM / totalD) * botInnerW;
  const py = botBaseY - ((curEleM - minE) / (maxE - minE)) * botInnerH;

  // 上 rider (x,y,heading度) と下 dot (px,py) のいずれかが量子化単位で動いたら再描画。
  const frame = { x: rx, y: ry, h: heading * 180 / Math.PI };
  const botMoved = !_minimapBotFrame
    || Math.round(_minimapBotFrame.px) !== Math.round(px)
    || Math.round(_minimapBotFrame.py) !== Math.round(py);
  if (!minimapDirty(_minimapTopFrame, frame) && !botMoved) return;
  _minimapTopFrame = frame;
  _minimapBotFrame = { px, py };

  // 上半分: #minimap-top ── rider 三角形を 180度回転後の座標系で描画
  // (= base 画像が既に 180度回転済なので、 rider 位置も同じ rotate を適用する)
  if (hasTop) {
    if (!_minimapTopCtx) _minimapTopCtx = topCanvas.getContext('2d');
    const tctx = _minimapTopCtx;
    tctx.clearRect(0, 0, topCanvas.width, topCanvas.height);
    tctx.drawImage(minimapTopBase, 0, 0);
    const { W, H } = minimapStats.rotateTop;
    tctx.save();
    tctx.translate(W / 2, H / 2);
    tctx.rotate(Math.PI);
    tctx.translate(-W / 2, -H / 2);
    drawDirTriangle(tctx, rx, ry, heading, 9);
    tctx.restore();
  }

  // 下半分: #minimap-bottom
  if (hasBot) {
    if (!_minimapBotCtx) _minimapBotCtx = botCanvas.getContext('2d');
    const ctx = _minimapBotCtx;
    ctx.clearRect(0, 0, botCanvas.width, botCanvas.height);
    ctx.drawImage(minimapBottomBase, 0, 0);
    ctx.strokeStyle = 'rgba(0,220,220,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, botTopY); ctx.lineTo(px, botBaseY); ctx.stroke();
    ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  }
}

// brief b2: per-frame 差分検出の前フレーム state (= 無条件再構築の回避用)。
let _lastRiderFrame = null;   // Critical-1: rider setData 差分

function tick(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (!rider || !rideState) { requestAnimationFrame(tick); return; }

  // brief 35: 1 source-of-truth 化. 旧 viewer は tick 内で curIdx / curDist / 補間 frac /
  // courseBearing / smoothBearing / riderHeadingRad / spinAngle を全部 inline 計算していたが、
  // すべて rider.tick + rider.snapshot.position に集約済. viewer は snapshot を描画に流すだけ.
  rider.tick(dt, { speedMultiplier: speedMult });
  const snap = rider.snapshot();
  const pos = snap.position;
  const curDist = snap.distance;
  const rLat = pos.lat;
  const rLon = pos.lon;
  const rEle = pos.elevation;
  const curIdx = pos.segmentIdx;
  // 2026-05-17: コース勾配は wsHandlers.state が rider.snapshot().position から都度引くため、
  // tick() 側で module global へ写す経路は廃止 (= 初回 tick より前の state push で slope=0 に
  // なる Critical バグの除去)。

  // camera bearing: 旧 viewer は curIdx の bearing と curIdx+1 の bearing を frac で線形補間して
  // 「GPS 点間が不均一でも curIdx 変化の瞬間に視線がカクッと回転する」 問題を解消していた。
  // Terrain.getPositionAtDistance は heading を 1 値だけ返すため、 ここでは旧 frac 補間 logic を
  // 維持して滑らかさを保つ (= camera 専用、 rider.position.heading は単一 segment ベース).
  const cam = computeCameraParams(course, { curIdx }, { userZoom, userPitch, lookAhead: 5 });
  const nextIdx = Math.min(curIdx + 1, course.length - 1);
  const camNext = computeCameraParams(course, { curIdx: nextIdx }, { userZoom, userPitch, lookAhead: 5 });
  let bearingDiff = ((camNext.bearing - cam.bearing + 540) % 360) - 180;
  const courseBearing = cam.bearing + bearingDiff * pos.fracInSegment;
  // user 横ドラッグ分を camera の旋回 offset として加算 (= rider 進行方向には足し込まない).
  const smoothBearing = (courseBearing + userBearingOffset + 360) % 360;
  // 豆腐 (= rider polygon) の向きは進行方向で固定、 camera だけが offset を反映.
  const riderHeadingRad = (courseBearing + 360) % 360 * Math.PI / 180;

  // rider 立体を rider 位置 + 進行方向 + スピン角で更新. spinAngle は rider.tick 内で
  // cadence rpm に応じて自動進行済 (= rider.spinAngle で取り出す、 viewer 側の累積管理 不要).
  // brief b2 Critical-1: rider GeoJSON の再構築 + GPU 再アップロード (setData) は
  // source 全体を再パース・再 tessellate・再 buffer する重い処理。 位置 / 向き /
  // スピンが前フレームから動いた時だけ実行し、 停止中は丸ごと skip する。
  const ridSrc = map.getSource && map.getSource('rider');
  if (ridSrc) {
    const riderFrame = { lat: rLat, lon: rLon, heading: riderHeadingRad, spin: snap.spinAngle };
    if (riderFrameChanged(_lastRiderFrame, riderFrame)) {
      ridSrc.setData(buildRiderFeatures(rLat, rLon, riderHeadingRad, snap.spinAngle));
      _lastRiderFrame = riderFrame;
    }
  }

  // camera は ride active 時だけ jumpTo (= 待機中は map state を動かさず idle 発火を許可、
  // 「描画準備中」インジケータの解除トリガに干渉しない).
  // 2026-05-16 fix: map idle 発火済 (= mapFullyLoaded=true) なら ride 未開始でも jumpTo OK、
  // user 「マウス左右で camera が回らない」 報告への対応 (= ride 開始前でも mouse drag 反映).
  if (course.length > 0 && (snap.active || mapFullyLoaded)) {
    map.jumpTo({ ...cam, center: [rLon, rLat], bearing: smoothBearing });
  }

  if (rideStartedAt !== null) {
    const sec = Math.floor((performance.now() - rideStartedAt) / 1000);
    setText('elapsed', `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`);
  } else setText('elapsed', '00:00:00');

  setText('dist', curDist.toFixed(0));
  setText('ele', rEle.toFixed(0));
  // rider 追随 HUD の slope は常時更新 (= state push に依存せず Terrain 経由で取得).
  setText('r-slope', pos.slope_pct.toFixed(1));
  // 豆腐の下に #rider-hud を追随表示。 rider の地理座標を screen pixel に project、
  // body class が state-riding の時のみ表示。
  const riderHud = document.getElementById('rider-hud');
  if (riderHud && document.body.classList.contains('state-riding')) {
    const pt = map.project([rLon, rLat]);
    riderHud.style.display = 'block';
    riderHud.style.left = `${pt.x}px`;
    riderHud.style.top = `${pt.y + 30}px`;  // 豆腐の下 30px (= polygon height + 余白)
  } else if (riderHud) {
    riderHud.style.display = 'none';
  }
  // デバッグ: 現在の camera zoom / pitch を HUD に表示 (user が好みの値を確認 → default 化に使う)
  setText('cam-zoom', map.getZoom().toFixed(2));
  setText('cam-pitch', map.getPitch().toFixed(0));
  // 2026-05-16: ?debug=1 用の数値 dump (= body.debug-on で右上 panel に表示).
  // user 「座標が外れる」「慣性力おかしい」 を走行中に数値で目視できる. setText は要素無しでも noop.
  // brief b2 High-4: ?debug=1 の時だけ実行 (= 平時は getElementById + textContent + trkpt
  // 走査の毎フレーム 30 件超を丸ごと skip)。
  if (DEBUG_HUD) {
  const mapCenter = map.getCenter();
  const EARTH_M_PER_DEG_DBG = 111000;
  const cosLatDbg = Math.cos(rLat * Math.PI / 180);
  const dxDbg = (mapCenter.lng - rLon) * EARTH_M_PER_DEG_DBG * cosLatDbg;
  const dzDbg = (mapCenter.lat - rLat) * EARTH_M_PER_DEG_DBG;
  const camDriftM = Math.sqrt(dxDbg * dxDbg + dzDbg * dzDbg);
  const dtMs = dt * 1000;
  setText('d-rider-lat', rLat.toFixed(7));
  setText('d-rider-lon', rLon.toFixed(7));
  setText('d-cam-lat', mapCenter.lat.toFixed(7));
  setText('d-cam-lon', mapCenter.lng.toFixed(7));
  setText('d-cam-drift', camDriftM.toFixed(2));
  setText('d-dist', curDist.toFixed(1));
  setText('d-speed', snap.speed.toFixed(3));
  setText('d-speed-kmh', (snap.speed * 3.6).toFixed(1));
  setText('d-seg', String(pos.segmentIdx));
  setText('d-frac', pos.fracInSegment.toFixed(3));
  setText('d-slope', pos.slope_pct.toFixed(2));
  setText('d-brng', smoothBearing.toFixed(1));
  setText('d-dt', dtMs.toFixed(1));
  setText('d-fps', dtMs > 0 ? (1000 / dtMs).toFixed(0) : '--');
  setText('d-pow', currentPower != null ? String(currentPower) : '--');
  setText('d-cad', currentCadence != null ? String(currentCadence) : '--');
  // 2026-05-16 user 要望: 走行中 trkpt 蓄積状態を debug HUD に出す.
  // 0km 起点固定 bug (= commit de57ce1) の即時検出 + power/cad/hr 欠損率の visibility.
  // 2 時間走って保存壊れる事故再演防止のため、 走行中に「異常パターン」 を user が目視できる.
  try {
    const trkpts = rideState && typeof rideState.getTrkpts === 'function' ? rideState.getTrkpts() : [];
    const tn = trkpts.length;
    if (tn > 0) {
      const uniqLat = new Set(trkpts.map((p) => p.lat)).size;
      const firstLat = trkpts[0].lat;
      const lastLat = trkpts[tn - 1].lat;
      const spread = Math.abs(lastLat - firstLat);
      setText('d-trkn', String(tn));
      setText('d-trkuniq', String(uniqLat));
      setText('d-trkspread', spread.toFixed(6));
      // 異常検出: trkpt 60 件超えで lat unique 数 5 未満 / 累積距離 10m 未満 / spread 1e-5 未満 → 警告.
      const checks = [];
      if (tn >= 60 && uniqLat < 5) checks.push('!起点固定疑い');
      if (tn >= 60 && curDist < 10) checks.push('!距離 0 疑い');
      if (tn >= 60 && spread < 1e-5) checks.push('!lat 不動疑い');
      const powN = trkpts.filter((p) => Number.isFinite(p.power)).length;
      if (tn >= 60 && powN < tn * 0.5) checks.push('!power 欠損 50%超');
      const hrN = trkpts.filter((p) => Number.isFinite(p.hr)).length;
      if (tn >= 120 && hrN < tn * 0.5) checks.push('!hr 欠損 50%超');
      const dEl = document.getElementById('d-chk');
      if (dEl) {
        if (checks.length === 0) {
          dEl.textContent = '✓ ok';
          dEl.style.color = '#7fff00';
        } else {
          dEl.textContent = checks.join(' ');
          dEl.style.color = '#ff5050';
        }
      }
    } else {
      setText('d-trkn', '0');
      setText('d-trkuniq', '--');
      setText('d-trkspread', '--');
      setText('d-chk', '(ride 未開始)');
    }
  } catch (_e) { /* validation は best-effort、 落ちても ride を止めない */ }
  }  // end if (DEBUG_HUD)
  // brief 35 同型 bug 修正: 旧 viewer は riderHeadingRad を計算しつつ updateMinimap に
  // `headingRad` (= 未定義) を渡していた、 runtime ReferenceError. jsdom test 環境で tick が
  // 走らないため source-grep が通り続けていた dead bug. minimap には rider 進行方向を渡す.
  updateMinimap(curDist, rEle, rLat, rLon, riderHeadingRad);
  const dispKmh = snap.speed * speedMult * 3.6;
  const connected = !!(client && client.isOpen());
  setText('speed', snap.paused ? (connected ? '待機中' : 'paused') : `${dispKmh.toFixed(1)} km/h${connected ? ' (bridge)' : ' (demo)'}`);

  if (!snap.paused) maybeSendSlope(pos.slope_pct);
  if (snap.active && !snap.paused && connected) {
    const now = performance.now();
    if (now - lastPositionSendT >= POSITION_SEND_INTERVAL_MS) {
      client.sendPosition(curDist, rLat, rLon, rEle);
      lastPositionSendT = now;
    }
  }
  // brief 33: ride 中 1Hz で trkpt 蓄積 (= GPX / Strava upload / IndexedDB 履歴の元データ).
  // connected 不要 (= TEST_MODE / MAP_MODE / BLE / static でも本人 ride の trkpt は溜める).
  // brief 35: rideState.appendTrkpt は legacy raw point ベース、 shim の grep gate 通過に必要.
  if (snap.active && !snap.paused) {
    const nowT = performance.now();
    if (nowT - lastTrkptT >= 1000) {
      rideState.appendTrkpt({
        t: new Date().toISOString(),
        power: currentPower,
        cad: currentCadence,
        hr: currentHr,
      });
      lastTrkptT = nowT;
    }
    // autosave: 30 秒毎に IndexedDB へ進行状態を save.
    if (nowT - lastAutosaveT >= 30000) {
      const trkpts = rideState.getTrkpts();
      saveAutosave({
        rideStartedAt: rideStartedIso || new Date().toISOString(),
        distanceM: snap.distance,
        courseName: 'fujihill',
        trkpts,
      }).catch((err) => console.warn('autosave failed:', err));
      lastAutosaveT = nowT;
    }
  }
  if (!rider.atGoal) {
    requestAnimationFrame(tick);
  } else {
    // 2026-05-15 fix: 完走時に手動で「ライド終了」 button を押さないと postride に
    // 行けない bug を解消。 atGoal 到達で 1 度だけ自動的に rideState.end + sendRideEnd
    // (= btnRideEnd の click と同経路) を発火、 ride_status('ended') → showPostride。
    // _autoEnded flag で再発火を防止 (= ride 再開しない限り 2 回目は呼ばない).
    status('完走');
    if (!_autoEnded) {
      _autoEnded = true;
      if (rideState) rideState.end();
      if (client && client.isOpen()) client.sendRideEnd();
    }
  }
}
let _autoEnded = false;

// ボタン bind
document.getElementById('btnPause').addEventListener('click', () => { if (rideState) rideState.togglePause(); });
// brief 34 ε-3: 公開ガードレール ride consent guard.
// btnRideStart の click handler に guard を挿入: ride 機能の使用同意を取っていない
// (= getRideConsent('asked') が false) なら consent-overlay を表示して return、
// rideState.start を呼ばない。 consent ダイアログで「同意して ride 開始」を押すと
// asked=true + history/strava flag を保存 + 再度 btnRideStart の click を発火させる。
// btnConfirmDemo (= デモ走行 button、 viewer-maplibre.js:1353-1359) は consent 不要
// = 履歴も Strava も使わない declaration として扱う (= v3 設計通り)。
function startRideConfirmed() {
  if (!client || !client.isOpen()) return;
  if (rideState) rideState.start();
  lastT = performance.now(); lastPositionSendT = 0; lastTrkptT = 0;
  lastAutosaveT = performance.now();  // autosave 30 秒 cadence をリセット
  rideStartedIso = new Date().toISOString();  // autosave に保存する ride 開始時刻
  _autoEnded = false;  // 2026-05-15: 完走自動終了 flag を ride 開始毎にリセット
  client.sendRideStart();
}
document.getElementById('btnRideStart').addEventListener('click', () => {
  // brief 34 ε-9: 地形 load 未完なら何もしない (= disabled 二重 gate).
  if (!terrainReady) return;
  if (!client || !client.isOpen()) return;
  // preflight check: 開始前に validation panel を出す。 結果 OK / warn なら user 同意で開始、
  // fail なら開始 button disable。 ?nopreflight=1 で skip (= 開発/test 用 bypass).
  const params = new URLSearchParams(location.search);
  if (params.get('nopreflight') === '1') {
    startRideConfirmed();
    return;
  }
  showPreflightAndStart();
});

async function showPreflightAndStart() {
  let pastRides = [];
  try {
    const db = await getRideDb();
    pastRides = await rideDbList(db);
  } catch { /* DB 開けなくても preflight 自体は出す (= IndexedDB check が fail を返す) */ }
  const result = await runPreflight({
    course,
    trainer: {
      connected: !!(client && client.isOpen()),
      power: Number.isFinite(currentPower) ? currentPower : null,
      cadence: Number.isFinite(currentCadence) ? currentCadence : null,
      hr: Number.isFinite(currentHr) ? currentHr : null,
    },
    pastRides,
    consent: {
      history: getRideConsent('history'),
      strava: getRideConsent('strava'),
    },
  });
  renderPreflightPanel({
    result,
    onStart: () => { startRideConfirmed(); },
    onCancel: () => { /* no-op、 user が pair 画面に戻る */ },
  });
}
document.getElementById('btnRideEnd').addEventListener('click', () => {
  if (!client || !client.isOpen()) return;
  if (rideState) rideState.end();
  client.sendRideEnd();
});
document.getElementById('btnScan').addEventListener('click', () => {
  // brief 34 ε-9: 地形 load 未完なら何もしない.
  if (!terrainReady) return;
  scanMode = 'ftms';
  setText('scan-mode-label', '(trainer モード)');
  if (client && client.isOpen()) client.sendScan();
});
document.getElementById('btnScanHrm').addEventListener('click', () => {
  // brief 34 ε-9: 地形 load 未完なら何もしない.
  if (!terrainReady) return;
  scanMode = 'hrm';
  setText('scan-mode-label', '(心拍計モード)');
  if (client && client.isOpen()) client.sendScan();
});
// 2026-05-15 fix: btnSkip 撤去 (7e14ac3) で HTML 側 button は消えたが、 viewer 側の
// bind 行が残っていたため getElementById('btnSkip') が null を返し、 ここで
// throw → 以降の全 bind (= btnCopyPath / btnBackToPairing / bindPostRideButtons 等)
// が走らず、 ライド保存ダイアログの button が全部反応しなくなる事故が起きた。
// 撤去済の button への bind を削除。
document.getElementById('btnConfirmDemo').addEventListener('click', () => {
  hideConfirm(); hidePairing();
  // brief 35: 旧 playSpeed module global は廃止、 rider.setSpeed が唯一の入口.
  if (rider) rider.setSpeed(20 / 3.6);
  if (rideState) rideState.start();
  lastT = performance.now();
  status('デモモード (記録は保存されません)');
});
document.getElementById('btnCancelDemo').addEventListener('click', () => { hideConfirm(); });
// 2026-05-15 fix: 「パスをコピー」 button は旧 bridge mode で GPX のローカル保存パスを
// コピーする用途だった。 blob download 化で path 表示が無意味になったため撤去。
// 同様に「続けてもう一度」 は「閉じる」 にリネーム (= postride を畳んで pair に戻る).
document.getElementById('btnBackToPairing').addEventListener('click', () => {
  hidePostride(); setAppState('pairing'); showPairing();
  if (rideState) rideState.reset();
  updateStepIndicator(-1, 3);
  const b = document.getElementById('btnRideStart'); if (b && !b.disabled) requestAnimationFrame(() => b.focus());
});
document.getElementById('btnOpenPairing').addEventListener('click', () => { showPairing(); });
document.getElementById('btnClosePairing').addEventListener('click', () => {
  document.getElementById('setup-overlay').classList.remove('visible');
});

function bindSlider(rangeId, valId, store, applyFn) {
  const r = document.getElementById(rangeId); const v = document.getElementById(valId);
  if (!r || !v) return;
  applyFn(parseFloat(r.value));
  r.addEventListener('input', () => { const pct = parseFloat(r.value); applyFn(pct); try { localStorage.setItem(store, String(pct / 100)); } catch {} });
}
const rDiff = document.getElementById('rngDiff'); const rSpd = document.getElementById('rngSpd');
if (rDiff) rDiff.value = String(Math.round(diffMult * 100));
if (rSpd) rSpd.value = String(Math.round(speedMult * 100));
bindSlider('rngDiff', 'diffVal', 'fujihill.diff', (pct) => { diffMult = pct / 100; setText('diffVal', String(Math.round(pct))); lastSlopeSent = null; });
bindSlider('rngSpd', 'spdVal', 'fujihill.spd', (pct) => { speedMult = pct / 100; setText('spdVal', (pct / 100).toFixed(2)); });
// 2026-05-17: 慣性 slider はフライホイール慣性 (kg 相当) を指す。 bindSlider は値を pct/100 で
// 保存する設計なので kg 値には使えない、 専用 binding にする。 slider は 0..3000 kg、 step 50。
const rIner = document.getElementById('rngInertia');
if (rIner) {
  rIner.value = String(inertiaKg);
  setText('inertiaVal', String(Math.round(inertiaKg)));
  rIner.addEventListener('input', () => {
    const kg = parseFloat(rIner.value);
    if (Number.isFinite(kg)) {
      inertiaKg = kg;
      setText('inertiaVal', String(Math.round(kg)));
      try { localStorage.setItem('fujihill.inertiaKg', String(kg)); } catch {}
    }
  });
}

// 2026-05-17: 慣性シミュと同じ 質量 / 転がり抵抗 / 空気抵抗 slider。 slider 生値と物理値を
// scale 変換し、 物理値を localStorage 保存。 wsHandlers.state の applyPhysicsStep opts に効く。
function bindBikeSlider(rangeId, valId, storeKey, physToRaw, rawToPhys, fmt, setGlobal, phys) {
  const r = document.getElementById(rangeId);
  if (!r) return;
  r.value = String(physToRaw(phys));
  setText(valId, fmt(physToRaw(phys)));
  r.addEventListener('input', () => {
    const raw = parseFloat(r.value);
    if (!Number.isFinite(raw)) return;
    const p = rawToPhys(raw);
    setGlobal(p);
    setText(valId, fmt(raw));
    try { localStorage.setItem(storeKey, String(p)); } catch {}
  });
}
bindBikeSlider('rngMass', 'massVal', 'fujihill.mass',
  (p) => Math.round(p), (r) => r, (r) => String(Math.round(r)), (p) => { bikeMass = p; }, bikeMass);
bindBikeSlider('rngRr', 'rrVal', 'fujihill.crr',
  (p) => Math.round(p * 1000), (r) => r / 1000, (r) => String(Math.round(r)), (p) => { bikeCrr = p; }, bikeCrr);
bindBikeSlider('rngCda', 'cdaVal', 'fujihill.cda',
  (p) => Math.round(p * 100), (r) => r / 100, (r) => (r / 100).toFixed(2), (p) => { bikeCda = p; }, bikeCda);

// 光源 (hillshade) slider: 方向 0..360° / 強度 0..100 (MapLibre 0..1 を ×100).
// setPaintProperty で live 更新、 デバッグ表示も同時。
function applyLightDir(deg) {
  setText('lightDirVal', String(Math.round(deg)));
  setText('dbgLightDir', String(Math.round(deg)));
  if (map && map.getLayer && map.getLayer('hillshade')) {
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', deg);
  }
}
function applyLightStr(pct) {
  const exag = pct / 100;
  setText('lightStrVal', String(Math.round(pct)));
  setText('dbgLightExag', exag.toFixed(2));
  if (map && map.getLayer && map.getLayer('hillshade')) {
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', exag);
  }
}
const rLightDir = document.getElementById('rngLightDir');
if (rLightDir) rLightDir.addEventListener('input', () => applyLightDir(parseFloat(rLightDir.value)));
const rLightStr = document.getElementById('rngLightStr');
if (rLightStr) rLightStr.addEventListener('input', () => applyLightStr(parseFloat(rLightStr.value)));

// brief 26b: dbinit-overlay buttons
const btnFetchGsi = document.getElementById('btnFetchGsi');
if (btnFetchGsi) btnFetchGsi.addEventListener('click', startGsiFetch);
const btnExtractOsm = document.getElementById('btnExtractOsm');
if (btnExtractOsm) btnExtractOsm.addEventListener('click', startOsmExtract);
const btnDbinitSkip = document.getElementById('btnDbinitSkip');
if (btnDbinitSkip) btnDbinitSkip.addEventListener('click', skipDbinit);
// 2026-05-15 fix: 明示出口 2 種を bind (= 「▶ 機器選択へ進む」「× 閉じる」、 user 指摘反映).
const btnDbinitProceed = document.getElementById('btnDbinitProceed');
if (btnDbinitProceed) btnDbinitProceed.addEventListener('click', proceedFromDbinit);
const btnDbinitClose = document.getElementById('btnDbinitClose');
if (btnDbinitClose) btnDbinitClose.addEventListener('click', closeDbinit);

// brief 33: ride 履歴 + Strava 連携 button bind.
// IndexedDB は遅延 open (= ride 終了 / 履歴 open 時に初めて開く、 起動時に open しない).
let _rideDbInstance = null;
async function getRideDb() {
  if (_rideDbInstance) return _rideDbInstance;
  try { _rideDbInstance = await openRideDb(); } catch (err) { console.warn('openRideDb failed:', err); throw err; }
  return _rideDbInstance;
}

// fujihill-trainer の Strava client_id は user 各自が自分の Strava app を作って setup する運用.
// repo に固定 client_id は埋め込まない (= 各 user の activity が混線しない、 brief 33 §ハマる罠).
// localStorage 'fujihill.strava.client_id' に user が貼る、 未設定なら upload button が status を出す.
function getStravaClientId() {
  try { return localStorage.getItem('fujihill.strava.client_id') || null; } catch { return null; }
}
function getStravaRedirectUri() {
  // GitHub Pages base + oauth-callback.html (= same-origin、 PKCE redirect 先)
  const base = location.pathname.replace(/\/[^/]*$/, '/');
  return `${location.origin}${base}oauth-callback.html`;
}

function setPostrideStatus(text) {
  const el = document.getElementById('postride-upload-status');
  if (el) el.textContent = String(text || '');
}

function buildRideSummary(rideState, course) {
  const snap = rideState ? rideState.snapshot() : { distance: 0 };
  return {
    id: `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 5)}`,
    date: new Date().toISOString(),
    distance_m: snap.distance || 0,
    duration_s: rideStartedAt ? Math.round((performance.now() - rideStartedAt) / 1000) : 0,
    elevation_gain_m: 0,  // TODO: course から差分計算 (= 別 brief、 brief 33 範囲外)
    avg_power_w: null,
    course_name: 'fujihill',
  };
}

bindPostRideButtons({
  getTrkpts: () => (rideState ? rideState.getTrkpts() : []),
  getSummary: () => buildRideSummary(rideState, []),
  getCourseName: () => 'fujihill',
  // brief 34 ε-3: IndexedDB 書込を consent flag で guard (= history consent off なら no-op).
  // brief 34 ε-8: 「観る」モード (= intro consent mode === 'view') も二重 guard (= 観るは記録対象外).
  // 2026-05-15 fix: 保存できなかった時は false を返して caller (= postride_buttons.js) 側で
  // 「履歴に保存しました」の overwrite を抑止する (= 旧 実装は silent skip でも success 文言
  // を上書きしてしまい、 user が「保存できたつもり」になる bug があった).
  // 2026-05-15 fix: 履歴同意 gate を廃止。 観るモードだけは記録対象外で残す
  // (= 区間勾配を眺めるための仮想 ride、 走行記録ではない).
  addRide: async (rec) => {
    const ic = getIntroConsent();
    if (ic && ic.mode === 'view') {
      setPostrideStatus('観るモードは記録対象外です (= 走行ログ保存なし).');
      return false;
    }
    const db = await getRideDb();
    await rideDbAdd(db, rec);
    return true;
  },
  // brief 34 ε-3: Strava 機能を consent flag で guard (= strava consent off なら client_id を返さない).
  // brief 34 ε-8: 「観る」モードも上書きで disable (= 観るは Strava upload 対象外).
  // getClientId が null を返せば postride_buttons.js 側で「client_id 未設定」の status が出る。
  // 2026-05-15 fix: Strava 同意 gate を廃止。 観るモードだけは Strava 非対応で残す。
  // user が「Strava にアップロード」 button を押した事自体が意思表示。
  getClientId: () => {
    const ic = getIntroConsent();
    if (ic && ic.mode === 'view') return null;
    return getStravaClientId();
  },
  getRedirectUri: getStravaRedirectUri,
  onViewHistory: () => { showHistoryOverlay().catch((err) => setPostrideStatus(`history error: ${err.message}`)); },
  onStatus: setPostrideStatus,
});

// brief 34 ε-3: Strava upload / save history button を consent flag で表示制御 (= 視覚的にも明示).
// ride 開始時の consent で OFF を選んだ場合、 postride で混乱しないよう button を hide。
// consent 未取得 (= setup-overlay 経由で未走) の場合は default で hide (= 安全寄り).
function updatePostrideButtonVisibility() {
  const histOk = getRideConsent('history');
  const stravaOk = getRideConsent('strava');
  const btnSave = document.getElementById('btnSaveHistory');
  const btnStrava = document.getElementById('btnStravaUpload');
  if (btnSave) btnSave.hidden = !histOk;
  if (btnStrava) btnStrava.hidden = !stravaOk;
}
updatePostrideButtonVisibility();

// brief 33 atom H: history-overlay の render + button bind.
async function showHistoryOverlay() {
  setAppState('history');
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const status = document.getElementById('history-status');
  if (!list) return;
  list.replaceChildren();
  let rides = [];
  try { const db = await getRideDb(); rides = await rideDbList(db); }
  catch (err) { if (status) status.textContent = `読み込み失敗: ${err.message}`; return; }
  if (rides.length === 0) {
    if (empty) empty.hidden = false;
    if (status) status.textContent = '';
    return;
  }
  if (empty) empty.hidden = true;
  if (status) status.textContent = `${rides.length} 件`;
  for (const r of rides) {
    appendHistoryRow({
      document,
      listEl: list,
      ride: r,
      courseName: 'fujihill',
      onDelete: async () => {
        try { const db = await getRideDb(); await rideDbDelete(db, r.id); showHistoryOverlay(); }
        catch (err) { if (status) status.textContent = `削除失敗: ${err.message}`; }
      },
      onGpxDownloaded: ({ filename, points }) => {
        if (status) status.textContent = `${filename} を保存しました (${points} 点)`;
      },
    });
  }
}

const btnHistoryClose = document.getElementById('btnHistoryClose');
if (btnHistoryClose) btnHistoryClose.addEventListener('click', () => {
  setAppState('pairing'); showPairing();
});
const btnViewHistoryFromSetup = document.getElementById('btnViewHistoryFromSetup');
if (btnViewHistoryFromSetup) btnViewHistoryFromSetup.addEventListener('click', () => { showHistoryOverlay(); });

// Strava 連携 / 解除 button (= setup-overlay 内)
function updateStravaStatusUI() {
  const status = document.getElementById('strava-status');
  const btnConn = document.getElementById('btnStravaConnect');
  const btnDis = document.getElementById('btnStravaDisconnect');
  let tok = null;
  try { tok = localStorage.getItem(STRAVA_TOKEN_LS_KEY); } catch {}
  if (tok) {
    if (status) status.textContent = '連携済 (= access_token あり)';
    if (btnDis) btnDis.hidden = false;
    if (btnConn) btnConn.textContent = '再連携';
  } else {
    if (status) status.textContent = '未連携';
    if (btnDis) btnDis.hidden = true;
    if (btnConn) btnConn.textContent = 'Strava と連携';
  }
}
updateStravaStatusUI();

async function startStravaOAuth(clientId) {
  // 共通の OAuth 開始処理 (= client_id が確定済の前提)。
  const { makeCodeVerifier, makeCodeChallenge, buildAuthorizeUrl,
          STRAVA_PKCE_VERIFIER_SS_KEY, STRAVA_PKCE_CLIENT_ID_SS_KEY } =
    await import('./lib/strava_oauth.js');
  const verifier = makeCodeVerifier();
  const challenge = await makeCodeChallenge(verifier);
  sessionStorage.setItem(STRAVA_PKCE_VERIFIER_SS_KEY, verifier);
  sessionStorage.setItem(STRAVA_PKCE_CLIENT_ID_SS_KEY, String(clientId));
  const url = buildAuthorizeUrl({ clientId, redirectUri: getStravaRedirectUri(), codeChallenge: challenge });
  location.assign(url);
}

const btnStravaConnect = document.getElementById('btnStravaConnect');
if (btnStravaConnect) btnStravaConnect.addEventListener('click', async () => {
  let clientId = getStravaClientId();
  if (!clientId) {
    // 2026-05-15 fix: client_id 未設定なら setup overlay (= 案内 + 手順 + リンク + 入力欄) を表示。
    // 過去 prompt() 案は「Client ID って何」が訪問者に伝わらず無意味、 専用 overlay で UX 完結。
    const ov = document.getElementById('strava-setup-overlay');
    if (ov) {
      ov.style.display = 'flex';
      const inp = document.getElementById('stravaClientIdInput');
      if (inp) { inp.value = ''; inp.focus(); }
    }
    return;
  }
  // 既に client_id がある場合は直接 OAuth へ
  await startStravaOAuth(clientId);
});

// setup-overlay 「保存して連携」ボタン: client_id を localStorage に保存して OAuth へ
const btnStravaSetupSave = document.getElementById('btnStravaSetupSave');
if (btnStravaSetupSave) btnStravaSetupSave.addEventListener('click', async () => {
  const inp = document.getElementById('stravaClientIdInput');
  const v = inp ? String(inp.value || '').trim() : '';
  if (!v) {
    if (inp) inp.focus();
    return;
  }
  try { localStorage.setItem('fujihill.strava.client_id', v); } catch {}
  const ov = document.getElementById('strava-setup-overlay');
  if (ov) ov.style.display = 'none';
  updateStravaStatusUI();
  await startStravaOAuth(v);
});

// setup-overlay 「キャンセル」ボタン: overlay を閉じるだけ
const btnStravaSetupCancel = document.getElementById('btnStravaSetupCancel');
if (btnStravaSetupCancel) btnStravaSetupCancel.addEventListener('click', () => {
  const ov = document.getElementById('strava-setup-overlay');
  if (ov) ov.style.display = 'none';
});

const btnStravaDisconnect = document.getElementById('btnStravaDisconnect');
if (btnStravaDisconnect) btnStravaDisconnect.addEventListener('click', () => {
  revokeLocalToken();
  updateStravaStatusUI();
});

// brief 34 ε-5: 「このサイトの全データを削除」フロー.
// btnClearAllData click → clear-confirm-overlay 表示 → 確認 → clearAllLocalData 実行 →
// clear-done-overlay 表示 → OK で intro overlay からやり直し.
function showClearConfirm() {
  const ov = document.getElementById('clear-confirm-overlay');
  if (ov) ov.style.display = 'flex';
}
function hideClearConfirm() {
  const ov = document.getElementById('clear-confirm-overlay');
  if (ov) ov.style.display = 'none';
}
function showClearDone(statusText) {
  const ov = document.getElementById('clear-done-overlay');
  const st = document.getElementById('clear-done-status');
  if (st && statusText) st.textContent = statusText;
  if (ov) ov.style.display = 'flex';
}
function hideClearDone() {
  const ov = document.getElementById('clear-done-overlay');
  if (ov) ov.style.display = 'none';
}

const btnClearAllData = document.getElementById('btnClearAllData');
if (btnClearAllData) btnClearAllData.addEventListener('click', () => { showClearConfirm(); });

const btnClearCancel = document.getElementById('btnClearCancel');
if (btnClearCancel) btnClearCancel.addEventListener('click', () => { hideClearConfirm(); });

const btnClearConfirm = document.getElementById('btnClearConfirm');
if (btnClearConfirm) btnClearConfirm.addEventListener('click', async () => {
  hideClearConfirm();
  let msg = 'IndexedDB と localStorage が空になりました。';
  try {
    const res = await clearAllLocalData();
    const parts = [];
    parts.push(res.indexedDb.deleted ? 'IndexedDB: OK' : `IndexedDB: ${res.indexedDb.error || 'failed'}`);
    parts.push(res.localStorage.cleared ? 'localStorage: OK' : `localStorage: ${res.localStorage.error || 'failed'}`);
    msg = parts.join(' / ');
  } catch (err) {
    msg = `削除失敗: ${err && err.message ? err.message : String(err)}`;
  }
  showClearDone(msg);
});

const btnClearDoneOk = document.getElementById('btnClearDoneOk');
if (btnClearDoneOk) btnClearDoneOk.addEventListener('click', () => {
  hideClearDone();
  // intro overlay からやり直し (= consent が削除済なので introConsented() === false).
  // 全 overlay を hide + setAppState('checking') + showIntroOverlay.
  document.getElementById('setup-overlay')?.classList.remove('visible');
  document.getElementById('postride-overlay')?.classList.remove('visible');
  document.getElementById('consent-overlay')?.classList.remove('visible');
  hideConsentOverlay();
  setAppState('checking');
  showIntroOverlay();
});

// oauth-callback.html から postMessage で完了通知が来る (= 別 tab 経路).
window.addEventListener('message', (ev) => {
  if (!ev || !ev.data || ev.data.type !== 'strava-oauth-done') return;
  if (ev.origin !== location.origin) return;  // same-origin only
  updateStravaStatusUI();
});
