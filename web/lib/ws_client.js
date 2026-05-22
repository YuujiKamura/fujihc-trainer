// brief 19: WebSocket client を 1 module に集約 (= NG-R1-12 解消).
// viewer-maplibre.js から ws send / message dispatch を消す pure-ish module.
// DOM / localStorage は触らない (= viewer 側の責務、 受信は handlers callback で渡す).
//
// protocol message 種別はここで一覧:
//   - send: ride_start, ride_end, scan, connect, hrm_connect, disconnect, set_slope, position
//   - recv: state, scan_status, scan_result, connect_status, disconnected, hrm_status,
//           ride_status, post_ride (= handlers で dispatch)
//
// テスト容易性のため WebSocket 実装は options.WebSocketImpl で注入可能.

/**
 * Bridge (Python WS server) に接続する client を生成.
 *
 * @param {string} url - WebSocket URL (例: 'ws://localhost:8765')
 * @param {Object} handlers - message type → callback の dispatch table.
 *   各 callback は parsed message オブジェクトを受け取る.
 *   未知の type は silent drop.
 * @param {Object} [options]
 * @param {Function} [options.WebSocketImpl] - WebSocket 実装 (default: globalThis.WebSocket)
 * @param {Function} [options.onOpen] - 接続確立時 callback
 * @param {Function} [options.onClose] - 切断時 callback
 * @param {Function} [options.onError] - error 時 callback
 * @param {boolean} [options.autoConnect=true] - 即座に接続するか (false なら手動 connect() 必要)
 * @returns {{send: Function, sendRideStart: Function, sendRideEnd: Function, sendScan: Function, sendConnect: Function, sendHrmConnect: Function, sendDisconnect: Function, sendSetSlope: Function, sendPosition: Function, isOpen: Function, close: Function, getWebSocket: Function}}
 */
export function createBridgeClient(url, handlers, options = {}) {
  const WSImpl = options.WebSocketImpl || (typeof globalThis !== 'undefined' ? globalThis.WebSocket : undefined);
  if (!WSImpl) {
    throw new Error('createBridgeClient: WebSocket impl 未指定 (= options.WebSocketImpl を渡せ、 globalThis.WebSocket も無い)');
  }
  const safeHandlers = handlers || {};
  const onOpen = options.onOpen || (() => {});
  const onClose = options.onClose || (() => {});
  const onError = options.onError || (() => {});
  const autoConnect = options.autoConnect !== false;

  let ws = null;

  function _attach() {
    ws.addEventListener('open', (ev) => { onOpen(ev); });
    ws.addEventListener('close', (ev) => { onClose(ev); });
    ws.addEventListener('error', (ev) => { onError(ev); });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      const h = safeHandlers[msg.type];
      if (typeof h === 'function') h(msg);
    });
  }

  function connect() {
    ws = new WSImpl(url);
    _attach();
    return ws;
  }

  if (autoConnect) connect();

  function _send(payload) {
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  return {
    /** 任意 payload を送る (debug 用、 通常は type 別 helper を使え). */
    send(payload) { return _send(payload); },
    /** ride 開始 request. */
    sendRideStart() { return _send({ type: 'ride_start' }); },
    /** ride 終了 request. */
    sendRideEnd() { return _send({ type: 'ride_end' }); },
    /** BLE スキャン request. */
    sendScan() { return _send({ type: 'scan' }); },
    /** FTMS (trainer) 接続 request. */
    sendConnect(address) { return _send({ type: 'connect', address }); },
    /** HRM (心拍計) 接続 request. */
    sendHrmConnect(address) { return _send({ type: 'hrm_connect', address }); },
    /** 切断 request. */
    sendDisconnect() { return _send({ type: 'disconnect' }); },
    /** 勾配送信 (= trainer に set_slope). */
    sendSetSlope(slopePct) { return _send({ type: 'set_slope', slope_pct: slopePct }); },
    /** 位置 telemetry 送信. */
    sendPosition(distance_m, lat, lon, elevation_m) {
      return _send({ type: 'position', distance_m, lat, lon, elevation_m });
    },
    /** WebSocket が open か. */
    isOpen() { return !!ws && ws.readyState === 1; },
    /** 切断 (= ws.close). */
    close(code, reason) { if (ws) ws.close(code, reason); },
    /** 手動 reconnect (autoConnect=false 時のみ意味あり). */
    connect,
    /** 内部 WebSocket への参照 (テスト用、 通常は使うな). */
    getWebSocket() { return ws; },
  };
}

/**
 * TEST / VIEW / MAP MODE 共通の fake state 生成器.
 *
 * 旧来は initTestMode / initViewMode / initMapMode の 3 箇所に同一ロジックを直書きしていた
 * (= SoT 三重複)。 fake trainer は ride が active (= 走行中かつ非 paused) の時だけ
 * power / cadence / speed を出す。 ride 未開始・ rideState 未生成なら 0 を返す。
 *
 * @param {() => ({active?:boolean, paused?:boolean, distance?:number}|null)} getSnapshot
 *   rideState.snapshot() を返す関数 (= rideState 未生成なら null を返してよい).
 * @param {string} [ackLabel='OK (TEST MODE)'] last_ack に載せるモード名.
 * @param {() => number} [getPower] moving 時に出す power_w を返す関数 (= 観る/デモ/TEST
 *   モードのパワースライダー値)。 省略時は 150 固定 (= 後方互換、 既存テストの
 *   power_w===150 期待を維持)。 非数を返した場合も 150 に fallback する。
 * @returns {() => object} createTestModeClient の fakeStateGenerator にそのまま渡せる関数.
 */
export function createFakeStateGenerator(getSnapshot, ackLabel = 'OK (TEST MODE)', getPower) {
  return () => {
    const snap = (typeof getSnapshot === 'function' && getSnapshot())
      || { active: false, paused: true, distance: 0 };
    const moving = !!snap.active && !snap.paused;
    // power_w は getPower() の戻り値 (= パワースライダー)。 実ライドの client は
    // この生成器を通らないため、 スライダーは観る/デモ/TEST にのみ効く (= trainer
    // 接続中は実 power 優先、 実行時分岐なしで構造的に成立)。
    const rawPower = (typeof getPower === 'function') ? Number(getPower()) : 150;
    const power = Number.isFinite(rawPower) ? rawPower : 150;
    return {
      speed_mps: moving ? (20 / 3.6) : 0,
      power_w: moving ? power : 0,
      cadence_rpm: moving ? 80 : 0,
      distance_m: Number.isFinite(snap.distance) ? snap.distance : 0,
      slope_sent_pct: 0,
      hr_bpm: 120,
      last_ack: ackLabel,
    };
  };
}

/**
 * テスト/開発モード用の fake client (= brief 22 ?test=1 で使う).
 * trainer / bridge 不要、 fake state を定期 push、 主要 send は handlers にループバック.
 *
 * @param {Object} handlers - createBridgeClient と同形
 * @param {Object} [options]
 * @param {number} [options.fakeStateInterval=1000] - state push の interval (ms)
 * @param {Function} [options.fakeStateGenerator] - () => state オブジェクトを返す関数.
 *   default は固定 20 km/h.
 * @param {Function} [options.setInterval] - timer 注入 (テスト用)
 * @param {Function} [options.clearInterval] - timer 注入 (テスト用)
 * @param {Function} [options.setTimeout] - timer 注入 (テスト用)
 * @returns 同 API
 */
export function createTestModeClient(handlers, options = {}) {
  const safeHandlers = handlers || {};
  const interval = options.fakeStateInterval != null ? options.fakeStateInterval : 1000;
  const _setInterval = options.setInterval || globalThis.setInterval;
  const _clearInterval = options.clearInterval || globalThis.clearInterval;
  const _setTimeout = options.setTimeout || globalThis.setTimeout;
  const generator = options.fakeStateGenerator || (() => ({
    speed_mps: 20 / 3.6,
    power_w: 150,
    cadence_rpm: 80,
    distance_m: 0,
    slope_sent_pct: 0,
    hr_bpm: 120,
    last_ack: 'OK (TEST MODE)',
  }));

  let closed = false;
  let timer = null;
  // fake state を実機の複数デバイス構成に寄せる ── 実機はパワー計と心拍計が別 BLE
  // デバイスで、 bridge は両者を別々の state message として送る (power だけ / hr だけ
  // の部分 message)。 fake が常に全部入り 1 message を送ると、 viewer の部分 message
  // 処理経路 (心拍 message でパワーが欠ける側) がテストで一度も歩かれず、 そこのバグ
  // (物理が欠けたパワーを 0 と誤認 → 記録速度が過小) を構造的に検出できない。 そこで
  // tick ごとに trainer message と HR message を交互に分けて送る。
  let _stateTick = 0;

  function _dispatch(type, msg) {
    const h = safeHandlers[type];
    if (typeof h === 'function') h(msg);
  }

  function _fakeSend(payload) {
    if (closed) return false;
    // 主要 type だけ即座に応答、 その他は silent drop (= 既存 viewer の fake ws 挙動と同じ)
    if (payload && typeof payload.type === 'string') {
      if (payload.type === 'ride_start') {
        _setTimeout(() => _dispatch('ride_status', { state: 'started' }), 0);
      } else if (payload.type === 'ride_end') {
        _setTimeout(() => _dispatch('ride_status', { state: 'ended' }), 0);
      } else if (payload.type === 'scan') {
        _setTimeout(() => _dispatch('scan_status', { state: 'failed', message: 'TEST MODE (no BLE)' }), 0);
      }
      // set_slope / connect / position 等は silent (= trainer 不在のため応答なし)
    }
    return true;
  }

  // 定期 push 開始。 trainer message (power/cadence/speed、 hr なし) と HR message
  // (hr のみ) を tick 交互に送る (= 上の複数デバイス comment)。 1 tick = 1 message
  // は不変、 interval 契約は変えない。 最初の tick は trainer message。
  timer = _setInterval(() => {
    if (closed) return;
    const s = generator();
    if (_stateTick % 2 === 0) {
      // trainer message: パワー計由来。 hr_bpm は別デバイスなので載せない。
      const trainerMsg = { ...s };
      delete trainerMsg.hr_bpm;
      _dispatch('state', trainerMsg);
    } else {
      // HR message: 心拍計由来の hr_bpm だけ。
      _dispatch('state', { hr_bpm: s.hr_bpm });
    }
    _stateTick++;
  }, interval);

  return {
    send(payload) { return _fakeSend(payload); },
    sendRideStart() { return _fakeSend({ type: 'ride_start' }); },
    sendRideEnd() { return _fakeSend({ type: 'ride_end' }); },
    sendScan() { return _fakeSend({ type: 'scan' }); },
    sendConnect(address) { return _fakeSend({ type: 'connect', address }); },
    sendHrmConnect(address) { return _fakeSend({ type: 'hrm_connect', address }); },
    sendDisconnect() { return _fakeSend({ type: 'disconnect' }); },
    sendSetSlope(slopePct) { return _fakeSend({ type: 'set_slope', slope_pct: slopePct }); },
    sendPosition(distance_m, lat, lon, elevation_m) {
      return _fakeSend({ type: 'position', distance_m, lat, lon, elevation_m });
    },
    isOpen() { return !closed; },
    close() {
      closed = true;
      if (timer != null) { _clearInterval(timer); timer = null; }
    },
    getWebSocket() { return null; },
  };
}
