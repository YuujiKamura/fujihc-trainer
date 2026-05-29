// b128: bike_settings の halfMode boolean state 振る舞い pin.
import { describe, it, expect } from 'vitest';
import { createBikeSettings, BIKE_SETTINGS_KEYS, BIKE_SETTINGS_DEFAULTS } from '../lib/bike_settings.js';

function makeFakeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    _store: store,
  };
}

describe('b128: bike_settings の halfMode boolean', () => {
  it('default false', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    expect(bs.getHalfMode()).toBe(false);
    expect(BIKE_SETTINGS_DEFAULTS.halfMode).toBe(false);
  });

  it('storage に "true" があれば true で初期化', () => {
    const s = makeFakeStorage({ [BIKE_SETTINGS_KEYS.halfMode]: 'true' });
    const bs = createBikeSettings({ storage: s });
    expect(bs.getHalfMode()).toBe(true);
  });

  it('storage に "false" があれば false で初期化', () => {
    const s = makeFakeStorage({ [BIKE_SETTINGS_KEYS.halfMode]: 'false' });
    const bs = createBikeSettings({ storage: s });
    expect(bs.getHalfMode()).toBe(false);
  });

  it('storage が不正値なら DEFAULT (= false) に戻る', () => {
    const s = makeFakeStorage({ [BIKE_SETTINGS_KEYS.halfMode]: 'yes' });
    const bs = createBikeSettings({ storage: s });
    expect(bs.getHalfMode()).toBe(false);
  });

  it('setHalfMode(true) で persist + get が true', () => {
    const s = makeFakeStorage();
    const bs = createBikeSettings({ storage: s });
    bs.setHalfMode(true);
    expect(bs.getHalfMode()).toBe(true);
    expect(s.getItem(BIKE_SETTINGS_KEYS.halfMode)).toBe('true');
  });

  it('setHalfMode(false) で persist + get が false', () => {
    const s = makeFakeStorage({ [BIKE_SETTINGS_KEYS.halfMode]: 'true' });
    const bs = createBikeSettings({ storage: s });
    expect(bs.getHalfMode()).toBe(true);
    bs.setHalfMode(false);
    expect(bs.getHalfMode()).toBe(false);
    expect(s.getItem(BIKE_SETTINGS_KEYS.halfMode)).toBe('false');
  });

  it('setHalfMode に truthy / falsy を渡したら boolean に強制', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    bs.setHalfMode(1);
    expect(bs.getHalfMode()).toBe(true);
    bs.setHalfMode(0);
    expect(bs.getHalfMode()).toBe(false);
    bs.setHalfMode('');
    expect(bs.getHalfMode()).toBe(false);
    bs.setHalfMode('off');  // 文字列は truthy
    expect(bs.getHalfMode()).toBe(true);
  });

  it('snapshot に halfMode が含まれる', () => {
    const bs = createBikeSettings({ storage: makeFakeStorage() });
    expect(bs.snapshot()).toHaveProperty('halfMode', false);
    bs.setHalfMode(true);
    expect(bs.snapshot().halfMode).toBe(true);
  });

  it('storage 未指定でも crash しない、 default で動く', () => {
    const bs = createBikeSettings();
    expect(bs.getHalfMode()).toBe(false);
    bs.setHalfMode(true);
    expect(bs.getHalfMode()).toBe(true);
  });
});
