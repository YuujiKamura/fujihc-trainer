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

  // Initial camera centre = bbox centre, so the default view sits well
  // inside the DB range.
  dbCenter: [138.75, 35.40],

  // Course point-list filename (GPX-derived). The viewer adds the
  // bridge/static path prefix around this; only the filename itself is
  // course-specific.
  courseFile: 'course.json',
};
