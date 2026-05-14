// brief 33 atom C: strava_oauth.js unit test (= PKCE flow + token 管理).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import {
  STRAVA_AUTHORIZE_URL, STRAVA_TOKEN_URL, STRAVA_SCOPE, STRAVA_TOKEN_LS_KEY,
  makeCodeVerifier, makeCodeChallenge, buildAuthorizeUrl,
  exchangeCodeForToken, refreshAccessToken, ensureAccessToken, revokeLocalToken,
} from '../lib/strava_oauth.js';

// node では globalThis.crypto.subtle が node 19+ で利用可能. node 18 でも `node:crypto`.webcrypto 経由.
const webCrypto = crypto.webcrypto;

// シンプル in-memory storage mock
function memStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
  };
}

describe('makeCodeVerifier', () => {
  it('43 文字 base64url charset (RFC 7636 §4.1: 32 bytes → 43 文字)', () => {
    const v = makeCodeVerifier(webCrypto);
    expect(v.length).toBe(43);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('呼ぶ度に違う値 (= getRandomValues 経由を verify)', () => {
    const a = makeCodeVerifier(webCrypto);
    const b = makeCodeVerifier(webCrypto);
    expect(a).not.toBe(b);
  });
});

describe('makeCodeChallenge', () => {
  it('RFC 7636 Appendix B fixture (= 既知 verifier → 既知 challenge)', async () => {
    // Appendix B: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    //             → challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await makeCodeChallenge(verifier, webCrypto);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('buildAuthorizeUrl', () => {
  it('全 query param を含む (= client_id / redirect_uri / scope / code_challenge / response_type / S256)', () => {
    const url = buildAuthorizeUrl({
      clientId: '12345',
      redirectUri: 'https://example.github.io/fujihc-trainer/oauth-callback.html',
      codeChallenge: 'XYZ',
    });
    expect(url.startsWith(STRAVA_AUTHORIZE_URL + '?')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('12345');
    expect(u.searchParams.get('redirect_uri')).toBe('https://example.github.io/fujihc-trainer/oauth-callback.html');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe(STRAVA_SCOPE);
    expect(u.searchParams.get('code_challenge')).toBe('XYZ');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });
  it('clientId 欠落で throw', () => {
    expect(() => buildAuthorizeUrl({ redirectUri: 'x', codeChallenge: 'y' })).toThrow();
  });
});

describe('exchangeCodeForToken', () => {
  it('happy: 200 で JSON 返す、 form body に grant_type=authorization_code', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.url = url;
      captured.body = init.body.toString();
      return {
        ok: true,
        status: 200,
        async json() { return { access_token: 'a1', refresh_token: 'r1', expires_at: 9999999999 }; },
      };
    });
    const tok = await exchangeCodeForToken({ clientId: '1', code: 'c', codeVerifier: 'v' }, fakeFetch);
    expect(tok.access_token).toBe('a1');
    expect(captured.url).toBe(STRAVA_TOKEN_URL);
    expect(captured.body).toContain('grant_type=authorization_code');
    expect(captured.body).toContain('code=c');
    expect(captured.body).toContain('code_verifier=v');
  });
  it('non-2xx で throw', async () => {
    const fakeFetch = async () => ({ ok: false, status: 400, async text() { return 'bad'; } });
    await expect(exchangeCodeForToken({ clientId: '1', code: 'c', codeVerifier: 'v' }, fakeFetch))
      .rejects.toThrow(/HTTP 400/);
  });
});

describe('refreshAccessToken', () => {
  it('happy: grant_type=refresh_token を送る', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.body = init.body.toString();
      return {
        ok: true,
        async json() { return { access_token: 'a2', refresh_token: 'r2', expires_at: 9999999999 }; },
      };
    });
    const tok = await refreshAccessToken({ clientId: '1', refreshToken: 'rOld' }, fakeFetch);
    expect(tok.access_token).toBe('a2');
    expect(captured.body).toContain('grant_type=refresh_token');
    expect(captured.body).toContain('refresh_token=rOld');
  });
  it('refresh_token 無効時 reject', async () => {
    const fakeFetch = async () => ({ ok: false, status: 400, async text() { return 'invalid'; } });
    await expect(refreshAccessToken({ clientId: '1', refreshToken: 'rBad' }, fakeFetch))
      .rejects.toThrow();
  });
});

describe('ensureAccessToken', () => {
  it('token 不在 → null', async () => {
    const ls = memStorage();
    const got = await ensureAccessToken('1', { localStorage: ls });
    expect(got).toBeNull();
  });
  it('valid (= 6 時間有効) → そのまま access_token を返す', async () => {
    const ls = memStorage();
    const farFuture = Math.floor(Date.now() / 1000) + 6 * 3600;
    ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_at: farFuture }));
    const got = await ensureAccessToken('1', { localStorage: ls });
    expect(got).toBe('a1');
  });
  it('expired (= margin 内) → refresh 経由で新 access_token', async () => {
    const ls = memStorage();
    const now = Math.floor(Date.now() / 1000);
    ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify({ access_token: 'aOld', refresh_token: 'rOld', expires_at: now + 60 }));
    const fakeFetch = async () => ({
      ok: true,
      async json() { return { access_token: 'aNew', refresh_token: 'rNew', expires_at: now + 6 * 3600 }; },
    });
    const got = await ensureAccessToken('1', { localStorage: ls, fetch: fakeFetch });
    expect(got).toBe('aNew');
    // localStorage 側も更新
    const saved = JSON.parse(ls.getItem(STRAVA_TOKEN_LS_KEY));
    expect(saved.access_token).toBe('aNew');
    expect(saved.refresh_token).toBe('rNew');
  });
  it('refresh 失敗 → null', async () => {
    const ls = memStorage();
    const now = Math.floor(Date.now() / 1000);
    ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify({ access_token: 'aOld', refresh_token: 'rBad', expires_at: now + 60 }));
    const fakeFetch = async () => ({ ok: false, status: 400, async text() { return ''; } });
    const got = await ensureAccessToken('1', { localStorage: ls, fetch: fakeFetch });
    expect(got).toBeNull();
  });
});

describe('revokeLocalToken', () => {
  it('localStorage の token を削除する → ensureAccessToken が null を返す (= 連携解除導線)', async () => {
    const ls = memStorage();
    const farFuture = Math.floor(Date.now() / 1000) + 6 * 3600;
    ls.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_at: farFuture }));
    expect(await ensureAccessToken('1', { localStorage: ls })).toBe('a1');
    revokeLocalToken(ls);
    expect(await ensureAccessToken('1', { localStorage: ls })).toBeNull();
    expect(ls.getItem(STRAVA_TOKEN_LS_KEY)).toBeNull();
  });
});
