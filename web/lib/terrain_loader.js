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
//   3. GSI dem tile x N   (= z=14 で DB bbox 中央付近、 3 枚)
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

// 富士スバルライン DB bbox 中央 (= FUJIHC_DB_CENTER と同値、 viewer-maplibre.js export).
// 重複定義になるが、 ここは terrain_loader の責務単位として独立、 viewer 起動前に
// import される module の循環依存を避ける目的で内製する。
const DB_CENTER_LON = 138.75;
const DB_CENTER_LAT = 35.40;
const GSI_PROBE_Z = 14;

// z=14 の中央タイル + 隣 2 枚 (= 同 z の x±0, y±0 + x+1, y+1) を probe する。
// course の本 ride viewport は z=13..15、 z=14 は典型 9 タイルの中心、 1 枚 fetch 成功すれば
// gsi_dem source が DB として実在することを確認できる軽量 sample。
export function buildGsiProbeUrls(tileBaseUrl, opts = {}) {
  const lon = opts.lon != null ? opts.lon : DB_CENTER_LON;
  const lat = opts.lat != null ? opts.lat : DB_CENTER_LAT;
  const z = opts.z != null ? opts.z : GSI_PROBE_Z;
  const x = lonToTileX(lon, z);
  const y = latToTileY(lat, z);
  // ベース URL の末尾形を viewer の `${STATIC_TILE_BASE_URL}/tiles/gsi_dem/{z}/{x}/{y}.png` /
  // bridge の `${BRIDGE_TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png` の **どちらでも** 動くよう、
  // caller は完成済の prefix (= "tile prefix") を渡す責務を持つ。
  // ここは {z}/{x}/{y}.png を append するだけの薄い formatter.
  return [
    `${tileBaseUrl}/${z}/${x}/${y}.png`,
    `${tileBaseUrl}/${z}/${x + 1}/${y}.png`,
    `${tileBaseUrl}/${z}/${x}/${y + 1}.png`,
  ];
}

// status snapshot を組み立てる純 helper. UI 側 (subscribe callback 内) で都度参照しても
// 整合した値が返るよう、 mutable な内部 state を毎回 freeze 済 object として export する。
function freezeStatus(label, done, total, error) {
  const percent = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  const phase = error
    ? 'failed'
    : done >= total && total > 0
      ? 'done'
      : done > 0
        ? 'loading'
        : 'pending';
  return Object.freeze({ phase, label, percent, done, total, error });
}

/**
 * Terrain loader. 起動直後 1 回 start() を呼び、 全 probe が解決したら ready 状態へ.
 *
 * @param {object} cfg
 * @param {string} cfg.courseUrl        - course.json の URL (= ENV.courseUrl)
 * @param {string} [cfg.pmtilesUrl]     - pmtiles HEAD probe 用 URL (= static mode のみ)、 省略時は skip
 * @param {string} cfg.gsiTileBaseUrl   - GSI dem tile prefix (= `${TILE_BASE}/[tiles/]gsi_dem`)
 * @param {(url:string, init?:object)=>Promise<Response>} [cfg.fetchImpl] - inject 可能 fetch (test 用)
 * @param {object} [cfg.probeOpts]      - buildGsiProbeUrls の opts (= lon/lat/z override)
 * @returns terrain loader instance
 */
export function createTerrainLoader(cfg) {
  const fetchImpl = cfg.fetchImpl || ((url, init) => globalThis.fetch(url, init));
  const subscribers = new Set();
  // 監視対象 step (= 取得元別の label を表示しつつ done 数を加算).
  // step 数の決定: course (1) + pmtiles (0 or 1) + gsi (3)
  const gsiUrls = buildGsiProbeUrls(cfg.gsiTileBaseUrl, cfg.probeOpts || {});
  const usePmtiles = !!cfg.pmtilesUrl;
  let courseDone = false;
  let pmtilesDone = false;
  let gsiDone = 0;
  let error = null;
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
    return freezeStatus(buildLabel(), doneSteps(), totalSteps(), error);
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
  async function probeGsi() {
    // 3 枚を並列 fetch、 1 枚成功で 1 increment.
    const results = await Promise.allSettled(
      gsiUrls.map((u) => fetchImpl(u, { method: 'GET' })),
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        gsiDone += 1;
      } else {
        // GSI tile は欠損があっても全体停止しないように warning 扱いだが、
        // 1 枚も取れなかった場合だけ error に倒す。
      }
    }
    if (gsiDone === 0) {
      error = `GSI dem tile が 1 枚も取得できません (= URL prefix を確認してください)`;
    }
  }

  return {
    /** 全 probe を発火、 完了で notify。 多重呼出は no-op (idempotent). */
    async start() {
      if (started) return snapshot();
      started = true;
      notify();  // pending 状態を最初に通知
      // 各 probe を並列で実行、 各々 notify を 1 回ずつ呼ぶ
      const courseTask = probeCourse().then(() => notify());
      const pmtilesTask = usePmtiles ? probePmtiles().then(() => notify()) : Promise.resolve();
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
