// b125d: viewer_session.js の純粋関数 unit. DOM 参照ゼロ.
import { describe, it, expect } from 'vitest';
import { createViewerSession, VIEWER_SESSION_VALID_SCAN_MODES } from '../lib/viewer_session.js';

describe('createViewerSession: env / scanMode / advancedFromDbinit を closure に閉じる', () => {
  it('初期 state: env=null, scanMode=ftms, advancedFromDbinit=false', () => {
    const s = createViewerSession();
    expect(s.getEnv()).toBeNull();
    expect(s.getScanMode()).toBe('ftms');
    expect(s.isAdvancedFromDbinit()).toBe(false);
  });

  it('setEnv で env が確定、 freeze 済 instance を返す', () => {
    const s = createViewerSession();
    const env = s.setEnv({ mode: 'bridge', courseUrl: 'x' });
    expect(env).toBeTruthy();
    expect(env.mode).toBe('bridge');
    expect(Object.isFrozen(env)).toBe(true);
    expect(s.getEnv()).toBe(env);
  });

  it('setEnv は idempotent (= 2 度目は最初の instance を返す、 上書きしない)', () => {
    const s = createViewerSession();
    const first = s.setEnv({ mode: 'bridge' });
    const second = s.setEnv({ mode: 'static' });  // 上書き試行
    expect(second).toBe(first);
    expect(s.getEnv().mode).toBe('bridge');
  });

  it('setEnv(null) は env を null 維持 + no-op', () => {
    const s = createViewerSession();
    expect(s.setEnv(null)).toBeNull();
    expect(s.getEnv()).toBeNull();
  });

  it('setScanMode で valid mode (ftms / hrm) は更新', () => {
    const s = createViewerSession();
    s.setScanMode('hrm');
    expect(s.getScanMode()).toBe('hrm');
    s.setScanMode('ftms');
    expect(s.getScanMode()).toBe('ftms');
  });

  it('setScanMode で invalid mode は ignore + 既存値維持', () => {
    const s = createViewerSession();
    s.setScanMode('hrm');
    s.setScanMode('invalid');
    expect(s.getScanMode()).toBe('hrm');
    s.setScanMode(null);
    expect(s.getScanMode()).toBe('hrm');
    s.setScanMode(undefined);
    expect(s.getScanMode()).toBe('hrm');
  });

  it('VIEWER_SESSION_VALID_SCAN_MODES は [ftms, hrm] のみ', () => {
    expect(VIEWER_SESSION_VALID_SCAN_MODES).toEqual(['ftms', 'hrm']);
  });

  it('markAdvancedFromDbinit / reset で flag が立ち / 戻る', () => {
    const s = createViewerSession();
    expect(s.isAdvancedFromDbinit()).toBe(false);
    s.markAdvancedFromDbinit();
    expect(s.isAdvancedFromDbinit()).toBe(true);
    s.resetAdvancedFromDbinit();
    expect(s.isAdvancedFromDbinit()).toBe(false);
  });

  it('markAdvancedFromDbinit 連続呼出しは true 維持 (= idempotent)', () => {
    const s = createViewerSession();
    s.markAdvancedFromDbinit();
    s.markAdvancedFromDbinit();
    s.markAdvancedFromDbinit();
    expect(s.isAdvancedFromDbinit()).toBe(true);
  });

  it('snapshot は 3 field 全部を返す', () => {
    const s = createViewerSession();
    s.setEnv({ mode: 'bridge' });
    s.setScanMode('hrm');
    s.markAdvancedFromDbinit();
    const snap = s.snapshot();
    expect(snap.env.mode).toBe('bridge');
    expect(snap.scanMode).toBe('hrm');
    expect(snap.advancedFromDbinit).toBe(true);
  });
});
