// web/tests/b125a_physics_state_unit.test.js
// b125a: physics_state.js の closure factory createPhysicsState を node 単体で pin。
// advance / interpolate / reset / snapshot の state transition と guard を、 integratePhysics を
// 「毎回 +1 m/s」 の mock に差し替えて black-box 観測する (= 物理計算自体は bike_physics.test.js が pin)。
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/bike_physics.js', () => ({
  // 入力に関わらず常に +1 m/s 返す mock、 advance の state transition を観測しやすくする
  integratePhysics: vi.fn((v, dt, power, slopePct, opts) => v + 1.0),
}));

import { createPhysicsState } from '../lib/physics_state.js';

describe('b125a: createPhysicsState — happy path', () => {
  it('advance で physicsSpeedMps が integratePhysics の戻り値に更新される', () => {
    const ps = createPhysicsState();
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    const s = ps.snapshot();
    expect(s.physicsSpeedMps).toBe(1.0);             // 0 + 1.0 (mock)
    expect(s.lastPhysicsStateT).toBe(1000);
    expect(s.prevPhysicsSpeedMps).toBe(0);           // displaySpeedMps 初期値 0 が seed
  });

  it('2 回目の advance で dt = 1.0s が integratePhysics に渡る', async () => {
    const { integratePhysics } = await import('../lib/bike_physics.js');
    integratePhysics.mockClear();
    const ps = createPhysicsState();
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    ps.advance({ nowMs: 2000, power: 200, slopePct: 0, physicsOpts: {} });
    expect(integratePhysics.mock.calls[1][1]).toBeCloseTo(1.0);  // dt 引数
  });

  it('interpolate(nowMs) は prev → physicsSpeedMps の線形補間 (frac=0.5)', () => {
    const ps = createPhysicsState({ initialSpeedMps: 5 });
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    // advance 後: physicsSpeedMps=6 (=5+1), prevPhysicsSpeedMps=5, lastPhysicsStateT=1000
    const display = ps.interpolate(1500);            // elapsed=500ms / EXPECTED=1000ms → frac=0.5
    expect(display).toBeCloseTo(5.5);                 // 5 + (6-5)*0.5
  });

  it('interpolate(nowMs) で elapsed > EXPECTED なら frac=1.0 clamp', () => {
    const ps = createPhysicsState({ initialSpeedMps: 5 });
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    const display = ps.interpolate(5000);             // elapsed=4s >> EXPECTED=1s
    expect(display).toBeCloseTo(6.0);                  // physicsSpeedMps と一致
  });

  it('reset で 4 state が全部 speedMps、 lastPhysicsStateT が nowMs', () => {
    const ps = createPhysicsState();
    ps.reset({ nowMs: 5000, speedMps: 5.555 });
    const s = ps.snapshot();
    expect(s.physicsSpeedMps).toBe(5.555);
    expect(s.displaySpeedMps).toBe(5.555);
    expect(s.prevPhysicsSpeedMps).toBe(5.555);
    expect(s.lastPhysicsStateT).toBe(5000);
  });

  it('snapshot は新規 object を返す (= mutation 漏れなし)', () => {
    const ps = createPhysicsState({ initialSpeedMps: 3 });
    const s1 = ps.snapshot();
    s1.physicsSpeedMps = 999;                          // 外で mutate
    const s2 = ps.snapshot();
    expect(s2.physicsSpeedMps).toBe(3);                 // closure 内 state は不変
  });

  it('reset 後の advance は新 seed (= speedMps) から積分', () => {
    const ps = createPhysicsState();
    ps.reset({ nowMs: 1000, speedMps: 10 });
    ps.advance({ nowMs: 2000, power: 200, slopePct: 0, physicsOpts: {} });
    expect(ps.snapshot().physicsSpeedMps).toBe(11);    // 10 + 1.0 (mock)
  });
});

describe('b125a: createPhysicsState — edge / error path (= 軸 7 セキュリティ pin)', () => {
  it('advance 呼ぶ前の interpolate は initialSpeedMps を返す (= lastPhysicsStateT=null 防御)', () => {
    const ps = createPhysicsState({ initialSpeedMps: 2.5 });
    expect(ps.interpolate(1000)).toBe(2.5);
  });

  it('advance の nowMs=NaN は無視、 closure state を NaN 汚染しない', () => {
    const ps = createPhysicsState();
    ps.advance({ nowMs: NaN, power: 200, slopePct: 0, physicsOpts: {} });
    const s = ps.snapshot();
    expect(Number.isFinite(s.physicsSpeedMps)).toBe(true);
    expect(s.physicsSpeedMps).toBe(0);                  // 初期値のまま
    expect(s.lastPhysicsStateT).toBe(null);             // 触れない
  });

  it('advance の nowMs=Infinity も同様に無視', () => {
    const ps = createPhysicsState();
    ps.advance({ nowMs: Infinity, power: 200, slopePct: 0, physicsOpts: {} });
    expect(ps.snapshot().lastPhysicsStateT).toBe(null);
  });

  it('clock skew (= nowMs が前回より小さい) は dt clamp で吸収、 closure state が NaN にならない', () => {
    const ps = createPhysicsState();
    ps.advance({ nowMs: 2000, power: 200, slopePct: 0, physicsOpts: {} });
    const before = ps.snapshot().physicsSpeedMps;
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });  // 逆行
    const after = ps.snapshot().physicsSpeedMps;
    expect(Number.isFinite(after)).toBe(true);
    expect(after).toBe(before + 1.0);                   // dt=0.1s clamp 経由でも mock は +1
  });

  it('interpolate の nowMs=NaN は最後の有効 displaySpeedMps を返す (= NaN 伝播なし)', () => {
    const ps = createPhysicsState({ initialSpeedMps: 3 });
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    const display = ps.interpolate(NaN);
    expect(Number.isFinite(display)).toBe(true);
  });

  it('interpolate の frac=0 floor (= elapsed が負でも displaySpeedMps が逆走しない)', () => {
    // clock skew で nowMs が lastPhysicsStateT より前に来た時、 Math.max(0, ...) が無いと
    // displaySpeedMps が prev より小さくなる silent regression を起こす。 振る舞い不変保証の core。
    const ps = createPhysicsState({ initialSpeedMps: 5 });
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: {} });
    // advance 後: physicsSpeedMps=6, prevPhysicsSpeedMps=5
    const display = ps.interpolate(500);                // nowMs < lastPhysicsStateT、 elapsed=-0.5s
    expect(display).toBeCloseTo(5);                      // frac=0 で prev のみ、 逆走しない
  });
});
