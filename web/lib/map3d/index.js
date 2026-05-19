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
import { createMarkers3d } from './markers3d.js';
import { createLabels3d, LABEL_BASE_HEIGHT_M } from './labels3d.js';
import { ROAD_OFFSET_M } from './terrain_surface.js';
import { loadDemStitched, loadPhotoCanvas } from './tile_loader3d.js';
import { sampleHeightBilinear } from '../terrain3d.js';
import { buildGradeColoredRoadPolygons } from '../road_polygon.js';
import { computeTravelHeading } from '../heading.js';
import { openTileCache } from '../tile_cache.js';

// 緯度 1 度あたりのメートル (= terrain3d.js と同値)。
const M_PER_DEG_LAT = 111320;

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
  let markers3d = null;   // 部品6
  let labels3d = null;    // 部品7
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
                    riderShape: null };

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

  // マウス操作を camera3d に流す。 drag / wheel は即座にカメラへ反映する
  // (= ride 前で updateCamera が apply=false の間も自由視点を効かせる)。
  function wireCameraInput(el) {
    let drag = null;
    el.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); });
    window.addEventListener('mouseup', () => { drag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!drag || !camera3d) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      camera3d.onDrag(dx, dy);
      camera3d.update(lastTarget || terrainCenter(), lastForward || { x: 0, y: 0, z: -1 });
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!camera3d) return;
      camera3d.onWheel(e.deltaY);
      camera3d.update(lastTarget || terrainCenter(), lastForward || { x: 0, y: 0, z: -1 });
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

          scene = createScene({ container });

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
          const dem = await loadDemStitched({ bounds: opts.dbBounds });
          stitched = dem.stitched;
          range = dem.range;

          // 航空写真テクスチャ → 地形メッシュ。
          const photoCanvas = await loadPhotoCanvas({ range: dem.range, tileCache });
          const built = buildTerrainMesh({ stitched: dem.stitched, range: dem.range, photoCanvas });
          terrainMesh = built.mesh;
          geoMeta = built.geo;
          // 地形は影を受けない (= 自機の影はコースリボンにだけ落とす)。
          scene.add(terrainMesh);

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

          wireCameraInput(container);
          handleResize();

          terrainReady = true;
          fireOnLoaded();
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
      // 影オルソカメラを自機へ追従させてから描く (= 自機の影を地形に投影する)。
      if (rider3d) scene.focusShadowOn(rider3d.group.position);
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

      // 起点 / 終点マーカー。 球半径は地形 span 比例 (= terrain3d.html の endMark 準拠)。
      markers3d = createMarkers3d(THREE, course, geoOpts, {
        radiusM: Math.max(8, terrainSpan * 0.008),
      });
      scene.add(markers3d.group);

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
      if (!rider3d || !ribbonPositions || !Array.isArray(course)) return;
      if (lon != null) lastLon = lon;
      if (lat != null) lastLat = lat;
      const distanceM = distanceAlongCourse(course, curIdx, lat, lon);
      lastRiderDistM = distanceM;
      lastRiderPlacement = rider3d.updatePose(ribbonPositions, course, distanceM);
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

    // === 起点 / 終点マーカー ===

    setStartGoalVisible(visible) {
      if (markers3d) markers3d.setStartGoalVisible(visible);
    },

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
      if (markers3d) markers3d.shiftY(delta);
    },

    setLabelHeight(heightM) {
      if (labels3d) labels3d.setLabelHeight(heightM);
      else pending.labelHeight = heightM;
    },
  };
}
