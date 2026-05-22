// brief 34 ε-9: 地形データ準備 loader.
//
// 目的: viewer 起動直後に「コースを走り出すための地形 / コースデータが揃っているか」を
// 確認する物理 gate。 揃う前は intro / 観る / setup 系の全アクションボタンを disabled、
// 揃ったら enabled。 中途半端な地図で走り出す事故 (= 過去訂正 2026-05-14T12:19 の同型) を
// 構造的に止めるための前段。
//
// 監視対象は **既存 viewer の fetch 経路を再利用** (= 新規 endpoint 追加なし):
//   1. course.json       (= bridge / static 共通、 ENV.courseUrl 経由)
//   2. map.pmtiles HEAD   (= static mode のみ、 bridge mode は trivially OK で skip)
//   3. GSI dem tile x N   (= z=15 dem5a で DB bbox 中央付近、 3 枚)
//
// b69 (= タイルを IndexedDB のみで保持する方針徹底) で、 DEM タイル取得 chain から
// static/bridge 配信経路 (= 旧 `cfg.gsiTileBaseUrl`) を撤去した。 現在は IndexedDB
// (= TileCache、 `tile_cache.js`) → GSI 直 (= GSI_DEM_DIRECT_BASE) の 2 段。 既存 tileCache
// 保存データ (= TTL 内) はそのまま hit、 miss だけが GSI 直に流れる。
//
// 設計:
// - status は { phase, label, percent, done, total, error } の immutable snapshot.
// - subscribe(cb) で UI に reactive bind、 step 進む / 完了 / 失敗で cb 発火。
// - 失敗時 (= 404 / network) は terrainReady を false のままにし、 error を status に
//   保持 (= UI で赤表示 + リトライ button 提示の足場、 ただし本 commit ではリトライ UI は
//   出さず status text 表示のみ、 user は reload で対処)。
// - fetch は inject 可能 (= test 環境で mock、 prod は globalThis.fetch).
// - z=14 の x/y は viewer の lonToTileX/latToTileY と同じ tile_math 経由で計算するが、
//   ここでは loader が独立して使える形で内製 (= 小規模 lib なので循環依存回避).

// b12 Phase 1: 富士ヒル固有値 (DB 中央座標) は courses/fujihill.js に集約済。
// fujihill.js は何も import しない純データなので循環依存は発生しない。
import { fujihill } from '../courses/fujihill.js';

// b31/b59: GSI dem の公式 endpoint (= dem5a_png 256x256、 国土地理院 地理院タイル一覧)。
// Pages 環境で同梱 tile が無い時の fallback 取得元 (= 訪問者単位 fetch + TileCache 90 日 TTL)。
// viewer-maplibre.js / map3d/index.js は本 constant を import して渡す (= literal を本体 source に
// 書かない、 viewer_url_audit.test.js の単体 scan は本体に GSI URL 出現ゼロを引き続き保証)。
// b59: `dem5a_png` (= 5mメッシュ、 z15 が native 上限) を使う。 viewer は PNG bytes として
// decode する経路 (= tile_loader3d.js bytesToBitmap)、 txt 形式の `dem` に `.png` 拡張子を
// 付けても GSI は 404 を返す (= b31 で dem_png に直した root cause)。 b59 で地形高精細化の
// ため dem_png (z1-14) から dem5a_png (z15) へ。 両者は同一の標高 PNG エンコード。
export const GSI_DEM_DIRECT_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/dem5a_png';

// b67: GSI dem_png 公式 endpoint (= z0-14 配信)。 広域低精細メッシュ (b67 §直すこと 4) で
// 使う ── コース外接 (demBounds) は z15 dem5a_png で高精細、 その外周 (dbBounds 22km四方)
// を z12 dem_png で粗く埋めて富士山体の全景を背景にする。 dem_png と dem5a_png は同一の
// 標高 PNG エンコード (= decodeGsiHeightGrid 共通)、 違うのは zoom range のみ:
//   dem5a_png: z9-15 (5m メッシュ)、 z15 で 96 tiles / demBounds
//   dem_png  : z0-14 (10m メッシュ相当)、 z12 で 12 tiles / dbBounds
// SoT を terrain_loader.js に集約することで viewer 本体・map3d/index.js には GSI URL literal
// が出現せず、 viewer_url_audit.test.js の「本体 source に GSI URL ゼロ」 方針が維持される。
export const GSI_DEM_PNG_DIRECT_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png';

// 経度・緯度 → z=14 タイル座標 (= 整数). EPSG:3857 Web Mercator.
// tile_math.js と同等、 ただし z=14 固定でも汎用に z を受け取る.
function lonToTileX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}
function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, z),
  );
}

// DB bbox 中央 = コース定義の dbCenter。 viewer / terrain_loader / zoom_bounds が
// 同じ 1 個の定義 (courses/fujihill.js) を参照する (= 重複定義の撤去、 b12 Phase 1)。
// 値は従来の inline literal (138.75 / 35.40) と完全同一、 動作は不変。
const DB_CENTER_LON = fujihill.dbCenter[0];
const DB_CENTER_LAT = fujihill.dbCenter[1];
// b59: probe zoom は DEM 取得 zoom (= GSI_DEM_ZOOMS / tile_loader3d.js DEM_ZOOM) と
// 必ず一致させる。 ずれると Python prefetch 済の DB に無いタイルを probe して全 miss し、
// terrainReady が永遠 false になり viewer がローダー画面で停止する。 dem5a z15 に統一。
const GSI_PROBE_Z = 15;

// z=15 の中央タイル + 隣 2 枚 (= 同 z の x±0, y±0 + x+1, y+1) を probe する。
// 1 枚でも fetch 成功すれば gsi_dem source が DB として実在することを確認できる軽量 sample。
//
// b31: buildGsiProbeCoords を分離 (= probe 経路の IndexedDB chain で z/x/y が必要)。
// b69: buildGsiProbeUrls の引数を GSI 直 base に固定 (= static/bridge 配信経路を撤去、
// chain は IndexedDB → GSI 直の 2 段に統一)。
export function buildGsiProbeCoords(opts = {}) {
  const lon = opts.lon != null ? opts.lon : DB_CENTER_LON;
  const lat = opts.lat != null ? opts.lat : DB_CENTER_LAT;
  const z = opts.z != null ? opts.z : GSI_PROBE_Z;
  const x = lonToTileX(lon, z);
  const y = latToTileY(lat, z);
  return [
    { z, x, y },
    { z, x: x + 1, y },
    { z, x, y: y + 1 },
  ];
}
export function buildGsiProbeUrls(gsiDirectBase, opts = {}) {
  // b69 で GSI 直 base 1 引数に統一。 caller は `GSI_DEM_DIRECT_BASE` (= dem5a_png) を渡す責務。
  // ここは {z}/{x}/{y}.png を append するだけの薄い formatter。
  return buildGsiProbeCoords(opts).map(({ z, x, y }) => `${gsiDirectBase}/${z}/${x}/${y}.png`);
}

// status snapshot を組み立てる純 helper. UI 側 (subscribe callback 内) で都度参照しても
// 整合した値が返るよう、 mutable な内部 state を毎回 freeze 済 object として export する。
//
// brief 34 ε-10: rangeWarning を追加. pmtiles 配信 server が HTTP Range request 非対応
// (= status 200 or 416) の場合に warn 文字列 (= UI に「⚠ サーバが Range request 非対応…」
// として表示)。 terrainReady には影響しない (= warn 専用、 fatal ではない)。
function freezeStatus(label, done, total, error, rangeWarning) {
  const percent = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  const phase = error
    ? 'failed'
    : done >= total && total > 0
      ? 'done'
      : done > 0
        ? 'loading'
        : 'pending';
  return Object.freeze({ phase, label, percent, done, total, error, rangeWarning: rangeWarning || null });
}

/**
 * Terrain loader. 起動直後 1 回 start() を呼び、 全 probe が解決したら ready 状態へ.
 *
 * @param {object} cfg
 * @param {string} cfg.courseUrl        - course.json の URL (= ENV.courseUrl)
 * @param {string} [cfg.pmtilesUrl]     - pmtiles HEAD probe 用 URL (= static mode のみ)、 省略時は skip
 * @param {string} cfg.gsiDirectBase    - GSI direct base (= `GSI_DEM_DIRECT_BASE`、
 *                                        例 `https://cyberjapandata.gsi.go.jp/xyz/dem5a_png`)。
 *                                        b69 で必須化、 chain は IndexedDB → GSI 直の 2 段。
 * @param {Promise<object>|object|null} [cfg.tileCache] - TileCache instance (or its Promise)
 *                                        (= openTileCache() の戻り)。 指定時は hit/miss/set を経由。
 *                                        未指定なら GSI 直のみ (= cache 効かないが probe 自体は動く)。
 * @param {(url:string, init?:object)=>Promise<Response>} [cfg.fetchImpl] - inject 可能 fetch (test 用)
 * @param {object} [cfg.probeOpts]      - buildGsiProbeUrls の opts (= lon/lat/z override)
 * @returns terrain loader instance
 */
export function createTerrainLoader(cfg) {
  const fetchImpl = cfg.fetchImpl || ((url, init) => globalThis.fetch(url, init));
  const subscribers = new Set();
  // 監視対象 step (= 取得元別の label を表示しつつ done 数を加算).
  // step 数の決定: course (1) + pmtiles (0 or 1) + gsi (3)
  const gsiDirectBase = cfg.gsiDirectBase || null;
  const gsiUrls = gsiDirectBase
    ? buildGsiProbeUrls(gsiDirectBase, cfg.probeOpts || {})
    : [];
  const gsiCoords = buildGsiProbeCoords(cfg.probeOpts || {});
  // TileCache は Promise / instance / null を受ける、 内部で await して chain 経路の hit/miss を判定。
  // null / undefined なら cache は使わず GSI 直のみで動く (= probe 自体は通る)。
  const tileCachePromise = cfg.tileCache != null
    ? Promise.resolve(cfg.tileCache).catch(() => null)
    : Promise.resolve(null);
  const usePmtiles = !!cfg.pmtilesUrl;
  let courseDone = false;
  let pmtilesDone = false;
  let gsiDone = 0;
  let error = null;
  // brief 34 ε-10: pmtiles 配信 server が Range request 非対応の場合の warn (= null / string).
  // terrainReady には影響しないため error とは別管理 (= warn 専用、 UI 表示のみ).
  let rangeWarning = null;
  let started = false;

  // step 数の決め方:
  //   - course.json (1)
  //   - pmtiles (0 or 1)
  //   - GSI (1 group): probe 3 枚のうち 1 枚でも成功すれば「ok」、 0 枚なら error.
  //   GSI を 3 step 換算にすると「1 枚 404 だが他 2 枚 ok」で done に至らず block されてしまう、
  //   実用上は 1 枚でも load 出来れば視点を起こせるので部分許容する設計。
  function totalSteps() {
    return 1 + (usePmtiles ? 1 : 0) + 1;  // course + pmtiles? + gsi-group
  }
  function gsiGroupDone() {
    return gsiDone > 0 ? 1 : 0;
  }
  function doneSteps() {
    return (courseDone ? 1 : 0) + (usePmtiles && pmtilesDone ? 1 : 0) + gsiGroupDone();
  }
  function buildLabel() {
    const parts = [];
    parts.push(`course.json ${courseDone ? '✓' : '...'}`);
    if (usePmtiles) parts.push(`pmtiles ${pmtilesDone ? '✓' : '...'}`);
    parts.push(`GSI 標高 ${gsiDone}/${gsiUrls.length}`);
    return parts.join(' | ');
  }
  function snapshot() {
    return freezeStatus(buildLabel(), doneSteps(), totalSteps(), error, rangeWarning);
  }
  function notify() {
    const snap = snapshot();
    for (const cb of subscribers) {
      try { cb(snap); } catch (e) { /* subscriber 個別の throw は他に波及させない */ }
    }
  }

  async function probeCourse() {
    try {
      const resp = await fetchImpl(cfg.courseUrl, { method: 'GET' });
      if (!resp || !resp.ok) throw new Error(`course.json HTTP ${resp ? resp.status : 'no response'}`);
      // body は読まない (= viewer 側 loadCourse() で本格 parse、 ここは存在確認のみ)
      // ただし test 環境では Response 互換 mock が arrayBuffer 等を提供する場合がある。
      // 「fetch ok = 取得可能」と判定するだけで十分。
      courseDone = true;
    } catch (e) {
      error = `course.json 取得失敗: ${e.message || e}`;
    }
  }
  async function probePmtiles() {
    if (!usePmtiles) return;
    try {
      // HEAD で header 数百 byte だけ確認 (= pmtiles file の存在 + 配信可否).
      // server が HEAD 非対応なら GET + Range: bytes=0-127 で fallback 可だが、
      // 本 commit では HEAD 一段だけ (= GitHub Pages / 通常の static server は HEAD 対応).
      const resp = await fetchImpl(cfg.pmtilesUrl, { method: 'HEAD' });
      if (!resp || !resp.ok) throw new Error(`pmtiles HTTP ${resp ? resp.status : 'no response'}`);
      pmtilesDone = true;
    } catch (e) {
      error = `pmtiles 取得失敗: ${e.message || e}`;
    }
  }
  // brief 34 ε-10: pmtiles は Range request (HTTP Byte Serving) 前提で読まれる (= pmtiles.js
  // 内部の getBytes が `Range: bytes=X-Y` を発火、 server が 206 Partial Content を返すこと
  // が必要)。 server が Range 非対応 (= python -m http.server) の場合、 HEAD probe は ok でも
  // 実 map 描画時に「Server returned no content-length header」 error で失敗する。
  // この経路を ε-9 ready gate の手前で検出するために、 pmtiles HEAD probe 成功後に短い
  // Range probe を 1 度試して、 結果を warn として UI に表示する (= terrainReady は変えない、
  // user に「地図描画が機能しない可能性」を伝える)。
  async function probePmtilesRange() {
    if (!usePmtiles || !pmtilesDone) return;
    try {
      const resp = await fetchImpl(cfg.pmtilesUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-127' },
      });
      if (!resp) return;  // 何も返らない場合は warn せず silent (= 環境固有 mock の安全側)
      if (resp.status === 206) {
        // Partial Content: server が Range を尊重 → ok、 warn 不要.
        return;
      }
      if (resp.status === 200) {
        // 200: server が Range header を無視して全 body 返却 → Range 非対応.
        rangeWarning = '⚠ サーバが Range request 非対応 (= 200 で全 body 返却)、 地図描画が機能しない可能性';
        return;
      }
      if (resp.status === 416) {
        // 416 Range Not Satisfiable: server は Range 知ってるが要求 range が範囲外 →
        // file size が 128 byte 未満等の異常、 ただし server 自体は Range 対応している可能性あり。
        // pmtiles ファイルが正常なら 1MB+ で 416 にはならない、 file 異常の警告.
        rangeWarning = '⚠ pmtiles file への Range request が 416 (= file 異常 or 範囲外)、 地図描画が機能しない可能性';
        return;
      }
      // それ以外 (= 4xx/5xx with non-416): 通常 fetch でも失敗するはず、 warn のみ.
      rangeWarning = `⚠ pmtiles Range probe HTTP ${resp.status} (= 地図描画が機能しない可能性)`;
    } catch (e) {
      // network error 等: silent (= 既存 HEAD probe success の延長で出る軽量 probe、
      // ここで warn を出すと false-positive 多発するため敢えて silent).
    }
  }
  // b69: probe 1 枚分の chain 経路 = TileCache hit → GSI 直 fetch → cache.set の 2 段。
  // 旧 bridge 段 (= `cfg.gsiTileBaseUrl` 経由) は撤去済 (= 配信物への DEM 同梱を生成する経路を止めた)。
  async function probeSingleTileWithChain({ z, x, y }, cache) {
    // 1. TileCache hit
    if (cache) {
      try {
        const hit = await cache.get('dem_png', z, x, y);
        if (hit) return true;
      } catch { /* cache 失敗は silent skip、 直 fetch に fall back */ }
    }
    // 2. GSI direct fetch
    if (gsiDirectBase) {
      const url = `${gsiDirectBase}/${z}/${x}/${y}.png`;
      const r = await tryFetchWithRetry(url);
      if (r.ok) {
        if (cache && r.bytes) {
          try { await cache.set('dem_png', z, x, y, r.bytes); } catch {}
        }
        return true;
      }
    }
    return false;
  }

  // b31: AbortController で 5 秒タイムアウト + 1 回 retry (= probe の resilience).
  // fetch impl の Response が arrayBuffer を持たない test 環境では bytes=null になるが
  // probe 成功判定 (= return true) には影響しない (= cache.set は bytes 必須なので skip)。
  async function tryFetchWithRetry(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const init = { method: 'GET' };
        // AbortController が利用可能なら timeout 設定 (= test 環境では未定義の場合あり)
        let timer = null;
        if (typeof AbortController !== 'undefined') {
          const controller = new AbortController();
          init.signal = controller.signal;
          timer = setTimeout(() => controller.abort(), 5000);
        }
        const resp = await fetchImpl(url, init);
        if (timer) clearTimeout(timer);
        if (resp && resp.ok) {
          let bytes = null;
          if (resp.arrayBuffer) {
            try { bytes = new Uint8Array(await resp.arrayBuffer()); } catch {}
          }
          return { ok: true, bytes };
        }
        // ok=false (= 404 等) は retry 不要、 即座に次の経路へ
        return { ok: false };
      } catch {
        // timeout / network error → 1 回 retry (= attempt 0 のみ)、 2 回目は諦め
      }
    }
    return { ok: false };
  }

  async function probeGsi() {
    const cache = await tileCachePromise;
    if (!gsiDirectBase) {
      // gsiDirectBase 未指定 = chain が GSI 直に到達できないため probe 失敗扱い。
      // (= 通常運用では terrain_phase.js が `GSI_DEM_DIRECT_BASE` を渡すので発生しない)
      error = `GSI dem tile が 1 枚も取得できません (= gsiDirectBase 未指定)`;
      return;
    }
    // b69 chain: TileCache hit → GSI 直 fetch → tileCache.set の 2 段。
    // 3 枚を並列 probe (= 既存 Promise.allSettled 設計の踏襲、 並列度 3 < GSI_FETCH_LIMIT=6).
    const results = await Promise.allSettled(
      gsiCoords.map((c) => probeSingleTileWithChain(c, cache)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        gsiDone += 1;
      }
    }
    if (gsiDone === 0) {
      error = `GSI dem tile が 1 枚も取得できません (= GSI 直叩きに失敗)`;
    }
  }

  return {
    /** 全 probe を発火、 完了で notify。 多重呼出は no-op (idempotent). */
    async start() {
      if (started) return snapshot();
      started = true;
      notify();  // pending 状態を最初に通知
      // 各 probe を並列で実行、 各々 notify を 1 回ずつ呼ぶ.
      // brief 34 ε-10: pmtiles の Range probe は HEAD probe 成功後 (= sequence) に走らせる.
      // 失敗時の rangeWarning は warn 専用で terrainReady を切らないため、 done 推移とは別 lane.
      const courseTask = probeCourse().then(() => notify());
      const pmtilesTask = usePmtiles
        ? probePmtiles().then(() => probePmtilesRange()).then(() => notify())
        : Promise.resolve();
      const gsiTask = probeGsi().then(() => notify());
      await Promise.all([courseTask, pmtilesTask, gsiTask]);
      // 最終 notify (= 全 step 終了で done に推移、 subscriber に最終 snapshot を保証).
      notify();
      return snapshot();
    },
    /** 現在の status snapshot を返す (= subscribe しなくても poll 可). */
    getStatus() { return snapshot(); },
    /** terrainReady を bool で返す (= 全 step 完了 + error 不在). */
    isReady() {
      const s = snapshot();
      return s.phase === 'done' && !s.error;
    },
    /** UI bind 用. callback は status snapshot を 1 引数で受ける。 解除関数を返す。 */
    subscribe(cb) {
      subscribers.add(cb);
      // 初回 immediate emit (= UI 初期化時に現値を反映).
      try { cb(snapshot()); } catch {}
      return () => subscribers.delete(cb);
    },
  };
}
