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

  it('b124: sensor 流入は handleTrainerStatePush 経由に集約 (= 旧 currentPower 直書きの廃止)', () => {
    // brief 33 当時は module-global の直書きを pin していたが、 b124 で sensor SoT を rider に
    // 一本化。 ここでは handler 集約と旧直書きの不在を pin する (= SoT 移送への追随)。
    expect(viewer).toMatch(/handleTrainerStatePush\s*\(/);
    expect(viewer).not.toMatch(/currentPower\s*=\s*msg\.power_w/);
    expect(viewer).not.toMatch(/currentHr\s*=\s*msg\.hr_bpm/);
  });

  it('tick 内で rideState.appendTrkpt が 1Hz で呼ばれる', () => {
    expect(viewer).toMatch(/rideState\.appendTrkpt\s*\(/);
    // 1000ms gate (= 1Hz cadence)
    expect(viewer).toMatch(/lastTrkptT[\s\S]{0,200}>=\s*1000/);
  });

  it('appendTrkpt の extras に t / power / cad / hr が rider 経由で渡される', () => {
    const m = viewer.match(/rideState\.appendTrkpt\s*\(\s*\{[\s\S]{0,400}\}\s*\)/);
    expect(m).not.toBeNull();
    const body = m[0];
    expect(body).toMatch(/t:/);
    expect(body).toMatch(/power:\s*rider\??\.power/);
    expect(body).toMatch(/cad:\s*rider\??\.cadence/);
    expect(body).toMatch(/hr:\s*rider\??\.hr/);
  });

  it('btnRideStart で lastTrkptT を 0 にリセット', () => {
    expect(viewer).toMatch(/lastTrkptT\s*=\s*0/);
  });
});
