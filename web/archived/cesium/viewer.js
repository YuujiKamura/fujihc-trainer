// fujihc viewer - Mt.Fuji ヒルクライム シミュレータ
// 起動フロー: pairing (= 起動画面で trainer 接続 + ハンドシェイク + ライド開始) → riding (= 地図画面で走行) → postride (= GPX 保存通知)
// Cesium / minimap は pairing 表示中もバックで初期化されてる。

const status = (msg) => { document.getElementById('status').textContent = msg; };

// Cesium Ion token は使わない。 terrain は地理院標高 (GSI dem_png) を直接 fetch、
// imagery は OSM を直接 fetch。 これで Pages 公開時に user の個人 quota / token 流出を回避。

const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: 'OpenStreetMap contributors',
      maximumLevel: 19,
    })
  ),
  baseLayerPicker: false, geocoder: false, homeButton: false,
  sceneModePicker: false, navigationHelpButton: false,
  timeline: false, animation: false, infoBox: false, selectionIndicator: false,
});
viewer.scene.globe.enableLighting = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.fog.enabled = false;
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.clock.currentTime = Cesium.JulianDate.fromIso8601('2026-06-01T03:00:00Z');
viewer.clock.shouldAnimate = false;

// === GSI 標高タイル → Cesium CustomHeightmapTerrainProvider 連携 ===
// 国土地理院の dem_png タイル (https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png)
// は PNG 各ピクセルが (R*65536+G*256+B)/100 メートル単位の標高。 R=128, G=0, B=0 は無効値。
// 出典: 国土地理院 (https://maps.gsi.go.jp/development/ichiran.html)
const GSI_DEM_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png';
const GSI_DEM_MAX_Z = 14;       // dem_png の最大 zoom
const GSI_TILE_PX = 256;        // GSI タイルは 256x256
const HEIGHTMAP_PX = 64;        // Cesium に渡す height grid の 1 辺 (64x64 で十分)

const gsiTileImgCache = new Map();
function loadGsiTileImage(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (gsiTileImgCache.has(key)) return gsiTileImgCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${GSI_DEM_BASE}/${z}/${x}/${y}.png`;
  });
  gsiTileImgCache.set(key, p);
  return p;
}

async function gsiHeightmapTile(x, y, level) {
  // GSI dem_png は z=14 までしか存在しない。 それ以上の zoom を要求された時は undefined を
  // 返して Cesium に「親タイルを使え」と任せる (= 階段状ガタつきを防ぐ)。
  if (level > GSI_DEM_MAX_Z) return undefined;
  const img = await loadGsiTileImage(level, x, y);
  if (!img) return new Float32Array(HEIGHTMAP_PX * HEIGHTMAP_PX);
  const canvas = document.createElement('canvas');
  canvas.width = HEIGHTMAP_PX; canvas.height = HEIGHTMAP_PX;
  const ctx = canvas.getContext('2d');
  // 256x256 → 64x64 に縮小、 補間を有効にして滑らかに
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, GSI_TILE_PX, GSI_TILE_PX, 0, 0, HEIGHTMAP_PX, HEIGHTMAP_PX);
  let imgData;
  try { imgData = ctx.getImageData(0, 0, HEIGHTMAP_PX, HEIGHTMAP_PX); }
  catch (e) { return new Float32Array(HEIGHTMAP_PX * HEIGHTMAP_PX); }
  const data = imgData.data;
  const heights = new Float32Array(HEIGHTMAP_PX * HEIGHTMAP_PX);
  for (let i = 0; i < HEIGHTMAP_PX * HEIGHTMAP_PX; i++) {
    const r = data[i*4], g = data[i*4+1], b = data[i*4+2];
    // 線形補間で生じた中間色も「無効値に近い」場合は 0 扱い (R が 127〜129 で G, B 共に 0 付近)
    if (r >= 127 && r <= 129 && g < 4 && b < 4) { heights[i] = 0; continue; }
    let h = r * 65536 + g * 256 + b;
    if (h >= 8388608) h -= 16777216;
    heights[i] = h / 100;
  }
  return heights;
}

try {
  viewer.terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
    width: HEIGHTMAP_PX, height: HEIGHTMAP_PX,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: (x, y, level) => gsiHeightmapTile(x, y, level),
    credit: '国土地理院 標高タイル (dem_png)',
  });
  status('terrain: GSI dem_png');
} catch (err) {
  console.warn('GSI terrain init failed, falling back to ellipsoid:', err);
  status(`terrain: 平面 (GSI 失敗: ${err.message || err})`);
}

let course = [];
let totalDist = 0;
let curDist = 0;
let curIdx = 0;
let playSpeed = 0;
let paused = true;
let lastT = performance.now();
let diffMult = (() => { try { return parseFloat(localStorage.getItem('fujihc.diff')) || 1.0; } catch { return 1.0; } })();
let speedMult = (() => { try { const v = parseFloat(localStorage.getItem('fujihc.spd')); return Number.isFinite(v) ? v : 1.0; } catch { return 1.0; } })();
let rideActive = false;
let lastPositionSendT = 0;
let rideStartedAt = null;     // performance.now() at ride_status:started、 elapsed 計算用
const POSITION_SEND_INTERVAL_MS = 1000;
// スキャンモード: 'ftms' (trainer 探し、 自動接続) / 'hrm' (心拍計探し、 手動選択)。 button で切替
let scanMode = 'ftms';
let riderEntity = null;
let minimapBase = null;
let minimapStats = null;

// === 状態管理 ===========================================
// "pairing" = 起動画面 (overlay 表示、 HUD/controls 非表示)
// "riding"  = 走行中 (overlay 非表示、 HUD/controls 表示)
// postride はモーダル overlay で別軸 (riding state を保ったまま postride overlay を上に被せる)
function setAppState(s) {
  document.body.className = `state-${s}`;
}
setAppState('pairing');

function updateStepIndicator(activeIdx, doneIdx) {
  // 0: scan, 1: connect, 2: handshake, 3: ready
  const steps = ['step-scan', 'step-connect', 'step-handshake', 'step-ready'];
  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i <= doneIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

// === WebSocket ===========================================
const WS_URL = 'ws://localhost:8765';
let ws = null;
let wsConnected = false;
let lastSlopeSent = null;
let lastSlopeSendT = 0;
const SLOPE_SEND_INTERVAL_MS = 1000;

const wsHandlers = {
  state(msg) {
    if (typeof msg.speed_mps === 'number') {
      const s = msg.speed_mps;
      if (Number.isFinite(s) && s >= 0 && s <= 25) playSpeed = s;
    }
    // ride 中の HUD と pairing 中の live values panel、 両方に同時反映
    const pw = (msg.power_w != null) ? String(msg.power_w) : '--';
    const cd = (msg.cadence_rpm != null) ? msg.cadence_rpm.toFixed(0) : '--';
    const sp = (msg.speed_mps != null && msg.speed_mps >= 0) ? (msg.speed_mps * 3.6).toFixed(1) : '--';
    setText('power', pw);  setText('cadence', cd);
    setText('p-power', pw); setText('p-cadence', cd); setText('p-speed', sp);
    if (msg.slope_sent_pct != null) setText('slope-sent', msg.slope_sent_pct.toFixed(1));
    if (msg.last_ack) {
      const ok = msg.last_ack.includes('OK');
      const icon = ok ? '✓' : '✗';
      const color = ok ? '#7fff00' : '#ff5050';
      const text = `${icon} ${msg.last_ack}`;
      const ackEl = document.getElementById('ack');
      const pAckEl = document.getElementById('p-ack');
      if (ackEl) { ackEl.textContent = text; ackEl.style.color = color; }
      if (pAckEl) { pAckEl.textContent = text; pAckEl.style.color = color; }
    }
    // 心拍 (別 BLE 経由)
    const hr = (msg.hr_bpm != null) ? String(msg.hr_bpm) : '--';
    setText('hr', hr); setText('p-hr', hr);
  },
  scan_status(msg) {
    const el = document.getElementById('setup-status');
    if (!el) return;
    if (msg.state === 'scanning') {
      el.textContent = 'BLE スキャン中... (7 秒)';
      updateStepIndicator(0, -1);
    } else if (msg.state === 'failed') {
      el.textContent = `スキャン失敗: ${msg.message || ''}`;
    } else if (msg.state === 'busy') {
      el.textContent = '前のスキャンがまだ動いてます、 少し待って';
    }
  },
  scan_result(msg) {
    const devices = msg.devices || [];
    if (scanMode === 'ftms') {
      // trainer 探しモード: FTMS を見つけたら即自動接続
      const ftms = devices.find(d => d.is_ftms);
      if (ftms && ws && ws.readyState === WebSocket.OPEN) {
        setText('setup-status', `${ftms.name || ftms.address} を検出、 接続中...`);
        setText('p-device', ftms.name || ftms.address);
        ws.send(JSON.stringify({ type: 'connect', address: ftms.address }));
        return;
      }
    }
    showSetupResults(devices);
  },
  hrm_status(msg) {
    if (msg.state === 'connecting') {
      setText('setup-status', `心拍計に接続中: ${msg.address}`);
    } else if (msg.state === 'connected') {
      setText('setup-status', `心拍計 接続済: ${msg.address}`);
    } else if (msg.state === 'failed') {
      setText('setup-status', `心拍計 接続失敗`);
    } else if (msg.state === 'disconnected') {
      setText('setup-status', `心拍計 切断`);
    }
  },
  connect_status(msg) {
    const err = document.getElementById('setup-error');
    if (err) err.textContent = '';
    if (msg.state === 'connecting') {
      setText('setup-status', `BLE 接続中: ${msg.address}`);
      setText('p-state', 'BLE 接続中');
      setText('p-device', msg.address);
      updateStepIndicator(1, 0);
    } else if (msg.state === 'handshaking') {
      setText('setup-status', `ハンドシェイク中: ${msg.address}`);
      setText('p-state', 'ハンドシェイク中');
      updateStepIndicator(2, 1);
    } else if (msg.state === 'connected') {
      setText('setup-status', `走行準備完了: ${msg.address}`);
      setText('p-state', '✓ 準備完了');
      updateStepIndicator(-1, 3);
      try { localStorage.setItem('fujihc.trainer.address', msg.address); } catch {}
      const startBtn = document.getElementById('btnRideStart');
      if (startBtn) {
        startBtn.disabled = false;
        // 有効化と同時に focus を hero ボタンに、 Enter で即走り出せる
        requestAnimationFrame(() => startBtn.focus());
      }
      lastSlopeSent = null;
      lastSlopeSendT = 0;
    } else if (msg.state === 'failed') {
      // failure メッセージは表示しない (user 指示)、 機器選び直し or Skip 待ち
    }
  },
  disconnected(msg) {
    status(`trainer 切断 (${msg.reason || ''})`);
  },
  ride_status(msg) {
    if (msg.state === 'started') {
      rideActive = true;
      rideStartedAt = performance.now();
      hidePairing();
      const endBtn = document.getElementById('btnRideEnd');
      if (endBtn) endBtn.disabled = false;
    } else if (msg.state === 'ended') {
      rideActive = false;
      paused = true;
      rideStartedAt = null;
      const endBtn = document.getElementById('btnRideEnd');
      if (endBtn) endBtn.disabled = true;
      showPostride(msg.gpx_path || '', msg.points || 0);
    } else if (msg.state === 'export-failed') {
      status(`GPX 書き出し失敗: ${msg.message || ''}`);
    }
  },
};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// === overlay 操作 ===========================================
function showPairing() {
  document.getElementById('setup-overlay').classList.add('visible');
  // ride 中の呼び出しでは body class を変えず、 HUD を残したまま overlay を上に被せる。
  // 起動直後 (state-pairing) は初期値のまま、 ride 中 (state-riding) でも overlay だけ visible に。
  // 「ライドに戻る」ボタンを ride 中だけ出す
  const back = document.getElementById('btnClosePairing');
  if (back) back.hidden = !(document.body.classList.contains('state-riding'));
}
function hidePairing() {
  document.getElementById('setup-overlay').classList.remove('visible');
  // 初回 pairing → ride 開始時のみ state-riding に切替、 ride 中の再呼び出しは既に state-riding
  setAppState('riding');
}
function showPostride(gpxPath, points) {
  const ov = document.getElementById('postride-overlay');
  setText('post-gpx-path', gpxPath);
  setText('post-points', String(points));
  setText('copy-status', '');
  ov.classList.add('visible');
  // 自動コピーは廃止、 user gesture (ボタン押下) で初めてコピー
  // hero focus 移送: 「再コピー」ボタンへ
  requestAnimationFrame(() => {
    const btn = document.getElementById('btnCopyPath');
    if (btn) btn.focus();
  });
}
function hidePostride() {
  document.getElementById('postride-overlay').classList.remove('visible');
}
function showConfirm() {
  document.getElementById('confirm-overlay').classList.add('visible');
  requestAnimationFrame(() => {
    const btn = document.getElementById('btnCancelDemo');
    if (btn) btn.focus();
  });
}
function hideConfirm() {
  document.getElementById('confirm-overlay').classList.remove('visible');
}

function showSetupResults(devices) {
  const list = document.getElementById('setup-list');
  if (!list) return;
  list.replaceChildren();
  // モードに応じて表示と動作を切替: ftms = trainer 接続、 hrm = 心拍計接続
  const isHrmMode = scanMode === 'hrm';
  const filtered = isHrmMode
    ? devices.filter(d => d.is_hrm)   // 心拍計モードでは HRM 機器のみ表示
    : devices;
  if (filtered.length === 0) {
    if (isHrmMode) {
      setText('setup-status', '心拍計が見つかりません。 ベルトの電源 + Bluetooth を確認して再スキャン');
    } else {
      setText('setup-status', '機器が見つかりません。 trainer の電源 + Bluetooth を確認して再スキャン');
    }
    return;
  }
  setText('setup-status', isHrmMode
    ? `${filtered.length} 個の心拍計候補 (クリックで接続)`
    : `${filtered.length} 個検出 (FTMS = trainer 候補)`);
  for (const d of filtered) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    if (d.is_ftms) li.classList.add('ftms');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'dev-name';
    nameSpan.textContent = d.name || '<no-name>';
    const metaSpan = document.createElement('span');
    metaSpan.className = 'dev-meta';
    const metaParts = [];
    if (d.is_ftms) metaParts.push('FTMS');
    if (d.is_hrm) metaParts.push('HR');
    if (d.rssi != null) metaParts.push(`rssi ${d.rssi}`);
    metaParts.push(d.address);
    metaSpan.textContent = metaParts.join(' · ');
    li.appendChild(nameSpan);
    li.appendChild(metaSpan);
    const pick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (isHrmMode) {
        ws.send(JSON.stringify({ type: 'hrm_connect', address: d.address }));
      } else {
        ws.send(JSON.stringify({ type: 'connect', address: d.address }));
      }
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    list.appendChild(li);
  }
}

function copyToClipboard(text, statusEl) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; }
    }).catch((err) => {
      if (statusEl) { statusEl.style.color = '#ff5050'; statusEl.textContent = `コピー失敗 (${err.message || err})`; }
    });
    return;
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; }
  } catch (err) {
    if (statusEl) { statusEl.style.color = '#ff5050'; statusEl.textContent = 'コピー失敗'; }
  }
}

function connectBridge() {
  try { ws = new WebSocket(WS_URL); }
  catch (err) { status(`bridge 接続失敗: ${err.message}`); return; }
  ws.addEventListener('open', () => {
    wsConnected = true;
    status('bridge 接続済');
    updateStepIndicator(0, -1);
    const remembered = (() => { try { return localStorage.getItem('fujihc.trainer.address'); } catch { return null; } })();
    if (remembered) {
      setText('setup-status', `前回の機器に再接続中: ${remembered}`);
      setText('p-device', remembered);
      ws.send(JSON.stringify({ type: 'connect', address: remembered }));
    } else {
      ws.send(JSON.stringify({ type: 'scan' }));
    }
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const handler = wsHandlers[msg.type];
    if (handler) handler(msg);
  });
  ws.addEventListener('close', () => {
    if (wsConnected) status('bridge 切断');
    wsConnected = false;
    paused = true;
  });
  ws.addEventListener('error', () => {});
}

function maybeSendSlope(slope_pct) {
  if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastSlopeSendT < SLOPE_SEND_INTERVAL_MS) return;
  const scaled = slope_pct * diffMult;
  if (lastSlopeSent !== null && Math.abs(scaled - lastSlopeSent) < 0.1) return;
  ws.send(JSON.stringify({ type: 'set_slope', slope_pct: scaled }));
  lastSlopeSent = scaled;
  lastSlopeSendT = now;
}

connectBridge();

// === コース読み込み + Cesium 描画 (起動時に走らせる、 overlay 表示中も裏で進む) ===
async function loadCourse() {
  try {
    const resp = await fetch('course.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    course = await resp.json();
  } catch (err) {
    status(`course.json load failed: ${err.message}`);
    return;
  }
  if (!course.length) { status('course.json empty'); return; }
  totalDist = course[course.length - 1].distance_m;
  setText('total', totalDist.toFixed(0));
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  const cart = course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  viewer.entities.add({
    polyline: { positions: cart, width: 8, material: Cesium.Color.RED,
                clampToGround: true, arcType: Cesium.ArcType.GEODESIC },
  });
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(course[0].lon, course[0].lat),
    point: { pixelSize: 16, color: Cesium.Color.LIME, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    label: { text: 'start', font: '14px monospace', pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
  });
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(course[course.length - 1].lon, course[course.length - 1].lat),
    point: { pixelSize: 16, color: Cesium.Color.RED, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
    label: { text: 'goal', font: '14px monospace', pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
  });

  const triangleSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
    '<polygon points="24,3 44,42 24,33 4,42" fill="cyan" stroke="black" stroke-width="3" stroke-linejoin="round"/>' +
    '</svg>'
  );
  riderEntity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(course[0].lon, course[0].lat),
    billboard: { image: triangleSvg, width: 40, height: 40,
                 heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                 disableDepthTestDistance: Number.POSITIVE_INFINITY,
                 verticalOrigin: Cesium.VerticalOrigin.BOTTOM },
    label: { text: 'me', font: 'bold 14px monospace',
             pixelOffset: new Cesium.Cartesian2(0, -45),
             fillColor: Cesium.Color.CYAN, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
             style: Cesium.LabelStyle.FILL_AND_OUTLINE,
             heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
             disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });

  buildMinimapBase();

  const bbox = boundingBox(course);
  viewer.camera.flyTo({
    destination: Cesium.Rectangle.fromDegrees(bbox.minLon - 0.01, bbox.minLat - 0.01, bbox.maxLon + 0.01, bbox.maxLat + 0.01),
    duration: 2.5,
    complete: () => { lastT = performance.now(); requestAnimationFrame(tick); },
  });
}

// (Web Mercator tile 変換、 minimap 描画、 tick ループは構造変更なし、 既存ロジックを継承)
function lonToTileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function latToTileY(lat, z) { return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z); }
function tileXToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function loadAndDrawOsmTile(ctx, tx, ty, z, projectLatLon, clipRect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const lonW = tileXToLon(tx, z), lonE = tileXToLon(tx + 1, z);
      const latN = tileYToLat(ty, z), latS = tileYToLat(ty + 1, z);
      const [x1, y1] = projectLatLon(latN, lonW);
      const [x2, y2] = projectLatLon(latS, lonE);
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
      ctx.clip();
      ctx.drawImage(img, x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
      resolve();
    };
    img.onerror = () => resolve();
    img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
  });
}

async function buildMinimapBase() {
  const onscreen = document.getElementById('minimap');
  if (!onscreen || course.length === 0) return;
  const W = onscreen.width, H = onscreen.height;
  const TOP_H = Math.floor(H * 0.78), BOT_H = H - TOP_H, PAD = 12;
  const eles = course.map(p => p.elevation_m);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const totalD = course[course.length - 1].distance_m;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of course) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const latMargin = (maxLat - minLat) * 0.20, lonMargin = (maxLon - minLon) * 0.20;
  minLat -= latMargin; maxLat += latMargin; minLon -= lonMargin; maxLon += lonMargin;
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos(midLat * Math.PI / 180);
  const dLat = maxLat - minLat, dLon = (maxLon - minLon) * lonScale;
  const topInnerW = W - 2 * PAD, topInnerH = TOP_H - 2 * PAD - 12;
  const scale = Math.min(topInnerW / dLon, topInnerH / dLat);
  const projW = dLon * scale, projH = dLat * scale;
  const offsetX = PAD + (topInnerW - projW) / 2;
  const offsetY = PAD + 12 + (topInnerH - projH) / 2;
  function projectLatLon(lat, lon) {
    const x = offsetX + (lon - minLon) * lonScale * scale;
    const y = offsetY + (maxLat - lat) * scale;
    return [x, y];
  }
  const botInnerW = W - 2 * PAD, botInnerH = BOT_H - 2 * PAD;
  const botBaseY = H - PAD, botTopY = TOP_H + PAD;
  minimapStats = { minE, maxE, totalD, TOP_H, BOT_H, PAD, projectLatLon, botInnerW, botInnerH, botBaseY, botTopY };

  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = 'rgba(15, 15, 20, 0.85)';
  ctx.fillRect(0, 0, W, H);

  const z = 14, buffer = 1;
  const minTx = Math.floor(lonToTileX(minLon, z)) - buffer;
  const maxTx = Math.floor(lonToTileX(maxLon, z)) + buffer;
  const minTy = Math.floor(latToTileY(maxLat, z)) - buffer;
  const maxTy = Math.floor(latToTileY(minLat, z)) + buffer;
  const clipRect = { x: PAD, y: PAD + 28, w: W - 2 * PAD, h: TOP_H - PAD - 28 };
  const tilePromises = [];
  for (let tx = minTx; tx <= maxTx; tx++)
    for (let ty = minTy; ty <= maxTy; ty++)
      tilePromises.push(loadAndDrawOsmTile(ctx, tx, ty, z, projectLatLon, clipRect));
  await Promise.all(tilePromises);

  ctx.fillStyle = '#ffd54a';
  ctx.font = 'bold 18px ui-monospace, monospace';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 3;
  const titleText = `Mt.Fuji ${(totalD / 1000).toFixed(1)} km / ${(maxE - minE).toFixed(0)} m up`;
  ctx.strokeText(titleText, 12, 22);
  ctx.fillText(titleText, 12, 22);

  ctx.beginPath();
  for (let i = 0; i < course.length; i++) {
    const [x, y] = projectLatLon(course[i].lat, course[i].lon);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 3; ctx.stroke();

  const [sx, sy] = projectLatLon(course[0].lat, course[0].lon);
  ctx.fillStyle = '#7fff00'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
  const [gx, gy] = projectLatLon(course[course.length - 1].lat, course[course.length - 1].lon);
  ctx.fillStyle = '#ff3030';
  ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, TOP_H); ctx.lineTo(W, TOP_H); ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(PAD, botBaseY);
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const x = PAD + (p.distance_m / totalD) * botInnerW;
    const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(PAD + botInnerW, botBaseY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, botTopY, 0, botBaseY);
  grad.addColorStop(0, 'rgba(255, 213, 74, 0.7)');
  grad.addColorStop(1, 'rgba(255, 213, 74, 0.15)');
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < course.length; i++) {
    const p = course[i];
    const x = PAD + (p.distance_m / totalD) * botInnerW;
    const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

  ctx.fillStyle = '#aaa'; ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(`${maxE.toFixed(0)}m`, 4, botTopY + 14);
  ctx.fillText(`${minE.toFixed(0)}m`, 4, botBaseY - 4);
  minimapBase = off;
}

function drawDirTriangle(ctx, x, y, headingRad, size, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(headingRad);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.75, size * 0.7);
  ctx.lineTo(0, size * 0.3);
  ctx.lineTo(-size * 0.75, size * 0.7);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

function updateMinimap(curDistM, curEleM, curLat, curLon, travelHeading) {
  const onscreen = document.getElementById('minimap');
  if (!onscreen || !minimapBase || !minimapStats) return;
  const ctx = onscreen.getContext('2d');
  ctx.clearRect(0, 0, onscreen.width, onscreen.height);
  ctx.drawImage(minimapBase, 0, 0);
  const { minE, maxE, totalD, projectLatLon, PAD, botInnerW, botInnerH, botBaseY, botTopY } = minimapStats;
  const [tx, ty] = projectLatLon(curLat, curLon);
  drawDirTriangle(ctx, tx, ty, travelHeading, 11, 'cyan');
  const px = PAD + (curDistM / totalD) * botInnerW;
  const py = botBaseY - ((curEleM - minE) / (maxE - minE)) * botInnerH;
  ctx.strokeStyle = 'rgba(0, 220, 220, 0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, botTopY); ctx.lineTo(px, botBaseY); ctx.stroke();
  ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
}

function boundingBox(c) {
  let minLat=Infinity, maxLat=-Infinity, minLon=Infinity, maxLon=-Infinity;
  for (const p of c) {
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function tick(t) {
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (!paused && curDist < totalDist) {
    curDist = Math.min(curDist + playSpeed * speedMult * dt, totalDist);
  }
  while (curIdx < course.length - 1 && course[curIdx + 1].distance_m < curDist) curIdx++;
  const p = course[curIdx];
  const pNext = course[Math.min(curIdx + 1, course.length - 1)];
  const segLen = pNext.distance_m - p.distance_m;
  const frac = segLen > 0 ? Math.min(1, Math.max(0, (curDist - p.distance_m) / segLen)) : 0;
  const rLon = p.lon + (pNext.lon - p.lon) * frac;
  const rLat = p.lat + (pNext.lat - p.lat) * frac;
  const rEle = p.elevation_m + (pNext.elevation_m - p.elevation_m) * frac;

  if (riderEntity) riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat);

  const nextIdx = Math.min(curIdx + 5, course.length - 1);
  const dLonDeg = course[nextIdx].lon - rLon;
  const dLatDeg = course[nextIdx].lat - rLat;
  const latRad = rLat * Math.PI / 180;
  const dLonMeter = dLonDeg * Math.cos(latRad);
  const travelHeading = Math.atan2(dLonMeter, dLatDeg);
  const carto = Cesium.Cartographic.fromDegrees(rLon, rLat);
  const terrainH = viewer.scene.globe.getHeight(carto);
  const groundEle = terrainH !== undefined && terrainH !== null ? terrainH : (rEle + 35);
  const targetEle = groundEle + 2;
  const cameraEle = groundEle + 6;
  const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, targetEle);
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(rLon, rLat, cameraEle));
  const sinH = Math.sin(travelHeading), cosH = Math.cos(travelHeading);
  const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 15, -cosH * 15, 0);
  const cameraPos = Cesium.Matrix4.multiplyByPoint(enuTransform, cameraOffsetEnu, new Cesium.Cartesian3());
  const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(target, cameraPos, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const up = Cesium.Cartesian3.normalize(cameraPos, new Cesium.Cartesian3());
  viewer.camera.setView({ destination: cameraPos, orientation: { direction, up } });

  // 経過時間 (ライド開始からの elapsed)
  if (rideStartedAt !== null) {
    const sec = Math.floor((performance.now() - rideStartedAt) / 1000);
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    setText('elapsed', `${hh}:${mm}:${ss}`);
  } else {
    setText('elapsed', '00:00:00');
  }
  setText('dist', curDist.toFixed(0));
  setText('ele', rEle.toFixed(0));
  setText('slope', p.slope_pct.toFixed(1));
  updateMinimap(curDist, rEle, rLat, rLon, travelHeading);
  const dispKmh = playSpeed * speedMult * 3.6;
  setText('speed', paused
    ? (wsConnected ? '待機中' : 'paused')
    : `${dispKmh.toFixed(1)} km/h${wsConnected ? ' (bridge)' : ' (demo)'}${speedMult !== 1.0 ? ` x${speedMult.toFixed(2)}` : ''}`);

  if (!paused) maybeSendSlope(p.slope_pct);

  if (rideActive && !paused && wsConnected && ws && ws.readyState === WebSocket.OPEN) {
    const now = performance.now();
    if (now - lastPositionSendT >= POSITION_SEND_INTERVAL_MS) {
      ws.send(JSON.stringify({ type: 'position', distance_m: curDist, lat: rLat, lon: rLon, elevation_m: rEle }));
      lastPositionSendT = now;
    }
  }

  if (curDist < totalDist) requestAnimationFrame(tick);
  else status('完走');
}

// === ボタン bind ===========================================
document.getElementById('btnPause').addEventListener('click', () => { paused = !paused; });

document.getElementById('btnRideStart').addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  curDist = 0; curIdx = 0; paused = false; lastT = performance.now();
  lastPositionSendT = 0;
  ws.send(JSON.stringify({ type: 'ride_start' }));
});

document.getElementById('btnRideEnd').addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  paused = true;
  ws.send(JSON.stringify({ type: 'ride_end' }));
});

document.getElementById('btnScan').addEventListener('click', () => {
  scanMode = 'ftms';
  setText('scan-mode-label', '(trainer モード: FTMS を自動接続)');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'scan' }));
});
document.getElementById('btnScanHrm').addEventListener('click', () => {
  scanMode = 'hrm';
  setText('scan-mode-label', '(心拍計モード: HR 機器のみ表示、 クリックで接続)');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'scan' }));
});

document.getElementById('btnSkip').addEventListener('click', () => {
  showConfirm();
});

document.getElementById('btnConfirmDemo').addEventListener('click', () => {
  hideConfirm();
  hidePairing();
  playSpeed = 20 / 3.6;
  curDist = 0; curIdx = 0; paused = false; lastT = performance.now();
  status('デモモード (trainer 接続なし、 固定 20 km/h、 記録は保存されません)');
});

document.getElementById('btnCancelDemo').addEventListener('click', () => {
  hideConfirm();
});

document.getElementById('btnCopyPath').addEventListener('click', () => {
  const path = document.getElementById('post-gpx-path').textContent;
  const statusEl = document.getElementById('copy-status');
  copyToClipboard(path, statusEl);
});

document.getElementById('btnBackToPairing').addEventListener('click', () => {
  hidePostride();
  setAppState('pairing');         // postride → pairing は完全戻り、 HUD は再び隠す
  showPairing();
  curDist = 0; curIdx = 0;
  updateStepIndicator(-1, 3);
  const startBtn = document.getElementById('btnRideStart');
  if (startBtn && !startBtn.disabled) requestAnimationFrame(() => startBtn.focus());
});

document.getElementById('btnOpenPairing').addEventListener('click', () => {
  // ride 中に機器設定 overlay を呼ぶ、 走行は継続 (paused は変えない)
  showPairing();
});

document.getElementById('btnClosePairing').addEventListener('click', () => {
  // ride 中に開いた pairing を閉じる、 走行に戻る
  document.getElementById('setup-overlay').classList.remove('visible');
});

// slider bind (既存ロジック)
function bindSlider(rangeId, valId, store, applyFn) {
  const r = document.getElementById(rangeId);
  const v = document.getElementById(valId);
  if (!r || !v) return;
  applyFn(parseFloat(r.value));
  r.addEventListener('input', () => {
    const pct = parseFloat(r.value);
    applyFn(pct);
    try { localStorage.setItem(store, String(pct / 100)); } catch {}
  });
}
const rDiff = document.getElementById('rngDiff');
const rSpd = document.getElementById('rngSpd');
if (rDiff) rDiff.value = String(Math.round(diffMult * 100));
if (rSpd) rSpd.value = String(Math.round(speedMult * 100));
bindSlider('rngDiff', 'diffVal', 'fujihc.diff', (pct) => {
  diffMult = pct / 100;
  setText('diffVal', String(Math.round(pct)));
  lastSlopeSent = null;
});
bindSlider('rngSpd', 'spdVal', 'fujihc.spd', (pct) => {
  speedMult = pct / 100;
  setText('spdVal', (pct / 100).toFixed(2));
});

loadCourse();
