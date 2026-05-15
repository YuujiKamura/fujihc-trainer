// brief 34 ε-4 integration test: Strava upload の 2 重 gate を end-to-end で検証.
//
// 範囲: bindPostRideButtons (caller 側) → postUpload (lib 内側) → fetch spy で payload 確認.
// 既存 minimal DOM mock (= postride_buttons.test.js と同じ pattern) を使い、 happy-dom 等を追加せず
// 既存依存だけで「caller が name override しても fetch payload の name に simulator が残る」を pin.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindPostRideButtons } from '../lib/postride_buttons.js';
import { STRAVA_TOKEN_LS_KEY } from '../lib/strava_oauth.js';

function makeMockDoc() {
  const elements = new Map();
  const listeners = new Map();
  function mkEl(id) {
    const el = {
      id,
      _attrs: {},
      _hidden: false,
      get hidden() { return this._hidden; },
      set hidden(v) { this._hidden = !!v; },
      addEventListener(ev, fn) { listeners.set(`${id}:${ev}`, fn); },
      removeEventListener(ev) { listeners.delete(`${id}:${ev}`); },
      click() { const fn = listeners.get(`${id}:click`); if (fn) fn({ preventDefault() {} }); },
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
    createElement(_tag) { return { _clickCount: 0, href: '', download: '', click() { this._clickCount += 1; } }; },
    body,
  };
  return { doc, elements };
}

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

describe('brief 34 ε-4 integration: Strava upload 2 重 gate (= caller + lib 両方で trademark 強制)', () => {
  it('Strava upload click → fetch payload の name に「(fujihc-trainer simulator)」が必ず含まれる', async () => {
    const { doc, elements } = makeMockDoc();
    const fetchSpy = vi.fn();
    let capturedPayload = null;
    fetchSpy.mockImplementation(async (url, init) => {
      if (init.method === 'POST') {
        // POST /uploads (= 実 upload). FormData entries を spy.
        capturedPayload = {};
        for (const [k, v] of init.body.entries()) capturedPayload[k] = v;
        return { ok: true, status: 201, async json() { return { id: 7777, status: 'processing' }; } };
      }
      // GET /uploads/:id (= poll). 1 回目で activity_id 返す.
      return { ok: true, async json() { return { id: 7777, activity_id: 11111 }; } };
    });

    // 既存 access_token を localStorage 風 storage に注入 (= ensureAccessToken が refresh skip).
    const ls = memStorage();
    ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify({
      access_token: 'fake-access-token',
      refresh_token: 'fake-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,  // 1h 後 = 有効
    }));
    // globalThis.localStorage に注入 (= ensureAccessToken は globalThis.localStorage を読む).
    const origLs = globalThis.localStorage;
    globalThis.localStorage = ls;
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    const origFormData = globalThis.FormData;
    const origBlob = globalThis.Blob;
    // 最小 FormData / Blob mock (= node test 環境用).
    class FakeFormData {
      constructor() { this._entries = []; }
      append(k, v) { this._entries.push([k, v]); }
      *entries() { for (const e of this._entries) yield e; }
    }
    class FakeBlob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
    }
    globalThis.FormData = FakeFormData;
    globalThis.Blob = FakeBlob;
    try {
      bindPostRideButtons({
        document: doc,
        window: { sessionStorage: memStorage(), location: { assign() {} } },
        getTrkpts: () => [{ t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 }],
        getSummary: () => ({ id: 'integration-ride', date: '2026-05-15T07:30:00Z', distance_m: 5000, duration_s: 1800, course_name: 'fujihc' }),
        getCourseName: () => 'My Personal Title',  // caller が override しようとする
        addRide: async () => {},
        getClientId: () => 'fake-client-id',
        getRedirectUri: () => 'https://example.test/oauth-callback.html',
        onViewHistory: () => {},
        onStatus: () => {},
      });
      elements.get('btnStravaUpload').click();
      // upload は async chain、 microtask flush で完了させる
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 1));
      // 2 重 gate 後の payload を assert.
      expect(capturedPayload).not.toBeNull();
      // name は caller 渡し ("My Personal Title") + 接尾 (caller append) + 接尾 (lib append idempotent)
      // = 「My Personal Title (fujihc-trainer simulator)」 ── 接尾 1 つだけ (idempotent).
      expect(capturedPayload.name).toContain('My Personal Title');
      expect(capturedPayload.name).toContain('(fujihc-trainer simulator)');
      // 二重接尾は起きない (idempotent)
      const suffixCount = (capturedPayload.name.match(/\(fujihc-trainer simulator\)/g) || []).length;
      expect(suffixCount).toBe(1);
      // description にも商標混同対策 prefix
      expect(capturedPayload.description).toMatch(/^This is an indoor trainer simulation/);
      expect(capturedPayload.description).toContain('Mt. Fuji Hill Climb');
      expect(capturedPayload.description).toContain('Not an actual outdoor activity');
      // sport_type / activity_type は VirtualRide (= 既存 brief 33 から維持)
      expect(capturedPayload.sport_type).toBe('VirtualRide');
      expect(capturedPayload.activity_type).toBe('VirtualRide');
    } finally {
      globalThis.fetch = origFetch;
      globalThis.localStorage = origLs;
      globalThis.FormData = origFormData;
      globalThis.Blob = origBlob;
    }
  });
});
