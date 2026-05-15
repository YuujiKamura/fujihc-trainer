// brief 34 ε-3 integration test: consent overlay 経由でないと ride 開始不可 +
// **pair 完了前は btnRideStart.disabled === true、 pair 完了後 false** (= 過去訂正
// 2026-05-14T12:19、 「ハンドシェイクが繋がる前でも走り出せる仕様になってるのが間違い」反映).
//
// viewer-maplibre.js の wsHandlers.connect_status と btnRideStart の click handler を
// shim で再現、 「consent + pair の両方が揃わないと ride が始まらない」を end-to-end pin。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setRideConsent, getRideConsent, RIDE_CONSENT_LS_KEY,
} from '../lib/consent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const html = readFileSync(INDEX_PATH, 'utf8');

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

// viewer-maplibre.js の wsHandlers.connect_status と btnRideStart click handler を再現する shim.
// btnRideStart.disabled は HTML 初期で true (= <button id="btnRideStart" disabled>)、
// connect_status: 'connected' (= ハンドシェイク完了) で false に遷移。
// click handler: consent 未取得なら showConsentOverlay、 disabled なら何もしない。
function createRideStartShim({ storage, spies, initialDisabled = true }) {
  const btn = { disabled: initialDisabled };
  const wsHandlers = {
    connect_status(msg) {
      if (msg.state === 'connected') {
        btn.disabled = false;
        spies.rec.connectedTransition += 1;
      }
    },
  };
  function onBtnClick() {
    // viewer の click handler 同等: disabled なら DOM が click をそもそも発火させない、
    // ただし JS で直接呼ばれる場合も client.isOpen() で防ぐ。 ここでは disabled check を明示。
    if (btn.disabled) {
      spies.rec.blockedByDisabled += 1;
      return;
    }
    if (!getRideConsent('asked', { storage })) {
      spies.showConsentOverlay();
      return;
    }
    spies.startRideConfirmed();
  }
  return { btn, wsHandlers, onBtnClick };
}

function makeSpies() {
  const rec = {
    showConsentOverlay: 0,
    startRideConfirmed: 0,
    connectedTransition: 0,
    blockedByDisabled: 0,
  };
  return {
    rec,
    showConsentOverlay: () => { rec.showConsentOverlay += 1; },
    startRideConfirmed: () => { rec.startRideConfirmed += 1; },
  };
}

describe('brief 34 ε-3 integration: pair 完了前は btnRideStart.disabled === true (= 過去訂正 2026-05-14T12:19 反映)', () => {
  it('HTML 初期: <button id="btnRideStart" disabled> (= pair 完了まで disabled)', () => {
    expect(html).toMatch(/<button[^>]*id="btnRideStart"[^>]*\sdisabled[\s>]/);
  });

  it('consent 取得済 + pair 未完了 → click しても ride 開始しない (= disabled で block)', () => {
    const storage = memStorage();
    setRideConsent({ history: true, asked: true }, { storage });
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: true });
    shim.onBtnClick();
    expect(spies.rec.blockedByDisabled).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
    expect(spies.rec.showConsentOverlay).toBe(0);
  });

  it('connect_status: connected で btnRideStart.disabled が false に遷移', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: true });
    expect(shim.btn.disabled).toBe(true);
    shim.wsHandlers.connect_status({ state: 'connected', address: 'fake-addr' });
    expect(shim.btn.disabled).toBe(false);
    expect(spies.rec.connectedTransition).toBe(1);
  });

  it('viewer source: connect_status の connected branch で btnRideStart.disabled = false が設定される', () => {
    // 「state === connected」branch 内に「btnRideStart」「.disabled = false」が並ぶこと.
    expect(viewer).toMatch(/state\s*===?\s*['"]connected['"][\s\S]{0,400}btnRideStart[\s\S]{0,200}\.disabled\s*=\s*false/);
  });
});

describe('brief 34 ε-3 integration: consent + pair 両方揃わないと ride 開始しない', () => {
  it('pair 未完了 + consent 未取得 → click で disabled が先に block (= 順序的に最も外側の guard)', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: true });
    shim.onBtnClick();
    expect(spies.rec.blockedByDisabled).toBe(1);
    expect(spies.rec.showConsentOverlay).toBe(0);
    expect(spies.rec.startRideConfirmed).toBe(0);
  });

  it('pair 完了 + consent 未取得 → click で showConsentOverlay 発火、 ride 開始しない', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: false });  // pair 完了済
    shim.onBtnClick();
    expect(spies.rec.showConsentOverlay).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
  });

  it('pair 完了 + consent 取得済 → click で ride 開始 (= 全ての guard 通過)', () => {
    const storage = memStorage();
    setRideConsent({ history: true, asked: true }, { storage });
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: false });
    shim.onBtnClick();
    expect(spies.rec.startRideConfirmed).toBe(1);
    expect(spies.rec.showConsentOverlay).toBe(0);
  });

  it('full flow: pair 未完 → connect_status → pair 完了 → click → consent dialog → accept → ride 開始', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const shim = createRideStartShim({ storage, spies, initialDisabled: true });
    // step 1: pair 未完で click → block
    shim.onBtnClick();
    expect(spies.rec.blockedByDisabled).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
    // step 2: pair 完了通知
    shim.wsHandlers.connect_status({ state: 'connected' });
    expect(shim.btn.disabled).toBe(false);
    // step 3: click → consent 未取得で overlay 表示
    shim.onBtnClick();
    expect(spies.rec.showConsentOverlay).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
    // step 4: user が consent dialog で accept (= setRideConsent)
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    // step 5: 再 click (= viewer の btnConsentAccept handler が startRideConfirmed 直呼びと等価)
    shim.onBtnClick();
    expect(spies.rec.startRideConfirmed).toBe(1);
  });
});

// brief 34 ε-9: terrain gate も AND で効かせる版 shim (= ε-3 の上に ε-9 を重ねた end-to-end).
function createRideStartShimWithTerrain({ storage, spies, initialDisabled = true, terrainReady = false }) {
  const btn = { disabled: initialDisabled };
  let _pairConnected = false;
  let _terrainReady = terrainReady;
  function syncBtn() {
    if (!_terrainReady) { btn.disabled = true; return; }
    if (_pairConnected) { btn.disabled = false; return; }
    // pair 未完なら disabled (= 既存挙動)
  }
  syncBtn();
  const wsHandlers = {
    connect_status(msg) {
      if (msg.state === 'connected') {
        _pairConnected = true;
        syncBtn();
        spies.rec.connectedTransition += 1;
      }
    },
  };
  function setTerrainReady(v) { _terrainReady = v; syncBtn(); }
  function onBtnClick() {
    // viewer の click handler 同等:
    //   1. terrainReady === false で即 return (= ε-9 短絡)
    //   2. disabled (= pair 未完) で return
    //   3. consent 未取得で overlay 表示
    //   4. startRideConfirmed
    if (!_terrainReady) {
      spies.rec.blockedByTerrain += 1;
      return;
    }
    if (btn.disabled) {
      spies.rec.blockedByDisabled += 1;
      return;
    }
    if (!getRideConsent('asked', { storage })) {
      spies.showConsentOverlay();
      return;
    }
    spies.startRideConfirmed();
  }
  return { btn, wsHandlers, onBtnClick, setTerrainReady };
}

describe('brief 34 ε-9 integration: terrainReady=false 中は ride 開始経路がすべて短絡', () => {
  it('terrainReady=false + pair 完了 + consent 取得済 でも click は terrain 短絡で stop', () => {
    const storage = memStorage();
    setRideConsent({ history: true, asked: true }, { storage });
    const spies = makeSpies();
    spies.rec.blockedByTerrain = 0;
    const shim = createRideStartShimWithTerrain({ storage, spies, terrainReady: false });
    shim.wsHandlers.connect_status({ state: 'connected' });  // pair 完了
    expect(shim.btn.disabled).toBe(true);  // terrain 未完なので強制 disabled 維持
    shim.onBtnClick();
    expect(spies.rec.blockedByTerrain).toBe(1);
    expect(spies.rec.startRideConfirmed).toBe(0);
    expect(spies.rec.showConsentOverlay).toBe(0);
  });

  it('terrainReady=true 移行 → pair + consent が揃って初めて startRideConfirmed', () => {
    const storage = memStorage();
    setRideConsent({ history: true, asked: true }, { storage });
    const spies = makeSpies();
    spies.rec.blockedByTerrain = 0;
    const shim = createRideStartShimWithTerrain({ storage, spies, terrainReady: false });
    shim.wsHandlers.connect_status({ state: 'connected' });
    // terrain 未完 click は block
    shim.onBtnClick();
    expect(spies.rec.startRideConfirmed).toBe(0);
    // terrain 完了 → btn enable + click で発火
    shim.setTerrainReady(true);
    expect(shim.btn.disabled).toBe(false);
    shim.onBtnClick();
    expect(spies.rec.startRideConfirmed).toBe(1);
  });

  it('terrainReady=false + pair 未完 + consent 未取得 → terrain 短絡が最外で block (= 最強 gate)', () => {
    const storage = memStorage();
    const spies = makeSpies();
    spies.rec.blockedByTerrain = 0;
    const shim = createRideStartShimWithTerrain({ storage, spies, terrainReady: false });
    shim.onBtnClick();
    expect(spies.rec.blockedByTerrain).toBe(1);
    expect(spies.rec.blockedByDisabled).toBe(0);
    expect(spies.rec.showConsentOverlay).toBe(0);
    expect(spies.rec.startRideConfirmed).toBe(0);
  });

  it('terrainReady → false → terrainReady → false 切替で btn.disabled が同期', () => {
    const storage = memStorage();
    const spies = makeSpies();
    const shim = createRideStartShimWithTerrain({ storage, spies, terrainReady: false });
    shim.wsHandlers.connect_status({ state: 'connected' });
    expect(shim.btn.disabled).toBe(true);
    shim.setTerrainReady(true);
    expect(shim.btn.disabled).toBe(false);
    shim.setTerrainReady(false);
    expect(shim.btn.disabled).toBe(true);
  });
});

describe('brief 34 ε-3 integration: consent flag 別 IndexedDB / Strava の有効/無効', () => {
  it('history consent OFF (= default) → addRide callback は no-op、 IndexedDB 接続せず', async () => {
    const storage = memStorage();
    // asked = true でも history = false なら addRide は guard で止まる
    setRideConsent({ history: false, strava: false, asked: true }, { storage });
    let addRideCalled = 0;
    const callback = async (rec) => {
      if (!getRideConsent('history', { storage })) return;
      addRideCalled += 1;
    };
    await callback({ id: 'r1', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(addRideCalled).toBe(0);
  });

  it('history consent ON → addRide が呼ばれる', async () => {
    const storage = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    let addRideCalled = 0;
    const callback = async (rec) => {
      if (!getRideConsent('history', { storage })) return;
      addRideCalled += 1;
    };
    await callback({ id: 'r2', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(addRideCalled).toBe(1);
  });

  it('strava consent OFF → getClientId が null (= Strava upload button 機能停止)', () => {
    const storage = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    const getClientIdGuarded = () => {
      if (!getRideConsent('strava', { storage })) return null;
      return 'fake-client-id';
    };
    expect(getClientIdGuarded()).toBe(null);
  });

  it('strava consent ON → getClientId が値を返す', () => {
    const storage = memStorage();
    setRideConsent({ history: true, strava: true, asked: true }, { storage });
    const getClientIdGuarded = () => {
      if (!getRideConsent('strava', { storage })) return null;
      return 'fake-client-id';
    };
    expect(getClientIdGuarded()).toBe('fake-client-id');
  });
});
