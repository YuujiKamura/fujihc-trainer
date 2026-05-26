// b72 weather step 1: AMeDAS client の data shape + 富士山周辺観測点抽出を pin。
// 実 endpoint は叩かない (= test 環境で配布元に通信 0)、 fetch は vi.fn で mock。

import { describe, it, expect, vi } from 'vitest';
import {
  FUJI_AMEDAS_STATIONS,
  fetchLatestTime,
  fetchAmedasMap,
  pickFujiStations,
  fetchFujiWeather,
  AMEDAS_CACHE_KEY,
  AMEDAS_CACHE_TTL_MS,
} from '../lib/weather/jma_amedas.js';

// b117: localStorage 互換の最小モック (= setItem/getItem だけ持つオブジェクト).
function makeMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    _dump: () => ({ ...store }),
  };
}

describe('FUJI_AMEDAS_STATIONS', () => {
  it('5 観測点 (= 河口湖 / 山中 / 古関 / 御殿場 / 富士山頂) を持つ', () => {
    expect(FUJI_AMEDAS_STATIONS).toHaveLength(5);
    expect(FUJI_AMEDAS_STATIONS.map((s) => s.code)).toEqual([
      '49251', '49256', '49196', '50136', '50066',
    ]);
  });

  it('全観測点が lat / lon / alt / name を持つ', () => {
    for (const s of FUJI_AMEDAS_STATIONS) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.lat).toBe('number');
      expect(typeof s.lon).toBe('number');
      expect(typeof s.alt).toBe('number');
      expect(s.lat).toBeGreaterThan(35);
      expect(s.lat).toBeLessThan(36);
      expect(s.lon).toBeGreaterThan(138);
      expect(s.lon).toBeLessThan(139);
    }
  });

  it('富士山頂 (50066) は alt 3775m', () => {
    const summit = FUJI_AMEDAS_STATIONS.find((s) => s.code === '50066');
    expect(summit.alt).toBe(3775);
  });
});

describe('fetchLatestTime', () => {
  it('ISO 8601 を YYYYMMDDHHMMSS の 14 桁に変換', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => '2026-05-24T05:10:00+09:00',
    }));
    const ts = await fetchLatestTime(fetchImpl);
    expect(ts).toBe('20260524' + '051000');
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/latest_time\.txt$/));
  });

  it('HTTP エラーで throw', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(fetchLatestTime(fetchImpl)).rejects.toThrow(/503/);
  });
});

describe('fetchAmedasMap', () => {
  it('timestamp 付き URL で fetch、 json を返す', async () => {
    const data = { 49251: { temp: [10.5, 0] } };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => data,
    }));
    const result = await fetchAmedasMap('20260524' + '051000', fetchImpl);
    expect(result).toEqual(data);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/map\/20260524\d{6}\.json$/));
  });
});

describe('pickFujiStations', () => {
  it('品質 0 (= 正常) の値だけ抽出、 それ以外は null', () => {
    const map = {
      49251: { temp: [15.3, 0], humidity: [70, 0], pressure: [950.2, 0] },
      49256: { temp: [12.1, 0], humidity: [80, 1] },  // humidity 品質 1 = 欠測
      50066: { temp: [-2.5, 0], wind: [8.4, 0], windDirection: [9, 0] },
    };
    const picked = pickFujiStations(map);
    const k = picked.find((s) => s.code === '49251');
    expect(k.temp).toBe(15.3);
    expect(k.humidity).toBe(70);
    expect(k.pressure).toBe(950.2);
    const y = picked.find((s) => s.code === '49256');
    expect(y.temp).toBe(12.1);
    expect(y.humidity).toBeNull();  // 品質 1 で欠測扱い
    const summit = picked.find((s) => s.code === '50066');
    expect(summit.temp).toBe(-2.5);
    expect(summit.wind).toBe(8.4);
    expect(summit.humidity).toBeNull();  // 富士山頂は湿度センサーなし
  });

  it('観測点が map に無い (= 通信不全 etc) なら全項目 null だが station meta は維持', () => {
    const picked = pickFujiStations({});
    expect(picked).toHaveLength(5);
    for (const s of picked) {
      expect(s.temp).toBeNull();
      expect(s.name).toBeTruthy();
      expect(s.lat).toBeGreaterThan(35);
    }
  });
});

describe('fetchFujiWeather + 10 分 cache (b117)', () => {
  it('AMEDAS_CACHE_TTL_MS は 10 分 (= 600,000 ms)', () => {
    expect(AMEDAS_CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('cache hit (= 保存時刻 + 10 分以内) なら fetch しないで cache を返す', async () => {
    const T0 = 1_000_000;  // 任意の固定時刻
    const storage = makeMockStorage({
      [AMEDAS_CACHE_KEY]: JSON.stringify({
        savedAtMs: T0,
        timestamp: '20260524' + '051000',
        stations: [{ code: '49251', name: '河口湖', lat: 35.5, lon: 138.76, alt: 860, temp: 18.2 }],
      }),
    });
    const fetchImpl = vi.fn();
    const result = await fetchFujiWeather(fetchImpl, {
      storage, now: () => T0 + 9 * 60 * 1000,  // 9 分後 = ttl 以内
    });
    expect(fetchImpl).not.toHaveBeenCalled();  // 配布元に当たらない
    expect(result.fromCache).toBe(true);
    expect(result.timestamp).toBe('20260524' + '051000');
    expect(result.stations[0].temp).toBe(18.2);
  });

  it('cache miss (= 10 分超過) なら fetch して cache 更新する', async () => {
    const T0 = 1_000_000;
    const storage = makeMockStorage({
      [AMEDAS_CACHE_KEY]: JSON.stringify({
        savedAtMs: T0,
        timestamp: '20260524' + '051000',
        stations: [{ code: '49251', temp: 18.2 }],
      }),
    });
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('latest_time.txt')) return { ok: true, text: async () => '2026-05-24T05:20:00+09:00' };
      return { ok: true, json: async () => ({ 49251: { temp: [19.5, 0] } }) };
    });
    const result = await fetchFujiWeather(fetchImpl, {
      storage, now: () => T0 + 11 * 60 * 1000,  // 11 分後 = ttl 超
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.fromCache).toBeUndefined();
    expect(result.timestamp).toBe('20260524' + '052000');
    // cache 更新を確認
    const saved = JSON.parse(storage._dump()[AMEDAS_CACHE_KEY]);
    expect(saved.timestamp).toBe('20260524' + '052000');
    expect(saved.savedAtMs).toBe(T0 + 11 * 60 * 1000);
  });

  it('cache 空 (= 初回起動) なら fetch して cache に保存する', async () => {
    const storage = makeMockStorage({});
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('latest_time.txt')) return { ok: true, text: async () => '2026-05-24T05:10:00+09:00' };
      return { ok: true, json: async () => ({ 49251: { temp: [15.0, 0] } }) };
    });
    const result = await fetchFujiWeather(fetchImpl, {
      storage, now: () => 1_716_500_000_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);  // latest_time + map
    expect(result.fromCache).toBeUndefined();
    expect(storage._dump()[AMEDAS_CACHE_KEY]).toBeTruthy();
  });

  it('fetch 失敗 + stale cache あり → stale を返す (= 配布元 down の保険)', async () => {
    const T0 = 1_000_000;
    const storage = makeMockStorage({
      [AMEDAS_CACHE_KEY]: JSON.stringify({
        savedAtMs: T0,
        timestamp: '20260524' + '051000',
        stations: [{ code: '49251', temp: 18.2 }],
      }),
    });
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    const result = await fetchFujiWeather(fetchImpl, {
      storage, now: () => T0 + 30 * 60 * 1000,  // 30 分後 (= ttl 超、 stale 領域)
    });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.stale).toBe(true);
    expect(result.timestamp).toBe('20260524' + '051000');
  });

  it('fetch 失敗 + cache 無 → throw', async () => {
    const storage = makeMockStorage({});
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    await expect(fetchFujiWeather(fetchImpl, { storage, now: () => 0 })).rejects.toThrow(/network down/);
  });

  it('opts 省略 (= 旧 caller / test 互換) で cache off、 毎回 fetch する', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('latest_time.txt')) return { ok: true, text: async () => '2026-05-24T05:10:00+09:00' };
      return { ok: true, json: async () => ({}) };
    });
    await fetchFujiWeather(fetchImpl);  // 1 回目
    await fetchFujiWeather(fetchImpl);  // 2 回目 (cache 無いので必ず fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(4);  // 各回 2 req
  });
});

describe('fetchFujiWeather (高レベル wrapper)', () => {
  it('latest_time → map → pickFujiStations の 3 段', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('latest_time.txt')) {
        return { ok: true, text: async () => '2026-05-24T05:10:00+09:00' };
      }
      if (url.includes('map/20260524' + '051000.json')) {
        return {
          ok: true,
          json: async () => ({
            49251: { temp: [18.2, 0], humidity: [62, 0] },
            50066: { temp: [3.1, 0], wind: [12.5, 0] },
          }),
        };
      }
      throw new Error(`unexpected: ${url}`);
    });
    const result = await fetchFujiWeather(fetchImpl);
    expect(result.timestamp).toBe('20260524' + '051000');
    expect(result.stations).toHaveLength(5);
    const k = result.stations.find((s) => s.code === '49251');
    expect(k.temp).toBe(18.2);
    expect(k.humidity).toBe(62);
    const summit = result.stations.find((s) => s.code === '50066');
    expect(summit.temp).toBe(3.1);
  });
});
