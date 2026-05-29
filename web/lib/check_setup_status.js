// brief 31 commit γ: checkSetupStatus を viewer-map3d.js から lib 抽出。
// 旧 grep gate (= 出現回数 == N の literal counting) が「実装の bug 形状を pin する」
// anti-pattern だったため、 behavioral test (= fetch stub の 5 経路) で仕様 literal を
// 確認できる形に切り出す。
//
// 戻り値: { overall, sources, bridgeReachable }
//   - overall: 'ready' | 'partial' | 'empty'  (= bridge 起動時 200 で server が返す DB 充足度)
//   - sources: bridge 側の source-by-source status
//   - bridgeReachable: bool  (= bridge mode か static mode かの単一判定軸)
//
// 仕様 (= 「どの応答で bridgeReachable が true / false になるか」の decision table):
//   - 200 OK: bridge 起動済 + body を展開 → bridgeReachable: true
//   - 503: bridge 起動済だが DB 未充足 → bridgeReachable: true
//   - 404 / non-ok: 静的サーバで /tiles/_setup_status 不在 → bridgeReachable: false
//   - fetch timeout (AbortSignal.timeout(500) で reject) → bridgeReachable: false
//   - network error (connection refused 等) → bridgeReachable: false
//
// 引数:
//   - httpBaseUrl: bridge への HTTP base (= viewer から `location.origin` を渡す前提)
//   - fetchImpl: 注入可能な fetch (= test で stub 化、 default は globalThis.fetch)
//   - signalFactory: 注入可能な AbortSignal factory (= test で timeout simulate、
//     default は `() => AbortSignal.timeout(500)`)
export async function checkSetupStatus(httpBaseUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const signalFactory = options.signalFactory || (() => AbortSignal.timeout(500));
  try {
    const resp = await fetchImpl(
      `${httpBaseUrl}/tiles/_setup_status`,
      { signal: signalFactory() },
    );
    if (resp.status === 503) {
      return { overall: 'empty', sources: {}, bridgeReachable: true };
    }
    if (!resp.ok) {
      return { overall: 'empty', sources: {}, bridgeReachable: false };
    }
    const body = await resp.json();
    return { ...body, bridgeReachable: true };
  } catch (err) {
    return { overall: 'empty', sources: {}, bridgeReachable: false };
  }
}
