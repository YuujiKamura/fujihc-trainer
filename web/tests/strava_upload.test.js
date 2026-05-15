// brief 33 atom D + brief 34 ε-4: strava_upload.js unit test (= 全 fetch mock).
import { describe, it, expect, vi } from 'vitest';
import {
  STRAVA_UPLOADS_URL, STRAVA_UPLOAD_POLL_INTERVAL_MS, STRAVA_UPLOAD_POLL_TIMEOUT_MS,
  STRAVA_NAME_SUFFIX, STRAVA_DESCRIPTION_PREFIX,
  postUpload, pollUploadStatus,
  withTrademarkSuffix, withTrademarkPrefix,
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
      accessToken: tok, gpxXml: xml, name: 'fujihill ride', activityType: 'VirtualRide',
      externalId: 'ride-001',
    }, { fetch: fakeFetch });
    expect(res.id).toBe(999);
    expect(captured.url).toBe(STRAVA_UPLOADS_URL);
    expect(captured.method).toBe('POST');
    expect(captured.auth).toBe('Bearer a1');
    expect(captured.fields.data_type).toBe('gpx');
    expect(captured.fields.activity_type).toBe('VirtualRide');
    expect(captured.fields.sport_type).toBe('VirtualRide');
    // brief 34 ε-4: name に「(fujihill-trainer simulator)」接尾が強制 append される (= 商標混同対策).
    expect(captured.fields.name).toBe('fujihill ride (fujihill-trainer simulator)');
    // brief 34 ε-4: description にも商標混同対策 prefix が prepend される (caller 渡し空でも付く).
    expect(captured.fields.description).toMatch(/^This is an indoor trainer simulation/);
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

describe('brief 34 ε-4: withTrademarkSuffix (= name の商標混同対策 hardcode helper)', () => {
  it('通常 name に接尾 " (fujihill-trainer simulator)" を付ける', () => {
    expect(withTrademarkSuffix('my ride')).toBe('my ride (fujihill-trainer simulator)');
  });

  it('既に接尾が付いていれば idempotent (= 二重 append しない)', () => {
    const already = 'my ride (fujihill-trainer simulator)';
    expect(withTrademarkSuffix(already)).toBe(already);
  });

  it('空文字 / null / undefined → default name "fujihill ride" + 接尾', () => {
    expect(withTrademarkSuffix('')).toBe('fujihill ride (fujihill-trainer simulator)');
    expect(withTrademarkSuffix(null)).toBe('fujihill ride (fujihill-trainer simulator)');
    expect(withTrademarkSuffix(undefined)).toBe('fujihill ride (fujihill-trainer simulator)');
  });

  it('STRAVA_NAME_SUFFIX const が " (fujihill-trainer simulator)" で固定 (= 改竄 regression block)', () => {
    expect(STRAVA_NAME_SUFFIX).toBe(' (fujihill-trainer simulator)');
  });
});

describe('brief 34 ε-4: withTrademarkPrefix (= description の商標混同対策 hardcode helper)', () => {
  it('通常 description に prefix を prepend する (= 改行 2 つで本文と分離)', () => {
    const out = withTrademarkPrefix('My personal note.');
    expect(out).toMatch(/^This is an indoor trainer simulation/);
    expect(out).toContain('Not an actual outdoor activity.');
    expect(out).toContain('My personal note.');
    expect(out).toContain('\n\n');
  });

  it('既に prefix が付いていれば idempotent (= 二重 prepend しない)', () => {
    const already = STRAVA_DESCRIPTION_PREFIX + 'note';
    expect(withTrademarkPrefix(already)).toBe(already);
  });

  it('空文字 / null / undefined → prefix のみ (= 本文無し)', () => {
    expect(withTrademarkPrefix('')).toBe(STRAVA_DESCRIPTION_PREFIX);
    expect(withTrademarkPrefix(null)).toBe(STRAVA_DESCRIPTION_PREFIX);
    expect(withTrademarkPrefix(undefined)).toBe(STRAVA_DESCRIPTION_PREFIX);
  });

  it('STRAVA_DESCRIPTION_PREFIX const は「Mt. Fuji Hill Climb」を含む (= 商標明示)', () => {
    expect(STRAVA_DESCRIPTION_PREFIX).toContain('Mt. Fuji Hill Climb');
    expect(STRAVA_DESCRIPTION_PREFIX).toContain('Not an actual outdoor activity');
    expect(STRAVA_DESCRIPTION_PREFIX).toContain('fujihill-trainer');
  });
});

describe('brief 34 ε-4: postUpload が 2 重 gate の内側として name / description を強制 hardcode', () => {
  it('caller が name を override しても接尾が消えない (= 2 重 gate 内側で append)', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.fields = {};
      for (const [k, v] of init.body.entries()) captured.fields[k] = v;
      return { ok: true, status: 201, async json() { return { id: 1 }; } };
    });
    // caller が「悪意」or「事故」で接尾なしの name を渡しても、 postUpload 内で必ず付く.
    await postUpload({
      accessToken: 'a', gpxXml: 'x',
      name: 'attempt to override',
      activityType: 'VirtualRide',
    }, { fetch: fakeFetch });
    expect(captured.fields.name).toBe('attempt to override (fujihill-trainer simulator)');
  });

  it('caller が name を渡さなくても default + 接尾が付く', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.fields = {};
      for (const [k, v] of init.body.entries()) captured.fields[k] = v;
      return { ok: true, status: 201, async json() { return { id: 1 }; } };
    });
    await postUpload({
      accessToken: 'a', gpxXml: 'x', activityType: 'VirtualRide',
    }, { fetch: fakeFetch });
    expect(captured.fields.name).toBe('fujihill ride (fujihill-trainer simulator)');
    expect(captured.fields.description).toMatch(/^This is an indoor trainer simulation/);
  });

  it('caller が description を override しても prefix が prepend される', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.fields = {};
      for (const [k, v] of init.body.entries()) captured.fields[k] = v;
      return { ok: true, status: 201, async json() { return { id: 1 }; } };
    });
    await postUpload({
      accessToken: 'a', gpxXml: 'x', description: 'my own note',
    }, { fetch: fakeFetch });
    const desc = captured.fields.description;
    expect(desc).toMatch(/^This is an indoor trainer simulation/);
    expect(desc).toContain('my own note');
  });

  it('caller が 2 重 gate 外側 (= postride_buttons 経路) で先行 append しても、 内側で二重 append しない (idempotent)', async () => {
    const captured = {};
    const fakeFetch = vi.fn(async (url, init) => {
      captured.fields = {};
      for (const [k, v] of init.body.entries()) captured.fields[k] = v;
      return { ok: true, status: 201, async json() { return { id: 1 }; } };
    });
    // postride_buttons.js が「先 append」した値で渡してきた case を再現.
    const decoratedName = withTrademarkSuffix('my ride');
    const decoratedDescription = withTrademarkPrefix('note');
    await postUpload({
      accessToken: 'a', gpxXml: 'x',
      name: decoratedName,
      description: decoratedDescription,
    }, { fetch: fakeFetch });
    expect(captured.fields.name).toBe('my ride (fujihill-trainer simulator)');  // 接尾は 1 つ
    expect(captured.fields.name).not.toMatch(/simulator\)\s*\(fujihill-trainer simulator\)/);
    const descMatches = captured.fields.description.match(/This is an indoor trainer simulation/g) || [];
    expect(descMatches.length).toBe(1);  // prefix は 1 つ
  });
});
