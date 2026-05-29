import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-map3d.js'), 'utf8');

describe('b129: viewer-map3d.js の buildRideSummary が calcElevationGainM の戻り値を流す', () => {
  it('elevation_gain_m: 0 のハードコード literal が残っていない', () => {
    expect(src).not.toMatch(/elevation_gain_m:\s*0\b/);
  });

  it('calcElevationGainM を save_summary.js から import している', () => {
    expect(src).toMatch(
      /import\s+\{[^}]*calcElevationGainM[^}]*\}\s+from\s+['"]\.\/lib\/save_summary\.js['"]/
    );
  });

  it('calcElevationGainM(trkpts) の戻り値が elevation_gain_m に流れる (= halfMode 反映を挟むため中間変数経由でも可)', () => {
    // b128 後: calcElevationGainM(trkpts) → rawElevationGainM → halfMode で 0.5 倍 → elevation_gain_m
    expect(src).toMatch(/calcElevationGainM\s*\(\s*trkpts\s*\)/);
    expect(src).toMatch(/elevation_gain_m:\s*(calcElevationGainM\s*\(|elevationGainM\b)/);
  });

  it('旧 TODO コメント (「course から差分計算」) が残っていない', () => {
    expect(src).not.toMatch(/TODO[^\n]*course から差分計算/);
  });
});
