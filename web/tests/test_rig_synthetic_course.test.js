import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from './_fixtures.js';
import {
  generateCourse, loadFujiPrefix, slicePrefix, COURSE_KINDS,
} from '../lib/test_rig_synthetic_course.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('test_rig_synthetic_course', () => {
  describe('generateCourse', () => {
    it('flat: slope_pct=0 全点、 末尾 distance_m=1000', () => {
      const c = generateCourse('flat');
      expect(c.length).toBeGreaterThan(2);
      expect(c.every((p) => p.slope_pct === 0)).toBe(true);
      expect(c[c.length - 1].distance_m).toBe(1000);
      expect(c[0].distance_m).toBe(0);
    });

    it('up5: slope_pct=5 全点、 末尾 elevation ≒ 起点 +50m', () => {
      const c = generateCourse('up5');
      expect(c.every((p) => p.slope_pct === 5)).toBe(true);
      const eleDiff = c[c.length - 1].elevation_m - c[0].elevation_m;
      expect(eleDiff).toBeCloseTo(50, 1);
      expect(c[c.length - 1].distance_m).toBe(1000);
    });

    it('down5: slope_pct=-5 全点、 末尾 elevation ≒ 起点 -50m', () => {
      const c = generateCourse('down5');
      expect(c.every((p) => p.slope_pct === -5)).toBe(true);
      const eleDiff = c[c.length - 1].elevation_m - c[0].elevation_m;
      expect(eleDiff).toBeCloseTo(-50, 1);
    });

    it('up10: 500m 長、 slope_pct=10', () => {
      const c = generateCourse('up10');
      expect(c.every((p) => p.slope_pct === 10)).toBe(true);
      expect(c[c.length - 1].distance_m).toBe(500);
    });

    it('sine: 蛇行 (= lat に sin 波振幅 30m)', () => {
      const c = generateCourse('sine');
      const refLat = 35.45;
      const M_PER_DEG_LAT = 111320;
      const offsets_m = c.map((p) => (p.lat - refLat) * M_PER_DEG_LAT);
      const maxAbs = Math.max(...offsets_m.map(Math.abs));
      // 振幅 30m が正弦の頂点で踏まれている (= step=10m なら必ずどこかで頂点近傍にヒット)
      expect(maxAbs).toBeGreaterThan(29);
      expect(maxAbs).toBeLessThanOrEqual(30.001);
      expect(c[c.length - 1].distance_m).toBe(2000);
    });

    it('sine: 進行方向は東向き (= lon が単調増加)', () => {
      const c = generateCourse('sine');
      for (let i = 1; i < c.length; i++) {
        expect(c[i].lon).toBeGreaterThan(c[i - 1].lon);
      }
    });

    it('全 kind が createTerrain に渡せる形を返す (= 必須 field を持つ)', () => {
      for (const kind of ['flat', 'up5', 'down5', 'up10', 'sine']) {
        const c = generateCourse(kind);
        expect(Array.isArray(c)).toBe(true);
        for (const p of c) {
          expect(p).toHaveProperty('distance_m');
          expect(p).toHaveProperty('lat');
          expect(p).toHaveProperty('lon');
          expect(p).toHaveProperty('elevation_m');
          expect(p).toHaveProperty('slope_pct');
          expect(Number.isFinite(p.distance_m)).toBe(true);
          expect(Number.isFinite(p.lat)).toBe(true);
          expect(Number.isFinite(p.lon)).toBe(true);
        }
      }
    });

    it('distance_m は単調増加', () => {
      for (const kind of ['flat', 'up5', 'down5', 'up10', 'sine']) {
        const c = generateCourse(kind);
        for (let i = 1; i < c.length; i++) {
          expect(c[i].distance_m).toBeGreaterThan(c[i - 1].distance_m);
        }
      }
    });

    it('unknown kind は例外', () => {
      expect(() => generateCourse('unknown')).toThrow();
      expect(() => generateCourse('fuji-prefix')).toThrow(); // sync では扱わない
    });
  });

  describe('slicePrefix', () => {
    it('先頭 N 点を浅 copy で返す', () => {
      const mock = Array.from({ length: 800 }, (_, i) => ({
        distance_m: i * 30,
        lat: 35.45 + i * 0.0001,
        lon: 138.75,
        elevation_m: 1000 + i,
        slope_pct: 5,
      }));
      const out = slicePrefix(mock, 500);
      expect(out.length).toBe(500);
      expect(out[0]).toEqual(mock[0]);
      expect(out[499]).toEqual(mock[499]);
      // 浅 copy → 元配列の mutation で out が壊れない
      mock[0].lat = 99;
      expect(out[0].lat).not.toBe(99);
    });

    it('N が配列長より大きければ全長 (= 切り詰めなし)', () => {
      const mock = [{ distance_m: 0, lat: 0, lon: 0, elevation_m: 0, slope_pct: 0 }];
      expect(slicePrefix(mock, 500).length).toBe(1);
    });

    it('非配列入力は TypeError', () => {
      expect(() => slicePrefix(null)).toThrow(TypeError);
      expect(() => slicePrefix('nope')).toThrow(TypeError);
    });
  });

  describe('loadFujiPrefix (= 注入 fetcher)', () => {
    it('fetcher の返却を slicePrefix に通す', async () => {
      const mock = Array.from({ length: 1200 }, (_, i) => ({
        distance_m: i, lat: 0, lon: 0, elevation_m: 0, slope_pct: 0,
      }));
      const prefix = await loadFujiPrefix({
        fetcher: async () => mock,
        count: 500,
      });
      expect(prefix.length).toBe(500);
      expect(prefix[499].distance_m).toBe(499);
    });

    it('実 course.json の先頭 500 点が読める (= node fs で同じ data を確認)', async () => {
      const raw = loadCourse();
      const prefix = await loadFujiPrefix({
        fetcher: async () => raw,
        count: 500,
      });
      expect(prefix.length).toBe(Math.min(500, raw.length));
      expect(prefix[0].lat).toBeCloseTo(raw[0].lat, 6);
      expect(prefix[0].lon).toBeCloseTo(raw[0].lon, 6);
    });
  });

  describe('COURSE_KINDS', () => {
    it('6 kind 列挙 (= flat / up5 / down5 / up10 / sine / fuji-prefix)', () => {
      expect(COURSE_KINDS).toEqual(['flat', 'up5', 'down5', 'up10', 'sine', 'fuji-prefix']);
    });
  });
});
