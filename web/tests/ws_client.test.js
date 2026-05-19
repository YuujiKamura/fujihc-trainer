import { describe, it, expect, vi } from 'vitest';
import { createBridgeClient, createTestModeClient } from '../lib/ws_client.js';

// === Fake WebSocket impl ===
// addEventListener / send / close / readyState を真似た minimal mock.
// テストから明示的に _open() / _message() / _close() を呼んで lifecycle を駆動.
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;  // CONNECTING
    this.sent = [];
    this._listeners = { open: [], close: [], error: [], message: [] };
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  send(payload) {
    if (this.readyState !== 1) throw new Error('FakeWebSocket: send before OPEN');
    this.sent.push(payload);
  }
  close(code, reason) {
    this.readyState = 3;
    this._fire('close', { code, reason });
  }
  _open() {
    this.readyState = 1;
    this._fire('open', {});
  }
  _message(data) {
    this._fire('message', { data });
  }
  _fire(type, ev) {
    for (const fn of (this._listeners[type] || [])) fn(ev);
  }
}
FakeWebSocket.instances = [];

function makeClient(handlers = {}, opts = {}) {
  FakeWebSocket.instances.length = 0;
  const client = createBridgeClient('ws://test:1234', handlers, {
    WebSocketImpl: FakeWebSocket,
    ...opts,
  });
  const ws = FakeWebSocket.instances[0];
  return { client, ws };
}

describe('createBridgeClient — connection lifecycle', () => {
  it('autoConnect=true で WebSocket を生成し、 open callback が発火する', () => {
    const onOpen = vi.fn();
    const { client, ws } = makeClient({}, { onOpen });
    expect(ws).toBeDefined();
    expect(ws.url).toBe('ws://test:1234');
    expect(client.isOpen()).toBe(false);  // まだ CONNECTING
    ws._open();
    expect(client.isOpen()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('close() で WebSocket が閉じられ、 onClose が呼ばれる', () => {
    const onClose = vi.fn();
    const { client, ws } = makeClient({}, { onClose });
    ws._open();
    client.close();
    expect(ws.readyState).toBe(3);
    expect(client.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('WebSocketImpl 未指定かつ globalThis.WebSocket も無いと throw', () => {
    const original = globalThis.WebSocket;
    delete globalThis.WebSocket;
    try {
      expect(() => createBridgeClient('ws://x', {})).toThrow(/WebSocket impl 未指定/);
    } finally {
      if (original) globalThis.WebSocket = original;
    }
  });
});

describe('createBridgeClient — send helpers', () => {
  it('sendRideStart は { type: "ride_start" } を送る', () => {
    const { client, ws } = makeClient();
    ws._open();
    expect(client.sendRideStart()).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'ride_start' });
  });

  it('sendRideEnd は { type: "ride_end" } を送る', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendRideEnd();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'ride_end' });
  });

  it('sendScan は { type: "scan" } を送る', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendScan();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'scan' });
  });

  it('sendConnect / sendHrmConnect は address 付き', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendConnect('AA:BB:CC:DD:EE:FF');
    client.sendHrmConnect('11:22:33:44:55:66');
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'connect', address: 'AA:BB:CC:DD:EE:FF' });
    expect(JSON.parse(ws.sent[1])).toEqual({ type: 'hrm_connect', address: '11:22:33:44:55:66' });
  });

  it('sendSetSlope は slope_pct を運ぶ', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendSetSlope(3.7);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'set_slope', slope_pct: 3.7 });
  });

  it('sendPosition は distance/lat/lon/elev を運ぶ', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendPosition(1234.5, 35.4, 138.7, 800.1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'position', distance_m: 1234.5, lat: 35.4, lon: 138.7, elevation_m: 800.1,
    });
  });

  it('sendDisconnect は { type: "disconnect" } を送る', () => {
    const { client, ws } = makeClient();
    ws._open();
    client.sendDisconnect();
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'disconnect' });
  });

  it('OPEN 前は send が false を返し、 payload は溜まらない', () => {
    const { client, ws } = makeClient();
    expect(client.sendRideStart()).toBe(false);
    expect(ws.sent).toHaveLength(0);
  });
});

describe('createBridgeClient — message dispatch', () => {
  it('handlers が type 別に呼ばれる、 未知 type は silent drop', () => {
    const handlers = {
      state: vi.fn(),
      scan_result: vi.fn(),
      ride_status: vi.fn(),
    };
    const { ws } = makeClient(handlers);
    ws._open();
    ws._message(JSON.stringify({ type: 'state', speed_mps: 5.5, power_w: 200 }));
    ws._message(JSON.stringify({ type: 'scan_result', devices: [{ address: 'A' }] }));
    ws._message(JSON.stringify({ type: 'ride_status', state: 'started' }));
    ws._message(JSON.stringify({ type: 'unknown_type', x: 1 }));  // silent
    ws._message('not-json');  // silent

    expect(handlers.state).toHaveBeenCalledWith({ type: 'state', speed_mps: 5.5, power_w: 200 });
    expect(handlers.scan_result).toHaveBeenCalledWith({ type: 'scan_result', devices: [{ address: 'A' }] });
    expect(handlers.ride_status).toHaveBeenCalledWith({ type: 'ride_status', state: 'started' });
  });

  it('message に type 文字列が無い場合は dispatch しない (= crash しない)', () => {
    const state = vi.fn();
    const { ws } = makeClient({ state });
    ws._open();
    ws._message(JSON.stringify({ no_type_field: true }));
    ws._message(JSON.stringify({ type: 123 }));  // type が非 string
    expect(state).not.toHaveBeenCalled();
  });

  it('handlers={} でも message 受信で crash しない', () => {
    const { ws } = makeClient({});
    ws._open();
    expect(() => {
      ws._message(JSON.stringify({ type: 'state', speed_mps: 1 }));
    }).not.toThrow();
  });
});

describe('createTestModeClient', () => {
  it('fakeStateInterval ごとに state handler が呼ばれる (= fake state 定期 push)', () => {
    vi.useFakeTimers();
    try {
      const state = vi.fn();
      const client = createTestModeClient({ state }, { fakeStateInterval: 1000 });
      expect(state).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(state).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(3000);
      expect(state).toHaveBeenCalledTimes(4);
      const msg = state.mock.calls[0][0];
      // default generator は 20 km/h ≒ 5.555... m/s
      expect(msg.speed_mps).toBeCloseTo(20 / 3.6, 5);
      expect(msg.power_w).toBe(150);
      expect(msg.last_ack).toMatch(/TEST MODE/);
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sendRideStart → ride_status started が loopback で発火', () => {
    vi.useFakeTimers();
    try {
      const ride_status = vi.fn();
      const client = createTestModeClient({ ride_status }, { fakeStateInterval: 100000 });
      client.sendRideStart();
      vi.advanceTimersByTime(1);
      expect(ride_status).toHaveBeenCalledWith({ state: 'started' });
      client.sendRideEnd();
      vi.advanceTimersByTime(1);
      expect(ride_status).toHaveBeenLastCalledWith({ state: 'ended' });
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sendScan → scan_status failed (TEST MODE) が loopback', () => {
    vi.useFakeTimers();
    try {
      const scan_status = vi.fn();
      const client = createTestModeClient({ scan_status }, { fakeStateInterval: 100000 });
      client.sendScan();
      vi.advanceTimersByTime(1);
      expect(scan_status).toHaveBeenCalledTimes(1);
      const arg = scan_status.mock.calls[0][0];
      expect(arg.state).toBe('failed');
      expect(arg.message).toMatch(/TEST MODE/);
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() 後は state push が停止する', () => {
    vi.useFakeTimers();
    try {
      const state = vi.fn();
      const client = createTestModeClient({ state }, { fakeStateInterval: 500 });
      vi.advanceTimersByTime(500);
      expect(state).toHaveBeenCalledTimes(1);
      client.close();
      vi.advanceTimersByTime(5000);
      expect(state).toHaveBeenCalledTimes(1);  // close 後は増えない
      expect(client.isOpen()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('カスタム fakeStateGenerator を使える', () => {
    vi.useFakeTimers();
    try {
      const state = vi.fn();
      const gen = vi.fn(() => ({ speed_mps: 99, power_w: 999 }));
      const client = createTestModeClient({ state }, { fakeStateInterval: 100, fakeStateGenerator: gen });
      vi.advanceTimersByTime(100);
      expect(state).toHaveBeenCalledWith({ speed_mps: 99, power_w: 999 });
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('未知 type の send は silent (= crash しない、 loopback もしない)', () => {
    vi.useFakeTimers();
    try {
      const ride_status = vi.fn();
      const client = createTestModeClient({ ride_status }, { fakeStateInterval: 100000 });
      expect(client.sendSetSlope(2.5)).toBe(true);
      expect(client.sendConnect('AA:BB')).toBe(true);
      expect(client.sendPosition(100, 35, 138, 800)).toBe(true);
      vi.advanceTimersByTime(10);
      expect(ride_status).not.toHaveBeenCalled();
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('state を trainer message と HR message に交互に分けて送る (= 実機の複数デバイス構成を模す)', () => {
    // 実機はパワー計と心拍計が別 BLE デバイス。 bridge は両者を別々の state message
    // で送る。 fake もそれに寄せ、 全部入り 1 snapshot を trainer 系 / hr 系に分割して
    // 交互に送る。 これが無いと「心拍 message でパワーが欠ける」経路がテストで歩かれず、
    // 物理が欠けたパワーを 0 と誤認するバグ (記録速度が過小) を検出できない。
    vi.useFakeTimers();
    try {
      const state = vi.fn();
      // generator は「現在の全センサ値」を全部入り 1 snapshot で返す (= 従来通り)。
      const gen = () => ({
        speed_mps: 5, power_w: 200, cadence_rpm: 85, hr_bpm: 145,
        distance_m: 10, slope_sent_pct: 3, last_ack: 'OK',
      });
      const client = createTestModeClient({ state }, { fakeStateInterval: 1000, fakeStateGenerator: gen });
      vi.advanceTimersByTime(4000);  // 4 tick
      expect(state).toHaveBeenCalledTimes(4);  // 1 tick = 1 message は不変

      // 偶 tick (0,2) = trainer message: power/cadence/speed あり、 hr_bpm は載らない。
      const m0 = state.mock.calls[0][0];
      expect(m0.power_w).toBe(200);
      expect(m0.cadence_rpm).toBe(85);
      expect(m0.speed_mps).toBe(5);
      expect('hr_bpm' in m0).toBe(false);  // 心拍は別デバイス、 trainer message に載せない

      // 奇 tick (1,3) = HR message: hr_bpm だけ、 trainer 系の値は載らない。
      const m1 = state.mock.calls[1][0];
      expect(m1.hr_bpm).toBe(145);
      expect('power_w' in m1).toBe(false);  // パワーは別デバイス、 HR message に載せない

      // 交互であること (偶=trainer / 奇=HR) を 4 tick 分で固定する。
      expect('hr_bpm' in state.mock.calls[2][0]).toBe(false);  // tick2 = trainer
      expect(state.mock.calls[3][0].hr_bpm).toBe(145);          // tick3 = HR
      client.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
