// b72 weather step 1: AMeDAS client の data shape + 富士山周辺観測点抽出を pin。
// 実 endpoint は叩かない (= test 環境で配布元に通信 0)、 fetch は vi.fn で mock。

import { describe, it, expect, vi } from 'vitest';
import {
  FUJI_AMEDAS_STATIONS,
  fetchLatestTime,
  fetchAmedasMap,
  pickFujiStations,
  fetchFujiWeather,
} from '../lib/weather/jma_amedas.js';

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
