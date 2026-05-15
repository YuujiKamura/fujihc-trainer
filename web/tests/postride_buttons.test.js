// brief 33 atom F: postride_buttons.js の bind 動作 unit test (= mock document).
import { describe, it, expect, vi } from 'vitest';
import { bindPostRideButtons } from '../lib/postride_buttons.js';
import { STRAVA_TOKEN_LS_KEY } from '../lib/strava_oauth.js';

// 最小限の DOM mock (= addEventListener / getElementById / createElement / body.appendChild).
function makeMockDoc() {
  const elements = new Map();
  const listeners = new Map();
  function mkEl(id) {
    const el = {
      id,
      _attrs: {},
      addEventListener(ev, fn) {
        const k = `${id}:${ev}`;
        listeners.set(k, fn);
      },
      removeEventListener(ev) {
        listeners.delete(`${id}:${ev}`);
      },
      click() {
        const fn = listeners.get(`${id}:click`);
        if (fn) fn({ preventDefault() {} });
      },
      setAttribute(k, v) { this._attrs[k] = v; },
      appendChild() {},
      removeChild() {},
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['btnGpxDownload', 'btnStravaUpload', 'btnSaveHistory', 'btnViewHistory']) {
    mkEl(id);
  }
  const body = { appendChild() {}, removeChild() {} };
  const doc = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(_tag) {
      // download <a> 用、 click を spy できるよう関数化
      const el = { _clickCount: 0, href: '', download: '', click() { el._clickCount += 1; }, _attrs: {} };
      return el;
    },
    body,
  };
  return { doc, elements, listeners };
}

function memSessionStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

describe('bindPostRideButtons', () => {
  it('4 button が bind される (= 個別 click で個別 callback 発火)', () => {
    const { doc, elements } = makeMockDoc();
    const calls = { onViewHistory: 0, addRide: 0 };
    bindPostRideButtons({
      document: doc,
      window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
      getTrkpts: () => [],
      getSummary: () => ({}),
      getCourseName: () => 'fujihill',
      addRide: async () => { calls.addRide += 1; },
      getClientId: () => null,
      getRedirectUri: () => 'https://example.test/oauth-callback.html',
      onViewHistory: () => { calls.onViewHistory += 1; },
    });
    // 4 button 全てに click listener が登録済
    expect(typeof elements.get('btnGpxDownload').click).toBe('function');
    expect(typeof elements.get('btnStravaUpload').click).toBe('function');
    expect(typeof elements.get('btnSaveHistory').click).toBe('function');
    expect(typeof elements.get('btnViewHistory').click).toBe('function');
  });

  it('btnViewHistory click → onViewHistory callback 発火', () => {
    const { doc, elements } = makeMockDoc();
    let n = 0;
    bindPostRideButtons({
      document: doc,
      window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
      getTrkpts: () => [],
      getSummary: () => ({}),
      addRide: async () => {},
      getClientId: () => null,
      getRedirectUri: () => 'x',
      onViewHistory: () => { n += 1; },
    });
    elements.get('btnViewHistory').click();
    expect(n).toBe(1);
  });

  it('btnSaveHistory click → addRide が呼ばれる + summary / trkpts が渡る', async () => {
    const { doc, elements } = makeMockDoc();
    let captured = null;
    bindPostRideButtons({
      document: doc,
      window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
      getTrkpts: () => [{ t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 }],
      getSummary: () => ({ id: 'ride-x', date: '2026-05-15T07:30:00Z', distance_m: 5000, duration_s: 1800, course_name: 'fujihill' }),
      addRide: async (rec) => { captured = rec; },
      getClientId: () => null,
      getRedirectUri: () => 'x',
      onViewHistory: () => {},
    });
    elements.get('btnSaveHistory').click();
    // wait microtask
    await new Promise((r) => setTimeout(r, 5));
    expect(captured).not.toBeNull();
    expect(captured.id).toBe('ride-x');
    expect(captured.trkpts.length).toBe(1);
    expect(captured.summary.distance_m).toBe(5000);
  });

  it('btnGpxDownload click → document.createElement(a) + click が走る (= download trigger)', async () => {
    const created = [];
    const { doc, elements } = makeMockDoc();
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => { const el = origCreate(tag); created.push(el); return el; };
    // URL.createObjectURL は global stub
    const origURL = globalThis.URL.createObjectURL;
    const origRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = () => 'blob:fake';
    globalThis.URL.revokeObjectURL = () => {};
    try {
      bindPostRideButtons({
        document: doc,
        window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
        getTrkpts: () => [{ t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 }],
        getSummary: () => ({ date: '2026-05-15T07:30:00Z' }),
        addRide: async () => {},
        getClientId: () => null,
        getRedirectUri: () => 'x',
        onViewHistory: () => {},
      });
      elements.get('btnGpxDownload').click();
      await new Promise((r) => setTimeout(r, 5));
      expect(created.length).toBe(1);
      expect(created[0]._clickCount).toBe(1);
      expect(created[0].download).toMatch(/^ride-/);
      expect(created[0].download).toMatch(/\.gpx$/);
    } finally {
      globalThis.URL.createObjectURL = origURL;
      globalThis.URL.revokeObjectURL = origRevoke;
    }
  });

  it('btnStravaUpload click + client_id 未設定 → status に「未設定」表示、 location.assign しない', async () => {
    const { doc, elements } = makeMockDoc();
    let statusMsg = '';
    let assignCalled = 0;
    bindPostRideButtons({
      document: doc,
      window: { sessionStorage: memSessionStorage(), location: { assign() { assignCalled += 1; } } },
      getTrkpts: () => [],
      getSummary: () => ({}),
      addRide: async () => {},
      getClientId: () => null,
      getRedirectUri: () => 'x',
      onViewHistory: () => {},
      onStatus: (t) => { statusMsg = t; },
    });
    elements.get('btnStravaUpload').click();
    await new Promise((r) => setTimeout(r, 5));
    expect(statusMsg).toMatch(/client_id/);
    expect(assignCalled).toBe(0);
  });
});
