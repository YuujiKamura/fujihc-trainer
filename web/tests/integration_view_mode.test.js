// brief 34 ε-8: 「観る」モード (= 区間選択型コース分析) の integration test.
//
// 検証範囲:
//   1. intro 「コースを観る」click → setIntroConsent({mode:'view'}) 保存 + dispatchAfterIntro
//      経由で initViewMode 分岐.
//   2. section-overlay 行クリック → rideState.startFrom(start_idx) で section 始点から ride 開始.
//   3. ride 中 IndexedDB addRide が呼ばれない (= 観るモードは記録対象外、 物理 guard).
//   4. 「区間リストに戻る」button で section-overlay 再表示 + ride を end.
//   5. URL 引数 (?map=1 等) と intro mode='view' が衝突した場合、 view を優先.
//
// vitest default (= node 環境) で書く、 happy-dom 不使用。 viewer 本体の dispatchAfterIntro と
// initViewMode 関係 logic を shim で再現、 + lib 側 (= course_sections / consent / ride_state) は
// 直 import して end-to-end の振る舞いを pin する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  getIntroConsent, setIntroConsent,
  getRideConsent, setRideConsent,
} from '../lib/consent.js';
import { splitCourseIntoSections } from '../lib/course_sections.js';
import { createRideState } from '../lib/ride_state.js';

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

// 単純 course (= 11 点 / 1km / 5% 一定勾配).
function buildSimpleCourse() {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    out.push({
      distance_m: i * 1000,
      elevation_m: 100 + i * 50,
      slope_pct: 5,
      lat: 35.0 + i * 0.001,
      lon: 138.7 + i * 0.001,
    });
  }
  return out;
}

// viewer-maplibre.js の dispatchAfterIntro logic を再現する shim.
// intro consent mode === 'view' なら initViewMode、 それ以外は既存 init 系。
function createDispatcher({ storage, mapMode, testMode, bleMode, spies }) {
  return {
    dispatchAfterIntro() {
      const ic = getIntroConsent({ storage });
      if (ic && ic.mode === 'view') {
        spies.initViewMode();
        return;
      }
      if (mapMode) spies.initMapMode();
      else if (testMode) spies.initTestMode();
      else if (bleMode) spies.initBleMode();
      else spies.bootCheckSetupStatus();
    },
  };
}

function makeSpies() {
  const rec = {
    initMapMode: 0, initTestMode: 0, initBleMode: 0,
    bootCheckSetupStatus: 0, initViewMode: 0, showIntroOverlay: 0,
  };
  return {
    rec,
    initMapMode: () => { rec.initMapMode += 1; },
    initTestMode: () => { rec.initTestMode += 1; },
    initBleMode: () => { rec.initBleMode += 1; },
    bootCheckSetupStatus: () => { rec.bootCheckSetupStatus += 1; },
    initViewMode: () => { rec.initViewMode += 1; },
    showIntroOverlay: () => { rec.showIntroOverlay += 1; },
  };
}

describe('brief 34 ε-8 integration: 「コースを観る」 click → initViewMode 分岐', () => {
  it('setIntroConsent({mode:"view"}) 後 dispatchAfterIntro → initViewMode が呼ばれる', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'view' });
    const spies = makeSpies();
    const d = createDispatcher({ storage, mapMode: false, testMode: false, bleMode: false, spies });
    d.dispatchAfterIntro();
    expect(spies.rec.initViewMode).toBe(1);
    expect(spies.rec.initBleMode).toBe(0);
    expect(spies.rec.bootCheckSetupStatus).toBe(0);
  });

  it('setIntroConsent({mode:"ride"}) 後 dispatchAfterIntro → bootCheckSetupStatus (= 既存 ride 経路)', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'ride' });
    const spies = makeSpies();
    const d = createDispatcher({ storage, mapMode: false, testMode: false, bleMode: false, spies });
    d.dispatchAfterIntro();
    expect(spies.rec.bootCheckSetupStatus).toBe(1);
    expect(spies.rec.initViewMode).toBe(0);
  });

  it('mode 未指定 (= default) → ride 経路 (= bootCheckSetupStatus)', () => {
    const storage = memStorage();
    setIntroConsent({ storage });  // mode 省略
    const spies = makeSpies();
    const d = createDispatcher({ storage, mapMode: false, testMode: false, bleMode: false, spies });
    d.dispatchAfterIntro();
    expect(spies.rec.bootCheckSetupStatus).toBe(1);
    expect(spies.rec.initViewMode).toBe(0);
  });

  it('view mode は URL 引数 (?map=1) より優先される (= intro の明示選択を URL より上)', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'view' });
    const spies = makeSpies();
    // ?map=1 相当 (= mapMode=true) でも view mode が勝つ.
    const d = createDispatcher({ storage, mapMode: true, testMode: false, bleMode: false, spies });
    d.dispatchAfterIntro();
    expect(spies.rec.initViewMode).toBe(1);
    expect(spies.rec.initMapMode).toBe(0);  // URL は無効化される
  });
});

describe('brief 34 ε-8 integration: section-overlay の区間選択 → rideState start_idx inject', () => {
  it('単純 course の区間 0 をクリック → rideState.snapshot().idx === section.start_idx', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    expect(sections.length).toBe(10);
    // section 0 を選んだ場合 (= start_idx=0)
    rs.startFrom(sections[0].start_idx);
    expect(rs.snapshot().idx).toBe(sections[0].start_idx);
    expect(rs.snapshot().idx).toBe(0);
    expect(rs.snapshot().active).toBe(true);
    expect(rs.snapshot().paused).toBe(false);
  });

  it('section 5 をクリック → rideState の idx / distance が section 始点に inject される', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    const target = sections[5];
    rs.startFrom(target.start_idx);
    const snap = rs.snapshot();
    expect(snap.idx).toBe(target.start_idx);
    // 単純 course (= 1km 間隔) で 5 区間目の始点は 5km 地点 (= idx 5).
    expect(snap.distance).toBeCloseTo(target.start_dist, 3);
  });

  it('section 末尾 (= 区間 9) をクリック → rideState 末端付近から開始', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    const last = sections[sections.length - 1];
    rs.startFrom(last.start_idx);
    expect(rs.snapshot().idx).toBe(last.start_idx);
  });
});

describe('brief 34 ε-8 integration: 観るモード中の IndexedDB / Strava 書込抑止', () => {
  it('intro mode="view" の状態で addRide callback (= viewer の guard 同等) が no-op', async () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'view' });
    // viewer 側 addRide guard を 1:1 再現 (= intro mode で先 short-circuit, history flag は無関係).
    let addRideCalled = 0;
    let statusMsg = '';
    const guardedAddRide = async (rec) => {
      const ic = getIntroConsent({ storage });
      if (ic && ic.mode === 'view') {
        statusMsg = '観るモードは記録対象外';
        return;
      }
      if (!getRideConsent('history', { storage })) {
        statusMsg = '履歴保存未同意';
        return;
      }
      addRideCalled += 1;
    };
    // 観るモードでは ride 終了時に「履歴に保存」を押しても addRide は呼ばれない.
    await guardedAddRide({ id: 'r1', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(addRideCalled).toBe(0);
    expect(statusMsg).toMatch(/観るモード/);
  });

  it('intro mode="view" → getClientId が null (= Strava upload 物理 disable)', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'view' });
    // viewer の getClientId guard を再現.
    const guardedGetClientId = () => {
      const ic = getIntroConsent({ storage });
      if (ic && ic.mode === 'view') return null;
      if (!getRideConsent('strava', { storage })) return null;
      return 'fake-client-id';
    };
    expect(guardedGetClientId()).toBe(null);
  });

  it('intro mode="ride" + history consent ON → addRide が通常通り発火 (= 観るモード以外は既存挙動維持)', async () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'ride' });
    setRideConsent({ history: true, asked: true }, { storage });
    let addRideCalled = 0;
    const guardedAddRide = async (rec) => {
      const ic = getIntroConsent({ storage });
      if (ic && ic.mode === 'view') return;
      if (!getRideConsent('history', { storage })) return;
      addRideCalled += 1;
    };
    await guardedAddRide({ id: 'r2', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    expect(addRideCalled).toBe(1);
  });
});

describe('brief 34 ε-8 integration: 「区間リストに戻る」 で ride end + section-overlay 再表示', () => {
  it('rideState.end → snapshot().active === false (= 別区間選び直し可能)', () => {
    const course = buildSimpleCourse();
    const rs = createRideState(course);
    const sections = splitCourseIntoSections(course, 10);
    rs.startFrom(sections[3].start_idx);
    expect(rs.snapshot().active).toBe(true);
    rs.end();
    expect(rs.snapshot().active).toBe(false);
    // 戻った後別 section を選び直し可能 (= startFrom が複数回呼べる).
    rs.startFrom(sections[7].start_idx);
    expect(rs.snapshot().idx).toBe(sections[7].start_idx);
    expect(rs.snapshot().active).toBe(true);
  });
});

describe('brief 34 ε-8 integration: HTML DOM 構造', () => {
  it('intro-overlay に btnIntroView (= 「コースを観る」) が追加されている', () => {
    expect(html).toMatch(/<button[^>]*id="btnIntroView"/);
  });

  it('section-overlay element + section-list ul が HTML に存在', () => {
    expect(html).toMatch(/<div\s+id="section-overlay"/);
    expect(html).toMatch(/<ul\s+id="section-list"/);
    expect(html).toMatch(/<button[^>]*id="btnSectionClose"/);
  });

  it('btnViewModeBackToList (= ride 中の区間リスト戻り button) が HTML に存在', () => {
    expect(html).toMatch(/<button[^>]*id="btnViewModeBackToList"/);
  });

  it('section-overlay の z-index は 1470 (= consent 1460 と setup 1500 の間)', () => {
    expect(html).toMatch(/#section-overlay\s*\{[^}]*z-index:\s*1470/);
  });
});

describe('brief 34 ε-8 integration: viewer-maplibre.js の source 構造', () => {
  it('viewer は course_sections.js を import している (= splitCourseIntoSections / formatSectionLabel)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/course_sections\.js['"]/);
    expect(viewer).toMatch(/splitCourseIntoSections/);
    expect(viewer).toMatch(/formatSectionLabel/);
  });

  it('initViewMode 関数が定義されている', () => {
    expect(viewer).toMatch(/function\s+initViewMode\s*\(\s*\)/);
  });

  it('dispatchAfterIntro 内で getIntroConsent().mode === "view" を check して initViewMode 分岐', () => {
    const m = viewer.match(/function\s+dispatchAfterIntro\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/getIntroConsent\(\)/);
    expect(body).toMatch(/mode\s*===?\s*['"]view['"]/);
    expect(body).toMatch(/initViewMode\(/);
  });

  it('btnIntroView click handler が setIntroConsent({mode:"view"}) + dispatchAfterIntro を呼ぶ', () => {
    expect(viewer).toMatch(/btnIntroView[\s\S]{0,300}setIntroConsent\(\{[^}]*mode:\s*['"]view['"][^}]*\}\)[\s\S]{0,300}dispatchAfterIntro\(\)/);
  });

  it('addRide / getClientId の guard に intro mode === "view" の short-circuit が含まれる (= 物理 disable の二重 gate)', () => {
    // addRide の lambda body 内に「mode === 'view'」と「return」が並ぶ.
    expect(viewer).toMatch(/addRide:\s*async[\s\S]{0,400}mode\s*===?\s*['"]view['"][\s\S]{0,200}return/);
    expect(viewer).toMatch(/getClientId:[\s\S]{0,400}mode\s*===?\s*['"]view['"][\s\S]{0,200}return\s+null/);
  });

  it('initViewMode は createTestModeClient を使う (= trainer / bridge 不要)', () => {
    const m = viewer.match(/function\s+initViewMode\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/createTestModeClient\(/);
  });

  it('renderSectionList 関数で行クリック → rideState.startFrom(section.start_idx) を呼ぶ', () => {
    expect(viewer).toMatch(/function\s+renderSectionList\s*\(/);
    // renderSectionList 内で onSelect callback で startFrom が呼ばれる (= initViewMode から渡す).
    expect(viewer).toMatch(/rideState\.startFrom\(/);
  });
});

describe('brief 34 ε-8 integration: consent.js mode 拡張', () => {
  it('setIntroConsent({mode:"view"}) → getIntroConsent().mode === "view"', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'view' });
    expect(getIntroConsent({ storage }).mode).toBe('view');
  });

  it('setIntroConsent({mode:"ride"}) → getIntroConsent().mode === "ride"', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'ride' });
    expect(getIntroConsent({ storage }).mode).toBe('ride');
  });

  it('setIntroConsent() (= mode 省略) → mode "ride" にフォールバック (= 既存挙動互換)', () => {
    const storage = memStorage();
    setIntroConsent({ storage });
    expect(getIntroConsent({ storage }).mode).toBe('ride');
  });

  it('setIntroConsent({mode:"invalid"}) → mode "ride" に倒す (= 安全寄り)', () => {
    const storage = memStorage();
    setIntroConsent({ storage, mode: 'invalid-value' });
    expect(getIntroConsent({ storage }).mode).toBe('ride');
  });
});
