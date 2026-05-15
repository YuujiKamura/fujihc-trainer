// brief 33 atom F: postride-overlay の 4 button bind を 1 関数に閉じ込める (= NG-R1-7 同型予防).
// viewer-maplibre.js から呼ばれ、 ride 終了時に download / upload / 保存 / 一覧の 4 action を提供。
// pure に近い形 (= 依存は callback 経由で inject) で test 化可能。

import { buildGpxXml } from './gpx_builder.js';
import {
  ensureAccessToken, buildAuthorizeUrl, makeCodeVerifier, makeCodeChallenge,
  STRAVA_PKCE_VERIFIER_SS_KEY, STRAVA_PKCE_CLIENT_ID_SS_KEY, STRAVA_TOKEN_LS_KEY,
} from './strava_oauth.js';
import {
  postUpload, pollUploadStatus,
  withTrademarkSuffix, withTrademarkPrefix,
} from './strava_upload.js';

/**
 * 4 button の click handler を element に bind する.
 *
 * @param {{
 *   document?: Document,
 *   getTrkpts: () => Array,
 *   getSummary: () => object,
 *   getCourseName?: () => string,
 *   addRide: (rec: object) => Promise<void>,
 *   getClientId: () => string|null,
 *   getRedirectUri: () => string,
 *   onViewHistory: () => void,
 *   onStatus?: (text: string) => void,
 *   window?: Window,
 *   crypto?: Crypto,
 * }} cfg
 * @returns {() => void} unbind 関数 (= test 用、 通常呼ばない)
 */
export function bindPostRideButtons(cfg) {
  const doc = cfg.document || globalThis.document;
  const win = cfg.window || globalThis.window;
  const crypto_ = cfg.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  const setStatus = (text) => { if (cfg.onStatus) cfg.onStatus(text); };

  const btnGpx = doc.getElementById('btnGpxDownload');
  const btnUpload = doc.getElementById('btnStravaUpload');
  const btnSave = doc.getElementById('btnSaveHistory');
  const btnViewH = doc.getElementById('btnViewHistory');

  const handlers = [];

  function addClick(btn, fn) {
    if (!btn) return;
    const wrapped = (ev) => {
      ev.preventDefault?.();
      Promise.resolve(fn()).catch((err) => setStatus(`error: ${err && err.message ? err.message : String(err)}`));
    };
    btn.addEventListener('click', wrapped);
    handlers.push(() => btn.removeEventListener('click', wrapped));
  }

  // GPX download
  addClick(btnGpx, () => {
    const trkpts = cfg.getTrkpts();
    const summary = cfg.getSummary() || {};
    const courseName = (cfg.getCourseName && cfg.getCourseName()) || 'fujihc ride';
    const xml = buildGpxXml(trkpts, { name: courseName, activity_type: 'Virtual Ride' });
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const date = (summary.date || new Date().toISOString()).replace(/[:.]/g, '-');
    const a = doc.createElement('a');
    a.href = url;
    a.download = `ride-${date}.gpx`;
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`GPX を保存しました (${trkpts.length} 点)`);
  });

  // Strava upload
  addClick(btnUpload, async () => {
    const clientId = cfg.getClientId();
    if (!clientId) {
      setStatus('Strava client_id が未設定です (= 設定画面で連携してください)');
      return;
    }
    let token = await ensureAccessToken(clientId);
    if (!token) {
      // 認可フロー開始
      const verifier = makeCodeVerifier(crypto_);
      const challenge = await makeCodeChallenge(verifier, crypto_);
      win.sessionStorage.setItem(STRAVA_PKCE_VERIFIER_SS_KEY, verifier);
      win.sessionStorage.setItem(STRAVA_PKCE_CLIENT_ID_SS_KEY, String(clientId));
      const url = buildAuthorizeUrl({
        clientId,
        redirectUri: cfg.getRedirectUri(),
        codeChallenge: challenge,
      });
      setStatus('Strava 認可ページを開きます...');
      win.location.assign(url);
      return;
    }
    // upload 実行
    const trkpts = cfg.getTrkpts();
    const summary = cfg.getSummary() || {};
    const courseName = (cfg.getCourseName && cfg.getCourseName()) || 'fujihc ride';
    const xml = buildGpxXml(trkpts, { name: courseName, activity_type: 'Virtual Ride' });
    setStatus(`Strava へ送信中... (${trkpts.length} 点)`);
    // brief 34 ε-4: 商標混同対策の 2 重 gate 外側. caller (= ここ) でも先行 append/prepend、
    // strava_upload.js 側でも再 append/prepend (= idempotent helper)、 どちらかが消えても文言が残る。
    const decoratedName = withTrademarkSuffix(courseName);
    const decoratedDescription = withTrademarkPrefix('');
    const res = await postUpload({
      accessToken: token, gpxXml: xml,
      name: decoratedName,
      description: decoratedDescription,
      activityType: 'VirtualRide',
      externalId: summary.id || `ride-${Date.now()}`,
    });
    if (!res || !res.id) { setStatus('Strava: upload_id 取得失敗'); return; }
    setStatus(`Strava 受付完了 (upload_id=${res.id}). 処理待ち...`);
    const status = await pollUploadStatus({ accessToken: token, uploadId: res.id });
    if (status.status === 'ready') {
      setStatus(`Strava 取り込み完了 (activity_id=${status.activity_id})`);
    } else {
      setStatus(`Strava: ${status.error || 'error'}`);
    }
  });

  // 履歴に保存
  addClick(btnSave, async () => {
    const trkpts = cfg.getTrkpts();
    const summary = cfg.getSummary() || {};
    const date = summary.date || new Date().toISOString();
    const id = summary.id || `${date}-${Math.random().toString(36).slice(2, 5)}`;
    await cfg.addRide({
      id, date,
      summary: {
        distance_m: Number(summary.distance_m || 0),
        duration_s: Number(summary.duration_s || 0),
        elevation_gain_m: Number(summary.elevation_gain_m || 0),
        avg_power_w: summary.avg_power_w == null ? null : Number(summary.avg_power_w),
        course_name: String(summary.course_name || 'fujihc'),
      },
      trkpts,
    });
    setStatus(`履歴に保存しました (${trkpts.length} 点)`);
  });

  // 履歴を見る
  addClick(btnViewH, () => { cfg.onViewHistory(); });

  return () => { for (const off of handlers) off(); };
}

export { STRAVA_TOKEN_LS_KEY };
