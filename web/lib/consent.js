// brief 34 atom ε: 公開ガードレール用 consent 管理 module.
//
// b46: intro consent (= getIntroConsent / setIntroConsent / clearIntroConsent /
//   INTRO_CONSENT_HASH / INTRO_CONSENT_LS_KEY) を撤去。 起動シーンを地形データローダー
//   画面の一本道に作り変えたため (= 走る/観る/閉じる の 3 択を廃止)、 「説明を見た」 を
//   localStorage に版管理する仕組み自体が不要になった。 観るモードの判定は
//   body.classList.contains('mode-view') へ移行済 (= viewer-maplibre.js §3)。
//   旧ユーザの localStorage に残る 'fujihill.consent.intro.v1' は
//   clear_local_data.js の purge list が掃除し続ける (= 新コードは read しない)。
//
// 設計:
// - RIDE_CONSENT_HASH は build 時 hardcode された文言 hash (= 正本).
//   localStorage に保存される値は {hash, accepted_at}、 比較は CONST === stored.hash で判定。
//   hash 不一致なら「文言が変わった」「localStorage が改竄された」のどちらかで再 consent 必須。
// - ride consent: 個別 feature opt-in (= history / strava)、 default 全 OFF。
// - hash 関数 (= sha256) は build 時の utility で計算済の値を const として埋め込み、 runtime では
//   crypto.subtle 等の async API を使わない (= 同期 get/set のみ、 jsdom 互換性確保).
// - 全 storage 経由は injectable (= node test で memory mock 可)。

// 文言改訂時はこの const を再計算する (= 改訂ごとに sha256 を取って差し替え).
export const RIDE_CONSENT_HASH = 'v1-fujihill-ride-2026-05-15';

// localStorage keys (= 改名する場合は migration 必須、 単純 set/get で済む).
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
