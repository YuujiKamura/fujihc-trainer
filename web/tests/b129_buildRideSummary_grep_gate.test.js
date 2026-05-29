import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf8');

describe('b129: viewer-maplibre.js の buildRideSummary が calcElevationGainM の戻り値を流す', () => {
  it('elevation_gain_m: 0 のハードコード literal が残っていない', () => {
    expect(src).not.toMatch(/elevation_gain_m:\s*0\b/);
  });

  it('calcElevationGainM を save_summary.js から import している', () => {
    expect(src).toMatch(
      /import\s+\{[^}]*calcElevationGainM[^}]*\}\s+from\s+['"]\.\/lib\/save_summary\.js['"]/
    );
  });

  it('elevation_gain_m に calcElevationGainM 呼び出しの戻り値が入っている', () => {
    expect(src).toMatch(/elevation_gain_m:\s*calcElevationGainM\s*\(/);
  });

  it('旧 TODO コメント (「course から差分計算」) が残っていない', () => {
    expect(src).not.toMatch(/TODO[^\n]*course から差分計算/);
  });
});
