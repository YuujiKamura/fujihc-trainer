// brief 33+ integration test: 「Strava 連携なしでも GPX を download できるか」を end-to-end pin.
//
// 対象 user question (= 2026-05-15):
//   「ストラバとの連携なしでもGPXData生成してDLできるようにしてるのか」
//
// 確認したい invariant 2 つ:
// 1. postride-overlay の btnGpxDownload は consent('strava') と独立して a.click() を発火する
//    (= 走り終わった ride を Strava 連携無しでローカル .gpx として download 可能).
// 2. history-overlay の各 row の GPX button は consent('strava') と独立して a.click() を発火する
//    (= 過去の保存済 ride を IndexedDB から取り出して .gpx として download 可能).
//
// 両方とも client 内完結 (= fetch / network 呼び出しゼロ、 Blob のみ).
// brief 33 §11 「外部 https 参照ゼロ」 と整合 (= GPX 生成は pure module).

import { describe, it, expect, vi } from 'vitest';
import { bindPostRideButtons } from '../lib/postride_buttons.js';
import { appendHistoryRow } from '../lib/history_row.js';
import {
  setRideConsent, getRideConsent, RIDE_CONSENT_LS_KEY,
} from '../lib/consent.js';

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

function memSessionStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

function makeMockDoc(extraIds = []) {
  const elements = new Map();
  const listeners = new Map();
  function mkEl(id, tag = 'button') {
    const el = {
      id, _tag: tag, _attrs: {}, _children: [], _clickCount: 0,
      className: '', textContent: '', href: '', download: '', hidden: false,
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._children.push(c); return c; },
      addEventListener(ev, fn) { listeners.set(`${id}:${ev}`, fn); },
      removeEventListener(ev) { listeners.delete(`${id}:${ev}`); },
      click() {
        this._clickCount += 1;
        const fn = listeners.get(`${id}:click`);
        if (fn) fn({ preventDefault() {} });
      },
    };
    elements.set(id, el);
    return el;
  }
  for (const id of ['btnGpxDownload', 'btnStravaUpload', 'btnSaveHistory', 'btnViewHistory', ...extraIds]) {
    mkEl(id);
  }
  let createdCount = 0;
  const body = { appendChild() {}, removeChild() {} };
  const doc = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      createdCount += 1;
      const lst = {};
      const el = {
        _tag: tag, _id: `__c${createdCount}`, _clickCount: 0, _children: [], _attrs: {},
        href: '', download: '', textContent: '', className: '',
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k) { return this._attrs[k]; },
        appendChild(c) { this._children.push(c); return c; },
        addEventListener(ev, fn) { lst[ev] = fn; },
        removeEventListener(ev) { delete lst[ev]; },
        click() {
          this._clickCount += 1;
          if (lst.click) lst.click({ preventDefault() {} });
        },
      };
      return el;
    },
    body,
  };
  return { doc, elements };
}

describe('integration: postride-overlay GPX download は Strava 連携 OFF でも動く', () => {
  it('strava=false でも btnGpxDownload click で a.click() + Blob 生成が走る', async () => {
    const storage = memStorage();
    // history は ON だが strava は OFF (= 「ローカル保存だけ同意した」 user パターン)
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    expect(getRideConsent('strava', { storage })).toBe(false);
    expect(getRideConsent('history', { storage })).toBe(true);

    const { doc, elements } = makeMockDoc();
    const created = [];
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => { const el = origCreate(tag); created.push(el); return el; };
    const blobs = [];
    const origCreateBlob = globalThis.URL.createObjectURL;
    const origRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:xx'; };
    globalThis.URL.revokeObjectURL = () => {};
    try {
      bindPostRideButtons({
        document: doc,
        window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
        getTrkpts: () => [
          { t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 },
        ],
        getSummary: () => ({ date: '2026-05-15T07:30:00Z' }),
        getCourseName: () => 'fujihill',
        addRide: async () => {},
        // strava consent OFF の挙動を再現 (= viewer-maplibre.js の getClientId と同等)
        getClientId: () => {
          if (!getRideConsent('strava', { storage })) return null;
          return 'fake-id';
        },
        getRedirectUri: () => 'x',
        onViewHistory: () => {},
      });
      elements.get('btnGpxDownload').click();
      await new Promise((r) => setTimeout(r, 5));
      // a.click() が走った (= download trigger).
      expect(created.length).toBe(1);
      expect(created[0]._clickCount).toBe(1);
      expect(created[0].download).toMatch(/\.gpx$/);
      // Blob 1 個が application/gpx+xml で作られた.
      expect(blobs.length).toBe(1);
      expect(blobs[0].type).toBe('application/gpx+xml');
    } finally {
      globalThis.URL.createObjectURL = origCreateBlob;
      globalThis.URL.revokeObjectURL = origRevoke;
    }
  });

  it('strava=false / history=false (= 全 consent OFF) でも btnGpxDownload click で a.click() が走る', async () => {
    const storage = memStorage();
    setRideConsent({ history: false, strava: false, asked: true }, { storage });
    const { doc, elements } = makeMockDoc();
    const created = [];
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = (tag) => { const el = origCreate(tag); created.push(el); return el; };
    const origCreateBlob = globalThis.URL.createObjectURL;
    const origRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = () => 'blob:yy';
    globalThis.URL.revokeObjectURL = () => {};
    try {
      bindPostRideButtons({
        document: doc,
        window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
        getTrkpts: () => [
          { t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 },
        ],
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
    } finally {
      globalThis.URL.createObjectURL = origCreateBlob;
      globalThis.URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('integration: history-overlay 行内 GPX button は Strava 連携 OFF でも動く', () => {
  it('strava=false で history-overlay の row の GPX button → Blob + a.click() が走る', () => {
    const storage = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage });
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const blobs = [];
    const fakeURL = {
      createObjectURL(b) { blobs.push(b); return 'blob:zz'; },
      revokeObjectURL() {},
    };
    class FakeBlob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
    }
    const ride = {
      id: 'r-past-1', date: '2026-05-10T08:00:00Z',
      summary: { distance_m: 24000, duration_s: 5400, course_name: 'fujihill' },
      trkpts: [
        { t: '2026-05-10T08:00:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 220, cad: 88, hr: 150 },
        { t: '2026-05-10T08:00:01Z', lat: 35.401, lon: 138.701, ele: 1003, power: 222, cad: 89, hr: 151 },
      ],
    };
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride,
      onDelete: () => {},
      URL: fakeURL,
      Blob: FakeBlob,
      setTimeout: () => {},
    });
    // GPX button を li 内から取り出して click.
    const actions = li._children.find((c) => c.className === 'ride-actions');
    const bGpx = actions._children.find((c) => c._tag === 'button' && c._attrs['data-action'] === 'gpx-download');
    bGpx.click();
    expect(blobs.length).toBe(1);
    expect(blobs[0].type).toBe('application/gpx+xml');
    const xml = blobs[0].parts[0];
    expect(xml).toContain('<trkpt lat="35.4000000" lon="138.7000000">');
    expect(xml).toContain('<trkpt lat="35.4010000" lon="138.7010000">');
    expect(xml).toContain('<name>fujihill</name>');
  });

  it('strava=false / history=false の状況で row を描画した場合でも GPX button は機能する (= module 単独で完結、 consent 非参照)', () => {
    // 注: 実際の app では history=false なら history-overlay 到達経路自体が無い (= addRide が止まる)。
    // しかしこの test は history_row.js が consent module を import していないこと、
    // 単独 module として呼ばれた時に Strava 連携 / consent 状態を一切参照しないことを pin する.
    const storage = memStorage();
    setRideConsent({ history: false, strava: false, asked: true }, { storage });
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const blobs = [];
    const fakeURL = {
      createObjectURL(b) { blobs.push(b); return 'blob:zz'; },
      revokeObjectURL() {},
    };
    class FakeBlob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
    }
    const ride = {
      id: 'r-x', date: '2026-05-10T08:00:00Z',
      summary: { distance_m: 1000, duration_s: 60 },
      trkpts: [{ t: '2026-05-10T08:00:00Z', lat: 35.4, lon: 138.7, ele: 1000 }],
    };
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride,
      onDelete: () => {},
      URL: fakeURL,
      Blob: FakeBlob,
      setTimeout: () => {},
    });
    const actions = li._children.find((c) => c.className === 'ride-actions');
    const bGpx = actions._children.find((c) => c._tag === 'button' && c._attrs['data-action'] === 'gpx-download');
    bGpx.click();
    expect(blobs.length).toBe(1);
  });
});

describe('integration: GPX 生成経路は network fetch を呼ばない (= local Blob 完結)', () => {
  it('postride GPX click 中に globalThis.fetch は呼ばれない', async () => {
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (...args) => { fetchCalls += 1; return Promise.reject(new Error('should not be called')); };
    const origCreateBlob = globalThis.URL.createObjectURL;
    const origRevoke = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = () => 'blob:no-fetch';
    globalThis.URL.revokeObjectURL = () => {};
    try {
      const { doc, elements } = makeMockDoc();
      bindPostRideButtons({
        document: doc,
        window: { sessionStorage: memSessionStorage(), location: { assign() {} } },
        getTrkpts: () => [{ t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000 }],
        getSummary: () => ({ date: '2026-05-15T07:30:00Z' }),
        addRide: async () => {},
        getClientId: () => null,
        getRedirectUri: () => 'x',
        onViewHistory: () => {},
      });
      elements.get('btnGpxDownload').click();
      await new Promise((r) => setTimeout(r, 5));
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = origFetch;
      globalThis.URL.createObjectURL = origCreateBlob;
      globalThis.URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('regression: viewer-maplibre.js が history_row.js helper を使う (= inline DOM 直書き禁止)', () => {
  it('viewer-maplibre.js 内に appendHistoryRow の import + 呼出しがある', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const viewer = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf-8');
    expect(viewer).toMatch(/import\s*\{\s*appendHistoryRow\s*\}\s*from\s*['"]\.\/lib\/history_row\.js['"]/);
    expect(viewer).toMatch(/appendHistoryRow\(\s*\{/);
  });

  it('viewer-maplibre.js の history-overlay 描画で inline <li> + 削除 button 直書きが残っていない', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const viewer = readFileSync(resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf-8');
    // 旧 inline 構造の特徴シグネチャ (= className = 'ride-actions' を viewer 内に書いていた)
    // history_row.js へ extract 済なので viewer には残らない.
    expect(viewer).not.toMatch(/className\s*=\s*['"]ride-actions['"]/);
    expect(viewer).not.toMatch(/className\s*=\s*['"]ride-meta['"]/);
  });
});
