// brief 31 commit γ: checkSetupStatus の behavioral test。
//
// 旧 grep gate (= viewer 内の `bridgeReachable: true` 出現回数を == N で pin する) が
// 「実装の bug 形状を test がコピペで保護する」 anti-pattern として reviewer A/B 共通で指摘された。
// ここでは出現回数を数えず、 fetch を stub して仕様 (= 5 経路の decision table) 通りに
// 戻り値が決まることを直接検証する。
//
// 仕様 decision table (= lib/check_setup_status.js の冒頭コメントと同期):
//   200 OK + JSON   → bridgeReachable: true  (= body 展開)
//   503             → bridgeReachable: true  (= bridge 起動済 DB 未充足)
//   404 / non-ok    → bridgeReachable: false (= 静的サーバで endpoint 不在)
//   timeout         → bridgeReachable: false
//   network error   → bridgeReachable: false
import { describe, it, expect, vi } from 'vitest';
import { checkSetupStatus } from '../lib/check_setup_status.js';

describe('checkSetupStatus: 5 経路 decision table', () => {
  const baseUrl = 'http://example.test';
  const dummySignal = () => ({});

  it('200 OK + body を展開して bridgeReachable: true を返す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ overall: 'ready', sources: { gsi_dem: 'ready' } }),
    });
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result).toEqual({
      overall: 'ready',
      sources: { gsi_dem: 'ready' },
      bridgeReachable: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${baseUrl}/tiles/_setup_status`,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('503 で bridgeReachable: true、 overall: empty (= DB 未充足 だが bridge は到達)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      json: async () => { throw new Error('json should not be called'); },
    });
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result).toEqual({
      overall: 'empty',
      sources: {},
      bridgeReachable: true,
    });
  });

  it('404 で bridgeReachable: false (= 静的サーバで endpoint 不在、 旧 bug の修正点)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => { throw new Error('json should not be called'); },
    });
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result).toEqual({
      overall: 'empty',
      sources: {},
      bridgeReachable: false,
    });
  });

  it('500 (= その他 non-ok) も bridgeReachable: false で扱う', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      json: async () => ({}),
    });
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result.bridgeReachable).toBe(false);
  });

  it('timeout / AbortError で bridgeReachable: false', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result).toEqual({
      overall: 'empty',
      sources: {},
      bridgeReachable: false,
    });
  });

  it('network error (= TypeError: Failed to fetch) で bridgeReachable: false', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await checkSetupStatus(baseUrl, { fetchImpl, signalFactory: dummySignal });
    expect(result.bridgeReachable).toBe(false);
  });

  it('default signalFactory は AbortSignal.timeout(500) を返す', async () => {
    // signalFactory を渡さずに default が呼ばれる事を確認 (= 500ms timeout 内蔵)
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ overall: 'ready', sources: {} }),
    });
    await checkSetupStatus(baseUrl, { fetchImpl });
    const passedOptions = fetchImpl.mock.calls[0][1];
    // signal は AbortSignal instance のはず
    expect(passedOptions.signal).toBeInstanceOf(AbortSignal);
  });
});
