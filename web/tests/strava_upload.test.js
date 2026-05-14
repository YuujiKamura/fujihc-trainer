// brief 33 atom D: strava_upload.js unit test (= 全 fetch mock).
import { describe, it, expect, vi } from 'vitest';
import {
  STRAVA_UPLOADS_URL, STRAVA_UPLOAD_POLL_INTERVAL_MS, STRAVA_UPLOAD_POLL_TIMEOUT_MS,
  postUpload, pollUploadStatus,
} from '../lib/strava_upload.js';

describe('postUpload', () => {
  it('happy → upload_id 含む response、 FormData に file/data_type/name/activity_type 入る', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.url = url;
      captured.method = init.method;
      captured.auth = init.headers.Authorization;
      // FormData fields を spy 用に Map 化
      captured.fields = {};
      for (const [k, v] of init.body.entries()) captured.fields[k] = v;
      return { ok: true, status: 201, async json() { return { id: 999, status: 'processing' }; } };
    });
    const tok = 'a1';
    const xml = '<?xml version="1.0"?><gpx></gpx>';
    const res = await postUpload({
      accessToken: tok, gpxXml: xml, name: 'fujihc ride', activityType: 'VirtualRide',
      externalId: 'ride-001',
    }, { fetch: fakeFetch });
    expect(res.id).toBe(999);
    expect(captured.url).toBe(STRAVA_UPLOADS_URL);
    expect(captured.method).toBe('POST');
    expect(captured.auth).toBe('Bearer a1');
    expect(captured.fields.data_type).toBe('gpx');
    expect(captured.fields.activity_type).toBe('VirtualRide');
    expect(captured.fields.sport_type).toBe('VirtualRide');
    expect(captured.fields.name).toBe('fujihc ride');
    expect(captured.fields.external_id).toBe('ride-001');
    // file は Blob/File. type 確認のみ.
    expect(captured.fields.file).toBeDefined();
  });

  it('accessToken 欠落で throw', async () => {
    await expect(postUpload({ accessToken: '', gpxXml: 'x' }, { fetch: vi.fn() }))
      .rejects.toThrow();
  });

  it('non-2xx で throw', async () => {
    const fakeFetch = async () => ({ ok: false, status: 401, async text() { return 'no'; } });
    await expect(postUpload({ accessToken: 'a', gpxXml: 'x' }, { fetch: fakeFetch }))
      .rejects.toThrow(/HTTP 401/);
  });
});

describe('pollUploadStatus', () => {
  it('happy: activity_id 返る (= ready)', async () => {
    let calls = 0;
    const fakeFetch = async () => {
      calls += 1;
      if (calls < 2) return { ok: true, async json() { return { id: 1, status: 'Your activity is still being processed.', error: '' }; } };
      return { ok: true, async json() { return { id: 1, activity_id: 12345 }; } };
    };
    const res = await pollUploadStatus(
      { accessToken: 'a', uploadId: 1 },
      { fetch: fakeFetch, intervalMs: 1, timeoutMs: 5000, sleep: async () => {} },
    );
    expect(res.status).toBe('ready');
    expect(res.activity_id).toBe(12345);
  });

  it('error: status.error 非空で reject せず {status: error, error: ...} 返す', async () => {
    const fakeFetch = async () => ({ ok: true, async json() { return { id: 1, error: 'There was an error.' }; } });
    const res = await pollUploadStatus(
      { accessToken: 'a', uploadId: 1 },
      { fetch: fakeFetch, intervalMs: 1, timeoutMs: 5000, sleep: async () => {} },
    );
    expect(res.status).toBe('error');
    expect(res.error).toBe('There was an error.');
  });

  it('timeout: deadline 超で throw', async () => {
    const fakeFetch = async () => ({ ok: true, async json() { return { id: 1, status: 'processing' }; } });
    await expect(pollUploadStatus(
      { accessToken: 'a', uploadId: 1 },
      { fetch: fakeFetch, intervalMs: 5, timeoutMs: 20, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    )).rejects.toThrow(/timeout/);
  });

  it('Authorization header に Bearer <token>', async () => {
    let auth = '';
    const fakeFetch = async (url, init) => { auth = init.headers.Authorization; return { ok: true, async json() { return { id: 1, activity_id: 7 }; } }; };
    await pollUploadStatus(
      { accessToken: 'TOK', uploadId: 1 },
      { fetch: fakeFetch, intervalMs: 1, timeoutMs: 1000, sleep: async () => {} },
    );
    expect(auth).toBe('Bearer TOK');
  });

  it('non-2xx で throw', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500, async text() { return 'fail'; } });
    await expect(pollUploadStatus(
      { accessToken: 'a', uploadId: 1 },
      { fetch: fakeFetch, intervalMs: 1, timeoutMs: 1000, sleep: async () => {} },
    )).rejects.toThrow(/HTTP 500/);
  });
});

describe('consts', () => {
  it('STRAVA_UPLOADS_URL / interval / timeout が固定', () => {
    expect(STRAVA_UPLOADS_URL).toBe('https://www.strava.com/api/v3/uploads');
    expect(STRAVA_UPLOAD_POLL_INTERVAL_MS).toBe(2000);
    expect(STRAVA_UPLOAD_POLL_TIMEOUT_MS).toBe(60_000);
  });
});
