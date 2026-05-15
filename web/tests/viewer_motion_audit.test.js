// brief 35: viewer-maplibre.js が Terrain + Rider 2 層モデルに rewire されたことを
// source-grep + behavioral 両面で pin する gate.
//
// 検証要点:
//   1. viewer は terrain + rider 変数を持ち、 createTerrain / createRider を import している
//   2. 旧 module global (playSpeed / curIdx / curDist / spinAngle) は live コードに無い
//      (= コメント内の言及はマイグレーション履歴として許容)
//   3. wsHandlers.state は rider.setSpeed / rider.setSensors を呼ぶ (= 1 経路化)
//   4. 観るモード section click は rider.setSpeed(20/3.6) を呼ぶ (= 1Hz 待ち workaround 撤去)
//   5. tick は rider.tick + rider.snapshot 経路 (= 旧 rideState.advance / rideState.snapshot
//      の inline 補間計算は撤去)
//   6. updateMinimap 呼出が riderHeadingRad (= 定義済) を渡す (= 旧 headingRad 未定義 bug 修正)
//   7. ride_state.js は Terrain + Rider への shim になっており、 createTerrain / createRider を import.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTerrain } from '../lib/terrain.js';
import { createRider } from '../lib/rider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const RIDE_STATE_PATH = resolve(__dirname, '..', 'lib', 'ride_state.js');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const rideStateSrc = readFileSync(RIDE_STATE_PATH, 'utf8');

// live コード走査用 helper: 1 行コメントと block コメントを剥がす. 文字列リテラル内の
// マッチを誤拾いするが、 本テストの目的 (= module top の declaration / assignment 検出) には十分.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}
const viewerLive = stripComments(viewer);

describe('brief 35: viewer は Terrain + Rider 2 層モデルを使う', () => {
  it('createTerrain を web/lib/terrain.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createTerrain[^}]*\}\s+from\s+['"]\.\/lib\/terrain\.js['"]/);
  });

  it('createRider を web/lib/rider.js から import している', () => {
    expect(viewer).toMatch(/import\s+\{[^}]*createRider[^}]*\}\s+from\s+['"]\.\/lib\/rider\.js['"]/);
  });

  it('terrain / rider の module global が宣言されている', () => {
    expect(viewerLive).toMatch(/let\s+terrain\s*=\s*null/);
    expect(viewerLive).toMatch(/let\s+rider\s*=\s*null/);
  });

  it('loadCourse で terrain = createTerrain({course}) が呼ばれる', () => {
    // stripComments は block コメント外しが粗いので、 ここは生 source で grep する
    // (= コメント内に偶然 createTerrain と書くことは brief 35 では起きないため誤検出リスク低).
    expect(viewer).toMatch(/terrain\s*=\s*createTerrain\(\s*\{\s*course\s*\}\s*\)/);
  });

  it('loadCourse で rider が rideState._rider と一致 (= 二重 state 防止)', () => {
    expect(viewer).toMatch(/rider\s*=\s*rideState\._rider/);
  });
});

describe('brief 35: 旧 module global (playSpeed / spinAngle) は live コードに存在しない', () => {
  it('let playSpeed = の declaration が live コードに無い', () => {
    expect(viewerLive).not.toMatch(/^\s*let\s+playSpeed\b/m);
  });

  it('let spinAngle = の declaration が live コードに無い', () => {
    expect(viewerLive).not.toMatch(/^\s*let\s+spinAngle\b/m);
  });

  it('playSpeed への assignment が live コードに無い (= rider.setSpeed 経由のみ)', () => {
    // `playSpeed =` 形式の assignment を live コード内で探す
    // (= リテラル文字列やコメント以外で代入が残っていないこと).
    expect(viewerLive).not.toMatch(/\bplaySpeed\s*=/);
  });

  it('spinAngle への += assignment が live コードに無い (= rider.tick 内で自動進行)', () => {
    expect(viewerLive).not.toMatch(/\bspinAngle\s*\+?=/);
  });
});

describe('brief 35: wsHandlers.state は rider.setSpeed / rider.setSensors を呼ぶ', () => {
  it('state ハンドラ内に rider.setSpeed の呼出がある', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.setSpeed\(/);
  });

  it('state ハンドラ内に rider.setSensors の呼出がある', () => {
    const m = viewer.match(/state\s*\(\s*msg\s*\)\s*\{[\s\S]*?^\s{2}\}/m);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.setSensors\(/);
  });
});

describe('brief 35: 観るモード section click は rider.setSpeed を即時呼ぶ', () => {
  it('renderSectionList の onSelect callback に rider.setSpeed(20 / 3.6) がある', () => {
    // initViewMode 関数内に rider.setSpeed の即時呼出が含まれる (= 1Hz fake state 待ち workaround
    // の置換、 user 視点の「click → 即動き出す」 を物理保証).
    const m = viewer.match(/function\s+initViewMode\s*\([\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.setSpeed\(\s*20\s*\/\s*3\.6\s*\)/);
  });
});

describe('brief 35: tick 関数は rider.tick + snapshot 経路', () => {
  it('tick 内で rider.tick(dt, ...) を呼ぶ', () => {
    const m = viewer.match(/function\s+tick\s*\(\s*t\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.tick\(\s*dt/);
  });

  it('tick 内で rider.snapshot を取り出してから position を消費する', () => {
    const m = viewer.match(/function\s+tick\s*\(\s*t\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.snapshot\(\)/);
    expect(m[0]).toMatch(/snap\.position/);
  });

  it('tick 内で updateMinimap に riderHeadingRad を渡している (= 旧 headingRad 未定義 bug 修正)', () => {
    const m = viewer.match(/function\s+tick\s*\(\s*t\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    // updateMinimap(... , riderHeadingRad) が呼ばれる. 旧 headingRad は別 symbol で未定義だった.
    expect(m[0]).toMatch(/updateMinimap\([^)]*riderHeadingRad/);
    // 旧 bug pattern (= updateMinimap に headingRad だけを渡す) が live コードに残っていない.
    const tickLive = stripComments(m[0]);
    expect(tickLive).not.toMatch(/updateMinimap\([^)]*,\s*headingRad\s*\)/);
  });

  it('tick 内で rider.atGoal を end 判定に使う (= rideState.isAtEnd と等価)', () => {
    const m = viewer.match(/function\s+tick\s*\(\s*t\s*\)\s*\{[\s\S]*?\n\}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/rider\.atGoal/);
  });
});

describe('brief 35: ride_state.js は Terrain + Rider への shim', () => {
  it('createTerrain を import している', () => {
    expect(rideStateSrc).toMatch(/import\s+\{\s*createTerrain\s*\}\s+from\s+['"]\.\/terrain\.js['"]/);
  });

  it('createRider を import している', () => {
    expect(rideStateSrc).toMatch(/import\s+\{\s*createRider\s*\}\s+from\s+['"]\.\/rider\.js['"]/);
  });

  it('createRideState の戻り値は _rider / _terrain を持つ (= viewer 共有用)', () => {
    expect(rideStateSrc).toMatch(/_rider:\s*rider/);
    expect(rideStateSrc).toMatch(/_terrain:\s*terrain/);
  });
});

// === behavioral: Terrain + Rider の組合せが viewer の使い方で正しく動く ===
function buildSimpleCourse() {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    out.push({
      lat: 35.4 + i * 0.001, lon: 138.7,
      distance_m: i * 111, elevation_m: 1000 + i * 10, slope_pct: 5,
    });
  }
  return out;
}

describe('brief 35 behavioral: 観るモード section click → 即動き出す (= 1Hz workaround 撤去 後)', () => {
  it('rider.startFromIdx + rider.setSpeed(20/3.6) → tick で即進む (= 1Hz fake state を待たない)', () => {
    const t = createTerrain({ course: buildSimpleCourse() });
    const r = createRider({ terrain: t });
    // section 5 (= idx=5) を click した状況.
    r.startFromIdx(5);
    expect(r.distanceTraveled).toBe(555);
    expect(r.active).toBe(true);
    expect(r.paused).toBe(false);
    // 観るモードの即時セット.
    r.setSpeed(20 / 3.6);
    // 1 フレーム (= 16ms) tick → 即進む (= 旧 viewer は 1 秒後の fake state 待ちで進まなかった).
    r.tick(0.016, { speedMultiplier: 1.0 });
    expect(r.distanceTraveled).toBeGreaterThan(555);
    expect(r.distanceTraveled).toBeLessThan(555 + 1);  // 1 frame で 1m 未満
  });

  it('fake state push (= 1Hz で setSpeed 上書き) が来ても即時 setSpeed は drift しない (= idempotent)', () => {
    const t = createTerrain({ course: buildSimpleCourse() });
    const r = createRider({ terrain: t });
    r.startFromIdx(0);
    r.setSpeed(20 / 3.6);  // 即時セット
    r.tick(0.5, { speedMultiplier: 1.0 });
    const beforeFake = r.distanceTraveled;
    // 1 秒後の fake state catch-up (= 同じ 20/3.6 を上書き).
    r.setSpeed(20 / 3.6);
    r.tick(0.5, { speedMultiplier: 1.0 });
    // 累積で 1 秒間進んだ. 中断は無い (= 旧 bug の「fake state が 0 上書きしてくる」 は無くなる).
    expect(r.distanceTraveled).toBeGreaterThan(beforeFake);
    expect(r.distanceTraveled).toBeCloseTo((20 / 3.6) * 1.0, 2);
  });
});
