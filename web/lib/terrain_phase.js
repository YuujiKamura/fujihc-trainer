// terrain_phase.js — フェーズ0「地形データ準備」のオーケストレーション。
//
// b42 (2026-05-21 user 指示「初回地形データフェッチを他のフェーズと切り離して」):
// viewer-maplibre.js 内 inline だった terrain probe のオーケストレーション (= URL 構築 /
// SKIP_TERRAIN 分岐 / loader 生成 / start / subscribe 配線) をこの module へ切り離す。
// design の #step-indicator「0. 地形データ準備」とコード境界を一致させ、単体テスト可能にする。
//
// 責務分担:
//   - terrain_phase.js (本 module) : probe の lifecycle オーケストレーションのみ。DOM 非依存。
//   - terrain_loader.js            : probe の fetch 実体 (= 本 module で触らない)。
//   - viewer-maplibre.js           : UI / gate / ロード overlay。本 module を subscribe で消費。
//
// GSI direct base の URL literal SoT は terrain_loader.js の GSI_DEM_DIRECT_BASE のまま。
// 本 module はその定数を import して loader へ渡すだけ (= literal をここに書かない、
// viewer_url_audit.test.js の「本体 source に GSI literal ゼロ」方針を維持)。

import { createTerrainLoader, GSI_DEM_DIRECT_BASE } from './terrain_loader.js';
import { openTileCache } from './tile_cache.js';

// basePath から course / pmtiles / GSI bridge prefix の URL を構築する pure formatter。
// bridge / static のどちらでも到達可能な static 側 path を返す (= 旧 startTerrainProbe と同一)。
// bridge mode 起動済の localhost でも /static/* は web/static/ にあるため 404 にならない。
export function buildTerrainPhaseUrls(basePath) {
  const base = basePath || '';
  return {
    courseUrl: `${base}static/course.json`,
    pmtilesUrl: `${base}static/map.pmtiles`,
    gsiTileBaseUrl: `${base}static/tiles/gsi_dem`,
  };
}

// skipTerrain (= ?noterrain=) 時に emit する合成 done snapshot。
// terrain_loader の freezeStatus と同じ形 (phase/label/percent/done/total/error/rangeWarning)。
function skipDoneSnapshot() {
  return Object.freeze({
    phase: 'done',
    label: '地形データ準備 skip (= ?noterrain)',
    percent: 100, done: 1, total: 1, error: null, rangeWarning: null,
  });
}
// start() 前 / loader 未生成時の pending snapshot。
function pendingSnapshot() {
  return Object.freeze({
    phase: 'pending',
    label: '地形データ準備 待機中',
    percent: 0, done: 0, total: 0, error: null, rangeWarning: null,
  });
}

/**
 * フェーズ0 terrain phase を生成する。起動直後 1 回 start() を呼ぶ。
 *
 * @param {object} cfg
 * @param {string}  cfg.basePath        - location 由来の BASE_PATH (= URL prefix)
 * @param {boolean} cfg.skipTerrain     - true (= ?noterrain) で probe を回さず即 done
 *                                        (= 配布元を一切叩かない)
 * @param {(url:string, init?:object)=>Promise<Response>} [cfg.fetchImpl]
 *                                        - inject 可能 fetch (= test 用、loader へ転送)
 * @param {Promise<object>|object|null} [cfg.tileCache]
 *                                        - TileCache instance/Promise を inject。
 *                                          省略時は openTileCache() を内部で呼ぶ。
 * @param {Function} [cfg.loaderFactory] - createTerrainLoader を差し替える (= test 用)
 * @returns {{start:Function, subscribe:Function, getStatus:Function, isReady:Function}}
 */
export function createTerrainPhase(cfg) {
  const c = cfg || {};
  const basePath = c.basePath || '';
  const skipTerrain = !!c.skipTerrain;
  const loaderFactory = c.loaderFactory || createTerrainLoader;
  const subscribers = new Set();
  let loader = null;
  let started = false;
  // skip 経路の現 snapshot (= start 前は pending、start 後は done)。
  let skipSnapshot = pendingSnapshot();

  // 現在の status snapshot。skip 経路は合成 snapshot、非 skip は loader 委譲。
  function currentSnapshot() {
    if (skipTerrain) return skipSnapshot;
    if (loader) return loader.getStatus();
    return pendingSnapshot();
  }
  function notify(snap) {
    for (const cb of subscribers) {
      try { cb(snap); } catch (e) { /* subscriber 個別の throw は他に波及させない */ }
    }
  }

  return {
    /** probe を発火。完了は subscribe 経由。多重呼出は no-op (idempotent)。 */
    async start() {
      if (started) return currentSnapshot();
      started = true;
      if (skipTerrain) {
        // ?noterrain=: loader を生成せず (= 配布元を一切叩かない) 即 done へ。
        // notify は await 前なので同期的に発火 = viewer の terrainReady=true も同期で立つ。
        skipSnapshot = skipDoneSnapshot();
        notify(skipSnapshot);
        return skipSnapshot;
      }
      // TileCache: cfg 指定があればそれ、無ければ openTileCache()。失敗は null fallback
      // (= IndexedDB 使えない環境でも probe は動く)。
      const tileCache = c.tileCache != null
        ? c.tileCache
        : openTileCache().catch(() => null);
      const urls = buildTerrainPhaseUrls(basePath);
      loader = loaderFactory({
        courseUrl: urls.courseUrl,
        pmtilesUrl: urls.pmtilesUrl,
        gsiTileBaseUrl: urls.gsiTileBaseUrl,
        // GSI direct base は terrain_loader.js の SoT 定数を渡すだけ (= literal を持たない)。
        gsiDirectBase: GSI_DEM_DIRECT_BASE,
        tileCache,
        fetchImpl: c.fetchImpl,
      });
      // loader の status 変化を phase の subscriber へ転送 (= subscribe 時 immediate emit 含む)。
      loader.subscribe((snap) => notify(snap));
      return loader.start();
    },
    /** UI bind 用。callback は status snapshot を 1 引数で受ける。解除関数を返す。 */
    subscribe(cb) {
      subscribers.add(cb);
      // 初回 immediate emit (= UI 初期化時に現値を反映)。
      try { cb(currentSnapshot()); } catch (e) { /* ignore */ }
      return () => subscribers.delete(cb);
    },
    /** 現在の status snapshot を返す (= subscribe しなくても poll 可)。 */
    getStatus() { return currentSnapshot(); },
    /** 全 step 完了 + error 不在で true。 */
    isReady() {
      const s = currentSnapshot();
      return s.phase === 'done' && !s.error;
    },
  };
}
