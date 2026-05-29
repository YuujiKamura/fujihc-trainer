// b125c: viewer-map3d.js が bike_settings 経由に集約された pin (= grep gate).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-map3d.js'), 'utf8');

describe('b125c: bike 5 module-global が viewer-map3d.js から撤去されている', () => {
  it.each([
    'inertiaKg',
    'bikeMass',
    'bikeCrr',
    'bikeCda',
    'manualPowerW',
  ])('module-global %s の宣言 (= let X = ...) が無い', (name) => {
    expect(src).not.toMatch(new RegExp(`^\\s*let\\s+${name}\\b`, 'm'));
  });

  it.each([
    'bikeMass',
    'bikeCrr',
    'bikeCda',
    'manualPowerW',
  ])('module-global %s への代入 (= X = ...) が無い', (name) => {
    // 注: `key:'inertiaKg'` は object key として残る (= slider 識別子、 localStorage key 用)、
    // 代入式 (= 行頭 / 行中の `X = ...`) のみ block.
    expect(src).not.toMatch(new RegExp(`(?<!\\.|:\\s*)\\b${name}\\s*=(?!=)`));
  });

  it('_lsNum helper も撤去 (= bike_settings.js 内に移送済)', () => {
    expect(src).not.toMatch(/^\s*const\s+_lsNum\s*=/m);
  });

  it('bike_settings.js を import している', () => {
    expect(src).toMatch(/import\s+\{[^}]*createBikeSettings[^}]*\}\s+from\s+['"]\.\/lib\/bike_settings\.js['"]/);
  });

  it('module top で bikeSettings インスタンスを 1 つ作っている', () => {
    expect(src).toMatch(/const\s+bikeSettings\s*=\s*createBikeSettings\s*\(/);
  });

  it('physicsState.advance に渡す physicsOpts が bikeSettings.getPhysicsOpts() 経由', () => {
    expect(src).toMatch(/physicsOpts:\s*bikeSettings\.getPhysicsOpts\s*\(\s*\)/);
    // 旧書きの object literal が残ってない
    expect(src).not.toMatch(/physicsOpts:\s*\{\s*mass:\s*bikeMass/);
  });

  it('fake trainer power provider が bikeSettings.getPowerProvider() 経由 (= 3 経路全部)', () => {
    expect(src).not.toMatch(/\(\)\s*=>\s*manualPowerW/);
    const matches = src.match(/bikeSettings\.getPowerProvider\s*\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('旧 key migration が bikeSettings.migrateLegacyKeys() 1 行に集約', () => {
    expect(src).toMatch(/bikeSettings\.migrateLegacyKeys\s*\(\s*\)/);
    // 旧書きの forEach + removeItem が残ってない
    expect(src).not.toMatch(/'fujihill\.diff','fujihill\.spd'/);
  });

  it('settings panel の bike 5 slider の apply が bikeSettings.setX 経由', () => {
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setInertia/);
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setMass/);
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setCrr/);
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setCda/);
    expect(src).toMatch(/apply\(raw\)\{\s*bikeSettings\.setPower/);
  });
});
