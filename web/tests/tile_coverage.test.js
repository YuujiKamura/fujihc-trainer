import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { enumerateCoverageTiles, computeBounds } from '../lib/tile_coverage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COURSE_PATH = resolve(__dirname, '..', 'course.json');
const FIXTURE_PATH = resolve(__dirname, 'fixtures', 'py_coverage_z14.json');

function loadCourse() {
  const txt = readFileSync(COURSE_PATH, 'utf8');
  return JSON.parse(txt);
}

describe('tile_coverage', () => {
  it('enumerateCoverageTiles: 富士ヒル course を corridor=3 で z=14 → 36 タイル', () => {
    const course = loadCourse();
    const tiles = enumerateCoverageTiles(course, [14], 3);
    // brief 14 の数値 (= 36 タイル) と一致
    expect(tiles.size).toBe(36);
    // 全タイルが "14/x/y" 形式
    for (const t of tiles) {
      expect(t).toMatch(/^14\/\d+\/\d+$/);
    }
  });

  it('enumerateCoverageTiles: corridor=1 と corridor=3 で差が出る (corridor=3 の方が多い)', () => {
    const course = loadCourse();
    const t1 = enumerateCoverageTiles(course, [14], 1);
    const t3 = enumerateCoverageTiles(course, [14], 3);
    expect(t3.size).toBeGreaterThan(t1.size);
    // corridor=1 ⊆ corridor=3 (中央タイルは共通)
    for (const tile of t1) {
      expect(t3.has(tile)).toBe(true);
    }
  });

  it('enumerateCoverageTiles: 決定性 (同 input → 同 output)', () => {
    const course = loadCourse();
    const a = enumerateCoverageTiles(course, [14], 3);
    const b = enumerateCoverageTiles(course, [14], 3);
    expect(a.size).toBe(b.size);
    // 全要素一致
    for (const t of a) expect(b.has(t)).toBe(true);
  });

  it('computeBounds: 富士ヒル course → buffer 1km 込みで brief 14 の数値域内', () => {
    const course = loadCourse();
    const [w, s, e, n] = computeBounds(course, 1000);
    // brief 14 期待値: W=138.681 S=35.364 E=138.768 N=35.461
    expect(w).toBeCloseTo(138.681, 2);
    expect(s).toBeCloseTo(35.364, 2);
    expect(e).toBeCloseTo(138.768, 2);
    expect(n).toBeCloseTo(35.461, 2);
  });

  it('computeBounds: 1 点 course でも返る (buffer 分だけ広がる)', () => {
    const course = [{ lat: 35.4, lon: 138.7 }];
    const [w, s, e, n] = computeBounds(course, 1000);
    expect(w).toBeLessThan(138.7);
    expect(e).toBeGreaterThan(138.7);
    expect(s).toBeLessThan(35.4);
    expect(n).toBeGreaterThan(35.4);
  });

  it('computeBounds: 空 course は throw する', () => {
    expect(() => computeBounds([], 1000)).toThrow();
  });

  // === cross-language: Python tile_coverage と JS tile_coverage が同 input → 同 output ===
  // fixture が無い時 (= peer B / brief 14 がまだ landed していない) は skip.
  const fixtureExists = existsSync(FIXTURE_PATH);
  const maybeSkip = fixtureExists ? it : it.skip;

  maybeSkip('cross-language: Python の enumerate_coverage_tiles と同値 (zoom 17 corridor 3)', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const course = loadCourse();
    // 最新方針: zoom 17 単一化 + corridor 3 (= 富士ヒル 300 タイル / 約 15 MB)
    const jsTiles = enumerateCoverageTiles(course, [17], 3);
    const pyEntry = fixture.tiles_z17_corridor3 || {};
    const pyTiles = new Set(
      (pyEntry.tiles || []).map(([z, x, y]) => `${z}/${x}/${y}`),
    );
    expect(jsTiles.size).toBe(pyTiles.size);
    expect(jsTiles.size).toBe(300);  // brief 14 見積もり表との一致を pin
    for (const t of pyTiles) expect(jsTiles.has(t)).toBe(true);
    // bounds の cross-check (誤差許容 1e-6)、 Python 側は {west, south, east, north} dict
    const pyBounds = fixture.bounds_1km;
    if (pyBounds && typeof pyBounds === 'object') {
      const jsBounds = computeBounds(course, 1000);
      expect(jsBounds[0]).toBeCloseTo(pyBounds.west, 6);
      expect(jsBounds[1]).toBeCloseTo(pyBounds.south, 6);
      expect(jsBounds[2]).toBeCloseTo(pyBounds.east, 6);
      expect(jsBounds[3]).toBeCloseTo(pyBounds.north, 6);
    }
  });
});
