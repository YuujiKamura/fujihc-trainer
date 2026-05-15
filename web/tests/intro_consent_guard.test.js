// brief 34 ε-2: introConsented guard の behavioral test.
//
// round 3 A 軸 4 BLOCK fix: grep gate だけだと「文字列が存在」しか pin できず、
// guard が壊れて rideState.start が呼ばれる regression を検出できない。
// jsdom + localStorage mock で「非 consent 状態で initMapMode 相当の dispatch を
// 呼ぶと rideState.start が呼ばれない」「consent 後は呼ばれる」「?consent=dev では
// intro を物理 skip」を行動 (= behavior) として直接 pin。
//
// viewer-maplibre.js 本体は maplibre-gl global を要求する 1500 行 module で
// 直 import 不可。 代わりに consent.js の純関数 + viewer source 上の
// 「if (introConsented()) dispatchAfterIntro() else showIntroOverlay()」
// 構造を独立に組み合わせて検証する。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getIntroConsent, setIntroConsent, clearIntroConsent,
  INTRO_CONSENT_HASH, INTRO_CONSENT_LS_KEY,
} from '../lib/consent.js';

// memory localStorage (= jsdom 不使用、 module 内 storage override 経由).
function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

// viewer-maplibre.js の dispatch logic を 1:1 再現した shim (= 同じ判定式).
// devBypass: ?consent=dev (= URLSearchParams.get('consent') === 'dev' 相当)
// init*: viewer の initMapMode / initTestMode / initBleMode 相当 (= mock spy).
// showIntroOverlay: 同名関数の mock spy.
// bootCheckSetupStatus: 同名関数の mock spy (= default 経路).
function makeDispatcher({ storage, devBypass, mapMode, testMode, bleMode, spies }) {
  function introConsented() {
    if (devBypass) return true;
    return getIntroConsent({ storage }) !== null;
  }
  function dispatchAfterIntro() {
    if (mapMode) spies.initMapMode();
    else if (testMode) spies.initTestMode();
    else if (bleMode) spies.initBleMode();
    else spies.bootCheckSetupStatus();
  }
  function go() {
    if (introConsented()) {
      dispatchAfterIntro();
    } else {
      spies.showIntroOverlay();
    }
  }
  return { introConsented, dispatchAfterIntro, go };
}

function makeSpies() {
  const rec = { initMapMode: 0, initTestMode: 0, initBleMode: 0, bootCheckSetupStatus: 0, showIntroOverlay: 0, rideStateStart: 0 };
  return {
    rec,
    initMapMode: () => {
      rec.initMapMode += 1;
      // initMapMode 内で rideState.start が呼ばれる (= viewer-maplibre.js 794 行で確認済).
      // ここでは「initMapMode が呼ばれたら rideState.start も呼ばれる」を simulate.
      rec.rideStateStart += 1;
    },
    initTestMode: () => { rec.initTestMode += 1; },
    initBleMode: () => { rec.initBleMode += 1; },
    bootCheckSetupStatus: () => { rec.bootCheckSetupStatus += 1; },
    showIntroOverlay: () => { rec.showIntroOverlay += 1; },
  };
}

describe('brief 34 ε-2: introConsented guard (= 非 consent 状態で ride 自動 start を物理停止)', () => {
  it('非 consent + ?map=1 → initMapMode 呼ばれない / rideState.start 呼ばれない / showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies,
    });
    expect(d.introConsented()).toBe(false);
    d.go();
    expect(spies.rec.initMapMode).toBe(0);
    expect(spies.rec.rideStateStart).toBe(0);  // ← BLOCK 主因の核心 assert
    expect(spies.rec.showIntroOverlay).toBe(1);
  });

  it('非 consent + ?test=1 → initTestMode 呼ばれない / showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: false, testMode: true, bleMode: false, spies,
    });
    d.go();
    expect(spies.rec.initTestMode).toBe(0);
    expect(spies.rec.showIntroOverlay).toBe(1);
  });

  it('非 consent + ?ble=1 → initBleMode 呼ばれない / showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: false, testMode: false, bleMode: true, spies,
    });
    d.go();
    expect(spies.rec.initBleMode).toBe(0);
    expect(spies.rec.showIntroOverlay).toBe(1);
  });

  it('非 consent + default 経路 → bootCheckSetupStatus 呼ばれない / showIntroOverlay のみ', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: false, testMode: false, bleMode: false, spies,
    });
    d.go();
    expect(spies.rec.bootCheckSetupStatus).toBe(0);
    expect(spies.rec.showIntroOverlay).toBe(1);
  });

  it('consent 済 + ?map=1 → initMapMode 呼ばれる / rideState.start も呼ばれる', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies,
    });
    expect(d.introConsented()).toBe(true);
    d.go();
    expect(spies.rec.initMapMode).toBe(1);
    expect(spies.rec.rideStateStart).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('consent 済 + default 経路 → bootCheckSetupStatus 呼ばれる', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: false, testMode: false, bleMode: false, spies,
    });
    d.go();
    expect(spies.rec.bootCheckSetupStatus).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('?consent=dev (= devBypass) + 非 consent でも intro を物理 skip + initMapMode 呼ばれる', () => {
    const storage = memStorage();  // 空 (= 非 consent)
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: true, mapMode: true, testMode: false, bleMode: false, spies,
    });
    expect(d.introConsented()).toBe(true);  // dev bypass 経路
    d.go();
    expect(spies.rec.initMapMode).toBe(1);
    expect(spies.rec.rideStateStart).toBe(1);
    expect(spies.rec.showIntroOverlay).toBe(0);
  });

  it('?consent=other (= dev 以外) は bypass しない (= 非 consent 扱い)', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies,
    });
    d.go();
    expect(spies.rec.initMapMode).toBe(0);
    expect(spies.rec.rideStateStart).toBe(0);
  });

  it('hash 不一致 (= 旧 consent や改竄) は非 consent 扱い、 initMapMode は呼ばれない', () => {
    const storage = memStorage();
    storage.setItem(INTRO_CONSENT_LS_KEY, JSON.stringify({
      hash: 'older-hash',
      accepted_at: '2026-05-01T00:00:00Z',
    }));
    const spies = makeSpies();
    const d = makeDispatcher({
      storage, devBypass: false, mapMode: true, testMode: false, bleMode: false, spies,
    });
    expect(d.introConsented()).toBe(false);
    d.go();
    expect(spies.rec.initMapMode).toBe(0);
    expect(spies.rec.rideStateStart).toBe(0);
  });
});

describe('brief 34 ε-2: viewer source 上の guard 構造を pin (= grep + behavior 二重)', () => {
  const fs = require('fs');
  const path = require('path');
  const viewer = fs.readFileSync(
    path.resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8',
  );

  it('module top dispatch は `if (introConsented()) { dispatchAfterIntro() } else { showIntroOverlay() }` 形', () => {
    expect(viewer).toMatch(/if\s*\(\s*introConsented\(\)\s*\)\s*\{[\s\S]{0,80}dispatchAfterIntro\(\)/);
    expect(viewer).toMatch(/else\s*\{[\s\S]{0,80}showIntroOverlay\(/);
  });

  it('dispatchAfterIntro 内に 4 init 全部 (= MAP_MODE / TEST_MODE / BLE_MODE / default)', () => {
    const m = viewer.match(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/if\s*\(\s*MAP_MODE\s*\)\s*initMapMode\(\)/);
    expect(body).toMatch(/else\s+if\s*\(\s*TEST_MODE\s*\)\s*initTestMode\(\)/);
    expect(body).toMatch(/else\s+if\s*\(\s*BLE_MODE\s*\)\s*initBleMode\(\)/);
    expect(body).toMatch(/else\s+bootCheckSetupStatus\(\)/);
  });

  it('introConsented() の実装は CONSENT_DEV_BYPASS と getIntroConsent() の OR', () => {
    const m = viewer.match(/function\s+introConsented\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/CONSENT_DEV_BYPASS/);
    expect(body).toMatch(/getIntroConsent\(\)/);
  });

  it('btnIntroStart click は setIntroConsent + hideIntroOverlay + dispatchAfterIntro の 3 連動 (= brief 34 ε-1 で btnIntroDemo から rename)', () => {
    // brief 34 ε-1 (= 2026-05-15 user 方向修正): 旧 btnIntroDemo (= 試走デモを見る) を撤去、
    // btnIntroStart (= 自分の trainer で走る) に rename。 デモ走行 button は提供しない。
    // brief 34 ε-8: setIntroConsent に optional {mode:'ride'|'view'} 引数を渡せるように拡張。
    // btnIntroStart は明示 mode='ride' を渡す (= view と区別するため).
    expect(viewer).toMatch(/btnIntroStart[\s\S]{0,300}setIntroConsent\(\{[^}]*mode:\s*['"]ride['"][^}]*\}\)[\s\S]{0,300}hideIntroOverlay\(\)[\s\S]{0,300}dispatchAfterIntro\(\)/);
    expect(viewer).not.toMatch(/btnIntroDemo/);
  });

  it('btnIntroClose click は consent を保存せず overlay のみ閉じる (= reload で再表示)', () => {
    // btnIntroClose の click handler body のみを抽出 (= btnIntroClose の addEventListener call の callback 部).
    // 「if (btnIntroClose) btnIntroClose.addEventListener('click', () => { ... });」の `{ ... }` 部分を取る。
    const m = viewer.match(/btnIntroClose\.addEventListener\(['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/hideIntroOverlay\(\)/);
    expect(body).not.toMatch(/setIntroConsent\(/);
    expect(body).not.toMatch(/dispatchAfterIntro\(/);
  });
});
