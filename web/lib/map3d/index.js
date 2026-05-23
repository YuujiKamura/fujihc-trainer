// b12 Phase 3 部品0: ファサード (Three.js 版 createMapRenderer).
//
// viewer が地図描画に頼む差し替え口 (= map_renderer.js の意味メソッド15個) の
// Three.js 実装。 viewer 本体は地図インスタンスを持たず、 createMapRenderer() が返す
// オブジェクトの15メソッド経由でしか地図を操作しない ── 中身が MapLibre か Three.js
// かは viewer から見えない。 Phase 4 がこの実装に差し替える。
//
// 本ファイルは部品1〜7を import して組み合わせるだけの統合層。 描画ロジックは持たない。
//
// node から import できるよう、 'three' と three を import する部品 (scene.js /
// terrain_mesh3d.js) は boot() 内で動的 import する。 こうすると createMapRenderer()
// 自体は three 非依存で評価でき、 web/tests から「15メソッドが揃うか」を素直に
// テストできる (= camera3d.js 等が THREE 注入で node テスト可にしているのと同じ狙い)。
// 動的 import は boot() = ブラウザ実行時にのみ走る。
//
// 注記: viewer の index.html には 'three' を vendored three.module.js に向ける
// importmap が要る (terrain3d.html と同じ)。 その配線は Phase 4 (差し替え) の担当。
//
// 座標系 SoT: 東 = +X、 上 = +Y (標高 m)、 北 = -Z。 terrain3d.js と一致。

import { createCamera3d } from './camera3d.js';
import { createRiderMesh3d } from './rider_mesh3d.js';
import { createCourseRibbon } from './course_ribbon3d.js';
import { createLabels3d, LABEL_BASE_HEIGHT_M } from './labels3d.js';
import { createLandmarks3d } from './landmarks3d.js';
import { ROAD_OFFSET_M } from './terrain_surface.js';
import { loadDemStitched, loadPhotoCanvas } from './tile_loader3d.js';
import { sampleHeightBilinear, tileRangeForBounds } from '../terrain3d.js';
import { tileXToLon, tileYToLat } from '../tile_math.js';
import { buildGradeColoredRoadPolygons } from '../road_polygon.js';
import { computeTravelHeading } from '../heading.js';
import { resampleCourse } from '../rider_placement.js';
import { openTileCache } from '../tile_cache.js';
// b31: GSI dem direct base は terrain_loader.js 側で定義 (= literal を本体に書かない、
// viewer_url_audit.test.js が viewer-maplibre.js 単体 scan する scope と整合させる用 ── 本 file は
// scan 対象外だが、 source-of-truth を 1 箇所に集約しておくことで dead URL constant の散在を避ける)。
// b67: GSI_DEM_PNG_DIRECT_BASE は広域低精細メッシュ (= dbBounds 22km四方を z12 で覆う背景) 用、
// 同じく terrain_loader.js が SoT。
import { GSI_DEM_DIRECT_BASE, GSI_DEM_PNG_DIRECT_BASE } from '../terrain_loader.js';

// 緯度 1 度あたりのメートル (= terrain3d.js と同値)。
const M_PER_DEG_LAT = 111320;

// b67: 広域低精細メッシュの取得 zoom。 値は 12 ── dbBounds (22km四方) を z12 なら 12 タイルで
// 覆える (実測 `tileRangeForBounds(fujihill.dbBounds, 12).count === 12`、 zoom_bounds.test.js
// で pin)。 z15 で 437 タイル MAX_TILES 超過、 z14=120、 z13=35 と比べて z12=12 が最少。
// 1 タイルが約 4 倍の面積を覆い、 GSI_FETCH_LIMIT=6 並列で 2 wave、 配布元負荷最小。 値を
// 1 行定数にしてあるので将来 zoom を変えるのは値 1 つの変更で済む (配布元配慮上、 上げる
// 方向の変更は慎重に ── 1 段上げると枚数が約 4 倍に増える)。
const WIDE_DEM_ZOOM = 12;

// b70: 広域低精細メッシュを「単一 dbBounds で覆い polygonOffset で高精細を上に出す」 (b67)
// → 4 外周ストリップで dbBounds から demBounds を引いた ring 形に作り直す。 ただし
// naive な 4 分割では z12 タイル境界が strip 辺と揃わず隙間 / 重複が残るため、 demBounds
// を Y 軸のみ z12 タイル整数倍に外向きスナップしてから 4 strip を取る。 z15 と z12 は倍率
// 8 で入れ子になっている性質を利用 ── z15 タイル番号を 8 の倍数に揃えれば z12 タイル
// 境界とぴったり揃う。 X 軸まで揃えると z15 タイル数が 16×16=256 で MAX_TILES 超過、
// Y のみ揃えれば 8×16=128 で MAX_TILES 内 (= b70 brief §根拠4 実測)。
const Z15_TO_Z12_RATIO = 1 << (15 - 12);  // = 8
// 次タイル境界の lon/lat を bbox として使うと tileRangeForBounds が境界エッジを次タイル
// として +1 タイル余分に数える (= 浮動小数の floor アーティファクト)、 微小に内側へ戻す。
// 1e-9 度 ≒ 0.1 mm 相当で実害ゼロ。
const SNAP_EPS = 1e-9;

/**
 * demBounds を Y 軸のみ z12 タイル整数倍に外向きスナップした [W,S,E,N] を返す純関数.
 *
 * X 軸は元 demBounds のまま (= 経度方向の高精細メッシュ範囲不変)。 Y 軸の lat 境界を
 * z12 タイル境界に揃えることで、 外周 z12 ストリップ (= `buildWideStripBboxes`) の
 * 北辺・南辺と高精細 z15 メッシュの北辺・南辺が同じ lat 線になり、 隙間/重複ゼロ。
 *
 * @param {[number,number,number,number]} demBounds - [W, S, E, N]
 * @returns {[number,number,number,number]}
 */
export function alignDemBoundsToZ12Y(demBounds) {
  const r15 = tileRangeForBounds(demBounds, 15);
  const yMinS = Math.floor(r15.yMin / Z15_TO_Z12_RATIO) * Z15_TO_Z12_RATIO;
  const yMaxS = Math.ceil((r15.yMax + 1) / Z15_TO_Z12_RATIO) * Z15_TO_Z12_RATIO - 1;
  return [
    demBounds[0],
    tileYToLat(yMaxS + 1, 15) + SNAP_EPS,
    demBounds[2],
    tileYToLat(yMinS,     15) - SNAP_EPS,
  ];
}

/**
 * dbBounds を両軸 z12 タイル整数倍に外向きスナップした [W,S,E,N] を返す純関数.
 *
 * @param {[number,number,number,number]} dbBounds - [W, S, E, N]
 * @returns {[number,number,number,number]}
 */
export function alignDbBoundsToZ12(dbBounds) {
  const r12 = tileRangeForBounds(dbBounds, 12);
  return [
    tileXToLon(r12.xMin,     12),
    tileYToLat(r12.yMax + 1, 12) + SNAP_EPS,
    tileXToLon(r12.xMax + 1, 12) - SNAP_EPS,
    tileYToLat(r12.yMin,     12) - SNAP_EPS,
  ];
}

/**
 * dbA から demA を引いた 4 外周ストリップ (北・南・東・西) の bbox を返す純関数.
 *
 * 規約: 角は北・南ストリップに含めて重複なく分割 (= 北・南が経度 dbA 全幅で取り、
 * 東・西は緯度 demA 範囲に閉じる)。
 *
 * @param {[number,number,number,number]} demA - alignDemBoundsToZ12Y の戻り
 * @param {[number,number,number,number]} dbA  - alignDbBoundsToZ12 の戻り
 * @returns {{north:[number,number,number,number], south:..., east:..., west:...}}
 */
export function buildWideStripBboxes(demA, dbA) {
  if (demA[0] < dbA[0] || demA[2] > dbA[2]
   || demA[1] < dbA[1] || demA[3] > dbA[3]) {
    throw new RangeError('buildWideStripBboxes: demA が dbA に内包されない');
  }
  return {
    north: [dbA[0],  demA[3], dbA[2],  dbA[3]],
    south: [dbA[0],  dbA[1],  dbA[2],  demA[1]],
    east:  [demA[2], demA[1], dbA[2],  demA[3]],
    west:  [dbA[0],  demA[1], demA[0], demA[3]],
  };
}

/**
 * curIdx と実測 lat/lon から、 コース始点からの走行距離 (m) を求める純関数.
 *
 * updateRider の引数は curIdx + lat/lon で走行距離そのものは来ない。 ライダー部品
 * (rider_mesh3d) は距離で配置するため、 curIdx を挟む区間 [curIdx, curIdx+1] に
 * lat/lon を射影して区間内比率を出し、 distance_m を線形補間する。 これは地理座標と
 * 距離の橋渡し ── ファサードが吸収する座標変換の一部 (40324 注記)。
 *
 * @param {Array<{lat:number,lon:number,distance_m:number}>} course
 * @param {number} curIdx
 * @param {number} lat
 * @param {number} lon
 * @returns {number} 走行距離 (m)
 */
export function distanceAlongCourse(course, curIdx, lat, lon) {
  if (!Array.isArray(course) || course.length === 0) return 0;
  const i = Math.max(0, Math.min(curIdx, course.length - 1));
  const p0 = course[i];
  const d0 = p0.distance_m ?? 0;
  if (i >= course.length - 1) return d0;
  const p1 = course[i + 1];
  const d1 = p1.distance_m ?? d0;
  // 区間ベクトルへの射影で区間内比率 frac を出す (= 最近接点パラメータ、 0..1 にクランプ)。
  const segLon = p1.lon - p0.lon;
  const segLat = p1.lat - p0.lat;
  const segLen2 = segLon * segLon + segLat * segLat;
  let frac = 0;
  if (segLen2 > 0) {
    frac = ((lon - p0.lon) * segLon + (lat - p0.lat) * segLat) / segLen2;
    frac = Math.max(0, Math.min(1, frac));
  }
  return d0 + frac * (d1 - d0);
}

/**
 * dbBounds が DEM タイル範囲を出せる形か検証する純関数.
 *
 * 有効な dbBounds は [west, south, east, north] の有限数 4 要素で、 E>=W かつ N>=S。
 * これを満たさない値 (undefined / 要素数違い / 非有限 / 東西南北の逆転) を
 * tileRangeForBounds に渡すと TypeError / RangeError になり、 boot() の catch が
 * 握りつぶして地形が黙って消える ── boot 側はこの検証で先に弾き明示エラーにする。
 *
 * @param {*} b
 * @returns {boolean}
 */
export function isValidBounds(b) {
  return Array.isArray(b) && b.length === 4
    && b.every((v) => Number.isFinite(v))
    && b[2] >= b[0] && b[3] >= b[1];
}

/**
 * Three.js 版の地図描画レンダラを生成する.
 *
 * map_renderer.js の createMapRenderer() と同じく、 15 の意味メソッドを持つ
 * オブジェクトを返す。 viewer はこのオブジェクトだけを通じて地図を操作する。
 *
 * @returns {object} 15 メソッドを持つレンダラ
 */
export function createMapRenderer() {
  // --- 部品 (boot / renderCourse で生成、 それまでは null) ---
  let THREE = null;       // 動的 import した three 名前空間
  let scene = null;       // 部品1
  let camera3d = null;    // 部品4
  let rider3d = null;     // 部品5
  let ribbon3d = null;    // 部品3
  let labels3d = null;    // 部品7
  let landmarks3d = null; // b39: 富士ヒル区間名標識 (= 7 件、 setLandmarks で生成 / 再呼出で dispose+再生成)
  let terrainMesh = null; // 部品2 の出力 mesh
  let shadowBoardEnabled = false;  // 影ボード (自機足元の影専用ボード) の有効/無効、 既定オフ

  // --- 地形・コース由来の状態 ---
  let container = null;
  let stitched = null;    // tile_loader3d が返した連結標高グリッド
  let range = null;       // 同 DEM タイル範囲
  let geoMeta = null;     // terrain_mesh3d の geo (centerLat/centerLon/minH/maxH/sizeX/sizeZ)
  let terrainSpan = 1000; // 地形の最大辺 (m)

  // --- ライフサイクル ---
  // booted: boot() が呼ばれたか。 boot() の先頭で同期に立てる ── viewer は isBooted() で
  // 「起動済か」を判定して初期化関数を再入させる設計で、 ここが非同期完了まで false の
  // ままだと再入が無限ループになりメインスレッドを固める (= b12 Phase4 フリーズ事故)。
  let booted = false;
  // terrainReady: 地形 DEM + メッシュまで本当に組めたか。 idle 発火と renderCourse の gate。
  let terrainReady = false;
  let courseRendered = false;
  let idleFired = false;
  const idleCbs = [];

  // --- 毎フレーム更新で引き継ぐ状態 ---
  let lastRiderPlacement = null;  // rider_mesh3d.updatePose の戻り (position/forward)
  let ribbonPositions = null;     // リボン頂点配列 (= rider 配置の入力)
  let lastTarget = null;          // カメラ注視点 (world {x,y,z})
  let lastForward = null;         // 進行方向 (world {x,y,z})
  let lastLon = null;
  let lastLat = null;
  let lastRiderDistM = 0;         // 直前フレームのライダー走行距離 (m)

  // --- コース由来の動的状態 ---
  let savedCourse = null;         // setCourseWidth / setRoadHeight 内で course を参照するため保持
  let savedGeoOpts = null;        // 同上
  let savedCourseWidth = 10;      // 現在のコース幅 (m)
  let currentRoadOffset = ROAD_OFFSET_M; // 現在の路面高さオフセット (m)

  // boot / renderCourse 前に呼ばれた set 系の値を保留し、 部品生成時に流し込む。
  const pending = { camZoom: null, camPitch: null, sunDir: null, sunStrength: null, labelScale: null,
                    riderScale: null, courseWidth: null, roadHeight: null, labelHeight: null,
                    riderShape: null, atmoParams: null };

  function fireIdle() {
    if (idleFired) return;
    idleFired = true;
    const cbs = idleCbs.splice(0);
    for (const cb of cbs) {
      try { cb(); } catch (e) { console.warn('[map3d] idle callback failed:', e); }
    }
  }

  // 地形中心 (= ride 開始前のカメラ注視点 fallback)。
  function terrainCenter() {
    return { x: 0, y: geoMeta ? (geoMeta.minH + geoMeta.maxH) / 2 : 0, z: 0 };
  }

  // container サイズ変更を renderer / camera に反映する。
  function handleResize() {
    if (!scene || !camera3d) return;
    const sz = scene.resize();
    camera3d.resize(sz.width, sz.height);
  }

  // 視点の永続化。 user が drag / wheel で合わせた orbit カメラ (bearing/pitch/radius)
  // を localStorage に保存し、 次回起動で初期カメラとして復元する ── 「最後に置いた
  // 視点が初期カメラになる」。 localStorage 不在環境 (= node テスト等) では黙って no-op。
  const CAMERA_ORBIT_KEY = 'fujihill.cameraOrbit';
  function loadSavedOrbit() {
    try {
      const raw = localStorage.getItem(CAMERA_ORBIT_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // 3 値が揃った有限数のときだけ採用 (= 壊れた保存値は無視)。
      if (Number.isFinite(s.bearing) && Number.isFinite(s.pitch) && Number.isFinite(s.radius)) {
        return s;
      }
    } catch { /* localStorage 不可 / JSON 壊れ → 初期 default のまま */ }
    return null;
  }
  function saveOrbit() {
    if (!camera3d) return;
    try {
      localStorage.setItem(CAMERA_ORBIT_KEY, JSON.stringify(camera3d.getOrbitState()));
    } catch { /* localStorage 不可は黙って諦める (= 永続化は best-effort) */ }
  }

  // マウス操作を camera3d に流す。 drag / wheel は即座にカメラへ反映する
  // (= ride 前で updateCamera が apply=false の間も自由視点を効かせる)。
  function wireCameraInput(el) {
    let drag = null;
    let dragged = false;       // drag 中に実際に動いたか (= mouseup で保存するか判定)
    let wheelSaveTimer = null; // wheel 連打を 1 回の保存にまとめる debounce
    el.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      dragged = false;
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => {
      if (drag && dragged) saveOrbit();
      drag = null;
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag || !camera3d) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (dx || dy) dragged = true;
      
      // drag はボタン問わず orbit 回転 (左右の使い分けは 2026-05-22 取り下げ)。
      camera3d.onDrag(dx, dy);
      
      camera3d.update(lastTarget || terrainCenter(), lastForward || { x: 0, y: 0, z: -1 });
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!camera3d) return;
      camera3d.onWheel(e.deltaY);
      camera3d.update(lastTarget || terrainCenter(), lastForward || { x: 0, y: 0, z: -1 });
      // wheel は連続発火するので最後の 1 回だけ保存する。
      if (wheelSaveTimer) clearTimeout(wheelSaveTimer);
      wheelSaveTimer = setTimeout(saveOrbit, 400);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', handleResize);
  }

  // URL ?cam= でカメラモードを切替可能にする (terrain3d.html と同じ検証用入口)。
  function cameraMode() {
    try {
      const m = new URLSearchParams(location.search).get('cam');
      return (m === 'top' || m === 'follow') ? m : 'orbit';
    } catch { return 'orbit'; }
  }

  // URL ?cap=1 のとき画面送信モード。 WebGL 描画 buffer を一定間隔で PNG 化し、
  // bridge の POST /debug/frame に送って data/debug-frame.png へ保存させる。
  // OS のウィンドウキャプチャは WebGL canvas で白飛びするため、 描画結果を
  // viewer 自身から送り出して開発時に実画面を実ファイルで観られるようにする入口。
  function captureEnabled() {
    try { return new URLSearchParams(location.search).get('cap') === '1'; }
    catch { return false; }
  }

  // 画面送信ループ。 scene 生成後に 1 回だけ呼ぶ。 renderer の canvas を一定間隔で
  // PNG Blob 化し bridge へ POST する。 送信失敗 (= bridge 不在の static mode 等) は
  // 黙って無視 ── デバッグ用途なので best-effort。
  let captureTimer = null;
  function startFrameCapture() {
    if (captureTimer || !scene || !scene.renderer) return;
    const canvas = scene.renderer.domElement;
    captureTimer = setInterval(() => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) return;
          fetch(`${location.origin}/debug/frame`, { method: 'POST', body: blob })
            .catch(() => { /* bridge 不在等は無視 */ });
        }, 'image/png');
      } catch { /* toBlob 不可環境は無視 */ }
    }, 1500);
  }

  return {
    // === ライフサイクル ===

    isBooted() { return booted; },

    // 地図を生成する。 env からタイル取得経路を、 opts.dbBounds から地形範囲を決め、
    // DEM / 航空写真を取得して地形メッシュを組む。 準備完了で opts.onLoaded を呼ぶ。
    // three と three 依存部品はここで動的 import する (= node import 安全のため)。
    //
    // booted は boot() の先頭で同期に立てる。 viewer の初期化関数 (initBleMode 等) は
    // 「if (!isBooted()) ensureMapBooted().then(initXxx)」 の再入で起動を待つ設計で、
    // booted が非同期完了まで false だと再入が止まらずメインスレッドが固まる。
    boot(env, opts) {
      opts = opts || {};
      if (booted) return;
      booted = true;
      container = opts.container || document.getElementById('map');

      // onLoaded は最初の 1 回だけ呼ぶ (= 成功 / 例外 / 8 秒経過のいずれか早い方)。
      let onLoadedCalled = false;
      function fireOnLoaded() {
        if (onLoadedCalled) return;
        onLoadedCalled = true;
        if (typeof opts.onLoaded === 'function') {
          try { opts.onLoaded(); } catch (e) { console.warn('[map3d] onLoaded callback failed:', e); }
        }
      }
      // 8 秒フォールバック: DEM 取得のハング等で非同期処理が onLoaded まで届かないとき、
      // viewer をロード画面で止めないよう onLoaded を強制で呼ぶ (= 旧 map_renderer.js の安全弁)。
      const fallbackTimer = setTimeout(() => {
        if (!onLoadedCalled) {
          console.warn('[map3d] boot が 8 秒以内に完了せず、 fallback で onLoaded を呼ぶ');
          fireOnLoaded();
        }
      }, 8000);

      (async () => {
        try {
          THREE = await import('three');
          const { createScene } = await import('./scene.js');
          const { buildTerrainMesh } = await import('./terrain_mesh3d.js');
          // b67: 広域低精細メッシュも buildTerrainMesh / loadDemStitched / loadPhotoCanvas を
          // 同じ 2 段経路で再利用する。 動的 import 1 度だけ取得して下で参照。

          scene = createScene({ container, capture: captureEnabled() });

          // DEM タイル → 連結標高グリッド。 範囲は course 定義由来の DB bbox。
          // dbBounds が不正 (undefined 等) だと tileRangeForBounds が TypeError を投げ、
          // boot ごと catch に落ちて地形が黙って消える。 ここで先に検証し、 原因の読める
          // 明示エラーにして catch の console.error → onLoaded(8 秒安全弁) 経路へ乗せる。
          if (!isValidBounds(opts.dbBounds)) {
            throw new Error(
              'boot: opts.dbBounds が不正 ── [west,south,east,north] の有限数 4 要素 '
              + '(E>=W, N>=S) が必要。 受領: ' + JSON.stringify(opts.dbBounds));
          }
          const tileCache = await openTileCache().catch(() => null);
          // b31: DEM 経路を seamlessphoto と同パターンに揃える ── bridge mode (= ${origin}/tiles/gsi_dem)
          // → GSI direct fallback (= GSI_DEM_DIRECT_BASE) → TileCache hit/set。
          // 既存呼出 (= tileCache / gsiDirectBase 引数なし) は bridge fetch のみで挙動不変。
          // brief 35: onProgress (= (done, total) => void) を viewer から bind して
          // ロード overlay の進捗数値 / バーを更新する。 未指定なら従来挙動 (= silent fetch)。
          // b41: opts.skipTerrain (= viewer の ?noterrain) なら DEM / 航空写真とも
          // 配布元を叩かず、 平坦な標高ゼログリッド + 下地一色テクスチャで地形を組む。
          // b70: 高精細メッシュ範囲を z12 タイル境界に揃った demBoundsAligned (= Y のみ
          // 8 の倍数スナップ) に置換。 これで外周 4 ストリップの z12 タイル境界と
          // 数学的に一致 (= 隙間/重複ゼロ)。 z15 タイル数 96 → 128 (+33%、 MAX_TILES 内)。
          const demA = alignDemBoundsToZ12Y(opts.dbBounds);
          const dem = await loadDemStitched({
            bounds: demA, tileCache, gsiDirectBase: GSI_DEM_DIRECT_BASE,
            onProgress: opts.onProgress, skipFetch: opts.skipTerrain,
          });
          stitched = dem.stitched;
          range = dem.range;

          // 航空写真テクスチャ → 地形メッシュ。
          const photoCanvas = await loadPhotoCanvas({
            range: dem.range, tileCache, skipFetch: opts.skipTerrain,
          });
          const built = buildTerrainMesh({ stitched: dem.stitched, range: dem.range, photoCanvas });
          terrainMesh = built.mesh;
          geoMeta = built.geo;
          // 地形メッシュは自機の影を受けない ── 自機の影が地形の山肌へ伸びるのが
          // 不自然なため、 受け手にしない (2026-05-21 指摘、 Three.js 既定 false)。
          // 自機の影はコースリボン上 (ribbon の receiveShadow) でのみ受ける。
          // b70: debug ハンドル ?nohighres=1 で高精細メッシュを scene から外す
          // (完了条件 §実画面確認 = 外周ストリップだけ描いて demA 内部が空である
          // ことを構造で目視するため、 dev only)。
          const noHighres = (() => {
            try { return new URLSearchParams(location.search).has('nohighres'); }
            catch { return false; }
          })();
          if (!noHighres) scene.add(terrainMesh);
          // b61: 地形 material に物理ベース大気散乱 (aerial perspective) を注入する。
          scene.enableAtmosphere(terrainMesh.material);
          // b62: 機器設定パネルの atmosphere スライダーは boot より早く mount され、
          // 起動時に localStorage 値由来の apply が走る。 scene 未生成のあいだに保留した
          // 散乱パラメータを、 ここで一括反映する (= sunDir / sunStrength と同じ並び)。
          if (pending.atmoParams) scene.setAtmosphereParams(pending.atmoParams);

          terrainSpan = Math.max(geoMeta.sizeX, geoMeta.sizeZ);
          scene.configureScale(terrainSpan);

          // カメラ。 注視点は地形中心の標高に置く。
          const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
          camera3d = createCamera3d(THREE, {
            span: terrainSpan,
            aspect,
            targetY: (geoMeta.minH + geoMeta.maxH) / 2,
            mode: cameraMode(),
          });

          // 保留していた光源設定を反映 (= boot 前に set された分)。
          if (pending.sunDir != null) scene.setSunlightDirection(pending.sunDir);
          if (pending.sunStrength != null) scene.setSunlightStrength(pending.sunStrength);
          // 保留していたカメラ初期 zoom/pitch を反映 (= b12 Phase4: camera3d が
          // setCameraDefaults を実装したので、 ここで pending を流し込めるようになった)。
          if (pending.camZoom != null || pending.camPitch != null) {
            camera3d.setCameraDefaults({ zoom: pending.camZoom, pitch: pending.camPitch });
          }
          // 前回 user が drag / wheel で合わせた orbit 視点があれば、 それを初期カメラ
          // として復元する (= setCameraDefaults より後に適用して上書き)。
          camera3d.applyOrbitState(loadSavedOrbit());

          wireCameraInput(container);
          handleResize();

          terrainReady = true;
          fireOnLoaded();
          // ?cap=1 のとき画面送信ループを開始する (= 開発時に実画面を観るための入口)。
          if (captureEnabled()) startFrameCapture();

          // b70: 広域低精細メッシュを ring topology (= 外周 4 ストリップ) に作り直す。
          // b67 は単一広域メッシュ + polygonOffset で「視覚的には ring」 だが構造的には
          // demBounds 直下に 2 層が同居する設計だった ── 本当に外周だけを覆う 4 strip に
          // 置換する。 dbBoundsAligned (z12 タイル整数倍に外向きスナップ) から
          // demBoundsAligned (= 高精細メッシュ範囲) を引いた 4 矩形 (北・南・東・西)、
          // 角は北・南に寄せる規約。 strip 境界は demA と数学的に一致 (= 隙間/重複ゼロ)。
          // polygonOffset は不要 (= overlap が無い)。
          if (isValidBounds(opts.wideBounds) && !opts.skipTerrain && geoMeta) {
            console.time('[map3d] wideStrips build');
            try {
              const dbA = alignDbBoundsToZ12(opts.wideBounds);
              const strips = buildWideStripBboxes(demA, dbA);
              const mPerDegLon = M_PER_DEG_LAT * Math.cos((geoMeta.centerLat * Math.PI) / 180);
              // 各 strip を並列で構築。 strip 単位 try/catch で 1 strip 死亡時も他 3 strip
              // + 高精細メッシュは続行 (= 局所粒度、 視覚的欠落は 1 方位のみ)。
              await Promise.all(Object.entries(strips).map(async ([dir, bbox]) => {
                try {
                  const stripDem = await loadDemStitched({
                    bounds: bbox, tileCache,
                    gsiDirectBase: GSI_DEM_PNG_DIRECT_BASE, zoom: WIDE_DEM_ZOOM,
                  });
                  // 無地マテリアル (= 航空写真の配布元取得ゼロ、 skipFetch:true で
                  // tile_loader3d.js が GSI を叩かず #3b424c の canvas を返す)。
                  const stripPhoto = await loadPhotoCanvas({
                    range: stripDem.range, tileCache, skipFetch: true,
                  });
                  const stripBuilt = buildTerrainMesh({
                    stitched: stripDem.stitched, range: stripDem.range, photoCanvas: stripPhoto,
                  });
                  // 座標原点を高精細メッシュ (geoMeta) に揃える平行移動。
                  const dLon = stripBuilt.geo.centerLon - geoMeta.centerLon;
                  const dLat = stripBuilt.geo.centerLat - geoMeta.centerLat;
                  stripBuilt.mesh.position.x = dLon * mPerDegLon;
                  stripBuilt.mesh.position.z = -dLat * M_PER_DEG_LAT;
                  // 大気散乱は共有 (= 高精細と同じ aerial perspective で遠景が霞む)。
                  scene.enableAtmosphere(stripBuilt.mesh.material);
                  // polygonOffset / renderOrder は設定しない ── ring topology + 境界数学
                  // 一致で overlap が無く、 設定すると将来の z-fighting デバッグを誤誘導する。
                  scene.add(stripBuilt.mesh);
                } catch (e) {
                  console.warn(`[map3d] 広域 ${dir} ストリップ build 失敗:`, e);
                }
              }));
            } catch (e) {
              // strip 算出 (= buildWideStripBboxes の throw 等) で全 strip skip。
              // 高精細メッシュと viewer 起動は既に fireOnLoaded() で完了済、 失敗時の
              // 劣化は本 brief 着手前の状態 (= 外側虚空) にロールバックされるだけ。
              console.warn('[map3d] 広域ストリップ群の構築に失敗 (= 背景のみ欠落、 viewer 続行):', e);
            }
            console.timeEnd('[map3d] wideStrips build');
          }
        } catch (e) {
          // 例外時も viewer をロード画面で止めないよう onLoaded は呼ぶ。 terrainReady は
          // false のまま ── idle 発火・renderCourse の gate は地形が本当に組めたかを見る。
          console.error('[map3d] boot failed:', e);
          fireOnLoaded();
        } finally {
          clearTimeout(fallbackTimer);
        }
      })();
    },

    // idle (= 地形が組まれ最初のフレームを描き終えた状態) を購読する。
    onceIdle(cb) {
      if (typeof cb !== 'function') return;
      if (idleFired) { try { cb(); } catch (e) { console.warn('[map3d] idle callback failed:', e); } }
      else idleCbs.push(cb);
    },

    // === カメラ ===

    // 初期 zoom / pitch を指定する。 b12 Phase4: camera3d.setCameraDefaults が
    // MapLibre zoom → Three.js オービット半径の変換を持つので、 camera3d 生成済なら
    // 即反映、 boot 前なら pending に保留して boot 内で流し込む (= 他 set 系と同じ作法)。
    setCameraDefaults({ zoom, pitch } = {}) {
      if (camera3d) {
        camera3d.setCameraDefaults({ zoom, pitch });
      } else {
        if (Number.isFinite(zoom)) pending.camZoom = zoom;
        if (Number.isFinite(pitch)) pending.camPitch = pitch;
      }
    },

    // 毎フレーム、 カメラをライダー現在位置に追随させる。 apply=false なら動かさず
    // 進行方位だけ計算して返す。 戻り値の headingRad は minimap が rider 矢印に使う。
    updateCamera({ course, curIdx, fracInSegment, lon, lat, lookAhead = 5, apply = true } = {}) {
      let headingDeg = 0;
      if (Array.isArray(course) && course.length > 0) {
        headingDeg = computeTravelHeading(course, curIdx, lookAhead);
      }
      if (apply && camera3d && lastRiderPlacement) {
        const pl = lastRiderPlacement;
        lastTarget = { x: pl.position[0], y: pl.position[1], z: pl.position[2] };
        lastForward = { x: pl.forward[0], y: pl.forward[1], z: pl.forward[2] };
        camera3d.update(lastTarget, lastForward);
      }
      if (lon != null) lastLon = lon;
      if (lat != null) lastLat = lat;
      return { headingRad: (headingDeg * Math.PI) / 180, bearingDeg: headingDeg };
    },

    // 地理座標を画面 pixel に投影する (= rider 追随 HUD の座標計算)。
    // lon/lat → world XYZ への変換はファサードが吸収する (40324 注記) ── camera3d は
    // world 座標しか受けないため、 ここで投影パラメータと DEM 標高を使って world に直す。
    projectToScreen(lon, lat) {
      if (!camera3d || !geoMeta) return { x: 0, y: 0, visible: false };
      const mPerDegLon = M_PER_DEG_LAT * Math.cos((geoMeta.centerLat * Math.PI) / 180);
      const x = (lon - geoMeta.centerLon) * mPerDegLon;
      const z = -(lat - geoMeta.centerLat) * M_PER_DEG_LAT;
      const y = (stitched && range)
        ? sampleHeightBilinear(stitched, range, lat, lon, 256)
        : 0;
      return camera3d.projectToScreen({ x, y, z });
    },

    // デバッグ HUD 用の現在カメラ値。 centerLng/Lat は直近の rider 位置、
    // zoom/pitch は camera → 注視点ベクトルから導いた Three.js 側の実値。
    getCameraInfo() {
      const info = { zoom: null, pitch: null, centerLng: lastLon, centerLat: lastLat };
      if (camera3d && lastTarget) {
        const cam = camera3d.camera;
        const dx = lastTarget.x - cam.position.x;
        const dy = lastTarget.y - cam.position.y;
        const dz = lastTarget.z - cam.position.z;
        const horiz = Math.sqrt(dx * dx + dz * dz);
        info.zoom = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // 視線と鉛直の角度 (= 0 真下俯瞰、 90 水平。 MapLibre pitch と同じ向きの定義)。
        info.pitch = (Math.atan2(horiz, -dy) * 180) / Math.PI;
      }
      return info;
    },

    // 1 フレーム描画する。 viewer 本体の tick が毎フレーム呼ぶ。
    // 地形が組まれた後の最初の描画で idle を発火する。
    render() {
      if (!scene || !camera3d) return;
      // 影オルソカメラを自機へ追従させてから描く。 自機倍率を渡し、 巨大ライダーでは
      // 錐台と光源距離を倍率比例で広げる (= 影が四角く切れず地形へ自然に落ちる)。
      if (rider3d) scene.focusShadowOn(rider3d.group.position, rider3d.group.scale.x);
      scene.render(camera3d.camera);
      if (terrainReady && !idleFired) fireIdle();
    },


    // === コース描画 ===

    // course 点列から地形上のコース (勾配色リボン + 距離ラベル + 起点終点マーカー +
    // ライダー mesh) を組む。 起動時 1 回のみ (冪等)。
    async renderCourse(course) {
      if (courseRendered) return;
      if (!terrainReady || !THREE || !scene || !camera3d) {
        console.warn('[map3d] renderCourse: 地形未準備のため skip');
        return;
      }
      // bike の接地精度のため course 点を細かく再サンプリングする ── 粗い折れ線だと
      // 剛体 bike が折れ目で前後輪を浮かせる。 8m 超の区間を 8m 以下へ分割。
      course = resampleCourse(course, 8);
      // 投影パラメータ ── 部品3/6/7 が地形と同じ座標系でコースを drape するために共有する。
      const geoOpts = {
        range,
        stitched,
        centerLat: geoMeta.centerLat,
        centerLon: geoMeta.centerLon,
        tileSize: 256,
      };

      // コース・地形オプション保存 (setCourseWidth / setRoadHeight から参照する)。
      savedCourse = course;
      savedGeoOpts = geoOpts;
      if (pending.courseWidth != null) savedCourseWidth = pending.courseWidth;
      if (pending.roadHeight != null) currentRoadOffset = pending.roadHeight;

      // 勾配色の道路リボン。 rider 配置に使う頂点配列は mesh の position 属性から取る
      // (= buildCourseRibbon を二重に呼ばない)。
      ribbon3d = createCourseRibbon(THREE, course, geoOpts, { widthM: savedCourseWidth, drapeOffset: currentRoadOffset });
      // 影ボードが有効なら影は影ボードが受ける。 無効ならコースリボンが受ける。
      ribbon3d.mesh.receiveShadow = !shadowBoardEnabled;
      scene.add(ribbon3d.mesh);
      ribbonPositions = ribbon3d.mesh.geometry.getAttribute('position').array;

      // 距離ラベル。 約 50m 間隔の標識を billboard sprite で立てる。
      const polygonFC = buildGradeColoredRoadPolygons(course, 5);
      labels3d = createLabels3d(THREE, {
        polygonFC,
        ...geoOpts,
        exaggeration: 1.0,
        heightOffset: currentRoadOffset + LABEL_BASE_HEIGHT_M / 2,
        labelScale: pending.labelScale != null ? pending.labelScale : 1,
      });
      scene.add(labels3d.group);
      if (pending.labelHeight != null) labels3d.setLabelHeight(pending.labelHeight);

      // ライダー 3D mesh。
      rider3d = createRiderMesh3d(THREE);
      rider3d.group.scale.setScalar(pending.riderScale != null ? pending.riderScale : 3.6);
      if (pending.riderShape) rider3d.setShape(pending.riderShape);
      rider3d.setShadowBoard(shadowBoardEnabled);
      scene.add(rider3d.group);

      // 初期配置: 起点にライダーを置き、 カメラをそこへ寄せる。
      lastRiderDistM = 0;
      const pl = rider3d.updatePose(ribbonPositions, course, 0);
      lastRiderPlacement = pl;
      lastTarget = { x: pl.position[0], y: pl.position[1], z: pl.position[2] };
      lastForward = { x: pl.forward[0], y: pl.forward[1], z: pl.forward[2] };
      camera3d.update(lastTarget, lastForward);

      // 冪等ガードのフラグは全構築の成功後に立てる。 途中で throw した場合は false の
      // ままにして renderCourse を再試行可能に保つ (= フラグを関数頭で立てると、
      // 1 度の失敗で courseRendered が true に固着し二度と描けなくなる)。
      courseRendered = true;
    },

    // === ライダー ===

    // ライダーを course 上の現在位置に置く。 spin (車輪回転) は rider_mesh3d が
    // 受け口を持たないため Phase3 では未使用 (= 車輪アニメは Phase4 以降の課題)。
    updateRider({ course, curIdx, lat, lon } = {}) {
      if (!rider3d || !ribbonPositions || !Array.isArray(course)
          || !Array.isArray(savedCourse)) return;
      if (lon != null) lastLon = lon;
      if (lat != null) lastLat = lat;
      // distanceAlongCourse は viewer の course (= curIdx と同じ非 resampled 列) で
      // 走行距離を求める。
      const distanceM = distanceAlongCourse(course, curIdx, lat, lon);
      lastRiderDistM = distanceM;
      // rider 配置はリボンと同じ savedCourse (= renderCourse が resampleCourse した列)
      // で引く。 ribbonPositions は resampled course の点数で組まれており、 非 resampled
      // course の index でリボン頂点を引くと別地点を拾い rider が浮く/位置ずれする
      // (= 056259c の course 再サンプリング導入で course と ribbon の点数が食い違った)。
      lastRiderPlacement = rider3d.updatePose(ribbonPositions, savedCourse, distanceM);
    },

    // === 距離ラベル ===

    setLabelScale(scale) {
      if (labels3d) labels3d.setLabelScale(scale);
      else pending.labelScale = scale;
    },

    updateLabelWindow(riderDistM) {
      if (labels3d) labels3d.updateLabelWindow(riderDistM);
    },

    // === 光源 ===

    setSunlightDirection(deg) {
      if (scene) scene.setSunlightDirection(deg);
      else pending.sunDir = deg;
    },

    setSunlightStrength(exaggeration) {
      if (scene) scene.setSunlightStrength(exaggeration);
      else pending.sunStrength = exaggeration;
    },

    // b62: 大気散乱の調整パラメータ (density / betaMie / rayleighScale / mieG / sunScale)
    // を流す。 scene 未生成 (= boot 前、 パネル mount 時) なら pending.atmoParams に
    // キー単位でマージ保留し、 boot がまとめて反映する (= setRiderShape と同じマージ方式、
    // 複数スライダー分の値が衝突せず貯まる)。
    setAtmosphereParams(params) {
      if (scene) {
        scene.setAtmosphereParams(params);
      } else {
        pending.atmoParams = { ...(pending.atmoParams || {}), ...params };
      }
    },

    // b62: 大気散乱の uniform を読む口 (= e2e の観測用)。 scene 未生成なら null。
    getAtmosphereUniforms() {
      return scene ? scene.getAtmosphereUniforms() : null;
    },

    // === 起点 / 終点マーカー ===

    // 起点 / 終点の球マーカーは 2026-05-22 に廃止 (= 地形に半分埋まり「ドーム」に
    // 見えて不要との判断)。 差し替え口契約 (map_renderer.js と 22 メソッドで対称) を
    // 保つため API は no-op で残す。
    setStartGoalVisible() {},

    // === 実行時調整 (b13-3) ===

    setRiderScale(scale) {
      if (rider3d) rider3d.group.scale.setScalar(scale);
      else pending.riderScale = scale;
    },

    // 部品ごとの形状を差し替える (= 自機形状エディタ)。 rider3d 未生成なら pending に
    // 貯め (= スライダー複数分をマージ)、 renderCourse で rider 生成後に流し込む。
    setRiderShape(shape) {
      if (rider3d) {
        rider3d.setShape(shape);
      } else {
        pending.riderShape = { ...(pending.riderShape || {}), ...shape };
      }
    },

    // 影ボード (自機足元の影専用ボード) の有効/無効を切り替える。 有効 = 影が bike に
    // くっつく、 無効 = 影はコースリボンが受ける。 既定オフ。
    setShadowBoardEnabled(on) {
      shadowBoardEnabled = !!on;
      if (rider3d) rider3d.setShadowBoard(shadowBoardEnabled);
      if (ribbon3d) ribbon3d.mesh.receiveShadow = !shadowBoardEnabled;
    },

    setCourseWidth(widthM) {
      if (!ribbon3d || !scene || !THREE || !savedCourse || !savedGeoOpts) {
        pending.courseWidth = widthM;
        return;
      }
      savedCourseWidth = widthM;
      scene.remove(ribbon3d.mesh);
      ribbon3d = createCourseRibbon(THREE, savedCourse, savedGeoOpts, { widthM, drapeOffset: currentRoadOffset });
      ribbon3d.mesh.receiveShadow = !shadowBoardEnabled;
      scene.add(ribbon3d.mesh);
      ribbonPositions = ribbon3d.mesh.geometry.getAttribute('position').array;
      if (rider3d) {
        lastRiderPlacement = rider3d.updatePose(ribbonPositions, savedCourse, lastRiderDistM);
        if (lastRiderPlacement) {
          lastTarget = { x: lastRiderPlacement.position[0], y: lastRiderPlacement.position[1], z: lastRiderPlacement.position[2] };
          lastForward = { x: lastRiderPlacement.forward[0], y: lastRiderPlacement.forward[1], z: lastRiderPlacement.forward[2] };
        }
      }
    },

    setRoadHeight(offsetM) {
      const delta = offsetM - currentRoadOffset;
      currentRoadOffset = offsetM;
      if (!ribbonPositions) {
        pending.roadHeight = offsetM;
        return;
      }
      for (let i = 1; i < ribbonPositions.length; i += 3) {
        ribbonPositions[i] += delta;
      }
      ribbon3d.mesh.geometry.attributes.position.needsUpdate = true;
      if (rider3d && savedCourse) {
        lastRiderPlacement = rider3d.updatePose(ribbonPositions, savedCourse, lastRiderDistM);
        if (lastRiderPlacement) {
          lastTarget = { x: lastRiderPlacement.position[0], y: lastRiderPlacement.position[1], z: lastRiderPlacement.position[2] };
          lastForward = { x: lastRiderPlacement.forward[0], y: lastRiderPlacement.forward[1], z: lastRiderPlacement.forward[2] };
        }
      }
      if (labels3d) labels3d.shiftY(delta);
    },

    setLabelHeight(heightM) {
      if (labels3d) labels3d.setLabelHeight(heightM);
      else pending.labelHeight = heightM;
    },

    /**
     * b39 区間名標識: 富士ヒル公式 7 landmark を 3D 走路に立てる。
     *
     * 入力 snappedLandmarks は course_landmarks.js の snapLandmarksToCourse 戻り
     * (= { id, name, idx, distance_m, lat, lon, elevation_m }[])。 boot 前 / 地形未準備で
     * 呼ばれた場合は何もしない (= viewer-maplibre.js は map3d boot 完了後 + course 読込後に
     * 呼ぶ契約、 pending 保留はしない)。 既存 landmarks3d があれば dispose + scene
     * remove してから作り直す (= 再呼出時の GPU リソース leak 防止)。
     */
    setLandmarks(snappedLandmarks) {
      if (landmarks3d) {
        landmarks3d.dispose();
        if (scene) scene.remove(landmarks3d.group);
        landmarks3d = null;
      }
      if (!THREE || !scene || !range || !stitched || !geoMeta) return;
      landmarks3d = createLandmarks3d(THREE, {
        snappedLandmarks: snappedLandmarks || [],
        range,
        stitched,
        centerLat: geoMeta.centerLat,
        centerLon: geoMeta.centerLon,
      });
      scene.add(landmarks3d.group);
    },
  };
}
