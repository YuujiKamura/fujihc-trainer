// preflight_check.js の unit test.
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  checkCourse, checkTrainer, checkHrm, checkPastRides, checkConsent,
  checkIndexedDB, runPreflight, aggregateLevel,
} from '../lib/preflight_check.js';

function mkCourse(n = 100, opts = {}) {
  const out = [];
  const startLat = opts.startLat ?? 35.36;
  const startLon = opts.startLon ?? 138.59;
  const endLat = opts.endLat ?? 35.40;
  const endLon = opts.endLon ?? 138.73;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push({
      lat: startLat + (endLat - startLat) * t,
      lon: startLon + (endLon - startLon) * t,
      distance_m: t * 24000,
    });
  }
  return out;
}

describe('checkCourse', () => {
  it('正常 course は ok', () => {
    const result = checkCourse(mkCourse(200));
    const courseFail = result.filter((r) => r.level === 'fail');
    expect(courseFail.length).toBe(0);
  });

  it('空 course は fail', () => {
    const result = checkCourse([]);
    expect(result.some((r) => r.level === 'fail')).toBe(true);
  });

  it('起点 = 終点 (= 全 lat/lon が同一) は warn', () => {
    const course = mkCourse(200, { endLat: 35.36, endLon: 138.59 });
    const result = checkCourse(course);
    expect(result.some((r) => r.level === 'warn')).toBe(true);
  });
});

describe('checkTrainer', () => {
  it('connected + 全 sensor 値ありで ok', () => {
    const result = checkTrainer({ connected: true, power: 200, cadence: 85, hr: 142 });
    expect(result.every((r) => r.level === 'ok')).toBe(true);
  });

  it('未接続は fail', () => {
    const result = checkTrainer({ connected: false, power: null, cadence: null, hr: null });
    expect(result[0].level).toBe('fail');
  });

  it('connected + sensor null は warn', () => {
    const result = checkTrainer({ connected: true, power: null, cadence: null, hr: null });
    expect(result.find((r) => r.key === 'power').level).toBe('warn');
  });
});

describe('checkHrm', () => {
  it('available=false なら空', () => {
    expect(checkHrm({ available: false })).toEqual([]);
  });

  it('available + connected で ok', () => {
    const result = checkHrm({ available: true, connected: true });
    expect(result[0].level).toBe('ok');
  });

  it('available + 未接続で warn', () => {
    const result = checkHrm({ available: true, connected: false });
    expect(result[0].level).toBe('warn');
  });
});

describe('checkPastRides', () => {
  it('過去 0 件で count 行のみ', () => {
    const r = checkPastRides([]);
    expect(r.length).toBe(1);
    expect(r[0].value).toMatch(/0 件/);
  });

  it('直近 ride に lat 固定があると warn 追加', () => {
    const latest = {
      summary: { distance_m: 5000 },
      trkpts: new Array(50).fill(0).map((_, i) => ({ lat: 35.36, lon: 138.59 + i * 0.0001 })),
    };
    const r = checkPastRides([latest]);
    expect(r.some((it) => it.level === 'warn')).toBe(true);
  });

  it('直近 ride が distance 0 で warn', () => {
    const latest = {
      summary: { distance_m: 50 },
      trkpts: new Array(50).fill(0).map((_, i) => ({ lat: 35.36 + i * 0.0001, lon: 138.59 })),
    };
    const r = checkPastRides([latest]);
    expect(r.some((it) => it.value && it.value.includes('距離 0'))).toBe(true);
  });
});

describe('checkConsent', () => {
  it('history/strava の状態を反映', () => {
    const r = checkConsent({ history: true, strava: false });
    expect(r.find((it) => it.key === 'consent-history').value).toBe('ON');
    expect(r.find((it) => it.key === 'consent-strava').value).toBe('OFF');
  });
});

describe('checkIndexedDB', () => {
  beforeEach(async () => {
    // 各 test 前に probe DB を消す
    await new Promise((resolve) => {
      const req = globalThis.indexedDB.deleteDatabase('fujihill-preflight-probe');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('fake-indexeddb 環境で put / get が成功', async () => {
    const r = await checkIndexedDB();
    expect(r.level).toBe('ok');
  });
});

describe('aggregateLevel', () => {
  it('fail が 1 つでもあれば fail', () => {
    expect(aggregateLevel([{ level: 'ok' }, { level: 'fail' }, { level: 'warn' }])).toBe('fail');
  });

  it('warn と ok のみなら warn', () => {
    expect(aggregateLevel([{ level: 'ok' }, { level: 'warn' }])).toBe('warn');
  });

  it('全 ok なら ok', () => {
    expect(aggregateLevel([{ level: 'ok' }, { level: 'ok' }])).toBe('ok');
  });
});

describe('runPreflight', () => {
  beforeEach(async () => {
    await new Promise((resolve) => {
      const req = globalThis.indexedDB.deleteDatabase('fujihill-preflight-probe');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('全 ok の入力で level=ok', async () => {
    const result = await runPreflight({
      course: mkCourse(200),
      trainer: { connected: true, power: 200, cadence: 85, hr: 142 },
      pastRides: [],
      consent: { history: true, strava: false },
    });
    expect(result.level).toBe('ok');
    expect(result.items.length).toBeGreaterThan(5);
  });

  it('trainer 未接続で level=fail', async () => {
    const result = await runPreflight({
      course: mkCourse(200),
      trainer: { connected: false, power: null, cadence: null, hr: null },
      consent: { history: true, strava: false },
    });
    expect(result.level).toBe('fail');
  });
});
