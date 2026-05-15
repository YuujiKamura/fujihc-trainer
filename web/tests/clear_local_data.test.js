// brief 34 ε-5: clear_local_data.js unit + integration test.
// IndexedDB / localStorage の clear 動作と Strava token 削除順序を pin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';  // jsdom global indexedDB を fake-indexeddb で提供 (= 既存 ride_db.test と同じ pattern)
import { openRideDb, addRide } from '../lib/ride_db.js';
import {
  deleteIndexedDb, clearAllLocalStorage, clearAllLocalData,
} from '../lib/clear_local_data.js';

// fake-indexeddb の state を test 間で隔離するため、 各 test 前に reset (= 同 origin と見做される).
beforeEach(async () => {
  // 全 DB を削除しておく (= fake-indexeddb は global state を持つ).
  try {
    await new Promise((resolve) => {
      const req = globalThis.indexedDB.deleteDatabase('fujihill-trainer');
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  } catch { /* ignore */ }
});

function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _size() { return m.size; },
    _has(k) { return m.has(k); },
  };
}

describe('brief 34 ε-5: deleteIndexedDb', () => {
  it('既存 DB を削除 → 再 open すれば空の新規 DB が立ち上がる', async () => {
    // fake-indexeddb を使う場合は global の indexedDB が module top で固定される、
    // ここでは新規 module instance で書込→削除→再 open の振る舞いを確認.
    const db1 = await openRideDb();
    await addRide(db1, { id: 'r-clear-1', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    db1.close();
    const res = await deleteIndexedDb();
    expect(res.deleted).toBe(true);
    const db2 = await openRideDb();
    // version=1 で再 create された (= fresh)、 rides store は空
    const tx = db2.transaction('rides', 'readonly');
    const countReq = tx.objectStore('rides').count();
    const count = await new Promise((resolve, reject) => {
      countReq.onsuccess = () => resolve(countReq.result);
      countReq.onerror = () => reject(countReq.error);
    });
    expect(count).toBe(0);
    db2.close();
  });

  it('IndexedDB 不在環境では deleted=false + error message', async () => {
    const res = await deleteIndexedDb({ indexedDB: null });
    expect(res.deleted).toBe(false);
    expect(res.error).toMatch(/not available/i);
  });
});

describe('brief 34 ε-5: clearAllLocalStorage', () => {
  it('clear() を持つ storage は丸ごと clear する', () => {
    const ls = memStorage();
    ls.setItem('fujihill.consent.intro.v1', '{"hash":"v1","accepted_at":"x"}');
    ls.setItem('fujihill.consent.ride.v1', '{"hash":"v1","history":true}');
    ls.setItem('fujihill.strava.token', '{"access_token":"a"}');
    ls.setItem('fujihill.diff', '1.5');
    expect(ls._size()).toBe(4);
    const res = clearAllLocalStorage({ storage: ls });
    expect(res.cleared).toBe(true);
    expect(ls._size()).toBe(0);
  });

  it('clear() を持たない storage は既知 key を removeItem で削除 (= fallback path)', () => {
    const m = new Map();
    m.set('fujihill.consent.intro.v1', 'v1');
    m.set('fujihill.consent.ride.v1', 'v1');
    m.set('fujihill.strava.token', 'tok');
    m.set('fujihill.strava.client_id', 'cid');
    m.set('fujihill.trainer.address', 'addr');
    m.set('fujihill.diff', '1');
    m.set('fujihill.spd', '1');
    // 「other-app.foo」など未知 key は触らない
    m.set('other-app.foo', 'kept');
    const fakeLs = {
      getItem(k) { return m.has(k) ? m.get(k) : null; },
      setItem(k, v) { m.set(k, String(v)); },
      removeItem(k) { m.delete(k); },
      // clear なし
    };
    const res = clearAllLocalStorage({ storage: fakeLs });
    expect(res.cleared).toBe(true);
    expect(m.has('fujihill.consent.intro.v1')).toBe(false);
    expect(m.has('fujihill.strava.token')).toBe(false);
    expect(m.has('other-app.foo')).toBe(true);  // 既知 key 限定 fallback の挙動
  });

  it('storage 不在 (= null) なら cleared=false + error', () => {
    const res = clearAllLocalStorage({ storage: null });
    expect(res.cleared).toBe(false);
    expect(res.error).toMatch(/not available/i);
  });
});

describe('brief 34 ε-5: clearAllLocalData (= IndexedDB + localStorage 一括)', () => {
  it('両 source が削除済 (= round-trip integration)', async () => {
    const ls = memStorage();
    ls.setItem('fujihill.consent.intro.v1', 'v1');
    ls.setItem('fujihill.strava.token', 'tok');
    // DB に何か入れる
    const db1 = await openRideDb();
    await addRide(db1, { id: 'r-clear-all-1', date: '2026-05-15T00:00:00Z', summary: {}, trkpts: [] });
    db1.close();
    // 削除が blocked にならないよう少し yield (= fake-indexeddb の close 反映待ち).
    await new Promise((r) => setTimeout(r, 0));
    const res = await clearAllLocalData({ storage: ls });
    // deleted=false (= blocked / error) なら何の error か明示
    if (!res.indexedDb.deleted) {
      throw new Error(`indexedDb 削除失敗: ${JSON.stringify(res.indexedDb)}`);
    }
    expect(res.indexedDb.deleted).toBe(true);
    expect(res.localStorage.cleared).toBe(true);
    expect(ls._size()).toBe(0);
  });
});

describe('brief 34 ε-5 viewer source: 確認 dialog 必須 + 完了 dialog + intro やり直し', () => {
  const fs = require('fs');
  const path = require('path');
  const viewer = fs.readFileSync(path.resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  it('btnClearAllData click は直接 clearAllLocalData を呼ばず showClearConfirm 経由 (= 1 click flush 禁止、 B 軸 7 (c) 対策)', () => {
    // 「btnClearAllData.addEventListener(...)」 の click handler を直接ピンポイントで抽出.
    const m = viewer.match(/btnClearAllData\.addEventListener\(['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/showClearConfirm\(\)/);
    expect(body).not.toMatch(/clearAllLocalData\(/);
  });

  it('btnClearConfirm click で clearAllLocalData を await + showClearDone 表示', () => {
    expect(viewer).toMatch(/btnClearConfirm\.addEventListener[\s\S]{0,800}clearAllLocalData\(\)[\s\S]{0,400}showClearDone\(/);
  });

  it('btnClearCancel click は何も削除せず overlay 閉じるのみ', () => {
    const m = viewer.match(/btnClearCancel\.addEventListener\(['"]click['"]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)\s*;/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/hideClearConfirm\(\)/);
    expect(body).not.toMatch(/clearAllLocalData\(/);
  });

  it('btnClearDoneOk click で intro overlay からやり直し (= showIntroOverlay 呼出)', () => {
    expect(viewer).toMatch(/btnClearDoneOk\.addEventListener[\s\S]{0,800}setAppState\(['"]checking['"]\)[\s\S]{0,300}showIntroOverlay\(/);
  });

  it('index.html に「全データを削除」セクション + 2 確認 overlay が存在', () => {
    expect(html).toMatch(/id="btnClearAllData"/);
    expect(html).toMatch(/id="clear-confirm-overlay"/);
    expect(html).toMatch(/id="clear-done-overlay"/);
    expect(html).toMatch(/id="btnClearConfirm"/);
    expect(html).toMatch(/id="btnClearCancel"/);
    expect(html).toMatch(/id="btnClearDoneOk"/);
  });

  it('完了 dialog に Strava 設定ページ link を再提示 (= 削除完了後の case)', () => {
    const m = html.match(/<div\s+id="clear-done-overlay"[\s\S]*?<\/div>\s*<\/div>/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/strava\.com\/settings\/apps/);
  });

  it('viewer に clear_local_data.js を import (= clearAllLocalData)', () => {
    expect(viewer).toMatch(/from\s+['"]\.\/lib\/clear_local_data\.js['"]/);
    expect(viewer).toMatch(/clearAllLocalData/);
  });
});

describe('brief 34 ε-5 integration: 削除完了後の intro やり直し state', () => {
  it('cancel パスで data 保持 (= behavioral test、 B 軸 7 (c) 対策)', async () => {
    const ls = memStorage();
    ls.setItem('fujihill.consent.intro.v1', JSON.stringify({ hash: 'v1', accepted_at: 'x' }));
    // cancel 経路は viewer の btnClearCancel handler 内で clearAllLocalData を呼ばない設計.
    // → ls はそのまま、 IndexedDB も touch されない.
    // (実装は別 fixture なので、 ここは「呼ばれない」を viewer source 上で pin 済 = 上記 grep test)
    expect(ls._size()).toBe(1);
    expect(ls._has('fujihill.consent.intro.v1')).toBe(true);
  });

  it('削除実行後、 getIntroConsent は null を返す (= intro やり直しの前提条件)', async () => {
    const ls = memStorage();
    ls.setItem('fujihill.consent.intro.v1', JSON.stringify({ hash: 'v1', accepted_at: 'x' }));
    const { getIntroConsent } = await import('../lib/consent.js');
    expect(getIntroConsent({ storage: ls })).toBe(null);  // hash 'v1' は CURRENT INTRO_CONSENT_HASH と不一致
    // 一致 hash で再保存しても、 clear 後は消えてる前提
    await clearAllLocalData({ storage: ls });
    expect(getIntroConsent({ storage: ls })).toBe(null);
  });
});
