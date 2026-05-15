// brief 34 ε-3: ride consent guard (= btnRideStart の click 経路 + IndexedDB / Strava の consent flag 連動).
//
// viewer-maplibre.js の click handler は maplibre-gl global を要求するため直 import 不可、
// 代わりに「click 経路の判定式 + setRideConsent → 再 click で発火」 を pure JS で再現 + viewer source の構造を grep で pin する 2 軸テスト.

import { describe, it, expect } from 'vitest';
import {
  setRideConsent, getRideConsent, clearRideConsent,
  RIDE_CONSENT_HASH, RIDE_CONSENT_LS_KEY,
} from '../lib/consent.js';

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

// viewer-maplibre.js の btnRideStart click 経路を再現する shim.
// click → consent 未取得 (asked false) なら showConsentOverlay + return、 取得済なら startRideConfirmed。
function makeBtnRideStartHandler({ storage, spies, clientOpen }) {
  return function onClick() {
    if (!clientOpen) return;
    if (!getRideConsent('asked', { storage })) {
      spies.showConsentOverlay();
      return;
    }
    spies.startRideConfirmed();
  };
}

// viewer-maplibre.js の addRide callback (= bindPostRideButtons の addRide).
// history consent OFF なら no-op (= status のみ)、 ON なら rideDbAdd 呼出.
function makeAddRideCallback({ storage, spies }) {
  return async function addRide(rec) {
    if (!getRideConsent('history', { storage })) {
      spies.setPostrideStatus('history off');
      return;
    }
    await spies.rideDbAdd(rec);
  };
}

// getClientId callback: strava consent OFF なら null、 ON なら getStravaClientId().
function makeGetClientIdCallback({ storage, spies }) {
  return function getClientId() {
    if (!getRideConsent('strava', { storage })) return null;
    return spies.getStravaClientId();
  };
}

function makeSpies() {
  const rec = {
    showConsentOverlay: 0,
    startRideConfirmed: 0,
    setPostrideStatus: 0,
    rideDbAdd: 0,
    getStravaClientId: 0,
  };
  return {
    rec,
    showConsentOverlay: () => { rec.showConsentOverlay += 1; },
    startRideConfirmed: () => { rec.startRideConfirmed += 1; },
    setPostrideStatus: (text) => { rec.setPostrideStatus += 1; rec.lastStatus = text; },
    rideDbAdd: async () => { rec.rideDbAdd += 1; },
    getStravaClientId: () => { rec.getStravaClientId += 1; return 'fake-client-id'; },
  };
}

describe('brief 34 ε-3: btnRideStart click guard (= consent 未取得なら ride 開始しない)', () => {
  it('consent 未取得 (= asked false) + client open → showConsentOverlay のみ、 startRideConfirmed は呼ばれない', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const onClick = makeBtnRideStartHandler({ storage, spies, clientOpen: true });
    onClick();
    expect(spies.rec.showConsentOverlay).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
  });

  it('consent 済 (= asked true、 全 flag OFF でも asked のみで通過) → startRideConfirmed のみ', () => {
    const storage = memStorage();
    setRideConsent({ history: false, strava: false, asked: true }, { storage });
    const spies = makeSpies();
    const onClick = makeBtnRideStartHandler({ storage, spies, clientOpen: true });
    onClick();
    expect(spies.rec.showConsentOverlay).toBe(0);
    expect(spies.rec.startRideConfirmed).toBe(1);
  });

  it('consent 未取得 + client closed → return early、 showConsentOverlay も呼ばれない', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const onClick = makeBtnRideStartHandler({ storage, spies, clientOpen: false });
    onClick();
    expect(spies.rec.showConsentOverlay).toBe(0);
    expect(spies.rec.startRideConfirmed).toBe(0);
  });

  it('consent flow: 1 回目 click で overlay、 setRideConsent → 2 回目 click で ride 開始', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const onClick = makeBtnRideStartHandler({ storage, spies, clientOpen: true });
    onClick();
    expect(spies.rec.showConsentOverlay).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
    // user が consent を accept (= viewer の btnConsentAccept handler 相当)
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    onClick();
    expect(spies.rec.showConsentOverlay).toBe(1);  // 増えない
    expect(spies.rec.startRideConfirmed).toBe(1);
  });
});

describe('brief 34 ε-3: addRide callback の history consent guard', () => {
  it('history consent OFF → rideDbAdd 呼ばれない、 status のみ', async () => {
    const storage = memStorage();
    const spies = makeSpies();
    const addRide = makeAddRideCallback({ storage, spies });
    await addRide({ id: 'r1', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(spies.rec.rideDbAdd).toBe(0);
    expect(spies.rec.setPostrideStatus).toBe(1);
  });

  it('history consent ON → rideDbAdd 呼ばれる', async () => {
    const storage = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    const spies = makeSpies();
    const addRide = makeAddRideCallback({ storage, spies });
    await addRide({ id: 'r2', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(spies.rec.rideDbAdd).toBe(1);
    expect(spies.rec.setPostrideStatus).toBe(0);
  });

  it('asked=true でも history=false なら addRide は no-op (= 個別 flag check が効く)', async () => {
    const storage = memStorage();
    setRideConsent({ history: false, strava: true, asked: true }, { storage });
    const spies = makeSpies();
    const addRide = makeAddRideCallback({ storage, spies });
    await addRide({ id: 'r3', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(spies.rec.rideDbAdd).toBe(0);
  });
});

describe('brief 34 ε-3: getClientId callback の strava consent guard', () => {
  it('strava consent OFF → null を返す (= postride_buttons.js 側で「client_id 未設定」status)', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const getClientId = makeGetClientIdCallback({ storage, spies });
    expect(getClientId()).toBe(null);
    expect(spies.rec.getStravaClientId).toBe(0);
  });

  it('strava consent ON → getStravaClientId() の値を返す', () => {
    const storage = memStorage();
    setRideConsent({ history: false, strava: true, asked: true }, { storage });
    const spies = makeSpies();
    const getClientId = makeGetClientIdCallback({ storage, spies });
    expect(getClientId()).toBe('fake-client-id');
    expect(spies.rec.getStravaClientId).toBe(1);
  });
});

describe('brief 34 ε-3: viewer source 上の guard 構造を pin', () => {
  const fs = require('fs');
  const path = require('path');
  const viewer = fs.readFileSync(
    path.resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8',
  );

  it('btnRideStart の click handler に getRideConsent("asked") guard あり', () => {
    expect(viewer).toMatch(/btnRideStart[\s\S]{0,500}getRideConsent\(['"]asked['"]\)[\s\S]{0,200}showConsentOverlay\(/);
  });

  it('showConsentOverlay / hideConsentOverlay 関数が定義済', () => {
    expect(viewer).toMatch(/function\s+showConsentOverlay\s*\(\s*\)/);
    expect(viewer).toMatch(/function\s+hideConsentOverlay\s*\(\s*\)/);
  });

  it('btnConsentAccept 経路で setRideConsent + startRideConfirmed を呼ぶ', () => {
    expect(viewer).toMatch(/btnConsentAccept[\s\S]{0,800}setRideConsent\(\s*\{[\s\S]{0,200}asked:\s*true[\s\S]{0,500}startRideConfirmed\(\)/);
  });

  it('btnConsentCancel 経路は何も保存せず overlay のみ閉じる', () => {
    const m = viewer.match(/btnConsentCancel\.addEventListener\(['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/hideConsentOverlay\(\)/);
    expect(body).not.toMatch(/setRideConsent\(/);
    expect(body).not.toMatch(/startRideConfirmed\(/);
  });

  it('btnConfirmDemo (= デモ走行) は consent 不要、 旧 handler から変化なし', () => {
    // demo 経路は v3 設計通り、 consent overlay を経由せず rideState.start を直接呼ぶ.
    expect(viewer).toMatch(/btnConfirmDemo[\s\S]{0,400}rideState\.start\(\)/);
    // btnConfirmDemo の handler 内に getRideConsent / showConsentOverlay 呼出が無い (= demo declaration).
    // 実装は `getElementById('btnConfirmDemo').addEventListener('click', () => { ... });` の形.
    const m = viewer.match(/getElementById\(['"]btnConfirmDemo['"]\)\.addEventListener\(['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).not.toMatch(/getRideConsent\(/);
    expect(body).not.toMatch(/showConsentOverlay\(/);
  });

  it('bindPostRideButtons の addRide callback は getRideConsent("history") で guard', () => {
    expect(viewer).toMatch(/addRide:\s*async[\s\S]{0,400}getRideConsent\(['"]history['"]\)/);
  });

  it('bindPostRideButtons の getClientId callback は getRideConsent("strava") で guard', () => {
    expect(viewer).toMatch(/getClientId:\s*\(\)\s*=>\s*\{[\s\S]{0,200}getRideConsent\(['"]strava['"]\)/);
  });

  it('updatePostrideButtonVisibility 関数が定義済 (= consent flag に追随)', () => {
    expect(viewer).toMatch(/function\s+updatePostrideButtonVisibility\s*\(\s*\)/);
    const m = viewer.match(/function\s+updatePostrideButtonVisibility\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/getRideConsent\(['"]history['"]\)/);
    expect(m[0]).toMatch(/getRideConsent\(['"]strava['"]\)/);
  });
});

describe('brief 34 ε-3: index.html consent-overlay の DOM 構造', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  it('consent-overlay 内に <input type="checkbox" id="chkConsentHistory"> がある', () => {
    expect(html).toMatch(/<input\s+type="checkbox"\s+id="chkConsentHistory"/);
  });

  it('consent-overlay 内に <input type="checkbox" id="chkConsentStrava"> がある', () => {
    expect(html).toMatch(/<input\s+type="checkbox"\s+id="chkConsentStrava"/);
  });

  it('consent-overlay の z-index は 1460 (= setup 1500 / intro 1450 の間)', () => {
    expect(html).toMatch(/#consent-overlay\s*\{[^}]*z-index:\s*1460/);
  });

  it('intro-overlay (z=1450) < consent-overlay (z=1460) < setup-overlay (z=1500) の階層順', () => {
    expect(html).toMatch(/#intro-overlay\s*\{[^}]*z-index:\s*1450/);
    expect(html).toMatch(/#consent-overlay\s*\{[^}]*z-index:\s*1460/);
    expect(html).toMatch(/#setup-overlay\s*\{[\s\S]*?z-index:\s*1500/);
  });
});
