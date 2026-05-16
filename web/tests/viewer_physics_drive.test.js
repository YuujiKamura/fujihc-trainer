// 2026-05-17: viewer-maplibre.js の wsHandlers.state を「物理駆動」に切り替えた件の gate。
//
// 旧経路: trainer の speed_mps をそのまま rider に渡し、 EMA (inertiaFactor) でなめらかにするだけ。
//   → 下りで足を止めても trainer 由来 speed が即落ちる「減速がデカすぎる」 user 不満が残った。
// 新経路: web/lib/bike_physics.js の applyPhysicsStep で power とコース勾配から速度を時間積分。
//
// 検証要点:
//   1. viewer は bike_physics.applyPhysicsStep を import している
//   2. 旧 EMA blend (= inertiaFactor 重み付け平均) が live コードから消えている
//   3. 慣性 slider は kg (= フライホイール慣性) で localStorage キーは fujihill.inertiaKg
//   4. behavioral: 物理モデル単体が「下り + power=0 で加速」「平地 + power 一定で収束」
//      「勾配ゼロで NaN/負値にならない」「慣性 kg が applyPhysicsStep に届く」 を満たす
//      (= viewer が渡している opts と同じ呼び方を再現)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { applyPhysicsStep } from '../lib/bike_physics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const indexHtml = readFileSync(INDEX_PATH, 'utf8');

// live コード走査用: コメントを剥がす (viewer_motion_audit.test.js と同型).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}
const viewerLive = stripComments(viewer);

describe('viewer 物理駆動: bike_physics 統合', () => {
  it('applyPhysicsStep を web/lib/bike_physics.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*applyPhysicsStep[^}]*\}\s+from\s+['"]\.\/lib\/bike_physics\.js['"]/);
  });

  it('wsHandlers.state 内で applyPhysicsStep を呼ぶ', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/applyPhysicsStep\(/);
  });

  it('wsHandlers.state は計算速度を rider.setSpeed に渡す (= 1 経路維持)', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.setSpeed\(/);
  });
});

describe('viewer 物理駆動: 旧 EMA blend は live コードから撤去済', () => {
  it('inertiaFactor の宣言が live コードに無い (= EMA 係数廃止)', () => {
    expect(viewerLive).not.toMatch(/\binertiaFactor\b/);
  });

  it('旧 EMA blend 式 (oldS * ... + s * (1 - ...)) が live コードに無い', () => {
    expect(viewerLive).not.toMatch(/oldS\s*\*/);
  });

  it('フライホイール慣性 inertiaKg を module global に持つ', () => {
    expect(viewerLive).toMatch(/let\s+inertiaKg\s*=/);
  });
});

describe('viewer 物理駆動: 慣性 slider は kg、 localStorage キーは新名', () => {
  it('localStorage キーは fujihill.inertiaKg (= 旧 fujihill.inertia 0..0.95 と別名)', () => {
    expect(viewer).toMatch(/fujihill\.inertiaKg/);
  });

  it('rngInertia slider は 0..3000 kg、 step 50 (= index.html)', () => {
    expect(indexHtml).toMatch(/id="rngInertia"[^>]*min="0"[^>]*max="3000"[^>]*step="50"/);
  });

  it('慣性 slider のラベル単位が kg相当 (= % ではない)', () => {
    const m = indexHtml.match(/id="rngInertia"[\s\S]{0,160}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/kg相当/);
  });
});

// === behavioral: viewer が渡している opts と同じ呼び方を再現して物理を pin ===
// viewer の wsHandlers.state は { mass:88, c_rr:0.005, c_d:0.35, area:1, inertia:inertiaKg } で呼ぶ。
const VIEWER_OPTS = (inertiaKg) => ({ mass: 88, c_rr: 0.005, c_d: 0.35, area: 1, inertia: inertiaKg });

// viewer の substep ループ (= 固定 1/120s) を 1 回の state メッセージとして再現。
function stateStep(v, dtSec, power, slopePct, inertiaKg) {
  const SUB = 1 / 120;
  let remain = dtSec;
  while (remain > 0) {
    const h = Math.min(SUB, remain);
    v = applyPhysicsStep(v, h, power, slopePct, VIEWER_OPTS(inertiaKg));
    remain -= h;
  }
  return v;
}

describe('viewer 物理駆動 behavioral', () => {
  it('power=0 + 下り勾配で速度が増える (= 元バグ「足を止めると即減速」 の再発防止)', () => {
    let v = 8; // 8 m/s で巡航中
    const v0 = v;
    // 1Hz state メッセージを 5 回 (= 5 秒) 受け取った想定、 下り -7%、 ペダル止め (power=0)。
    for (let i = 0; i < 5; i++) v = stateStep(v, 1.0, 0, -7, 800);
    expect(v).toBeGreaterThan(v0); // 下りなので加速する
    expect(Number.isFinite(v)).toBe(true);
  });

  it('power 一定 + 平地で速度が収束する', () => {
    // 慣性 800kg は加速度の分母が大きく収束が遅いので十分な時間 (= 1800 秒) 回す。
    let v = 3;
    for (let i = 0; i < 1800; i++) v = stateStep(v, 1.0, 200, 0, 800);
    const vSettled = v;
    for (let i = 0; i < 120; i++) v = stateStep(v, 1.0, 200, 0, 800);
    // 収束: 追加 120 秒でほぼ変化しない
    expect(Math.abs(v - vSettled)).toBeLessThan(0.05);
    expect(v).toBeGreaterThan(0);
  });

  it('勾配ゼロ・速度ゼロ・power ゼロで NaN や負値にならない', () => {
    let v = 0;
    for (let i = 0; i < 10; i++) v = stateStep(v, 1.0, 0, 0, 800);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('慣性 kg が大きいほど加速がゆるい (= スライダー値が applyPhysicsStep の inertia に届く)', () => {
    // 同じ power / 勾配 / dt で慣性 0 と 3000 を比較。 慣性大 → 加速度の分母が大きく加速が鈍る。
    const vLowInertia = stateStep(0, 2.0, 300, 0, 0);
    const vHighInertia = stateStep(0, 2.0, 300, 0, 3000);
    expect(vLowInertia).toBeGreaterThan(vHighInertia);
    // 慣性ゼロでないことの裏取り: 0 を渡したときと差が出る
    expect(vHighInertia).toBeGreaterThan(0);
  });
});
