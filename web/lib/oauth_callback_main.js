// brief 33 atom G: OAuth callback page entry (= inline script を externalize、 CSP `script-src 'self'` 維持).
// authorize URL から redirect されてきた ?code=... を受け取り、 token と交換し localStorage に保存。
// opener (window.open 経由なら) に postMessage で完了通知、 同タブ redirect なら root へ戻す。

import {
  exchangeCodeForToken,
  STRAVA_TOKEN_LS_KEY,
  STRAVA_PKCE_VERIFIER_SS_KEY,
  STRAVA_PKCE_CLIENT_ID_SS_KEY,
} from './strava_oauth.js';

function setStatus(text, cls) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = cls || '';
}

async function main() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const errorParam = params.get('error');
  if (errorParam) {
    setStatus(`認可が拒否されました: ${errorParam}`, 'err');
    return;
  }
  if (!code) {
    setStatus('?code= パラメータがありません', 'err');
    return;
  }
  const verifier = sessionStorage.getItem(STRAVA_PKCE_VERIFIER_SS_KEY);
  const clientId = sessionStorage.getItem(STRAVA_PKCE_CLIENT_ID_SS_KEY);
  if (!verifier || !clientId) {
    setStatus('PKCE verifier / client_id が sessionStorage にありません (= 認可リクエスト元 tab と違う?)', 'err');
    return;
  }
  try {
    const token = await exchangeCodeForToken({ clientId, code, codeVerifier: verifier });
    if (!token || !token.access_token) {
      setStatus('access_token が取得できませんでした', 'err');
      return;
    }
    localStorage.setItem(STRAVA_TOKEN_LS_KEY, JSON.stringify(token));
    sessionStorage.removeItem(STRAVA_PKCE_VERIFIER_SS_KEY);
    sessionStorage.removeItem(STRAVA_PKCE_CLIENT_ID_SS_KEY);
    setStatus('連携完了。 元の画面に戻ります...', 'ok');
    if (window.opener) {
      try { window.opener.postMessage({ type: 'strava-oauth-done' }, location.origin); } catch { /* ignore */ }
      window.close();
    } else {
      setTimeout(() => location.replace('./'), 600);
    }
  } catch (err) {
    setStatus(`token 交換失敗: ${err && err.message ? err.message : String(err)}`, 'err');
  }
}

main();
