// brief 17b: viewer-maplibre.js の外部 fetch ゼロを物理的に pin する source-grep gate。
// 1 ヶ月後に誰かが OSM 直叩きを復活させた瞬間に test が fail する。
// brief 13/17b の「外部第三者 endpoint への runtime fetch ゼロ」を維持するための
// 唯一の機械化された防衛線。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
// brief 33: _site/ 配信物の規律 describe block で参照する path (= scripts/build_pages.py が生成)
const SITE_DIR = resolve(__dirname, '..', '..', '_site');

describe('viewer 外部 fetch ゼロ (brief 17b)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  // b51: minimap (loadOsmTile / buildTopBase 等) は web/lib/minimap.js に切り出し済。
  //   OSM raster は bridge の osm_raster 経路のみ、 OSM 公式直叩きは撤去済。
  it('viewer に tile.openstreetmap.org 直叩き URL が無い (= 第三者 heavy use ゼロ)', () => {
    expect((viewer.match(/tile\.openstreetmap\.org/g) || []).length).toBe(0);
  });

  it('minimap.js の loadOsmTile は osm_raster 経路 literal を使う (= bridge DB cache)', () => {
    const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');
    // `${bridgeTileBase}/osm_raster/${z}/${tx}/${ty}.png`
    expect(minimapSrc).toMatch(/bridgeTileBase[^`]*\/osm_raster\//);
  });

  it('minimap.js の buildTopBase に /tiles/_fetch_minimap_raster POST 呼出 (= 起動時 cache 構築)', () => {
    const minimapSrc = readFileSync(resolve(__dirname, '..', 'lib', 'minimap.js'), 'utf8');
    const m = minimapSrc.match(/function\s+buildTopBase\s*\([\s\S]*?\n  \}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/\/tiles\/_fetch_minimap_raster/);
    expect(m[0]).toMatch(/method:\s*['"]POST['"]/);
  });

  it('cyberjapandata.gsi.go.jp を直接叩いていない (= minimap には GSI 不要、 brief 29 で維持)', () => {
    expect(viewer).not.toMatch(/https?:\/\/cyberjapandata\.gsi\.go\.jp/);
  });

  it('BRIDGE_TILE_BASE_URL を使う (= localhost /tiles/... 経由、 brief 31 で旧 TILE_BASE_URL alias 撤去)', () => {
    expect(viewer).toMatch(/BRIDGE_TILE_BASE_URL/);
    // alias は完全撤去、 source 内に残っていないこと
    expect(viewer).not.toMatch(/const\s+TILE_BASE_URL\s*=/);
  });

  it('prefetchTilesAlongCourse 関数定義を含まない (= dead code 削除済)', () => {
    expect(viewer).not.toMatch(/function\s+prefetchTilesAlongCourse/);
    expect(viewer).not.toMatch(/prefetchTilesAlongCourse\s*=\s*function/);
  });

  // brief 21 / b12 Phase 2: 標高補完は lib 経由で呼ぶ (= 二重実装防止)。 gsidem protocol は
  // map_renderer.js に移設済なので gsiToTerrariumUpsampled の import もそちらにある。
  it('gsiToTerrariumUpsampled を web/lib/terrain_mesh.js から import している (= map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/import\s+\{[^}]*gsiToTerrariumUpsampled[^}]*\}\s+from\s+['"]\.\/terrain_mesh\.js['"]/);
    // viewer 本体には GSI decode 用 import が残っていない (= 二重実装防止)。
    expect(viewer).not.toMatch(/gsiToTerrariumUpsampled/);
  });

  it('addProtocol callback 内に標高 decode の inline loop が無い (= 純関数に委譲)', () => {
    // GSI decode の inline 数式 (= R*65536 + G*256 + B) は terrain_mesh.js 側に閉じる、
    // viewer / map_renderer 内で再定義していないことを確認
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(viewer).not.toMatch(/r\s*\*\s*65536\s*\+\s*g\s*\*\s*256\s*\+\s*b/);
    expect(renderer).not.toMatch(/r\s*\*\s*65536\s*\+\s*g\s*\*\s*256\s*\+\s*b/);
  });

  // brief 22: trainer / bridge 不要の画面操作確認モード
  it('TEST_MODE flag を URL parameter ?test で起動する', () => {
    expect(viewer).toMatch(/TEST_MODE/);
    expect(viewer).toMatch(/URLSearchParams\(location\.search\)/);
  });

  it('initTestMode が fake state を 1Hz でループする', () => {
    // brief 19b: setInterval は lib/ws_client.js の createTestModeClient 側に移行
    // viewer 側は fakeStateInterval: 1000 で 1Hz を宣言する
    expect(viewer).toMatch(/function\s+initTestMode/);
    expect(viewer).toMatch(/fakeStateInterval:\s*1000/);
  });

  it('TEST_MODE 時は connectBridge を skip する', () => {
    expect(viewer).toMatch(/if\s*\(\s*TEST_MODE\s*\)\s*initTestMode\(\)/);
  });

  // brief 23: GPS ジッター除去 (= 短距離ジグザグ補正のみ、 window=5)
  it('b50: course 読込は course_loader.js 経由 (smoothCourse は course_loader が持つ)', () => {
    // b50: fetch → smoothCourse → createTerrain は course_loader.js に切り出し済。
    //   viewer は loadCourseData を import、smoothCourse は course_loader.js が import する。
    expect(viewer).toMatch(/import\s+\{[^}]*loadCourseData[^}]*\}\s+from\s+['"]\.\/lib\/course_loader\.js['"]/);
    const loader = readFileSync(resolve(__dirname, '..', 'lib', 'course_loader.js'), 'utf8');
    expect(loader).toMatch(/import\s+\{[^}]*smoothCourse[^}]*\}\s+from\s+['"]\.\/gpx_smooth\.js['"]/);
  });

  // brief 24 + 25 / b12 Phase 2.5: 勾配グレード色分けの道路幅 polygon 描画は
  // 地図描画モジュール (map_renderer.js) の renderCourse が持つ。
  it('buildGradeColoredRoadPolygons を road_polygon.js から import している (= map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/import\s+\{[^}]*buildGradeColoredRoadPolygons[^}]*\}\s+from\s+['"]\.\/road_polygon\.js['"]/);
  });

  it('route layer は line ではなく fill (= 道幅 polygon、 map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/id:\s*['"]route-fill['"]/);
    expect(renderer).toMatch(/['"]fill-color['"]:\s*\[['"]get['"],\s*['"]color['"]\]/);
  });
});

describe('brief 19b: viewer 統合層 (ws_client / ride_state / camera_controller)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('createBridgeClient を web/lib/ws_client.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createBridgeClient[^}]*\}\s+from\s+['"]\.\/lib\/ws_client\.js['"]/);
  });

  it('createTestModeClient を web/lib/ws_client.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createTestModeClient[^}]*\}\s+from\s+['"]\.\/lib\/ws_client\.js['"]/);
  });

  it('createRideState を web/lib/ride_state.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createRideState[^}]*\}\s+from\s+['"]\.\/lib\/ride_state\.js['"]/);
  });

  // b12 Phase 2.5: カメラ計算 (computeCameraParams) と ホイール/ドラッグ操作
  // (adjustZoom / adjustPitch) は地図描画モジュール (map_renderer.js) の中。
  it('computeCameraParams を camera_controller.js から import している (= map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/import\s+\{[^}]*computeCameraParams[^}]*\}\s+from\s+['"]\.\/camera_controller\.js['"]/);
  });

  it('adjustZoom / adjustPitch を camera_controller.js から import している (= map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/import\s+\{[^}]*adjustZoom[^}]*adjustPitch[^}]*\}\s+from\s+['"]\.\/camera_controller\.js['"]|import\s+\{[^}]*adjustPitch[^}]*adjustZoom[^}]*\}\s+from\s+['"]\.\/camera_controller\.js['"]/);
  });

  it('ws.send 呼出が viewer 内に存在しない (= client.sendXxx に統合済)', () => {
    expect(viewer).not.toMatch(/\bws\.send\s*\(/);
  });

  it('new WebSocket() を viewer 直接呼出が無い (= createBridgeClient 経由)', () => {
    expect(viewer).not.toMatch(/new\s+WebSocket\s*\(/);
  });

  it('let ws = null 廃止 (= let client = null に置換)', () => {
    expect(viewer).not.toMatch(/^let\s+ws\s*=\s*null/m);
    expect(viewer).toMatch(/let\s+client\s*=\s*null/);
  });

  it('curIdx / curDist global 廃止 (= rideState.snapshot 経由)', () => {
    expect(viewer).not.toMatch(/^let\s+curIdx\s*=/m);
    expect(viewer).not.toMatch(/^let\s+curDist\s*=/m);
  });
});

describe('brief 26b: 起動 DB 構築フロー + 4 状態 state machine', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');
  const INDEX_PATH = resolve(__dirname, '..', 'index.html');
  const indexHtml = readFileSync(INDEX_PATH, 'utf8');

  it('setAppState の初期値が checking (= state-pairing 初期発火 廃止)', () => {
    // 旧コード setAppState('pairing'); は廃止
    expect(viewer).not.toMatch(/^setAppState\(['"]pairing['"]\)/m);
    // 新コード: 初期 setAppState('checking')
    expect(viewer).toMatch(/setAppState\(['"]checking['"]\)/);
  });

  it('checkSetupStatus が /tiles/_setup_status を fetch する', () => {
    expect(viewer).toMatch(/function\s+checkSetupStatus\s*\(/);
    expect(viewer).toMatch(/\/tiles\/_setup_status/);
  });

  it('起動分岐で TEST_MODE 外は bootEnv 経由で checkSetupStatus を呼ぶ (= brief 31 commit β)', () => {
    // bootEnv が checkSetupStatus を await する形に変更、 旧 .then 連鎖は撤去済
    expect(viewer).toMatch(/await\s+checkSetupStatus\s*\(\s*\)/);
    expect(viewer).toMatch(/bootEnv\s*\(\s*\)\s*\.then\(/);
  });

  it('dbinit_progress ハンドラが wsHandlers に登録されている', () => {
    expect(viewer).toMatch(/dbinit_progress\s*\(\s*msg\s*\)/);
    expect(viewer).toMatch(/handleDbinitProgress/);
  });

  it('POST /tiles/_fetch_gsi / _extract_osm を呼ぶ', () => {
    expect(viewer).toMatch(/\/tiles\/_fetch_gsi/);
    expect(viewer).toMatch(/\/tiles\/_extract_osm/);
  });

  it('index.html に dbinit-overlay 要素群が存在する (= 5 要素)', () => {
    expect(indexHtml).toMatch(/id="dbinit-overlay"/);
    expect(indexHtml).toMatch(/id="dbinit-gsi-bar"/);
    expect(indexHtml).toMatch(/id="dbinit-osm-bar"/);
    expect(indexHtml).toMatch(/id="btnFetchGsi"/);
    expect(indexHtml).toMatch(/id="btnExtractOsm"/);
    expect(indexHtml).toMatch(/id="btnDbinitSkip"/);
  });

  it('dbinit-overlay は setup-overlay と独立 DOM (= 混入禁止 NG-R1-3)', () => {
    // setup-panel の中に dbinit 系 id が混じっていない
    const setupBlock = indexHtml.match(/<div id="setup-overlay"[\s\S]*?<\/div>\s*<\/div>/);
    if (setupBlock) {
      expect(setupBlock[0]).not.toMatch(/id="dbinit-/);
      expect(setupBlock[0]).not.toMatch(/btnFetchGsi|btnExtractOsm|btnDbinitSkip/);
    }
  });

  it('body 初期 class が state-checking (= state-pairing 初期廃止)', () => {
    expect(indexHtml).toMatch(/<body class="state-checking"/);
  });

  it('CSS に body.state-dbinit / body.state-checking 規則が存在', () => {
    expect(indexHtml).toMatch(/body\.state-dbinit/);
    expect(indexHtml).toMatch(/body\.state-checking/);
  });
});

describe('brief 26a / b12 Phase 2: OSM を vector pbf で受ける (= buildMapStyle / COMMON_LAYERS は map_renderer.js)', () => {
  // b12 Phase 2: buildMapStyle / COMMON_LAYERS は map_renderer.js へ移設済。
  const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');

  it('osm source は type: vector', () => {
    expect(renderer).toMatch(/'osm':\s*\{[^}]*type:\s*['"]vector['"]/s);
  });

  it('osm tiles URL は .pbf (= raster .png ではない)', () => {
    expect(renderer).toMatch(/\/osm\/\{z\}\/\{x\}\/\{y\}\.pbf/);
    expect(renderer).not.toMatch(/\/osm\/\{z\}\/\{x\}\/\{y\}\.png/);
  });

  it('background layer (= PMTiles 不在時の fallback) が定義済', () => {
    expect(renderer).toMatch(/type:\s*['"]background['"]/);
  });

  it('roads / water / earth の source-layer が宣言済 (= Protomaps schema)', () => {
    expect(renderer).toMatch(/['"]source-layer['"]:\s*['"]roads['"]/);
    expect(renderer).toMatch(/['"]source-layer['"]:\s*['"]water['"]/);
    expect(renderer).toMatch(/['"]source-layer['"]:\s*['"]earth['"]/);
  });

  it('旧 raster osm layer (id: osm, type: raster) は消えている', () => {
    expect(renderer).not.toMatch(/\{\s*id:\s*['"]osm['"],\s*type:\s*['"]raster['"]/);
  });
});

// MAP MODE: UI 操作なしで地図表示だけ確認できるモード (= AI / 自動 capture 用).
// brief 22 の TEST_MODE と同型、 加えて ride 自動 start + 全 overlay hide.
describe('viewer MAP_MODE (?map=1) で UI 操作ゼロの地図表示確認', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('MAP_MODE flag を URL parameter ?map で起動する', () => {
    expect(viewer).toMatch(/MAP_MODE\s*=\s*new\s+URLSearchParams\(location\.search\)\.has\(['"]map['"]\)/);
  });

  it('initMapMode 関数が定義済', () => {
    expect(viewer).toMatch(/function\s+initMapMode/);
  });

  it('MAP_MODE 時は initMapMode を呼ぶ (= brief 34 ε-2 で dispatchAfterIntro 関数内に格納)', () => {
    // brief 34 ε-2: 旧 module-top `if (MAP_MODE) initMapMode()` は dispatchAfterIntro
    // 関数内に移動、 module top は introConsented() guard 経由でのみ呼ぶ。
    expect(viewer).toMatch(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]{0,800}if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
  });

  it('initMapMode は createTestModeClient を使う (= bridge 不要)', () => {
    // initMapMode の body 内で createTestModeClient を呼ぶ。
    // brief 31 で先頭に `if (!map) { ensureMapBooted... }` ガードが入ったため上限を 1000 に拡張。
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,1000}createTestModeClient\(/);
  });

  it('initMapMode は rideState.start を呼ぶ (= 自動 ride start)', () => {
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,2500}rideState\.start\(\)/);
  });

  it('initMapMode は setAppState("riding") に遷移', () => {
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,800}setAppState\(['"]riding['"]\)/);
  });

  it('MAP_MODE は map idle を待ってから ride 開始 (= 全描画完了まで待機)', () => {
    // b12 Phase 2: 'idle' 購読は map_renderer 経由 (= mapRenderer.onceIdle)。
    expect(viewer).toMatch(/mapRenderer\.onceIdle\(/);
  });

  it('ローディングインジケータ #loading-indicator が viewer から制御される', () => {
    expect(viewer).toMatch(/getElementById\(['"]loading-indicator['"]/);
  });

  it('カメラ default の hard-set は !MAP_MODE で guard されている', () => {
    // b12 Phase 2.5: loadCourse の走行視点 default は renderer.setCameraDefaults 経由。
    // MAP_MODE 時は skip して initMapMode の ?z/?pitch を活かす。 guard 構造を pin する。
    expect(viewer).toMatch(/if\s*\(\s*!\s*MAP_MODE\s*\)\s*\{[\s\S]{0,200}setCameraDefaults\(/);
  });

  it('roads line-width interpolate は z=22 まで定義 (= ride 視点 overzoom 対策)', () => {
    // z=22 stop が含まれる、 17 で打ち切らない。 b12 Phase 2: COMMON_LAYERS は map_renderer.js。
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/['"]line-width['"]:\s*\[['"]interpolate['"],\s*\[['"]linear['"]\],\s*\[['"]zoom['"]\][\s\S]{0,80}22,\s*\d/);
  });

  it('route-fill は最前面 (= beforeId 無し) で addLayer される (= map_renderer.js)', () => {
    // Fix2: OSM roads-major (= 橙線) が polygon を貫く問題を解消するため、
    // route-fill は addLayer 第 2 引数 'roads' を持たず、 最後尾 (= 最前面) に挿入する.
    // b12 Phase 2.5: route layer 群の addLayer は renderCourse (map_renderer.js) の中。
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/addLayer\(\s*\{[^}]*id:\s*['"]route-fill['"][\s\S]{0,400}\}\s*\)\s*;/);
    expect(renderer).not.toMatch(/id:\s*['"]route-fill['"][\s\S]{0,400}\}\s*,\s*['"]roads['"]/);
  });

  it('route-line も最前面 (= beforeId 無し) で addLayer される (= map_renderer.js)', () => {
    const renderer = readFileSync(resolve(__dirname, '..', 'lib', 'map_renderer.js'), 'utf8');
    expect(renderer).toMatch(/addLayer\(\s*\{[^}]*id:\s*['"]route-line['"][\s\S]{0,400}\}\s*\)\s*;/);
    expect(renderer).not.toMatch(/id:\s*['"]route-line['"][\s\S]{0,400}\}\s*,\s*['"]roads['"]/);
  });
});

// brief 29: brief 28 describe block (= MapLibre 2nd instance を pin する gate) は削除済。
// rollback 後の minimap 構造は web/tests/minimap_osm_direct.test.js (= rename 元 minimap_maplibre.test.js)
// に集約。 旧 buildMinimapBase / loadOsmTile が viewer に存在し、 #minimap-top が canvas であり、
// brief 28 の initMinimapMap / buildMapStyle が viewer に存在しないことを minimap_osm_direct で pin。

// b31: terrain 経路の GSI dem 許可と物理 gate (= viewer-maplibre.js 単体 scan の scope 外、
// lib 側 source を別途 grep)。 既存 describe (= brief 17b の viewer 単体 GSI 直叩き禁止) は
// 無改変で継続 pin、 本 describe は lib 側で GSI dem direct 経路を許可することと、
// CLAUDE.md §地図タイル配布元への配慮 の物理 gate (= FETCH_LIMIT / MAX_TILES / seamlessphoto 固定)
// が tile_loader3d.js source に居続けることを pin する。
describe('b31: terrain 経路の GSI dem 許可と物理 gate', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');
  const terrainLoader = readFileSync(resolve(__dirname, '..', 'lib', 'terrain_loader.js'), 'utf8');
  const tileLoader3d = readFileSync(resolve(__dirname, '..', 'lib', 'map3d', 'tile_loader3d.js'), 'utf8');
  const map3dIndex = readFileSync(resolve(__dirname, '..', 'lib', 'map3d', 'index.js'), 'utf8');
  // b42: probe オーケストレーションは terrain_phase.js へ切り離し済 (= GSI direct base を
  // loader へ渡す責務もここ)。
  const terrainPhase = readFileSync(resolve(__dirname, '..', 'lib', 'terrain_phase.js'), 'utf8');

  it('terrain_loader.js が GSI_DEM_DIRECT_BASE を export (= cyberjapandata.gsi.go.jp/xyz/dem5a_png の SoT)', () => {
    // b59: viewer の PNG decode 経路と整合する dem5a_png (= 5mメッシュ、 z15) を使う。
    expect(terrainLoader).toMatch(/export\s+const\s+GSI_DEM_DIRECT_BASE\s*=\s*['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem5a_png['"]/);
  });

  it('viewer 本体 (viewer-maplibre.js) には GSI URL literal が出現しない (= 既存 audit 互換)', () => {
    // viewer-maplibre.js 本体には GSI URL literal が出現してはならない (= 既存 L46-48 で pin 済)。
    // b42: probe オーケストレーションが terrain_phase.js へ切り離され、viewer は
    // GSI_DEM_DIRECT_BASE を import しなくなった。GSI URL literal 不在は引き続き pin。
    expect(viewer).not.toMatch(/cyberjapandata\.gsi\.go\.jp/);
  });

  it('terrain_phase.js が GSI_DEM_DIRECT_BASE を const import 経由で受ける (= b42 移管先、literal 散在ゼロ)', () => {
    // b42: GSI direct base を terrain_loader へ渡す責務は terrain_phase.js。import は
    // const 経由、terrain_phase.js 本体に GSI URL literal は書かない (= SoT は terrain_loader.js)。
    expect(terrainPhase).toMatch(/import\s+\{[^}]*GSI_DEM_DIRECT_BASE[^}]*\}\s+from\s+['"]\.\/terrain_loader\.js['"]/);
    expect(terrainPhase).not.toMatch(/cyberjapandata\.gsi\.go\.jp/);
  });

  it('map3d/index.js も GSI_DEM_DIRECT_BASE を const import 経由で受ける (= literal 散在ゼロ)', () => {
    expect(map3dIndex).toMatch(/import\s+\{[^}]*GSI_DEM_DIRECT_BASE[^}]*\}\s+from\s+['"]\.\.\/terrain_loader\.js['"]/);
    // map3d/index.js 内に GSI URL literal が直接出現しない (= SoT を 1 箇所に集約)
    expect(map3dIndex).not.toMatch(/['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem['"]/);
  });

  it('b36 配布元境界: viewer / map3d / tile_loader3d source に `/xyz/dem/[0-9]` パターン (= txt endpoint への .png 拡張子付与) が出現しない', () => {
    // 2026-05-20 root cause: `dem` (= txt endpoint) を `.png` で叩いて 404、 Pages で地形が
    // 読まれない事故。 source 内に `/xyz/dem/<zoom_digit>` パターンが直接出現したら、
    // 過去事故の re-introduction として LOAD-BEARING で fail させる (= b36 § テストで pin L1 補強)。
    expect(viewer).not.toMatch(/\/xyz\/dem\/[0-9]/);
    expect(map3dIndex).not.toMatch(/\/xyz\/dem\/[0-9]/);
    expect(tileLoader3d).not.toMatch(/\/xyz\/dem\/[0-9]/);
  });

  it('tile_loader3d.js に GSI_FETCH_LIMIT=6 / MAX_TILES=200 / seamlessphoto 固定 (= CLAUDE.md 規律) の物理 gate が同時存在', () => {
    expect(tileLoader3d).toMatch(/export\s+const\s+GSI_FETCH_LIMIT\s*=\s*6/);
    expect(tileLoader3d).toMatch(/export\s+const\s+MAX_TILES\s*=\s*200/);
    expect(tileLoader3d).toMatch(/GSI_SEAMLESSPHOTO_BASE\s*=\s*['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/seamlessphoto['"]/);
  });

  it('terrain_loader.js は cfg.tileCache + cfg.gsiDirectBase を受け取れる shape (= b31 chain DI)', () => {
    expect(terrainLoader).toMatch(/cfg\.tileCache/);
    expect(terrainLoader).toMatch(/cfg\.gsiDirectBase/);
  });

  it('terrain_loader.js / tile_loader3d.js 内に #attrib / maplibregl-ctrl-attrib literal が存在しない (= 出典機構の責務分離維持)', () => {
    // 出典機構は index.html の static #attrib + viewer-maplibre.js の verifyAttributionVisible()
    // 本 lib 側に出典 DOM 識別子が出現すると責務分離が壊れる
    expect(terrainLoader).not.toMatch(/['"]#attrib['"]/);
    expect(terrainLoader).not.toMatch(/maplibregl-ctrl-attrib/);
    expect(tileLoader3d).not.toMatch(/['"]#attrib['"]/);
    expect(tileLoader3d).not.toMatch(/maplibregl-ctrl-attrib/);
  });

  it('loadDemStitched は tileCache + gsiDirectBase 引数を受ける (= seamlessphoto と同パターン)', () => {
    // loadDemStitched({ bounds, tileCache, gsiDirectBase, onProgress }) signature を pin
    expect(tileLoader3d).toMatch(/export\s+async\s+function\s+loadDemStitched\s*\(\s*\{[^}]*tileCache[^}]*\}/);
    expect(tileLoader3d).toMatch(/export\s+async\s+function\s+loadDemStitched\s*\(\s*\{[^}]*gsiDirectBase[^}]*\}/);
  });

  // b67: bridge 段撤去 + 広域低精細メッシュ用 dem_png endpoint の SoT。
  it('b67: terrain_loader.js が GSI_DEM_PNG_DIRECT_BASE を export (= dem_png 系統 SoT、 dem5a と独立)', () => {
    expect(terrainLoader).toMatch(/export\s+const\s+GSI_DEM_PNG_DIRECT_BASE\s*=\s*['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem_png['"]/);
  });

  it('b67: tile_loader3d.js から demBaseUrl 関数 / bridgeBase literal / /tiles/gsi_dem prefix が消えている (= bridge 段撤去 negative grep)', () => {
    // bridge 経路の死んだ往復は撤去済。 旧コードを誰かが復活させた瞬間 fail。
    expect(tileLoader3d).not.toMatch(/function\s+demBaseUrl/);
    expect(tileLoader3d).not.toMatch(/bridgeBase/);
    expect(tileLoader3d).not.toMatch(/\/tiles\/gsi_dem/);
  });

  it('b67: loadDemStitched が zoom 引数を受ける (= 広域低精細メッシュ z12 と高精細 z15 で再利用)', () => {
    expect(tileLoader3d).toMatch(/export\s+async\s+function\s+loadDemStitched\s*\(\s*\{[^}]*zoom[^}]*\}/);
  });
});

// brief 31: GitHub Pages 静的サイト化に伴う外部 URL gate の拡張。
// pmtiles の CDN 経由化は NG-R3-7 / NG-R1-15 と境界が曖昧になるため block。
describe('brief 31: 外部 fetch ゼロ規律の拡張 (= pmtiles CDN 経由 block)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('viewer source 内に pmtiles の floating tag CDN URL が現れない', () => {
    expect(viewer).not.toMatch(/https?:\/\/unpkg\.com\/pmtiles/);
    expect(viewer).not.toMatch(/https?:\/\/cdn\.jsdelivr\.net\/npm\/pmtiles/);
  });

  it('STATIC_TILE_BASE_URL は ${BASE_PATH}static の path 構成 (= GitHub Pages prefix 追従)', () => {
    expect(viewer).toMatch(/STATIC_TILE_BASE_URL\s*=\s*`\$\{location\.origin\}\$\{BASE_PATH\}static`/);
  });
});

// brief 33: _site/ 配信物の規律 (= build_pages.py で生成した artifact の URL pin)。
// 既存 describe block (= b17b の viewer-maplibre.js source 単体 scan) には触らず、
// 新規 describe で _site/ 配下を target にする (= b31 worker 編集との衝突回避)。
//
// 実行前提: `python scripts/build_pages.py` で _site/ を生成済。
// _site/ が存在しないと最初の it 句で fail-fast (= silent skip 防止、 軸 7 fix)。
describe('_site/ 配信物の規律 (= brief 33)', () => {
  it('_site/ ディレクトリが存在する (= build_pages.py が走った前提、 不在なら CI step 順設定ミス)', () => {
    expect(existsSync(SITE_DIR)).toBe(true);
  });

  it('_site/index.html から Strava CDN URL が消えている (= class C1 除外)', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\/(www|api|cdn-\d+)\.strava\.com/);
    expect(html).not.toMatch(/https?:\/\/\*\.strava\.com/);
  });

  // 2026-05-20 fix: viewer-maplibre.js が L48 で strava_oauth.js から import してるため、
  // source 自体を削除すると module evaluation が落ちて viewer boot がゼロになる
  // (= 公開後の実画面確認で発覚)。 source は配信維持、 Strava endpoint への通信は
  // CSP の connect-src / img-src 削除 (= 既存「Strava CDN URL が消えている」 test で pin)
  // で物理 block する 2 段構え。
  it('_site/lib/strava_oauth.js が source 配信される (= viewer import 経路維持、 endpoint 通信は CSP で block)', () => {
    expect(existsSync(resolve(SITE_DIR, 'lib', 'strava_oauth.js'))).toBe(true);
  });

  it('_site/lib/strava_upload.js が source 配信される (= 同上)', () => {
    expect(existsSync(resolve(SITE_DIR, 'lib', 'strava_upload.js'))).toBe(true);
  });

  it('_site/oauth-callback.html が不在 (= class C1 除外、 visitor から到達不能)', () => {
    expect(existsSync(resolve(SITE_DIR, 'oauth-callback.html'))).toBe(false);
  });

  it('_site/index.html から Strava 関連 DOM 13 個が消えている', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    const STRAVA_IDS = [
      'strava-section', 'strava-fold', 'strava-status',
      'btnStravaConnect', 'btnStravaDisconnect',
      'strava-setup-overlay', 'stravaClientIdInput',
      'btnStravaSetupSave', 'btnStravaSetupCancel',
      'postride-strava-fold', 'btnStravaUpload',
      'postride-upload-status', 'chkConsentStrava',
    ];
    for (const id of STRAVA_IDS) {
      expect(html).not.toMatch(new RegExp(`id="${id}"`));
    }
  });

  it('_site/static/tiles/gsi_dem/ が不在 (= 配布元 ToS 違反防止、 class C1 統合)', () => {
    expect(existsSync(resolve(SITE_DIR, 'static', 'tiles', 'gsi_dem'))).toBe(false);
  });

  it('_site/index.html の CSP が stripped 版 (= connect-src に strava 含まず、 img-src も同様)', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    const csp = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"|<meta[^>]*content="([^"]+)"[^>]*http-equiv="Content-Security-Policy"/);
    expect(csp).not.toBeNull();
    const policy = csp[1] || csp[2];
    expect(policy).not.toMatch(/strava\.com/);
    expect(policy).toMatch(/connect-src 'self' https:\/\/cyberjapandata\.gsi\.go\.jp/);
    expect(policy).toMatch(/img-src 'self' data:/);
    expect(policy).toMatch(/script-src 'self' 'sha256-/);  // importmap hash は維持
    expect(policy).toMatch(/worker-src 'self' blob:/);     // maplibre worker bundle は維持
    expect(policy).toMatch(/frame-ancestors 'none'/);      // 軸 7 (e) fix、 clickjack 防止 baseline
    expect(policy).toMatch(/form-action 'self'/);          // 軸 7 (e) fix、 form 改竄防止 baseline
    expect(policy).toMatch(/object-src 'none'/);           // 古い plugin 経路の物理排除
    expect(policy).toMatch(/base-uri 'self'/);             // base tag 改竄防止
  });

  it('_site/sw.js の CACHE_NAME が bump 済 (= 軸 6 NG-R2-1、 b46 で v20)', () => {
    // b46: index.html / viewer-maplibre.js を改変したので sw.js の CACHE_NAME を bump。
    //   _site/sw.js は scripts/build_pages.py が web/sw.js から再生成する build artifact。
    const sw = readFileSync(resolve(SITE_DIR, 'sw.js'), 'utf8');
    expect(sw).toMatch(/CACHE_NAME = 'fujihill-v20'/);
    expect(sw).not.toMatch(/CACHE_NAME = 'fujihill-v19'/);
  });

  it('残すもの = Web Bluetooth consent が _site/index.html に保持されている (= 過削除防止)', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    expect(html).toMatch(/id="consent-overlay"/);
    expect(html).toMatch(/id="intro-overlay"/);
  });

  it('残すもの = HUD / minimap / section list が _site/index.html に保持されている', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    expect(html).toMatch(/id="hud"/);
    expect(html).toMatch(/id="rider-hud"/);
    expect(html).toMatch(/id="minimap-container"/);
    expect(html).toMatch(/id="section-list-panel"/);
  });

  it('残すもの = 履歴 overlay が _site/index.html に保持されている (= IndexedDB ローカル history)', () => {
    const html = readFileSync(resolve(SITE_DIR, 'index.html'), 'utf8');
    expect(html).toMatch(/id="history-overlay"/);
    expect(html).toMatch(/id="history-panel"/);
  });
});
