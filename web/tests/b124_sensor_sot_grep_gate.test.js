// b124: viewer-map3d.js から sensor 4 module-global と chart 合成バッファ 4 個が消え、
// sensor 流入の入口が handleTrainerStatePush (pure 関数) 1 本に集約されたことを source-grep で pin。
// negative gate (= 旧 identifier が無いこと) と入口集約 gate を両方持つ。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-map3d.js');
const HANDLER_PATH = resolve(__dirname, '..', 'lib', 'trainer_handler.js');

describe('b124: viewer-map3d.js から sensor 4 module-global と chart 合成バッファ 4 個が消えている', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('currentCadence / currentPower / currentHr / currentSpeedMps の identifier が無い', () => {
    expect(viewer).not.toMatch(/\bcurrentCadence\b/);
    expect(viewer).not.toMatch(/\bcurrentPower\b/);
    expect(viewer).not.toMatch(/\bcurrentHr\b/);
    expect(viewer).not.toMatch(/\bcurrentSpeedMps\b/);
  });

  it('_lastSpeed / _lastPower / _lastCadence / _lastHr の identifier が無い', () => {
    expect(viewer).not.toMatch(/\b_lastSpeed\b/);
    expect(viewer).not.toMatch(/\b_lastPower\b/);
    expect(viewer).not.toMatch(/\b_lastCadence\b/);
    expect(viewer).not.toMatch(/\b_lastHr\b/);
  });

  it('sensor 流入は handleTrainerStatePush(msg, { rider }) 経由に集約、 viewer 内に setSensors 直呼びは無い', () => {
    // handler は別 lib に切り出し済 (= node import 可能化)。 viewer は呼び出すだけ。
    expect(viewer).toMatch(/handleTrainerStatePush\s*\(\s*msg\s*,\s*\{\s*rider\s*\}\s*\)/);
    expect(viewer).not.toMatch(/rider\.setSensors\s*\(/);
  });
});

describe('b124: trainer_handler.js は setSensors を cad キー名で呼ぶ (= cadence キーは silent no-op の物理 gate)', () => {
  const handler = readFileSync(HANDLER_PATH, 'utf8');

  it('rider.setSensors が cad キーで呼ばれ cadence キー (コロン直後) は含まない', () => {
    const calls = handler.match(/rider\.setSensors\s*\(\s*\{[\s\S]*?\}\s*\)/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toMatch(/\bcad\s*:/);
      expect(call).not.toMatch(/\bcadence\s*:/);
    }
  });
});
