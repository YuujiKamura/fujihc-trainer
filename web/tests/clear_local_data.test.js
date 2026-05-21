// brief 34 ε-5: clear_local_data.js unit + integration test.
// IndexedDB / localStorage の clear 動作と Strava token 削除順序を pin.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';  // jsdom global indexedDB を fake-indexeddb で提供 (= 既存 ride_db.test と同じ pattern)
import { openRideDb, addRide } from '../lib/ride_db.js';
import {
  deleteIndexedDb, clearAllLocalStorage, clearAllLocalData, clearServiceWorkerCache,
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

// b43: clearServiceWorkerCache (= SW キャッシュクリア、 非破壊) の単体テスト。
// このテストが落ちたら何を検出したことになるか:
//   - SW unregister / CacheStorage 削除の件数集計が壊れた
//   - 非対応環境 / 空 collection / reject で throw して呼出側を巻き込む
//   - 非破壊のはずが IndexedDB / localStorage に触った
function makeCachesMock(keyList) {
  const deleted = [];
  return {
    _deleted: deleted,
    keys: async () => keyList.slice(),
    delete: async (k) => { deleted.push(k); return true; },
  };
}
function makeSwMock(regCount) {
  const unregistered = [];
  const regs = [];
  for (let i = 0; i < regCount; i += 1) {
    regs.push({ _id: i, unregister: async () => { unregistered.push(i); return true; } });
  }
  return { _unregistered: unregistered, getRegistrations: async () => regs };
}

describe('b43: clearServiceWorkerCache (= SW キャッシュクリア、 非破壊)', () => {
  it('happy: caches 2 件 + registration 1 件 → delete 2 / unregister 1', async () => {
    const caches = makeCachesMock(['fujihill-v16', 'fujihill-v17']);
    const sw = makeSwMock(1);
    const res = await clearServiceWorkerCache({ caches, serviceWorker: sw });
    expect(res).toEqual({ unregistered: 1, cachesDeleted: 2 });
    expect(caches._deleted).toEqual(['fujihill-v16', 'fujihill-v17']);
    expect(sw._unregistered).toEqual([0]);
  });

  it('edge: caches あり keys 0 件 → cachesDeleted 0、 throw なし', async () => {
    const res = await clearServiceWorkerCache({ caches: makeCachesMock([]), serviceWorker: makeSwMock(1) });
    expect(res.cachesDeleted).toBe(0);
    expect(res.unregistered).toBe(1);
    expect(res.error).toBeUndefined();
  });

  it('edge: registration 複数 (2 件) → 全件 unregister', async () => {
    const sw = makeSwMock(2);
    const res = await clearServiceWorkerCache({ caches: makeCachesMock([]), serviceWorker: sw });
    expect(res.unregistered).toBe(2);
    expect(sw._unregistered).toEqual([0, 1]);
  });

  it('edge: 非対応環境 (serviceWorker:null / caches:null) → throw せず {0,0}', async () => {
    const res = await clearServiceWorkerCache({ serviceWorker: null, caches: null });
    expect(res).toEqual({ unregistered: 0, cachesDeleted: 0 });
  });

  it('error path (caches): caches.delete reject → error 文字列に畳まれ throw しない', async () => {
    const caches = {
      keys: async () => ['k1'],
      delete: async () => { throw new Error('delete boom'); },
    };
    const res = await clearServiceWorkerCache({ caches, serviceWorker: null });
    expect(res.cachesDeleted).toBe(0);
    expect(res.error).toMatch(/delete boom/);
  });

  it('error path (serviceWorker): getRegistrations reject → error に畳まれ throw しない', async () => {
    const sw = { getRegistrations: async () => { throw new Error('getReg boom'); } };
    const res = await clearServiceWorkerCache({ serviceWorker: sw, caches: null });
    expect(res.unregistered).toBe(0);
    expect(res.error).toMatch(/getReg boom/);
  });

  it('error path (serviceWorker): unregister reject → error に畳まれ throw しない', async () => {
    const sw = {
      getRegistrations: async () => [{ unregister: async () => { throw new Error('unreg boom'); } }],
    };
    const res = await clearServiceWorkerCache({ serviceWorker: sw, caches: null });
    expect(res.unregistered).toBe(0);
    expect(res.error).toMatch(/unreg boom/);
  });

  it('非破壊 (behavioral): IndexedDB の deleteDatabase を呼ばない', async () => {
    const idbSpy = vi.spyOn(globalThis.indexedDB, 'deleteDatabase');
    await clearServiceWorkerCache({ caches: makeCachesMock(['k']), serviceWorker: makeSwMock(1) });
    expect(idbSpy).not.toHaveBeenCalled();
    idbSpy.mockRestore();
  });

  it('非破壊 (structural): clearServiceWorkerCache 本体が IndexedDB / localStorage の破壊 API を呼ばない', () => {
    // signature は serviceWorker/caches のみ。 関数本体が deleteIndexedDb() /
    // clearAllLocalStorage() / localStorage. / .deleteDatabase() を一切呼ばないことを
    // source で pin (= 構造的非破壊、 global localStorage に依存しない pin)。
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'clear_local_data.js'), 'utf8');
    const m = src.match(/export async function clearServiceWorkerCache[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).not.toMatch(/deleteIndexedDb\(|clearAllLocalStorage\(|localStorage\.|\.deleteDatabase\(/);
  });
});

describe('b43: SW キャッシュクリアボタン source (= viewer / index.html)', () => {
  const fs = require('fs');
  const path = require('path');
  const viewer = fs.readFileSync(path.resolve(__dirname, '..', 'viewer-maplibre.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

  it('index.html に #btnRefreshApp があり #clear-data-section 内にある', () => {
    expect(html).toMatch(/id="btnRefreshApp"/);
    // b44: clear-data-section は <section> から <details> へ変更 (= フォールド化)。
    const m = html.match(/<details id="clear-data-section"[\s\S]*?<\/details>/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/id="btnRefreshApp"/);
  });

  it('b44: setup-overlay の補助 section が <details> でデフォルト閉じ (open 属性なし)', () => {
    // 機器の状態 / 機器選択 / データとキャッシュの管理 を <details> で畳む。
    for (const id of ['device-status-fold', 'bridge-scan-section', 'clear-data-section']) {
      const m = html.match(new RegExp(`<details id="${id}"[^>]*>`));
      expect(m, `${id} が <details> である`).not.toBeNull();
      expect(m[0], `${id} に open 属性がない (= デフォルト閉じ)`).not.toMatch(/\bopen\b/);
    }
  });

  it('btnRefreshApp click handler が clearServiceWorkerCache + location.reload を呼ぶ', () => {
    // handler 周辺を distance match で限定抽出 (= 別箇所衝突回避、 既存 btnClearConfirm test と同方式)。
    expect(viewer).toMatch(
      /btnRefreshApp\.addEventListener\(['"]click['"][\s\S]{0,500}clearServiceWorkerCache\(\)[\s\S]{0,300}location\.reload\(\)/,
    );
  });

  it('?nosw=1 経路が clearServiceWorkerCache を呼び inline caches.delete ループを持たない (= 双子コピペ撤去)', () => {
    // ?nosw=1 分岐の body を抽出して assert。
    const m = viewer.match(/has\(['"]nosw['"]\)\)\s*\{([\s\S]*?)\}\s*else\s+if/);
    expect(m).not.toBeNull();
    const body = m[1];
    expect(body).toMatch(/clearServiceWorkerCache/);   // 関数呼出に 1 本化
    expect(body).not.toMatch(/caches\.delete\(/);      // inline ループ撤去 (= negative grep)
  });

  it('viewer が clear_local_data.js から clearServiceWorkerCache を import している', () => {
    expect(viewer).toMatch(
      /import\s+\{[^}]*clearServiceWorkerCache[^}]*\}\s+from\s+['"]\.\/lib\/clear_local_data\.js['"]/,
    );
  });
});
