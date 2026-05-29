import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../viewer-map3d.js'), 'utf8');

describe('b125b: ride 時計 6 module-global が viewer-map3d.js から撤去されている', () => {
  it.each([
    'rideStartedAt',
    'rideStartedIso',
    'lastRideDurationS',
    'lastPositionSendT',
    'lastTrkptT',
    'lastAutosaveT',
  ])('module-global %s が viewer-map3d.js に存在しない (= 関数引数 / object key を除く宣言・代入の grep)', (name) => {
    // 注: buildSaveSummary の引数 `rideStartedAt:` は object key (= 妥協 3) のため
    // `\b<name>\s*=` (= 代入) と `^let\s+<name>` (= 宣言) を block すれば object key を見逃さず module-global だけ block 可能。
    expect(src).not.toMatch(new RegExp(`^\\s*let\\s+${name}\\b`, 'm'));
    expect(src).not.toMatch(new RegExp(`(?<!\\.|:\\s*)\\b${name}\\s*=(?!=)`));
  });

  it('viewer-map3d.js が ride_clock.js を import している', () => {
    expect(src).toMatch(/from\s+['"]\.\/lib\/ride_clock\.js['"]/);
    expect(src).toMatch(/createRideClock/);
  });

  it('ride start の 3 経路が clock.start に統一されている (= SoT 二重定義 C7 の解消)', () => {
    // 旧 3 箇所の生代入が残ってないこと
    expect(src).not.toMatch(/rideStartedAt\s*=\s*performance\.now\(\)/);
    // 新 1 経路 (= clock.start) は最低 3 回出現 (= 3 ride start 経路)
    const startCalls = src.match(/clock\.start\s*\(/g) || [];
    expect(startCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('POSITION_SEND_INTERVAL_MS / 30000 magic / 1000 magic の cadence 直接比較が残ってない', () => {
    expect(src).not.toMatch(/lastPositionSendT\s*>=/);
    expect(src).not.toMatch(/lastTrkptT\s*>=/);
    expect(src).not.toMatch(/lastAutosaveT\s*>=/);
  });
});
