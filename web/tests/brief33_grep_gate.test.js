// brief 33 完了条件 §11 物理 grep gate.
// (= CSP / 外部 https 参照ゼロ / btnStravaDisconnect / STRAVA_*_URL 散在禁止 / RIDE_DB_VERSION 散在禁止)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(__dirname, '..');
const INDEX_PATH = join(WEB_DIR, 'index.html');
const OAUTH_HTML_PATH = join(WEB_DIR, 'oauth-callback.html');
const LIB_DIR = join(WEB_DIR, 'lib');
const VIEWER_PATH = join(WEB_DIR, 'viewer-map3d.js');

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      // vendor / archived は除外
      if (name === 'vendor' || name === 'archived') continue;
      out.push(...listJsFiles(p));
    } else if (name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

describe('brief 33 §11.5: CSP meta が index.html / oauth-callback.html 両方に存在', () => {
  it('index.html に Content-Security-Policy meta あり、 script-src self', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    expect(html).toMatch(/<meta\s+http-equiv="Content-Security-Policy"[^>]*content="[^"]*script-src[^"]*'self'/i);
  });
  it('oauth-callback.html に Content-Security-Policy meta あり、 script-src self', () => {
    const html = readFileSync(OAUTH_HTML_PATH, 'utf8');
    expect(html).toMatch(/<meta\s+http-equiv="Content-Security-Policy"[^>]*content="[^"]*script-src[^"]*'self'/i);
  });
  it('どちらも script-src に unsafe-inline を含まない (= inline script ゼロを物理保証)', () => {
    const a = readFileSync(INDEX_PATH, 'utf8');
    const b = readFileSync(OAUTH_HTML_PATH, 'utf8');
    // script-src ディレクティブ内に unsafe-inline が居ないこと
    const scriptSrcA = a.match(/script-src[^;"]*/i);
    const scriptSrcB = b.match(/script-src[^;"]*/i);
    expect(scriptSrcA).not.toBeNull();
    expect(scriptSrcB).not.toBeNull();
    expect(scriptSrcA[0]).not.toMatch(/unsafe-inline/);
    expect(scriptSrcB[0]).not.toMatch(/unsafe-inline/);
  });
});

describe('brief 33 §11.6: 外部 https 参照ゼロ (= same-origin 強制)', () => {
  // index.html / oauth-callback.html / web/lib/*.js
  function externalScriptOrLinkCount(text) {
    const scripts = text.match(/<script[^>]*\bsrc=["']https?:\/\/[^"']+["']/gi) || [];
    const links = text.match(/<link[^>]*\bhref=["']https?:\/\/[^"']+["']/gi) || [];
    return scripts.length + links.length;
  }
  it('index.html に外部 <script src="https://..."> / <link href="https://..."> ゼロ', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    expect(externalScriptOrLinkCount(html)).toBe(0);
  });
  it('oauth-callback.html に外部 <script src> / <link href> ゼロ', () => {
    const html = readFileSync(OAUTH_HTML_PATH, 'utf8');
    expect(externalScriptOrLinkCount(html)).toBe(0);
  });
  // web/lib/*.js も走査 (= URL を fetch する文字列はあっても、 <script src="https://"> は無いはず)
  it('web/lib/**/*.js に <script src="https://..."> を含まない', () => {
    for (const f of listJsFiles(LIB_DIR)) {
      const t = readFileSync(f, 'utf8');
      expect(externalScriptOrLinkCount(t)).toBe(0);
    }
  });
});

describe('brief 33 §11.7: #btnStravaDisconnect element が setup-overlay 内に存在', () => {
  it('index.html に id="btnStravaDisconnect" が含まれる', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    expect(html).toMatch(/id="btnStravaDisconnect"/);
  });
});

describe('brief 33 §11.1: STRAVA_*_URL const が strava_oauth.js / strava_upload.js でのみ宣言', () => {
  function findExportConst(text, name) {
    return new RegExp(`export\\s+const\\s+${name}\\s*=`).test(text);
  }
  it('STRAVA_AUTHORIZE_URL は strava_oauth.js のみ', () => {
    const oauth = readFileSync(join(LIB_DIR, 'strava_oauth.js'), 'utf8');
    expect(findExportConst(oauth, 'STRAVA_AUTHORIZE_URL')).toBe(true);
    // 他 file (= 全 web/lib/*.js + viewer) で再宣言ゼロ
    for (const f of listJsFiles(LIB_DIR)) {
      if (f.endsWith('strava_oauth.js')) continue;
      const t = readFileSync(f, 'utf8');
      expect(t).not.toMatch(/export\s+const\s+STRAVA_AUTHORIZE_URL\s*=/);
    }
  });
  it('STRAVA_TOKEN_URL は strava_oauth.js のみ', () => {
    const oauth = readFileSync(join(LIB_DIR, 'strava_oauth.js'), 'utf8');
    expect(findExportConst(oauth, 'STRAVA_TOKEN_URL')).toBe(true);
    for (const f of listJsFiles(LIB_DIR)) {
      if (f.endsWith('strava_oauth.js')) continue;
      const t = readFileSync(f, 'utf8');
      expect(t).not.toMatch(/export\s+const\s+STRAVA_TOKEN_URL\s*=/);
    }
  });
  it('STRAVA_UPLOADS_URL は strava_upload.js のみ', () => {
    const up = readFileSync(join(LIB_DIR, 'strava_upload.js'), 'utf8');
    expect(findExportConst(up, 'STRAVA_UPLOADS_URL')).toBe(true);
    for (const f of listJsFiles(LIB_DIR)) {
      if (f.endsWith('strava_upload.js')) continue;
      const t = readFileSync(f, 'utf8');
      expect(t).not.toMatch(/export\s+const\s+STRAVA_UPLOADS_URL\s*=/);
    }
  });
});

describe('brief 33 §11.2: viewer-map3d.js に strava.com 直リテラル ゼロ', () => {
  it('viewer は strava.com URL を直接 literal で持たない (= module 経由のみ)', () => {
    const viewer = readFileSync(VIEWER_PATH, 'utf8');
    expect(viewer).not.toMatch(/strava\.com/);
  });
});

describe('brief 33 §11.3: RIDE_DB_VERSION ローカル再定義ゼロ (= NG-R3-3 同型予防)', () => {
  it('RIDE_DB_VERSION の export const は ride_db.js のみ', () => {
    const rideDb = readFileSync(join(LIB_DIR, 'ride_db.js'), 'utf8');
    expect(rideDb).toMatch(/export\s+const\s+RIDE_DB_VERSION\s*=/);
    for (const f of listJsFiles(LIB_DIR)) {
      if (f.endsWith('ride_db.js')) continue;
      const t = readFileSync(f, 'utf8');
      expect(t).not.toMatch(/(?:const|let|var)\s+RIDE_DB_VERSION\s*=/);
    }
  });
});

describe('brief 33 §11.4: gpx_builder.js / gpx_export.py の出力 byte 一致 fixture が存在', () => {
  it('web/tests/fixtures/py_gpx_builder_basic.json が存在 (= gpx_builder.test.js が読む)', () => {
    const p = join(WEB_DIR, 'tests', 'fixtures', 'py_gpx_builder_basic.json');
    const raw = readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    expect(obj.expected_gpx).toMatch(/^<\?xml version="1\.0"/);
    expect(Array.isArray(obj.input_trkpts)).toBe(true);
    expect(obj.input_trkpts.length).toBeGreaterThan(0);
  });
});
