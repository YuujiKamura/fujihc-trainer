// fujihc viewer - MapLibre GL JS 試験版
// Cesium を廃止、 GSI 標高 + OSM raster で 3D 地形表示。
// addProtocol で GSI dem_png を terrarium 形式に変換して MapLibre の terrain に食わせる。

const status = (msg) => { document.getElementById('status').textContent = msg; };

// === タイル取得は全て同一 origin (bridge.py が proxy する /tiles/...) 経由 ===
// brief 17b: 外部第三者 endpoint への runtime fetch を物理的にゼロにする。
// web/tests/viewer_url_audit.test.js が source-grep gate で固定する。
// 違反した瞬間に CI が落ちる。
const TILE_BASE_URL = `${location.origin}/tiles`;

// === GSI 標高 PNG を terrarium 形式 PNG に変換するカスタムプロトコル ===
// GSI: h = (R*65536 + G*256 + B) / 100、 R=128 で無効値
// terrarium: h = (R*256 + G + B/256) - 32768
maplibregl.addProtocol('gsidem', (params) => {
  const url = params.url.replace(/^gsidem:\/\//, '');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = img.width, H = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let src;
      try { src = ctx.getImageData(0, 0, W, H); }
      catch (e) { reject(e); return; }
      const dst = ctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const r = src.data[i*4], g = src.data[i*4+1], b = src.data[i*4+2];
        let height_m = 0;
        if (!(r === 128 && g === 0 && b === 0)) {
          let h = r * 65536 + g * 256 + b;
          if (h >= 8388608) h -= 16777216;
          height_m = h / 100;
        }
        // terrarium 形式に変換: (R, G, B) = encode(height + 32768)
        const enc = Math.max(0, Math.min(65535 * 256 + 255, Math.round((height_m + 32768) * 256)));
        const tr = Math.floor(enc / 65536);
        const tg = Math.floor((enc % 65536) / 256);
        const tb = enc % 256;
        dst.data[i*4]   = tr;
        dst.data[i*4+1] = tg;
        dst.data[i*4+2] = tb;
        dst.data[i*4+3] = 255;
      }
      ctx.putImageData(dst, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        blob.arrayBuffer().then((buf) => {
          resolve({ data: new Uint8Array(buf) });
        }).catch(reject);
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('GSI tile load failed: ' + url));
    img.src = url;
  });
});

// === Map 初期化 ===
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'osm': {
        type: 'raster',
        tiles: [`${TILE_BASE_URL}/osm/{z}/{x}/{y}.png`],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
        // MapLibre 内部 memory cache を拡張、 zoom 切替時の再 fetch を減らす (default は数十枚)
        volatile: false,
      },
      'gsi-terrain': {
        type: 'raster-dem',
        // addProtocol('gsidem', ...) が GSI 独自符号 (R*65536+G*256+B)/100 を
        // terrarium 形式に変換する。 fetch URL は localhost 経由のみ。
        tiles: [`gsidem://${TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
        tileSize: 256,
        encoding: 'terrarium',
        maxzoom: 14,
        attribution: '国土地理院 標高タイル',
        volatile: false,
      },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
    ],
    sky: { 'sky-color': '#87ceeb', 'horizon-color': '#ffd6a5', 'fog-color': '#cccccc' },
  },
  center: [138.7587, 35.4521],
  zoom: 13,
  pitch: 60,
  bearing: 0,
  // pitch を default 60 → 85 まで拡張、 zoom 上限も MapLibre の最大 22 まで開放
  maxPitch: 85,
  minPitch: 0,
  maxZoom: 24,
  minZoom: 13,
  // タイル memory cache (default 数十、 500 は GPU 負荷高、 200 程度が妥当)
  maxTileCacheSize: 200,
  // タイルのクロスフェード短縮、 GPU 負荷軽減
  fadeDuration: 0,
});

map.on('load', () => {
  map.setTerrain({ source: 'gsi-terrain', exaggeration: 1.0 });
  status('map loaded');
  // 操作系: マウスホイールで zoom (default 維持)、 縦ドラッグで pitch だけ変更、
  // 横ドラッグ (bearing 回転) は AI が進行方向に自動セットするので無効化
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.dragPan.disable();
  // MapLibre 標準の scrollZoom は「マウスポインタ位置を中心に zoom」する。 これだと
  // tick で rider に center を戻すまでに毎フレーム rider がズレて見える。
  // scrollZoom を切って、 自前で「wheel → userZoom を増減 → map.setZoom (現 center 維持)」に。
  map.scrollZoom.disable();
  setupWheelZoom();
  setupPitchDrag();
  loadCourse();
});

map.on('error', (e) => {
  console.warn('maplibre error:', e && e.error);
});

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
let rideStartedAt = null;
const POSITION_SEND_INTERVAL_MS = 1000;
let scanMode = 'ftms';

let riderMarker = null;
let minimapBase = null;
let minimapStats = null;
// user が操作した zoom / pitch を覚えておく、 tick の jumpTo はこの値を使う
let userZoom = 16;
let userPitch = 55;
// rider 上のスピナー (= プロペラ) の累積回転角、 cadence rpm に比例して進む
let spinAngle = 0;
// 最新の cadence (state push 経由)、 ride 中ペダル回ってない時は 0 で静止
let currentCadence = 0;

function setupWheelZoom() {
  const mapEl = map.getContainer();
  mapEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    // wheel 1 回 = zoom ±0.5 (= 元の感度 5 倍相当)、 center は触らない (次フレームで rider に戻る)
    const delta = -Math.sign(e.deltaY) * 0.5;
    userZoom = Math.max(13, Math.min(24, userZoom + delta));
    map.setZoom(userZoom);
  }, { passive: false });
}

function setupPitchDrag() {
  const mapEl = map.getContainer();
  let drag = null;
  mapEl.addEventListener('mousedown', (e) => {
    drag = { y: e.clientY, pitch: map.getPitch() };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    // マウスを下にドラッグで水平に近づける、 上にドラッグで真上へ。 感度は user 指示で 5 倍
    const newPitch = Math.max(0, Math.min(85, drag.pitch - dy * 2.0));
    userPitch = newPitch;
    map.setPitch(newPitch);
  });
  window.addEventListener('mouseup', () => { drag = null; });
  // 右クリックメニュー抑止
  mapEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setAppState(s) { document.body.className = `state-${s}`; }
setAppState('pairing');

function updateStepIndicator(activeIdx, doneIdx) {
  const steps = ['step-scan', 'step-connect', 'step-handshake', 'step-ready'];
  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i <= doneIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// === WebSocket === (既存 viewer.js と同じ contract)
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
    const pw = (msg.power_w != null) ? String(msg.power_w) : '--';
    const cd = (msg.cadence_rpm != null) ? msg.cadence_rpm.toFixed(0) : '--';
    if (typeof msg.cadence_rpm === 'number') currentCadence = msg.cadence_rpm;
    const sp = (msg.speed_mps != null && msg.speed_mps >= 0) ? (msg.speed_mps * 3.6).toFixed(1) : '--';
    setText('power', pw); setText('cadence', cd);
    setText('p-power', pw); setText('p-cadence', cd); setText('p-speed', sp);
    if (msg.slope_sent_pct != null) setText('slope-sent', msg.slope_sent_pct.toFixed(1));
    if (msg.last_ack) {
      const ok = msg.last_ack.includes('OK');
      const text = `${ok ? '✓' : '✗'} ${msg.last_ack}`;
      const color = ok ? '#7fff00' : '#ff5050';
      const ackEl = document.getElementById('ack'); if (ackEl) { ackEl.textContent = text; ackEl.style.color = color; }
      const pAck = document.getElementById('p-ack'); if (pAck) { pAck.textContent = text; pAck.style.color = color; }
    }
    const hr = (msg.hr_bpm != null) ? String(msg.hr_bpm) : '--';
    setText('hr', hr); setText('p-hr', hr);
  },
  scan_status(msg) {
    if (msg.state === 'scanning') { setText('setup-status', 'BLE スキャン中... (7 秒)'); updateStepIndicator(0, -1); }
    else if (msg.state === 'failed') setText('setup-status', `スキャン失敗: ${msg.message || ''}`);
    else if (msg.state === 'busy') setText('setup-status', '前のスキャンがまだ動いてます');
  },
  scan_result(msg) {
    const devices = msg.devices || [];
    if (scanMode === 'ftms') {
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
  connect_status(msg) {
    const err = document.getElementById('setup-error'); if (err) err.textContent = '';
    if (msg.state === 'connecting') { setText('setup-status', `BLE 接続中: ${msg.address}`); setText('p-state', 'BLE 接続中'); setText('p-device', msg.address); updateStepIndicator(1, 0); }
    else if (msg.state === 'handshaking') { setText('setup-status', `ハンドシェイク中: ${msg.address}`); setText('p-state', 'ハンドシェイク中'); updateStepIndicator(2, 1); }
    else if (msg.state === 'connected') {
      setText('setup-status', `走行準備完了: ${msg.address}`);
      setText('p-state', '✓ 準備完了');
      updateStepIndicator(-1, 3);
      try { localStorage.setItem('fujihc.trainer.address', msg.address); } catch {}
      const startBtn = document.getElementById('btnRideStart');
      if (startBtn) { startBtn.disabled = false; requestAnimationFrame(() => startBtn.focus()); }
      lastSlopeSent = null; lastSlopeSendT = 0;
    }
  },
  disconnected(msg) { status(`trainer 切断 (${msg.reason || ''})`); },
  hrm_status(msg) {
    if (msg.state === 'connecting') setText('setup-status', `心拍計に接続中: ${msg.address}`);
    else if (msg.state === 'connected') setText('setup-status', `心拍計 接続済: ${msg.address}`);
    else if (msg.state === 'failed') setText('setup-status', `心拍計 接続失敗`);
    else if (msg.state === 'disconnected') setText('setup-status', `心拍計 切断`);
  },
  ride_status(msg) {
    if (msg.state === 'started') {
      rideActive = true; rideStartedAt = performance.now();
      hidePairing();
      const endBtn = document.getElementById('btnRideEnd'); if (endBtn) endBtn.disabled = false;
    } else if (msg.state === 'ended') {
      rideActive = false; paused = true; rideStartedAt = null;
      const endBtn = document.getElementById('btnRideEnd'); if (endBtn) endBtn.disabled = true;
      showPostride(msg.gpx_path || '', msg.points || 0);
    } else if (msg.state === 'export-failed') { status(`GPX 書き出し失敗: ${msg.message || ''}`); }
  },
};

function showPairing() {
  document.getElementById('setup-overlay').classList.add('visible');
  const back = document.getElementById('btnClosePairing');
  if (back) back.hidden = !(document.body.classList.contains('state-riding'));
}
function hidePairing() {
  document.getElementById('setup-overlay').classList.remove('visible');
  setAppState('riding');
}
function showPostride(gpxPath, points) {
  const ov = document.getElementById('postride-overlay');
  setText('post-gpx-path', gpxPath); setText('post-points', String(points)); setText('copy-status', '');
  ov.classList.add('visible');
  requestAnimationFrame(() => { const b = document.getElementById('btnCopyPath'); if (b) b.focus(); });
}
function hidePostride() { document.getElementById('postride-overlay').classList.remove('visible'); }
function showConfirm() { document.getElementById('confirm-overlay').classList.add('visible'); }
function hideConfirm() { document.getElementById('confirm-overlay').classList.remove('visible'); }

function showSetupResults(devices) {
  const list = document.getElementById('setup-list'); if (!list) return;
  list.replaceChildren();
  const isHrmMode = scanMode === 'hrm';
  const filtered = isHrmMode ? devices.filter(d => d.is_hrm) : devices;
  if (filtered.length === 0) { setText('setup-status', isHrmMode ? '心拍計が見つかりません' : '機器が見つかりません'); return; }
  setText('setup-status', isHrmMode ? `${filtered.length} 個の心拍計候補` : `${filtered.length} 個検出`);
  for (const d of filtered) {
    const li = document.createElement('li');
    li.tabIndex = 0; li.setAttribute('role', 'option');
    if (d.is_ftms) li.classList.add('ftms');
    const n = document.createElement('span'); n.className = 'dev-name'; n.textContent = d.name || '<no-name>';
    const m = document.createElement('span'); m.className = 'dev-meta';
    const parts = []; if (d.is_ftms) parts.push('FTMS'); if (d.is_hrm) parts.push('HR'); if (d.rssi != null) parts.push(`rssi ${d.rssi}`); parts.push(d.address);
    m.textContent = parts.join(' · ');
    li.appendChild(n); li.appendChild(m);
    const pick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: isHrmMode ? 'hrm_connect' : 'connect', address: d.address }));
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    list.appendChild(li);
  }
}

function copyToClipboard(text, statusEl) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => { if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; } })
    .catch((err) => { if (statusEl) { statusEl.style.color = '#ff5050'; statusEl.textContent = `失敗 (${err.message || err})`; } });
    return;
  }
  try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); if (statusEl) { statusEl.style.color = '#7fff00'; statusEl.textContent = '✓ コピー済'; } }
  catch { if (statusEl) statusEl.textContent = '失敗'; }
}

function connectBridge() {
  try { ws = new WebSocket(WS_URL); }
  catch (err) { status(`bridge 接続失敗: ${err.message}`); return; }
  ws.addEventListener('open', () => {
    wsConnected = true; status('bridge 接続済'); updateStepIndicator(0, -1);
    const remembered = (() => { try { return localStorage.getItem('fujihc.trainer.address'); } catch { return null; } })();
    if (remembered) { setText('setup-status', `前回の機器に再接続中: ${remembered}`); setText('p-device', remembered); ws.send(JSON.stringify({ type: 'connect', address: remembered })); }
    else ws.send(JSON.stringify({ type: 'scan' }));
  });
  ws.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } const h = wsHandlers[m.type]; if (h) h(m); });
  ws.addEventListener('close', () => { if (wsConnected) status('bridge 切断'); wsConnected = false; paused = true; });
}

function maybeSendSlope(slope_pct) {
  if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastSlopeSendT < SLOPE_SEND_INTERVAL_MS) return;
  const scaled = slope_pct * diffMult;
  if (lastSlopeSent !== null && Math.abs(scaled - lastSlopeSent) < 0.1) return;
  ws.send(JSON.stringify({ type: 'set_slope', slope_pct: scaled }));
  lastSlopeSent = scaled; lastSlopeSendT = now;
}

connectBridge();

// === コース読み込み ===
async function loadCourse() {
  try {
    const resp = await fetch('course.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    course = await resp.json();
  } catch (err) { status(`course.json load failed: ${err.message}`); return; }
  if (!course.length) { status('course.json empty'); return; }
  totalDist = course[course.length - 1].distance_m;
  setText('total', totalDist.toFixed(0));
  status(`course loaded: ${course.length} pts, ${(totalDist/1000).toFixed(1)} km`);

  // route line as GeoJSON LineString
  const coords = course.map(p => [p.lon, p.lat]);
  if (!map.getSource('route')) {
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#ff3030', 'line-width': 5 } });
  }
  // start / goal markers
  new maplibregl.Marker({ color: '#7fff00' }).setLngLat([course[0].lon, course[0].lat]).addTo(map);
  new maplibregl.Marker({ color: '#ff3030' }).setLngLat([course[course.length - 1].lon, course[course.length - 1].lat]).addTo(map);

  // rider マーカー: fill-extrusion で本物の 3D 立体 (豆腐型)、 高さ方向に押し出した polygon。
  // rider 位置 + 進行方向で毎フレーム polygon coordinates を更新する。
  map.addSource('rider', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // 豆腐: 0.5m 角の直方体 1 個、 cyan
  map.addLayer({
    id: 'rider-body',
    type: 'fill-extrusion',
    source: 'rider',
    paint: {
      'fill-extrusion-color': '#00ffff',
      'fill-extrusion-height': 0.5,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.95,
    },
  });

  buildMinimapBase();

  // brief 17b: prefetch を完全削除。 タイルは MapLibre が on-demand で
  // localhost /tiles/... から fetch する。 外部 fetch ゼロ。

  // 初期 camera: start 地点に寄せる、 起動直後から走行視点っぽい絵にする
  // (全体俯瞰だと goal 側ばかり映って rider が画面外になる、 user 不満を生む)
  const nextIdx0 = Math.min(20, course.length - 1);
  const dLon0 = course[nextIdx0].lon - course[0].lon;
  const dLat0 = course[nextIdx0].lat - course[0].lat;
  const heading0 = Math.atan2(dLon0 * Math.cos(course[0].lat * Math.PI / 180), dLat0);
  // user 動作確認で確定した default (画面 HUD 由来、 現地の道路幅感覚に合う値)
  userZoom = 23.95;    // 道路 1 車線が画面の中央に収まる、 ほぼ等倍走行視点
  userPitch = 85;      // ほぼ水平、 カーナビ的前方視野
  // user が縦ドラッグ / ホイールで再調整可、 その値が以後 default になる挙動
  map.jumpTo({
    center: [course[0].lon, course[0].lat],
    zoom: userZoom,
    pitch: userPitch,
    bearing: heading0 * 180 / Math.PI,
  });
  lastT = performance.now();
  requestAnimationFrame(tick);
}

// === minimap (course polyline + 標高プロファイル) ===
// brief 17b: タイル座標変換ヘルパ (lonToTileX 等) は loadOsmTile / prefetchTilesAlongCourse
// が消えた時点で参照ゼロになったため削除。 必要になったら web/lib/tile_math.js を使う。

// brief 17b: loadOsmTile は完全削除。 minimap は外部 OSM 直叩きを止め、
// 単色背景 + course polyline + 標高曲線で全体俯瞰の責務を果たす。
// (外部 fetch ゼロを優先、 minimap 改善 ── ローカルタイル経由化 ── は別 brief)

async function buildMinimapBase() {
  const onscreen = document.getElementById('minimap');
  if (!onscreen || course.length === 0) return;
  const W = onscreen.width, H = onscreen.height;
  const TOP_H = Math.floor(H * 0.78), BOT_H = H - TOP_H, PAD = 12;
  const eles = course.map(p => p.elevation_m);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const totalD = course[course.length - 1].distance_m;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of course) { if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon; }
  const latM = (maxLat - minLat) * 0.20, lonM = (maxLon - minLon) * 0.20;
  minLat -= latM; maxLat += latM; minLon -= lonM; maxLon += lonM;
  const midLat = (minLat + maxLat) / 2, lonScale = Math.cos(midLat * Math.PI / 180);
  const dLat = maxLat - minLat, dLon = (maxLon - minLon) * lonScale;
  const topInnerW = W - 2 * PAD, topInnerH = TOP_H - 2 * PAD - 12;
  const scale = Math.min(topInnerW / dLon, topInnerH / dLat);
  const projW = dLon * scale, projH = dLat * scale;
  const offsetX = PAD + (topInnerW - projW) / 2, offsetY = PAD + 12 + (topInnerH - projH) / 2;
  // 普通の projection (北上向き)、 180 度回転は最後に canvas 全体に rotate を掛けて実現する
  function project(lat, lon) {
    const x = offsetX + (lon - minLon) * lonScale * scale;
    const y = offsetY + (maxLat - lat) * scale;
    return [x, y];
  }
  const botInnerW = W - 2 * PAD, botInnerH = BOT_H - 2 * PAD, botBaseY = H - PAD, botTopY = TOP_H + PAD;
  minimapStats = { minE, maxE, totalD, projectLatLon: project, PAD, botInnerW, botInnerH, botBaseY, botTopY };

  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const ctx = off.getContext('2d');
  ctx.fillStyle = 'rgba(15,15,20,0.85)'; ctx.fillRect(0, 0, W, H);

  // brief 17b: 外部 OSM 直叩きを止め、 上半分 (平面マップ部分) は単色背景 (#e8e8e8) で塗る。
  // course polyline + 標高曲線で全体俯瞰の責務は果たせる。 minimap タイル経由化は別 brief。
  const clip = { x: PAD, y: PAD + 28, w: W - 2 * PAD, h: TOP_H - PAD - 28 };
  ctx.save();
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(clip.x, clip.y, clip.w, clip.h);
  ctx.restore();

  // タイトル文字 (Mt.Fuji ...) は廃止: 180 度回転で逆さまになる、 user 判断「無くて良い」
  ctx.beginPath();
  for (let i = 0; i < course.length; i++) { const [x, y] = project(course[i].lat, course[i].lon); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 3; ctx.stroke();
  const [sx, sy] = project(course[0].lat, course[0].lon);
  ctx.fillStyle = '#7fff00'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
  const [gx, gy] = project(course[course.length-1].lat, course[course.length-1].lon);
  ctx.fillStyle = '#ff3030';
  ctx.beginPath(); ctx.arc(gx, gy, 7, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, TOP_H); ctx.lineTo(W, TOP_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(PAD, botBaseY);
  for (let i = 0; i < course.length; i++) { const p = course[i]; const x = PAD + (p.distance_m / totalD) * botInnerW; const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH; ctx.lineTo(x, y); }
  ctx.lineTo(PAD + botInnerW, botBaseY); ctx.closePath();
  const grad = ctx.createLinearGradient(0, botTopY, 0, botBaseY);
  grad.addColorStop(0, 'rgba(255,213,74,0.7)'); grad.addColorStop(1, 'rgba(255,213,74,0.15)');
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < course.length; i++) { const p = course[i]; const x = PAD + (p.distance_m / totalD) * botInnerW; const y = botBaseY - ((p.elevation_m - minE) / (maxE - minE)) * botInnerH; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#aaa'; ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(`${maxE.toFixed(0)}m`, 4, botTopY + 14); ctx.fillText(`${minE.toFixed(0)}m`, 4, botBaseY - 4);

  // 上半分 (平面マップ部分) だけ 180 度回転、 下半分 (標高プロファイル) はそのまま
  const topCopy = document.createElement('canvas'); topCopy.width = W; topCopy.height = TOP_H;
  topCopy.getContext('2d').drawImage(off, 0, 0, W, TOP_H, 0, 0, W, TOP_H);
  ctx.save();
  ctx.clearRect(0, 0, W, TOP_H);
  ctx.translate(W / 2, TOP_H / 2);
  ctx.rotate(Math.PI);
  ctx.translate(-W / 2, -TOP_H / 2);
  ctx.drawImage(topCopy, 0, 0);
  ctx.restore();
  // 反転後の minimapStats に「上半分の rotate 中心と W/TOP_H」を持たせて updateMinimap で使う
  minimapStats.rotateTop = { W, TOP_H };
  minimapBase = off;
}

// brief 17b: prefetchTilesAlongCourse は完全削除。 関連する seenOsm / seenDem 等の
// 変数も使用箇所が無いため定義しない。 タイルは MapLibre の on-demand fetch (= localhost
// /tiles/... 経由) で読み込み、 外部第三者 endpoint には一切 fetch しない。

function drawDirTriangle(ctx, x, y, h, size, fill) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(h);
  ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size*0.75, size*0.7); ctx.lineTo(0, size*0.3); ctx.lineTo(-size*0.75, size*0.7); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.restore();
}

// rider の 3D 豆腐 = 0.5m 角の正方形、 heading に合わせて 4 辺が進行方向の前後左右を向く。
function buildRiderFeatures(lat, lon, heading, spin) {
  const M_LAT = 1 / 111320;
  const M_LON = 1 / (111320 * Math.cos(lat * Math.PI / 180));
  const half = 0.25;
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const sinH = Math.sin(heading), cosH = Math.cos(heading);
  const verts = corners.map(([x, y]) => {
    const rx = x * cosH + y * sinH;
    const ry = -x * sinH + y * cosH;
    return [lon + rx * M_LON, lat + ry * M_LAT];
  });
  verts.push(verts[0]);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [verts] } }],
  };
}

function updateMinimap(curDistM, curEleM, curLat, curLon, heading) {
  const onscreen = document.getElementById('minimap');
  if (!onscreen || !minimapBase || !minimapStats) return;
  const ctx = onscreen.getContext('2d');
  ctx.clearRect(0, 0, onscreen.width, onscreen.height); ctx.drawImage(minimapBase, 0, 0);
  const { minE, maxE, totalD, projectLatLon, PAD, botInnerW, botInnerH, botBaseY, botTopY } = minimapStats;
  const [tx, ty] = projectLatLon(curLat, curLon);
  // base 上半分を 180 度回転して貼ってるので、 三角形マーカーの座標も同じ回転を適用
  const rot = minimapStats.rotateTop;
  if (rot) {
    const rx = rot.W - tx;
    const ry = rot.TOP_H - ty;
    drawDirTriangle(ctx, rx, ry, heading + Math.PI, 11, 'cyan');
  } else {
    drawDirTriangle(ctx, tx, ty, heading, 11, 'cyan');
  }
  const px = PAD + (curDistM / totalD) * botInnerW;
  const py = botBaseY - ((curEleM - minE) / (maxE - minE)) * botInnerH;
  ctx.strokeStyle = 'rgba(0,220,220,0.5)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px, botTopY); ctx.lineTo(px, botBaseY); ctx.stroke();
  ctx.fillStyle = 'cyan'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(px, py, 8, 0, 2*Math.PI); ctx.fill(); ctx.stroke();
}

function tick(t) {
  const dt = (t - lastT) / 1000; lastT = t;
  if (!paused && curDist < totalDist) curDist = Math.min(curDist + playSpeed * speedMult * dt, totalDist);
  while (curIdx < course.length - 1 && course[curIdx + 1].distance_m < curDist) curIdx++;
  const p = course[curIdx];
  const pNext = course[Math.min(curIdx + 1, course.length - 1)];
  const segLen = pNext.distance_m - p.distance_m;
  const frac = segLen > 0 ? Math.min(1, Math.max(0, (curDist - p.distance_m) / segLen)) : 0;
  const rLon = p.lon + (pNext.lon - p.lon) * frac;
  const rLat = p.lat + (pNext.lat - p.lat) * frac;
  const rEle = p.elevation_m + (pNext.elevation_m - p.elevation_m) * frac;

  // 進行方位
  const nextIdx = Math.min(curIdx + 5, course.length - 1);
  const dLon = course[nextIdx].lon - rLon;
  const dLat = course[nextIdx].lat - rLat;
  const heading = Math.atan2(dLon * Math.cos(rLat * Math.PI / 180), dLat);

  // スピナー累積角を cadence rpm に応じて進める (rpm → rad/s = rpm * 2π / 60)
  spinAngle += currentCadence * (2 * Math.PI / 60) * dt;
  // rider 立体を rider 位置 + 進行方向 + スピン角で更新
  const ridSrc = map.getSource && map.getSource('rider');
  if (ridSrc) {
    ridSrc.setData(buildRiderFeatures(rLat, rLon, heading, spinAngle));
  }

  // camera は ride 中じゃなくても常に rider 中心 + 進行方向。
  // (ride 中条件にすると、 zoom out/in 操作後に rider から離れたまま戻らないため。)
  // pitch / zoom は user 操作分を尊重。
  if (course.length > 0) {
    map.jumpTo({
      center: [rLon, rLat],
      bearing: heading * 180 / Math.PI,
      pitch: userPitch,
      zoom: userZoom,
    });
  }

  if (rideStartedAt !== null) {
    const sec = Math.floor((performance.now() - rideStartedAt) / 1000);
    setText('elapsed', `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`);
  } else setText('elapsed', '00:00:00');

  setText('dist', curDist.toFixed(0));
  setText('ele', rEle.toFixed(0));
  setText('slope', p.slope_pct.toFixed(1));
  // デバッグ: 現在の camera zoom / pitch を HUD に表示 (user が好みの値を確認 → default 化に使う)
  setText('cam-zoom', map.getZoom().toFixed(2));
  setText('cam-pitch', map.getPitch().toFixed(0));
  updateMinimap(curDist, rEle, rLat, rLon, heading);
  const dispKmh = playSpeed * speedMult * 3.6;
  setText('speed', paused ? (wsConnected ? '待機中' : 'paused') : `${dispKmh.toFixed(1)} km/h${wsConnected ? ' (bridge)' : ' (demo)'}`);

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

// ボタン bind
document.getElementById('btnPause').addEventListener('click', () => { paused = !paused; });
document.getElementById('btnRideStart').addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  curDist = 0; curIdx = 0; paused = false; lastT = performance.now(); lastPositionSendT = 0;
  ws.send(JSON.stringify({ type: 'ride_start' }));
});
document.getElementById('btnRideEnd').addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  paused = true;
  ws.send(JSON.stringify({ type: 'ride_end' }));
});
document.getElementById('btnScan').addEventListener('click', () => {
  scanMode = 'ftms';
  setText('scan-mode-label', '(trainer モード)');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'scan' }));
});
document.getElementById('btnScanHrm').addEventListener('click', () => {
  scanMode = 'hrm';
  setText('scan-mode-label', '(心拍計モード)');
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'scan' }));
});
document.getElementById('btnSkip').addEventListener('click', () => { showConfirm(); });
document.getElementById('btnConfirmDemo').addEventListener('click', () => {
  hideConfirm(); hidePairing();
  playSpeed = 20 / 3.6; curDist = 0; curIdx = 0; paused = false; lastT = performance.now();
  status('デモモード (記録は保存されません)');
});
document.getElementById('btnCancelDemo').addEventListener('click', () => { hideConfirm(); });
document.getElementById('btnCopyPath').addEventListener('click', () => {
  const path = document.getElementById('post-gpx-path').textContent;
  copyToClipboard(path, document.getElementById('copy-status'));
});
document.getElementById('btnBackToPairing').addEventListener('click', () => {
  hidePostride(); setAppState('pairing'); showPairing();
  curDist = 0; curIdx = 0; updateStepIndicator(-1, 3);
  const b = document.getElementById('btnRideStart'); if (b && !b.disabled) requestAnimationFrame(() => b.focus());
});
document.getElementById('btnOpenPairing').addEventListener('click', () => { showPairing(); });
document.getElementById('btnClosePairing').addEventListener('click', () => {
  document.getElementById('setup-overlay').classList.remove('visible');
});

function bindSlider(rangeId, valId, store, applyFn) {
  const r = document.getElementById(rangeId); const v = document.getElementById(valId);
  if (!r || !v) return;
  applyFn(parseFloat(r.value));
  r.addEventListener('input', () => { const pct = parseFloat(r.value); applyFn(pct); try { localStorage.setItem(store, String(pct / 100)); } catch {} });
}
const rDiff = document.getElementById('rngDiff'); const rSpd = document.getElementById('rngSpd');
if (rDiff) rDiff.value = String(Math.round(diffMult * 100));
if (rSpd) rSpd.value = String(Math.round(speedMult * 100));
bindSlider('rngDiff', 'diffVal', 'fujihc.diff', (pct) => { diffMult = pct / 100; setText('diffVal', String(Math.round(pct))); lastSlopeSent = null; });
bindSlider('rngSpd', 'spdVal', 'fujihc.spd', (pct) => { speedMult = pct / 100; setText('spdVal', (pct / 100).toFixed(2)); });
