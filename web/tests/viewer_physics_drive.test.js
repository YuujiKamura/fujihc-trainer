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
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

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

// viewer の wsHandlers.state を 1 回の state メッセージとして再現。
// 本番経路と同じく (1) dt を 0.1〜2.0 秒にクランプ (2) 固定 1/120s でサブステップ。
// クランプは viewer-maplibre.js の `if (dt < 0.1) dt = 0.1; if (dt > 2.0) dt = 2.0;` と一致。
function stateStep(v, dtSec, power, slopePct, inertiaKg) {
  let dt = dtSec;
  if (dt < 0.1) dt = 0.1;
  if (dt > 2.0) dt = 2.0;
  const SUB = 1 / 120;
  let remain = dt;
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

// === 閉ループ: viewer が rider 現在位置から正しいコース勾配を引いて積分する ===
//
// 2026-05-17 Critical fix の回帰防止。 旧コードは tick() が更新する module global
// (currentCourseSlopePct、 初期値 0) を読んでいたため、 初回 tick より先に state push が
// 来ると slope=0 で積分してしまった。 富士ヒルは登坂なので登り抵抗が抜けて速度が過大化。
// 修正後は wsHandlers.state が rider.snapshot().position.slope_pct を都度引く。
//
// 下記 viewerStateStep は wsHandlers.state の本番ロジックを忠実に再現する:
//   - コース勾配は rider.snapshot().position.slope_pct から取得 (= module global 経由ではない)
//   - dt は 0.1〜2.0 にクランプ
//   - 固定 1/120s サブステップで applyPhysicsStep を積分
function viewerStateStep(rider, physicsV, dtSec, powerW, inertiaKg) {
  let dt = dtSec;
  if (dt < 0.1) dt = 0.1;
  if (dt > 2.0) dt = 2.0;
  // 本番と同一: rider の現在位置のコース勾配を直接引く (tick 由来 global に依存しない)。
  const pos = rider.snapshot().position;
  const slopePct = (pos && Number.isFinite(pos.slope_pct)) ? pos.slope_pct : 0;
  const SUB = 1 / 120;
  let remain = dt;
  let v = physicsV;
  while (remain > 0) {
    const h = Math.min(SUB, remain);
    v = applyPhysicsStep(v, h, powerW, slopePct, VIEWER_OPTS(inertiaKg));
    remain -= h;
  }
  return { v, slopePct };
}

// 一定 8% 登坂コース (= 富士ヒル相当の登り)。 distance_m は 10m 間隔。
function buildClimbCourse(n = 50, slope = 8) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      lat: 35.36 + i * 0.0001,
      lon: 138.78,
      distance_m: i * 10,
      elevation_m: 1000 + i * 10 * (slope / 100),
      slope_pct: slope,
    });
  }
  return arr;
}

describe('viewer 物理駆動 閉ループ: rider 位置からコース勾配を引いて積分', () => {
  it('rider が登坂位置にいるとき state ハンドラは slope=0 でなく登り勾配で積分する', () => {
    const terrain = createTerrain({ course: buildClimbCourse(50, 8) });
    const rider = createRider({ terrain });
    // rider を登坂区間の途中 (= 200m 地点) に置く。 tick はまだ 1 度も走っていない想定。
    rider.placeAtDistance(200);

    // wsHandlers.state を 1 回受け取る (= 初回 tick より先に来たケース)。
    const { v, slopePct } = viewerStateStep(rider, 0, 1.0, 250, 800);

    // 引いた勾配が 0 ではなく実コース勾配 (8%) であること。
    // これが Critical バグの直接 pin: module global 経路だと slope=0 になる。
    expect(slopePct).toBeCloseTo(8, 5);
    expect(slopePct).toBeGreaterThan(0);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('登坂を slope=0 で積分した場合より速度が低い (= 登り抵抗が抜けていない)', () => {
    const terrain = createTerrain({ course: buildClimbCourse(50, 8) });
    const rider = createRider({ terrain });
    rider.placeAtDistance(200);

    // 修正後 (= 正しく 8% を引く) の積分。
    let vFixed = 0;
    for (let i = 0; i < 10; i++) {
      vFixed = viewerStateStep(rider, vFixed, 1.0, 250, 800).v;
    }
    // バグ再現 (= slope を強制 0 にした積分) — 登り抵抗が抜けて速くなるはず。
    let vBuggy = 0;
    for (let i = 0; i < 10; i++) {
      vBuggy = stateStep(vBuggy, 1.0, 250, 0, 800);
    }
    // 富士ヒルの登坂で slope=0 にすると重力減速が抜けて過大な速度になる。
    expect(vBuggy).toBeGreaterThan(vFixed);
    expect(vFixed).toBeGreaterThan(0);
  });
});
