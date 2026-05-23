// Course definition: Mt. Fuji hill-climb (富士ヒルクライム).
//
// b71: 「設定 1 箇所変えれば zoom と範囲が切り替わる」 設計に集約 ── `terrainConfig` が
// 単一 SoT、 demBounds は terrainConfig から computeBbox() で算出。 zoom や bbox 幅を
// 変えたい時は terrainConfig.zoom / terrainConfig.bboxKm を変えるだけで他は連動。
//
// b67/b70 で導入した高精細 (z15) / 外周ストリップ (z12) の 2 段構成は b71 で廃止、 全
// mesh を単一 zoom (= terrainConfig.zoom) で作る ── 構造を simple に保つ。

// ────────────────────────────────────────────────────────────────────────────
// terrainConfig: 地形タイル取得の単一設定 (= SoT、 ここを変えれば全部追随する)
// ────────────────────────────────────────────────────────────────────────────
//
//   zoom       : GSI dem5a_png の取得 zoom (= z9-15 配信範囲内)。 z14 で約 8m / pixel、
//                z13 で約 16m、 z15 で約 4.7m。 公開時 cold load の通信量と路面感の
//                trade-off で決める ── 上げる方向の変更は配布元 courtesy に注意 (= 1
//                段上げるとタイル数 4 倍)。
//   bboxKm     : demBounds の正方形 1 辺の長さ (= km)。 12 km なら富士山頂 + コース全域
//                を包む。 大きくするとタイル数増 (= 1 km^2 増は z14 で 0.25 タイル、 z13
//                で 0.0625 タイル)。
//   centerLon  : demBounds 中央経度。 富士ヒルコース外接 ∪ 富士山頂 の中央点。
//   centerLat  : demBounds 中央緯度。 同上。
//
// Python の `src/fujihill/tile_constants.py:TERRAIN_CONFIG` と同期する (= cross-language
// drift 防止、 test_b59_dem5a.py / test 等で同値性 pin)。
const TERRAIN_CONFIG = {
  zoom: 15,
  bboxKm: 12,
  centerLon: 138.7244,
  centerLat: 35.4063,
};

// terrainConfig から demBounds (= [W, S, E, N] の bbox) を算出する純関数。 緯度 1 度 ≒
// 111.32 km、 経度 1 度は cos(lat) 倍率 (= 35.4° で約 90.7 km)。 ±(bboxKm / 2) km を
// 度に変換して bbox を作る。 端点は浮動小数精度内、 worker / test も同じ式で再計算可。
export function computeDemBounds(config) {
  const halfKm = config.bboxKm / 2;
  const dLat = halfKm / 111.32;
  const dLon = halfKm / (111.32 * Math.cos((config.centerLat * Math.PI) / 180));
  return [
    config.centerLon - dLon,
    config.centerLat - dLat,
    config.centerLon + dLon,
    config.centerLat + dLat,
  ];
}

export const fujihill = {
  id: 'fujihill',
  displayName: '富士ヒルクライム',

  // 地形タイル取得の単一設定 (= SoT)。 viewer / Python prefetch / test は全部ここから派生する。
  terrainConfig: TERRAIN_CONFIG,

  // Main-map vector / raster-dem source bounds: [sw_lon, sw_lat, ne_lon, ne_lat].
  // Passed to MapLibre as `bounds` so the renderer never requests a tile
  // outside the local DB (the fix for the "404 量産" issue, brief 34 ε-7).
  dbBounds: [138.65, 35.30, 138.85, 35.50],

  // Three.js 地形メッシュ用の DEM 取得範囲 [W, S, E, N]。 terrainConfig から算出 (= 値書き
  // 換え 1 箇所、 ここは派生)。 src/fujihill/tile_constants.py:FUJI_TERRAIN_BBOX と同値に
  // 保つ (= bridge DB 整合、 cross-language pin は zoom_bounds.test.js / test_b59_dem5a.py)。
  demBounds: computeDemBounds(TERRAIN_CONFIG),

  // Initial camera centre = bbox centre, so the default view sits well
  // inside the DB range.
  dbCenter: [138.75, 35.40],

  // Course point-list filename (GPX-derived). The viewer adds the
  // bridge/static path prefix around this; only the filename itself is
  // course-specific.
  courseFile: 'course.json',
};
