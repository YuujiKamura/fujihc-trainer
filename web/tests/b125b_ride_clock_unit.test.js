import { describe, it, expect } from 'vitest';
import { createRideClock } from '../lib/ride_clock.js';

describe('b125b: createRideClock — happy path', () => {
  it('start で rideStartedAt が nowMs、 isoString が保存される', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: '2026-05-29T00:00:00.000Z' });
    expect(c.isActive()).toBe(true);
    expect(c.snapshot().rideStartedAt).toBe(1000);
    expect(c.getRideStartedIso()).toBe('2026-05-29T00:00:00.000Z');
    expect(c.snapshot().lastRideDurationS).toBe(0);
  });

  it('end で duration が確定、 rideStartedAt と isoString が null clear', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: '2026-05-29T00:00:00.000Z' });
    const { durationS } = c.end({ nowMs: 61000 });  // 60 秒経過
    expect(durationS).toBe(60);
    expect(c.getDurationS()).toBe(60);
    expect(c.isActive()).toBe(false);
    expect(c.getRideStartedIso()).toBe(null);
  });

  it('restore で rideStartedAt が再起算、 isoString は record 値を保持', () => {
    const c = createRideClock();
    c.restore({ nowMs: 5000, isoString: '2026-05-28T22:00:00.000Z' });
    expect(c.isActive()).toBe(true);
    expect(c.snapshot().rideStartedAt).toBe(5000);
    expect(c.getRideStartedIso()).toBe('2026-05-28T22:00:00.000Z');
    // cadence 群が全部 5000 に揃ってる (= 即発火 gate)
    const s = c.snapshot();
    expect(s.lastPositionSendT).toBe(5000);
    expect(s.lastTrkptT).toBe(5000);
    expect(s.lastAutosaveT).toBe(5000);
  });

  it('elapsedSec(nowMs) は ride 中なら経過秒、 未開始なら null', () => {
    const c = createRideClock();
    expect(c.elapsedSec(1000)).toBe(null);  // 未開始
    c.start({ nowMs: 1000, isoString: 'X' });
    expect(c.elapsedSec(1000)).toBe(0);
    expect(c.elapsedSec(1500)).toBe(0);   // Math.floor、 0.5 秒は 0
    expect(c.elapsedSec(2000)).toBe(1);
    c.end({ nowMs: 5000 });
    expect(c.elapsedSec(6000)).toBe(null);  // end 後は null
  });

  it('shouldPushPosition は 1Hz cadence で gate、 trigger 後は state 更新', () => {
    const c = createRideClock();
    c.start({ nowMs: 0, isoString: 'X' });
    expect(c.shouldPushPosition(500)).toBe(false);    // < 1000ms
    expect(c.shouldPushPosition(1000)).toBe(true);     // 1000ms = trigger、 lastPositionSendT=1000
    expect(c.shouldPushPosition(1500)).toBe(false);    // 500ms 経過のみ
    expect(c.shouldPushPosition(2000)).toBe(true);     // 1000ms 経過、 trigger
  });

  it('shouldPushTrkpt も 1Hz cadence で gate', () => {
    const c = createRideClock();
    c.start({ nowMs: 0, isoString: 'X' });
    expect(c.shouldPushTrkpt(999)).toBe(false);
    expect(c.shouldPushTrkpt(1000)).toBe(true);
    expect(c.shouldPushTrkpt(1999)).toBe(false);
    expect(c.shouldPushTrkpt(2000)).toBe(true);
  });

  it('shouldRunAutosave は 30s cadence、 start 直後は lastAutosaveT=startNow なので 30s 経過で trigger', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: 'X' });
    expect(c.shouldRunAutosave(15000)).toBe(false);     // 14 秒
    expect(c.shouldRunAutosave(30999)).toBe(false);     // 29.999 秒
    expect(c.shouldRunAutosave(31000)).toBe(true);       // 30 秒 trigger
    expect(c.shouldRunAutosave(45000)).toBe(false);     // 14 秒経過のみ
    expect(c.shouldRunAutosave(61000)).toBe(true);       // 30 秒 trigger
  });

  it('snapshot は新規 object を返す (= mutation 漏れなし)', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: 'X' });
    const s1 = c.snapshot();
    s1.rideStartedAt = 999;
    const s2 = c.snapshot();
    expect(s2.rideStartedAt).toBe(1000);
  });
});

describe('b125b: createRideClock — edge / error path (= 軸 7 セキュリティ pin)', () => {
  it('start の nowMs=NaN は無視、 closure state を NaN 汚染しない', () => {
    const c = createRideClock();
    c.start({ nowMs: NaN, isoString: 'X' });
    expect(c.isActive()).toBe(false);
    expect(c.snapshot().rideStartedAt).toBe(null);
  });

  it('start の nowMs=Infinity も同様に無視', () => {
    const c = createRideClock();
    c.start({ nowMs: Infinity, isoString: 'X' });
    expect(c.isActive()).toBe(false);
  });

  it('start の isoString が非文字列なら null に正規化', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: 42 });
    expect(c.getRideStartedIso()).toBe(null);
    c.start({ nowMs: 1000, isoString: '' });
    expect(c.getRideStartedIso()).toBe(null);
  });

  it('end は rideStartedAt=null (= ride 未開始) で呼ばれても duration は前回確定値を維持', () => {
    const c = createRideClock();
    c.start({ nowMs: 0, isoString: 'X' });
    c.end({ nowMs: 60000 });  // duration=60
    expect(c.getDurationS()).toBe(60);
    const { durationS } = c.end({ nowMs: 70000 });  // 2 回目 end は no-op
    expect(durationS).toBe(60);
    expect(c.getDurationS()).toBe(60);
  });

  it('elapsedSec の nowMs=NaN は null を返す (= NaN 伝播なし)', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: 'X' });
    expect(c.elapsedSec(NaN)).toBe(null);
  });

  it('shouldPushPosition / shouldPushTrkpt / shouldRunAutosave の NaN は false を返す (= 暴発防止)', () => {
    const c = createRideClock();
    c.start({ nowMs: 1000, isoString: 'X' });
    expect(c.shouldPushPosition(NaN)).toBe(false);
    expect(c.shouldPushTrkpt(NaN)).toBe(false);
    expect(c.shouldRunAutosave(NaN)).toBe(false);
  });

  it('restore の nowMs=NaN は無視、 closure state 不変', () => {
    const c = createRideClock();
    c.restore({ nowMs: NaN, isoString: 'X' });
    expect(c.isActive()).toBe(false);
  });

  it('clock skew (= 2 回目の start で nowMs が前回より小さい) は新 start を素直に受ける', () => {
    const c = createRideClock();
    c.start({ nowMs: 5000, isoString: 'A' });
    c.start({ nowMs: 1000, isoString: 'B' });  // backwards
    expect(c.snapshot().rideStartedAt).toBe(1000);
    expect(c.getRideStartedIso()).toBe('B');
  });
});
