// b125c: bike_settings.js の純粋関数 unit. fake storage を渡して localStorage 双方向同期 + clamp.
import { describe, it, expect } from 'vitest';
import {
  createBikeSettings,
  BIKE_SETTINGS_KEYS,
  BIKE_SETTINGS_DEFAULTS,
  BIKE_SETTINGS_LEGACY_KEYS,
} from '../lib/bike_settings.js';

function makeFakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    _store: store,
  };
}

describe('createBikeSettings: 5 state を closure に閉じ、 storage と双方向同期', () => {
  it('storage 空なら DEFAULTS で初期化される', () => {
    const s = makeFakeStorage();
    const bs = createBikeSettings({ storage: s });
    expect(bs.getInertia()).toBe(BIKE_SETTINGS_DEFAULTS.inertia);
    expect(bs.getMass()).toBe(BIKE_SETTINGS_DEFAULTS.mass);
    expect(bs.getCrr()).toBe(BIKE_SETTINGS_DEFAULTS.crr);
    expect(bs.getCda()).toBe(BIKE_SETTINGS_DEFAULTS.cda);
    expect(bs.getPower()).toBe(BIKE_SETTINGS_DEFAULTS.power);
  });

  it('storage に値があれば load される', () => {
    const s = makeFakeStorage({
      [BIKE_SETTINGS_KEYS.inertia]: '1500',
      [BIKE_SETTINGS_KEYS.mass]:    '75',
      [BIKE_SETTINGS_KEYS.crr]:     '0.003',
      [BIKE_SETTINGS_KEYS.cda]:     '0.25',
      [BIKE_SETTINGS_KEYS.power]:   '300',
    });
    const bs = createBikeSettings({ storage: s });
    // halfMode (b128) + labelScale (b125d) を含む 7 field.
    expect(bs.snapshot()).toEqual({ inertia: 1500, mass: 75, crr: 0.003, cda: 0.25, power: 300, halfMode: false, labelScale: 1 });
  });

  it('storage に不正値 (= 文字列 / NaN) があれば DEFAULTS で初期化', () => {
    const s = makeFakeStorage({
      [BIKE_SETTINGS_KEYS.inertia]: 'not-a-number',
      [BIKE_SETTINGS_KEYS.mass]: '',
    });
    const bs = createBikeSettings({ storage: s });
    expect(bs.getInertia()).toBe(BIKE_SETTINGS_DEFAULTS.inertia);
    expect(bs.getMass()).toBe(BIKE_SETTINGS_DEFAULTS.mass);
  });

  it('setX は storage に永続化する', () => {
    const s = makeFakeStorage();
    const bs = createBikeSettings({ storage: s });
    bs.setInertia(1200);
    bs.setMass(70);
    bs.setCrr(0.005);
    bs.setCda(0.3);
    bs.setPower(280);
    expect(s.getItem(BIKE_SETTINGS_KEYS.inertia)).toBe('1200');
    expect(s.getItem(BIKE_SETTINGS_KEYS.mass)).toBe('70');
    expect(s.getItem(BIKE_SETTINGS_KEYS.crr)).toBe('0.005');
    expect(s.getItem(BIKE_SETTINGS_KEYS.cda)).toBe('0.3');
    expect(s.getItem(BIKE_SETTINGS_KEYS.power)).toBe('280');
  });

  it('setX は範囲外の値を min/max に clamp', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    bs.setMass(200);  // max=110
    expect(bs.getMass()).toBe(110);
    bs.setMass(40);   // min=60
    expect(bs.getMass()).toBe(60);
    bs.setInertia(-100);
    expect(bs.getInertia()).toBe(0);
    bs.setInertia(9999);
    expect(bs.getInertia()).toBe(3000);
    bs.setCrr(0.5);
    expect(bs.getCrr()).toBe(0.025);
    bs.setCda(1);
    expect(bs.getCda()).toBe(0.60);
    bs.setPower(9999);
    expect(bs.getPower()).toBe(600);
  });

  it('setX に NaN を渡したら min に丸める', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    bs.setMass(NaN);
    expect(bs.getMass()).toBe(60);
  });

  it('getPhysicsOpts は { mass, c_rr, c_d, area, inertia } を返す、 area=1 固定', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    bs.setMass(75); bs.setCrr(0.005); bs.setCda(0.3); bs.setInertia(1000);
    expect(bs.getPhysicsOpts()).toEqual({
      mass: 75, c_rr: 0.005, c_d: 0.3, area: 1, inertia: 1000,
    });
  });

  it('getPowerProvider は関数を返し、 setPower 後の値を即時反映', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    const provider = bs.getPowerProvider();
    expect(provider()).toBe(BIKE_SETTINGS_DEFAULTS.power);
    bs.setPower(400);
    expect(provider()).toBe(400);
    bs.setPower(150);
    expect(provider()).toBe(150);
  });

  it('migrateLegacyKeys は 旧 3 key のみ削除、 新 key (= crr / cda) は触らない', () => {
    const s = makeFakeStorage({
      'fujihill.diff':      '100',
      'fujihill.spd':       '50',
      'fujihill.labelSize': '120',
      [BIKE_SETTINGS_KEYS.crr]:  '0.003',  // 新 key、 残るべき
      [BIKE_SETTINGS_KEYS.cda]:  '0.25',   // 新 key、 残るべき
      [BIKE_SETTINGS_KEYS.mass]: '75',
    });
    const bs = createBikeSettings({ storage: s });
    bs.migrateLegacyKeys();
    for (const k of BIKE_SETTINGS_LEGACY_KEYS) {
      expect(s.getItem(k)).toBeNull();
    }
    // 新 key は無事
    expect(s.getItem(BIKE_SETTINGS_KEYS.crr)).toBe('0.003');
    expect(s.getItem(BIKE_SETTINGS_KEYS.cda)).toBe('0.25');
    expect(s.getItem(BIKE_SETTINGS_KEYS.mass)).toBe('75');
  });

  it('LEGACY_KEYS は新 key と衝突しない 3 件のみ (= 起票時 bug の解消の物理 pin)', () => {
    expect(BIKE_SETTINGS_LEGACY_KEYS).toEqual([
      'fujihill.diff',
      'fujihill.spd',
      'fujihill.labelSize',
    ]);
    expect(BIKE_SETTINGS_LEGACY_KEYS).not.toContain(BIKE_SETTINGS_KEYS.crr);
    expect(BIKE_SETTINGS_LEGACY_KEYS).not.toContain(BIKE_SETTINGS_KEYS.cda);
  });

  it('storage 未指定 (= node 環境 globalThis.localStorage なし) でも crash しない、 DEFAULTS で動く', () => {
    // node 環境では globalThis.localStorage は無いことを期待 (= vitest default).
    const bs = createBikeSettings();
    expect(bs.getMass()).toBe(BIKE_SETTINGS_DEFAULTS.mass);
    bs.setMass(72);
    expect(bs.getMass()).toBe(72);
    bs.migrateLegacyKeys();  // storage 無くても crash しない
  });
});
