// b127: physicsState.restoreFromSnapshot の振る舞い pin. 履歴続きから機能の前提.
import { describe, it, expect } from 'vitest';
import { createPhysicsState } from '../lib/physics_state.js';

const OPTS = { mass: 75, crr: 0.005, cda: 0.3, eta: 1.0, rho: 1.225, g: 9.8 };

describe('physicsState.restoreFromSnapshot: snap を 3 state に流し込む', () => {
  it('valid snap で physicsSpeedMps / displaySpeedMps / prevPhysicsSpeedMps が復元される', () => {
    const ps = createPhysicsState();
    const snap = {
      physicsSpeedMps: 7.5,
      displaySpeedMps: 7.0,
      prevPhysicsSpeedMps: 6.5,
      lastPhysicsStateT: 12345,
    };
    ps.restoreFromSnapshot(snap, { nowMs: 9999 });
    const after = ps.snapshot();
    expect(after.physicsSpeedMps).toBe(7.5);
    expect(after.displaySpeedMps).toBe(7.0);
    expect(after.prevPhysicsSpeedMps).toBe(6.5);
    // lastPhysicsStateT は args.nowMs で上書き (= 過去 ride の lastT を引きずらない)
    expect(after.lastPhysicsStateT).toBe(9999);
  });

  it('snap=null なら 3 state とも 0 / lastT=nowMs', () => {
    const ps = createPhysicsState({ initialSpeedMps: 10 });
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: OPTS });
    ps.restoreFromSnapshot(null, { nowMs: 5000 });
    const after = ps.snapshot();
    expect(after.physicsSpeedMps).toBe(0);
    expect(after.displaySpeedMps).toBe(0);
    expect(after.prevPhysicsSpeedMps).toBe(0);
    expect(after.lastPhysicsStateT).toBe(5000);
  });

  it('invalid snap (= 必須 field 欠落) は 0 reset 扱い', () => {
    const ps = createPhysicsState();
    ps.advance({ nowMs: 1000, power: 200, slopePct: 0, physicsOpts: OPTS });
    ps.restoreFromSnapshot({ physicsSpeedMps: 5 /* 他 field 欠落 */ }, { nowMs: 5000 });
    expect(ps.snapshot().physicsSpeedMps).toBe(0);
  });

  it('負の速度を含む snap は invalid 扱い、 0 reset', () => {
    const ps = createPhysicsState();
    const snap = {
      physicsSpeedMps: -1,
      displaySpeedMps: 5,
      prevPhysicsSpeedMps: 5,
      lastPhysicsStateT: 100,
    };
    ps.restoreFromSnapshot(snap, { nowMs: 9999 });
    expect(ps.snapshot().physicsSpeedMps).toBe(0);
  });

  it('args.nowMs を渡さなければ lastPhysicsStateT=null', () => {
    const ps = createPhysicsState();
    const snap = {
      physicsSpeedMps: 3,
      displaySpeedMps: 3,
      prevPhysicsSpeedMps: 3,
      lastPhysicsStateT: 100,
    };
    ps.restoreFromSnapshot(snap);
    expect(ps.snapshot().lastPhysicsStateT).toBe(null);
  });

  it('復元後の advance は新しい lastT を起点に dt 計算する', () => {
    const ps = createPhysicsState();
    const snap = {
      physicsSpeedMps: 5,
      displaySpeedMps: 5,
      prevPhysicsSpeedMps: 5,
      lastPhysicsStateT: 100,
    };
    ps.restoreFromSnapshot(snap, { nowMs: 5000 });
    ps.advance({ nowMs: 5500, power: 200, slopePct: 0, physicsOpts: OPTS });
    const after = ps.snapshot();
    expect(after.lastPhysicsStateT).toBe(5500);
    expect(after.physicsSpeedMps).toBeGreaterThan(0);
  });
});
