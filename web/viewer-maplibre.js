// fujihill viewer - 富士ヒルクライム / 任意ヒルクライム trainer。
// b12 Phase 4: 地図描画エンジンを Three.js に差し替え。 地形は航空写真テクスチャを
// 貼った 3D メッシュで描く。 viewer 本体は map インスタンスを持たず、 createMapRenderer()
// の返す renderer の意味メソッド15個経由でしか地図を触らない (= 差し替え口)。
// MapLibre 実装 (web/lib/map_renderer.js) も同じ差し替え口を満たすので、 import 行を
// web/lib/map3d/index.js に差し替えるだけで描画エンジンが入れ替わる。
import { createMapRenderer } from './lib/map3d/index.js';
// 自機形状エディタ: 自転車の部品ごと形状パラメータの既定値と範囲 (control panel 用).
import { BIKE_SHAPE_DEFAULTS, BIKE_SHAPE_RANGE } from './lib/map3d/rider_mesh3d.js';
// b12 Phase 1: 富士ヒル固有値 (bounds / center / course file) は course 定義に集約.
import { fujihill } from './courses/fujihill.js';
// b50: course.json の fetch → 平滑化 (smoothCourse) → terrain 構築 (createTerrain) は
//   course_loader.js に切り出し済。viewer は loadCourseData を呼ぶだけ。
import { loadCourseData } from './lib/course_loader.js';
// brief b2: per-frame コスト削減 ── 「変化した時だけ更新」 の判定純関数群。
// b12 Phase 2.5: コース polygon / セグメントラベル / ライダー geometry / カメラ計算 /
// 勾配色 / mesh cache は地図描画モジュール (map_renderer.js) の中へ集約済。
import { createTextWriter } from './lib/frame_diff.js';
// Path B Phase 0: ライド HUD の表示更新を hud.js に集約 (= MapLibre/Three.js 非依存)。
import {
  createHud, formatPower, formatCadence, formatHr, formatAck,
  ACK_OK_COLOR, ACK_NG_COLOR,
} from './lib/hud.js';
// brief 19b: WebSocket / ride state / camera を lib に集約
import { createBridgeClient, createTestModeClient, createFakeStateGenerator } from './lib/ws_client.js';
import { createBleClient, isWebBluetoothSupported } from './lib/ble_client.js';
import { createRideState } from './lib/ride_state.js';
// brief 35: Terrain + Rider 2 層モデル. viewer は terrain + rider を直接保持し、
// 移動状態 (= 速度 / 位置 / 補間 / 進行方位) はすべて rider/terrain API 経由で操作する.
// createRideState は HTML / 既存 source-grep tests が期待する API surface (= rideState 変数 /
// rideState.startFrom / rideState.appendTrkpt 等) を維持する shim 経路で残す (= 同じ Rider を
// 内側に持つため二重 state にはならない).
import { createRider } from './lib/rider.js';
import { integratePhysics } from './lib/bike_physics.js';
// b51: minimap (course polyline + OSM 1-shot + 標高プロファイル) は minimap.js に切り出し済。
//   tile 座標変換 / 再描画判定もそちらが内側で import する。
import { createMinimap } from './lib/minimap.js';
// brief 31 commit γ: checkSetupStatus を lib 抽出して behavioral test 可能に
import { checkSetupStatus as checkSetupStatusLib } from './lib/check_setup_status.js';
// brief 33: ride 終了時の 4 button bind (= GPX download / Strava upload / 履歴に保存 / 履歴を見る).
// IndexedDB 履歴 / Strava OAuth / 一覧 UI を viewer 側 inline 化せず module 経由で呼ぶ
// (= NG-R1-7 同型予防、 4 module 分離).
import { bindPostRideButtons } from './lib/postride_buttons.js';
import { openRideDb, addRide as rideDbAdd, listRides as rideDbList, deleteRide as rideDbDelete } from './lib/ride_db.js';
import { appendHistoryRow } from './lib/history_row.js';
import { ensureAccessToken, revokeLocalToken, STRAVA_TOKEN_LS_KEY } from './lib/strava_oauth.js';
// brief 34 ε / b46: 公開ガードレール (= ride consent 同意管理).
// b46: intro consent (= getIntroConsent / setIntroConsent / clearIntroConsent) は撤去。
//   起動シーンを地形データローダー画面の一本道に作り変えたため不要 (= 観るモード判定は
//   body.mode-view class へ移行)。
import {
  getRideConsent, setRideConsent, clearRideConsent,
} from './lib/consent.js';
// brief 34 ε-5: 「全データ削除」UI 用の IndexedDB + localStorage 一括 clear.
import { clearAllLocalData, clearServiceWorkerCache } from './lib/clear_local_data.js';
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
import { FUJIHC_LANDMARKS, snapLandmarksToCourse } from './lib/course_landmarks.js';
// brief 34 ε-9: 地形データ準備 loader. 起動直後 1 回 start()、 完了まで全アクションボタン disabled.
// b31: GSI_DEM_DIRECT_BASE constant は terrain_loader.js 側で定義、 viewer 本体には
// URL literal を書かない (= viewer_url_audit.test.js 単体 scan に対し GSI URL 出現ゼロ維持)。
// b42: probe の URL 構築 / loader 生成 / GSI direct base / TileCache DI は terrain_phase.js
// 側に切り離し済 (= createTerrainLoader / GSI_DEM_DIRECT_BASE / openTileCache の import は本
// module から撤去)。viewer は createTerrainPhase を消費するだけ。
import { createTerrainPhase } from './lib/terrain_phase.js';
// b13-1: 機器設定パネルの共通スライダー機構
import { mountControlPanel } from './lib/control_panel.js';
// b99: Strava 形式 chart panel (= 4 sub-chart: speed / power / hr / cadence).
import { createChartBuffer, decideChartPush } from './lib/hud_chart_buffer.js';
import { createChartRenderer, CANVAS_HEIGHT_PX } from './lib/hud_chart.js';
// b114: 雲量 slider を「大気環境」 ATMO_DEFS に統合するため、 wirelib を static import に
// 格上げ (= ATMO_DEFS の apply から applyCloudAmountToMap を直呼びする)。 純関数 export
// のみで副作用ゼロ、 static 化に支障なし。
import {
  applyAmedasCloudsToPanel,
  applyCloudAmountToMap,
  parseForceWeatherFromUrl,
  applyForceWeatherToPanel,
} from './lib/weather/weather_panel_wire.js';

// b12 Phase 2: 地図描画 renderer。 viewer 本体が地図を触る唯一の窓口。
const mapRenderer = createMapRenderer();

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

// b12 Phase 2: gsidem カスタムプロトコル / COMMON_LAYERS / COMMON_SKY / buildMapStyle は
// web/lib/map_renderer.js に集約済 (= 地図描画モジュールの内側)。 viewer 本体は持たない。

// brief 34 ε-7: 富士スバルライン専用 DB bbox (= MapLibre の vector/DEM source 用).
// MapLibre の source に bounds として渡すと「この範囲外は要求しない」を伝えられる、
// DevTools で発覚した「viewer が DB 外 tile を要求 → 404 量産」問題の解決。
// GSI 再アクセスは無し (= 既得 DB をフル活用)、 外部 fetch 発生量ゼロ。
// 2026-05-15 注記: tile_constants.py:MINIMAP_BBOX とは概念的に分離。 ここは
// 主 map (z=13+ の vector + raster-dem) の source bounds、 MINIMAP_BBOX は
// 別 canvas (上半分 minimap) の z=11 raster pre-fetch 範囲。 minimap は
// course bbox + 20% margin + buffer=1 で 16 タイル要求するため MINIMAP_BBOX
// の方が広い (= MINIMAP_BBOX ⊃ FUJIHILL_DB_BOUNDS)。
// b12 Phase 1: 値の正本は web/courses/fujihill.js に移動。 ここは後方互換の
// re-export (= 既存の test / import を壊さない)。 値は完全に同一。
export const FUJIHILL_DB_BOUNDS = fujihill.dbBounds;
// center は bbox 中央 (= 138.75, 35.40)、 default view が DB 内に確実に収まる位置。
export const FUJIHILL_DB_CENTER = fujihill.dbCenter;

// b12 Phase 2: buildMapStyle は map_renderer.js が持つ。 viewer は renderer.boot に
// course 定義の dbBounds / dbCenter を渡すだけで、 style 構築の中身は触らない。

// 地図インスタンスは mapRenderer の内側。 viewer は mapRenderer.isBooted() で生成済を判定する。
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
    courseUrl: s.bridgeReachable ? fujihill.courseFile : `${BASE_PATH}static/${fujihill.courseFile}`,
    setupStatus: s,
  });
  return ENV;
}

// b12 Phase 2: 地図インスタンス生成 / protocol 登録 / load・idle・error 結線は
// map_renderer.js の renderer.boot に委譲。 viewer 本体は course 定義の dbBounds /
// dbCenter を渡し、 load 完了後の起動継続 (= onMapLoaded) だけを担う。
function bootMap(env) {
  // brief 35: ロード overlay を visible にして「動いてる」 を訪問者に見せる。
  // map3d boot 内で loadDemStitched の onProgress(done, total) が発火し、 viewer 側で
  // #loading-progress-num / #loading-bar-fill を更新する。 完了 (= onMapLoaded) で fade out。
  showLoadingOverlay('idle');
  return mapRenderer.boot(env, {
    // b59: map3d boot の opts.dbBounds は loadDemStitched の DEM メッシュ範囲として
    // 消費される (= そこから組む geoMeta がカメラ注視点・span・投影の元にもなる)。
    // 渡す実体は DEM 専用の demBounds (= コース外接 ∪ 富士山頂、 z15 で 96 tiles)。
    // opts キー名 dbBounds は据え置く ── 受け側 map3d/index.js は camera worker
    // 作業中レーンで触れないため。 dbBounds 全域 (22km四方) を z15 で渡すと 437 tiles
    // で MAX_TILES 超過 → 地形が組めない。
    dbBounds: fujihill.demBounds,
    // b67: 広域低精細メッシュ (= 富士山体の全景を背景に敷く) 用の bbox。 高精細
    // (demBounds, z15) の外側を覆う dbBounds (22km四方) を z12 dem_png で 12 tiles
    // に抑えて配布元負荷最小。 詳細は map3d/index.js の WIDE_DEM_ZOOM 注記参照。
    wideBounds: fujihill.dbBounds,
    dbCenter: fujihill.dbCenter,
    onLoaded: onMapLoaded,
    onProgress: updateLoadingProgress,
    // b41: ?noterrain= なら map3d は DEM / 航空写真を取得せず平坦地形で組む。
    skipTerrain: SKIP_TERRAIN,
  });
}

// brief 35: ロード overlay 制御 helper。 viewer の起動経路から `#loading-indicator` の
// visible / 進捗数値 / バー / fade out / 警告状態を一元的に書く。 内部 state を
// data-loading-state 属性に expose して e2e は属性遷移で pin する (= 文言 grep 退却)。
let _loadingSilenceTimer = null;
let _loadingGiveUpTimer = null;
let _loadingLastProgressAt = 0;
const LOADING_SILENCE_MS = 10_000;   // 10s 進捗無音で「応答がありません」 警告 + 諦め button 表示
const LOADING_GIVE_UP_MS = 30_000;   // 30s 経過で強制諦め (= 自動 fade out + 諦め経路)

function showLoadingOverlay(state) {
  // b41: ?noterrain= では地形タイルを取得しない ── 取得進捗を映す overlay も出さない。
  // 出すと進捗が永遠に来ず overlay が出っぱなしになり、 後続操作を覆って e2e を妨げる。
  if (SKIP_TERRAIN) return;
  const ov = document.getElementById('loading-indicator');
  if (!ov) return;
  ov.classList.add('visible');
  ov.classList.remove('fade-out');
  ov.dataset.loadingState = state || 'idle';
  // 進捗バー / 警告 / 諦め button を初期化 (= 前回起動の残りを消す)。
  const fillEl = document.getElementById('loading-bar-fill');
  if (fillEl) fillEl.style.width = '0%';
  setLoadingWarning('', null);
  const giveBtn = document.getElementById('btnLoadingGiveUp');
  if (giveBtn) giveBtn.hidden = true;
  // IndexedDB 不在 (= プライベートウィンドウで quota 不足等) を起動時 chk。 cache が
  // 使えなくても viewer は続行できるので、 warning に留めて続行する。
  if (typeof indexedDB === 'undefined') {
    setLoadingWarning('キャッシュが使えない環境です、 毎回タイルを取得します。', 'no-cache');
  }
  // 10s 無音 detector を仕掛ける。 onProgress が来るたび reset、 来ないまま 10s 経過なら警告。
  _loadingLastProgressAt = performance.now();
  if (_loadingSilenceTimer) clearTimeout(_loadingSilenceTimer);
  _loadingSilenceTimer = setTimeout(onLoadingSilent, LOADING_SILENCE_MS);
  if (_loadingGiveUpTimer) clearTimeout(_loadingGiveUpTimer);
  _loadingGiveUpTimer = setTimeout(onLoadingGiveUpAuto, LOADING_GIVE_UP_MS);
}
function updateLoadingProgress(done, total) {
  _loadingLastProgressAt = performance.now();
  const numEl = document.getElementById('loading-progress-num');
  const denEl = document.getElementById('loading-progress-den');
  const fillEl = document.getElementById('loading-bar-fill');
  if (numEl) numEl.textContent = String(done);
  if (denEl) denEl.textContent = String(total);
  if (fillEl) fillEl.style.width = total > 0 ? `${(done / total * 100).toFixed(1)}%` : '0%';
  const ov = document.getElementById('loading-indicator');
  if (ov && ov.dataset.loadingState === 'idle') ov.dataset.loadingState = 'loading';
  // 進捗が来たので無音 detector を再仕掛け (= 「タイル取得中だが時々止まる」 ケースを警告しない)。
  if (_loadingSilenceTimer) clearTimeout(_loadingSilenceTimer);
  _loadingSilenceTimer = setTimeout(onLoadingSilent, LOADING_SILENCE_MS);
  // brief 35: タイル取得が完了 (= 全 done) で overlay を fade out。 onMapLoaded 経由ではなく
  // ここで判定するのは、 onMapLoaded が 8 秒 fallback でも発火するため (= fetch 完了と独立)。
  if (total > 0 && done >= total) {
    fadeOutLoadingOverlay();
  }
}
function setLoadingWarning(message, state) {
  const ov = document.getElementById('loading-indicator');
  if (!ov) return;
  if (state) ov.dataset.loadingState = state;
  const warn = document.getElementById('loading-warning');
  if (warn) {
    warn.textContent = message || '';
    warn.hidden = !message;
  }
}
function onLoadingSilent() {
  // brief 35 異常系: 10s 進捗無音で警告 + 諦め button を visible 化。 訪問者は自分の判断で
  // 「地形なしで進む」 を押せる、 自動 fade out (= 30s) を待たずに離脱可能。
  setLoadingWarning('応答がありません。 タイルが取れません、 再試行しています。', 'silent');
  const btn = document.getElementById('btnLoadingGiveUp');
  if (btn) btn.hidden = false;
  console.warn('[brief 35] loading overlay: 10s 進捗無音、 諦め button を表示');
}
function onLoadingGiveUpAuto() {
  // 30s 経過で強制諦め: overlay を fade out + map3d の 8s fallback と同じ経路で続行。
  console.warn('[brief 35] loading overlay: 30s 経過、 自動諦め');
  fadeOutLoadingOverlay();
}
function fadeOutLoadingOverlay() {
  const ov = document.getElementById('loading-indicator');
  if (!ov) return;
  ov.dataset.loadingState = 'done';
  ov.classList.add('fade-out');
  if (_loadingSilenceTimer) { clearTimeout(_loadingSilenceTimer); _loadingSilenceTimer = null; }
  if (_loadingGiveUpTimer) { clearTimeout(_loadingGiveUpTimer); _loadingGiveUpTimer = null; }
  setTimeout(() => {
    ov.classList.remove('visible');
    ov.classList.remove('fade-out');
  }, 320);
}

// brief 35: 「地形なしで進む」 button の click handler。 訪問者が待ちきれず諦める経路。
if (typeof document !== 'undefined') {
  const btnGiveUp = document.getElementById('btnLoadingGiveUp');
  if (btnGiveUp) btnGiveUp.addEventListener('click', () => {
    console.warn('[brief 35] 訪問者が「地形なしで進む」 を選択');
    fadeOutLoadingOverlay();
  });
}

// 地図 'load' 完了後の viewer 側起動継続。 setTerrain / 操作系 disable は renderer が
// 済ませた後にここが呼ばれる (= status / idle gate / カメラ入力 bind / コース描画)。
// 2026-05-17 fix: loadCourse / rider 初期化を 'load' に直結すると、 source 初期化失敗で
// 'load' が永遠未発火のとき loadCourse が走らず起動不全になる。 renderer.boot 側が
// 'load' と 8 秒 fallback の両方から onLoaded を呼ぶため、 ここは必ず 1 度実行される。
function onMapLoaded() {
  status('map loaded');
  // brief 35: ここで fadeOutLoadingOverlay は呼ばない。 onMapLoaded は map3d boot の
  // 8 秒 fallback でも発火する経路で、 タイル取得が実際に完了したかと独立した signal。
  // タイル fetch が永遠 delay でも 8 秒で発火するため、 ここで fade out すると 10s 無音
  // detector が clear されて諦め button が出ない設計欠陥になる。 ロード overlay の
  // fade out は updateLoadingProgress 内で done === total を検出した時に行う。
  // 'idle' = viewport 内の全 source / tile load 完了。 terrain probe ok と AND で
  // button enable する (= mapFullyLoaded)。
  mapRenderer.onceIdle(() => {
    mapFullyLoaded = true;
    updateActionButtonsForTerrain();
  });
  // idle 永遠未発火 (= 一部 tile 404 / load 失敗で全 tile 揃わない) を想定して 5 秒 fallback。
  // 過剰待ちで permanent disabled に陥らない安全弁。
  setTimeout(() => {
    if (!mapFullyLoaded) {
      mapFullyLoaded = true;
      updateActionButtonsForTerrain();
    }
  }, 5000);
  // ホイール / ドラッグのカメラ操作は map_renderer が boot 時に自前で結線済。
  loadCourse();
  // brief 34 ε-6: 帰属表示 (= attribution control) の display を 1 度 assert。
  // CSS で `display:none` にされたら OSM ODbL / 国土地理院 規約違反、 warning を出す。
  requestAnimationFrame(() => verifyAttributionVisible());
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
// b53: 観る / デモ / TEST モードの手動パワー (W)。 パワースライダー (CONTROL_DEFS の
// power def) が apply で書き換える。 createFakeStateGenerator に () => manualPowerW で
// 渡し、 fake state の power_w として 1Hz で wsHandlers.state → integratePhysics に届く。
// 実ライド (bridge / BLE) は fake generator を通らないため、 trainer 接続中は実 power 優先。
let manualPowerW = _lsNum('fujihill.power', 250);
// 物理速度の内部状態 (m/s)。 wsHandlers.state が applyPhysicsStep で積分し rider.setSpeed に渡す。
// 2026-05-17: ?restore 復元経路では autosave データに速度が無いため (= trkpts は t/power/cad/hr
// のみ、 distanceM も速度を持たない) seed できず 0 始動とする。 復元直後の 1 state メッセージ分
// だけ速度が低めに出るが、 1Hz で即積分されるため軽微 (= 数百 ms で復帰)。 autosave に速度を
// 足せば seed 可能になるが現状はデータが無いので 0 のまま。
let physicsSpeedMps = 0;
// 直近 state メッセージの受信時刻 (= dt 算出用、 state push は約 1Hz)。
let lastPhysicsStateT = null;
// b83-fix: EMA は 1Hz 階段を消す道具でない (sub-agent review 結論) ── 線形補間に置換。
// wsHandlers.state で「seed = 現在表示値」 を覚えて、 tick で elapsed/expectedDt の比率で
// prev → next を線形に繋ぐ。 階段が rAF 60Hz で連続化、 tau slider 不要 (= 撤去)。
let displaySpeedMps = 0;
let prevPhysicsSpeedMps = 0;
const EXPECTED_STATE_DT = 1.0;  // state push 期待間隔 (秒)、 fake state interval と整合
let lastPositionSendT = 0;
let rideStartedAt = null;
// ride 終了時の走行時間 (秒) を確定保存する。 ended ハンドラが rideStartedAt を null に
// する前にここへ書き、 postride の buildRideSummary がこれを参照する (= 保存時間 0 バグ修正)。
let lastRideDurationS = 0;
const POSITION_SEND_INTERVAL_MS = 1000;
let scanMode = 'ftms';

let riderMarker = null;
// b51: minimap (course polyline + OSM 1-shot + 標高プロファイル) は web/lib/minimap.js に
//   切り出し済。base 画像 / stats / 再描画判定の状態は createMinimap() の closure が持つ。
const minimap = createMinimap();
// b12 Phase 2.5: カメラ状態 (zoom/pitch/bearing offset) と ホイール/ドラッグ操作は
// map_renderer.js が保持・処理する。 viewer は setCameraDefaults / updateCamera 経由で頼む。
// brief 35: 旧 spinAngle / currentCadence / currentPower / currentHr は rider 内部に集約.
// 互換のため symbol を残す (= brief 33 grep gate / 既存 source 経路の名前互換). 値は
// wsHandlers.state で rider.setSensors を呼ぶ際の経由口で、 単一 source of truth は rider.
// 各値の生存範囲 = wsHandlers.state ハンドラ内のみ、 tick 経路は rider.cadence/power/hr を読む.
let currentCadence = 0;
let currentPower = 0;
let currentHr = 0;
let currentSpeedMps = 0;  // trainer 速度の last-known (= power/cad/hr と同じく sticky 保持)
// brief 33: 1Hz cadence で rideState.appendTrkpt するための前回 push 時刻
let lastTrkptT = 0;
// autosave: 30 秒毎 cadence で IndexedDB に進行状態を保存するための前回 save 時刻
let lastAutosaveT = 0;
let rideStartedIso = null;  // ride 開始時の ISO 文字列 (= autosave に保存する rideStartedAt)

// brief 26b: state 種は checking / dbinit / pairing / riding の 4 値。
// - checking: 起動直後、 /tiles/_setup_status を fetch 中、 UI は最小
// - dbinit: DB 不足、 #dbinit-overlay で GSI fetch / OSM extract / skip を user に提示
// - pairing: 既存 BLE flow (= state-pairing と同じ挙動)
// - riding: 既存 ride 中
// start/goal マーカーの実体は map_renderer が保持。 ride 中はメイン map から hide する。
function updateStartGoalVisibility() {
  const hide = document.body.classList.contains('state-riding');
  mapRenderer.setStartGoalVisible(!hide);
}

// b12 Phase 2.5: 距離ラベルの文字画像生成・symbol レイヤー・距離窓フィルタは
// map_renderer.js が持つ。 viewer は機器設定 slider から setLabelScale を頼むだけ。
// ラベル表示倍率の起動時 default は localStorage 永続値 (= slider 表示の初期化用に読む)。
let labelSizeScale = 1;
try {
  const _ls = parseFloat(localStorage.getItem('fujihill.labelSize'));
  if (Number.isFinite(_ls) && _ls > 0) labelSizeScale = _ls;
} catch { /* localStorage 不可は default のまま */ }

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
    el.style.color = '#e56b6f';
    el.style.borderColor = '#e56b6f';
    el.style.background = '#3a1c20';
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
    el.style.color = '#62d0a2';
  } else if (snap.phase === 'failed') {
    el.textContent = `地形データ準備 失敗: ${snap.error || ''} ── ページを reload してください`;
    el.style.color = '#e56b6f';
  } else {
    // 2026-05-15 fix: load 中の案内文を「何をしてる / なぜ操作できない」明示に強化.
    el.textContent = `地形データを準備しています... コースの起伏を描く地図タイルを読み込み中です。 完了するまで「走る」「観る」ボタンは押せません。  ${snap.label} (${snap.percent}%)`;
    el.style.color = '#f2c14e';
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
// HUD 以外 (BLE 状態 / ペアリングパネル / スライダー値 / debug-hud) 用。
const setText = createTextWriter((id) => document.getElementById(id));

// Path B Phase 0: ライド HUD (時間/距離/標高/勾配/速度/パワー/ケイデンス/心拍/応答)
// の表示更新は hud.js に集約。 HUD の要素 id は専ら hud 経由で書く (= 上の setText と
// writer を分けることで「変化時だけ書く」 skip 判定が id ごとに 1 本化する)。
const hud = createHud((id) => document.getElementById(id));

// b99: Strava 形式 chart panel の init. canvas attribute / CSS の二重 literal を排除、 JS 側
// CANVAS_HEIGHT_PX を SoT として canvas.height に上書き。 width は親 div の clientWidth を取り、
// リサイズなしの 1 shot 設定 (= chart panel は ride 中固定 layout). 直近 4 metric は viewer 側で
// 保持し、 1 Hz tick で 1 sample に合成。 trainer / speed 到来タイミングが独立なので合成は viewer 責務.
const chartBuffer = createChartBuffer();
const chartCanvas = document.getElementById('hud-chart-canvas');
if (chartCanvas) {
  chartCanvas.width = chartCanvas.parentElement?.clientWidth || 800;
  chartCanvas.height = CANVAS_HEIGHT_PX;
}
const chartRenderer = chartCanvas ? createChartRenderer(chartCanvas, chartBuffer) : null;
let _lastSpeed = null, _lastPower = null, _lastCadence = null, _lastHr = null;
let _lastChartPushSec = -1;
let _lastChartRenderMs = 0;
// b99 ui-tune: 折りたたみボタン. body.chart-folded を toggle、 localStorage で persist
// (= 次回起動で前回 fold 状態を復元、 ride 中の画面占有を user 好みに合わせる).
const FOLD_KEY = 'fujihill.chart-folded';
const chartFoldBtn = document.getElementById('hud-chart-fold-btn');
function applyChartFold(folded) {
  document.body.classList.toggle('chart-folded', folded);
  if (chartFoldBtn) chartFoldBtn.textContent = folded ? '▸ chart' : '▾ chart';
}
try { applyChartFold(localStorage.getItem(FOLD_KEY) === '1'); } catch (_) { /* SSR / privacy mode */ }
if (chartFoldBtn) {
  chartFoldBtn.addEventListener('click', () => {
    const next = !document.body.classList.contains('chart-folded');
    applyChartFold(next);
    try { localStorage.setItem(FOLD_KEY, next ? '1' : '0'); } catch (_) { /* privacy mode */ }
  });
}
function maybePushAndRenderChart(elapsedSec, paused) {
  if (!chartRenderer || !chartBuffer) return;
  const decision = decideChartPush({
    paused,
    elapsedSec,
    lastPushSec: _lastChartPushSec,
    snapshot: { speed: _lastSpeed, power: _lastPower, hr: _lastHr, cadence: _lastCadence },
  });
  if (decision.push && decision.sample) {
    chartBuffer.push(decision.sample);
    postChartStateToBridge();  // = 1 Hz CP push (= bridge memory に chart state を保存、 GET で読める)
  }
  _lastChartPushSec = decision.nextLastPushSec;
  const nowMs = performance.now();
  if (nowMs - _lastChartRenderMs >= 250) {
    chartRenderer.render();
    _lastChartRenderMs = nowMs;
  }
}

// b99 CP: chart buffer の summary を bridge の /api/debug/chart-state に POST する.
// ブラウザを前面化せず背景タブのままでも (= chrome flag で rAF 抑制を切れば) bridge 経由で
// chart 動作を curl で観測できる. 1 sample push のたびに 1 回呼ばれる = 1Hz, throttle 重複なし.
function postChartStateToBridge() {
  if (!chartBuffer) return;
  const samples = chartBuffer.get();
  const summary = {
    sample_count: samples.length,
    last_t: chartBuffer.maxTime(),
    paused: document.body.classList.contains('state-checking') || document.body.classList.contains('state-dbinit'),
    folded: document.body.classList.contains('chart-folded'),
    metrics: {
      speed:   { max: chartBuffer.maxOf('speed'),   avg: chartBuffer.avgOf('speed') },
      power:   { max: chartBuffer.maxOf('power'),   avg: chartBuffer.avgOf('power') },
      hr:      { max: chartBuffer.maxOf('hr'),      avg: chartBuffer.avgOf('hr') },
      cadence: { max: chartBuffer.maxOf('cadence'), avg: chartBuffer.avgOf('cadence') },
    },
    client_iso: new Date().toISOString(),
  };
  fetch('/api/debug/chart-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  }).catch(() => { /* bridge 未起動 / 切断 etc は静かに無視 (= 開発ツール、 production 影響なし) */ });
}

// === WebSocket === (既存 viewer.js と同じ contract)
const WS_URL = 'ws://localhost:8765';
// brief 22: ?test=1 で trainer / bridge 不在の画面操作確認モード.
// WebSocket 接続を skip、 fake state を 1Hz で push、 ride/scan は即座に fake 応答.
// 起動例: python -m http.server -d web/ 8000 -> http://localhost:8000/?test=1
const TEST_MODE = new URLSearchParams(location.search).has('test');
// b41: ?noterrain= で地形タイル取得を物理 skip する。 起動直後の terrain probe も
// 観る/走るモードの 3D 地図構築 (map3d) も、 配布元 (国土地理院 / OpenStreetMap) を
// 一切叩かず平坦な地形で viewer を動かす。 地形そのものを検証しない e2e が、 配布元に
// 迷惑をかけずに viewer の導線・履歴・モード切替を試すための入口 (= b40 / handoff 方針)。
const SKIP_TERRAIN = new URLSearchParams(location.search).has('noterrain');
// 2026-05-16: ?debug=1 で右上に debug HUD を表示 (= 座標 drift / camera 差分 / frame timing).
// 走行中 user が「camera が rider 中心からズレる」「慣性力おかしい」 を数値で目視できる.
// brief b2 High-4: debug HUD の有無を 1 回だけ確定。 tick() の debug 系
// setText 30 件超は DEBUG_HUD が true の時だけ実行する (= 平時は丸ごと skip)。
const DEBUG_HUD = new URLSearchParams(location.search).has('debug');
if (DEBUG_HUD) {
  document.body.classList.add('debug-on');
}
// 2026-05-16: service worker 登録 (= タイル等を永続 cache、 2 回目以降を速く / オフライン可、
// user 「毎回タイルを並べる手間」 への対応).
// ?nosw=1 (dev 用): 旧来は register を skip するだけだったが、 それでは既に install 済の
// SW が古い cache を返し続け「新しい版に切り替わらない」。 ?nosw=1 では既存 SW を解除し
// cache を全消しする (= 次回 reload から SW なし・常に network 直)。
if ('serviceWorker' in navigator || window.caches) {
  if (new URLSearchParams(location.search).has('nosw')) {
    // b43: SW unregister + CacheStorage 全消しは clear_local_data.js の
    // clearServiceWorkerCache に 1 本化 (=「アプリを最新版に更新」 ボタン #btnRefreshApp と
    // 同じ関数を共用、 inline ループの双子コピペを作らない)。
    clearServiceWorkerCache().catch(() => {});
  } else if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[fujihill] service worker register failed:', err);
      });
    });
  }
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
    // state push は値が部分的に届く ── パワーメーターと心拍センサーは別デバイスで、
    // power_w だけ / hr_bpm だけ の message が別々のタイミングで来る。 各値は届いた時
    // だけ current* に sticky 保持し、 物理計算・HUD・rider.setSensors はすべて「最後に
    // 届いた各値」を使う。 生の msg.* を直接使うと 2 つの実害が出る:
    //   (1) 心拍だけの message を物理に渡すと power=0 とみなされ「足を止めた」減速が
    //       混入、 速度が実際より大幅に遅く・断続的になる (= ストラバ記録の速度が掛けた
    //       パワーに対しておかしくなる実害)。
    //   (2) HUD が power だけの message で心拍を、 心拍だけの message で power を "--"
    //       に明滅させる。
    // sticky 更新は物理ブロックより前に置く (= 物理が currentPower を読めるように)。
    if (typeof msg.cadence_rpm === 'number') currentCadence = msg.cadence_rpm;
    if (typeof msg.power_w === 'number') currentPower = msg.power_w;
    if (typeof msg.hr_bpm === 'number') currentHr = msg.hr_bpm;
    if (typeof msg.speed_mps === 'number') currentSpeedMps = msg.speed_mps;

    if (rider) {
      const now = performance.now();
      // dt = 前回 state メッセージからの経過秒。 state push は約 1Hz。 初回は 1 秒とみなす。
      let dt = (lastPhysicsStateT != null) ? (now - lastPhysicsStateT) / 1000 : 1.0;
      lastPhysicsStateT = now;
      if (dt < 0.1) dt = 0.1;
      if (dt > 2.0) dt = 2.0;
      // パワーは sticky 保持の currentPower を使う ── 生の msg.power_w を使うと、 power を
      // 含まない心拍 message のたびに 0 となり、 物理に偽の「足止め」減速が入る。
      const power = Number.isFinite(currentPower) ? currentPower : 0;
      // 2026-05-17 (Critical fix): コース勾配は rider の現在位置から都度引く。
      // 旧経路は tick() で更新する module global を読んでいたが、
      // state push (約 1Hz) が初回 tick より先に来ると slope=0 で積分してしまい、
      // 富士ヒルの登坂で登り抵抗が抜けて速度が過大になる。 rider.snapshot().position は
      // Terrain query 経由でいつでも現在位置のコース勾配を返すので、 そこを直接 source にする。
      const riderPos = rider.snapshot().position;
      const slopePct = (riderPos && Number.isFinite(riderPos.slope_pct)) ? riderPos.slope_pct : 0;
      // 物理は固定 1/120s でサブステップ (= 大きい dt でも安定、 inertia-sim.html と同方式)。
      // サブステップ積分ループは bike_physics.integratePhysics に集約済 (= SoT 三重複の解消)。
      // dt は上の [0.1, 2.0] クランプ済を渡す。 空気抵抗は CdA を 1 本にまとめるため
      // c_d=CdA / area=1 で渡す。
      physicsSpeedMps = integratePhysics(physicsSpeedMps, dt, power, slopePct,
        { mass: bikeMass, c_rr: bikeCrr, c_d: bikeCda, area: 1, inertia: inertiaKg });
      // b83-fix: 線形補間の seed ── 「補間開始値 = 現在表示値」 を pin、 tick がここから
      //   physicsSpeedMps (= 新目標) へ EXPECTED_STATE_DT 秒かけて線形に進む。
      //   階段の跳びを起こさず rAF 60Hz で連続化される。
      prevPhysicsSpeedMps = displaySpeedMps;
    }
    // trainer 値の整形は hud.js が SoT。 HUD は hud.trainer、 ペアリングパネル p-* は
    // hud.js の export した整形関数で書く (= 整形ロジックの二重化なし)。
    if (rider) rider.setSensors({ power: currentPower, cad: currentCadence, hr: currentHr });
    const pw = formatPower(currentPower);
    const cd = formatCadence(currentCadence);
    const hr = formatHr(currentHr);
    const sp = (currentSpeedMps != null && currentSpeedMps >= 0) ? (currentSpeedMps * 3.6).toFixed(1) : '--';
    // HUD (#power/#cadence/#hr + #rider-hud の r-power/r-cadence/r-hr)。
    // r-speed (rider-hud の速度) は tick() の hud.speed() が物理速度で書く ──
    // trainer 生速度 (currentSpeedMps) は下の #p-speed にのみ出す。
    hud.trainer({ powerW: currentPower, cadenceRpm: currentCadence, hrBpm: currentHr });
    // b99: chart 用 snapshot. trainer 受信時に最新値を保持 (= 1 Hz tick で sample 合成).
    _lastPower = currentPower; _lastCadence = currentCadence; _lastHr = currentHr;
    // ペアリングパネル p-* は本石の対象外、 viewer 側で従来通り更新。
    setText('p-power', pw); setText('p-cadence', cd); setText('p-speed', sp); setText('p-hr', hr);
    if (msg.slope_sent_pct != null) setText('slope-sent', msg.slope_sent_pct.toFixed(1));
    if (msg.last_ack) {
      hud.ack(msg.last_ack);  // #ack (= HUD)
      const a = formatAck(msg.last_ack);  // p-ack も同じ整形 SoT で
      const pAck = document.getElementById('p-ack');
      if (pAck) { pAck.textContent = a.text; pAck.style.color = a.ok ? ACK_OK_COLOR : ACK_NG_COLOR; }
    }
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
      // terrainReady === true なら enable + focus、 false なら disabled のまま (terrain が遅延中、
      // 完了時に updateActionButtonsForTerrain が enable する)。 setRideStartEnabled 経由で
      // hint 文「ハンドシェイク完了後に押せる…」の表示/非表示も同時に同期される。
      setRideStartEnabled(terrainReady);
      if (terrainReady) {
        const startBtn = document.getElementById('btnRideStart');
        if (startBtn) requestAnimationFrame(() => startBtn.focus());
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
      else _pendingRideStart = true;  // rideState 未生成: loadCourse 完了時に start を適用
      rideStartedAt = performance.now();
      lastRideDurationS = 0;  // 新しい ride 開始、 前回の確定走行時間をクリア
      hidePairing();
      const endBtn = document.getElementById('btnRideEnd'); if (endBtn) endBtn.disabled = false;
    } else if (msg.state === 'ended') {
      if (rideState) rideState.end();
      // b99: ride 終了で chart buffer を cut + 空 chart を 1 度描画 (= 画面クリア).
      chartBuffer && chartBuffer.clear();
      chartRenderer && chartRenderer.render();
      // 2026-05-19 fix: rideStartedAt を null にする前に走行時間を確定させる。
      // 旧コードは ended で rideStartedAt=null にした後 showPostride → buildRideSummary が
      // 呼ばれるため、 保存される duration_s が常に 0 だった (=「記録の時間が 0」の正体)。
      lastRideDurationS = rideStartedAt
        ? Math.round((performance.now() - rideStartedAt) / 1000) : lastRideDurationS;
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
  if (back) {
    // b115: 戻り先は状況で 2 種。
    //   state-riding (= 実走中、 機器設定だけ見て戻りたい)        → 「ライドに戻る」
    //   mode-view    (= 観るモード中、 設定だけ見て戻りたい)      → 「観るモードに戻る」
    //   それ以外 (= 起動直後 / ride 終了後 / 既定 pairing) → hidden (= 戻り先無し)
    // button 自体は同じ btnClosePairing (= setup-overlay の visible class を消すだけ)、
    // mode-view / state-riding は body class に残るので閉じた瞬間に元の画面状態へ。
    if (document.body.classList.contains('state-riding')) {
      back.hidden = false;
      back.textContent = 'ライドに戻る';
    } else if (document.body.classList.contains('mode-view')) {
      back.hidden = false;
      back.textContent = '観るモードに戻る';
    } else {
      back.hidden = true;
    }
  }
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
      durationS: lastRideDurationS,  // ride 終了で rideStartedAt は null、 確定値を渡す
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
    navigator.clipboard.writeText(text).then(() => { if (statusEl) { statusEl.style.color = '#62d0a2'; statusEl.textContent = '✓ コピー済'; } })
    .catch((err) => { if (statusEl) { statusEl.style.color = '#e56b6f'; statusEl.textContent = `失敗 (${err.message || err})`; } });
    return;
  }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); if (statusEl) { statusEl.style.color = '#62d0a2'; statusEl.textContent = '✓ コピー済'; } }
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
  if (!mapRenderer.isBooted()) { ensureMapBooted().then(() => initBleMode()); return; }
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
  if (mapRenderer.isBooted()) return;
  const env = await bootEnv();
  bootMap(env);
}

function initTestMode() {
  // brief 31: bootMap が未呼出なら map を先に立ち上げる (= ?test=1 経路、 module top dispatch)。
  // 既存 bootCheckSetupStatus 経路から呼ばれた場合 map は既生成、 ensureMapBooted は no-op。
  if (!mapRenderer.isBooted()) { ensureMapBooted().then(() => initTestMode()); return; }
  status('TEST MODE: bridge/trainer 不要、 fake state 1Hz でループ');
  setText('setup-status', 'TEST MODE: 接続スキップ、 ride 開始ボタンが押せる');
  setText('p-device', 'TEST MODE (no trainer)');
  setText('p-state', '✓ TEST MODE');
  updateStepIndicator(-1, 3);
  setRideStartEnabled(true);
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: createFakeStateGenerator(
      () => (rideState ? rideState.snapshot() : null), 'OK (TEST MODE)',
      () => manualPowerW),  // b53: パワースライダー値を fake trainer の power_w に流す
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

// brief 34 ε-6 / task-g: 帰属表示 (#attrib) の display 監視.
// 地図タイルの出典 (= 国土地理院 / OpenStreetMap) を表示する #attrib 要素 (index.html) が
// DevTools 経由で `display:none` を inject される / DOM から消されると ODbL / 国土地理院
// 規約違反、 ただし harm 主体は inject した訪問者本人 (= 第三者には影響しない、 LOAD-BEARING
// 上限) なので block ではなく warning banner を出すだけ。 起動 1 回限定。
// task-g: b12 Phase 4 の Three.js 化で MapLibre 標準 AttributionControl (= DOM class
// `.maplibregl-ctrl-attrib`) が消えたため、 監視対象を index.html の静的要素 #attrib に更新。
function verifyAttributionVisible() {
  try {
    const attribEl = document.getElementById('attrib');
    if (!attribEl) {
      // 出典 DOM (#attrib) が居ない (= 消された) → 出典明示義務違反
      showAttributionWarning('帰属表示要素 (#attrib) が DOM に存在しません');
      return;
    }
    const cs = getComputedStyle(attribEl);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
      showAttributionWarning(`帰属表示が表示されていません (display=${cs.display}, visibility=${cs.visibility}, opacity=${cs.opacity})`);
    }
  } catch (err) {
    // getElementById / getComputedStyle が失敗するのは jsdom 等の test 環境、 silent。
  }
}
function showAttributionWarning(detail) {
  console.warn('[fujihill] 帰属表示が表示されていません:', detail);
  // warning banner を画面上端に表示 (= 既存 #status を借りる、 別 DOM 追加せず軽量).
  const st = document.getElementById('status');
  if (st) {
    st.style.color = '#f0a96a';
    st.textContent = '[警告] 帰属表示 (国土地理院 / OpenStreetMap) が消えています';
  }
}

// b46: 起動シーンの第一段「地形データローダー画面」の show / hide。
// 旧 intro overlay (= 走る/観る/閉じる の 3 択) を作り変えた画面で、 DOM id は
// #intro-overlay のまま (= 既存 z-index CSS / grep test との衝突を最小化)。
// 起動で showTerrainLoader → 「開始」 ボタン押下で地形ロード → 完了で hideTerrainLoader
// → initBleMode (= トレーナー接続) の一本道。
// data-intro-state 属性は state 遷移の e2e pin 用に維持する。
function showTerrainLoader() {
  const ov = document.getElementById('intro-overlay');
  if (ov) {
    ov.classList.add('visible');
    ov.dataset.introState = 'visible';
  }
}
function hideTerrainLoader() {
  const ov = document.getElementById('intro-overlay');
  if (ov) {
    ov.classList.remove('visible');
    ov.dataset.introState = 'hidden';
  }
}
// b46: 地形ロード完了時の遷移。 地形ローダー画面を hide してトレーナー接続画面
// (= initBleMode 経由で #setup-overlay) へ進む。 起動シーンの一本道の終端。
function onTerrainLoaderDone() {
  hideTerrainLoader();
  dispatchAfterIntro();
}
// b46: 観るモードから走るモード (= トレーナー接続画面) へ戻る共通処理。
// body.mode-view を外し、 ride を抜け、 #setup-overlay を表示する。
// 起動シーン一本道化で intro overlay が地形ローダー画面に変わったため、
// 観るモードからの「閉じる」/「最初の画面に戻る」 の戻り先をここに集約した。
function exitViewModeToSetup() {
  if (rideState) rideState.end();
  document.body.classList.remove('mode-view');
  setAppState('pairing');
  if (typeof updatePostrideButtonVisibility === 'function') {
    updatePostrideButtonVisibility();
  }
  document.getElementById('setup-overlay')?.classList.add('visible');
}
// b46: 地形ロード失敗時のエラー表示。 地形ローダー画面に留まり、 エラー文言 +
// 「再試行」 ボタンを出す (= 訪問者がもう一度読み込みを試せる)。
function showTerrainLoaderError(message) {
  const ov = document.getElementById('intro-overlay');
  if (ov) ov.dataset.introState = 'failed';
  const errorEl = document.getElementById('terrain-loader-error');
  if (errorEl) {
    errorEl.textContent = message || '地形データの読み込みに失敗しました。';
    errorEl.hidden = false;
  }
  const statusEl = document.getElementById('terrain-loader-status');
  if (statusEl) statusEl.textContent = '';
  const retryBtn = document.getElementById('btnTerrainLoaderRetry');
  if (retryBtn) retryBtn.hidden = false;
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
// brief 34 ε-8: 「観る」モード section-overlay の hide.
// section-overlay は 10 区間のリストを表示、 行クリックで該当 section.start_idx を rideState に
// inject して fake state ride を開始する。 「閉じる」 button から hide する。
function hideSectionOverlay() {
  const ov = document.getElementById('section-overlay');
  if (ov) ov.classList.remove('visible');
}
// section リストの DOM を course から再構築 (= 「コースを観る」で呼ぶ).
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
    // 2026-05-24 fix: 「最大」 行は max_slope_pct の計算が嘘っぱちで信用できないため削除 (user 指示)。
    // 平均だけ表示。 sec-grade flex-column のまま、 子 span は 1 つだけ。
    const grade = document.createElement('span');
    grade.className = 'sec-grade';
    const gradeAvg = document.createElement('span');
    gradeAvg.className = 'sec-grade-avg';
    gradeAvg.textContent = `平均 ${sec.avg_slope_pct.toFixed(1)}%`;
    grade.appendChild(gradeAvg);
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
  // b46: 地形データローダー画面の「開始」 ボタン bind。
  // 起動シーンの第一段。 押下で地形ロード (terrain_phase.start()) を開始し、 進捗を
  // この画面に表示、 完了でトレーナー接続画面 (#setup-overlay) へ遷移する。
  // 旧 intro 3 ボタン (btnIntroStart / btnIntroView / btnIntroClose) は撤去 ── 走る/観る/
  // 閉じる の選択を廃止し、 起動は常に走るモードの一本道にした (= 観るモードは
  // トレーナー接続画面の「コースを観る」 ボタンから入る)。
  // 「開始」 ボタン押下が GSI/OSM への地形タイル取得の起点 ── これにより配布元への
  // アクセスがユーザーの明示操作の後だけになる (= b46 の同意ゲート実体化)。
  const btnTerrainLoaderStart = document.getElementById('btnTerrainLoaderStart');
  const btnTerrainLoaderRetry = document.getElementById('btnTerrainLoaderRetry');

  // 地形ロードを起動する共通処理 (= 「開始」 / 「再試行」 の両方から呼ぶ)。
  function runTerrainLoaderPhase() {
    const ov = document.getElementById('intro-overlay');
    if (ov) ov.dataset.introState = 'loading';
    // 押下後 UI: 「開始」 ボタンを隠し、 進捗表示を出す。 エラー表示はリセット。
    if (btnTerrainLoaderStart) btnTerrainLoaderStart.hidden = true;
    if (btnTerrainLoaderRetry) btnTerrainLoaderRetry.hidden = true;
    const progress = document.getElementById('terrain-loader-progress');
    if (progress) progress.hidden = false;
    const errorEl = document.getElementById('terrain-loader-error');
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
    const statusEl = document.getElementById('terrain-loader-status');
    if (statusEl) statusEl.textContent = '地形データを読み込んでいます…';
    // brief 35: ロード overlay (= #loading-indicator、 z=2000) を visible 化して
    // 進捗「N / M」 + バーを地形ローダー画面の上に重ねて見せる。 SKIP_TERRAIN
    // (= ?noterrain) のとき showLoadingOverlay は自前で early-return する。
    try { showLoadingOverlay('idle'); } catch (e) { /* document 不在等 silent */ }
    // 地形ロードを起動 (= module-top 自動起動を撤去し、 ここを唯一の起点にした)。
    // _terrainPhase は startTerrainPhase() 内で subscribe 配線され、 進捗は
    // setTerrainStatusUI / updateLoadingProgress 経由で表示される。 done / failed は
    // 下記 subscribe で地形ローダー画面の遷移 / エラー表示に bind する。
    try {
      _terrainPhase = startTerrainPhase();
    } catch (e) {
      console.warn('[fujihill] terrain phase init failed:', e);
      showTerrainLoaderError('地形データの読み込みを開始できませんでした。');
      return;
    }
    if (_terrainPhase) {
      _terrainPhase.subscribe((snap) => {
        if (snap.phase === 'done') {
          onTerrainLoaderDone();
        } else if (snap.phase === 'failed') {
          showTerrainLoaderError(snap.error
            ? `地形データの読み込みに失敗しました (${snap.error})。`
            : '地形データの読み込みに失敗しました。');
        }
      });
    }
  }

  if (btnTerrainLoaderStart) btnTerrainLoaderStart.addEventListener('click', () => {
    runTerrainLoaderPhase();
  });
  if (btnTerrainLoaderRetry) btnTerrainLoaderRetry.addEventListener('click', () => {
    runTerrainLoaderPhase();
  });

  // 2026-05-15 fix: setup-overlay (= トレーナー接続画面) の「コースを観る」 ボタン。
  // b46: 観るモードの唯一の入口に集約。 旧 intro consent への保存をやめ、
  //   body.mode-view class を明示的に add する (= 観るモード判定の唯一の signal)。
  const btnSetupGoView = document.getElementById('btnSetupGoView');
  if (btnSetupGoView) btnSetupGoView.addEventListener('click', () => {
    if (!isActionableNow()) return;
    document.body.classList.add('mode-view');
    document.getElementById('setup-overlay')?.classList.remove('visible');
    initViewMode();
  });

  // brief 34 ε-8: section-overlay の bind (= 「閉じる」 button).
  // b46: 旧「intro overlay に戻る」 (= 走る/観る 選び直し) は撤去。 起動シーンが一本道に
  //   なり intro overlay は地形ローダー画面に変わったため、 観るモードから「閉じる」 で
  //   戻る先はトレーナー接続画面 (#setup-overlay)。 body.mode-view を外して走るモードへ。
  const btnSectionClose = document.getElementById('btnSectionClose');
  if (btnSectionClose) btnSectionClose.addEventListener('click', () => {
    hideSectionOverlay();
    exitViewModeToSetup();
  });
  // 2026-05-19: 観るモードの区間リストパネルから「最初の画面に戻る」 で走るモードへ戻る。
  // 観るモードに入ると右上パネルしか出ず、 走行モードへ戻る導線が無い trap を解消する。
  // b46: 戻り先を intro overlay からトレーナー接続画面 (#setup-overlay) に変更
  //   (= 起動シーン一本道化に伴い、 走る/観る 選び直し UI が消えたため)。
  const btnViewModeExit = document.getElementById('btnViewModeExit');
  if (btnViewModeExit) btnViewModeExit.addEventListener('click', () => {
    exitViewModeToSetup();
  });

  // user 訂正「以前に画面下中央に出てた モード切替 UI が出なくなった」 で復活。
  // 観るモード中も走るモード中も同じ exitViewModeToSetup() を呼んで setup-overlay に戻る
  // (= 走るモード中なら rideState.end() で ride を畳んでから setup へ遷移)。
  const btnSwitchMode = document.getElementById('btnSwitchMode');
  if (btnSwitchMode) btnSwitchMode.addEventListener('click', () => {
    exitViewModeToSetup();
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
// brief 34 ε-2 (= 2026-05-15 user 方向修正反映): static mode (= GitHub Pages 公開サイト) では
// 旧 initMapMode (= 自動 ride デモ) ではなく initBleMode に向かう。 一般訪問者は trainer
// 持参の前提、 Web Bluetooth で自分の trainer を直接 pair する設計。
//
// b46: 旧 introConsented guard を撤去。 地形ロードがボタン起点になり、 配布元への
//   タイル取得はユーザーの「開始」 押下後にしか走らないため、 この関数まで到達した
//   時点で同意ゲートは既に通過済 ── 関数内 guard は不要になった。
function bootCheckSetupStatus() {
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
// b46: 地形ロード完了後の起動分岐。
// 地形データローダー画面の「開始」 押下 → 地形ロード完了 → onTerrainLoaderDone が
// この関数を呼ぶ。 URL 引数経路 (MAP_MODE / TEST_MODE / BRIDGE_MODE = 開発者用) は維持、
// それ以外は default 経路の initBleMode (= Web Bluetooth でトレーナー接続) へ。
//
// b46: 旧 intro consent (= consent.js の intro 同意記憶 / dev bypass / introConsented) と
//   観るモード短絡 (= intro mode が view なら initViewMode へ短絡) を撤去。
//   起動シーンは常に走るモードの一本道にした ── 観るモードはトレーナー接続画面の
//   「コースを観る」 ボタン (#btnSetupGoView) から入る。
function dispatchAfterIntro() {
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
  if (!mapRenderer.isBooted()) { ensureMapBooted().then(() => initViewMode()); return; }
  status('VIEW MODE: 観るモード (= trainer 不要、 区間勾配を眺める)');
  document.body.classList.add('mode-view');
  // 全 overlay を hide してから section-overlay を出す (= 視覚的に他 UI を排他).
  hideDbinit();
  document.getElementById('setup-overlay')?.classList.remove('visible');
  setAppState('pairing');  // riding ではない (= section 選択待ち).
  // fake state client (= TEST_MODE / MAP_MODE と同じ生成器). state-riding は section 選択後.
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: createFakeStateGenerator(
      () => (rideState ? rideState.snapshot() : null), 'OK (VIEW MODE)',
      () => manualPowerW),  // b53: パワースライダー値を fake trainer の power_w に流す
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
        // b83-fix: section click の即時 setSpeed と同時に補間 state 4 値を同期。
        // これをしないと次 tick の線形補間が「古い prev → 新 next」 で再計算して
        // setSpeed(20/3.6) を上書きしてしまい、 ride 開始がじわっと加速になる。
        if (rider) rider.setSpeed(20 / 3.6);
        physicsSpeedMps = 20 / 3.6;
        prevPhysicsSpeedMps = 20 / 3.6;
        displaySpeedMps = 20 / 3.6;
        lastPhysicsStateT = performance.now();
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
//   - btnSetupGoView  (= トレーナー接続画面の「コースを観る」)
//   - btnRideStart    (= ride 開始、 pair 完了とも AND)
//   - section-list の各 li (= 観るモードの区間選択)
//
// b46: 旧 btnIntroStart / btnIntroView の terrain gate は撤去。 起動シーンを地形
//   データローダー画面に作り変え、 地形ロードは「開始」 ボタン (btnTerrainLoaderStart)
//   押下が起点になった ── 「開始」 ボタンを terrain gate で disable したら地形ロード
//   自体を起動できなくなるため、 このボタンは gate 対象にしない。 トレーナー接続画面
//   到達後の btnSetupGoView / btnRideStart / section-list は地形ロード完了済前提なので
//   gate は残すが、 実質常に enabled (= この画面に来た時点で terrainReady===true)。
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

// btnRideStart の disabled と直下のヒント文 (#ride-start-hint) を同期して書き換える単一窓口。
// hint「trainer のハンドシェイク完了後に押せるようになります」 = ボタン無効時の説明文なので、
// enabled===true なら hidden、 false なら表示。 hint を静的 div のまま放置すると
// 「ボタンは緑 (enabled) なのに無効時 hint が残る」 ちぐはぐが起きる (= enable 経路が複数あり
// btnRideStart.disabled だけ書き換えて hint を触らないため)。 button state 従属に一本化する。
function setRideStartEnabled(enabled) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btnRideStart');
  if (btn) btn.disabled = !enabled;
  const hint = document.getElementById('ride-start-hint');
  if (hint) hint.hidden = !!enabled;
}

function updateActionButtonsForTerrain() {
  // b46: 地形データローダー画面の「開始」 ボタンは地形ロードの起点なので terrain gate
  //   しない (= disable したら起動不能になる)。 ここでは触らない。
  // 2026-05-15 fix: トレーナー接続画面の「コースを観る」 ボタンは地形 gate に乗せる
  //   (= user 指摘「観るボタンを地形 Data が揃うまで押せないようにしろ」反映).
  const setupGoView = typeof document !== 'undefined' ? document.getElementById('btnSetupGoView') : null;
  if (setupGoView) setupGoView.disabled = !isActionableNow();
  // 2026-05-15 fix (user 怒り): scan / BLE 系は地形と無関係、 disabled 制御から外す。
  // trainer / 心拍計 pair は走行と独立した話、 地形 load 完了を待たせる理由がない。
  // btnScan / btnScanHrm / btn-ble-* は HTML default に任せる (= viewer が他経路で制御).
  // ride start: terrainReady === false なら強制 disable、 true なら pair 通過済の場合のみ enable.
  // ride start: terrainReady && mapFullyLoaded && pair 完了 が揃った時だけ enable。
  // どの条件が欠けても disabled (= actionable だが pair 未完なら disabled のまま、 既存挙動と等価:
  // disabled=false は connect_status の connected branch でしか立たず、 そこも terrainReady を見る)。
  // setRideStartEnabled に通すことで hint 文の表示/非表示も同時に同期される。
  setRideStartEnabled(isActionableNow() && _pairConnected);
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

// b42: terrain probe (= フェーズ0「地形データ準備」) の起動配線。
// probe の lifecycle オーケストレーション (= URL 構築 / SKIP_TERRAIN 分岐 / loader 生成 /
// GSI direct base / TileCache DI) は terrain_phase.js (createTerrainPhase) へ切り離し済。
// ここは createTerrainPhase を生成し、UI (= terrain status / step) / gate (= terrainReady) /
// ロード overlay を subscribe callback で bind する薄い consumer 配線のみを持つ。
function startTerrainPhase() {
  if (typeof document === 'undefined') return null;
  // SKIP_TERRAIN (= ?noterrain) の分岐は terrain_phase.js 内に 1 本化済。skip 時は loader を
  // 生成せず即 done を emit するため配布元は一切叩かれない。SKIP_TERRAIN 定数自体は
  // showLoadingOverlay の overlay-skip 判断 (= 下の起動ブロック / showLoadingOverlay 内) で
  // viewer 側にも残る。
  const phase = createTerrainPhase({
    basePath: BASE_PATH,
    skipTerrain: SKIP_TERRAIN,
  });
  phase.subscribe((snap) => {
    setTerrainStatusUI(snap);
    updateTerrainStep(snap.phase);
    // brief 35: probe の進捗をロード overlay に bind。 訪問者が「コースを観る」 を click する
    // 前から overlay は visible で「地形タイル取得中 N / M」 が動く ── intro overlay の文章を
    // 読んでいる時間に裏で確実に動いている signal を見せる (= 「死んでる」 と判断されない)。
    if (snap.total > 0) {
      updateLoadingProgress(snap.done, snap.total);
    }
    if (snap.phase === 'done') {
      terrainReady = true;
      updateActionButtonsForTerrain();
      fadeOutLoadingOverlay();
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
  phase.start().catch((e) => {
    console.warn('[fujihill] terrain phase error:', e);
  });
  return phase;
}
// b46: 地形ロードの起点を module-top 自動起動から「開始」 ボタン押下へ移した。
// 旧コードは module 評価時に startTerrainPhase() を呼び、 ユーザー操作と無関係に
// GSI / pmtiles を叩いていた (= intro 表示中に既に配布元へアクセス済)。
// 新コードでは地形データローダー画面の「開始」 ボタン click handler
// (= runTerrainLoaderPhase) からのみ startTerrainPhase() を呼ぶ ── 配布元への
// タイル取得がユーザーの明示操作の後だけになる (= b46 の同意ゲート実体化)。
// _terrainPhase は runTerrainLoaderPhase 内で代入される (= startTerrainPhase の結果)。
let _terrainPhase = null;

// 起動時の未完了 ride 復元 dialog。
// 2026-05-18 (ユーザー指示): 復元機能は中身が未完成で実質機能していないため、 起動時に
// dialog を出さない。 checkRestoreThenDispatch は復元チェックを skip し、 通常起動
// (= defaultDispatch → 地形データローダー画面) に直行する。
// 下の autosave 検査コード・showRestoreDialog・applyPendingRestore は、 復元機能が
// 完成した時に再有効化するため削除せず残す (= SKIP_RESTORE を false に戻せば復活)。
// 復元有効時の旧条件: new URLSearchParams(location.search).get('nopreflight') === '1'
const SKIP_RESTORE = true;
// b46: 起動シーンの第一段。 地形データローダー画面を表示してユーザーの「開始」 押下を
//   待つ。 旧コードは introConsented() を見て consent 済なら dispatchAfterIntro へ直行
//   していたが、 起動シーンを一本道にした (= 同意記憶による分岐を撤去)。
//   開発者用 URL 引数経路 (?map / ?test / ?ble / ?bridge) は地形ローダー画面を介さず
//   即起動するため、 地形ロードもここで起動してから dispatchAfterIntro へ ──
//   本人の動作確認 path を保つ (= 一般訪問者は「開始」 ボタン経由のみ)。
function defaultDispatch() {
  if (MAP_MODE || TEST_MODE || BLE_MODE || BRIDGE_MODE) {
    if (typeof window !== 'undefined' && typeof globalThis.fetch === 'function') {
      try { showLoadingOverlay('idle'); } catch (e) { /* document 不在等 silent */ }
      try { _terrainPhase = startTerrainPhase(); } catch (e) { console.warn('[fujihill] terrain phase init failed:', e); }
    }
    dispatchAfterIntro();
  } else {
    showTerrainLoader();
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
// 2026-05-17 fix: ride 開始が rideState 生成より先に要求された時の保留フラグ.
// TEST MODE の自動 ride 開始 (initTestMode の 500ms タイマー) は loadCourse が
// rideState を生成し終わる前に startRideConfirmed を呼ぶことがあり、
// `if (rideState) rideState.start()` が空振りして rider が active にならず
// (= 既定の paused/inactive のまま) 永久に走り出さなかった。 開始要求をこのフラグに
// 保留し、 loadCourse が rideState を生成した直後に消費して rider を start する。
let _pendingRideStart = false;
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
  if (!mapRenderer.isBooted()) { ensureMapBooted().then(() => initMapMode()); return; }  // brief 31
  status('MAP MODE: UI 操作なしで地図表示のみ確認');
  // 全 overlay を hide (= 視界をクリアにして地図 + HUD + minimap だけ見せる)
  hideDbinit();
  document.getElementById('setup-overlay')?.classList.remove('visible');
  setAppState('riding');
  // ?map=1&z=14&pitch=30 で zoom / pitch を override 可 (= OSM 道路 / 建物の細線確認に zoom out 必須)
  const params = new URLSearchParams(location.search);
  const zParam = parseFloat(params.get('z'));
  const pitchParam = parseFloat(params.get('pitch'));
  const camDefaults = {};
  if (Number.isFinite(zParam) && zParam >= 13 && zParam <= 24) camDefaults.zoom = zParam;
  if (Number.isFinite(pitchParam) && pitchParam >= 0 && pitchParam <= 85) camDefaults.pitch = pitchParam;
  mapRenderer.setCameraDefaults(camDefaults);
  // TEST_MODE と同じ fake client (= bridge / trainer 不要)
  client = createTestModeClient(wsHandlers, {
    fakeStateInterval: 1000,
    fakeStateGenerator: createFakeStateGenerator(
      () => (rideState ? rideState.snapshot() : null), 'OK (MAP MODE)',
      () => manualPowerW),  // b53: パワースライダー値を fake trainer の power_w に流す
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
  mapRenderer.onceIdle(() => { mapIdle = true; tryStart(); });
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
  // dbinit overlay を閉じる (= 「もうやめる」)。
  // b46: 旧「intro overlay を再表示」 は撤去。 起動シーン一本道化で intro overlay は
  //   地形ローダー画面 (= 地形ロード前の画面) に変わり、 地形ロード済の dbinit から
  //   そこへ戻すのは不整合。 戻り先はトレーナー接続画面 (#setup-overlay)。
  _advancedFromDbinit = false;
  hideDbinit();
  setAppState('pairing');
  document.getElementById('setup-overlay')?.classList.add('visible');
}

// === コース読み込み ===
async function loadCourse() {
  // brief 31 commit β: ENV (= immutable env object) から URL を取得。
  // bootEnv() で freeze 済の値、 caller 全部 await 経由なので未確定状態で呼ばれることはない。
  // 万一 ENV 未初期化なら bridge mode の旧 default で fallback (= localhost 起動の従来挙動)。
  const url = ENV ? ENV.courseUrl : 'course.json';
  // b50: fetch → 平滑化 → terrain 構築の純粋部は course_loader.js に切り出し済。
  //   失敗時の status 文言は旧挙動を維持 ── 空 course は「course.json empty」、
  //   それ以外 (HTTP / network / JSON parse) は「course.json load failed: …」。
  let loaded;
  try {
    loaded = await loadCourseData(url);
  } catch (err) {
    const msg = err && err.message;
    if (msg === 'course.json empty') status('course.json empty');
    else status(`course.json load failed: ${msg}`);
    return;
  }
  course = loaded.course;
  // brief 35: Terrain + Rider を viewer の 1 source-of-truth として確立.
  // rideState (= 後方互換 shim) は内部で同じ Rider を保持するので、 viewer 側の rider 変数と
  // shim 内 Rider は完全同一 instance、 二重 state にならない (= _rider 公開で共有).
  terrain = loaded.terrain;
  rideState = createRideState(course);
  // shim 内 Rider と新 viewer 経路の rider を一致させる. 別 instance を作ると進行 state が
  // 二重管理になって drift する (= 過去 brief 19 の curIdx 二重持ち bug と同型予防).
  rider = rideState._rider;
  // 起動時の autosave 復元が pending なら、 ここで rideState を進めた状態に持ち上げる.
  applyPendingRestore();
  // 2026-05-17 fix: ride 開始が rideState 生成前に要求されていた場合 (= TEST MODE の
  // 自動 ride 開始が loadCourse を追い越す race)、 ここで保留分を消費して rider を start。
  // restore が走った場合は rider が既に active なので二重 start しない (= 距離 0 リセット回避)。
  if (_pendingRideStart) {
    _pendingRideStart = false;
    if (!rideState.snapshot().active) rideState.start();
  }
  // rider-position-model: 距離スケールは terrain の haversine 累積長に一本化する。
  // course.json の distance_m は smoothCourse が lat/lon を平滑化しても再計算されず
  // メモリ内で食い違う壊れた目盛り。 totalDist を terrain.totalDistance にすると
  // viewer / rider / minimap / __goalTest が同じ haversine 距離スケールを共有する。
  totalDist = terrain.totalDistance;
  hud.total(totalDist);
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  // b12 Phase 2.5: 勾配色の道路リボン / 距離ラベル / 起点終点マーカー / ライダー層の
  // 構築と初期カメラ寄せは map_renderer.renderCourse に集約。 GeoJSON 組み立て・
  // レイヤー定義・mesh cache はすべて地図描画モジュールの中に閉じる。
  // 通常起動は走行視点 (zoom 21 / pitch 85)、 MAP_MODE は initMapMode が URL 引数で
  // カメラ default を設定済なのでここでは触らない。
  if (!MAP_MODE) {
    mapRenderer.setCameraDefaults({ zoom: 21, pitch: 85 });
  }
  await mapRenderer.renderCourse(course);
  // b39: 富士ヒル公式 7 landmark を course.json に snap して 3D 走路に立てる。
  // course.json と FUJIHC_LANDMARKS の data 都合は course_landmarks.js が SoT。
  // scene 直接 touch は viewer-maplibre.js では禁止 (= mapRenderer.setLandmarks 経由必須)。
  const snappedLandmarks = snapLandmarksToCourse(FUJIHC_LANDMARKS, course);
  mapRenderer.setLandmarks(snappedLandmarks);
  // ride 中は start/goal マーカーをメイン map から hide する (= 現 body state に追随)。
  updateStartGoalVisibility();

  // brief 29: minimap は MapLibre 非依存の Canvas 2D 直描画。 course load 完了後 1 回だけ。
  // b51: minimap.js に切り出し済。buildTopBase は async (= OSM タイル fetch 完了待ち)、
  //   await はせず fire-and-forget。env / 各 base URL は viewer 側の値を渡す。
  minimap.buildTopBase({
    course, env: ENV, bridgeTileBase: BRIDGE_TILE_BASE_URL,
    httpBase: HTTP_BASE_URL, skipTerrain: SKIP_TERRAIN,
  });
  minimap.buildBottomBase({ course, terrain });

  lastT = performance.now();
  requestAnimationFrame(tick);
}

function tick(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  _tickCount++;  // 描画ループ生存カウンタ (= TEST_MODE で window.__goalTest.frames から観測)。
  if (!rider || !rideState) { requestAnimationFrame(tick); return; }

  // brief 35: 1 source-of-truth 化. 旧 viewer は tick 内で curIdx / curDist / 補間 frac /
  // courseBearing / smoothBearing / riderHeadingRad / spinAngle を全部 inline 計算していたが、
  // すべて rider.tick + rider.snapshot.position に集約済. viewer は snapshot を描画に流すだけ.
  // b83-fix: 1Hz 物理速度を rAF 60Hz に線形補間。 wsHandlers.state が 1 秒ごとに
  // physicsSpeedMps を更新 + prevPhysicsSpeedMps に「表示中の値」 を seed、 ここで
  // 経過 elapsed / EXPECTED_STATE_DT を比率に prev → next を線形に繋ぐ。
  // EMA と違い「階段を 60Hz で消す」 効果が確実、 定常偏差なし。 物理急変 (= ペダル踏み始め
  // / 止め) は次の state push 時の seed 更新で「現在値」 から滑らかに新目標へ進む。
  if (Number.isFinite(physicsSpeedMps) && physicsSpeedMps >= 0 && lastPhysicsStateT != null) {
    const elapsed = (t - lastPhysicsStateT) / 1000;
    const frac = Math.min(1, Math.max(0, elapsed / EXPECTED_STATE_DT));
    displaySpeedMps = prevPhysicsSpeedMps + (physicsSpeedMps - prevPhysicsSpeedMps) * frac;
    rider.setSpeed(displaySpeedMps);
  }
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

  // b83-fix2: updateRider を updateCamera より先に呼ぶ。 旧順序は updateCamera が
  // lastRiderPlacement (= 前フレームの updateRider が書いた値) を target にしていて、
  // 構造的 1-frame lag が「カメラとライダーの差」 として user に見えていた。
  // sub-agent review 結論: rider mesh を現フレーム位置に更新してから camera が同フレームの
  // lastRiderPlacement を読むようにすれば lag が消える。
  mapRenderer.updateRider({ course, curIdx, lat: rLat, lon: rLon, spin: snap.spinAngle });

  // b12 Phase 2.5: カメラ追随は map_renderer.updateCamera に委譲。 bearing 補間や
  // 横ドラッグ offset の合成は地図描画モジュールの中。 apply=false の時 (= ride 開始前で
  // map idle 待ち) は camera を動かさず進行方位だけ計算して返す (= idle 発火を妨げない)。
  // 戻り値 headingRad は minimap の rider 矢印、 bearingDeg は debug HUD が使う。
  const camResult = mapRenderer.updateCamera({
    course,
    curIdx,
    fracInSegment: pos.fracInSegment,
    lon: rLon,
    lat: rLat,
    lookAhead: 5,
    apply: course.length > 0 && (snap.active || mapFullyLoaded),
  });
  const riderHeadingRad = camResult.headingRad;

  // ライド HUD (時間/距離/標高/勾配) は hud に集約。 ride 未開始は elapsedSec=null
  // → "00:00:00"。 rider 追随 HUD の slope は常時更新 (= Terrain 経由で取得)。
  const elapsedSec = rideStartedAt !== null
    ? Math.floor((performance.now() - rideStartedAt) / 1000)
    : null;
  hud.ride({ elapsedSec, dist: curDist, ele: rEle, slope: pos.slope_pct });
  // b99: 1 Hz で chart buffer に push、 4 Hz で render. paused / elapsedSec<0 は
  // decideChartPush (= pure helper) 内で skip 判定、 viewer 側は state を渡すだけ.
  maybePushAndRenderChart(elapsedSec, snap.paused);

  // b39: ゴール ETA。 paused / 開始 30 秒以内は avgSpeed_kmh を NaN にして渡し、
  // hud 側の整形規律 (= NaN → "--") に判定を移譲する (= hud SoT 規律維持)。
  const paused = !rideStartedAt;
  const avgSpeedForEta = (paused || elapsedSec == null || elapsedSec < 30 || curDist <= 0)
    ? NaN
    : (curDist / elapsedSec * 3.6);  // m/s → km/h
  hud.eta({ remainingDist_m: totalDist - curDist, avgSpeed_kmh: avgSpeedForEta });

  // b9: 距離ラベルの表示窓を rider 現在地に追従させる (= 50m 刻みの間引きは renderer 内)。
  mapRenderer.updateLabelWindow(curDist);
  // #rider-hud は CSS で画面中央上部に固定。 state-riding の時だけ表示。
  hud.riderHudVisible(document.body.classList.contains('state-riding'));
  // デバッグ: 現在の camera zoom / pitch を HUD に表示 (user が好みの値を確認 → default 化に使う)
  const camInfo = mapRenderer.getCameraInfo();
  setText('cam-zoom', camInfo.zoom.toFixed(2));
  setText('cam-pitch', camInfo.pitch.toFixed(0));
  // 2026-05-16: ?debug=1 用の数値 dump (= body.debug-on で右上 panel に表示).
  // user 「座標が外れる」「慣性力おかしい」 を走行中に数値で目視できる. setText は要素無しでも noop.
  // brief b2 High-4: ?debug=1 の時だけ実行 (= 平時は getElementById + textContent + trkpt
  // 走査の毎フレーム 30 件超を丸ごと skip)。
  if (DEBUG_HUD) {
  const EARTH_M_PER_DEG_DBG = 111000;
  const cosLatDbg = Math.cos(rLat * Math.PI / 180);
  const dxDbg = (camInfo.centerLng - rLon) * EARTH_M_PER_DEG_DBG * cosLatDbg;
  const dzDbg = (camInfo.centerLat - rLat) * EARTH_M_PER_DEG_DBG;
  const camDriftM = Math.sqrt(dxDbg * dxDbg + dzDbg * dzDbg);
  const dtMs = dt * 1000;
  setText('d-rider-lat', rLat.toFixed(7));
  setText('d-rider-lon', rLon.toFixed(7));
  setText('d-cam-lat', camInfo.centerLat.toFixed(7));
  setText('d-cam-lon', camInfo.centerLng.toFixed(7));
  setText('d-cam-drift', camDriftM.toFixed(2));
  setText('d-dist', curDist.toFixed(1));
  setText('d-speed', snap.speed.toFixed(3));
  setText('d-speed-kmh', (snap.speed * 3.6).toFixed(1));
  setText('d-seg', String(pos.segmentIdx));
  setText('d-frac', pos.fracInSegment.toFixed(3));
  setText('d-slope', pos.slope_pct.toFixed(2));
  setText('d-brng', camResult.bearingDeg.toFixed(1));
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
          dEl.style.color = '#62d0a2';
        } else {
          dEl.textContent = checks.join(' ');
          dEl.style.color = '#e56b6f';
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
  // minimap には rider 進行方向 (riderHeadingRad) を渡す。
  minimap.update(curDist, rEle, rLat, rLon, riderHeadingRad);
  const dispKmh = snap.speed * speedMult * 3.6;
  const connected = !!(client && client.isOpen());
  hud.speed(dispKmh, { paused: snap.paused, connected });
  // b99: chart 用 snapshot. 物理速度更新時に最新値を保持.
  _lastSpeed = dispKmh;

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
  // b12 Phase 2.5: 1 フレーム描画を地図描画モジュールに頼む。 MapLibre は状態変化で
  // 自動再描画するため現状は no-op、 Three.js 実装ではここで scene を描く。
  mapRenderer.render();
  // 2026-05-15 fix: 完走時に手動で「ライド終了」 button を押さないと postride に
  // 行けない bug を解消。 atGoal 到達で 1 度だけ自動的に rideState.end + sendRideEnd
  // (= btnRideEnd の click と同経路) を発火、 ride_status('ended') → showPostride。
  // _autoEnded flag で再発火を防止 (= ride 再開しない限り 2 回目は呼ばない).
  if (rider.atGoal && !_autoEnded) {
    status('完走');
    _autoEnded = true;
    if (rideState) rideState.end();
    if (client && client.isOpen()) client.sendRideEnd();
  }
  // ゴール到達後もループを止めない。 過去はここで atGoal の時 requestAnimationFrame を
  // 呼ばず、 viewer 全体 (カメラ操作・HUD・描画) が固まりリロードしか復帰手段が
  // 無かった。 ride は上で rideState.end() 済 (非アクティブ) なので、 trkpt 蓄積と
  // autosave は tick 冒頭の snap.active ゲートで自然に止まり、 ゴール後にループが
  // 回り続けても永続データへの書き込みは増えない。
  requestAnimationFrame(tick);
}
let _autoEnded = false;
let _tickCount = 0;  // tick 呼び出し回数。 描画ループが生きているかの観測点。

// TEST_MODE 限定: e2e ジャーニーテストがゴール手前へ rider を置く / 描画ループの
// 生存・ride 状態を観測するためのフック。 本番経路 (TEST_MODE=false) では定義されない。
if (TEST_MODE) {
  window.__goalTest = {
    // rider をゴール手前 15m へ置く ── そこから最後の区間を実際に走らせて
    // ゴール到達させる (= ゴール直前から走った走行ログを残すための仕込み)。
    // placeAtDistance は clampDist 経由でコース範囲にクランプされる。
    seekToNearGoal() { if (rider && totalDist > 0) rider.placeAtDistance(totalDist - 15); },
    // tick が回るたび増える ── ゴール後も増え続ければ「固まっていない」。
    get frames() { return _tickCount; },
    get info() {
      if (!rider) return null;
      return {
        atGoal: rider.atGoal,
        dist: rider.distanceTraveled,
        viewerTotalDist: totalDist,
        active: rider.active,
        // viewer の tick は rideState.appendTrkpt 経由で trkpt を貯める (shim が
        // Rider とは別の独自 trkpts buffer を持つ ── ride_state.js 参照)。 観測も
        // そちらを読む。
        trkpts: rideState ? rideState.getTrkpts().length : 0,
      };
    },
    // b62: 大気散乱 uniform の観測口 ── e2e が atmosphere スライダー操作で
    // uniform が実際に変わったことを assert するため。scene 未生成なら null。
    get atmo() { return mapRenderer.getAtmosphereUniforms(); },
  };
}

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
  // b47: 実走の開始は「観るモードではない」 ことが確定する瞬間。 観るモード中に
  //   btnOpenPairing でトレーナー接続画面を開き、 そこから btnRideStart を押した経路
  //   では mode-view フラグが残り「実走中かつ観るモード」 の矛盾状態になる
  //   (= 区間リストパネルが出っ放し / 走行記録が観るモード扱いでブロック)。
  //   実走開始の唯一の窓口でフラグを強制解除し、 経路に依らず矛盾状態を断つ。
  document.body.classList.remove('mode-view');
  if (rideState) rideState.start();
  else _pendingRideStart = true;  // rideState 未生成: loadCourse 完了時に start を適用
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
    onCancel: () => {
      // cancel 経路で pair 画面に戻れるよう setup-overlay を復元 (= 既に ride 中なら出さない).
      if (!document.body.classList.contains('state-riding')) {
        document.getElementById('setup-overlay')?.classList.add('visible');
      }
    },
  });
  // preflight-overlay (z=1465) は setup-overlay (z=1500) より下。 setup が visible のまま
  // preflight を出すと完全に背後に隠れ、「ライド開始を押しても何も起きない」状態になる
  // (= consent-overlay と同型 bug、 2026-05-15 の ε-3 fix と同じ構造)。 setup-overlay を
  // 一旦 hide して preflight を露出させる。 onStart → startRideConfirmed → ride_status:started
  // → hidePairing が setup を二重 hide するが冪等。
  document.getElementById('setup-overlay')?.classList.remove('visible');
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
  // b83-fix: section click と同型の補間 state 4 値同期 (= 次 tick で線形補間が「古い prev」
  //   から再計算して setSpeed を上書きする副次バグの防止)。
  if (rider) rider.setSpeed(20 / 3.6);
  physicsSpeedMps = 20 / 3.6;
  prevPhysicsSpeedMps = 20 / 3.6;
  displaySpeedMps = 20 / 3.6;
  lastPhysicsStateT = performance.now();
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
document.getElementById('btnOpenPairing').addEventListener('click', () => {
  // b115: 機器設定 button は overlay を出すだけ。 mode-view 解除は startRideConfirmed
  //   (= 実走開始の唯一の窓口、 line ~2218) が担う ── 経路に依らず矛盾状態を断つ規律は
  //   そこで満たされる。 btnOpenPairing で先回り解除すると「観るモード中に機器設定だけ
  //   見て元のコース状態に戻る」 動線が消える (= user 2026-05-26 訂正)。
  //   観るモード中に閉じる (btnClosePairing) で overlay を消すと mode-view が残り
  //   観るモードに復帰、 ライド開始 (btnRideStart) を押せば startRideConfirmed が
  //   mode-view を解除して b47 invariant を満たす。
  showPairing();
});
document.getElementById('btnClosePairing').addEventListener('click', () => {
  document.getElementById('setup-overlay').classList.remove('visible');
});

// b13-1: 旧5系統スライダー配線を共通機構に一本化。
// 形式不一致の旧キーを先に消去 (inertiaKg / mass は生値一致のため保持)。
['fujihill.diff','fujihill.spd','fujihill.crr','fujihill.cda','fujihill.labelSize'].forEach(k => { try { localStorage.removeItem(k); } catch {} });
// b89: 旧 CONTROL_DEFS 単一配列を 3 カテゴリに分離 (= 自機挙動 / コース環境 / 大気環境)、
// 各カテゴリを別 mountControlPanel で独立フォールド。 panel 名と def の対応:
//   BIKE_DEFS       = 「自機挙動」 (= 負荷 / 速度 / 慣性 / 質量 / 物理係数 / パワー / 自機表示)
//   COURSE_DEFS     = 「コース環境」 (= ラベル / コース幅 / 路面高さ)
//   ATMO_DEFS       = 「大気環境」 (= 光源 / 大気散乱 / 空の青さ / 太陽倍率)
const BIKE_DEFS = [
  { key:'diff',       label:'負荷',        min:10,  max:200,  step:5,  value:100, unit:'%',      format:raw=>String(Math.round(raw)),      apply(raw){ diffMult=raw/100; lastSlopeSent=null; } },
  { key:'spd',        label:'速度倍率',    min:50,  max:200,  step:5,  value:100, unit:'x',      format:raw=>(raw/100).toFixed(2),         apply(raw){ speedMult=raw/100; } },
  { key:'inertiaKg',  label:'慣性',        min:0,   max:3000, step:50, value:800, unit:'kg相当', format:raw=>String(Math.round(raw)),      apply(raw){ inertiaKg=raw; } },
  { key:'mass',       label:'質量',        min:60,  max:110,  step:1,  value:88,  unit:'kg',     format:raw=>String(Math.round(raw)),      apply(raw){ bikeMass=raw; } },
  { key:'crr',        label:'転がり抵抗',  min:1,   max:25,   step:1,  value:1,   unit:'‰',      format:raw=>String(Math.round(raw)),      apply(raw){ bikeCrr=raw/1000; } },
  { key:'cda',        label:'空気抵抗',    min:18,  max:60,   step:1,  value:35,  unit:'m²',     format:raw=>(raw/100).toFixed(2),         apply(raw){ bikeCda=raw/100; } },
  // b53: 観る / デモ / TEST モードの手動パワー。 range 50–600W は一般的なロード走の
  // 出力域 (ホビー巡航 100–200W、 競技 250–400W、 スプリント上限 600W 強) を覆う。
  // step 10W は微調整に十分な粒度。 trainer 接続中の実ライドには効かない (上記 manualPowerW)。
  { key:'power',      label:'パワー',      min:50,  max:600,  step:10, value:250, unit:'W',      format:raw=>String(Math.round(raw)),      apply(raw){ manualPowerW=raw; } },
  { key:'riderScale', label:'ライダー倍率', min:10,  max:500,  step:5,  value:36,  unit:'x',      format:raw=>(raw/10).toFixed(1),          apply(raw){ mapRenderer.setRiderScale(raw/10); } },
];
const COURSE_DEFS = [
  { key:'labelSize',  label:'ラベルサイズ', min:40,  max:200,  step:10, value:100, unit:'x',      format:raw=>(raw/100).toFixed(1),         apply(raw){ labelSizeScale=raw/100; mapRenderer.setLabelScale(raw/100); } },
  { key:'courseWidth',label:'コース幅',     min:4,   max:40,   step:2,  value:10,  unit:'m',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setCourseWidth(raw); } },
  { key:'roadHeight', label:'路面高さ',     min:0,   max:30,   step:1,  value:2,   unit:'m',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setRoadHeight(raw); } },
  { key:'labelHeight',label:'ラベル高さ',   min:1,   max:20,   step:1,  value:2,   unit:'m',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setLabelHeight(raw); } },
];
// b79 (b114 で hoist): 雲量 slider state。 AMeDAS fetch は 1 起動 1 回 (= 配布元負荷ゼロ)、
// slider 操作は currentBaseWeather × 倍率を mapRenderer.setWeatherClouds に流すだけで
// 再 fetch しない。 localStorage 'fujihill.cloudAmount' で永続、 mountControlPanel が読み書き
// を担う ── 初期 mount で apply(localStorage 値) が呼ばれ、 currentCloudAmount が上書きされる
// 順序。 b114 で「天候」 panel 内の独立 mount から「大気環境」 ATMO_DEFS 統合 mount に
// 移したため、 ATMO_DEFS の apply からこの state を読む必要があり file-scope で先に宣言。
let currentBaseWeather = null;
let currentCloudAmount = 0;  // b79 user 指示: default 0 (= 雲オミットで起動、 slider で 1.0 まで上げて確認用)

const ATMO_DEFS = [
  { key:'lightDir',   label:'光源方向',    min:0,   max:360,  step:5,  value:135, unit:'°',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setSunlightDirection(raw); setText('dbgLightDir',String(Math.round(raw))); } },
  { key:'lightStr',   label:'光源強度',    min:0,   max:100,  step:5,  value:100, unit:'%',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setSunlightStrength(raw/100); setText('dbgLightExag',(raw/100).toFixed(2)); } },
  // b62: 大気散乱 (aerial perspective) の調整スライダー 4 本。 atmosphere3d.js の散乱
  //   パラメータを mapRenderer.setAtmosphereParams 経由で実行時に差し替える。 太陽方位は
  //   既存 lightDir が兼ねる (= 仰角は方位由来 SoT、 大気の太陽は scene の applySun が
  //   同期する) ので方位/仰角スライダーは足さない。 Rayleigh (青み) は空気分子由来の
  //   物理定数なのでスライダーにしない ── 日々変わるのは Mie (もや) なので調整は Mie に
  //   絞る。 各 def の raw 値の表現はコメント参照。
  // atmoMie: raw = ATMO_BETA_MIE 生値 ×10⁶ (raw 0 = 0)。 value 0 は const ATMO_BETA_MIE
  //   と同 default (= b71 で user 画面値に合わせて 5 → 0)。 0 = 純 Rayleigh、 42 = 白濁端。
  { key:'atmoMie',     label:'大気 かすみ(Mie)',  min:0,   max:42,   step:1,  value:0,   unit:'×10⁻⁶', format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setAtmosphereParams({ betaMie: raw*1e-6 }); } },
  // atmoG: raw = ATMO_MIE_G ×100 (raw 0 = g 0)。 b71 で user 画面値 0 に。 95 で止める (HG は g→1 で発散)。
  { key:'atmoG',       label:'大気 Mie異方性 g',  min:0,   max:95,   step:5,  value:0,   unit:'g',      format:raw=>(raw/100).toFixed(2),         apply(raw){ mapRenderer.setAtmosphereParams({ mieG: raw/100 }); } },
  // atmoDensity: raw = ATMO_DENSITY ×10 (raw 10 = density 1.0)。 b71 で user 画面値 1.0 に (= 3.5 から)。
  { key:'atmoDensity', label:'大気 散乱密度',     min:5,   max:80,   step:1,  value:10,  unit:'x',      format:raw=>(raw/10).toFixed(1),          apply(raw){ mapRenderer.setAtmosphereParams({ density: raw/10 }); } },
  // skyIntensity: raw 0..200 = 天頂色濃度の倍率 ×100。 0 = 天頂が白 (空の青さゼロ)、
  //   100 = 標準 (= SKY_ZENITH の現状色)、 200 = 深い夜空寄りの濃紺。 背景スフィア
  //   (= scene.js buildSkyDome の vertex color グラデーション) の天頂色だけ動かす。
  //   地平線色 (SKY_HORIZON、 朝霞) は不変。 大気散乱 (atmoMie / atmoRayleighScale) とは
  //   別レイヤー (= 背景球の塗り) なので独立に動く。
  { key:'skyIntensity',label:'大気 空の青さ',     min:0,   max:200,  step:5,  value:100, unit:'%',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setSkyIntensity(raw/100); } },
  // atmoSun: raw = sunScale ×100 (raw 100 = 1.0 倍)。 ATMO_SUN_COLOR に掛ける露出相当の倍率。
  { key:'atmoSun',     label:'大気 太陽倍率',     min:30,  max:250,  step:10, value:100, unit:'%',      format:raw=>String(Math.round(raw)),      apply(raw){ mapRenderer.setAtmosphereParams({ sunScale: raw/100 }); } },
  // b114: 雲量 slider を b79 の独立 mount (= 天候 panel 直下の #weather-sliders) から
  //   ATMO_DEFS 統合 mount に移植。 AMeDAS 物理算出値 (cloudCover) に user 主観倍率 0..1 を掛けて
  //   mapRenderer.setWeatherClouds に流す ── apply は (a) currentCloudAmount を更新、
  //   (b) AMeDAS fetch 済み (= currentBaseWeather 非 null) かつ Pages 環境でなければ
  //   applyCloudAmountToMap で再適用。 mount は file 起動直後 (AMeDAS 来る前) でも localStorage
  //   値で値が復元されて currentCloudAmount は正しく seed される、 雲は AMeDAS 到着後の
  //   applyAmedasCloudsToPanel で currentCloudAmount 経由で適用される。
  { key:'cloudAmount', label:'雲量',              min:0,   max:1,    step:0.05, value:0, unit:'%',      format:raw=>`${Math.round(raw*100)}`,
    apply(raw){
      currentCloudAmount = raw;
      if (currentBaseWeather && ENV?.mode !== 'static') {
        applyCloudAmountToMap(mapRenderer, currentBaseWeather, raw);
      }
    } },
];
// b82: 自機の画面縦位置を slider で可変 (= orbit lookUp ratio、 0 で画面中央、 0.3 で画面下端寄り)。
//   ratio=0.1 で「上から 約 77%」、 0.15 で「約 82%」、 0.2 で「約 86%」 (= fov 50° 縦半幅 25° に対する比例)。
//   user 触って好みの位置に。 b89: 自機挙動カテゴリの末尾に push (= def 配列定義後)。
BIKE_DEFS.push({ key:'riderScreenPos', label:'自機 縦位置', min:0, max:0.3, step:0.01, value:0.3, format:raw=>raw.toFixed(2), apply(raw){ mapRenderer.setOrbitLookUpRatio(raw); } });

// b89: 3 カテゴリを別 panel で mount、 全 collapsed:true で初期は畳む (= 旧挙動と整合)。
mountControlPanel(document.getElementById('control-sliders-bike'),   BIKE_DEFS,   {collapsible:true, title:'自機挙動',  collapsed:true});
mountControlPanel(document.getElementById('control-sliders-course'), COURSE_DEFS, {collapsible:true, title:'コース環境', collapsed:true});
mountControlPanel(document.getElementById('control-sliders-atmo'),   ATMO_DEFS,   {collapsible:true, title:'大気環境',  collapsed:true});

// 自機 (自転車) の部品ごと形状エディタ。 各スライダーが bikeShape の 1 フィールドを
// 更新し、 mapRenderer.setRiderShape で自転車を組み直す。 control_panel が
// localStorage 永続 (fujihill.bike*) を担う。 「調整」 とは別の折りたたみパネルにする。
const bikeShape = { ...BIKE_SHAPE_DEFAULTS };
const BIKE_SHAPE_DEFS = [
  { key:'bikeWheelR',     label:'車輪 半径',      min:BIKE_SHAPE_RANGE.wheelR[0],     max:BIKE_SHAPE_RANGE.wheelR[1],     step:0.01,  value:BIKE_SHAPE_DEFAULTS.wheelR,     unit:'m', format:raw=>raw.toFixed(2), apply(raw){ bikeShape.wheelR=raw;     mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeTubeR',      label:'タイヤ 太さ',    min:BIKE_SHAPE_RANGE.tubeR[0],      max:BIKE_SHAPE_RANGE.tubeR[1],      step:0.002, value:BIKE_SHAPE_DEFAULTS.tubeR,      unit:'m', format:raw=>raw.toFixed(3), apply(raw){ bikeShape.tubeR=raw;      mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeWheelbase',  label:'ホイールベース', min:BIKE_SHAPE_RANGE.wheelbase[0],  max:BIKE_SHAPE_RANGE.wheelbase[1],  step:0.05,  value:BIKE_SHAPE_DEFAULTS.wheelbase, unit:'x', format:raw=>raw.toFixed(2), apply(raw){ bikeShape.wheelbase=raw;  mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeFrameThick', label:'フレーム 太さ',  min:BIKE_SHAPE_RANGE.frameThick[0], max:BIKE_SHAPE_RANGE.frameThick[1], step:0.002, value:BIKE_SHAPE_DEFAULTS.frameThick,unit:'m', format:raw=>raw.toFixed(3), apply(raw){ bikeShape.frameThick=raw; mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeSaddleY',    label:'サドル 高さ',    min:BIKE_SHAPE_RANGE.saddleY[0],    max:BIKE_SHAPE_RANGE.saddleY[1],    step:0.01,  value:BIKE_SHAPE_DEFAULTS.saddleY,   unit:'m', format:raw=>raw.toFixed(2), apply(raw){ bikeShape.saddleY=raw;    mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeBarY',       label:'ハンドル 高さ',  min:BIKE_SHAPE_RANGE.barY[0],       max:BIKE_SHAPE_RANGE.barY[1],       step:0.01,  value:BIKE_SHAPE_DEFAULTS.barY,      unit:'m', format:raw=>raw.toFixed(2), apply(raw){ bikeShape.barY=raw;       mapRenderer.setRiderShape(bikeShape); } },
  { key:'bikeBarW',       label:'ハンドル 幅',    min:BIKE_SHAPE_RANGE.barW[0],       max:BIKE_SHAPE_RANGE.barW[1],       step:0.01,  value:BIKE_SHAPE_DEFAULTS.barW,      unit:'m', format:raw=>raw.toFixed(2), apply(raw){ bikeShape.barW=raw;       mapRenderer.setRiderShape(bikeShape); } },
  // 影ボード: オン=影が自機にくっつく / オフ=影はコースに落ちる。 既定オフ (value:0)。
  { key:'bikeShadowBoard', label:'影ボード',      min:0, max:1, step:1, value:0, format:raw=>(raw>=0.5?'オン':'オフ'), apply(raw){ mapRenderer.setShadowBoardEnabled(raw>=0.5); } },
];
// b90: user 指示「自機形状は不要なんでオミット」 ── mountControlPanel 呼び出しを停止。
// BIKE_SHAPE_DEFS 配列と #bike-shape-sliders div は残す (= 復活余地)、 panel が立たないだけ。
// mountControlPanel(document.getElementById('bike-shape-sliders'), BIKE_SHAPE_DEFS, {collapsible:true, title:'自機の形状', collapsed:true});

// b86: 起動時に /version.json (= python bridge が git rev-parse で書き出した dev server 起動時点
// の commit 短 hash と日時) を fetch して HUD の version-info span に表示する。 reload 後に
// 数字が変わってれば「最新版が browser に届いている」 確認 signal、 SW cache stale 検出の物理 gate。
// fetch 失敗 (= production / 静的配信で version.json 無い場合) は無言で「(fetch失敗)」 表示、
// viewer 本体機能には影響ゼロ。
(async () => {
  const verEl = document.getElementById('version-info');
  if (!verEl) return;
  try {
    const res = await fetch('/version.json?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const v = await res.json();
    const hash = v.hash || 'unknown';
    const ciso = (v.commit_iso || '').slice(0, 16).replace('T', ' ');  // YYYY-MM-DD HH:MM
    verEl.textContent = ciso ? `${hash} ${ciso}` : hash;
  } catch {
    verEl.textContent = '(fetch失敗)';
  }
})();

// b72 + b74 weather: AMeDAS の現在気象を 1 起動 1 回 fetch して #weather-panel に populate +
// 気温・湿度・標高 から雲量・雲底・雲頂を算出して mapRenderer.setWeatherClouds に流す。
// 配布元 (気象庁 bosai) への通信は 1 起動 2 req (= latest_time + map、 b72 既存)、 b74 で
// 新規 fetch 追加なし。 出典「気象庁 アメダス」 をパネルに表示。 DOM は textContent +
// createElement のみ (= XSS 安全)。 #weather-panel の data-clouds-state 属性で雲表示状態
// (= "pending" / "rendered" / "error") を expose、 e2e + integration test で観測可能。
//
// b74: URL gate ?weather=fixed&cloudCover=...&cloudBaseM=...&cloudTopM=... が指定されていれば
// AMeDAS fetch を skip して固定値を流す (= e2e screenshot 用、 既存 ?cam= / ?cap= URL gate と
// 同型)。 配布元負荷を増やさない設計。
(async () => {
  const statusEl = document.getElementById('weather-status');
  const rowsEl = document.getElementById('weather-rows');
  const panelEl = document.getElementById('weather-panel');
  // b74: 観るモード / ride mode でも雲量行が常時 visible な mini-overlay (= body 直下 fixed)
  const miniEl = document.getElementById('weather-cloud-mini');
  if (!statusEl || !rowsEl || !panelEl) return;

  // b114: wirelib は file top で static import 済 (= ATMO_DEFS の cloudAmount apply で
  // applyCloudAmountToMap を直呼びするため格上げ)、 ここでの dynamic import は不要。

  // URL gate ?weather=fixed: AMeDAS fetch skip して固定値を流す (= e2e screenshot 用)
  let urlParams = null;
  try { urlParams = new URLSearchParams(location.search); } catch { /* skip */ }
  const forceWeather = parseForceWeatherFromUrl(urlParams);
  if (forceWeather) {
    applyForceWeatherToPanel({ mapRenderer, panelEl, rowsEl, statusEl, miniEl, forceWeather });
    return;
  }

  // 通常 AMeDAS path (= b72 既存 panel populate + b74 雲行追加)
  try {
    const { fetchFujiWeather } = await import('./lib/weather/jma_amedas.js');
    const { timestamp, stations } = await fetchFujiWeather();
    const t = `${timestamp.slice(4,6)}/${timestamp.slice(6,8)} ${timestamp.slice(8,10)}:${timestamp.slice(10,12)}`;
    statusEl.textContent = `${t} 取得`;
    while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
    const span = (text, color) => {
      const e = document.createElement('span');
      e.textContent = text;
      if (color) e.style.color = color;
      return e;
    };
    for (const s of stations) {
      const row = document.createElement('div');
      row.appendChild(span(`${s.name}  `));
      row.appendChild(span(`${s.alt}m `, '#999'));
      row.appendChild(span(s.temp != null ? `${s.temp.toFixed(1)}℃ ` : '気温- ', '#ffaa66'));
      if (s.humidity != null) row.appendChild(span(`湿${s.humidity}% `, '#88ccff'));
      if (s.wind != null) row.appendChild(span(`風${s.wind.toFixed(1)}m/s `, '#ccc'));
      if (s.pressure != null) row.appendChild(span(`${s.pressure.toFixed(0)}hPa `, '#aaa'));
      if (s.precipitation10m != null && s.precipitation10m > 0) {
        row.appendChild(span(`☂${s.precipitation10m}mm`, '#66ddff'));
      }
      rowsEl.appendChild(row);
    }
    // b74: 観測点 → 雲量・雲底・雲頂 算出 → mapRenderer.setWeatherClouds + 雲行追加 +
    //       data-clouds-state="rendered" or "error" + mini-overlay 更新
    // b79: cloudAmountMultiplier (= 0..1 slider) を掛けて setWeatherClouds に流す。
    //      panel 表示は物理算出値のまま、 戻り値を currentBaseWeather に保存して slider 操作で再適用。
    // b94: Pages (= ENV.mode === 'static') では雲シミュ視覚品質が cumulus に届かない (user 判断
    //      「およそ雲って感じではない、 Pages では当面オフ」)、 multiplier 強制 0 + slider mount skip
    //      で完全 off。 dev (= bridge mode) では既存挙動 (= AMeDAS 由来 × slider) を維持して改修継続。
    const cloudsDisabledByEnv = ENV?.mode === 'static';
    currentBaseWeather = applyAmedasCloudsToPanel({
      mapRenderer, panelEl, rowsEl, miniEl, stations,
      cloudAmountMultiplier: cloudsDisabledByEnv ? 0 : currentCloudAmount,
    });

    // b114: 雲量 slider は ATMO_DEFS の cloudAmount entry に統合済 (= file top で
    //   mountControlPanel で「大気環境」 panel に mount される)。 ここで dynamic mount しない。
    //   currentBaseWeather は applyAmedasCloudsToPanel の戻り値で更新済、 slider 操作が
    //   来たら ATMO_DEFS.cloudAmount.apply が applyCloudAmountToMap を直呼びする。
  } catch (e) {
    statusEl.textContent = `取得失敗: ${e.message}`;
    panelEl.setAttribute('data-clouds-state', 'error');
    console.warn('[weather] AMeDAS fetch failed:', e);
  }
})();

// b75: 太陽位置を NOAA 算法で現在 JST から計算 → mapRenderer.setSolarPosition に流す。
// URL gate ?datetime= で時刻固定 (e2e 3 視点 朝/昼/夕 用、 offset 必須、 不正値は warn +
// 現在時刻 fallback)。 weather panel に「☀ 太陽 方位 N°、 高度 N°」 1 行追加。
// 配布元への新規 fetch なし (= NOAA は純 JS 計算、 外部 API 不要)。
(async () => {
  const panelEl = document.getElementById('weather-panel');
  if (!panelEl) return;
  let sunlib = null;
  try {
    sunlib = await import('./lib/weather/sun_position.js');
  } catch (e) {
    console.warn('[sun] sun_position module load failed:', e);
    return;
  }
  const { computeSolarPosition, parseDatetimeFromUrl } = sunlib;
  let urlParams = null;
  try { urlParams = new URLSearchParams(location.search); } catch { /* skip */ }
  const overrideDate = parseDatetimeFromUrl(urlParams);
  const nowJst = overrideDate || new Date();
  let solarPos;
  try {
    solarPos = computeSolarPosition({ lat: 35.36, lon: 138.72, dateJst: nowJst });
  } catch (e) {
    console.warn('[sun] computeSolarPosition failed:', e);
    return;
  }
  // viewer の facade へ流す ── scene が生成済なら即反映、 未生成なら pending 保留。
  if (typeof mapRenderer?.setSolarPosition === 'function') {
    mapRenderer.setSolarPosition(solarPos);
  }
  // weather panel に「☀ 太陽 方位 N°、 高度 N°」 行を追加 (XSS 安全: textContent +
  // createElement のみ、 b72/b74 既存規律承継)。 panel 末尾に append。
  const sunRow = document.createElement('div');
  const sunSpan = document.createElement('span');
  sunSpan.textContent = `☀ 太陽 方位 ${Math.round(solarPos.azimuthDeg)}°、 高度 ${Math.round(solarPos.elevationDeg)}°`;
  sunSpan.style.color = '#ffdd66';
  sunRow.appendChild(sunSpan);
  panelEl.appendChild(sunRow);
})();

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

// b53: 観るモードの区間リストパネル (#section-list-panel) のヘッダ折りたたみトグル。
// click で panel に .collapsed を toggle ── CSS が <ul#section-list> と .panel-hint を
// display:none にする。 ヘッダ / トグル / #btnViewModeExit は折りたたみ時も残す
// (= 再展開とモード退出の導線)。 折りたたみ状態は session 内のみ (localStorage 永続なし)。
const btnSectionCollapse = document.getElementById('btnSectionCollapse');
if (btnSectionCollapse) {
  btnSectionCollapse.addEventListener('click', () => {
    const panel = document.getElementById('section-list-panel');
    if (!panel) return;
    const collapsed = panel.classList.toggle('collapsed');
    btnSectionCollapse.textContent = collapsed ? '▶' : '▼';
    btnSectionCollapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

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
    duration_s: rideStartedAt ? Math.round((performance.now() - rideStartedAt) / 1000) : lastRideDurationS,
    elevation_gain_m: 0,  // TODO: course から差分計算 (= 別 brief、 brief 33 範囲外)
    avg_power_w: null,
    course_name: 'fujihill',
  };
}

bindPostRideButtons({
  getTrkpts: () => (rideState ? rideState.getTrkpts() : []),
  getSummary: () => buildRideSummary(rideState, []),
  getCourseName: () => 'fujihill',
  // brief 34 ε-3: IndexedDB 書込を guard (= 観るモードは記録対象外なら no-op).
  // b46: 観るモード判定を intro consent (= 旧 intro mode === 'view') から
  //   body.classList.contains('mode-view') へ移行。 観るモードの唯一の判定 signal。
  // 2026-05-15 fix: 保存できなかった時は false を返して caller (= postride_buttons.js) 側で
  // 「履歴に保存しました」の overwrite を抑止する (= 旧 実装は silent skip でも success 文言
  // を上書きしてしまい、 user が「保存できたつもり」になる bug があった).
  // 2026-05-15 fix: 履歴同意 gate を廃止。 観るモードだけは記録対象外で残す
  // (= 区間勾配を眺めるための仮想 ride、 走行記録ではない).
  addRide: async (rec) => {
    if (document.body.classList.contains('mode-view')) {
      setPostrideStatus('観るモードは記録対象外です (= 走行ログ保存なし).');
      return false;
    }
    const db = await getRideDb();
    await rideDbAdd(db, rec);
    return true;
  },
  // brief 34 ε-3: Strava 機能を guard (= 観るモードは client_id を返さない).
  // b46: 観るモード判定を body.classList.contains('mode-view') へ移行 (= 上記 addRide と同様)。
  // getClientId が null を返せば postride_buttons.js 側で「client_id 未設定」の status が出る。
  // 2026-05-15 fix: Strava 同意 gate を廃止。 観るモードだけは Strava 非対応で残す。
  // user が「Strava にアップロード」 button を押した事自体が意思表示。
  getClientId: () => {
    if (document.body.classList.contains('mode-view')) return null;
    return getStravaClientId();
  },
  getRedirectUri: getStravaRedirectUri,
  onViewHistory: () => { showHistoryOverlay().catch((err) => setPostrideStatus(`history error: ${err.message}`)); },
  onStatus: setPostrideStatus,
});

// brief 34 ε-3: Strava upload / save history button を表示制御 (= 視覚的にも明示).
// b46: 観るモード判定を intro consent から body.classList.contains('mode-view') へ移行。
// btnSaveHistory は view mode のみ hide (= 走行記録は view モード対象外)。
// btnStravaUpload は strava consent (= OAuth client_id 設定) が前提なので変更なし。
function updatePostrideButtonVisibility() {
  const isViewMode = document.body.classList.contains('mode-view');
  const stravaOk = getRideConsent('strava');
  const btnSave = document.getElementById('btnSaveHistory');
  const btnStrava = document.getElementById('btnStravaUpload');
  if (btnSave) btnSave.hidden = isViewMode;
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

// b43: 「アプリを最新版に更新」 ボタン。 SW を unregister + CacheStorage 全消ししてから reload し、
// アプリ本体コードを最新版に取り直す。「全データ削除」 (= btnClearAllData、 IndexedDB +
// localStorage を消す破壊的操作) とは別物 ── こちらは非破壊 (= ride 履歴 / 設定は残る) なので
// 確認 dialog は付けない (最悪でも「再読込で数秒待つ」 だけ)。 SW クリアロジックは `?nosw=1`
// 経路と共用の clearServiceWorkerCache。
const btnRefreshApp = document.getElementById('btnRefreshApp');
if (btnRefreshApp) btnRefreshApp.addEventListener('click', async () => {
  btnRefreshApp.disabled = true;
  btnRefreshApp.textContent = '更新中...';
  try {
    await clearServiceWorkerCache();
  } catch (e) {
    console.warn('[fujihill] clearServiceWorkerCache failed:', e);
  }
  location.reload();
});

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
  // b46: 全データ削除後は起動シーンの第一段 (= 地形データローダー画面) からやり直す。
  //   全 overlay を hide + setAppState('checking') + showTerrainLoader。
  document.getElementById('setup-overlay')?.classList.remove('visible');
  document.getElementById('postride-overlay')?.classList.remove('visible');
  document.getElementById('consent-overlay')?.classList.remove('visible');
  document.body.classList.remove('mode-view');  // 観るモード状態もリセット
  hideConsentOverlay();
  setAppState('checking');
  showTerrainLoader();
});

// oauth-callback.html から postMessage で完了通知が来る (= 別 tab 経路).
window.addEventListener('message', (ev) => {
  if (!ev || !ev.data || ev.data.type !== 'strava-oauth-done') return;
  if (ev.origin !== location.origin) return;  // same-origin only
  updateStravaStatusUI();
});

// Svelte Interop
window.fujihillInterop = { startTerrainPhase, onTerrainLoaderDone };

// Phase 3: Svelte 版 Map3D を使用する場合、既存の viewer-maplibre の初期化をバイパスする
if (new URLSearchParams(location.search).has('svelte_map')) {
  console.log('[viewer-maplibre] svelte_map mode detected. Bypassing Vanilla JS boot.');
  // return; -> Cannot return from top-level outside a module without wrapping, but we are in module.
  // Actually, we can just avoid calling `initApp()`. Let's wrap initApp or just abort.
}


