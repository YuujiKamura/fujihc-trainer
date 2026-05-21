// b42 terrain_phase.js 単体テスト。
//
// terrain_phase.js は viewer から切り離したフェーズ0「地形データ準備」のオーケストレーション。
// DOM 非依存なので、ここで loader / fetch を inject して lifecycle を網羅検証する。
//
// このテストが落ちたら何を検出したことになるか:
//   - buildTerrainPhaseUrls の URL 構築が旧 startTerrainProbe と食い違った (= 抽出で URL drift)
//   - skipTerrain で配布元を叩いてしまう (= loader を生成した) regression
//   - probe の done / failed / progress が subscribe に届かない配線断
//   - 既定 loader 経由で GSI_DEM_DIRECT_BASE が loader へ渡らない pass-through 断

import { describe, it, expect } from 'vitest';
import { GSI_DEM_DIRECT_BASE } from '../lib/terrain_loader.js';
import { buildTerrainPhaseUrls, createTerrainPhase } from '../lib/terrain_phase.js';

// terrain_loader の freezeStatus と同じ形の snapshot を作る test helper。
function snap(phase, extra = {}) {
  return Object.freeze({
    phase,
    label: extra.label || `label-${phase}`,
    percent: extra.percent != null ? extra.percent : (phase === 'done' ? 100 : 0),
    done: extra.done != null ? extra.done : (phase === 'done' ? 1 : 0),
    total: extra.total != null ? extra.total : 1,
    error: extra.error || null,
    rangeWarning: extra.rangeWarning || null,
  });
}

// 任意の snapshot 列を start() で順に emit する fake loader。
// startCalls で多重 start を、capturedCfg で createTerrainPhase が渡した cfg を観測できる。
function makeFakeLoader(emitOnStart) {
  const subs = new Set();
  let current = snap('pending');
  let startCalls = 0;
  return {
    startCalls: () => startCalls,
    async start() {
      startCalls += 1;
      for (const s of emitOnStart) {
        current = s;
        for (const cb of subs) cb(s);
      }
      return current;
    },
    subscribe(cb) { subs.add(cb); cb(current); return () => subs.delete(cb); },
    getStatus() { return current; },
    isReady() { return current.phase === 'done' && !current.error; },
  };
}

describe('buildTerrainPhaseUrls — URL 構築 (= 旧 startTerrainProbe と同一)', () => {
  it('basePath から course / pmtiles / GSI bridge prefix を組む', () => {
    const urls = buildTerrainPhaseUrls('/fujihc-trainer/');
    expect(urls.courseUrl).toBe('/fujihc-trainer/static/course.json');
    expect(urls.pmtilesUrl).toBe('/fujihc-trainer/static/map.pmtiles');
    expect(urls.gsiTileBaseUrl).toBe('/fujihc-trainer/static/tiles/gsi_dem');
  });

  it('basePath = "/" (= localhost) でも static path を組む', () => {
    const urls = buildTerrainPhaseUrls('/');
    expect(urls.courseUrl).toBe('/static/course.json');
    expect(urls.gsiTileBaseUrl).toBe('/static/tiles/gsi_dem');
  });

  it('basePath 未指定 (= "") でも throw せず相対 path を返す', () => {
    const urls = buildTerrainPhaseUrls();
    expect(urls.courseUrl).toBe('static/course.json');
  });
});

describe('createTerrainPhase — happy path (fake loader)', () => {
  it('start() で loader を 1 回生成し、cfg に URL + GSI_DEM_DIRECT_BASE + tileCache を渡す', async () => {
    let capturedCfg = null;
    const fake = makeFakeLoader([snap('loading', { done: 0, total: 3 }), snap('done', { total: 3, done: 3 })]);
    const phase = createTerrainPhase({
      basePath: '/fujihc-trainer/',
      skipTerrain: false,
      tileCache: null,
      loaderFactory: (cfg) => { capturedCfg = cfg; return fake; },
    });
    await phase.start();
    expect(capturedCfg).not.toBeNull();
    expect(capturedCfg.courseUrl).toBe('/fujihc-trainer/static/course.json');
    expect(capturedCfg.pmtilesUrl).toBe('/fujihc-trainer/static/map.pmtiles');
    expect(capturedCfg.gsiTileBaseUrl).toBe('/fujihc-trainer/static/tiles/gsi_dem');
    // GSI direct base は terrain_loader.js の SoT 定数がそのまま渡る (= literal 移設なし)
    expect(capturedCfg.gsiDirectBase).toBe(GSI_DEM_DIRECT_BASE);
    expect(fake.startCalls()).toBe(1);
  });

  it('subscribe callback に probe の status snapshot が emit され、最終は done', async () => {
    const fake = makeFakeLoader([snap('loading', { done: 1, total: 3 }), snap('done', { total: 3, done: 3 })]);
    const received = [];
    const phase = createTerrainPhase({ basePath: '/', loaderFactory: () => fake });
    phase.subscribe((s) => received.push(s.phase));
    await phase.start();
    expect(received[0]).toBe('pending');          // subscribe 時の immediate emit
    expect(received).toContain('loading');
    expect(received[received.length - 1]).toBe('done');
  });

  it('isReady() / getStatus() が done 後に整合する', async () => {
    const fake = makeFakeLoader([snap('done', { total: 3, done: 3 })]);
    const phase = createTerrainPhase({ basePath: '/', loaderFactory: () => fake });
    expect(phase.isReady()).toBe(false);            // start 前は pending
    expect(phase.getStatus().phase).toBe('pending');
    await phase.start();
    expect(phase.isReady()).toBe(true);
    expect(phase.getStatus().phase).toBe('done');
  });
});

describe('createTerrainPhase — skipTerrain (= ?noterrain、配布元を叩かない)', () => {
  it('start() 後 isReady()===true、loaderFactory は呼ばれない', async () => {
    let loaderCalled = false;
    const phase = createTerrainPhase({
      basePath: '/',
      skipTerrain: true,
      loaderFactory: () => { loaderCalled = true; return makeFakeLoader([]); },
    });
    const result = await phase.start();
    expect(loaderCalled).toBe(false);               // loader を生成しない = 配布元 fetch ゼロ
    expect(result.phase).toBe('done');
    expect(phase.isReady()).toBe(true);
    expect(phase.getStatus().phase).toBe('done');
  });

  it('skip 経路でも subscribe callback に done snapshot が届く', async () => {
    const received = [];
    const phase = createTerrainPhase({ basePath: '/', skipTerrain: true });
    phase.subscribe((s) => received.push(s.phase));
    await phase.start();
    expect(received[received.length - 1]).toBe('done');
  });
});

describe('createTerrainPhase — error path', () => {
  it('loader が phase:failed を emit したら isReady()===false で error snapshot が届く', async () => {
    const fake = makeFakeLoader([snap('failed', { error: 'course.json 取得失敗', total: 3, done: 0 })]);
    const received = [];
    const phase = createTerrainPhase({ basePath: '/', loaderFactory: () => fake });
    phase.subscribe((s) => received.push(s));
    await phase.start();
    const last = received[received.length - 1];
    expect(last.phase).toBe('failed');
    expect(last.error).toBe('course.json 取得失敗');
    expect(phase.isReady()).toBe(false);
  });
});

describe('createTerrainPhase — idempotent', () => {
  it('start() 多重呼出は no-op (= loader.start は 1 回のみ)', async () => {
    const fake = makeFakeLoader([snap('done', { total: 3, done: 3 })]);
    const phase = createTerrainPhase({ basePath: '/', loaderFactory: () => fake });
    await phase.start();
    await phase.start();
    await phase.start();
    expect(fake.startCalls()).toBe(1);
  });
});

describe('createTerrainPhase — 既定 loader 経由の pass-through (loaderFactory 未指定)', () => {
  it('fetchImpl 注入で既定 createTerrainLoader が走り、GSI direct base 由来の URL が fetch される', async () => {
    const fetched = [];
    // bridge GSI tile (= static/tiles/gsi_dem) は 404、 GSI direct は ok を返す mock。
    // → loader の chain が bridge fail → GSI direct fetch に落ち、GSI_DEM_DIRECT_BASE が
    //   loader へ渡っていることが fetch 先 URL で観測できる。
    const fetchImpl = async (url) => {
      fetched.push(url);
      if (url.includes('/static/tiles/gsi_dem/')) {
        return { ok: false, status: 404 };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const phase = createTerrainPhase({
      basePath: '/',
      skipTerrain: false,
      tileCache: null,            // IndexedDB chain を skip (= backward compat path)
      fetchImpl,                  // loaderFactory 未指定 = 既定 createTerrainLoader
    });
    await phase.start();
    const hitGsiDirect = fetched.some((u) => u.startsWith(GSI_DEM_DIRECT_BASE));
    expect(hitGsiDirect).toBe(true);
    // course.json も probe される (= URL 構築の pass-through)
    expect(fetched.some((u) => u.includes('static/course.json'))).toBe(true);
  });
});
