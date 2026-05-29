import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-map3d.js'), 'utf8');

describe('b125b: viewer-map3d.js が clock を正しく配線している', () => {
  it('clock.start が ride start 3 経路で呼ばれる (= ride_status / mode-view切替 / 観るモード解除)', () => {
    const matches = src.match(/clock\.start\s*\(\s*\{\s*nowMs:\s*performance\.now\(\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('clock.end が ride end 経路で呼ばれる', () => {
    expect(src).toMatch(/clock\.end\s*\(\s*\{\s*nowMs:\s*performance\.now\(\)/);
  });

  it('clock.restore が applyPendingRestore 経路で呼ばれる', () => {
    expect(src).toMatch(/clock\.restore\s*\(/);
  });

  it('rAF tick 内で clock.elapsedSec と clock.isActive が使われる', () => {
    expect(src).toMatch(/clock\.elapsedSec\s*\(/);
    expect(src).toMatch(/clock\.isActive\s*\(\s*\)/);
  });

  it('rAF tick 内で 3 cadence gate (clock.shouldPushPosition / shouldPushTrkpt / shouldRunAutosave) が使われる', () => {
    expect(src).toMatch(/clock\.shouldPushPosition\s*\(/);
    expect(src).toMatch(/clock\.shouldPushTrkpt\s*\(/);
    expect(src).toMatch(/clock\.shouldRunAutosave\s*\(/);
  });

  it('autosave 経路で clock.getRideStartedIso が使われる', () => {
    expect(src).toMatch(/clock\.getRideStartedIso\s*\(\s*\)/);
  });

  it('buildSaveSummary の caller で clock.snapshot().rideStartedAt と clock.getDurationS() が使われる (= postride dialog の duration 表示の SoT)', () => {
    // showPostride 内 (= buildSaveSummary 呼出) で旧 module-global `rideStartedAt` と
    // `lastRideDurationS` の生 read が消えて clock 経由になってることを物理 pin。 worker が
    // `clock.getRideStartedIso()` で代用して silent regression する穴を塞ぐ (= ISO 文字列 vs ms 数値の混同)。
    expect(src).toMatch(/buildSaveSummary[\s\S]{0,500}clock\.snapshot\(\)\.rideStartedAt/);
    expect(src).toMatch(/buildSaveSummary[\s\S]{0,500}clock\.getDurationS\(\)/);
  });

  it('buildRideSummary 経路で clock.isActive() / clock.snapshot() / clock.getDurationS() の 3 分岐配線が揃う', () => {
    // buildRideSummary 内 (= duration_s フィールド計算) で「ride 中は経過秒、 end 後は確定 duration」
    // の旧 3 項分岐が clock の 3 method で同等に再現されてることを物理 pin。 isActive の分岐が抜けると
    // ride end 後の duration_s が 0 になる 2026-05-19 bug を再演する。
    expect(src).toMatch(/duration_s[\s\S]{0,200}clock\.isActive\(\)/);
    expect(src).toMatch(/duration_s[\s\S]{0,400}clock\.getDurationS\(\)/);
  });
});
