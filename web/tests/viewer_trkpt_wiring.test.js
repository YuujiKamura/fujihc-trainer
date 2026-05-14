// brief 33 fix: viewer の tick 経由で rideState.appendTrkpt が呼ばれることを
// 物理 source-grep で pin する regression gate。
// audit Round 1 で発見された LOAD-BEARING (= 2 引数 advance のまま、 trkpts 常に空)
// の再演を防ぐ。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');

describe('brief 33 fix: viewer tick が trkpts を蓄積する (= 整合性 gate)', () => {
  const viewer = readFileSync(VIEWER_PATH, 'utf8');

  it('currentPower / currentHr の global 変数が定義済', () => {
    expect(viewer).toMatch(/let\s+currentPower\s*=\s*0/);
    expect(viewer).toMatch(/let\s+currentHr\s*=\s*0/);
  });

  it('wsHandlers.state で msg.power_w / msg.hr_bpm を currentPower / currentHr に保存', () => {
    expect(viewer).toMatch(/msg\.power_w\s*===?\s*['"]number['"][\s\S]{0,80}currentPower\s*=\s*msg\.power_w/);
    expect(viewer).toMatch(/msg\.hr_bpm\s*===?\s*['"]number['"][\s\S]{0,80}currentHr\s*=\s*msg\.hr_bpm/);
  });

  it('tick 内で rideState.appendTrkpt が 1Hz で呼ばれる', () => {
    expect(viewer).toMatch(/rideState\.appendTrkpt\s*\(/);
    // 1000ms gate (= 1Hz cadence)
    expect(viewer).toMatch(/lastTrkptT[\s\S]{0,200}>=\s*1000/);
  });

  it('appendTrkpt の extras に t / power / cad / hr が渡される', () => {
    const m = viewer.match(/rideState\.appendTrkpt\s*\(\s*\{[\s\S]{0,400}\}\s*\)/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/t:/);
    expect(body).toMatch(/power:\s*currentPower/);
    expect(body).toMatch(/cad:\s*currentCadence/);
    expect(body).toMatch(/hr:\s*currentHr/);
  });

  it('btnRideStart で lastTrkptT を 0 にリセット', () => {
    expect(viewer).toMatch(/lastTrkptT\s*=\s*0/);
  });
});
