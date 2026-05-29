// b125a: physics_state.js を切り出した後、 viewer-maplibre.js 内で physicsState が
// state push (advance) / rAF tick (interpolate → rider.setSpeed) に正しく配線され、
// handleTrainerStatePush → advance の順序 (b124 follow-up の順序保証) が physicsState 経由で
// 再現されていることを source-grep で pin する (= integration、 viewer は maplibre-gl/DOM 依存で
// 単体 import 不可のため b124 follow-up と同じテキスト距離方式)。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');

describe('b125a: viewer 内で physics_state が state push / tick に配線されている', () => {
  it('viewer は createPhysicsState を import し physicsState を 1 つ生成する', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createPhysicsState[^}]*\}\s+from\s+['"]\.\/lib\/physics_state\.js['"]/);
    expect(viewer).toMatch(/const\s+physicsState\s*=\s*createPhysicsState\(/);
  });

  it('wsHandlers.state 内で physicsState.advance({ nowMs, power, slopePct, physicsOpts }) が呼ばれる', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/physicsState\.advance\(/);
    // advance に nowMs / power / slopePct / physicsOpts を渡す (= 物理計算に必要な入力の配線)。
    expect(m[0]).toMatch(/physicsState\.advance\(\s*\{[\s\S]*?nowMs[\s\S]*?power[\s\S]*?slopePct[\s\S]*?physicsOpts[\s\S]*?\}\s*\)/);
  });

  it('rAF tick 内で physicsState.interpolate(t) の戻りを rider.setSpeed に渡す', () => {
    const m = viewer.match(/function\s+tick\s*\([^)]*\)\s*\{[\s\S]*?^\}/m);
    expect(m).not.toBeNull();
    // interpolate の戻りを変数で受けて setSpeed に渡す配線を pin (= 表示速度 → rider 反映の 1 経路)。
    expect(m[0]).toMatch(/const\s+speedMps\s*=\s*physicsState\.interpolate\(\s*t\s*\)/);
    expect(m[0]).toMatch(/rider\.setSpeed\(\s*speedMps\s*\)/);
  });

  it('handleTrainerStatePush → physicsState.advance の順序 (= physics が rider.power の最新値を読める)', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    // b124 follow-up と同方式: handler が physics より前に出現することをテキスト距離で pin。
    expect(m[0]).toMatch(/handleTrainerStatePush[\s\S]*?physicsState\.advance/);
  });

  it('20km/h reset は physicsState.reset({ nowMs, speedMps }) 経由 (= 生代入の SoT 二重定義を排除)', () => {
    // 2 経路 (section ジャンプ / デモ開始) とも physicsState.reset に統一されていること。
    const resets = viewer.match(/physicsState\.reset\(\s*\{\s*nowMs:\s*performance\.now\(\)\s*,\s*speedMps:\s*20\s*\/\s*3\.6\s*\}\s*\)/g);
    expect(resets).not.toBeNull();
    expect(resets.length).toBeGreaterThanOrEqual(2);
  });
});
