// brief 34 ε-9 unit test: terrain_loader の state 遷移を pin.
//
// 範囲:
//   - createTerrainLoader({ courseUrl, pmtilesUrl, gsiTileBaseUrl, fetchImpl }) で生成
//   - start() で全 probe 並列発火 → 全 ok で isReady() === true
//   - course.json 取得失敗 → phase === 'failed' / isReady === false / error 文言
//   - pmtilesUrl 省略 → static mode skip でも all-green になる (= bridge mode 対応)
//   - GSI tile 3 枚全部失敗 → error
//   - 1-2 枚失敗でも残りが OK なら全体 ok (= 部分許容)
//   - subscribe(cb) で snapshot を 1 引数で受ける、 解除関数で停止
//   - buildGsiProbeUrls の lon/lat/z から正しい x/y を計算

import { describe, it, expect, vi } from 'vitest';
import { createTerrainLoader, buildGsiProbeUrls } from '../lib/terrain_loader.js';

function ok() {
  return { ok: true, status: 200 };
}
function notFound() {
  return { ok: false, status: 404 };
}

function makeFetch(map) {
  return async (url) => {
    if (map[url]) return map[url];
    // 部分一致 fallback (= URL の末尾だけ key にできる)
    for (const k of Object.keys(map)) {
      if (url.endsWith(k)) return map[k];
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

describe('buildGsiProbeUrls', () => {
  it('default lon/lat (= 富士山中央) で z=14 タイル 3 枚を生成', () => {
    const urls = buildGsiProbeUrls('/tiles/gsi_dem');
    expect(urls.length).toBe(3);
    expect(urls[0]).toMatch(/\/14\/\d+\/\d+\.png$/);
  });

  it('opts.lon / opts.lat で別座標の tile を計算', () => {
    const a = buildGsiProbeUrls('/g', { lon: 138.75, lat: 35.40, z: 14 });
    const b = buildGsiProbeUrls('/g', { lon: 139.50, lat: 35.50, z: 14 });
    // 東京寄り b の方が x 大きい (= 経度東側).
    const ax = parseInt(a[0].match(/\/14\/(\d+)\//)[1], 10);
    const bx = parseInt(b[0].match(/\/14\/(\d+)\//)[1], 10);
    expect(bx).toBeGreaterThan(ax);
  });

  it('prefix の前置形を尊重 (= /tiles/gsi_dem / /gsi_dem 両対応)', () => {
    expect(buildGsiProbeUrls('/tiles/gsi_dem')[0]).toMatch(/^\/tiles\/gsi_dem\/14\//);
    expect(buildGsiProbeUrls('/gsi_dem')[0]).toMatch(/^\/gsi_dem\/14\//);
  });
});

describe('createTerrainLoader: 全 probe 成功', () => {
  it('static mode (course + pmtiles + gsi 3) → isReady() === true、 phase done', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/static/course.json',
      pmtilesUrl: '/static/map.pmtiles',
      gsiTileBaseUrl: '/static/tiles/gsi_dem',
      fetchImpl: makeFetch({
        '/static/course.json': ok(),
        '/static/map.pmtiles': ok(),
      }),
    });
    // GSI 3 枚は makeFetch の部分一致 fallback では引っかからないので、
    // 個別 entry を別途追加した fetchImpl で再構築する必要がある。
    // ここは「全 url ok を返す」mock に置換。
    const loader2 = createTerrainLoader({
      courseUrl: '/static/course.json',
      pmtilesUrl: '/static/map.pmtiles',
      gsiTileBaseUrl: '/static/tiles/gsi_dem',
      fetchImpl: async () => ok(),
    });
    await loader2.start();
    expect(loader2.isReady()).toBe(true);
    expect(loader2.getStatus().phase).toBe('done');
    expect(loader2.getStatus().percent).toBe(100);
    expect(loader2.getStatus().error).toBe(null);
  });

  it('bridge mode (pmtiles 省略) → course + gsi 3 で all-green', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiTileBaseUrl: '/tiles/gsi_dem',
      fetchImpl: async () => ok(),
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().phase).toBe('done');
    // pmtiles label は出ない (= bridge mode は skip)
    expect(loader.getStatus().label).not.toMatch(/pmtiles/);
  });
});

describe('createTerrainLoader: 失敗 case', () => {
  it('course.json 404 → phase failed / isReady false / error 文言', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/missing.json',
      gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => (url.includes('missing.json') ? notFound() : ok()),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().phase).toBe('failed');
    expect(loader.getStatus().error).toMatch(/course\.json/);
  });

  it('pmtiles 404 → phase failed', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      pmtilesUrl: '/map.pmtiles',
      gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => (url.includes('map.pmtiles') ? notFound() : ok()),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/pmtiles/);
  });

  it('GSI 3 枚全部失敗 → error 文言', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => (url.includes('/g/') ? notFound() : ok()),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/GSI/);
  });

  it('GSI 1 枚失敗 + 2 枚成功 → 全体 ok (= 部分許容)', async () => {
    let gsiCount = 0;
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => {
        if (url.includes('/g/')) {
          gsiCount += 1;
          return gsiCount === 1 ? notFound() : ok();
        }
        return ok();
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().error).toBe(null);
  });

  it('fetch reject (= network error) でも crash せず failed 状態に倒す', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiTileBaseUrl: '/g',
      fetchImpl: async () => { throw new Error('NetworkError'); },
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().phase).toBe('failed');
  });
});

describe('createTerrainLoader: subscribe', () => {
  it('subscribe で immediate emit + done 通知を受ける', async () => {
    const events = [];
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/g',
      fetchImpl: async () => ok(),
    });
    const unsub = loader.subscribe((s) => events.push(s.phase));
    // immediate emit が初回呼出で 1 イベント
    expect(events[0]).toBe('pending');
    await loader.start();
    // start 中 / 完了で複数 notify、 最後は done
    expect(events[events.length - 1]).toBe('done');
    unsub();
  });

  it('unsub 後は callback 来ない', async () => {
    const events = [];
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/g',
      fetchImpl: async () => ok(),
    });
    const unsub = loader.subscribe((s) => events.push(s.phase));
    unsub();
    const before = events.length;
    await loader.start();
    // unsub 後 push されない (= immediate emit 1 件で止まる)
    expect(events.length).toBe(before);
  });
});

describe('createTerrainLoader: idempotency', () => {
  it('start() 多重呼出は 1 回しか probe しない', async () => {
    let courseFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/g',
      fetchImpl: async (url) => {
        if (url === '/c') courseFetched += 1;
        return ok();
      },
    });
    await loader.start();
    await loader.start();
    await loader.start();
    expect(courseFetched).toBe(1);
  });
});

describe('createTerrainLoader: snapshot は frozen', () => {
  it('getStatus が返す object は Object.isFrozen', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/g',
      fetchImpl: async () => ok(),
    });
    const s = loader.getStatus();
    expect(Object.isFrozen(s)).toBe(true);
    await loader.start();
    expect(Object.isFrozen(loader.getStatus())).toBe(true);
  });
});
