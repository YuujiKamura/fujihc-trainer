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

  it('loadOsmTile 内に osm_raster 経路 literal が現れる (= brief 30 DB cache 一次経路、 TILE_BASE_URL 経由)', () => {
    const m = viewer.match(/function\s+loadOsmTile\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    // TILE_BASE_URL は ${location.origin}/tiles に展開される. source 上は
    // `${TILE_BASE_URL}/osm_raster/${z}/${tx}/${ty}.png` で書かれる.
    expect(m[0]).toMatch(/TILE_BASE_URL[^`]*\/osm_raster\//);
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

  it('TILE_BASE_URL を使う (= localhost /tiles/... 経由)', () => {
    expect(viewer).toMatch(/TILE_BASE_URL/);
  });

  it('prefetchTilesAlongCourse 関数定義を含まない (= dead code 削除済)', () => {
    expect(viewer).not.toMatch(/function\s+prefetchTilesAlongCourse/);
    expect(viewer).not.toMatch(/prefetchTilesAlongCourse\s*=\s*function/);
  });

  // brief 21: 標高補完を inline 実装ではなく lib 経由で呼ぶ (= 二重実装防止)
  it('gsiToTerrariumUpsampled を web/lib/terrain_mesh.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*gsiToTerrariumUpsampled[^}]*\}\s+from\s+['"]\.\/lib\/terrain_mesh\.js['"]/);
  });

  it('addProtocol callback 内に標高 decode の inline loop が無い (= 純関数に委譲)', () => {
    // GSI decode の inline 数式 (= R*65536 + G*256 + B) は terrain_mesh.js 側に閉じる、
    // viewer 内で再定義していないことを確認
    expect(viewer).not.toMatch(/r\s*\*\s*65536\s*\+\s*g\s*\*\s*256\s*\+\s*b/);
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

  // brief 24 + 25: 勾配グレード色分けで道路幅 polygon 描画
  it('buildGradeColoredRoadPolygons を web/lib/road_polygon.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*buildGradeColoredRoadPolygons[^}]*\}\s+from\s+['"]\.\/lib\/road_polygon\.js['"]/);
  });

  it('route layer は line ではなく fill (= 道幅 polygon)', () => {
    // route-fill layer が定義されている、 旧 route-line (only) の置き換え済
    expect(viewer).toMatch(/id:\s*['"]route-fill['"]/);
    expect(viewer).toMatch(/['"]fill-color['"]:\s*\[['"]get['"],\s*['"]color['"]\]/);
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

  it('computeCameraParams を web/lib/camera_controller.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*computeCameraParams[^}]*\}\s+from\s+['"]\.\/lib\/camera_controller\.js['"]/);
  });

  it('adjustZoom / adjustPitch を web/lib/camera_controller.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*adjustZoom[^}]*adjustPitch[^}]*\}\s+from\s+['"]\.\/lib\/camera_controller\.js['"]|import\s+\{[^}]*adjustPitch[^}]*adjustZoom[^}]*\}\s+from\s+['"]\.\/lib\/camera_controller\.js['"]/);
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

  it('起動分岐で TEST_MODE 外は checkSetupStatus を経由する', () => {
    expect(viewer).toMatch(/checkSetupStatus\(\)\.then/);
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

describe('brief 26a: OSM を vector pbf で受ける (= 17b 積み残し fix)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('osm source は type: vector', () => {
    // 'type: 'vector'' が osm source 内に存在
    expect(viewer).toMatch(/'osm':\s*\{[^}]*type:\s*['"]vector['"]/s);
  });

  it('osm tiles URL は .pbf (= raster .png ではない)', () => {
    expect(viewer).toMatch(/\/osm\/\{z\}\/\{x\}\/\{y\}\.pbf/);
    expect(viewer).not.toMatch(/\/osm\/\{z\}\/\{x\}\/\{y\}\.png/);
  });

  it('background layer (= PMTiles 不在時の fallback) が定義済', () => {
    expect(viewer).toMatch(/type:\s*['"]background['"]/);
  });

  it('roads / water / earth の source-layer が宣言済 (= Protomaps schema)', () => {
    expect(viewer).toMatch(/['"]source-layer['"]:\s*['"]roads['"]/);
    expect(viewer).toMatch(/['"]source-layer['"]:\s*['"]water['"]/);
    expect(viewer).toMatch(/['"]source-layer['"]:\s*['"]earth['"]/);
  });

  it('旧 raster osm layer (id: osm, type: raster) は消えている', () => {
    expect(viewer).not.toMatch(/\{\s*id:\s*['"]osm['"],\s*type:\s*['"]raster['"]/);
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

  it('MAP_MODE 時は initMapMode を最初に呼ぶ', () => {
    expect(viewer).toMatch(/if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
  });

  it('initMapMode は createTestModeClient を使う (= bridge 不要)', () => {
    // initMapMode の body 内で createTestModeClient を呼ぶ
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,800}createTestModeClient\(/);
  });

  it('initMapMode は rideState.start を呼ぶ (= 自動 ride start)', () => {
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,1500}rideState\.start\(\)/);
  });

  it('initMapMode は setAppState("riding") に遷移', () => {
    expect(viewer).toMatch(/function\s+initMapMode[\s\S]{0,800}setAppState\(['"]riding['"]\)/);
  });

  it('userZoom/Pitch の hard-set は !MAP_MODE で guard されている', () => {
    // loadCourse 末尾の hard-set は MAP_MODE 時に skip、 ?z/?pitch override 可能
    // 数値は user 判断で再調整される可能性、 ここでは guard 構造の有無のみ pin する
    expect(viewer).toMatch(/if\s*\(\s*!\s*MAP_MODE\s*\)\s*\{[\s\S]{0,200}userZoom\s*=\s*\d/);
  });

  it('roads line-width interpolate は z=22 まで定義 (= ride 視点 overzoom 対策)', () => {
    // z=22 stop が含まれる、 17 で打ち切らない
    // interpolate の zoom expression は ['linear'], ['zoom'], 13, 0.5, 15, 1.5, 22, 6 の形
    expect(viewer).toMatch(/['"]line-width['"]:\s*\[['"]interpolate['"],\s*\[['"]linear['"]\],\s*\[['"]zoom['"]\][\s\S]{0,80}22,\s*\d/);
  });

  it('route-fill は最前面 (= beforeId 無し) で addLayer される', () => {
    // Fix2: OSM roads-major (= 橙線) が polygon を貫く問題を解消するため、
    // route-fill は addLayer 第 2 引数 'roads' を持たず、 最後尾 (= 最前面) に挿入する.
    // addLayer({id: 'route-fill', ...}) の直後が `)` で終わる (= 第 2 引数なし)
    expect(viewer).toMatch(/map\.addLayer\(\s*\{[^}]*id:\s*['"]route-fill['"][\s\S]{0,400}\}\s*\)\s*;/);
    // 念のため 'route-fill' の addLayer 直後に 'roads' リテラルが入ってない
    expect(viewer).not.toMatch(/id:\s*['"]route-fill['"][\s\S]{0,400}\}\s*,\s*['"]roads['"]/);
  });

  it('route-line も最前面 (= beforeId 無し) で addLayer される', () => {
    expect(viewer).toMatch(/map\.addLayer\(\s*\{[^}]*id:\s*['"]route-line['"][\s\S]{0,400}\}\s*\)\s*;/);
    expect(viewer).not.toMatch(/id:\s*['"]route-line['"][\s\S]{0,400}\}\s*,\s*['"]roads['"]/);
  });
});

// brief 29: brief 28 describe block (= MapLibre 2nd instance を pin する gate) は削除済。
// rollback 後の minimap 構造は web/tests/minimap_osm_direct.test.js (= rename 元 minimap_maplibre.test.js)
// に集約。 旧 buildMinimapBase / loadOsmTile が viewer に存在し、 #minimap-top が canvas であり、
// brief 28 の initMinimapMap / buildMapStyle が viewer に存在しないことを minimap_osm_direct で pin。
