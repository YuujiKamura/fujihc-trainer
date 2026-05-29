// 2026-05-17: viewer-maplibre.js の wsHandlers.state を「物理駆動」に切り替えた件の gate。
//
// 旧経路: trainer の speed_mps をそのまま rider に渡し、 EMA (inertiaFactor) でなめらかにするだけ。
//   → 下りで足を止めても trainer 由来 speed が即落ちる「減速がデカすぎる」 user 不満が残った。
// 新経路: web/lib/bike_physics.js の applyPhysicsStep で power とコース勾配から速度を時間積分。
//
// 2026-05-17 redraft (b3): サブステップ積分ループを bike_physics.integratePhysics に集約。
// 旧テストは「クランプ済 dt 区間を 1/120s サブステップ積分する」段取りをテストファイル内に
// 手コピーした並行実装 (stateStep / viewerStateStep) を叩いていただけで、 本物の viewer
// コードが壊れてもテストは緑のままだった。 共有関数 integratePhysics の導入後はテストが
// その共有関数を直接叩くため、 物理積分の嘘は消える。
//
// このファイルが pin しているもの / pin していないもの (= 詐称しないための明示):
//   pin する:
//     - viewer / inertia-sim / テストが叩く共有 substep 積分関数 integratePhysics の物理挙動
//     - viewer 起源の opts (mass:88 等) を渡したときの収束 / 加速 / 慣性応答
//     - rider 位置からコース勾配を引いて積分する経路 (= Critical バグ「slope=0 で積分」 の pin)
//     - viewer ソースが integratePhysics を import し wsHandlers.state で呼ぶこと (= 静的走査)
//   pin しない:
//     - wsHandlers.state ハンドラ自体の実走 (dt クランプ / performance.now / opts 組立 /
//       setSpeed ガード)。 viewer-maplibre.js は maplibre-gl / DOM 依存で単体 import 不可のため、
//       handler 全体の実走 integration test は本ファイルの範囲外 (別 brief 案件)。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { integratePhysics } from '../lib/bike_physics.js';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const PHYSICS_STATE_PATH = resolve(__dirname, '..', 'lib', 'physics_state.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const indexHtml = readFileSync(INDEX_PATH, 'utf8');
const physicsStateSrc = readFileSync(PHYSICS_STATE_PATH, 'utf8');

// live コード走査用: コメントを剥がす (viewer_motion_audit.test.js と同型).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}
const viewerLive = stripComments(viewer);

describe('viewer 物理駆動: bike_physics 統合 (静的走査)', () => {
  it('b125a: viewer は createPhysicsState を physics_state.js から import、 physics_state.js が integratePhysics を bike_physics.js から import (= SoT chain)', () => {
    // b125a: viewer は物理積分 state を physics_state.js の closure 経由で持つ。 共有 substep 関数
    // integratePhysics への依存は viewer から physics_state.js に移ったが、 SoT chain (= 積分は
    // 1 つの bike_physics.integratePhysics 経由) は physics_state.js が import することで維持される。
    expect(viewer).toMatch(/import\s+\{[^}]*createPhysicsState[^}]*\}\s+from\s+['"]\.\/lib\/physics_state\.js['"]/);
    expect(physicsStateSrc).toMatch(/import\s+\{[^}]*integratePhysics[^}]*\}\s+from\s+['"]\.\/bike_physics\.js['"]/);
  });

  it('wsHandlers.state 内で physicsState.advance を呼ぶ (= 物理積分は physics_state.js に集約)', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/physicsState\.advance\(/);
  });

  it('wsHandlers.state はサブステップループを直書きしていない (= SoT 三重複の解消)', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    // 旧経路の `const SUB = 1 / 120;` 直書きが state ハンドラから消えていること。
    expect(m[0]).not.toMatch(/SUB\s*=\s*1\s*\/\s*120/);
  });

  it('b125a: wsHandlers.state は rider.setSpeed を直接呼ばない (= setSpeed は rAF tick 経由のみ)', () => {
    // b83/b125a 仕様: state ハンドラは physicsState.advance で物理 state を進めるだけ。
    // rider.setSpeed は tick (rAF 60Hz) が physicsState.interpolate の戻りで呼ぶ唯一の経路。
    // SoT は維持 (= 外から rider.speed を上書きする経路は依然 1 本、 場所が tick に固定)。
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/physicsState\.advance\(/);
    expect(m[0]).not.toMatch(/rider\.setSpeed\(/);
  });

  it('b125a: rider.setSpeed は rAF tick で physicsState.interpolate(t) の戻り (speedMps) 経由で呼ばれる', () => {
    const m = viewer.match(/function\s+tick\s*\([^)]*\)\s*\{[\s\S]*?^\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/physicsState\.interpolate\(/);
    expect(m[0]).toMatch(/rider\.setSpeed\(\s*speedMps\s*\)/);
  });
});

describe('viewer 物理駆動: 旧 EMA blend は live コードから撤去済', () => {
  it('inertiaFactor の宣言が live コードに無い (= EMA 係数廃止)', () => {
    expect(viewerLive).not.toMatch(/\binertiaFactor\b/);
  });

  it('旧 EMA blend 式 (oldS * ... + s * (1 - ...)) が live コードに無い', () => {
    expect(viewerLive).not.toMatch(/oldS\s*\*/);
  });

  it('b125c: フライホイール慣性は bike_settings.js が SoT (= viewer 内 module-global は撤去)', () => {
    // 旧: viewer が `let inertiaKg = ...` を持っていた
    // 新: bike_settings.js に集約、 viewer は bikeSettings.getInertia() / setInertia() 経由
    expect(viewerLive).not.toMatch(/let\s+inertiaKg\s*=/);
    expect(viewerLive).toMatch(/bikeSettings\.setInertia/);
  });
});

describe('viewer 物理駆動: 慣性 slider は kg、 localStorage キーは新名', () => {
  it('b125c: localStorage キー fujihill.inertiaKg は bike_settings.js が読む (= 旧 fujihill.inertia と別名)', () => {
    const bikeSettingsSrc = readFileSync(resolve(__dirname, '..', 'lib', 'bike_settings.js'), 'utf8');
    expect(bikeSettingsSrc).toMatch(/fujihill\.inertiaKg|inertia:\s*STORAGE_PREFIX\s*\+\s*['"]inertiaKg['"]/);
  });

  it('rngInertia slider は 0..3000 kg、 step 50 (= CONTROL_DEFS で定義)', () => {
    // b13-1: slider は control_panel.js が動的生成するため静的 HTML には無い。
    // viewer-maplibre.js の CONTROL_DEFS に inertiaKg の定義があることを pin する。
    expect(viewer).toMatch(/key\s*:\s*['"]inertiaKg['"]/);
    expect(viewer).toMatch(/min\s*:\s*0.*max\s*:\s*3000|max\s*:\s*3000.*min\s*:\s*0/);
    expect(viewer).toMatch(/step\s*:\s*50/);
  });

  it('慣性 slider のラベル単位が kg相当 (= % ではない)', () => {
    // b13-1: CONTROL_DEFS の inertiaKg エントリに unit:'kg相当' があることを pin する。
    const m = viewer.match(/key\s*:\s*['"]inertiaKg['"][\s\S]{0,200}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/kg相当/);
  });
});

// === behavioral: 共有関数 integratePhysics を viewer と同じ opts で直接叩いて物理を pin ===
//
// viewer の wsHandlers.state は { mass:88, c_rr:0.005, c_d:0.35, area:1, inertia:inertiaKg } で
// integratePhysics を呼ぶ。 下記は同じ opts を渡して共有関数の物理挙動を pin する。
// dt はすべて viewer のクランプ範囲 [0.1, 2.0] 内の値 (= クランプ後と同値) を直接渡す。
const VIEWER_OPTS = (inertiaKg) => ({ mass: 88, c_rr: 0.005, c_d: 0.35, area: 1, inertia: inertiaKg });

describe('viewer 物理駆動 behavioral (共有 substep 関数 integratePhysics)', () => {
  it('power=0 + 下り勾配で速度が増える (= 元バグ「足を止めると即減速」 の再発防止)', () => {
    let v = 8; // 8 m/s で巡航中
    const v0 = v;
    // 1Hz state メッセージを 5 回 (= 5 秒) 受け取った想定、 下り -7%、 ペダル止め (power=0)。
    for (let i = 0; i < 5; i++) v = integratePhysics(v, 1.0, 0, -7, VIEWER_OPTS(800));
    expect(v).toBeGreaterThan(v0); // 下りなので加速する
    expect(Number.isFinite(v)).toBe(true);
  });

  it('power 一定 + 平地で速度が収束する', () => {
    // 慣性 800kg は加速度の分母が大きく収束が遅いので十分な時間 (= 1800 秒) 回す。
    let v = 3;
    for (let i = 0; i < 1800; i++) v = integratePhysics(v, 1.0, 200, 0, VIEWER_OPTS(800));
    const vSettled = v;
    for (let i = 0; i < 120; i++) v = integratePhysics(v, 1.0, 200, 0, VIEWER_OPTS(800));
    // 収束: 追加 120 秒でほぼ変化しない
    expect(Math.abs(v - vSettled)).toBeLessThan(0.05);
    expect(v).toBeGreaterThan(0);
  });

  it('勾配ゼロ・速度ゼロ・power ゼロで NaN や負値にならない', () => {
    let v = 0;
    for (let i = 0; i < 10; i++) v = integratePhysics(v, 1.0, 0, 0, VIEWER_OPTS(800));
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  });

  it('慣性 kg が大きいほど加速がゆるい (= スライダー値が applyPhysicsStep の inertia に届く)', () => {
    // 同じ power / 勾配 / dt で慣性 0 と 3000 を比較。 慣性大 → 加速度の分母が大きく加速が鈍る。
    const vLowInertia = integratePhysics(0, 2.0, 300, 0, VIEWER_OPTS(0));
    const vHighInertia = integratePhysics(0, 2.0, 300, 0, VIEWER_OPTS(3000));
    expect(vLowInertia).toBeGreaterThan(vHighInertia);
    // 慣性ゼロでないことの裏取り: 0 を渡したときと差が出る
    expect(vHighInertia).toBeGreaterThan(0);
  });

  it('dt=0 を渡すと速度は変化しない (= 共有関数の境界)', () => {
    expect(integratePhysics(5, 0, 300, 0, VIEWER_OPTS(800))).toBe(5);
  });

  it('サブステップ分割は積分結果に依存しない (= 1 回 2.0s と 2 回 1.0s が一致)', () => {
    const opts = VIEWER_OPTS(800);
    const oneShot = integratePhysics(0, 2.0, 250, -3, opts);
    let split = 0;
    split = integratePhysics(split, 1.0, 250, -3, opts);
    split = integratePhysics(split, 1.0, 250, -3, opts);
    // 1/120s 固定サブステップなので 2.0s 区間も 1.0s×2 も同じステップ列を辿る。
    expect(split).toBeCloseTo(oneShot, 10);
  });
});

// === viewer の「rider 位置からコース勾配を引いて積分する」経路の pin ===
//
// 2026-05-17 Critical fix の回帰防止。 旧コードは tick() が更新する module global
// (currentCourseSlopePct、 初期値 0) を読んでいたため、 初回 tick より先に state push が
// 来ると slope=0 で積分してしまった。 富士ヒルは登坂なので登り抵抗が抜けて速度が過大化。
// 修正後は wsHandlers.state が rider.snapshot().position.slope_pct を都度引く。
//
// 下記 viewerSlopeStep は wsHandlers.state のうち「コース勾配を rider 位置から引く」 部分を
// 本物の createTerrain / createRider で再現する。 物理積分そのものは共有関数 integratePhysics
// (= viewer 本番が叩くのと同一関数) なので、 ここで手コピーしているのは slope の引き方だけ。
// wsHandlers.state ハンドラ全体の実走ではない (上部コメント「pin しない」参照)。
function viewerSlopeStep(rider, physicsV, dtSec, powerW, inertiaKg) {
  let dt = dtSec;
  if (dt < 0.1) dt = 0.1;
  if (dt > 2.0) dt = 2.0;
  // 本番と同一: rider の現在位置のコース勾配を直接引く (tick 由来 global に依存しない)。
  const pos = rider.snapshot().position;
  const slopePct = (pos && Number.isFinite(pos.slope_pct)) ? pos.slope_pct : 0;
  const v = integratePhysics(physicsV, dt, powerW, slopePct, VIEWER_OPTS(inertiaKg));
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

describe('viewer 物理駆動: rider 位置からコース勾配を引いて積分する経路', () => {
  it('rider が登坂位置にいるとき state ハンドラは slope=0 でなく登り勾配で積分する', () => {
    const terrain = createTerrain({ course: buildClimbCourse(50, 8) });
    const rider = createRider({ terrain });
    // rider を登坂区間の途中 (= 200m 地点) に置く。 tick はまだ 1 度も走っていない想定。
    rider.placeAtDistance(200);

    // wsHandlers.state を 1 回受け取る (= 初回 tick より先に来たケース)。
    const { v, slopePct } = viewerSlopeStep(rider, 0, 1.0, 250, 800);

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
      vFixed = viewerSlopeStep(rider, vFixed, 1.0, 250, 800).v;
    }
    // バグ再現 (= slope を強制 0 にした積分) — 登り抵抗が抜けて速くなるはず。
    let vBuggy = 0;
    for (let i = 0; i < 10; i++) {
      vBuggy = integratePhysics(vBuggy, 1.0, 250, 0, VIEWER_OPTS(800));
    }
    // 富士ヒルの登坂で slope=0 にすると重力減速が抜けて過大な速度になる。
    expect(vBuggy).toBeGreaterThan(vFixed);
    expect(vFixed).toBeGreaterThan(0);
  });
});
