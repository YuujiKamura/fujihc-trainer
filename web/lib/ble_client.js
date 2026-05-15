// brief 32: Web Bluetooth で FTMS trainer + HRM に直接接続する client.
// createBridgeClient (ws_client.js) と同 interface (= viewer 起動分岐 1 箇所で切替可).
// 物理 grep gate: 本 file は WS 経路の class 名文字列ゼロ (= ble_responsibility_grep.test.js で pin).
//
// scan / connect は user gesture (button click) から呼ぶ Web Bluetooth 仕様、
// requestDevice 1 回 = 1 device、 trainer と HRM は別 sendConnect / sendHrmConnect で取る.
//
// FTMS handshake は bridge.py L407-413 と同じ 2 段 (Request Control 0x00 → Reset 0x01).
// Start (0x07) は実機で Operation-Failed を返すため省略.

import {
  parseIndoorBikeData,
  parseHeartRate,
  parseControlResponse,
  encodeSetIndoorBikeSimulation,
} from './ftms_parse.js';

const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA_CHAR = 0x2AD2;
const CONTROL_POINT_CHAR = 0x2AD9;
const HEART_RATE_SERVICE = 0x180D;
const HEART_RATE_MEASUREMENT_CHAR = 0x2A37;

const FTMS_OP_REQUEST_CONTROL = 0x00;
const FTMS_OP_RESET = 0x01;

const LS_KEY_LAST_DEVICE = 'fujihill.lastBleDeviceId';

/**
 * navigator.bluetooth が利用可能か (= Chrome/Edge/Android Chrome で true).
 * iOS Safari / Firefox は false、 fallback UI で案内する.
 * @param {object} [nav=navigator]
 */
export function isWebBluetoothSupported(nav) {
  const n = nav || (typeof navigator !== 'undefined' ? navigator : undefined);
  return !!(n && n.bluetooth && typeof n.bluetooth.requestDevice === 'function');
}

/**
 * Web Bluetooth client. createBridgeClient と同 interface 9 method を返す.
 * @param {Object} handlers - createBridgeClient と同形 dispatch table.
 * @param {Object} [options]
 * @param {object} [options.bluetooth] - navigator.bluetooth 注入 (test 用)
 * @param {Storage} [options.storage] - localStorage 注入 (test 用)
 */
export function createBleClient(handlers, options = {}) {
  const safeHandlers = handlers || {};
  const bt = options.bluetooth || (typeof navigator !== 'undefined' ? navigator.bluetooth : undefined);
  const storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : undefined);

  // 内部 state. 全 null 初期化 (= 未接続).
  const state = {
    ftmsDevice: null,
    ftmsServer: null,
    indoorBikeChar: null,
    controlPointChar: null,
    indoorBikeListener: null,
    controlPointListener: null,
    ftmsDisconnectListener: null,
    hrmDevice: null,
    hrmServer: null,
    hrmChar: null,
    hrmListener: null,
    hrmDisconnectListener: null,
    lastDeviceId: null,
    closed: false,
  };

  function _dispatch(type, msg) {
    const h = safeHandlers[type];
    if (typeof h === 'function') {
      try { h(msg); } catch { /* swallow handler error (= viewer 側の bug を client で死なせない) */ }
    }
  }

  // --- FTMS handshake / notify ---

  async function _connectFtms() {
    if (!bt) {
      _dispatch('connect_status', { state: 'failed', message: 'Web Bluetooth 非対応' });
      return;
    }
    _dispatch('connect_status', { state: 'connecting', address: '(BLE chooser)' });
    let device;
    try {
      device = await bt.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }],
        optionalServices: [FTMS_SERVICE],
      });
    } catch (err) {
      _dispatch('connect_status', { state: 'failed', message: _errMsg(err) });
      return;
    }
    await _connectFtmsWithDevice(device);
  }

  // 2026-05-15: 過去 grant 済 device (= navigator.bluetooth.getDevices() の戻り値) を
  // 受け取って user gesture なしで gatt 接続する経路。 _connectFtms (= requestDevice
  // chooser 経由) と共有する handshake / notify subscribe ロジックを分離した。
  async function _connectFtmsWithDevice(device) {
    state.ftmsDevice = device;
    state.lastDeviceId = device.id || null;
    if (storage && state.lastDeviceId) {
      try { storage.setItem(LS_KEY_LAST_DEVICE, state.lastDeviceId); } catch { /* quota / privacy */ }
    }
    state.ftmsDisconnectListener = () => {
      _dispatch('disconnected', { reason: 'GATT disconnected' });
    };
    if (typeof device.addEventListener === 'function') {
      device.addEventListener('gattserverdisconnected', state.ftmsDisconnectListener);
    }

    try {
      state.ftmsServer = await device.gatt.connect();
      const service = await state.ftmsServer.getPrimaryService(FTMS_SERVICE);
      state.indoorBikeChar = await service.getCharacteristic(INDOOR_BIKE_DATA_CHAR);
      state.controlPointChar = await service.getCharacteristic(CONTROL_POINT_CHAR);
    } catch (err) {
      _dispatch('connect_status', { state: 'failed', message: _errMsg(err) });
      return;
    }

    _dispatch('connect_status', { state: 'handshaking', address: device.id || device.name || '' });

    // Indoor Bike Data notify subscribe
    state.indoorBikeListener = (event) => {
      const view = event.target && event.target.value;
      if (!view) return;
      const parsed = parseIndoorBikeData(view);
      // bridge.py L388 と同 contract: state push (= type:state + fields)
      _dispatch('state', { type: 'state', ...parsed });
    };
    try {
      await state.indoorBikeChar.startNotifications();
      state.indoorBikeChar.addEventListener('characteristicvaluechanged', state.indoorBikeListener);
    } catch (err) {
      _dispatch('connect_status', { state: 'failed', message: `indoor bike notify failed: ${_errMsg(err)}` });
      return;
    }

    // Control Point notify subscribe (ack を state.last_ack に乗せる)
    state.controlPointListener = (event) => {
      const view = event.target && event.target.value;
      if (!view) return;
      const parsed = parseControlResponse(view);
      if (!parsed) return;
      const ack = `op=0x${parsed.req_op.toString(16).padStart(2, '0').toUpperCase()} ${parsed.result_name}`;
      _dispatch('state', { type: 'state', last_ack: ack });
    };
    try {
      await state.controlPointChar.startNotifications();
      state.controlPointChar.addEventListener('characteristicvaluechanged', state.controlPointListener);
    } catch {
      // 一部実機で indication が無いことがある、 ack 不要なら無視 (bridge.py L399-400 と同方針)
    }

    // 2 段ハンドシェイク. response=true で失敗したら response=false で retry
    // (= bridge.py L716-732 の two-mode write fallback と同型).
    for (const opcode of [FTMS_OP_REQUEST_CONTROL, FTMS_OP_RESET]) {
      await _writeControlPoint(new Uint8Array([opcode]));
    }

    _dispatch('connect_status', { state: 'connected', address: device.id || device.name || '' });
  }

  async function _writeControlPoint(bytes) {
    if (!state.controlPointChar) return false;
    // 罠注記: writeValueWithResponse が無い古い実装は writeValue にフォールバック.
    try {
      if (typeof state.controlPointChar.writeValueWithResponse === 'function') {
        await state.controlPointChar.writeValueWithResponse(bytes);
        return true;
      }
      if (typeof state.controlPointChar.writeValue === 'function') {
        await state.controlPointChar.writeValue(bytes);
        return true;
      }
    } catch {
      // response=true 失敗 → response=false で retry
      try {
        if (typeof state.controlPointChar.writeValueWithoutResponse === 'function') {
          await state.controlPointChar.writeValueWithoutResponse(bytes);
          return true;
        }
      } catch { /* both failed */ }
    }
    return false;
  }

  // --- HRM 並走接続 ---

  async function _connectHrm() {
    if (!bt) {
      _dispatch('hrm_status', { state: 'failed', message: 'Web Bluetooth 非対応' });
      return;
    }
    _dispatch('hrm_status', { state: 'connecting', address: '(BLE chooser)' });
    let device;
    try {
      device = await bt.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE] }],
        optionalServices: [HEART_RATE_SERVICE],
      });
    } catch (err) {
      _dispatch('hrm_status', { state: 'failed', message: _errMsg(err) });
      return;
    }
    state.hrmDevice = device;
    state.hrmDisconnectListener = () => {
      _dispatch('hrm_status', { state: 'disconnected' });
    };
    if (typeof device.addEventListener === 'function') {
      device.addEventListener('gattserverdisconnected', state.hrmDisconnectListener);
    }
    try {
      state.hrmServer = await device.gatt.connect();
      const service = await state.hrmServer.getPrimaryService(HEART_RATE_SERVICE);
      state.hrmChar = await service.getCharacteristic(HEART_RATE_MEASUREMENT_CHAR);
    } catch (err) {
      _dispatch('hrm_status', { state: 'failed', message: _errMsg(err) });
      return;
    }
    state.hrmListener = (event) => {
      const view = event.target && event.target.value;
      if (!view) return;
      const parsed = parseHeartRate(view);
      if (parsed.hr_bpm != null) _dispatch('state', { type: 'state', hr_bpm: parsed.hr_bpm });
    };
    try {
      await state.hrmChar.startNotifications();
      state.hrmChar.addEventListener('characteristicvaluechanged', state.hrmListener);
    } catch (err) {
      _dispatch('hrm_status', { state: 'failed', message: _errMsg(err) });
      return;
    }
    _dispatch('hrm_status', { state: 'connected', address: device.id || device.name || '' });
  }

  // --- disconnect / cleanup ---

  function _disposeListeners() {
    if (state.indoorBikeChar && state.indoorBikeListener) {
      try { state.indoorBikeChar.removeEventListener('characteristicvaluechanged', state.indoorBikeListener); } catch {}
    }
    if (state.controlPointChar && state.controlPointListener) {
      try { state.controlPointChar.removeEventListener('characteristicvaluechanged', state.controlPointListener); } catch {}
    }
    if (state.hrmChar && state.hrmListener) {
      try { state.hrmChar.removeEventListener('characteristicvaluechanged', state.hrmListener); } catch {}
    }
    if (state.ftmsDevice && state.ftmsDisconnectListener && typeof state.ftmsDevice.removeEventListener === 'function') {
      try { state.ftmsDevice.removeEventListener('gattserverdisconnected', state.ftmsDisconnectListener); } catch {}
    }
    if (state.hrmDevice && state.hrmDisconnectListener && typeof state.hrmDevice.removeEventListener === 'function') {
      try { state.hrmDevice.removeEventListener('gattserverdisconnected', state.hrmDisconnectListener); } catch {}
    }
    state.indoorBikeListener = null;
    state.controlPointListener = null;
    state.hrmListener = null;
    state.ftmsDisconnectListener = null;
    state.hrmDisconnectListener = null;
  }

  async function _disconnect() {
    _disposeListeners();
    try {
      if (state.ftmsServer && typeof state.ftmsServer.disconnect === 'function') state.ftmsServer.disconnect();
    } catch {}
    try {
      if (state.hrmServer && typeof state.hrmServer.disconnect === 'function') state.hrmServer.disconnect();
    } catch {}
    state.ftmsServer = null;
    state.hrmServer = null;
    state.indoorBikeChar = null;
    state.controlPointChar = null;
    state.hrmChar = null;
    state.ftmsDevice = null;
    state.hrmDevice = null;
    _dispatch('connect_status', { state: 'disconnected' });
  }

  // --- send helpers (createBridgeClient と同 interface) ---

  function sendRideStart() {
    // BLE 経路は trainer が常時 notify、 ride_start は viewer 側 ride state の制御のみ.
    // bridge.py の ride_status を viewer に届けて HUD を変える contract に合わせる.
    _dispatch('ride_status', { state: 'started' });
    return true;
  }

  function sendRideEnd() {
    _dispatch('ride_status', { state: 'ended' });
    return true;
  }

  function sendScan() {
    // Web Bluetooth は browser chooser、 viewer 内 scan list を出さない (= 仕様).
    _dispatch('scan_status', { state: 'failed', message: 'BLE mode: ブラウザの chooser を使用 (scan list 無し)' });
    return true;
  }

  function sendConnect(_address) {
    // address 引数は WS 互換のため受け取るが Web BT は chooser、 使わない.
    _connectFtms();
    return true;
  }

  function sendHrmConnect(_address) {
    _connectHrm();
    return true;
  }

  function sendDisconnect() {
    _disconnect();
    return true;
  }

  function sendSetSlope(slopePct) {
    if (!state.controlPointChar) return false;
    const bytes = encodeSetIndoorBikeSimulation(slopePct);
    _writeControlPoint(bytes);
    return true;
  }

  function sendPosition(_distance_m, _lat, _lon, _elevation_m) {
    // BLE 経路では bridge.py 側の GPX 記録は無し、 position は viewer がローカル管理.
    // 互換のため受け付けるが no-op (= ride log は brief 33 で IndexedDB に移す予定).
    return true;
  }

  function isOpen() {
    if (state.closed) return false;
    // FTMS GATT 接続中なら open とみなす (HRM 任意).
    return !!(state.ftmsServer && state.ftmsServer.connected !== false);
  }

  function close() {
    state.closed = true;
    _disconnect();
  }

  // 2026-05-15: 起動時 auto-reconnect (= 過去 grant 済 device があれば user 操作なしで接続).
  // navigator.bluetooth.getDevices() は Chrome 92+ で利用可、 page reload 後も permission persist.
  // device 在不明 / 電源 OFF / 範囲外なら silent fallback (= 「Trainer に接続」 button で復活).
  async function tryAutoReconnect() {
    if (!bt || typeof bt.getDevices !== 'function') return false;
    if (!storage) return false;
    let savedId;
    try { savedId = storage.getItem(LS_KEY_LAST_DEVICE); } catch { return false; }
    if (!savedId) return false;
    let devices;
    try { devices = await bt.getDevices(); } catch { return false; }
    const target = (devices || []).find((d) => d && d.id === savedId);
    if (!target) return false;
    _dispatch('connect_status', { state: 'connecting', address: target.id || target.name || '(reconnect)' });
    try {
      await _connectFtmsWithDevice(target);
      return true;
    } catch {
      return false;
    }
  }

  return {
    send() { return true; },  // 任意 payload は BLE 経路で意味なし、 silent ok
    sendRideStart,
    sendRideEnd,
    sendScan,
    sendConnect,
    sendHrmConnect,
    sendDisconnect,
    sendSetSlope,
    sendPosition,
    isOpen,
    close,
    tryAutoReconnect,
    // test 用 internal 参照 (= ws_client 側の同 role helper と並ぶ位置付け)
    _getState() { return state; },
    getLastDeviceId() { return state.lastDeviceId; },
  };
}

function _errMsg(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}
