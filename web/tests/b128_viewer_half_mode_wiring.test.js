// b128: viewer-map3d.js が halfMode を slope と elevation_gain と record に反映する pin.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-map3d.js'), 'utf8');
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('b128: viewer (Controller) が halfMode を物理 + 記録 + UI に反映', () => {
  it('slope 渡し経路で halfMode 反映 (= bikeSettings.getHalfMode() ? raw * 0.5 : raw)', () => {
    expect(src).toMatch(/rawSlopePct/);
    expect(src).toMatch(/bikeSettings\.getHalfMode\s*\(\s*\)\s*\?\s*rawSlopePct\s*\*\s*0\.5/);
  });

  it('physicsState.advance に渡るのは halfMode 反映後の slopePct', () => {
    expect(src).toMatch(/const\s+slopePct\s*=\s*bikeSettings\.getHalfMode/);
    expect(src).toMatch(/physicsState\.advance\([\s\S]{0,200}slopePct/);
  });

  it('buildRideSummary の elevation_gain_m に halfMode を反映 (= 0.5 倍)', () => {
    expect(src).toMatch(/calcElevationGainM\s*\(\s*trkpts\s*\)/);
    expect(src).toMatch(/halfMode\s*\?\s*Math\.round\s*\(\s*rawElevationGainM\s*\*\s*0\.5/);
  });

  it('record に halfMode flag を含める', () => {
    expect(src).toMatch(/halfMode:\s*halfMode|halfMode,?\s*\n?\s*\}/);
    expect(src).toMatch(/const\s+halfMode\s*=\s*bikeSettings\.getHalfMode/);
  });

  it('難易度 radio (rideDifficultyFull / rideDifficultyHalf) を bike_settings と双方向 bind', () => {
    expect(src).toMatch(/getElementById\(['"]rideDifficultyFull['"]\)/);
    expect(src).toMatch(/getElementById\(['"]rideDifficultyHalf['"]\)/);
    expect(src).toMatch(/bikeSettings\.setHalfMode\(\s*false\s*\)/);
    expect(src).toMatch(/bikeSettings\.setHalfMode\(\s*true\s*\)/);
  });

  it('index.html に 難易度 radio 2 つが setup-overlay 内の static DOM として存在', () => {
    expect(html).toMatch(/<input[^>]*id="rideDifficultyFull"[^>]*type="radio"|<input[^>]*type="radio"[^>]*id="rideDifficultyFull"/);
    expect(html).toMatch(/<input[^>]*id="rideDifficultyHalf"[^>]*type="radio"|<input[^>]*type="radio"[^>]*id="rideDifficultyHalf"/);
    expect(html).toMatch(/獲得標高を半分にする/);
    expect(html).toMatch(/疑似簡単モード/);
    expect(html).toMatch(/ノーマル/);
  });
});
