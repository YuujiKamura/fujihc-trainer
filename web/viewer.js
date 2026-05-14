// fujihc viewer phase 0
// - load course.json (exported by `python -m fujihc.course <gpx> --export-json web/course.json`)
// - draw the GPX as a yellow polyline clamped to ground
// - move a camera along the route in test mode (auto progress)
// - HUD shows distance / elevation / slope / play speed
//
// trainer integration is NOT YET HOOKED — the play speed comes from on-screen
// buttons. Phase 1 will replace `playSpeed` with a WebSocket feed from
// trainer-bridge.

const status = (msg) => { document.getElementById('status').textContent = msg; };

// Cesium Ion: token なしでも default Bing Maps の代わりに自前 EllipsoidTerrain
// + OpenStreetMap imagery で動かす (= sign-up 不要、まず動かす)。
const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  imageryProvider: new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
  }),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  timeline: false,
  animation: false,
  infoBox: false,
  selectionIndicator: false,
});
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere.show = true;

let course = [];
let totalDist = 0;
let curDist = 0;
let curIdx = 0;
let playSpeed = 30;   // m/s, テストモード初期値
let paused = false;
let lastT = performance.now();

// --- Phase 1: bridge WebSocket ---------------------------------------
// bridge.py が ws://localhost:8765 に立っている前提で接続を試みる。
// 失敗時は test mode (playSpeed=30 固定) のまま動かす。
const WS_URL = 'ws://localhost:8765';
let ws = null;
let wsConnected = false;
let lastSlopeSent = null;
let lastSlopeSendT = 0;
const SLOPE_SEND_INTERVAL_MS = 1000;  // 1Hz

function connectBridge() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    status(`bridge 接続失敗 (${err.message}) - test mode で続行`);
    return;
  }
  ws.addEventListener('open', () => {
    wsConnected = true;
    status('bridge 接続済 (ws://localhost:8765)');
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'state' && typeof msg.speed_mps === 'number') {
      // bridge からの実速度を test mode の playSpeed に反映
      playSpeed = msg.speed_mps;
    }
  });
  ws.addEventListener('close', () => {
    if (wsConnected) status('bridge 切断 - test mode にフォールバック');
    wsConnected = false;
  });
  ws.addEventListener('error', () => {
    // 'close' が後続するのでメッセージはそちらで出す
  });
}

function maybeSendSlope(slope_pct) {
  if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastSlopeSendT < SLOPE_SEND_INTERVAL_MS) return;
  if (lastSlopeSent !== null && Math.abs(slope_pct - lastSlopeSent) < 0.1) return;
  ws.send(JSON.stringify({ type: 'set_slope', slope_pct }));
  lastSlopeSent = slope_pct;
  lastSlopeSendT = now;
}

connectBridge();

async function loadCourse() {
  try {
    const resp = await fetch('course.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    course = await resp.json();
  } catch (err) {
    status(`course.json load failed: ${err.message}. 先に  python -m fujihc.course <gpx> --export-json web/course.json  を実行`);
    return;
  }
  if (!course.length) { status('course.json empty'); return; }

  totalDist = course[course.length - 1].distance_m;
  document.getElementById('total').textContent = totalDist.toFixed(0);
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  // route polyline
  const cart = course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m));
  viewer.entities.add({
    polyline: {
      positions: cart,
      width: 4,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25, color: Cesium.Color.YELLOW,
      }),
      clampToGround: true,
    },
  });

  // start marker
  viewer.entities.add({
    position: cart[0],
    point: { pixelSize: 14, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: { text: 'start', font: '14px monospace', pixelOffset: new Cesium.Cartesian2(0, -20) },
  });
  // goal marker
  viewer.entities.add({
    position: cart[cart.length - 1],
    point: { pixelSize: 14, color: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
    label: { text: 'goal', font: '14px monospace', pixelOffset: new Cesium.Cartesian2(0, -20) },
  });

  // initial camera: 全体俯瞰
  const bbox = boundingBox(course);
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(bbox.minLon - 0.01, bbox.minLat - 0.01, bbox.maxLon + 0.01, bbox.maxLat + 0.01),
    duration: 2.5,
    complete: () => requestAnimationFrame(tick),
  });
}

function boundingBox(c) {
  let minLat=Infinity, maxLat=-Infinity, minLon=Infinity, maxLon=-Infinity;
  for (const p of c) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function tick(t) {
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (!paused && curDist < totalDist) {
    curDist = Math.min(curDist + playSpeed * dt, totalDist);
  }
  // advance index
  while (curIdx < course.length - 1 && course[curIdx + 1].distance_m < curDist) curIdx++;
  const p = course[curIdx];

  // camera: 進行点の少し後ろ上空から進行方向を見る
  const nextIdx = Math.min(curIdx + 5, course.length - 1);
  const cur = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m);
  const ahead = Cesium.Cartesian3.fromDegrees(course[nextIdx].lon, course[nextIdx].lat, course[nextIdx].elevation_m);
  const back = Cesium.Cartesian3.lerp(cur, ahead, -0.5, new Cesium.Cartesian3());
  // 後方 + 30m 上に camera
  const camPos = Cesium.Cartesian3.fromDegrees(
    p.lon - (course[nextIdx].lon - p.lon) * 5,
    p.lat - (course[nextIdx].lat - p.lat) * 5,
    p.elevation_m + 40,
  );
  viewer.camera.setView({
    destination: camPos,
    orientation: Cesium.Transforms.headingPitchRollQuaternion
      ? undefined  // fallback path
      : undefined,
  });
  viewer.camera.lookAt(cur, new Cesium.Cartesian3(0, 0, 30));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  // HUD
  document.getElementById('dist').textContent = curDist.toFixed(0);
  document.getElementById('ele').textContent = p.elevation_m.toFixed(0);
  document.getElementById('slope').textContent = p.slope_pct.toFixed(1);
  document.getElementById('speed').textContent = paused
    ? 'paused'
    : (wsConnected ? `${playSpeed.toFixed(1)} (bridge)` : `${playSpeed.toFixed(0)} (test)`);

  // bridge に現在地点の slope を送信 (= trainer 勾配コマンド)。1Hz に間引く。
  if (!paused) maybeSendSlope(p.slope_pct);

  if (curDist < totalDist) {
    requestAnimationFrame(tick);
  } else {
    status('完走');
  }
}

// controls
document.getElementById('btnPause').addEventListener('click', () => { paused = !paused; });
document.getElementById('btnSlow').addEventListener('click', () => { playSpeed = Math.max(5, playSpeed - 10); });
document.getElementById('btnFast').addEventListener('click', () => { playSpeed = Math.min(200, playSpeed + 10); });
document.getElementById('btnReset').addEventListener('click', () => { curDist = 0; curIdx = 0; });

loadCourse();
