// Service Worker cache 版数の内部整合 pin。
//
// index.html / viewer-maplibre.js を変更した時、 sw.js の CACHE_NAME を bump し、
// index.html の `?v=N` と sw.js PRECACHE_URLS 内の `viewer-maplibre.js?v=N` を同値に
// 揃えないと、 cache-first の SW が旧版を返し続けて修正がユーザに届かない。
// 「片方だけ bump して版数が割れる」事故 (= precache が旧 URL を取得) を CI で検出する。
//
// この test は版数が「最新であること」は判定できない (= ファイル変更の有無は test には不可視)。
// 判定できるのは「index.html と sw.js の ?v= が一致しているか」= 半 bump ミスの検出。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
const sw = readFileSync(resolve(__dirname, '..', 'sw.js'), 'utf8');

describe('Service Worker cache 版数の内部整合', () => {
  it('index.html の viewer-maplibre.js?v=N と sw.js PRECACHE_URLS の ?v=N が一致する', () => {
    const htmlM = html.match(/viewer-maplibre\.js\?v=(\d+)/);
    const swM = sw.match(/viewer-maplibre\.js\?v=(\d+)/);
    expect(htmlM).not.toBeNull();
    expect(swM).not.toBeNull();
    // 半 bump (= 片方だけ更新) なら不一致で fail。
    expect(htmlM[1]).toBe(swM[1]);
  });

  it('sw.js に CACHE_NAME が定義済 (= 版数 bump で旧 cache を捨てる入口)', () => {
    expect(sw).toMatch(/const\s+CACHE_NAME\s*=\s*['"]fujihill-v\d+['"]/);
  });
});
