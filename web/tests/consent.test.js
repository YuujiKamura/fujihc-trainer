// brief 34 atom ε: consent module の unit test (= localStorage mock).
// 3 経路 (= hash 一致 / hash 不一致 / 不在) + intro/ride 両方を pin.

import { describe, it, expect } from 'vitest';
import {
  INTRO_CONSENT_HASH, INTRO_CONSENT_LS_KEY,
  RIDE_CONSENT_HASH, RIDE_CONSENT_LS_KEY,
  getIntroConsent, setIntroConsent, clearIntroConsent,
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

describe('brief 34 ε-1: intro consent (= hash 版管理)', () => {
  it('未設定なら getIntroConsent は null (= 不在経路)', () => {
    const ls = memStorage();
    expect(getIntroConsent({ storage: ls })).toBe(null);
  });

  it('setIntroConsent → getIntroConsent で hash 一致値が返る (= 一致経路)', () => {
    const ls = memStorage();
    const now = () => new Date('2026-05-15T10:00:00Z');
    setIntroConsent({ storage: ls, now });
    const v = getIntroConsent({ storage: ls });
    expect(v).not.toBeNull();
    expect(v.hash).toBe(INTRO_CONSENT_HASH);
    expect(v.accepted_at).toBe('2026-05-15T10:00:00.000Z');
  });

  it('hash 不一致 (= 旧版 / 改竄) なら getIntroConsent は null (= 不一致経路)', () => {
    const ls = memStorage();
    ls.setItem(INTRO_CONSENT_LS_KEY, JSON.stringify({
      hash: 'older-or-tampered-hash',
      accepted_at: '2026-05-01T00:00:00.000Z',
    }));
    expect(getIntroConsent({ storage: ls })).toBe(null);
  });

  it('壊れた JSON / 非 object なら getIntroConsent は null (= 防御)', () => {
    const ls = memStorage();
    ls.setItem(INTRO_CONSENT_LS_KEY, '{not-json');
    expect(getIntroConsent({ storage: ls })).toBe(null);
    ls.setItem(INTRO_CONSENT_LS_KEY, '"just-a-string"');
    expect(getIntroConsent({ storage: ls })).toBe(null);
  });

  it('clearIntroConsent で削除される', () => {
    const ls = memStorage();
    setIntroConsent({ storage: ls });
    expect(getIntroConsent({ storage: ls })).not.toBeNull();
    clearIntroConsent({ storage: ls });
    expect(getIntroConsent({ storage: ls })).toBe(null);
  });
});

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

describe('brief 34 ε-1: HTML / CSS grep gate (= intro/consent overlay が index.html に存在)', () => {
  // viewer-maplibre.js 側の grep gate と並んで index.html 側を独立に pin.
  // 既存 static_mode.test.js / viewer_url_audit.test.js とは独立。
  const fs = require('fs');
  const path = require('path');
  const INDEX_PATH = path.resolve(__dirname, '..', 'index.html');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');

  it('index.html に <div id="intro-overlay"> がある', () => {
    expect(html).toMatch(/<div\s+id="intro-overlay"/);
  });

  it('index.html に z-index 1450 (= intro-overlay) の CSS が定義済', () => {
    expect(html).toMatch(/#intro-overlay\s*\{[^}]*z-index:\s*1450/);
  });

  it('index.html に <div id="consent-overlay"> がある', () => {
    expect(html).toMatch(/<div\s+id="consent-overlay"/);
  });

  it('index.html に z-index 1460 (= consent-overlay) の CSS が定義済', () => {
    expect(html).toMatch(/#consent-overlay\s*\{[^}]*z-index:\s*1460/);
  });

  it('intro 文言: 「練習補助シミュレータ」「公式認定なし」「GPS データで誤差」「サーバ送信なし」の 4 軸が揃う', () => {
    expect(html).toMatch(/練習補助シミュレータ/);
    expect(html).toMatch(/公式が認定\s*\/\s*後援するアプリではなく/);
    expect(html).toMatch(/GPS データで.*誤差/);
    expect(html).toMatch(/サーバ送信なし/);
  });

  it('consent overlay には「履歴に保存」「Strava にアップロード」の opt-in 2 つ', () => {
    expect(html).toMatch(/id="chkConsentHistory"/);
    expect(html).toMatch(/id="chkConsentStrava"/);
  });

  it('intro/consent overlay に accept/cancel 2 button (= 不可視 default deny を構造化)', () => {
    expect(html).toMatch(/id="btnIntroClose"/);
    expect(html).toMatch(/id="btnIntroDemo"/);
    expect(html).toMatch(/id="btnConsentAccept"/);
    expect(html).toMatch(/id="btnConsentCancel"/);
  });
});
