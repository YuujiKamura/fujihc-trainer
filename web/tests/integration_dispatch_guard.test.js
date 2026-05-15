// brief 34 ε-2 integration test: introConsented guard で全 init 系が物理停止する.
//
// viewer-maplibre.js の dispatch logic を再現する shim を使い、 introConsented = false で
// initMapMode / initTestMode / initBleMode / bootCheckSetupStatus いずれも呼ばれず、
// 唯一 showIntroOverlay のみ呼ばれること、 ?consent=dev で物理 bypass される動作を end-to-end pin。

import { describe, it, expect } from 'vitest';
import {
  getIntroConsent, setIntroConsent, INTRO_CONSENT_LS_KEY,
} from '../lib/consent.js';

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

// viewer-maplibre.js の dispatch ロジックを再現 (= 同じ式).
// `?consent=dev` 相当を引数 devBypass で表現、 mapMode / testMode / bleMode は URL 引数の解析結果.
function createDispatcher(env) {
  const { storage, devBypass, mapMode, testMode, bleMode, spies } = env;
  return {
    introConsented() {
      if (devBypass) return true;
      return getIntroConsent({ storage }) !== null;
    },
    dispatchAfterIntro() {
      if (mapMode) spies.initMapMode();
      else if (testMode) spies.initTestMode();
      else if (bleMode) spies.initBleMode();
      else spies.bootCheckSetupStatus();
    },
    go() {
      if (this.introConsented()) this.dispatchAfterIntro();
      else spies.showIntroOverlay();
    },
  };
}

function makeSpies() {
  const rec = {
    initMapMode: 0, initTestMode: 0, initBleMode: 0,
    bootCheckSetupStatus: 0, showIntroOverlay: 0,
  };
  return {
    rec,
    initMapMode: () => { rec.initMapMode += 1; },
    initTestMode: () => { rec.initTestMode += 1; },
    initBleMode: () => { rec.initBleMode += 1; },
    bootCheckSetupStatus: () => { rec.bootCheckSetupStatus += 1; },
    showIntroOverlay: () => { rec.showIntroOverlay += 1; },
  };
}

describe('brief 34 ε-2 integration: 非 consent で全 init 系が物理停止', () => {
  it('非 consent + default 経路 → showIntroOverlay のみ、 init 系は全 0', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: false, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.showIntroOverlay).toBe(1);
    expect(spies.rec.initMapMode).toBe(0);
    expect(spies.rec.initTestMode).toBe(0);
    expect(spies.rec.initBleMode).toBe(0);
    expect(spies.rec.bootCheckSetupStatus).toBe(0);
  });

  it('非 consent + ?map=1 → showIntroOverlay のみ (= URL 引数経由でも guard を抜けない)', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.showIntroOverlay).toBe(1);
    expect(spies.rec.initMapMode).toBe(0);
  });

  it('非 consent + ?test=1 → showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: false, testMode: true, bleMode: false, spies });
    d.go();
    expect(spies.rec.showIntroOverlay).toBe(1);
    expect(spies.rec.initTestMode).toBe(0);
  });

  it('非 consent + ?ble=1 → showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: false, testMode: false, bleMode: true, spies });
    d.go();
    expect(spies.rec.showIntroOverlay).toBe(1);
    expect(spies.rec.initBleMode).toBe(0);
  });
});

describe('brief 34 ε-2 integration: ?consent=dev (= devBypass) で物理 skip', () => {
  it('?map=1&consent=dev → initMapMode が呼ばれる (= 開発者 bypass)', () => {
    const storage = memStorage();  // empty
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: true, mapMode: true, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.initMapMode).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('?test=1&consent=dev → initTestMode が呼ばれる', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: true, mapMode: false, testMode: true, bleMode: false, spies });
    d.go();
    expect(spies.rec.initTestMode).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('?ble=1&consent=dev → initBleMode が呼ばれる', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: true, mapMode: false, testMode: false, bleMode: true, spies });
    d.go();
    expect(spies.rec.initBleMode).toBe(1);
  });

  it('?consent=dev (URL flag 無し) → default 経路 (bootCheckSetupStatus) で intro skip', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: true, mapMode: false, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.bootCheckSetupStatus).toBe(1);
  });
});

describe('brief 34 ε-2 integration: consent 通過後 (= 「自分の trainer で走る」click 経由) の挙動', () => {
  it('setIntroConsent 後の default 経路 → bootCheckSetupStatus へ進む (= initBleMode 経由で Web Bluetooth scan)', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: false, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.bootCheckSetupStatus).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('setIntroConsent 後の ?map=1 → initMapMode (= 開発者 path、 normal 訪問者は到達しない)', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.initMapMode).toBe(1);
  });
});

describe('brief 34 ε-2 integration: 改竄耐性 (= hash 不一致は非 consent 扱い)', () => {
  it('hash 不一致な storage → guard を通せない (= 改竄しても自動 ride 開始しない)', () => {
    const storage = memStorage();
    storage.setItem(INTRO_CONSENT_LS_KEY, JSON.stringify({
      hash: 'forged-hash-from-attacker',
      accepted_at: '2026-05-15T00:00:00Z',
    }));
    const spies = makeSpies();
    const d = createDispatcher({ storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies });
    d.go();
    expect(spies.rec.showIntroOverlay).toBe(1);
    expect(spies.rec.initMapMode).toBe(0);
  });
});
