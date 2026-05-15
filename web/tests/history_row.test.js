// history-overlay 1 行 (= history_row.js) の unit test.
//
// 検証ポイント:
// 1. 各 ride で「日付/サマリ + GPX button + 削除 button」の 3 要素が組み上がる
// 2. GPX click → document.createElement('a') + a.click() が走る (= download trigger)
// 3. GPX 出力は consent('strava') 一切参照しない (= 過去 ride を Strava 連携なしで DL 可能)
// 4. GPX XML が buildGpxXml 経由で trkpts → <trkpt lat=... lon=...> を含む
// 5. 削除 button click → onDelete callback 発火
// 6. rideFilename helper の `:` → `-` 置換 (= Windows file 名 safe)
//
// brief 33 atom F (= postride_buttons.test.js) と同じく minimal DOM mock を使う、
// jsdom 不要 (= 純 node 環境で走る、 既存 vitest config そのまま).
import { describe, it, expect } from 'vitest';
import { appendHistoryRow, rideFilename } from '../lib/history_row.js';

function makeMockDoc() {
  const created = [];
  const body = { appendChild() {}, removeChild() {} };
  function mkEl(tag) {
    const listeners = {};
    const el = {
      _tag: tag,
      _children: [],
      _attrs: {},
      _clickCount: 0,
      className: '',
      textContent: '',
      href: '',
      download: '',
      hidden: false,
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this._children.push(c); return c; },
      addEventListener(ev, fn) { listeners[ev] = fn; },
      removeEventListener(ev) { delete listeners[ev]; },
      click() {
        this._clickCount += 1;
        if (listeners.click) listeners.click({ preventDefault() {} });
      },
    };
    created.push(el);
    return el;
  }
  const doc = {
    createElement: mkEl,
    body,
  };
  return { doc, created };
}

function findByTag(els, tag) {
  return els.filter((e) => e._tag === tag);
}

function findButtonByAction(li, action) {
  // li → meta + actions の 2 child、 actions の中の button を探す
  const actions = li._children.find((c) => c.className === 'ride-actions');
  if (!actions) return null;
  return actions._children.find((c) => c._tag === 'button' && c._attrs['data-action'] === action) || null;
}

describe('rideFilename', () => {
  it('ride.date の `:` `.` を `-` に置換 (= Windows file 名 safe)', () => {
    expect(rideFilename({ date: '2026-05-15T07:30:00.123Z' }))
      .toBe('ride-2026-05-15T07-30-00-123Z.gpx');
  });

  it('date 欠落時は id を fallback、 それも欠落なら "ride"', () => {
    expect(rideFilename({ id: 'abc-123' })).toBe('ride-abc-123.gpx');
    expect(rideFilename({})).toBe('ride-ride.gpx');
  });
});

describe('appendHistoryRow', () => {
  it('li / meta / actions / GPX button / 削除 button の DOM を組む', () => {
    const { doc, created } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const ride = {
      id: 'r1', date: '2026-05-15T07:30:00Z',
      summary: { distance_m: 12300, duration_s: 1820, course_name: 'fujihill' },
      trkpts: [
        { t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 },
      ],
    };
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride,
      onDelete: () => {},
    });
    expect(li._tag).toBe('li');
    expect(listEl._children).toContain(li);
    // meta に date + summary の 2 div あり
    const meta = li._children.find((c) => c.className === 'ride-meta');
    expect(meta).toBeTruthy();
    expect(meta._children.find((c) => c.className === 'ride-date').textContent).toBe('2026-05-15T07:30:00Z');
    expect(meta._children.find((c) => c.className === 'ride-summary').textContent).toBe('12.3 km / 1820s / 1pt');
    // actions に GPX + 削除 button あり
    const bGpx = findButtonByAction(li, 'gpx-download');
    const bDel = findButtonByAction(li, 'delete');
    expect(bGpx).toBeTruthy();
    expect(bGpx.textContent).toBe('GPX');
    expect(bDel).toBeTruthy();
    expect(bDel.textContent).toBe('削除');
    // 全 created 要素のうち button は 2 個のみ (= 過剰生成なし)
    const buttons = findByTag(created, 'button');
    expect(buttons.length).toBe(2);
  });

  it('GPX click → buildGpxXml で trkpts が XML に載る、 a.click() が 1 回走る', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const blobs = [];
    let downloaded = null;
    const fakeURL = {
      createObjectURL(b) { blobs.push(b); return 'blob:fake-1'; },
      revokeObjectURL() {},
    };
    class FakeBlob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || '';
      }
    }
    const ride = {
      id: 'r1', date: '2026-05-15T07:30:00Z',
      summary: { distance_m: 1000, duration_s: 60, course_name: 'fujihill' },
      trkpts: [
        { t: '2026-05-15T07:30:00Z', lat: 35.4, lon: 138.7, ele: 1000, power: 200, cad: 80, hr: 140 },
        { t: '2026-05-15T07:30:01Z', lat: 35.401, lon: 138.701, ele: 1001, power: 205, cad: 81, hr: 141 },
      ],
    };
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride,
      onDelete: () => {},
      onGpxDownloaded: (info) => { downloaded = info; },
      URL: fakeURL,
      Blob: FakeBlob,
      setTimeout: (fn) => { /* don't actually schedule */ fn; },
    });
    findButtonByAction(li, 'gpx-download').click();
    // Blob が 1 回作られた
    expect(blobs.length).toBe(1);
    expect(blobs[0].type).toBe('application/gpx+xml');
    // XML 文字列に lat/lon/extension が含まれる
    const xml = blobs[0].parts[0];
    expect(typeof xml).toBe('string');
    expect(xml).toContain('<trkpt lat="35.4000000" lon="138.7000000">');
    expect(xml).toContain('<trkpt lat="35.4010000" lon="138.7010000">');
    expect(xml).toContain('<gpxpx:PowerInWatts>200</gpxpx:PowerInWatts>');
    expect(xml).toContain('<name>fujihill</name>');
    expect(xml).toContain('<type>Virtual Ride</type>');
    // onGpxDownloaded callback が呼ばれた、 filename が ride.date から派生
    expect(downloaded).toEqual({ filename: 'ride-2026-05-15T07-30-00Z.gpx', points: 2 });
  });

  it('削除 button click → onDelete callback が 1 回呼ばれる', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    let calls = 0;
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: { id: 'r1', date: '2026-05-15T07:30:00Z', summary: {}, trkpts: [] },
      onDelete: () => { calls += 1; },
    });
    findButtonByAction(li, 'delete').click();
    expect(calls).toBe(1);
  });

  it('GPX download は consent module を一切 import しない (= Strava 非依存、 module 単独で完結)', async () => {
    // source 文字列 grep で consent / strava 連携依存が混入していないか確認 (= regression gate).
    // コメント (= "// ... consent ...") は OK、 実 import 文 / 関数呼出しのみを禁止.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '..', 'lib', 'history_row.js'), 'utf-8');
    // 実 import 文 (= ESM `import ... from './consent.js'`) を禁止.
    expect(src).not.toMatch(/^\s*import[^;]*from\s*['"][^'"]*consent[^'"]*['"]/m);
    expect(src).not.toMatch(/^\s*import[^;]*from\s*['"][^'"]*strava_/m);
    // 実関数呼出し (= getRideConsent(...) / setRideConsent(...) ) を禁止 (= コメント内の単語は許可).
    expect(src).not.toMatch(/\bgetRideConsent\s*\(/);
    expect(src).not.toMatch(/\bsetRideConsent\s*\(/);
    // fetch / network 呼出しもゼロ (= local Blob 完結).
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('trkpts 空でも GPX click は失敗せず Blob は作られる (= empty <trkseg> の有効 GPX)', () => {
    const { doc } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const blobs = [];
    const fakeURL = {
      createObjectURL(b) { blobs.push(b); return 'blob:fake-2'; },
      revokeObjectURL() {},
    };
    class FakeBlob {
      constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; }
    }
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: { id: 'r1', date: '2026-05-15T07:30:00Z', summary: {}, trkpts: [] },
      onDelete: () => {},
      URL: fakeURL,
      Blob: FakeBlob,
      setTimeout: () => {},
    });
    findButtonByAction(li, 'gpx-download').click();
    expect(blobs.length).toBe(1);
    const xml = blobs[0].parts[0];
    expect(xml).toContain('<trkseg>');
    expect(xml).toContain('</trkseg>');
    expect(xml).not.toContain('<trkpt');
  });

  it('rideFilename を経由した a.download が出力される', () => {
    const { doc, created } = makeMockDoc();
    const listEl = doc.createElement('ul');
    const fakeURL = {
      createObjectURL() { return 'blob:fake-3'; },
      revokeObjectURL() {},
    };
    class FakeBlob { constructor() {} }
    const li = appendHistoryRow({
      document: doc,
      listEl,
      ride: { id: 'r1', date: '2026-05-15T07:30:00Z', summary: {}, trkpts: [] },
      onDelete: () => {},
      URL: fakeURL,
      Blob: FakeBlob,
      setTimeout: () => {},
    });
    findButtonByAction(li, 'gpx-download').click();
    // 作成された <a> を探す (= tag === 'a')
    const anchors = created.filter((e) => e._tag === 'a');
    expect(anchors.length).toBe(1);
    expect(anchors[0].download).toBe('ride-2026-05-15T07-30-00Z.gpx');
    expect(anchors[0].href).toBe('blob:fake-3');
    expect(anchors[0]._clickCount).toBe(1);
  });
});
