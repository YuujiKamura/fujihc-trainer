// bug fix 2026-05-17 integration test: 「ハンドシェイク完了後、 ライド開始が機能しない」の
// repro + fix verification。 観測症状は 2 つ:
//   (A) 「▶ライド開始」ボタンは緑 (= enabled) なのに、 直下の無効時説明文
//       「trainer のハンドシェイク完了後に押せるようになります」が消えずに残る。
//   (B) ボタンをクリックしても ride が始まらない。
//
// 真の原因:
//   (A) 説明文が id 無しの静的 <div> で、 ボタン enable 経路 (connect_status /
//       updateActionButtonsForTerrain / initTestMode) は btnRideStart.disabled しか
//       書き換えず説明文を触らない → ボタンと説明文が永久にちぐはぐ。
//   (B) click → showPreflightAndStart → renderPreflightPanel が preflight-overlay
//       (z=1465) に .visible を付けるが、 setup-overlay (z=1500) が visible のまま。
//       preflight が完全に背後に隠れ、 click ターゲット不在で「何も起きない」。
//       = consent-overlay の 2026-05-15 ε-3 fix と同型 bug、 preflight 統合時に
//       同じ z-order ミスが再混入した。
//
// fix:
//   (A) 説明文に id="ride-start-hint" を付与。 単一窓口 setRideStartEnabled(enabled) が
//       btnRideStart.disabled と hint.hidden を必ず同期して書き換える。
//   (B) showPreflightAndStart が preflight 表示時に setup-overlay の .visible を剥がす。
//       onCancel (= キャンセル経路) は state-riding でなければ setup-overlay を復元する。
//
// behavioral shim は viewer の DOM 操作経路を node 上で再現、 加えて source 直 grep で
// fix が実 source に landing 済かを物理確認する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const viewer = readFileSync(resolve(__dirname, '..', 'viewer-map3d.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

// class 持ち div の最小 shim (= integration_ble_ride_start.test.js と同形).
function makeOverlay(id) {
  const classes = new Set();
  return {
    id,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
    },
  };
}

// btnRideStart と hint を持つ最小 document shim.
function makeDoc() {
  const els = {
    'setup-overlay': makeOverlay('setup-overlay'),
    'preflight-overlay': makeOverlay('preflight-overlay'),
    'btnRideStart': { id: 'btnRideStart', disabled: true },
    'ride-start-hint': { id: 'ride-start-hint', hidden: false },
  };
  const bodyClasses = new Set(['state-pairing']);
  return {
    body: {
      classList: {
        add(c) { bodyClasses.add(c); },
        remove(c) { bodyClasses.delete(c); },
        contains(c) { return bodyClasses.has(c); },
      },
    },
    getElementById(id) { return els[id] || null; },
    _els: els,
  };
}

// viewer-map3d.js の setRideStartEnabled / connect_status connected branch /
// showPreflightAndStart の overlay 管理を逐語的に再現する shim。
function createViewerShim({ doc }) {
  // setRideStartEnabled (= viewer.js: btnRideStart.disabled と #ride-start-hint.hidden の単一窓口).
  function setRideStartEnabled(enabled) {
    const btn = doc.getElementById('btnRideStart');
    if (btn) btn.disabled = !enabled;
    const hint = doc.getElementById('ride-start-hint');
    if (hint) hint.hidden = !!enabled;
  }
  // connect_status('connected') の btnRideStart 制御部 (= terrainReady で enable 判定).
  function onHandshakeComplete(terrainReady) {
    setRideStartEnabled(terrainReady);
  }
  let startRideConfirmedCalls = 0;
  // showPreflightAndStart の overlay 管理部 (= renderPreflightPanel 呼出 + setup-overlay hide).
  function showPreflightAndStart() {
    // renderPreflightPanel が preflight-overlay に .visible を付与する相当.
    doc.getElementById('preflight-overlay').classList.add('visible');
    // preflight-overlay (z=1465) を露出させるため setup-overlay (z=1500) を hide.
    doc.getElementById('setup-overlay').classList.remove('visible');
  }
  // preflight panel の「キャンセル」 (= onCancel).
  function onPreflightCancel() {
    doc.getElementById('preflight-overlay').classList.remove('visible');
    if (!doc.body.classList.contains('state-riding')) {
      doc.getElementById('setup-overlay').classList.add('visible');
    }
  }
  // preflight panel の「開始する」 (= onStart → startRideConfirmed).
  function onPreflightStart() {
    doc.getElementById('preflight-overlay').classList.remove('visible');
    startRideConfirmedCalls += 1;
  }
  return {
    setRideStartEnabled, onHandshakeComplete,
    showPreflightAndStart, onPreflightCancel, onPreflightStart,
    _startRideConfirmedCalls() { return startRideConfirmedCalls; },
  };
}

describe('bug fix 2026-05-17 (A): ライド開始ボタンの hint 文がボタン state と同期する', () => {
  it('初期 (= ハンドシェイク前): btnRideStart.disabled=true、 hint 表示 (hidden=false)', () => {
    const doc = makeDoc();
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
  });

  it('setRideStartEnabled(true) で btn 有効化 + hint が消える (hidden=true)', () => {
    const doc = makeDoc();
    const shim = createViewerShim({ doc });
    shim.setRideStartEnabled(true);
    expect(doc.getElementById('btnRideStart').disabled).toBe(false);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(true);
  });

  it('setRideStartEnabled(false) で btn 無効化 + hint が再表示 (hidden=false)', () => {
    const doc = makeDoc();
    const shim = createViewerShim({ doc });
    shim.setRideStartEnabled(true);
    shim.setRideStartEnabled(false);
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
  });

  it('ハンドシェイク完了 (terrainReady=true) で「ボタン緑なのに hint 残り」が起きない', () => {
    const doc = makeDoc();
    const shim = createViewerShim({ doc });
    shim.onHandshakeComplete(true);
    // ボタン緑 (= enabled) と hint 非表示が必ず一致する (= ちぐはぐ解消).
    expect(doc.getElementById('btnRideStart').disabled).toBe(false);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(true);
  });

  it('ハンドシェイク完了でも terrain 未完なら btn 無効 + hint 表示が一致', () => {
    const doc = makeDoc();
    const shim = createViewerShim({ doc });
    shim.onHandshakeComplete(false);
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
  });
});

describe('bug fix 2026-05-17 (B): ライド開始 click で preflight が setup の背後に隠れない', () => {
  it('handshake → click → preflight 表示時に setup-overlay.visible が剥がれる (= preflight 露出)', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');  // pairing 画面表示中
    const shim = createViewerShim({ doc });
    shim.onHandshakeComplete(true);
    shim.showPreflightAndStart();
    expect(doc.getElementById('preflight-overlay').classList.contains('visible')).toBe(true);
    // setup-overlay (z=1500) が hide されて初めて preflight (z=1465) が前面に出る.
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
  });

  it('preflight キャンセル → setup-overlay が復元 (= pair 画面に戻れる)', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const shim = createViewerShim({ doc });
    shim.showPreflightAndStart();
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
    shim.onPreflightCancel();
    expect(doc.getElementById('preflight-overlay').classList.contains('visible')).toBe(false);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(true);
  });

  it('preflight 開始 → startRideConfirmed 発火、 ride 中なら setup-overlay は復元しない', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const shim = createViewerShim({ doc });
    shim.showPreflightAndStart();
    shim.onPreflightStart();
    expect(shim._startRideConfirmedCalls()).toBe(1);
    // ride 開始後に state-riding なら cancel 経路でも setup を復元しない.
    doc.body.classList.add('state-riding');
    shim.onPreflightCancel();
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
  });

  it('full flow: ハンドシェイク完了 → ボタン有効化 → click → preflight 露出 → 開始 → ride', () => {
    const doc = makeDoc();
    doc.getElementById('setup-overlay').classList.add('visible');
    const shim = createViewerShim({ doc });
    // step 1: ハンドシェイク完了 → ボタン緑 + hint 消え
    shim.onHandshakeComplete(true);
    expect(doc.getElementById('btnRideStart').disabled).toBe(false);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(true);
    // step 2: click → preflight 露出 (setup が背後に隠れない)
    shim.showPreflightAndStart();
    expect(doc.getElementById('preflight-overlay').classList.contains('visible')).toBe(true);
    expect(doc.getElementById('setup-overlay').classList.contains('visible')).toBe(false);
    // step 3: 開始 → ride
    shim.onPreflightStart();
    expect(shim._startRideConfirmedCalls()).toBe(1);
  });
});

describe('bug fix 2026-05-17 (A): terrain gate 経路 (updateActionButtonsForTerrain) でも hint が同期する', () => {
  // updateActionButtonsForTerrain は ride start を setRideStartEnabled(isActionableNow() &&
  // _pairConnected) に通す。 isActionableNow() = terrainReady && mapFullyLoaded。
  // この経路でも btnRideStart.disabled と hint.hidden が必ず一致することを pin。
  function applyTerrainGate(doc, { terrainReady, mapFullyLoaded, pairConnected }) {
    const enabled = (terrainReady && mapFullyLoaded) && pairConnected;
    const btn = doc.getElementById('btnRideStart');
    if (btn) btn.disabled = !enabled;
    const hint = doc.getElementById('ride-start-hint');
    if (hint) hint.hidden = !!enabled;
  }

  it('pair 完了後に terrain が done → ボタン有効化 + hint が消える', () => {
    const doc = makeDoc();
    // pair 完了済だが terrain 未完: disabled + hint 表示
    applyTerrainGate(doc, { terrainReady: false, mapFullyLoaded: false, pairConnected: true });
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
    // terrain done + map load 完了: 有効化 + hint 非表示
    applyTerrainGate(doc, { terrainReady: true, mapFullyLoaded: true, pairConnected: true });
    expect(doc.getElementById('btnRideStart').disabled).toBe(false);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(true);
  });

  it('terrain が done でも pair 未完なら disabled + hint 表示が一致', () => {
    const doc = makeDoc();
    applyTerrainGate(doc, { terrainReady: true, mapFullyLoaded: true, pairConnected: false });
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
  });

  it('一度有効化後に terrain が失われたら btn 無効化 + hint 再表示が一致 (= ちぐはぐ再発なし)', () => {
    const doc = makeDoc();
    applyTerrainGate(doc, { terrainReady: true, mapFullyLoaded: true, pairConnected: true });
    expect(doc.getElementById('ride-start-hint').hidden).toBe(true);
    applyTerrainGate(doc, { terrainReady: false, mapFullyLoaded: true, pairConnected: true });
    expect(doc.getElementById('btnRideStart').disabled).toBe(true);
    expect(doc.getElementById('ride-start-hint').hidden).toBe(false);
  });
});

describe('bug fix 2026-05-17: index.html / viewer source assertion (= fix が実 source に landing 済)', () => {
  it('index.html: ライド開始ボタン直下の hint に id="ride-start-hint" がある', () => {
    expect(html).toMatch(/<div\s+id="ride-start-hint"[^>]*>trainer のハンドシェイク完了後に押せるようになります<\/div>/);
  });

  it('viewer: setRideStartEnabled 関数が定義され、 btnRideStart.disabled と #ride-start-hint.hidden を両方書く', () => {
    const m = viewer.match(/function\s+setRideStartEnabled\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/getElementById\(['"]btnRideStart['"]\)/);
    expect(body).toMatch(/\.disabled\s*=/);
    expect(body).toMatch(/getElementById\(['"]ride-start-hint['"]\)/);
    expect(body).toMatch(/\.hidden\s*=/);
  });

  it('viewer: showPreflightAndStart が setup-overlay の visible を剥がす (= preflight 露出)', () => {
    const m = viewer.match(/async\s+function\s+showPreflightAndStart\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/getElementById\(['"]setup-overlay['"]\)\?*\.classList\.remove\(['"]visible['"]\)/);
  });

  it('viewer: showPreflightAndStart の onCancel が state-riding でない時 setup-overlay を復元', () => {
    const m = viewer.match(/async\s+function\s+showPreflightAndStart\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/onCancel/);
    expect(body).toMatch(/state-riding/);
    expect(body).toMatch(/getElementById\(['"]setup-overlay['"]\)\?*\.classList\.add\(['"]visible['"]\)/);
  });

  it('preflight-overlay (z=1465) は setup-overlay (z=1500) より下 (= 隠れる構造、 viewer の hide が必須な理由)', () => {
    const zOf = (sel) => {
      const m = html.match(new RegExp(sel + '\\s*\\{[^}]*z-index:\\s*(\\d+)', 'i'));
      return m ? parseInt(m[1], 10) : null;
    };
    const preflightZ = zOf('#preflight-overlay');
    const setupZ = zOf('#setup-overlay');
    expect(preflightZ).toBe(1465);
    expect(setupZ).toBe(1500);
    expect(preflightZ).toBeLessThan(setupZ);
  });
});
