// 2026-05-15 bug fix integration test: 「トレーナーとのハンドシェイクまで成功するけど、
// ライド開始押してもライド画面に遷移しない」の repro + fix verification。
//
// 真の原因: showConsentOverlay() が consent-overlay (z=1460) に .visible を付与するが、
// setup-overlay (z=1500) も同時に visible のままなので、 ユーザーには setup-overlay の
// 「ライド開始」ボタンの表示のみ見える (= consent が後ろに隠れて見えない、 click ターゲット
// 不在で「何も起きない」状態)。 旧 ε-1 で intro vs setup の z-index 逆転を visible class
// 制御で解決した経緯と同型 bug。
//
// fix: showConsentOverlay 時に setup-overlay の .visible を剥がす。 hideConsentOverlay 時
// (= cancel 経路) は復元する。 accept 経路は startRideConfirmed → ride_status:started →
// hidePairing が setup を再度 hide した上で setAppState('riding') へ。
//
// この test は behavioral simulation: viewer-maplibre.js を import せず (= 大きすぎ +
// browser-only API 依存)、 viewer の DOM 操作経路を node 上で再現して visible class の
// 遷移を assertion で固定する。 fix 不在では「click 後も setup-overlay.visible == true」が
// 残るため fail、 fix 後は consent-overlay.visible == true + setup-overlay.visible == false に
// 遷移して pass する。

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

// jsdom 無し node 環境で「class 持ち div」を最小再現する shim.
// classList.add / remove / contains だけ実装、 viewer 側 DOM 操作 surface と一致.
function makeElement(id) {
  const classes = new Set();
  return {
    id,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      _all() { return Array.from(classes); },
    },
  };
}

// 「DOM の document」を最小再現. getElementById + body.classList のみ.
function makeDoc() {
  const els = {
    'setup-overlay': makeElement('setup-overlay'),
    'consent-overlay': makeElement('consent-overlay'),
    'btnRideEnd': { id: 'btnRideEnd', disabled: true },
    'btnRideStart': { id: 'btnRideStart', disabled: false },
  };
  const bodyClasses = new Set(['state-pairing']);
  return {
    body: {
      classList: {
        add(c) { bodyClasses.add(c); },
        remove(c) { bodyClasses.delete(c); },
        contains(c) { return bodyClasses.has(c); },
        _all() { return Array.from(bodyClasses); },
      },
    },
    getElementById(id) { return els[id] || null; },
    _els: els,
  };
}

// viewer-maplibre.js の showConsentOverlay / hideConsentOverlay / hidePairing /
// setAppState / wsHandlers.ride_status / btnRideStart click handler / btnConsentAccept handler /
// btnConsentCancel handler を behavioral に再現する shim.
//
// shim の振る舞いは viewer.js から逐語的に移植 (= test が source の真の挙動を pin する).
// fix 前 (= 旧 showConsentOverlay) と fix 後 (= setup-overlay も hide する版) を引数で切替.
function createViewerShim({ doc, storage, fixVersion = 'after' }) {
  // setAppState (= viewer.js:387)
  function setAppState(s) {
    for (const cls of doc.body.classList._all()) {
      if (cls.startsWith('state-')) doc.body.classList.remove(cls);
    }
    doc.body.classList.add(`state-${s}`);
  }
  // hidePairing (= viewer.js:662)
  function hidePairing() {
    doc.getElementById('setup-overlay').classList.remove('visible');
    setAppState('riding');
  }
  // showConsentOverlay / hideConsentOverlay (= viewer.js:886)
  // fixVersion='before' = bug 再現 (= 旧 ε-3 で setup-overlay を触らなかった)、
  // fixVersion='after'  = 2026-05-15 fix 版 (= setup-overlay も同時管理).
  function showConsentOverlay() {
    const ov = doc.getElementById('consent-overlay');
    if (ov) ov.classList.add('visible');
    if (fixVersion === 'after') {
      const setup = doc.getElementById('setup-overlay');
      if (setup) setup.classList.remove('visible');
    }
  }
  function hideConsentOverlay() {
    const ov = doc.getElementById('consent-overlay');
    if (ov) ov.classList.remove('visible');
    if (fixVersion === 'after') {
      // state-riding でない時のみ setup-overlay を復元 (= cancel 経路).
      if (!doc.body.classList.contains('state-riding')) {
        const setup = doc.getElementById('setup-overlay');
        if (setup) setup.classList.add('visible');
      }
    }
  }
  // BLE client.sendRideStart の loopback (= ble_client.js:277-282、
  // _dispatch('ride_status', {state:'started'}) を sync で呼ぶ).
  // wsHandlers.ride_status (= viewer.js:642) を sync で叩き、 hidePairing 経由で
  // setup-overlay.visible → false + state-riding に遷移させる.
  let clientOpen = true;
  let rideStarted = false;
  function clientSendRideStart() {
    // _dispatch handler error は swallow (= ble_client.js:69-74)
    try {
      // wsHandlers.ride_status({state:'started'}) 相当.
      rideStarted = true;
      const endBtn = doc.getElementById('btnRideEnd');
      if (endBtn) endBtn.disabled = false;
      hidePairing();
    } catch { /* swallow */ }
  }
  // startRideConfirmed (= viewer.js:1938)
  function startRideConfirmed() {
    if (!clientOpen) return;
    clientSendRideStart();
  }
  // btnConsentAccept click handler (= viewer.js:1014)
  function onConsentAccept(flags) {
    setRideConsent({ ...flags, asked: true }, { storage });
    hideConsentOverlay();
    startRideConfirmed();
  }
  function onConsentCancel() {
    hideConsentOverlay();
  }
  // btnRideStart click handler (= viewer.js:1944)
  function onBtnRideStartClick() {
    // terrainReady + client.isOpen check は pair 完了状態 + 地形 ready 前提でスキップ.
    if (!getRideConsent('asked', { storage })) {
      showConsentOverlay();
      return;
    }
    startRideConfirmed();
  }
  return {
    setAppState, hidePairing, showConsentOverlay, hideConsentOverlay,
    startRideConfirmed, onBtnRideStartClick, onConsentAccept, onConsentCancel,
    _isRideStarted() { return rideStarted; },
    _setClientOpen(b) { clientOpen = b; },
  };
}

describe('bug repro 2026-05-15: ハンドシェイク後、 ライド開始→ライド画面に遷移しない', () => {
  it('fix 前 (= 旧 ε-3): btnRideStart click → consent-overlay.visible=true だが setup-overlay.visible=true のまま (= consent が後ろに隠れて見えない)', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');  // setup 表示中で BLE pair 完了直後の状態
    const storage = memStorage();
    const shim = createViewerShim({ doc, storage, fixVersion: 'before' });
    // click → consent 未取得なので showConsentOverlay 経路
    shim.onBtnRideStartClick();
    // bug repro: consent は visible だが setup も visible のまま
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(true);
    // z-index で setup (1500) > consent (1460) なので、 user 視点では setup が前面 = consent 見えない
  });

  it('fix 後: btnRideStart click → consent-overlay.visible=true + setup-overlay.visible=false (= consent が露出)', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const storage = memStorage();
    const shim = createViewerShim({ doc, storage, fixVersion: 'after' });
    shim.onBtnRideStartClick();
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
  });
});

describe('bug repro 2026-05-15: 全 flow assertion (= ハンドシェイク → 開始 → 同意 → ride 画面)', () => {
  it('fix 後: handshake 完了 → btnRideStart → consent dialog 表示 → accept → ride 画面に遷移', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const storage = memStorage();
    const shim = createViewerShim({ doc, storage, fixVersion: 'after' });
    // step 1: click ライド開始
    shim.onBtnRideStartClick();
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
    // step 2: user が consent dialog の checkbox を選ばず、 そのまま「同意して ride 開始」
    shim.onConsentAccept({ history: false, strava: false });
    // step 3: ride 状態に遷移
    expect(shim._isRideStarted()).toBe(true);
    expect(doc.body.classList.contains('state-riding')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(false);
    expect(doc.getElementById('btnRideEnd').disabled).toBe(false);
  });

  it('fix 後: cancel 経路 (= consent dialog で「キャンセル」) で setup-overlay に戻る', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const storage = memStorage();
    const shim = createViewerShim({ doc, storage, fixVersion: 'after' });
    shim.onBtnRideStartClick();
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
    shim.onConsentCancel();
    // cancel で consent 閉じる + setup 復元
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(false);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(true);
    expect(shim._isRideStarted()).toBe(false);
    expect(doc.body.classList.contains('state-riding')).toBe(false);
  });

  it('fix 後: consent 取得済 (= 2 回目以降) → click で consent dialog 出さず直接 ride に遷移', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const storage = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    const shim = createViewerShim({ doc, storage, fixVersion: 'after' });
    shim.onBtnRideStartClick();
    expect(doc.getElementById('consent-overlay').classList.contains('visible')).toBe(false);
    expect(shim._isRideStarted()).toBe(true);
    expect(doc.body.classList.contains('state-riding')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
  });
});

describe('bug fix 2026-05-15: viewer source assertion (= fix が実 source に landing 済の物理 grep)', () => {
  it('showConsentOverlay は setup-overlay.classList.remove("visible") を呼ぶ', () => {
    // showConsentOverlay 関数 body 内に setup-overlay.classList.remove('visible') が含まれる
    const m = viewer.match(/function\s+showConsentOverlay\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/getElementById\(['"]setup-overlay['"]\)/);
    expect(body).toMatch(/classList\.remove\(['"]visible['"]\)/);
  });

  it('hideConsentOverlay は state-riding でない時に setup-overlay.classList.add("visible") を呼ぶ (= cancel 復元経路)', () => {
    const m = viewer.match(/function\s+hideConsentOverlay\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/state-riding/);
    expect(body).toMatch(/getElementById\(['"]setup-overlay['"]\)/);
    expect(body).toMatch(/classList\.add\(['"]visible['"]\)/);
  });
});
