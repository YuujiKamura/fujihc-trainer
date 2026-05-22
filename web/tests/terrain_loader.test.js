// brief 34 ε-9 + b69 unit test: terrain_loader の state 遷移を pin.
//
// b69 で `cfg.gsiTileBaseUrl` (= 旧 static/bridge 配信経路) を撤去し、 DEM タイル取得
// chain を IndexedDB → GSI 直の 2 段に統一した。 本 test も `gsiDirectBase` 必須前提で書く。
//
// 範囲:
//   - createTerrainLoader({ courseUrl, pmtilesUrl, gsiDirectBase, fetchImpl }) で生成
//   - start() で全 probe 並列発火 → 全 ok で isReady() === true
//   - course.json 取得失敗 → phase === 'failed' / isReady === false / error 文言
//   - pmtilesUrl 省略 → static mode skip でも all-green になる (= bridge mode 対応)
//   - GSI tile 3 枚全部失敗 → error
//   - 1-2 枚失敗でも残りが OK なら全体 ok (= 部分許容)
//   - subscribe(cb) で snapshot を 1 引数で受ける、 解除関数で停止
//   - buildGsiProbeUrls の lon/lat/z から正しい x/y を計算

import { describe, it, expect, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createTerrainLoader, buildGsiProbeUrls, buildGsiProbeCoords, GSI_DEM_DIRECT_BASE,
} from '../lib/terrain_loader.js';
import { openTileCache } from '../lib/tile_cache.js';

const TEST_DIRECT_BASE = 'https://example.test/dem';

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

describe('buildGsiProbeUrls (b69: gsiDirectBase 1 引数)', () => {
  it('default lon/lat (= 富士山中央) で z=15 タイル 3 枚を生成 (b59: dem5a z15)', () => {
    const urls = buildGsiProbeUrls(TEST_DIRECT_BASE);
    expect(urls.length).toBe(3);
    expect(urls[0]).toMatch(/\/15\/\d+\/\d+\.png$/);
  });

  it('opts.lon / opts.lat で別座標の tile を計算', () => {
    const a = buildGsiProbeUrls(TEST_DIRECT_BASE, { lon: 138.75, lat: 35.40, z: 14 });
    const b = buildGsiProbeUrls(TEST_DIRECT_BASE, { lon: 139.50, lat: 35.50, z: 14 });
    // 東京寄り b の方が x 大きい (= 経度東側).
    const ax = parseInt(a[0].match(/\/14\/(\d+)\//)[1], 10);
    const bx = parseInt(b[0].match(/\/14\/(\d+)\//)[1], 10);
    expect(bx).toBeGreaterThan(ax);
  });

  it('gsiDirectBase prefix を尊重 (= GSI 公式 endpoint へ直接 append)', () => {
    expect(buildGsiProbeUrls('https://example.test/dem')[0]).toMatch(/^https:\/\/example\.test\/dem\/15\//);
    expect(buildGsiProbeUrls('https://other.test/x')[0]).toMatch(/^https:\/\/other\.test\/x\/15\//);
  });
});

describe('createTerrainLoader: 全 probe 成功', () => {
  it('static mode (course + pmtiles + gsi 3) → isReady() === true、 phase done', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/static/course.json',
      pmtilesUrl: '/static/map.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async () => ok(),
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().phase).toBe('done');
    expect(loader.getStatus().percent).toBe(100);
    expect(loader.getStatus().error).toBe(null);
  });

  it('bridge mode (pmtiles 省略) → course + gsi 3 で all-green', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiDirectBase: TEST_DIRECT_BASE,
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
      gsiDirectBase: TEST_DIRECT_BASE,
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
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async (url) => (url.includes('map.pmtiles') ? notFound() : ok()),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/pmtiles/);
  });

  it('GSI 3 枚全部失敗 → error 文言', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async (url) => (url.startsWith(TEST_DIRECT_BASE) ? notFound() : ok()),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/GSI/);
  });

  it('GSI 1 枚失敗 + 2 枚成功 → 全体 ok (= 部分許容)', async () => {
    let gsiCount = 0;
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async (url) => {
        if (url.startsWith(TEST_DIRECT_BASE)) {
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
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async () => { throw new Error('NetworkError'); },
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().phase).toBe('failed');
  });

  it('b69: gsiDirectBase 未指定 → probe 失敗扱い (= chain が GSI 直に到達不能)', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/course.json',
      // gsiDirectBase 未指定
      fetchImpl: async () => ok(),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/GSI/);
  });
});

describe('createTerrainLoader: subscribe', () => {
  it('subscribe で immediate emit + done 通知を受ける', async () => {
    const events = [];
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
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
      gsiDirectBase: TEST_DIRECT_BASE,
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
      gsiDirectBase: TEST_DIRECT_BASE,
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
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async () => ok(),
    });
    const s = loader.getStatus();
    expect(Object.isFrozen(s)).toBe(true);
    await loader.start();
    expect(Object.isFrozen(loader.getStatus())).toBe(true);
  });
});

// brief 34 ε-10: pmtiles Range request probe の動作 pin.
// HEAD で pmtiles 存在を確認した直後に Range request 1 回試して、 server が
// 206 を返さない場合 (= 200 / 416) は rangeWarning を立てる。 terrainReady には影響しない。
describe('createTerrainLoader: pmtiles Range probe (brief 34 ε-10)', () => {
  // fetch impl が Request init に応じて分岐する mock を作る helper.
  // method, headers.Range の組合せ毎に response を返す。
  function makeRangeFetch({ headStatus = 200, rangeStatus = 206 } = {}) {
    return async (url, init) => {
      const method = (init && init.method) || 'GET';
      const hasRange = !!(init && init.headers && init.headers.Range);
      if (url.endsWith('.pmtiles')) {
        if (method === 'HEAD') {
          return { ok: headStatus < 400, status: headStatus };
        }
        if (hasRange) {
          // Range request: 指定 status を返す (= 206/200/416 等).
          return { ok: rangeStatus < 400, status: rangeStatus };
        }
        // Range header 無しの GET は HEAD と同等扱い (= test では起きないはず).
        return { ok: headStatus < 400, status: headStatus };
      }
      return ok();
    };
  }

  it('206 Partial Content → rangeWarning is null、 isReady true', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: makeRangeFetch({ headStatus: 200, rangeStatus: 206 }),
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().rangeWarning).toBeNull();
  });

  it('200 OK (= Range header 無視) → rangeWarning 立つ、 isReady は true (= warn 専用)', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: makeRangeFetch({ headStatus: 200, rangeStatus: 200 }),
    });
    await loader.start();
    // warn 立つが terrainReady は維持 (= 致命でない、 user 通知のみ).
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().rangeWarning).toMatch(/Range request 非対応/);
  });

  it('416 Range Not Satisfiable → rangeWarning 立つ、 isReady true', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: makeRangeFetch({ headStatus: 200, rangeStatus: 416 }),
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().rangeWarning).toMatch(/416/);
  });

  it('network error (= fetch reject) on Range probe → rangeWarning null (= silent fallback)', async () => {
    // HEAD は ok だが Range request は reject する fetch impl.
    const fetchImpl = async (url, init) => {
      const method = (init && init.method) || 'GET';
      const hasRange = !!(init && init.headers && init.headers.Range);
      if (url.endsWith('.pmtiles')) {
        if (method === 'HEAD') return { ok: true, status: 200 };
        if (hasRange) throw new Error('NetworkError on Range');
        return { ok: true, status: 200 };
      }
      return ok();
    };
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl,
    });
    await loader.start();
    // HEAD probe ok なので isReady は true、 Range probe は silent fail で warn 立たない.
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().rangeWarning).toBeNull();
  });

  it('pmtilesUrl 省略 (= bridge mode) → Range probe 走らない、 rangeWarning null', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: async () => ok(),
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(loader.getStatus().rangeWarning).toBeNull();
  });

  it('pmtiles HEAD probe 失敗 → Range probe skip、 rangeWarning null (= 既存 pmtiles 取得失敗 error が出る)', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: makeRangeFetch({ headStatus: 404, rangeStatus: 206 }),
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/pmtiles/);
    // HEAD で落ちた段階で Range probe は走らないため warn は立たない (= 既存 error 表示が優先).
    expect(loader.getStatus().rangeWarning).toBeNull();
  });

  it('rangeWarning は snapshot 内に含まれて frozen', async () => {
    const loader = createTerrainLoader({
      courseUrl: '/c',
      pmtilesUrl: '/p.pmtiles',
      gsiDirectBase: TEST_DIRECT_BASE,
      fetchImpl: makeRangeFetch({ headStatus: 200, rangeStatus: 200 }),
    });
    await loader.start();
    const s = loader.getStatus();
    expect(Object.isFrozen(s)).toBe(true);
    expect('rangeWarning' in s).toBe(true);
  });
});

// b69: DEM タイル取得 chain は IndexedDB → GSI 直の 2 段。
// 旧 bridge 段 (= `cfg.gsiTileBaseUrl` 経由) は撤去済。 cache hit → fetch ゼロ、
// cache miss + GSI 直 ok → fetch 走って cache.set、 cache miss + GSI 直 fail → error。
describe('createTerrainLoader: IndexedDB chain (b69: 2 段に統一)', () => {
  it('buildGsiProbeCoords を export し、 buildGsiProbeUrls と一致する z/x/y を返す', () => {
    const coords = buildGsiProbeCoords();
    const urls = buildGsiProbeUrls(TEST_DIRECT_BASE);
    expect(coords.length).toBe(3);
    expect(urls[0]).toMatch(new RegExp(`/${coords[0].z}/${coords[0].x}/${coords[0].y}\\.png$`));
    expect(urls[1]).toMatch(new RegExp(`/${coords[1].z}/${coords[1].x}/${coords[1].y}\\.png$`));
    expect(urls[2]).toMatch(new RegExp(`/${coords[2].z}/${coords[2].x}/${coords[2].y}\\.png$`));
  });

  it('probe zoom は DEM 取得 zoom (= dem5a z15) と一致する (b59)', () => {
    // b59: GSI_PROBE_Z は module-scope const で export されないため、 probe coords 経由で
    // pin する。 probe zoom が DEM 取得 zoom (tile_loader3d.js DEM_ZOOM / GSI_DEM_ZOOMS)
    // とずれると、 Python prefetch 済 DB に無いタイルを probe して terrainReady 永久 false。
    const coords = buildGsiProbeCoords();
    for (const c of coords) {
      expect(c.z).toBe(15);
    }
  });

  it('GSI_DEM_DIRECT_BASE は GSI dem5a の公式 PNG endpoint (= cyberjapandata.gsi.go.jp/xyz/dem5a_png)', () => {
    // b59: viewer は PNG bytes として decode する経路。 dem5a_png (= 5mメッシュ、 z15 が
    // native 上限) を使う。 txt 形式の `dem` 経路に `.png` 拡張子を付けても GSI は 404 を返す。
    expect(GSI_DEM_DIRECT_BASE).toBe('https://cyberjapandata.gsi.go.jp/xyz/dem5a_png');
  });

  it('tileCache hit 時に GSI fetch ゼロ (= TTL 内再取得ゼロ)', async () => {
    // TileCache に 3 枚 pre-populate、 fetchImpl は呼ばれてはならない
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    const coords = buildGsiProbeCoords();
    const DUMMY = new Uint8Array([0]);
    for (const c of coords) {
      await cache.set('dem_png', c.z, c.x, c.y, DUMMY);
    }
    let fetchCallCount = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith(TEST_DIRECT_BASE)) fetchCallCount += 1;
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(fetchCallCount).toBe(0);  // GSI fetch はゼロ、 cache のみ
  });

  it('tileCache miss + GSI direct ok で direct fetch、 tileCache に set される', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    let directFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith(TEST_DIRECT_BASE)) {
          directFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };  // course.json 等
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(directFetched).toBe(3);   // 3 枚すべて GSI 直から取得

    // tileCache に保存されたことを確認
    const coords = buildGsiProbeCoords();
    const got = await cache.get('dem_png', coords[0].z, coords[0].x, coords[0].y);
    expect(got).toBeTruthy();
  });

  it('tileCache miss + GSI direct fail で probe failure (= error 立つ)', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith(TEST_DIRECT_BASE)) {
          return { ok: false, status: 404 };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/GSI/);
  });

  it('tileCache が Promise<null> でも crash せず GSI 直のみで動く', async () => {
    let directFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      tileCache: Promise.resolve(null),  // = IndexedDB 利用不可環境
      fetchImpl: async (url) => {
        if (url.startsWith(TEST_DIRECT_BASE)) {
          directFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(directFetched).toBe(3);
  });

  it('b69 negative: probe が叩く URL に static/tiles を一切含まない (= 撤去確認)', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    const fetchedUrls = [];
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiDirectBase: TEST_DIRECT_BASE,
      tileCache: cache,
      fetchImpl: async (url) => {
        fetchedUrls.push(url);
        if (url.startsWith(TEST_DIRECT_BASE)) {
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    // probe URL に static/tiles を含む経路が混入していない
    expect(fetchedUrls.some((u) => u.includes('static/tiles'))).toBe(false);
  });
});
