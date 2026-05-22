// Course definition: Mt. Fuji hill-climb (富士ヒルクライム).
//
// b12 Phase 1 — fuji-specific values that were inlined across
// viewer-maplibre.js are collected here as one course-definition object.
// Pointing the viewer at a different hill-climb later means adding one
// more definition file like this; no viewer-body change.
//
// These are the *exact* values that were inline — behaviour is unchanged.
export const fujihill = {
  id: 'fujihill',
  displayName: '富士ヒルクライム',

  // Main-map vector / raster-dem source bounds: [sw_lon, sw_lat, ne_lon, ne_lat].
  // Passed to MapLibre as `bounds` so the renderer never requests a tile
  // outside the local DB (the fix for the "404 量産" issue, brief 34 ε-7).
  dbBounds: [138.65, 35.30, 138.85, 35.50],

  // b59: Three.js 地形メッシュ用の DEM 取得範囲 [W, S, E, N]。 viewer の loadDemStitched
  // にはこの demBounds を渡す (= dbBounds ではない)。 値は富士ヒルコース全点の外接矩形に
  // 富士山頂 (138.7274, 35.3606) を union し +500m buffer したもの ── 山頂を含めるのは
  // コース南端 (lat 35.373) より南の富士山体が 3D 地形に乗らず切れるのを防ぐため。
  // dem5a z15 で 96 tiles (MAX_TILES 200 内)。 dbBounds 全域 (22km四方) を z15 で取ると
  // 437 tiles で MAX_TILES 超過 → 地形が組めない、 ためコース外接に絞る (b59)。
  // src/fujihill/tile_constants.py:FUJI_TERRAIN_BBOX と同値に保つ (= bridge DB 整合)。
  demBounds: [138.6845, 35.3561, 138.7642, 35.4566],

  // Initial camera centre = bbox centre, so the default view sits well
  // inside the DB range.
  dbCenter: [138.75, 35.40],

  // Course point-list filename (GPX-derived). The viewer adds the
  // bridge/static path prefix around this; only the filename itself is
  // course-specific.
  courseFile: 'course.json',
};
