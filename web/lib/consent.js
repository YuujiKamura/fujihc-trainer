// brief 34 atom ε: 公開ガードレール用 consent 管理 module.
//
// 設計:
// - INTRO_CONSENT_HASH / RIDE_CONSENT_HASH は build 時 hardcode された文言 hash (= 正本).
//   localStorage に保存される値は {hash, accepted_at}、 比較は CONST === stored.hash で判定。
//   hash 不一致なら「文言が変わった」「localStorage が改竄された」のどちらかで再 consent 必須。
// - intro consent: ページ単位の「説明を見た」signal、 単一 boolean ではなく hash で版管理。
// - ride consent: 個別 feature opt-in (= history / strava)、 default 全 OFF。
// - hash 関数 (= sha256) は build 時の utility で計算済の値を const として埋め込み、 runtime では
//   crypto.subtle 等の async API を使わない (= 同期 get/set のみ、 jsdom 互換性確保).
// - 全 storage 経由は injectable (= node test で memory mock 可)。

// 文言改訂時はこの const を再計算する (= 改訂ごとに sha256 を取って差し替え).
// 計算: scripts/compute_consent_hashes.js (= 将来追加可、 本 brief では手動更新)
// 現行 (v1) 文言 hash. 文言は web/index.html の #intro-overlay 内に正本がある、
// 比較先はこの const、 改竄耐性は CSP `script-src 'self'` で保証する。
export const INTRO_CONSENT_HASH = 'v2-fujihill-intro-2026-05-20';
export const RIDE_CONSENT_HASH = 'v1-fujihill-ride-2026-05-15';

// localStorage keys (= 改名する場合は migration 必須、 単純 set/get で済む).
export const INTRO_CONSENT_LS_KEY = 'fujihill.consent.intro.v1';
export const RIDE_CONSENT_LS_KEY = 'fujihill.consent.ride.v1';

function getStorage(override) {
  if (override) return override;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function readJson(ls, key) {
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(ls, key, value) {
  if (!ls) return;
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled ── 失敗時は silent (= 次回再表示で済む). */
  }
}

/**
 * intro consent を読み出す. hash 一致時のみ truthy を返す.
 * @param {{storage?: Storage}} [opts]
 * @returns {{hash: string, accepted_at: string, mode?: 'ride'|'view'} | null}
 */
export function getIntroConsent(opts = {}) {
  const ls = getStorage(opts.storage);
  const v = readJson(ls, INTRO_CONSENT_LS_KEY);
  if (!v || typeof v !== 'object') return null;
  if (v.hash !== INTRO_CONSENT_HASH) return null;
  return v;
}

/**
 * intro consent を記録する.
 *
 * brief 34 ε-8: 「観る」モード追加に伴い optional `mode` を保存できる拡張。
 *   mode='ride' (= default、 「自分の trainer で走る」経路) と
 *   mode='view' (= 「コースを観る」経路) を区別。 mode 未指定時は 'ride' を保存する。
 *
 * @param {{storage?: Storage, now?: () => Date, mode?: 'ride'|'view'}} [opts]
 */
export function setIntroConsent(opts = {}) {
  const ls = getStorage(opts.storage);
  const now = (opts.now || (() => new Date()))();
  // mode 不正値は 'ride' に倒す (= 安全寄り、 default の trainer 必須経路へ).
  const mode = (opts.mode === 'view') ? 'view' : 'ride';
  writeJson(ls, INTRO_CONSENT_LS_KEY, {
    hash: INTRO_CONSENT_HASH,
    accepted_at: now.toISOString(),
    mode,
  });
}

/** intro consent を削除する (= 「全データ削除」UI から呼ぶ). */
export function clearIntroConsent(opts = {}) {
  const ls = getStorage(opts.storage);
  if (!ls) return;
  try { ls.removeItem(INTRO_CONSENT_LS_KEY); } catch { /* silent */ }
}

/**
 * ride consent を読み出す.
 * field は 'history' | 'strava' | 'asked' (= consent ダイアログを 1 度通過した signal).
 * 'asked' = true は「ユーザーが consent ダイアログを見た」を意味し、 全 field OFF も valid な選択.
 * @param {string} field
 * @param {{storage?: Storage}} [opts]
 * @returns {boolean}
 */
export function getRideConsent(field, opts = {}) {
  const ls = getStorage(opts.storage);
  const v = readJson(ls, RIDE_CONSENT_LS_KEY);
  if (!v || typeof v !== 'object') return false;
  if (v.hash !== RIDE_CONSENT_HASH) return false;
  return Boolean(v[field]);
}

/**
 * ride consent をまとめて記録する. 既存値は上書き.
 * @param {{history?: boolean, strava?: boolean, asked?: boolean}} flags
 * @param {{storage?: Storage, now?: () => Date}} [opts]
 */
export function setRideConsent(flags, opts = {}) {
  const ls = getStorage(opts.storage);
  const now = (opts.now || (() => new Date()))();
  writeJson(ls, RIDE_CONSENT_LS_KEY, {
    hash: RIDE_CONSENT_HASH,
    accepted_at: now.toISOString(),
    history: Boolean(flags && flags.history),
    strava: Boolean(flags && flags.strava),
    // 'asked' は明示渡し、 default false (= consent 画面通過 signal).
    asked: Boolean(flags && flags.asked),
  });
}

/** ride consent を削除する (= 「全データ削除」UI から呼ぶ). */
export function clearRideConsent(opts = {}) {
  const ls = getStorage(opts.storage);
  if (!ls) return;
  try { ls.removeItem(RIDE_CONSENT_LS_KEY); } catch { /* silent */ }
}
