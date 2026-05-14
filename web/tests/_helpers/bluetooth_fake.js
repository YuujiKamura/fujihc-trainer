// brief 32: Web Bluetooth API の minimal fake.
// vendor mock library 追加禁止 (= NG-R3-7 再演回避)、 手書きで必要 surface だけ stub.
// surface: requestDevice / device.gatt.connect / getPrimaryService /
//          getCharacteristic / startNotifications / addEventListener /
//          writeValueWithResponse / writeValueWithoutResponse / disconnect.

export class FakeCharacteristic {
  constructor(uuid) {
    this.uuid = uuid;
    this._listeners = {};
    this.writes = [];           // [{kind: 'response'|'noresponse', bytes: Uint8Array}, ...]
    this.notifying = false;
    this.value = null;          // DataView
    this._failNextWriteWithResponse = false;
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  async startNotifications() { this.notifying = true; return this; }
  async stopNotifications() { this.notifying = false; return this; }
  async writeValueWithResponse(buf) {
    if (this._failNextWriteWithResponse) {
      this._failNextWriteWithResponse = false;
      throw new Error('fake: response write failed (= Wahoo trap)');
    }
    this.writes.push({ kind: 'response', bytes: _toUint8(buf) });
  }
  async writeValueWithoutResponse(buf) {
    this.writes.push({ kind: 'noresponse', bytes: _toUint8(buf) });
  }
  async writeValue(buf) {
    this.writes.push({ kind: 'response', bytes: _toUint8(buf) });
  }
  // test driver から notification を発火させる
  _fireNotification(bytes) {
    const arr = _toUint8(bytes);
    const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
    this.value = dv;
    const ev = { target: { value: dv } };
    for (const fn of (this._listeners['characteristicvaluechanged'] || [])) fn(ev);
  }
}

export class FakeService {
  constructor(uuid, chars) {
    this.uuid = uuid;
    this._chars = new Map();
    for (const c of (chars || [])) this._chars.set(_normUuid(c.uuid), c);
  }
  async getCharacteristic(uuid) {
    const c = this._chars.get(_normUuid(uuid));
    if (!c) throw new Error(`fake: characteristic ${uuid} not found`);
    return c;
  }
}

export class FakeGattServer {
  constructor(device, services) {
    this.device = device;
    this.connected = false;
    this._services = new Map();
    for (const s of (services || [])) this._services.set(_normUuid(s.uuid), s);
  }
  async connect() { this.connected = true; return this; }
  disconnect() {
    this.connected = false;
    const ls = this.device._listeners['gattserverdisconnected'] || [];
    for (const fn of ls) fn({});
  }
  async getPrimaryService(uuid) {
    const s = this._services.get(_normUuid(uuid));
    if (!s) throw new Error(`fake: service ${uuid} not found`);
    return s;
  }
}

export class FakeDevice {
  constructor({ id, name, services }) {
    this.id = id || 'fake-device-id';
    this.name = name || 'fake-device';
    this._listeners = {};
    this.gatt = new FakeGattServer(this, services);
  }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
}

export class FakeBluetooth {
  constructor() {
    this.requests = [];                 // [{filters, optionalServices}, ...]
    this._nextDevices = [];             // FIFO で返す
    this._throwOnRequest = null;
  }
  async requestDevice(opts) {
    this.requests.push(opts);
    if (this._throwOnRequest) {
      const e = this._throwOnRequest;
      this._throwOnRequest = null;
      throw e;
    }
    if (!this._nextDevices.length) throw new Error('fake: no device queued');
    return this._nextDevices.shift();
  }
  _queueDevice(device) { this._nextDevices.push(device); }
  _throwNext(err) { this._throwOnRequest = err; }
}

export class FakeStorage {
  constructor() { this._map = new Map(); }
  getItem(k) { return this._map.has(k) ? this._map.get(k) : null; }
  setItem(k, v) { this._map.set(k, String(v)); }
  removeItem(k) { this._map.delete(k); }
  clear() { this._map.clear(); }
}

// --- factory: FTMS trainer / HRM device の標準形 ---

export function makeFtmsDevice({ id = 'ftms-1', name = 'Direto X' } = {}) {
  const indoorBike = new FakeCharacteristic(0x2AD2);
  const controlPoint = new FakeCharacteristic(0x2AD9);
  const ftmsService = new FakeService(0x1826, [indoorBike, controlPoint]);
  const device = new FakeDevice({ id, name, services: [ftmsService] });
  return { device, indoorBike, controlPoint };
}

export function makeHrmDevice({ id = 'hrm-1', name = 'Polar H10' } = {}) {
  const hrmChar = new FakeCharacteristic(0x2A37);
  const hrmService = new FakeService(0x180D, [hrmChar]);
  const device = new FakeDevice({ id, name, services: [hrmService] });
  return { device, hrmChar };
}

function _toUint8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && buf.buffer) return new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (Array.isArray(buf)) return new Uint8Array(buf);
  throw new Error('fake: unknown buffer type');
}

function _normUuid(uuid) {
  if (typeof uuid === 'number') return uuid;
  if (typeof uuid === 'string') return uuid.toLowerCase();
  return uuid;
}
