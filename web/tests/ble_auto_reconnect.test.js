// 2026-05-15 user 指示「毎回起動時にトレーナーに接続ボタンを押すのがめんどくさい、
// 登録済みのトレーナーがある時は起動直後にハンドシェイクできないか」
// navigator.bluetooth.getDevices() 経路で過去 grant 済 device に user 操作なし接続。
import { describe, it, expect, vi } from 'vitest';
import { createBleClient } from '../lib/ble_client.js';

function memStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

function makeDevice(id, name = 'mock trainer') {
  const listeners = new Map();
  const indoorCharListeners = new Map();
  const controlCharListeners = new Map();
  function mkChar(charListeners) {
    return {
      startNotifications: vi.fn().mockResolvedValue(undefined),
      stopNotifications: vi.fn().mockResolvedValue(undefined),
      addEventListener(ev, fn) { charListeners.set(ev, fn); },
      removeEventListener(ev) { charListeners.delete(ev); },
      writeValueWithResponse: vi.fn().mockResolvedValue(undefined),
      writeValueWithoutResponse: vi.fn().mockResolvedValue(undefined),
    };
  }
  const indoorChar = mkChar(indoorCharListeners);
  const controlChar = mkChar(controlCharListeners);
  const service = {
    getCharacteristic: vi.fn(async (uuid) => (uuid === 0x2AD2 ? indoorChar : controlChar)),
  };
  const server = {
    connected: true,
    getPrimaryService: vi.fn().mockResolvedValue(service),
  };
  return {
    id, name,
    gatt: { connect: vi.fn().mockResolvedValue(server) },
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
    _server: server, _service: service,
  };
}

describe('ble_client tryAutoReconnect', () => {
  it('lastDeviceId 未保存 → false (= 自動接続しない)', async () => {
    const storage = memStorage();
    const bt = { getDevices: vi.fn().mockResolvedValue([makeDevice('abc')]) };
    const client = createBleClient({}, { bluetooth: bt, storage });
    const ok = await client.tryAutoReconnect();
    expect(ok).toBe(false);
    expect(bt.getDevices).not.toHaveBeenCalled();
  });

  it('lastDeviceId 保存済 + getDevices に一致なし → false', async () => {
    const storage = memStorage({ 'fujihill.lastBleDeviceId': 'xxx' });
    const bt = { getDevices: vi.fn().mockResolvedValue([makeDevice('yyy')]) };
    const client = createBleClient({}, { bluetooth: bt, storage });
    const ok = await client.tryAutoReconnect();
    expect(ok).toBe(false);
  });

  it('lastDeviceId が getDevices の戻り値に一致 → device.gatt.connect 発火 + true', async () => {
    const target = makeDevice('match-id');
    const storage = memStorage({ 'fujihill.lastBleDeviceId': 'match-id' });
    const bt = { getDevices: vi.fn().mockResolvedValue([target]) };
    const dispatched = [];
    const handlers = {
      connect_status: (msg) => dispatched.push(msg),
      state: () => {},
    };
    const client = createBleClient(handlers, { bluetooth: bt, storage });
    const ok = await client.tryAutoReconnect();
    expect(ok).toBe(true);
    expect(target.gatt.connect).toHaveBeenCalled();
    expect(dispatched.some((d) => d.state === 'connecting')).toBe(true);
  });

  it('getDevices が throw → 例外を握りつぶして false (= silent fallback)', async () => {
    const storage = memStorage({ 'fujihill.lastBleDeviceId': 'anything' });
    const bt = { getDevices: vi.fn().mockRejectedValue(new Error('permission denied')) };
    const client = createBleClient({}, { bluetooth: bt, storage });
    const ok = await client.tryAutoReconnect();
    expect(ok).toBe(false);
  });

  it('bt.getDevices 未対応 (= 古い browser) → false', async () => {
    const storage = memStorage({ 'fujihill.lastBleDeviceId': 'x' });
    const bt = { /* getDevices なし */ };
    const client = createBleClient({}, { bluetooth: bt, storage });
    const ok = await client.tryAutoReconnect();
    expect(ok).toBe(false);
  });
});
