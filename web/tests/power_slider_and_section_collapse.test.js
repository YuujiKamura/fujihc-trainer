// b53: 区間リストパネルの折りたたみトグル + パワースライダー (default 250W) の gate。
//
// 足した 2 機能:
//   1. #section-list-panel のヘッダに折りたたみトグル button (#btnSectionCollapse)。
//   2. 調整パネル (CONTROL_DEFS) にパワースライダー power def (default 250W)。
//      観る / デモ / TEST モードの fake trainer が出す power_w をスライダー値にする。
//
// このファイルが pin するもの / pin しないもの:
//   pin する:
//     - createFakeStateGenerator の getPower 引数 (= moving 時 power を返す / 省略時 150 /
//       非数 fallback / 非 moving は 0)
//     - getPower 値の違いが integratePhysics の速度に届く behavioral 鎖
//     - viewer-maplibre.js source: power def が CONTROL_DEFS に default 250 / unit W で
//       入っていること、 manualPowerW を fujihill.power から読むこと、
//       createFakeStateGenerator 呼び出し 3 箇所に manualPowerW を渡すこと、
//       btnSectionCollapse の click handler があること
//     - index.html source: btnSectionCollapse button + collapsed CSS ルール
//   pin しない:
//     - 実 DOM での折りたたみ click → display 反映 (= e2e の範囲、 view_mode_exit.spec.js)。
//       viewer-maplibre.js は maplibre-gl / DOM 依存で単体 import 不可のため source 走査で代替。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createFakeStateGenerator } from '../lib/ws_client.js';
import { integratePhysics } from '../lib/bike_physics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = resolve(__dirname, '..', 'viewer-maplibre.js');
const INDEX_PATH = resolve(__dirname, '..', 'index.html');
const viewer = readFileSync(VIEWER_PATH, 'utf8');
const indexHtml = readFileSync(INDEX_PATH, 'utf8');

// live コード走査用: コメントを剥がす (viewer_physics_drive.test.js と同型)。
// コメント内の例示コード (例: `() => manualPowerW`) を実コードと数え違えないため。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}
const viewerLive = stripComments(viewer);

// active かつ非 paused の snapshot を返す getSnapshot (= moving 状態).
const movingSnap = () => ({ active: true, paused: false, distance: 0 });
// 未開始 snapshot (= 非 moving).
const idleSnap = () => ({ active: false, paused: true, distance: 0 });

describe('b53: createFakeStateGenerator の getPower 引数', () => {
  it('getPower を渡すと moving 時 power_w がその戻り値になる', () => {
    const gen = createFakeStateGenerator(movingSnap, 'OK (VIEW MODE)', () => 320);
    expect(gen().power_w).toBe(320);
  });

  it('getPower を省略すると moving 時 power_w は 150 のまま (= 後方互換)', () => {
    const gen = createFakeStateGenerator(movingSnap, 'OK (TEST MODE)');
    expect(gen().power_w).toBe(150);
  });

  it('非 moving のときは getPower があっても power_w は 0', () => {
    const gen = createFakeStateGenerator(idleSnap, 'OK (VIEW MODE)', () => 400);
    expect(gen().power_w).toBe(0);
  });

  it('getPower が非数 (NaN / undefined) を返したら 150 に fallback する', () => {
    expect(createFakeStateGenerator(movingSnap, 'X', () => NaN)().power_w).toBe(150);
    expect(createFakeStateGenerator(movingSnap, 'X', () => undefined)().power_w).toBe(150);
  });

  it('getPower は呼ぶたび評価される (= スライダーを動かすと次の tick で反映)', () => {
    let p = 100;
    const gen = createFakeStateGenerator(movingSnap, 'X', () => p);
    expect(gen().power_w).toBe(100);
    p = 500;
    expect(gen().power_w).toBe(500);
  });
});

describe('b53: パワースライダー値が integratePhysics の速度に届く (behavioral)', () => {
  // viewer の wsHandlers.state が使う opts と同型 (= viewer_physics_drive.test.js と揃える).
  const OPTS = { mass: 88, c_rr: 0.001, c_d: 0.35, area: 1, inertia: 800 };

  it('getPower の値が大きいほど積分後の速度が速い (= スライダー → fake power → 物理)', () => {
    const genLow = createFakeStateGenerator(movingSnap, 'X', () => 100);
    const genHigh = createFakeStateGenerator(movingSnap, 'X', () => 400);
    let vLow = 0, vHigh = 0;
    // 1Hz state を 30 回 (= 30 秒)、 平地で積分。
    for (let i = 0; i < 30; i++) {
      vLow = integratePhysics(vLow, 1.0, genLow().power_w, 0, OPTS);
      vHigh = integratePhysics(vHigh, 1.0, genHigh().power_w, 0, OPTS);
    }
    expect(vHigh).toBeGreaterThan(vLow);
    expect(vLow).toBeGreaterThan(0);
  });

  it('default 250W は固定 20km/h (= 5.56 m/s) とは異なる速度に収束する', () => {
    const gen = createFakeStateGenerator(movingSnap, 'X', () => 250);
    let v = 0;
    for (let i = 0; i < 600; i++) v = integratePhysics(v, 1.0, gen().power_w, 0, OPTS);
    // 物理積分の結果なので、 旧来の固定 20km/h ハードコードと一致しないこと。
    expect(v).toBeGreaterThan(0);
    expect(Math.abs(v - 20 / 3.6)).toBeGreaterThan(0.1);
  });
});

describe('b53: viewer-maplibre.js source — パワースライダーの配線', () => {
  it('CONTROL_DEFS に power def が key=power / value=250 / unit=W で入っている', () => {
    const m = viewer.match(/key\s*:\s*['"]power['"][\s\S]{0,260}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/value\s*:\s*250/);
    expect(m[0]).toMatch(/unit\s*:\s*['"]W['"]/);
    expect(m[0]).toMatch(/label\s*:\s*['"]パワー['"]/);
  });

  it('manualPowerW を localStorage キー fujihill.power から読む (= 既定 250)', () => {
    expect(viewer).toMatch(/let\s+manualPowerW\s*=\s*_lsNum\(\s*['"]fujihill\.power['"]\s*,\s*250\s*\)/);
  });

  it('power def の apply が manualPowerW を書き換える', () => {
    const m = viewer.match(/key\s*:\s*['"]power['"][\s\S]{0,260}/);
    expect(m[0]).toMatch(/manualPowerW\s*=\s*raw/);
  });

  it('createFakeStateGenerator 呼び出し 3 箇所に () => manualPowerW を渡している', () => {
    // コメント除去後の live コードで数える (= コメント内の例示と区別)。
    const occurrences = viewerLive.match(/\(\)\s*=>\s*manualPowerW/g) || [];
    // initTestMode / initViewMode / initMapMode の 3 箇所。
    expect(occurrences.length).toBe(3);
  });

  it('btnSectionCollapse の click handler が classList.toggle("collapsed") を呼ぶ', () => {
    const m = viewer.match(/btnSectionCollapse[\s\S]{0,400}/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/addEventListener\(\s*['"]click['"]/);
    expect(m[0]).toMatch(/classList\.toggle\(\s*['"]collapsed['"]\s*\)/);
    expect(m[0]).toMatch(/aria-expanded/);
  });
});

describe('b53: index.html source — 折りたたみトグル DOM + CSS', () => {
  it('#section-list-panel の h3 内に折りたたみトグル button #btnSectionCollapse がある', () => {
    expect(indexHtml).toMatch(/<button\s+id="btnSectionCollapse"/);
    // 「区間を選んで観る」 を含む h3 (= section-list-panel のヘッダ) 内にあること。
    const m = indexHtml.match(/<h3>\s*<span>区間を選んで観る<\/span>[\s\S]*?<\/h3>/);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/id="btnSectionCollapse"/);
  });

  it('折りたたみ button は aria-expanded を持つ (= 開閉状態のアクセシビリティ)', () => {
    expect(indexHtml).toMatch(/id="btnSectionCollapse"[^>]*aria-expanded="true"/);
  });

  it('collapsed CSS ルールが #section-list と .panel-hint を display:none にする', () => {
    expect(indexHtml).toMatch(
      /#section-list-panel\.collapsed\s+#section-list[\s\S]{0,120}display:\s*none/);
    expect(indexHtml).toMatch(
      /#section-list-panel\.collapsed\s+\.panel-hint[\s\S]{0,120}display:\s*none/);
  });
});
