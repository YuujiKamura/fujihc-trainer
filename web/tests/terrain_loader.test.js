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
import { IDBFactory } from 'fake-indexeddb';
import {
  createTerrainLoader, buildGsiProbeUrls, buildGsiProbeCoords, GSI_DEM_DIRECT_BASE,
} from '../lib/terrain_loader.js';
import { openTileCache } from '../lib/tile_cache.js';

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
  it('default lon/lat (= 富士山中央) で z=15 タイル 3 枚を生成 (b59: dem5a z15)', () => {
    const urls = buildGsiProbeUrls('/tiles/gsi_dem');
    expect(urls.length).toBe(3);
    expect(urls[0]).toMatch(/\/15\/\d+\/\d+\.png$/);
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
    expect(buildGsiProbeUrls('/tiles/gsi_dem')[0]).toMatch(/^\/tiles\/gsi_dem\/15\//);
    expect(buildGsiProbeUrls('/gsi_dem')[0]).toMatch(/^\/gsi_dem\/15\//);
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
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
      gsiTileBaseUrl: '/g',
      fetchImpl: makeRangeFetch({ headStatus: 200, rangeStatus: 200 }),
    });
    await loader.start();
    const s = loader.getStatus();
    expect(Object.isFrozen(s)).toBe(true);
    expect('rangeWarning' in s).toBe(true);
  });
});

// b31: GSI dem 取得経路を IndexedDB → bridge → GSI direct → IndexedDB.set の chain に
// 差し替える経路を pin。 既存 26 件は backward compat 経路 (= chain 引数なし、 旧挙動) を通る
// ので無改変 PASS、 本 describe は新 chain 経路 (= TileCache + gsiDirectBase 指定時) のみ pin。
describe('createTerrainLoader: IndexedDB chain (b31 経路差し替え)', () => {
  it('buildGsiProbeCoords を export し、 buildGsiProbeUrls と一致する z/x/y を返す', () => {
    const coords = buildGsiProbeCoords();
    const urls = buildGsiProbeUrls('/g');
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
      gsiTileBaseUrl: '/g',
      gsiDirectBase: 'https://example.test/dem',
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.includes('/g/') || url.includes('example.test/dem')) fetchCallCount += 1;
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(fetchCallCount).toBe(0);  // GSI fetch はゼロ、 cache のみ
  });

  it('tileCache miss + bridge ok で bridge fetch、 tileCache に set される', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    let bridgeFetched = 0;
    let directFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/bridge/dem',
      gsiDirectBase: 'https://example.test/dem',
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith('/bridge/dem/')) {
          bridgeFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        if (url.startsWith('https://example.test/dem')) {
          directFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };  // course.json 等
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(bridgeFetched).toBe(3);   // 3 枚すべて bridge から取得
    expect(directFetched).toBe(0);   // GSI direct は呼ばれず

    // tileCache に保存されたことを確認
    const coords = buildGsiProbeCoords();
    const got = await cache.get('dem_png', coords[0].z, coords[0].x, coords[0].y);
    expect(got).toBeTruthy();
  });

  it('tileCache miss + bridge fail + GSI direct ok で GSI direct fetch、 tileCache に set される', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    let bridgeFetched = 0;
    let directFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/bridge/dem',
      gsiDirectBase: 'https://example.test/dem',
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith('/bridge/dem/')) {
          bridgeFetched += 1;
          return { ok: false, status: 404 };  // bridge は不在
        }
        if (url.startsWith('https://example.test/dem')) {
          directFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(bridgeFetched).toBe(3);    // 3 枚 bridge 試行 (全 fail)
    expect(directFetched).toBe(3);    // 3 枚 direct 試行 (全 ok)
    const coords = buildGsiProbeCoords();
    const got = await cache.get('dem_png', coords[0].z, coords[0].x, coords[0].y);
    expect(got).toBeTruthy();
  });

  it('tileCache miss + bridge fail + GSI direct fail で probe failure (= error 立つ)', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/bridge/dem',
      gsiDirectBase: 'https://example.test/dem',
      tileCache: cache,
      fetchImpl: async (url) => {
        if (url.startsWith('/bridge/dem/') || url.startsWith('https://example.test/dem')) {
          return { ok: false, status: 404 };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(false);
    expect(loader.getStatus().error).toMatch(/GSI/);
  });

  it('tileCache が Promise<null> でも crash せず bridge / direct chain だけで動く', async () => {
    let bridgeFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/bridge/dem',
      gsiDirectBase: 'https://example.test/dem',
      tileCache: Promise.resolve(null),  // = IndexedDB 利用不可環境
      fetchImpl: async (url) => {
        if (url.startsWith('/bridge/dem/')) {
          bridgeFetched += 1;
          return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    expect(bridgeFetched).toBe(3);
  });

  it('gsiDirectBase 未指定 + tileCache のみ → bridge fail で direct fallback なし、 ただし cache hit は効く', async () => {
    const cache = await openTileCache({ idbFactory: new IDBFactory() });
    // 1 枚だけ pre-populate
    const coords = buildGsiProbeCoords();
    await cache.set('dem_png', coords[0].z, coords[0].x, coords[0].y, new Uint8Array([0]));
    let bridgeFetched = 0;
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/bridge/dem',
      tileCache: cache,
      // gsiDirectBase 未指定 = GSI direct fallback なし
      fetchImpl: async (url) => {
        if (url.startsWith('/bridge/dem/')) {
          bridgeFetched += 1;
          return { ok: false, status: 404 };  // bridge も全 fail
        }
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    // 1 枚は cache hit、 残 2 枚は bridge fail で direct fallback なし → 1 枚成功 (= 部分許容)
    expect(loader.isReady()).toBe(true);
    expect(bridgeFetched).toBe(2);   // 残 2 枚だけ bridge 試行 (cache miss 分)
  });

  it('cfg.tileCache / cfg.gsiDirectBase 両方未指定 = backward compat (= 既存 26 件と等価挙動)', async () => {
    // 既存挙動: gsiUrls (= buildGsiProbeUrls の戻り) で 1 回 fetch のみ、 retry / chain なし
    let fetchedUrls = [];
    const loader = createTerrainLoader({
      courseUrl: '/c',
      gsiTileBaseUrl: '/legacy/gsi_dem',
      fetchImpl: async (url) => {
        fetchedUrls.push(url);
        return { ok: true, status: 200 };
      },
    });
    await loader.start();
    expect(loader.isReady()).toBe(true);
    // 既存挙動: gsiTileBaseUrl prefix で 3 枚 fetch
    const gsiFetches = fetchedUrls.filter((u) => u.startsWith('/legacy/gsi_dem/'));
    expect(gsiFetches.length).toBe(3);
  });
});
