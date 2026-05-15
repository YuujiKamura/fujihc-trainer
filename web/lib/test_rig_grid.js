// 担当 D: rider 検証 test rig のグリッド背景 (= 方眼) を描画する pure 関数群.
//
// 役割:
// - rider 中心の局所平面 (= equirectangular projection) に world 緯度経度を変換し、
//   100m / 10m の grid と course path を canvas に描く.
// - bearing で全体を回転させ、 「rider の進行方向が画面上」 になるように見せる.
// - 副作用は ctx.* だけ、 DOM や MapLibre には触らない.

const M_PER_DEG_LAT = 111320;

/**
 * canvas 寸法と pxPerMeter から、 描画すべき grid 値 (= 等間隔の世界座標 m) 列を返す.
 * 旋回しても画面隅まで埋まるよう、 canvas 対角の半分を range として使う.
 *
 * @param {{width:number, height:number, pxPerMeter:number, gridSize:number}} opts
 * @returns {number[]} grid 値の昇順列 (= ..., -gridSize, 0, gridSize, ...)
 */
export function computeGridValues({ width, height, pxPerMeter, gridSize }) {
  const halfDiagPx = Math.sqrt(width * width + height * height) / 2;
  const rangeM = halfDiagPx / pxPerMeter;
  const k = Math.ceil(rangeM / gridSize);
  const out = [];
  for (let i = -k; i <= k; i++) out.push(i * gridSize);
  return out;
}

/**
 * rider 中心の local 平面 (east_m, north_m) を canvas screen 座標 (x, y) に変換する.
 * bearing=0 のとき north が画面上 (= y 軸下向きを反転して投影)、 bearing=90 のとき east が画面上.
 *
 * @param {number} e_m east 距離 (rider 比、 m)
 * @param {number} n_m north 距離 (rider 比、 m)
 * @param {{width:number, height:number, bearingDeg:number, pxPerMeter:number}} opts
 * @returns {{x:number, y:number}}
 */
export function worldToScreen(e_m, n_m, { width, height, bearingDeg, pxPerMeter }) {
  const b = bearingDeg * Math.PI / 180;
  const cosB = Math.cos(b);
  const sinB = Math.sin(b);
  // bearing 方向 (= heading) を screen up に揃えるための回転.
  // heading 単位 vec = (sin b, cos b) を (0, 1) に写すには (e, n) を +b 回転すれば良い.
  const e2 = e_m * cosB - n_m * sinB;
  const n2 = e_m * sinB + n_m * cosB;
  return {
    x: width / 2 + e2 * pxPerMeter,
    y: height / 2 - n2 * pxPerMeter,
  };
}

/**
 * 緯度経度を rider 基準の east / north メートルに変換する (= equirectangular 近似).
 * 富士ヒル域 (= 数 km 範囲) なら誤差は無視できる.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} refLat rider 緯度
 * @param {number} refLon rider 経度
 * @returns {{e_m:number, n_m:number}}
 */
export function latLonToEastNorth(lat, lon, refLat, refLon) {
  const dLat = lat - refLat;
  const dLon = lon - refLon;
  const lonScale = Math.cos(refLat * Math.PI / 180);
  return {
    e_m: dLon * M_PER_DEG_LAT * lonScale,
    n_m: dLat * M_PER_DEG_LAT,
  };
}

/**
 * 背景クリア + 10m grid + 100m grid + 100m 毎の座標 label を描画する.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{
 *   width:number, height:number,
 *   riderLat?:number, riderLon?:number,
 *   bearingDeg?:number, pxPerMeter?:number,
 *   bg?:string, gridThin?:string, gridThick?:string, label?:string,
 * }} opts
 */
export function drawGrid(ctx, opts) {
  const {
    width, height,
    bearingDeg = 0,
    pxPerMeter = 2.0,
    bg = '#111',
    gridThin = '#222',
    gridThick = '#446',
    label = '#88a',
  } = opts;

  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const halfDiagPx = Math.sqrt(width * width + height * height) / 2;
  const rangeM = halfDiagPx / pxPerMeter * 1.2; // 旋回時の余白

  const proj = { width, height, bearingDeg, pxPerMeter };

  // 10m 細線
  const values10 = computeGridValues({ width, height, pxPerMeter, gridSize: 10 });
  ctx.strokeStyle = gridThin;
  ctx.lineWidth = 1;
  for (const v of values10) {
    const a = worldToScreen(v, -rangeM, proj);
    const b = worldToScreen(v, rangeM, proj);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = worldToScreen(-rangeM, v, proj);
    const d = worldToScreen(rangeM, v, proj);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // 100m 太線
  const values100 = computeGridValues({ width, height, pxPerMeter, gridSize: 100 });
  ctx.strokeStyle = gridThick;
  ctx.lineWidth = 2;
  for (const v of values100) {
    const a = worldToScreen(v, -rangeM, proj);
    const b = worldToScreen(v, rangeM, proj);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = worldToScreen(-rangeM, v, proj);
    const d = worldToScreen(rangeM, v, proj);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // 100m 毎の座標 label (= east 方向、 north 方向に符号付き)
  ctx.fillStyle = label;
  ctx.font = '10px ui-monospace, monospace';
  for (const v of values100) {
    if (v === 0) continue;
    const pe = worldToScreen(v, 0, proj);
    ctx.fillText(`${v}m`, pe.x + 3, pe.y - 3);
    const pn = worldToScreen(0, v, proj);
    ctx.fillText(`${v}m`, pn.x + 3, pn.y - 3);
  }

  ctx.restore();
}

/**
 * course 列 (= {lat, lon, ...}) を rider 中心 local 平面に投影して polyline で描く.
 * 細い緑線、 grid 上に重ねる前提.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{lat:number, lon:number}>} course
 * @param {{
 *   width:number, height:number,
 *   riderLat:number, riderLon:number,
 *   bearingDeg:number, pxPerMeter:number,
 *   color?:string, lineWidth?:number,
 * }} opts
 */
export function drawCoursePath(ctx, course, opts) {
  if (!Array.isArray(course) || course.length === 0) return;
  const { riderLat, riderLon, color = '#7fff00', lineWidth = 2 } = opts;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const { e_m, n_m } = latLonToEastNorth(p.lat, p.lon, riderLat, riderLon);
    const sp = worldToScreen(e_m, n_m, opts);
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * rider 自身を画面中央に三角形マーカで描く (= 進行方向は常に上).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{width:number, height:number, color?:string, size?:number}} opts
 */
export function drawRiderMarker(ctx, opts) {
  const { width, height, color = '#ff5050', size = 8 } = opts;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.lineTo(size * 0.7, size * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
