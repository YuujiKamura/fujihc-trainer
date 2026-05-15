// ride_autosave.js の unit test (= fake-indexeddb 経由).
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  AUTOSAVE_DB_NAME, AUTOSAVE_STORE, AUTOSAVE_KEY, AUTOSAVE_INTERVAL_MS,
  saveAutosave, loadAutosave, clearAutosave, hasPendingAutosave,
} from '../lib/ride_autosave.js';

beforeEach(async () => {
  await new Promise((resolve) => {
    const req = globalThis.indexedDB.deleteDatabase(AUTOSAVE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('autosave consts', () => {
  it('export 名が固定', () => {
    expect(AUTOSAVE_DB_NAME).toBe('fujihill-trainer-autosave');
    expect(AUTOSAVE_STORE).toBe('autosave');
    expect(AUTOSAVE_KEY).toBe('current');
    expect(AUTOSAVE_INTERVAL_MS).toBe(30 * 1000);
  });
});

describe('saveAutosave / loadAutosave', () => {
  it('save → load で同じ内容が返る', async () => {
    const rec = {
      rideStartedAt: '2026-05-15T09:00:00.000Z',
      distanceM: 12345.6,
      courseName: 'fujihill',
      trkpts: [
        { t: '2026-05-15T09:00:01.000Z', lat: 35.36, lon: 138.59, ele: 1000, power: 200, cad: 85, hr: 142 },
        { t: '2026-05-15T09:00:02.000Z', lat: 35.37, lon: 138.60, ele: 1010, power: 210, cad: 86, hr: 144 },
      ],
    };
    await saveAutosave(rec);
    const loaded = await loadAutosave();
    expect(loaded.rideStartedAt).toBe(rec.rideStartedAt);
    expect(loaded.distanceM).toBe(rec.distanceM);
    expect(loaded.courseName).toBe('fujihill');
    expect(loaded.trkpts.length).toBe(2);
    expect(loaded.ended).toBe(false);
    expect(typeof loaded.lastSavedAt).toBe('string');
  });

  it('save 連続呼びで上書き', async () => {
    await saveAutosave({ rideStartedAt: 'A', distanceM: 100, trkpts: [] });
    await saveAutosave({ rideStartedAt: 'B', distanceM: 200, trkpts: [{ t: 'x', lat: 35, lon: 138 }] });
    const loaded = await loadAutosave();
    expect(loaded.rideStartedAt).toBe('B');
    expect(loaded.distanceM).toBe(200);
    expect(loaded.trkpts.length).toBe(1);
  });
});

describe('clearAutosave', () => {
  it('save 後の clear で load が null', async () => {
    await saveAutosave({ rideStartedAt: 'A', distanceM: 100, trkpts: [{ t: 'x', lat: 35, lon: 138 }] });
    await clearAutosave();
    const loaded = await loadAutosave();
    expect(loaded).toBeNull();
  });

  it('save 前の clear でもエラーにならない', async () => {
    await expect(clearAutosave()).resolves.not.toThrow();
  });
});

describe('hasPendingAutosave', () => {
  it('未 save なら false', async () => {
    expect(await hasPendingAutosave()).toBe(false);
  });

  it('save 後 ended=false で true', async () => {
    await saveAutosave({ rideStartedAt: 'A', distanceM: 100, trkpts: [{ t: 'x', lat: 35, lon: 138 }] });
    expect(await hasPendingAutosave()).toBe(true);
  });

  it('save 後 ended=true なら false (= ride 終了済)', async () => {
    await saveAutosave({ rideStartedAt: 'A', distanceM: 100, trkpts: [{ t: 'x', lat: 35, lon: 138 }], ended: true });
    expect(await hasPendingAutosave()).toBe(false);
  });

  it('trkpts 空なら false (= 実質未開始)', async () => {
    await saveAutosave({ rideStartedAt: 'A', distanceM: 0, trkpts: [] });
    expect(await hasPendingAutosave()).toBe(false);
  });
});

describe('integration: ride 中の cycle', () => {
  it('30 秒毎 save → 完走 clear で復元 dialog が出ない', async () => {
    // 開始 → 30s → 60s → 90s と save、 終了 clear
    for (let i = 1; i <= 3; i++) {
      await saveAutosave({
        rideStartedAt: '2026-05-15T09:00:00.000Z',
        distanceM: i * 1000,
        trkpts: new Array(i * 30).fill(0).map((_, j) => ({ t: `t${j}`, lat: 35.36 + j * 0.0001, lon: 138.59 })),
      });
    }
    expect(await hasPendingAutosave()).toBe(true);
    await clearAutosave();
    expect(await hasPendingAutosave()).toBe(false);
  });

  it('途中で session 終了 (= clear なし) → 復元対象', async () => {
    await saveAutosave({
      rideStartedAt: '2026-05-15T09:00:00.000Z',
      distanceM: 5000,
      trkpts: new Array(60).fill(0).map((_, j) => ({ t: `t${j}`, lat: 35.36 + j * 0.0001, lon: 138.59 })),
    });
    expect(await hasPendingAutosave()).toBe(true);
    const rec = await loadAutosave();
    expect(rec.distanceM).toBe(5000);
    expect(rec.trkpts.length).toBe(60);
  });
});
