// b128: viewer-maplibre.js が halfMode を slope と elevation_gain と record に反映する pin.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf8');
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

  it('halfModeToggle checkbox を bike_settings と双方向 bind', () => {
    expect(src).toMatch(/getElementById\(['"]halfModeToggle['"]\)/);
    expect(src).toMatch(/halfModeToggle\.checked\s*=\s*bikeSettings\.getHalfMode/);
    expect(src).toMatch(/bikeSettings\.setHalfMode\(\s*halfModeToggle\.checked\s*\)/);
  });

  it('index.html に halfModeToggle checkbox が静的 DOM として存在', () => {
    expect(html).toMatch(/<input[^>]*id="halfModeToggle"[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*id="halfModeToggle"/);
    expect(html).toMatch(/勾配半減モード/);
  });
});
