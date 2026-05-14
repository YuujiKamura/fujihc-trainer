// brief 33 atom D: Strava uploads API client.
// docs: https://developers.strava.com/docs/uploads/
//
// 設計:
// - POST /api/v3/uploads multipart with file (= GPX Blob), data_type=gpx, name, activity_type
// - upload_id を取得 → GET /uploads/{id} を poll (interval / timeout は module top const)
// - 全 fetch / Blob / FormData は caller 側で inject 可能、 node test で mock 化

export const STRAVA_UPLOADS_URL = 'https://www.strava.com/api/v3/uploads';
export const STRAVA_UPLOAD_POLL_INTERVAL_MS = 2000;
export const STRAVA_UPLOAD_POLL_TIMEOUT_MS = 60_000;

/**
 * GPX 文字列 + access_token で upload を発火、 upload_id 含む response を返す.
 * @param {{accessToken: string, gpxXml: string, name?: string, activityType?: string,
 *          externalId?: string, description?: string}} p
 * @param {{fetch?: Function, FormData?: typeof FormData, Blob?: typeof Blob}} [overrides]
 * @returns {Promise<{id: number, external_id?: string, status?: string, error?: string}>}
 */
export async function postUpload(
  { accessToken, gpxXml, name, activityType, externalId, description },
  overrides = {},
) {
  const fetch_ = overrides.fetch || globalThis.fetch;
  const FormData_ = overrides.FormData || globalThis.FormData;
  const Blob_ = overrides.Blob || globalThis.Blob;
  if (!accessToken) throw new TypeError('postUpload: accessToken required');
  if (typeof gpxXml !== 'string' || gpxXml.length === 0) throw new TypeError('postUpload: gpxXml required');

  const form = new FormData_();
  const blob = new Blob_([gpxXml], { type: 'application/gpx+xml' });
  form.append('file', blob, (externalId || 'ride') + '.gpx');
  form.append('data_type', 'gpx');
  if (name) form.append('name', name);
  if (description) form.append('description', description);
  // activity_type は legacy field、 新 endpoint では `sport_type` (= VirtualRide) を推奨だが
  // 互換のため両方送る。 Strava は知らない field を ignore する。
  form.append('activity_type', activityType || 'VirtualRide');
  form.append('sport_type', activityType || 'VirtualRide');
  if (externalId) form.append('external_id', externalId);

  const resp = await fetch_(STRAVA_UPLOADS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!resp.ok) {
    let txt = '';
    try { txt = await resp.text(); } catch { /* ignore */ }
    throw new Error(`postUpload: HTTP ${resp.status} ${txt}`);
  }
  return resp.json();
}

/**
 * upload status を poll. ready (= activity_id 返る) または error (= error field 非空) まで.
 * @param {{accessToken: string, uploadId: number|string}} p
 * @param {{fetch?: Function, intervalMs?: number, timeoutMs?: number, signal?: AbortSignal,
 *          sleep?: (ms:number) => Promise<void>}} [overrides]
 * @returns {Promise<{status: 'ready'|'error', activity_id?: number, error?: string, raw: object}>}
 */
export async function pollUploadStatus({ accessToken, uploadId }, overrides = {}) {
  const fetch_ = overrides.fetch || globalThis.fetch;
  const intervalMs = overrides.intervalMs ?? STRAVA_UPLOAD_POLL_INTERVAL_MS;
  const timeoutMs = overrides.timeoutMs ?? STRAVA_UPLOAD_POLL_TIMEOUT_MS;
  const sleep = overrides.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!accessToken) throw new TypeError('pollUploadStatus: accessToken required');
  if (uploadId === undefined || uploadId === null) throw new TypeError('pollUploadStatus: uploadId required');

  const url = `${STRAVA_UPLOADS_URL}/${encodeURIComponent(String(uploadId))}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (overrides.signal && overrides.signal.aborted) {
      throw new Error('pollUploadStatus: aborted');
    }
    const resp = await fetch_(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      let txt = '';
      try { txt = await resp.text(); } catch { /* ignore */ }
      throw new Error(`pollUploadStatus: HTTP ${resp.status} ${txt}`);
    }
    const body = await resp.json();
    if (body && body.error) {
      return { status: 'error', error: body.error, raw: body };
    }
    if (body && body.activity_id) {
      return { status: 'ready', activity_id: body.activity_id, raw: body };
    }
    // まだ processing
    await sleep(intervalMs);
  }
  throw new Error('pollUploadStatus: timeout');
}
