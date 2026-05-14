import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { enumerateCoverageTiles, computeBounds, estimateTileCount } from '../lib/tile_coverage.js';

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

  // === estimateTileCount: brief 14 の総量見積もり表との一致を pin ===

  it('estimateTileCount: 富士ヒル course を [14,15,16,17,18] corridor=3 で brief 14 数値表と一致', () => {
    const course = loadCourse();
    const counts = estimateTileCount(course, [14, 15, 16, 17, 18], 3);
    // brief 14 の数値表と一致 (Python estimate_tile_count と同値)
    expect(counts).toEqual([
      [14, 36],
      [15, 70],
      [16, 148],
      [17, 300],
      [18, 631],
    ]);
  });

  it('estimateTileCount: 単 zoom [17] corridor=3 → [[17, 300]]', () => {
    const course = loadCourse();
    expect(estimateTileCount(course, [17], 3)).toEqual([[17, 300]]);
  });

  it('estimateTileCount: corridor=1 と corridor=3 で count が違う (corridor=3 の方が多い)', () => {
    const course = loadCourse();
    const c1 = estimateTileCount(course, [17], 1);
    const c3 = estimateTileCount(course, [17], 3);
    expect(c1[0][0]).toBe(17);
    expect(c3[0][0]).toBe(17);
    expect(c3[0][1]).toBeGreaterThan(c1[0][1]);
    // brief 14 pin: corridor=1 は 107 タイル
    expect(c1).toEqual([[17, 107]]);
  });

  it('estimateTileCount: 空 zoomLevels → 空 array', () => {
    const course = loadCourse();
    expect(estimateTileCount(course, [], 3)).toEqual([]);
  });

  // cross-language pin: fixture と一致 (= Python estimate_tile_count と JS estimateTileCount 同値)
  const fixtureExistsForEstimate = existsSync(FIXTURE_PATH);
  const maybeSkipEstimate = fixtureExistsForEstimate ? it : it.skip;

  maybeSkipEstimate('estimateTileCount: cross-language Python tiles_z17_corridor3 fixture と一致', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
    const course = loadCourse();
    const pyCount3 = (fixture.tiles_z17_corridor3 || {}).count;
    const pyCount1 = (fixture.tiles_z17_corridor1 || {}).count;
    const js3 = estimateTileCount(course, [17], 3);
    const js1 = estimateTileCount(course, [17], 1);
    expect(js3[0][1]).toBe(pyCount3);
    expect(js1[0][1]).toBe(pyCount1);
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
