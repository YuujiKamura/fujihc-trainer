// brief 17b: viewer-maplibre.js の外部 fetch ゼロを物理的に pin する source-grep gate。
// 1 ヶ月後に誰かが OSM 直叩きを復活させた瞬間に test が fail する。
// brief 13/17b の「外部第三者 endpoint への runtime fetch ゼロ」を維持するための
// 唯一の機械化された防衛線。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');

describe('viewer 外部 fetch ゼロ (brief 17b)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  // brief 29: minimap 限定で OSM 直叩きを許可 (= ToS 範囲内 1-shot 9-16 タイル、 z=11)。
  // ride hot path / prefetch 復活は依然禁止、 grep gate は loadOsmTile 関数内に限定する。
  it('tile.openstreetmap.org は loadOsmTile 関数内のみ (= minimap 1-shot 例外、 brief 29)', () => {
    // 全 viewer source 内の OSM URL 出現箇所を数える
    const allMatches = viewer.match(/tile\.openstreetmap\.org/g) || [];
    // loadOsmTile 関数 body を抽出して、 そこにだけ OSM URL が現れることを確認
    // `function loadOsmTile(...) { ... }` の body を非貪欲で取る
    const loadOsmTileBody = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(loadOsmTileBody).not.toBeNull();
    const insideMatches = (loadOsmTileBody[0].match(/tile\.openstreetmap\.org/g) || []).length;
    // 全出現が loadOsmTile 内に閉じている (= ride hot path / prefetch 復活なし)
    expect(insideMatches).toBe(allMatches.length);
    expect(insideMatches).toBeGreaterThan(0);
  });

  it('loadOsmTile 内に osm_raster 経路 literal が現れる (= brief 30 DB cache 一次経路、 BRIDGE_TILE_BASE_URL 経由)', () => {
    const m = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    // brief 31: TILE_BASE_URL alias を撤去、 BRIDGE_TILE_BASE_URL を直接使う。
    // source 上は `${BRIDGE_TILE_BASE_URL}/osm_raster/${z}/${tx}/${ty}.png`。
    expect(m[0]).toMatch(/BRIDGE_TILE_BASE_URL[^`]*\/osm_raster\//);
  });

  it('buildMinimapTopBase 内に /tiles/_fetch_minimap_raster POST 呼出 (= brief 30 起動時 cache 構築)', () => {
    const m = viewer.match(/function\s+buildMinimapTopBase\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
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
  it('smoothCourse を web/lib/gpx_smooth.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*smoothCourse[^}]*\}\s+from\s+['"]\.\/lib\/gpx_smooth\.js['"]/);
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

  it('terrain_loader.js が GSI_DEM_DIRECT_BASE を export (= cyberjapandata.gsi.go.jp/xyz/dem の SoT)', () => {
    expect(terrainLoader).toMatch(/export\s+const\s+GSI_DEM_DIRECT_BASE\s*=\s*['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem['"]/);
  });

  it('viewer 本体 (viewer-maplibre.js) には GSI URL literal を書かず const import 経由 (= 既存 audit 互換)', () => {
    // viewer-maplibre.js 本体には GSI URL literal が出現してはならない (= 既存 L46-48 で pin 済)
    // 本 test は補助的に「viewer は GSI_DEM_DIRECT_BASE を import している」 を pin する
    expect(viewer).toMatch(/import\s+\{[^}]*GSI_DEM_DIRECT_BASE[^}]*\}\s+from\s+['"]\.\/lib\/terrain_loader\.js['"]/);
  });

  it('map3d/index.js も GSI_DEM_DIRECT_BASE を const import 経由で受ける (= literal 散在ゼロ)', () => {
    expect(map3dIndex).toMatch(/import\s+\{[^}]*GSI_DEM_DIRECT_BASE[^}]*\}\s+from\s+['"]\.\.\/terrain_loader\.js['"]/);
    // map3d/index.js 内に GSI URL literal が直接出現しない (= SoT を 1 箇所に集約)
    expect(map3dIndex).not.toMatch(/['"]https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/dem['"]/);
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
