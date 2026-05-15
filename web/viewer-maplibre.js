// fujihc viewer - MapLibre GL JS 試験版
// Cesium を廃止、 GSI 標高 + OSM raster で 3D 地形表示。
// addProtocol で GSI dem_png を terrarium 形式に変換して MapLibre の terrain に食わせる。
// brief 21: GSI 6m grid を bilinear 4x で 1.5m grid 等価に upsample、 ride 視点を滑らかに.

import { gsiToTerrariumUpsampled } from './lib/terrain_mesh.js';
// brief 23: GPS ジッター除去の moving average (= window 5、 短距離ジグザグ補正のみ)
import { smoothCourse } from './lib/gpx_smooth.js';
// brief 24 + 25: 勾配グレード別色分けで「一定幅の道路 polygon」として描画
import { buildGradeColoredRoadPolygons } from './lib/road_polygon.js';
// brief 19b: WebSocket / ride state / camera を lib に集約
import { createBridgeClient, createTestModeClient } from './lib/ws_client.js';
import { createBleClient, isWebBluetoothSupported } from './lib/ble_client.js';
import { createRideState } from './lib/ride_state.js';
import { computeCameraParams, adjustZoom, adjustPitch } from './lib/camera_controller.js';
// brief 29: minimap 上半分の OSM タイル 1-shot fetch 用の tile 座標変換
// (= 旧 inline 定義を web/lib/tile_math.js に切り出し済、 ride hot path には使わない)
import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from './lib/tile_math.js';
// brief 31: pmtiles:// protocol を MapLibre に登録 (= GitHub Pages 静的 mode 用)。
// vendored pmtiles.js は web/lib/vendor/pmtiles.js (BSD-3-Clause)、 index.html の
// <script> で window.pmtiles を IIFE 化、 ここでは window 経由で参照する。
import { registerPmtilesProtocol } from './lib/pmtiles_loader.js';
// brief 33: ride 終了時の 4 button bind (= GPX download / Strava upload / 履歴に保存 / 履歴を見る).
// IndexedDB 履歴 / Strava OAuth / 一覧 UI を viewer 側 inline 化せず module 経由で呼ぶ
// (= NG-R1-7 同型予防、 4 module 分離).
import { bindPostRideButtons } from './lib/postride_buttons.js';
import { openRideDb, addRide as rideDbAdd, listRides as rideDbList, deleteRide as rideDbDelete } from './lib/ride_db.js';
import { ensureAccessToken, revokeLocalToken, STRAVA_TOKEN_LS_KEY } from './lib/strava_oauth.js';

// upsample 倍率. 4 で 256x256 -> 1024x1024 (= 1.5m grid 等価, VRAM 9 タイル × 4 MB).
// 8 にすると VRAM 4 倍 (= 144 MB) で実用範囲、 ただし bilinear で新情報は出ないので過剰.
const TERRAIN_UPSAMPLE_FACTOR = 4;

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
// - BASE_PATH: GitHub Pages の project page prefix (= /fujihc-trainer/) 追従、
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
          resolve({ data: new Uint8Array(buf) });
        }).catch(reject);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('GSI tile load failed: ' + url));
    img.src = url;
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

export function buildMapStyle(env) {
  // brief 31 commit β: env (= immutable ENV object) 受け、 bridgeReachable は env.mode で判定。
  // 後方互換のため `{bridgeReachable: bool}` を渡されても動く (= env.bridgeReachable / env.mode は
  // 同一 ENV object で同期、 旧 caller を破壊しない signature 拡張)。
  const bridgeReachable = env && (env.mode === 'bridge' || env.bridgeReachable === true);
  // bridge mode: 個別 PBF / PNG file ツリーを localhost /tiles から fetch (= 従来)。
  // static mode: PMTiles 単一 file (pmtiles:// scheme) + ${BASE_PATH}static/tiles/gsi_dem 配下 PNG。
  const sources = bridgeReachable
    ? {
        'osm': {
          type: 'vector',
          tiles: [`${BRIDGE_TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf`],
          minzoom: 13,
          maxzoom: 15,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${BRIDGE_TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
          attribution: '国土地理院 標高タイル',
          volatile: false,
        },
      }
    : {
        'osm': {
          type: 'vector',
          url: `pmtiles://${STATIC_TILE_BASE_URL}/map.pmtiles`,
          attribution: '© OpenStreetMap contributors',
        },
        'gsi-terrain': {
          type: 'raster-dem',
          tiles: [`gsidem://${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png`],
          tileSize: 256,
          encoding: 'terrarium',
          minzoom: 8,
          maxzoom: 14,
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
    center: [138.7587, 35.4521],
    zoom: 13,
    pitch: 60,
    bearing: 0,
    // pitch を default 60 → 85 まで拡張、 zoom 上限も MapLibre の最大 22 まで開放
    maxPitch: 85,
    minPitch: 0,
    maxZoom: 24,
    minZoom: 13,
    // タイル memory cache. brief 21 で GSI dem を 4x upsample (1024x1024 RGBA = 4 MB/tile)、
    // 200 だと 800 MB VRAM 圧迫. 50 で 200 MB 上限、 ride viewport (= 9 タイル) には十分.
    maxTileCacheSize: 50,
    // タイルのクロスフェード短縮、 GPU 負荷軽減
    fadeDuration: 0,
  });
  map.on('load', () => {
    map.setTerrain({ source: 'gsi-terrain', exaggeration: 1.0 });
    status('map loaded');
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
  });
  map.on('error', (e) => {
    console.warn('maplibre error:', e && e.error);
  });
  return map;
}

let course = [];
let totalDist = 0;
let rideState = null;
let playSpeed = 0;
let lastT = performance.now();
let diffMult = (() => { try { return parseFloat(localStorage.getItem('fujihc.diff')) || 1.0; } catch { return 1.0; } })();
let speedMult = (() => { try { const v = parseFloat(localStorage.getItem('fujihc.spd')); return Number.isFinite(v) ? v : 1.0; } catch { return 1.0; } })();
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
// rider 上のスピナー (= プロペラ) の累積回転角、 cadence rpm に比例して進む
let spinAngle = 0;
// 最新の cadence (state push 経由)、 ride 中ペダル回ってない時は 0 で静止
let currentCadence = 0;
// brief 33: ride 中の最新 power / hr (= state push 経由、 trkpt 蓄積に使う)
let currentPower = 0;
let currentHr = 0;
// brief 33: 1Hz cadence で rideState.appendTrkpt するための前回 push 時刻
let lastTrkptT = 0;

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

function setupPitchDrag() {
  const mapEl = map.getContainer();
  let drag = null;
  mapEl.addEventListener('mousedown', (e) => {
    drag = { y: e.clientY, pitch: map.getPitch() };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    // マウスを下にドラッグで水平に近づける、 上にドラッグで真上へ。 感度は user 指示で 5 倍
    // 既存式: newPitch = drag.pitch - dy * 2.0、 adjustPitch(currentPitch, delta) で同じ結果に: delta = -dy * 2.0
    const newPitch = adjustPitch(drag.pitch, -dy * 2.0);
    userPitch = newPitch;
    map.setPitch(newPitch);
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
  document.body.className = `state-${s}`;
  updateStartGoalVisibility();
}
setAppState('checking');

// brief 26b: bridge への HTTP fetch base. WebSocket とは別経路 (= /tiles/* aiohttp app)。
const HTTP_BASE_URL = location.origin;

async function checkSetupStatus() {
  // brief 31: bridge 不在 (= GitHub Pages 等) 判定のため AbortSignal.timeout(500) を追加。
  // 戻り値に `bridgeReachable` flag (= bridge mode / static mode の単一判定軸) を含める。
  // 既存 caller (= showDbinit / maybeAdvanceToPairing) は `overall` のみ参照、 後方互換。
  try {
    const resp = await fetch(
      `${HTTP_BASE_URL}/tiles/_setup_status`,
      { signal: AbortSignal.timeout(500) },
    );
    // 200 OK: bridge 起動済 + DB 充足の通常応答
    // 503: bridge 起動済だが DB 未充足 (= dbinit 必要、 bridge 経路は使う)
    // 404 / その他 non-ok: 静的サーバ (= /tiles/_setup_status 不在) → static mode
    if (resp.status === 503) return { overall: 'empty', sources: {}, bridgeReachable: true };
    if (!resp.ok) return { overall: 'empty', sources: {}, bridgeReachable: false };
    const body = await resp.json();
    return { ...body, bridgeReachable: true };
  } catch (err) {
    // timeout / network error: bridge 未到達 = static mode 確定
    return { overall: 'empty', sources: {}, bridgeReachable: false };
  }
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
  const steps = ['step-scan', 'step-connect', 'step-handshake', 'step-ready'];
  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i <= doneIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// === WebSocket === (既存 viewer.js と同じ contract)
const WS_URL = 'ws://localhost:8765';
// brief 22: ?test=1 で trainer / bridge 不在の画面操作確認モード.
// WebSocket 接続を skip、 fake state を 1Hz で push、 ride/scan は即座に fake 応答.
// 起動例: python -m http.server -d web/ 8000 -> http://localhost:8000/?test=1
const TEST_MODE = new URLSearchParams(location.search).has('test');
// ?map=1 で UI 操作なしの「地図表示だけ」モード. TEST_MODE と同じく client は
// createTestModeClient、 加えて pairing overlay を即 hide + ride を自動 start.
// 用途: AI / 自動 capture で OSM/dem/polygon の visual 検証だけしたい時.
const MAP_MODE = new URLSearchParams(location.search).has('map');
// brief 32: ?ble=1 で Web Bluetooth 経由の直接 FTMS / HRM 接続モード.
// bridge.py 無し、 viewer から Web BT API (= ble_client.js 内に閉じる) で
// trainer / 心拍計と話す. iOS Safari / Firefox は非対応で fallback UI を出す.
const BLE_MODE = new URLSearchParams(location.search).has('ble');
let client = null;
let lastSlopeSent = null;
let lastSlopeSendT = 0;
const SLOPE_SEND_INTERVAL_MS = 1000;

const wsHandlers = {
  state(msg) {
    if (typeof msg.speed_mps === 'number') {
      const s = msg.speed_mps;
      if (Number.isFinite(s) && s >= 0 && s <= 25) playSpeed = s;
    }
    const pw = (msg.power_w != null) ? String(msg.power_w) : '--';
    const cd = (msg.cadence_rpm != null) ? msg.cadence_rpm.toFixed(0) : '--';
    if (typeof msg.cadence_rpm === 'number') currentCadence = msg.cadence_rpm;
    if (typeof msg.power_w === 'number') currentPower = msg.power_w;
    if (typeof msg.hr_bpm === 'number') currentHr = msg.hr_bpm;
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
      try { localStorage.setItem('fujihc.trainer.address', msg.address); } catch {}
      const startBtn = document.getElementById('btnRideStart');
      if (startBtn) { startBtn.disabled = false; requestAnimationFrame(() => startBtn.focus()); }
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
  ov.classList.add('visible');
  requestAnimationFrame(() => { const b = document.getElementById('btnCopyPath'); if (b) b.focus(); });
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
        const remembered = (() => { try { return localStorage.getItem('fujihc.trainer.address'); } catch { return null; } })();
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
  setText('setup-status', 'BLE モード: お使いの trainer / 心拍計を直接選んでください');
  setText('p-device', '(未接続)');
  setText('p-state', 'BLE 待機中');
  // 既存 setup-overlay の scan list (= bridge mode 専用) は隠し、 #ble-section を unhide.
  const bleSection = document.getElementById('ble-section');
  const scanBtnArea = document.getElementById('setup-buttons');
  if (bleSection) bleSection.hidden = false;
  if (scanBtnArea) scanBtnArea.hidden = true;

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
  if (btnTrainer) btnTrainer.addEventListener('click', () => { client && client.sendConnect(); });
  if (btnHrm) btnHrm.addEventListener('click', () => { client && client.sendHrmConnect(); });
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

// brief 26b: 起動時の DB 充足度チェック → 不足なら dbinit overlay、 ready なら従来 BLE.
// TEST_MODE は従来通り checking を skip (= ?test=1 は trainer / DB 不要 demo).
//
// brief 31: bridge 不在 (= s.bridgeReachable === false) なら static mode 確定、
// dbinit-overlay は出さず initMapMode() に直行 (= 視覚デモ完結)。
function bootCheckSetupStatus() {
  // brief 31 commit β: bootEnv() で ENV (= freeze 済 immutable env) を確定してから分岐。
  // 旧 `bootMap(false)` / `bootMap(true)` の bool 直渡しを廃止、 全部 env 経由で統一。
  bootEnv().then((env) => {
    if (env.mode === 'static') {
      // GitHub Pages 等、 bridge 未到達 = static mode、 MAP_MODE 相当に倒す。
      // dbinit-overlay は bridge mode 専用 (= 「bridge 立ち上げて」と促す UI)、
      // static mode では bridge.py 起動を促しても無意味なため一切表示しない。
      bootMap(env);
      initMapMode();
      return;
    }
    bootMap(env);
    const s = env.setupStatus;
    if (s.overall === 'ready') {
      setAppState('pairing');
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
if (MAP_MODE) initMapMode();
else if (TEST_MODE) initTestMode();
else if (BLE_MODE) initBleMode();
else bootCheckSetupStatus();

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
  // 「地形のみで進む」 = OSM 抽出を後回しにして BLE pairing flow に移る。
  // dbinit overlay を閉じて state-pairing へ、 setup-overlay は元から visible 維持。
  _advancedFromDbinit = true;
  hideDbinit();
  setAppState('pairing');
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
  rideState = createRideState(course);
  totalDist = course[course.length - 1].distance_m;
  setText('total', totalDist.toFixed(0));
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  // brief 24 + 25: 各 segment を 5m 幅の polygon に展開、 勾配グレード別色分け.
  // Zwift Climb Portal 風: flat=緑 / gentle=黄緑 / moderate=黄 / hard=橙 / very_hard=赤 / extreme=紫.
  if (!map.getSource('route')) {
    map.addSource('route', { type: 'geojson', data: buildGradeColoredRoadPolygons(course, 5) });
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

  // rider マーカー: fill-extrusion で本物の 3D 立体 (豆腐型)、 高さ方向に押し出した polygon。
  // rider 位置 + 進行方向で毎フレーム polygon coordinates を更新する。
  map.addSource('rider', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // 豆腐: 1m 角の直方体 1 個、 cyan (2026-05-15: 0.5m → 1.0m に拡大、 視認性向上)
  map.addLayer({
    id: 'rider-body',
    type: 'fill-extrusion',
    source: 'rider',
    paint: {
      'fill-extrusion-color': '#00ffff',
      'fill-extrusion-height': 1.0,
      'fill-extrusion-base': 0,
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
// User-Agent は browser が自動で送る (= bridge 側で fetch するときは fujihc-trainer/0.1 UA を明示)。
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
      // brief 30: 一次経路 (= DB cache) が 404/503 で空振ったら、 fallback で OSM 直叩き
      // (= 起動直後 / bridge 未起動 / cache 構築前)。 二度目の error は silent resolve.
      // ※ ここに来るのは bridge mode のみ (= 上の early return で static は除外済)。
      if (!tried) {
        tried = true;
        img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        return;
      }
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
function buildRiderFeatures(lat, lon, heading, spin) {
  const M_LAT = 1 / 111320;
  const M_LON = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const half = 0.5;
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  const verts = corners.map(([x, y]) => {
    const rx = x * cosH + y * sinH;
    const ry = -x * sinH + y * cosH;
    return [lon + rx * M_LON, lat + ry * M_LAT];
  });
  verts.push(verts[0]);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [verts] } }],
  };
}

// brief 29: 上下 2 canvas にそれぞれ base 画像を drawImage + rider 描画。
// 上半分: 180度回転後の座標で rider 三角形を描く (= 進行方向を画面下向きに)。
// 下半分: 標高プロファイル base 画像の上に rider 縦線 + dot。
function updateMinimap(curDistM, curEleM, curLat, curLon, heading) {
  if (!minimapStats) return;

  // 上半分: #minimap-top
  const topCanvas = document.getElementById('minimap-top');
  if (topCanvas && minimapTopBase && minimapStats.projectLatLon) {
    const tctx = topCanvas.getContext('2d');
    tctx.clearRect(0, 0, topCanvas.width, topCanvas.height);
    tctx.drawImage(minimapTopBase, 0, 0);
    // rider 三角形を 180度回転後の座標系で描画
    // (= base 画像が既に 180度回転済なので、 rider 位置も同じ rotate を適用する)
    const [rx, ry] = minimapStats.projectLatLon(curLat, curLon);
    const { W, H } = minimapStats.rotateTop;
    tctx.save();
    tctx.translate(W / 2, H / 2);
    tctx.rotate(Math.PI);
    tctx.translate(-W / 2, -H / 2);
    drawDirTriangle(tctx, rx, ry, heading, 9);
    tctx.restore();
  }

  // 下半分: #minimap-bottom
  const botCanvas = document.getElementById('minimap-bottom');
  if (!botCanvas || !minimapBottomBase) return;
  const ctx = botCanvas.getContext('2d');
  ctx.clearRect(0, 0, botCanvas.width, botCanvas.height);
  ctx.drawImage(minimapBottomBase, 0, 0);
  const { minE, maxE, totalD, PAD, botInnerW, botInnerH, botBaseY, botTopY } = minimapStats;
  const px = PAD + (curDistM / totalD) * botInnerW;
  const py = botBaseY - ((curEleM - minE) / (maxE - minE)) * botInnerH;
  ctx.strokeStyle = 'rgba(0,220,220,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, botTopY); ctx.lineTo(px, botBaseY); ctx.stroke();
  ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
}

function tick(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (!rideState) { requestAnimationFrame(tick); return; }
  rideState.advance(dt, playSpeed * speedMult);
  const snap = rideState.snapshot();
  const curIdx = snap.idx;
  const curDist = snap.distance;

  const p = course[curIdx];
  const pNext = course[Math.min(curIdx + 1, course.length - 1)];
  const segLen = pNext.distance_m - p.distance_m;
  const frac = segLen > 0 ? Math.min(1, Math.max(0, (curDist - p.distance_m) / segLen)) : 0;
  const rLon = p.lon + (pNext.lon - p.lon) * frac;
  const rLat = p.lat + (pNext.lat - p.lat) * frac;
  const rEle = p.elevation_m + (pNext.elevation_m - p.elevation_m) * frac;

  // camera params (= bearing は course[curIdx]→course[curIdx+5] の travel heading)、
  // center は interpolated rLon/rLat で sub-meter 精度を保つ
  const cam = computeCameraParams(course, { curIdx }, { userZoom, userPitch, lookAhead: 5 });
  const headingRad = cam.bearing * Math.PI / 180;

  // スピナー累積角を cadence rpm に応じて進める (rpm → rad/s = rpm * 2π / 60)
  spinAngle += currentCadence * (2 * Math.PI / 60) * dt;
  // rider 立体を rider 位置 + 進行方向 + スピン角で更新
  const ridSrc = map.getSource && map.getSource('rider');
  if (ridSrc) {
    ridSrc.setData(buildRiderFeatures(rLat, rLon, headingRad, spinAngle));
  }

  // camera は ride active 時だけ jumpTo (= 待機中は map state を動かさず idle 発火を許可、
  // 「描画準備中」インジケータの解除トリガに干渉しない).
  if (course.length > 0 && rideState && rideState.snapshot().active) {
    map.jumpTo({ ...cam, center: [rLon, rLat] });
  }

  if (rideStartedAt !== null) {
    const sec = Math.floor((performance.now() - rideStartedAt) / 1000);
    setText('elapsed', `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`);
  } else setText('elapsed', '00:00:00');

  setText('dist', curDist.toFixed(0));
  setText('ele', rEle.toFixed(0));
  // rider 追随 HUD の slope は常時更新 (= state push に依存せず course から直接).
  setText('r-slope', p.slope_pct.toFixed(1));
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
  updateMinimap(curDist, rEle, rLat, rLon, headingRad);
  const dispKmh = playSpeed * speedMult * 3.6;
  const connected = !!(client && client.isOpen());
  setText('speed', snap.paused ? (connected ? '待機中' : 'paused') : `${dispKmh.toFixed(1)} km/h${connected ? ' (bridge)' : ' (demo)'}`);

  if (!snap.paused) maybeSendSlope(p.slope_pct);
  if (snap.active && !snap.paused && connected) {
    const now = performance.now();
    if (now - lastPositionSendT >= POSITION_SEND_INTERVAL_MS) {
      client.sendPosition(curDist, rLat, rLon, rEle);
      lastPositionSendT = now;
    }
  }
  // brief 33: ride 中 1Hz で trkpt 蓄積 (= GPX / Strava upload / IndexedDB 履歴の元データ).
  // connected 不要 (= TEST_MODE / MAP_MODE / BLE / static でも本人 ride の trkpt は溜める).
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
  }
  if (!rideState.isAtEnd()) requestAnimationFrame(tick);
  else status('完走');
}

// ボタン bind
document.getElementById('btnPause').addEventListener('click', () => { if (rideState) rideState.togglePause(); });
document.getElementById('btnRideStart').addEventListener('click', () => {
  if (!client || !client.isOpen()) return;
  if (rideState) rideState.start();
  lastT = performance.now(); lastPositionSendT = 0; lastTrkptT = 0;
  client.sendRideStart();
});
document.getElementById('btnRideEnd').addEventListener('click', () => {
  if (!client || !client.isOpen()) return;
  if (rideState) rideState.end();
  client.sendRideEnd();
});
document.getElementById('btnScan').addEventListener('click', () => {
  scanMode = 'ftms';
  setText('scan-mode-label', '(trainer モード)');
  if (client && client.isOpen()) client.sendScan();
});
document.getElementById('btnScanHrm').addEventListener('click', () => {
  scanMode = 'hrm';
  setText('scan-mode-label', '(心拍計モード)');
  if (client && client.isOpen()) client.sendScan();
});
document.getElementById('btnSkip').addEventListener('click', () => { showConfirm(); });
document.getElementById('btnConfirmDemo').addEventListener('click', () => {
  hideConfirm(); hidePairing();
  playSpeed = 20 / 3.6;
  if (rideState) rideState.start();
  lastT = performance.now();
  status('デモモード (記録は保存されません)');
});
document.getElementById('btnCancelDemo').addEventListener('click', () => { hideConfirm(); });
document.getElementById('btnCopyPath').addEventListener('click', () => {
  const path = document.getElementById('post-gpx-path').textContent;
  copyToClipboard(path, document.getElementById('copy-status'));
});
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
bindSlider('rngDiff', 'diffVal', 'fujihc.diff', (pct) => { diffMult = pct / 100; setText('diffVal', String(Math.round(pct))); lastSlopeSent = null; });
bindSlider('rngSpd', 'spdVal', 'fujihc.spd', (pct) => { speedMult = pct / 100; setText('spdVal', (pct / 100).toFixed(2)); });

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

// brief 33: ride 履歴 + Strava 連携 button bind.
// IndexedDB は遅延 open (= ride 終了 / 履歴 open 時に初めて開く、 起動時に open しない).
let _rideDbInstance = null;
async function getRideDb() {
  if (_rideDbInstance) return _rideDbInstance;
  try { _rideDbInstance = await openRideDb(); } catch (err) { console.warn('openRideDb failed:', err); throw err; }
  return _rideDbInstance;
}

// fujihc-trainer の Strava client_id は user 各自が自分の Strava app を作って setup する運用.
// repo に固定 client_id は埋め込まない (= 各 user の activity が混線しない、 brief 33 §ハマる罠).
// localStorage 'fujihc.strava.client_id' に user が貼る、 未設定なら upload button が status を出す.
function getStravaClientId() {
  try { return localStorage.getItem('fujihc.strava.client_id') || null; } catch { return null; }
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
    course_name: 'fujihc',
  };
}

bindPostRideButtons({
  getTrkpts: () => (rideState ? rideState.getTrkpts() : []),
  getSummary: () => buildRideSummary(rideState, []),
  getCourseName: () => 'fujihc',
  addRide: async (rec) => { const db = await getRideDb(); await rideDbAdd(db, rec); },
  getClientId: getStravaClientId,
  getRedirectUri: getStravaRedirectUri,
  onViewHistory: () => { showHistoryOverlay().catch((err) => setPostrideStatus(`history error: ${err.message}`)); },
  onStatus: setPostrideStatus,
});

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
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'ride-meta';
    const dateEl = document.createElement('div');
    dateEl.className = 'ride-date';
    dateEl.textContent = r.date || r.id;
    const sumEl = document.createElement('div');
    sumEl.className = 'ride-summary';
    const s = r.summary || {};
    sumEl.textContent = `${Math.round((s.distance_m || 0) / 100) / 10} km / ${Math.round(s.duration_s || 0)}s / ${(r.trkpts || []).length}pt`;
    meta.appendChild(dateEl); meta.appendChild(sumEl);
    const actions = document.createElement('div');
    actions.className = 'ride-actions';
    const bDel = document.createElement('button');
    bDel.textContent = '削除';
    bDel.addEventListener('click', async () => {
      try { const db = await getRideDb(); await rideDbDelete(db, r.id); showHistoryOverlay(); }
      catch (err) { if (status) status.textContent = `削除失敗: ${err.message}`; }
    });
    actions.appendChild(bDel);
    li.appendChild(meta); li.appendChild(actions);
    list.appendChild(li);
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

const btnStravaConnect = document.getElementById('btnStravaConnect');
if (btnStravaConnect) btnStravaConnect.addEventListener('click', async () => {
  const clientId = getStravaClientId();
  if (!clientId) {
    const status = document.getElementById('strava-status');
    if (status) status.textContent = 'client_id 未設定 (= localStorage "fujihc.strava.client_id" に Strava app の Client ID を入れてください)';
    return;
  }
  // PKCE 認可 URL を開く
  const { makeCodeVerifier, makeCodeChallenge, buildAuthorizeUrl,
          STRAVA_PKCE_VERIFIER_SS_KEY, STRAVA_PKCE_CLIENT_ID_SS_KEY } =
    await import('./lib/strava_oauth.js');
  const verifier = makeCodeVerifier();
  const challenge = await makeCodeChallenge(verifier);
  sessionStorage.setItem(STRAVA_PKCE_VERIFIER_SS_KEY, verifier);
  sessionStorage.setItem(STRAVA_PKCE_CLIENT_ID_SS_KEY, String(clientId));
  const url = buildAuthorizeUrl({ clientId, redirectUri: getStravaRedirectUri(), codeChallenge: challenge });
  location.assign(url);
});

const btnStravaDisconnect = document.getElementById('btnStravaDisconnect');
if (btnStravaDisconnect) btnStravaDisconnect.addEventListener('click', () => {
  revokeLocalToken();
  updateStravaStatusUI();
});

// oauth-callback.html から postMessage で完了通知が来る (= 別 tab 経路).
window.addEventListener('message', (ev) => {
  if (!ev || !ev.data || ev.data.type !== 'strava-oauth-done') return;
  if (ev.origin !== location.origin) return;  // same-origin only
  updateStravaStatusUI();
});
