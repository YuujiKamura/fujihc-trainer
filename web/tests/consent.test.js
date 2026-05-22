// brief 34 atom ε / b46: consent module の unit test (= localStorage mock).
// 3 経路 (= hash 一致 / hash 不一致 / 不在) を ride consent で pin。
// b46: intro consent (= getIntroConsent / setIntroConsent / clearIntroConsent) は
//   consent.js から撤去された (= 起動シーンを地形データローダー画面の一本道に
//   作り変え、 「説明を見た」 を localStorage に版管理する仕組みが不要になった)。
//   intro consent の unit test と HTML grep gate の intro 部分はこの test から削除。

import { describe, it, expect } from 'vitest';
import {
  RIDE_CONSENT_HASH, RIDE_CONSENT_LS_KEY,
  getRideConsent, setRideConsent, clearRideConsent,
} from '../lib/consent.js';

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _dump() { return [...m.entries()]; },
  };
}

describe('brief 34 ε-3: ride consent (= field 別 opt-in、 default OFF)', () => {
  it('未設定なら全 field false (= default OFF)', () => {
    const ls = memStorage();
    expect(getRideConsent('history', { storage: ls })).toBe(false);
    expect(getRideConsent('strava', { storage: ls })).toBe(false);
    expect(getRideConsent('asked', { storage: ls })).toBe(false);
  });

  it('setRideConsent({history: true}) → getRideConsent("history") true, strava は false', () => {
    const ls = memStorage();
    setRideConsent({ history: true, strava: false, asked: true }, { storage: ls });
    expect(getRideConsent('history', { storage: ls })).toBe(true);
    expect(getRideConsent('strava', { storage: ls })).toBe(false);
    expect(getRideConsent('asked', { storage: ls })).toBe(true);
  });

  it('全 false でも asked=true で「ダイアログ通過済」を区別可', () => {
    const ls = memStorage();
    setRideConsent({ history: false, strava: false, asked: true }, { storage: ls });
    expect(getRideConsent('asked', { storage: ls })).toBe(true);
    expect(getRideConsent('history', { storage: ls })).toBe(false);
    expect(getRideConsent('strava', { storage: ls })).toBe(false);
  });

  it('hash 不一致 (= 旧版 / 改竄) なら全 field false (= 再 consent 要求)', () => {
    const ls = memStorage();
    ls.setItem(RIDE_CONSENT_LS_KEY, JSON.stringify({
      hash: 'older-hash',
      history: true,
      strava: true,
      asked: true,
    }));
    expect(getRideConsent('history', { storage: ls })).toBe(false);
    expect(getRideConsent('strava', { storage: ls })).toBe(false);
    expect(getRideConsent('asked', { storage: ls })).toBe(false);
  });

  it('clearRideConsent で削除される', () => {
    const ls = memStorage();
    setRideConsent({ history: true, asked: true }, { storage: ls });
    expect(getRideConsent('history', { storage: ls })).toBe(true);
    clearRideConsent({ storage: ls });
    expect(getRideConsent('history', { storage: ls })).toBe(false);
    expect(getRideConsent('asked', { storage: ls })).toBe(false);
  });

  it('保存値の hash は RIDE_CONSENT_HASH と一致 (= 比較先が正本 const)', () => {
    const ls = memStorage();
    setRideConsent({ history: true, asked: true }, { storage: ls });
    const raw = JSON.parse(ls.getItem(RIDE_CONSENT_LS_KEY));
    expect(raw.hash).toBe(RIDE_CONSENT_HASH);
  });
});

describe('brief 34 ε-3 / b46: HTML / CSS grep gate (= ride consent overlay が index.html に存在)', () => {
  // viewer-maplibre.js 側の grep gate と並んで index.html 側を独立に pin.
  // b46: intro overlay は地形データローダー画面に作り変えた ── intro 文言 / btnIntro*
  //   ボタンの grep は撤去。 ride consent overlay (= consent-overlay) の grep は残す。
  const fs = require('fs');
  const path = require('path');
  const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');

  it('index.html に <div id="consent-overlay"> がある', () => {
    expect(html).toMatch(/<div\s+id="consent-overlay"/);
  });

  it('index.html に z-index 1460 (= consent-overlay) の CSS が定義済', () => {
    expect(html).toMatch(/#consent-overlay\s*\{[^}]*z-index:\s*1460/);
  });

  it('consent overlay には「履歴に保存」「Strava にアップロード」の opt-in 2 つ', () => {
    expect(html).toMatch(/id="chkConsentHistory"/);
    expect(html).toMatch(/id="chkConsentStrava"/);
  });

  it('consent overlay に accept/cancel 2 button (= 不可視 default deny を構造化)', () => {
    expect(html).toMatch(/id="btnConsentAccept"/);
    expect(html).toMatch(/id="btnConsentCancel"/);
  });
});
