// b127: ride_resume.js の純粋関数 unit. DOM / window 参照ゼロ、 deps を stub で渡す.
import { describe, it, expect, vi } from 'vitest';
import { resumeFromRecord } from '../lib/ride_resume.js';

function makeDeps(overrides = {}) {
  return {
    rider: { placeAtDistance: vi.fn(), distanceTraveled: 0 },
    physicsState: { restoreFromSnapshot: vi.fn() },
    rideClock: { start: vi.fn() },
    nowMs: 1000,
    ...overrides,
  };
}

describe('resumeFromRecord: 過去 ride record から rider 位置 + 物理速度 + 時計を復元', () => {
  it('record=null → {ok:false, reason:no_record}、 副作用ゼロ', () => {
    const deps = makeDeps();
    const r = resumeFromRecord(null, deps);
    expect(r).toEqual({ ok: false, reason: 'no_record' });
    expect(deps.rider.placeAtDistance).not.toHaveBeenCalled();
    expect(deps.physicsState.restoreFromSnapshot).not.toHaveBeenCalled();
    expect(deps.rideClock.start).not.toHaveBeenCalled();
  });

  it('record=undefined も同じく no_record', () => {
    expect(resumeFromRecord(undefined, makeDeps())).toEqual({ ok: false, reason: 'no_record' });
  });

  it('deps 不在 → {ok:false, reason:no_deps}', () => {
    expect(resumeFromRecord({ riderDistance: 100 }, null)).toEqual({ ok: false, reason: 'no_deps' });
    expect(resumeFromRecord({ riderDistance: 100 }, {})).toEqual({ ok: false, reason: 'no_deps' });
  });

  it('nowMs 不在 / NaN → {ok:false, reason:no_nowMs}', () => {
    const deps = makeDeps({ nowMs: NaN });
    expect(resumeFromRecord({ riderDistance: 100 }, deps)).toEqual({ ok: false, reason: 'no_nowMs' });
  });

  it('riderDistance も summary.distance_m も無い → {ok:false, reason:no_distance}', () => {
    const deps = makeDeps();
    expect(resumeFromRecord({ id: 'r1' }, deps)).toEqual({ ok: false, reason: 'no_distance' });
    expect(deps.rider.placeAtDistance).not.toHaveBeenCalled();
  });

  it('v2 record (= schemaVersion=2 + physicsSnap + riderDistance) で 3 経路全部呼ばれる', () => {
    const deps = makeDeps();
    const physicsSnap = {
      physicsSpeedMps: 5,
      displaySpeedMps: 5,
      prevPhysicsSpeedMps: 5,
      lastPhysicsStateT: 999,
    };
    const record = { id: 'r1', schemaVersion: 2, riderDistance: 12345, physicsSnap };
    const r = resumeFromRecord(record, deps);
    expect(r.ok).toBe(true);
    expect(r.restored).toEqual({
      schemaVersion: 2,
      riderDistance: 12345,
      physicsRestored: true,
    });
    expect(deps.rider.placeAtDistance).toHaveBeenCalledWith(12345);
    expect(deps.physicsState.restoreFromSnapshot).toHaveBeenCalledWith(physicsSnap, { nowMs: 1000 });
    expect(deps.rideClock.start).toHaveBeenCalledWith({ nowMs: 1000 });
  });

  it('v1 record (= schemaVersion 不在) は summary.distance_m を fallback、 physicsSnap=null', () => {
    const deps = makeDeps();
    const record = { id: 'r1', summary: { distance_m: 8000 } };
    const r = resumeFromRecord(record, deps);
    expect(r.ok).toBe(true);
    expect(r.restored).toEqual({
      schemaVersion: 1,
      riderDistance: 8000,
      physicsRestored: false,
    });
    expect(deps.rider.placeAtDistance).toHaveBeenCalledWith(8000);
    expect(deps.physicsState.restoreFromSnapshot).toHaveBeenCalledWith(null, { nowMs: 1000 });
    expect(deps.rideClock.start).toHaveBeenCalledWith({ nowMs: 1000 });
  });

  it('v2 record でも physicsSnap が null / undefined なら physicsRestored=false', () => {
    const deps = makeDeps();
    const record = { id: 'r1', schemaVersion: 2, riderDistance: 5000, physicsSnap: null };
    const r = resumeFromRecord(record, deps);
    expect(r.ok).toBe(true);
    expect(r.restored.physicsRestored).toBe(false);
    expect(deps.physicsState.restoreFromSnapshot).toHaveBeenCalledWith(null, { nowMs: 1000 });
  });

  it('riderDistance=0 (= ride 直後 stop した record) も合法、 fallback に逃げない', () => {
    const deps = makeDeps();
    const record = { id: 'r1', schemaVersion: 2, riderDistance: 0, physicsSnap: null };
    const r = resumeFromRecord(record, deps);
    expect(r.ok).toBe(true);
    expect(r.restored.riderDistance).toBe(0);
    expect(deps.rider.placeAtDistance).toHaveBeenCalledWith(0);
  });

  it('riderDistance が負なら summary.distance_m に fallback (= 異常値防御)', () => {
    const deps = makeDeps();
    const record = { id: 'r1', riderDistance: -10, summary: { distance_m: 3000 } };
    const r = resumeFromRecord(record, deps);
    expect(r.ok).toBe(true);
    expect(r.restored.riderDistance).toBe(3000);
  });
});
