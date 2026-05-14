// Web Mercator XYZ tile math (pure functions).
// 既存 viewer-maplibre.js から切り出し、 同 logic で test 可能に。

export function lonToTileX(lon, zoom) {
  return (lon + 180) / 360 * Math.pow(2, zoom);
}

export function latToTileY(lat, zoom) {
  const latRad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom);
}

export function tileXToLon(x, zoom) {
  return x / Math.pow(2, zoom) * 360 - 180;
}

export function tileYToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
