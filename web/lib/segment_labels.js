// brief b-segment-labels / b9: 道路の勾配色セグメント上に「距離 + 勾配」のテキストを
// 路面ペイントのように寝かせて描くための pure functions.
//
// viewer の道路は route_styling.js / road_polygon.js が勾配色の Polygon セグメント
// (約 1968 枚) に分けて描いており、 各 polygon feature の properties には
// distance_m_start / distance_m_end / slope_pct / grade / color が入っている.
// 本 module はその Polygon FeatureCollection を入力に、 約 intervalM 間隔のラベル
// 点列を返す ── 各ラベルは表示文字列 + 中点座標 + セグメント方位 (bearing) を持つ.
//
// viewer 側はこれを MapLibre の symbol レイヤー (icon-image) で描く. 文字を canvas に
// 描いて画像化し、 各ラベルをコース脇 (= sideOffsetM だけ進行方向の右に逃がした位置)
// に billboard で立てる. 路面に寝かせる方式は走行 camera (pitch 85°) では文字が
// 地平に圧縮されて読めないため、 「脇に立てて大きく読める」方を採った (b9 追加指示).
// 脇に置くことで文字がコースの勾配色を一切隠さない利点もある.

/**
 * null / undefined / NaN を 0 に倒す (= route_styling と同じ安全側 default).
 * @param {number|null|undefined} x
 * @returns {number}
 */
function numOrZero(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 0;
  return x;
}

/**
 * 距離 (m) と勾配 (%) を 1 行の表示文字列に整形する.
 *
 * 距離は km 2 桁 (例 1437 → "1.44km") ── ラベルが指すセグメントの実距離を見せる.
 * 100m など切りの良い値に丸めた偽の値は出さない (= 選んだセグメントの実値をそのまま).
 * 勾配は % 1 桁 (負値も素直に、 例 -1.2 → "-1.2%"). 連結は " / ".
 * null / undefined / NaN は 0 扱い.
 *
 * @param {number|null|undefined} distance_m
 * @param {number|null|undefined} slope_pct
 * @returns {string}
 */
export function formatSegmentLabel(distance_m, slope_pct) {
  const d = numOrZero(distance_m);
  const s = numOrZero(slope_pct);
  return `${(d / 1000).toFixed(2)}km / ${s.toFixed(1)}%`;
}

/**
 * Polygon geometry からセグメントの中点座標と進行方位 (compass bearing) を返す.
 *
 * road_polygon.js の Polygon ring は [aLeft, bLeft, bRight, aRight, aLeft] の
 * 5 点 (= 末尾は先頭の閉じ重複). a = (aLeft + aRight) / 2、 b = (bLeft + bRight) / 2 が
 * セグメント始点 / 終点で、 中点 = (a + b) / 2 = 4 角の平均.
 * bearing = a → b の compass 方位 (0=北, 90=東, 時計回り, 度).
 *
 * @param {{type: string, coordinates: Array}} geometry
 * @returns {{lon: number, lat: number, bearing: number}|null} - 不正な geometry は null.
 */
function segmentGeometry(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return null;
  const ring = geometry.coordinates && geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const [aLeft, bLeft, bRight, aRight] = ring;
  // セグメント始点 a / 終点 b (= 左右 offset 点の中点).
  const aLon = (aLeft[0] + aRight[0]) / 2;
  const aLat = (aLeft[1] + aRight[1]) / 2;
  const bLon = (bLeft[0] + bRight[0]) / 2;
  const bLat = (bLeft[1] + bRight[1]) / 2;
  // 中点 = 4 角の平均 (= (a + b) / 2).
  const lon = (aLon + bLon) / 2;
  const lat = (aLat + bLat) / 2;
  // compass bearing: atan2(東成分, 北成分). 経度差は緯度の cos で meter 補正.
  const midLatRad = (lat * Math.PI) / 180;
  const dEast = (bLon - aLon) * Math.cos(midLatRad);
  const dNorth = bLat - aLat;
  let bearing = (Math.atan2(dEast, dNorth) * 180) / Math.PI;
  bearing = (bearing + 360) % 360;
  return { lon, lat, bearing };
}

const METERS_PER_DEG_LAT = 111320;

/**
 * lon/lat を、 進行方位 bearing の右 90° 方向に meters だけずらした点を返す.
 * ラベルをコース路面の脇に逃がす (= 勾配色を隠さない) ために使う.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {number} bearing - 進行方位 (compass 度).
 * @param {number} meters - 右方向への offset (m). 0 なら元の点をそのまま返す.
 * @returns {{lon: number, lat: number}}
 */
function offsetRight(lon, lat, bearing, meters) {
  if (!meters) return { lon, lat };
  const dirRad = (((bearing + 90) % 360) * Math.PI) / 180; // 進行方向の右 90°
  const dEast = Math.sin(dirRad) * meters;
  const dNorth = Math.cos(dirRad) * meters;
  const latRad = (lat * Math.PI) / 180;
  return {
    lon: lon + dEast / (METERS_PER_DEG_LAT * Math.cos(latRad)),
    lat: lat + dNorth / METERS_PER_DEG_LAT,
  };
}

/**
 * 勾配色 Polygon FeatureCollection を約 intervalM 間隔のラベル点列にする.
 *
 * 富士ヒルコースは約 24km / 約 1968 セグメント (= 1 セグメント ≈ 12m).
 * 全セグメントにラベルを載せると密集して読めないため、 距離 intervalM, 2*intervalM,
 * ... の各目標点について「その目標距離に最も近いセグメント」を 1 つ選ぶ.
 * default 100m → 24000 / 100 ≈ 240 ラベル. 目標点に最も近いセグメントを選ぶので、
 * セグメント境界が切りの良い距離に無くてもラベルは約 100m 間隔で並ぶ.
 *
 * ラベルが指す距離 / 勾配は「選ばれたセグメントの実値」── 目標 100m に丸めた偽値は
 * 出さない (= formatSegmentLabel が distance_m_start / slope_pct をそのまま整形).
 *
 * 選択アルゴリズム (features は距離昇順前提、 1 パス):
 *   - target を intervalM で初期化
 *   - features を順走査. distance_m_start が target を跨いだら、 直前セグメント (prev)
 *     と現セグメント (cur) のうち target に近い方を 1 ラベルとして emit、 target を
 *     intervalM 進める (gap があれば while で複数 target 分進める)
 *   - 同じセグメントが連続 target に選ばれた場合は重複 emit を抑止
 *
 * @param {{type: string, features: Array}} polygonFC - buildGradeColoredRoadPolygons の戻り値.
 * @param {number} [intervalM=100] - ラベル目標間隔 (m).
 * @param {number} [sideOffsetM=0] - ラベル位置を進行方向の右に逃がす量 (m).
 *   コース路面の脇に置いて勾配色を隠さないために使う. 0 ならセグメント中点そのまま.
 * @returns {Array<{lon: number, lat: number, text: string, distance_m: number,
 *                  slope_pct: number, bearing: number}>}
 *   lon/lat = sideOffsetM だけ右に逃がしたラベル位置. bearing = セグメント進行方位.
 */
export function buildSegmentLabels(polygonFC, intervalM = 100, sideOffsetM = 0) {
  if (!polygonFC || !Array.isArray(polygonFC.features)) return [];
  const labels = [];
  let target = intervalM;
  let prev = null; // 直前の有効セグメント { dist, slope, geometry }
  let lastEmittedDist = null; // 連続 target が同セグメントを選んだ時の重複抑止

  const emit = (item) => {
    if (!item || lastEmittedDist === item.dist) {
      if (item) lastEmittedDist = item.dist;
      return;
    }
    const geo = segmentGeometry(item.geometry);
    lastEmittedDist = item.dist;
    if (!geo) return;
    const pos = offsetRight(geo.lon, geo.lat, geo.bearing, sideOffsetM);
    labels.push({
      lon: pos.lon,
      lat: pos.lat,
      text: formatSegmentLabel(item.dist, item.slope),
      distance_m: item.dist,
      slope_pct: item.slope,
      bearing: geo.bearing,
    });
  };

  for (const f of polygonFC.features) {
    const props = f && f.properties;
    if (!props) continue;
    const dist = props.distance_m_start;
    if (dist === null || dist === undefined || Number.isNaN(dist)) continue;
    const cur = { dist, slope: props.slope_pct, geometry: f.geometry };
    while (dist >= target) {
      // target を跨いだ ── prev と cur のうち target に近い方を採る (同距離なら prev).
      const nearest = prev && Math.abs(prev.dist - target) <= Math.abs(dist - target) ? prev : cur;
      emit(nearest);
      target += intervalM;
    }
    prev = cur;
  }
  return labels;
}
