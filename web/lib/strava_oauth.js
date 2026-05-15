// brief 33 atom C: Strava OAuth PKCE flow (= public client、 secret 不要).
// RFC 7636 PKCE + Strava docs https://developers.strava.com/docs/authentication/
//
// 設計:
// - load-bearing 文字列 (= endpoint URL / scope / localStorage key) は本 module top に集約
// - exchangeCodeForToken / refreshAccessToken は pure fetch wrapper、 localStorage 触らない
// - ensureAccessToken だけが localStorage を read / 5 分マージンで auto refresh
// - revokeLocalToken は localStorage 削除のみ (= Strava 側 app revoke は user 操作で別途)

export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_SCOPE = 'activity:write';
export const STRAVA_TOKEN_LS_KEY = 'fujihill.strava.token';
export const STRAVA_PKCE_VERIFIER_SS_KEY = 'fujihill.pkce.verifier';
export const STRAVA_PKCE_CLIENT_ID_SS_KEY = 'fujihill.pkce.client_id';
export const STRAVA_TOKEN_REFRESH_MARGIN_SEC = 300;  // 5 分前に refresh

/** base64url (= '+'→'-', '/'→'_', padding 削除) */
function bytesToBase64Url(bytes) {
  // bytes: Uint8Array
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * code_verifier 生成 (= 32 bytes random → base64url、 RFC 7636 §4.1).
 * 結果は 43 文字 (= 32 bytes → 44 文字 base64 - padding = 43).
 * @returns {string}
 */
export function makeCodeVerifier(cryptoOverride) {
  const crypto_ = cryptoOverride || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (!crypto_ || !crypto_.getRandomValues) {
    throw new Error('crypto.getRandomValues not available (HTTPS context required)');
  }
  const buf = new Uint8Array(32);
  crypto_.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

/**
 * code_challenge = SHA256(verifier) base64url (= RFC 7636 §4.2).
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function makeCodeChallenge(verifier, cryptoOverride) {
  const crypto_ = cryptoOverride || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  if (!crypto_ || !crypto_.subtle || !crypto_.subtle.digest) {
    throw new Error('crypto.subtle.digest not available (HTTPS context required)');
  }
  const enc = new TextEncoder();
  const data = enc.encode(verifier);
  const digest = await crypto_.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * authorize URL 構築. window.location 遷移用.
 * @param {{clientId: string, redirectUri: string, codeChallenge: string, scope?: string, state?: string}} p
 */
export function buildAuthorizeUrl({ clientId, redirectUri, codeChallenge, scope, state }) {
  if (!clientId) throw new Error('buildAuthorizeUrl: clientId required');
  if (!redirectUri) throw new Error('buildAuthorizeUrl: redirectUri required');
  if (!codeChallenge) throw new Error('buildAuthorizeUrl: codeChallenge required');
  const params = new URLSearchParams({
    client_id: String(clientId),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scope || STRAVA_SCOPE,
    approval_prompt: 'auto',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (state) params.set('state', state);
  return `${STRAVA_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * authorization_code → token 交換. localStorage 触らない pure 関数.
 * @returns {Promise<{access_token, refresh_token, expires_at, athlete?: object}>}
 */
export async function exchangeCodeForToken({ clientId, code, codeVerifier }, fetchOverride) {
  const fetch_ = fetchOverride || globalThis.fetch;
  if (!clientId || !code || !codeVerifier) {
    throw new TypeError('exchangeCodeForToken: clientId/code/codeVerifier required');
  }
  const body = new URLSearchParams({
    client_id: String(clientId),
    code: String(code),
    code_verifier: String(codeVerifier),
    grant_type: 'authorization_code',
  });
  const resp = await fetch_(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    let txt = '';
    try { txt = await resp.text(); } catch { /* ignore */ }
    throw new Error(`exchangeCodeForToken: HTTP ${resp.status} ${txt}`);
  }
  return resp.json();
}

/**
 * refresh_token → access_token 更新.
 * @returns {Promise<{access_token, refresh_token, expires_at}>}
 */
export async function refreshAccessToken({ clientId, refreshToken }, fetchOverride) {
  const fetch_ = fetchOverride || globalThis.fetch;
  if (!clientId || !refreshToken) {
    throw new TypeError('refreshAccessToken: clientId/refreshToken required');
  }
  const body = new URLSearchParams({
    client_id: String(clientId),
    refresh_token: String(refreshToken),
    grant_type: 'refresh_token',
  });
  const resp = await fetch_(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    let txt = '';
    try { txt = await resp.text(); } catch { /* ignore */ }
    throw new Error(`refreshAccessToken: HTTP ${resp.status} ${txt}`);
  }
  return resp.json();
}

function readToken(storageOverride) {
  const ls = storageOverride || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return null;
  const raw = ls.getItem(STRAVA_TOKEN_LS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function writeToken(token, storageOverride) {
  const ls = storageOverride || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return;
  ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify(token));
}

/**
 * 現在 token を読み、 expired なら refresh、 valid な access_token を返す.
 * return null = 未連携 (= UI 側で再認可導線を出す).
 * @param {string} clientId
 * @param {{fetch?: Function, localStorage?: Storage, now?: () => number}} [opts]
 * @returns {Promise<string|null>}
 */
export async function ensureAccessToken(clientId, opts = {}) {
  const ls = opts.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const tok = readToken(ls);
  if (!tok || !tok.access_token) return null;
  const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);
  const expiresAt = Number(tok.expires_at || 0);
  if (expiresAt - now > STRAVA_TOKEN_REFRESH_MARGIN_SEC) {
    return tok.access_token;
  }
  // refresh 必要
  if (!tok.refresh_token) return null;
  try {
    const fresh = await refreshAccessToken({ clientId, refreshToken: tok.refresh_token }, opts.fetch);
    const merged = {
      ...tok,
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token || tok.refresh_token,
      expires_at: fresh.expires_at,
    };
    writeToken(merged, ls);
    return merged.access_token;
  } catch {
    // refresh 失敗 = revoke 済 / network 不通、 再認可を促す
    return null;
  }
}

/**
 * localStorage の token を削除する (= 連携解除 UI 押下時の唯一の副作用).
 * Strava 側 app 登録は残るため、 UI 側で revoke ページへの導線を出すこと.
 */
export function revokeLocalToken(storageOverride) {
  const ls = storageOverride || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!ls) return;
  ls.removeItem(STRAVA_TOKEN_LS_KEY);
}
