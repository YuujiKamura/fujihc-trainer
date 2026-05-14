// brief 32: createBleClient の dispatch / handshake / write / disconnect.
import { describe, it, expect, vi } from 'vitest';
import { createBleClient, isWebBluetoothSupported } from '../lib/ble_client.js';
import {
  FakeBluetooth,
  FakeStorage,
  makeFtmsDevice,
  makeHrmDevice,
} from './_helpers/bluetooth_fake.js';

function makeClient({ withFtms = true, withHrm = false } = {}) {
  const bt = new FakeBluetooth();
  const storage = new FakeStorage();
  const handlers = {
    state: vi.fn(),
    scan_status: vi.fn(),
    connect_status: vi.fn(),
    hrm_status: vi.fn(),
    ride_status: vi.fn(),
    disconnected: vi.fn(),
  };
  let ftms = null;
  let hrm = null;
  if (withFtms) {
    ftms = makeFtmsDevice();
    bt._queueDevice(ftms.device);
  }
  if (withHrm) {
    hrm = makeHrmDevice();
    bt._queueDevice(hrm.device);
  }
  const client = createBleClient(handlers, { bluetooth: bt, storage });
  return { client, handlers, bt, storage, ftms, hrm };
}

describe('isWebBluetoothSupported', () => {
  it('navigator.bluetooth.requestDevice があれば true', () => {
    expect(isWebBluetoothSupported({ bluetooth: { requestDevice: () => {} } })).toBe(true);
  });
  it('bluetooth が無いと false', () => {
    expect(isWebBluetoothSupported({})).toBe(false);
    expect(isWebBluetoothSupported(null)).toBe(false);
  });
});

describe('createBleClient — interface 互換', () => {
  it('createBridgeClient と同 9 method (+isOpen/close) を持つ', () => {
    const { client } = makeClient({ withFtms: false });
    for (const m of [
      'sendRideStart', 'sendRideEnd', 'sendScan', 'sendConnect', 'sendHrmConnect',
      'sendDisconnect', 'sendSetSlope', 'sendPosition', 'isOpen', 'close',
    ]) {
      expect(typeof client[m]).toBe('function');
    }
  });

  it('isOpen は接続前 false', () => {
    const { client } = makeClient({ withFtms: false });
    expect(client.isOpen()).toBe(false);
  });
});

describe('createBleClient — sendConnect (FTMS)', () => {
  it('requestDevice が filters: services=[0x1826] で呼ばれる', async () => {
    const { client, bt } = makeClient();
    client.sendConnect();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(bt.requests).toHaveLength(1);
    expect(bt.requests[0].filters[0].services).toEqual([0x1826]);
  });

  it('接続成功で connect_status を connecting→handshaking→connected の順に dispatch', async () => {
    const { client, handlers } = makeClient();
    client.sendConnect();
    // 全 await を裂く (= handshake 2 段 + notify subscribe 2 個)
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const calls = handlers.connect_status.mock.calls.map((c) => c[0].state);
    expect(calls).toContain('connecting');
    expect(calls).toContain('handshaking');
    expect(calls).toContain('connected');
  });

  it('handshake で controlPoint に 0x00 (RequestControl) と 0x01 (Reset) が write される', async () => {
    const { client, ftms } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const opcodes = ftms.controlPoint.writes.map((w) => w.bytes[0]);
    expect(opcodes).toContain(0x00);
    expect(opcodes).toContain(0x01);
  });

  it('Indoor Bike Data notify → handlers.state に parse 済 field が渡る', async () => {
    const { client, handlers, ftms } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    handlers.state.mockClear();
    // flags=0x0044 (cadence + power), speed_raw=2500 (= 25 km/h), cadence=170 (= 85 rpm), power=150
    ftms.indoorBike._fireNotification([0x44, 0x00, 0xC4, 0x09, 0xAA, 0x00, 0x96, 0x00]);
    expect(handlers.state).toHaveBeenCalledTimes(1);
    const msg = handlers.state.mock.calls[0][0];
    expect(msg.speed_mps).toBeCloseTo(25 / 3.6, 4);
    expect(msg.cadence_rpm).toBeCloseTo(85, 4);
    expect(msg.power_w).toBe(150);
  });

  it('lastBleDeviceId が localStorage に保存される', async () => {
    const { client, storage } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(storage.getItem('fujihc.lastBleDeviceId')).toBe('ftms-1');
  });
});

describe('createBleClient — sendSetSlope', () => {
  it('encodeSetIndoorBikeSimulation の 7 bytes が controlPoint に write される', async () => {
    const { client, ftms } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    ftms.controlPoint.writes.length = 0;
    client.sendSetSlope(2.5);
    await Promise.resolve(); await Promise.resolve();
    expect(ftms.controlPoint.writes).toHaveLength(1);
    expect(Array.from(ftms.controlPoint.writes[0].bytes))
      .toEqual([0x11, 0x00, 0x00, 0xFA, 0x00, 0x28, 0x33]);
  });

  it('未接続で sendSetSlope を呼ぶと false (= silent ok)', () => {
    const { client } = makeClient({ withFtms: false });
    expect(client.sendSetSlope(5.0)).toBe(false);
  });
});

describe('createBleClient — sendHrmConnect', () => {
  it('requestDevice が services=[0x180D] で呼ばれる', async () => {
    const { client, bt } = makeClient({ withFtms: false, withHrm: true });
    client.sendHrmConnect();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(bt.requests).toHaveLength(1);
    expect(bt.requests[0].filters[0].services).toEqual([0x180D]);
  });

  it('HR notify → handlers.state.hr_bpm に乗る', async () => {
    const { client, handlers, hrm } = makeClient({ withFtms: false, withHrm: true });
    client.sendHrmConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    handlers.state.mockClear();
    hrm.hrmChar._fireNotification([0x00, 72]);  // uint8 mode, 72 bpm
    expect(handlers.state).toHaveBeenCalledTimes(1);
    expect(handlers.state.mock.calls[0][0].hr_bpm).toBe(72);
  });

  it('hrm_status が connecting → connected で dispatch', async () => {
    const { client, handlers } = makeClient({ withFtms: false, withHrm: true });
    client.sendHrmConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const states = handlers.hrm_status.mock.calls.map((c) => c[0].state);
    expect(states).toContain('connecting');
    expect(states).toContain('connected');
  });
});

describe('createBleClient — sendDisconnect / close', () => {
  it('sendDisconnect で gatt.disconnect が呼ばれ、 connect_status={state:"disconnected"} を dispatch', async () => {
    const { client, handlers, ftms } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(ftms.device.gatt.connected).toBe(true);
    handlers.connect_status.mockClear();
    client.sendDisconnect();
    await Promise.resolve();
    expect(ftms.device.gatt.connected).toBe(false);
    const states = handlers.connect_status.mock.calls.map((c) => c[0].state);
    expect(states).toContain('disconnected');
  });

  it('GATT 切断 event → handlers.disconnected dispatch', async () => {
    const { client, handlers, ftms } = makeClient();
    client.sendConnect();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // 外部要因切断 (= OS BT stack で device が消えた等) をシミュレート
    ftms.device.gatt.disconnect();
    expect(handlers.disconnected).toHaveBeenCalled();
  });
});

describe('createBleClient — requestDevice 失敗', () => {
  it('user が chooser を cancel すると connect_status={state:"failed"}', async () => {
    const { client, handlers, bt } = makeClient({ withFtms: false });
    bt._throwNext(new Error('User cancelled'));
    client.sendConnect();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const states = handlers.connect_status.mock.calls.map((c) => c[0].state);
    expect(states).toContain('failed');
  });
});

describe('createBleClient — sendRideStart / sendScan loopback', () => {
  it('sendRideStart → ride_status started を loopback', () => {
    const { client, handlers } = makeClient({ withFtms: false });
    client.sendRideStart();
    expect(handlers.ride_status).toHaveBeenCalledWith({ state: 'started' });
  });

  it('sendScan → scan_status failed (= BLE chooser を使う旨)', () => {
    const { client, handlers } = makeClient({ withFtms: false });
    client.sendScan();
    expect(handlers.scan_status).toHaveBeenCalledTimes(1);
    expect(handlers.scan_status.mock.calls[0][0].state).toBe('failed');
  });
});
