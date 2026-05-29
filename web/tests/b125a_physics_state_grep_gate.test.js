// b125a: 物理積分 state 4 module-global が viewer-maplibre.js から撤去されたことを
// source-grep negative gate で pin する。 旧 4 識別子 (physicsSpeedMps / lastPhysicsStateT /
// displaySpeedMps / prevPhysicsSpeedMps) と 20km/h reset の生代入が viewer に 1 件も残らず、
// 物理積分 state は physics_state.js の closure 経由でのみ触られることを物理保証する。
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// ESM (package.json type:module) では __dirname が無いため明示定義 (= 既存 grep-gate test と同型)。
const __dirname = dirname(fileURLToPath(import.meta.url));

describe('b125a: 物理積分 state 4 module-global が viewer-maplibre.js から撤去されている', () => {
  const src = readFileSync(resolve(__dirname, '../viewer-maplibre.js'), 'utf8');

  it.each([
    'physicsSpeedMps',
    'lastPhysicsStateT',
    'displaySpeedMps',
    'prevPhysicsSpeedMps',
  ])('module-global %s が viewer-maplibre.js に存在しない', (name) => {
    // \b 境界で false-positive 防止 (= 例: physicsSpeedMpsX 等の別 identifier はヒットさせない)
    const pattern = new RegExp(`\\b${name}\\b`);
    expect(src).not.toMatch(pattern);
  });

  it('viewer-maplibre.js が physics_state.js を import している', () => {
    expect(src).toMatch(/from\s+['"]\.\/lib\/physics_state\.js['"]/);
    expect(src).toMatch(/createPhysicsState/);
  });

  it('20km/h reset は physicsState.reset 1 経路に統一されている (= SoT 二重定義 C7 の解消)', () => {
    // 旧 4 行の生代入が残ってないことを確認 (= 「3 経路目があった場合の妥協」 と整合)
    expect(src).not.toMatch(/physicsSpeedMps\s*=\s*20\s*\/\s*3\.6/);
  });

  it('物理積分 state 4 identifier への生代入 (= magic number / 変数 / 任意値) が viewer に残ってない (= 妥協 1 の 3 経路目発見も physical block)', () => {
    // 「3 経路目発見時は physicsState.reset で吸収」 を test で defensible にする。
    // 「physicsSpeedMps = 何でも」「displaySpeedMps = 何でも」 等の生代入が 1 行でも残れば、
    // 新たな SoT 二重定義経路が生まれるので grep で物理 block する。
    expect(src).not.toMatch(/\bphysicsSpeedMps\s*=/);
    expect(src).not.toMatch(/\bdisplaySpeedMps\s*=/);
    expect(src).not.toMatch(/\bprevPhysicsSpeedMps\s*=/);
    expect(src).not.toMatch(/\blastPhysicsStateT\s*=/);
  });
});
