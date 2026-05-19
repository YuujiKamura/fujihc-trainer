---
brief: 26b-first-run-setup-flow
title: 起動直後の DB 構築 UI フロー + 地図ビュー遷移
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [26a-viewer-osm-vector-fix, 17a-tile-server-module, 17b-viewer-tile-endpoint, 14-tile-local-db, 15-gsi-dem-bulk-dl, 16-osm-pmtiles-fetch]
blocks: []
---

# Brief 26b: 起動直後の DB 構築 UI フロー + 地図ビュー遷移

## はじめに

user 訂正: 「最初から地形とか地図とかをDBに保存するっていう話だっただろうが」「起動直後にDB構築をするUI上の表示フローがあるのが普通」「そのあと地図ビューに遷移するだろ普通は」。 現状 viewer 起動 → tile 503/404 → 黒画面、 user 案内ゼロ。 あるべきは 起動 → DB 状態検知 → 不足なら DB 構築 UI → 完走したら従来 pairing flow へ。 brief 26a (= OSM vector style fix) 後に乗る上位 UX 層。

## 何が今足りないか (= 現状)

- `web/viewer-maplibre.js` L204-205: `setAppState('pairing')` を起動直後に無条件で発火、 DB 状態を見ていない。 state 種は `pairing / riding` の 2 つだけ (= `state-checking / state-dbinit` 不在)
- `web/viewer-maplibre.js` L433: `if (TEST_MODE) initTestMode(); else connectBridge();` の起動分岐に DB 検知 step ゼロ
- `web/index.html` L43-49: overlay は `setup-overlay / postride-overlay / confirm-overlay` の 3 種、 `dbinit-overlay` 不在
- `src/fujihc/http_app.py` L17-64: route は `tile / metadata / style / metrics` の 4 種、 setup 状態を返す endpoint 不在 (= viewer から DB の completeness を問い合わせる手段ゼロ)
- `src/fujihc/tile_server.py`: tile 単位の 503 は返すが「いま全体で N/M タイル揃っている」の集計 API 無し
- `scripts/fetch_gsi_dem.py` L66 main(): print に依存、 progress を WS で 1Hz push する形に async 化されていない (= module 再利用不能、 viewer から呼べない)
- `scripts/fetch_osm_pmtiles.py` 同上、 main() に logic 直書きで関数呼び出し不能

## あるべき状態遷移

```
起動
  │
  ▼
state-checking (= GET /tiles/_setup_status)
  │
  ├─ overall=ready ────────────────▶ state-pairing (= 従来 BLE flow)
  │
  └─ overall=empty / partial ───▶ state-dbinit
                                       │
                                       │  user が GSI 自動 fetch / OSM PMTiles 取込 / skip
                                       │  各 source 別の WS dbinit_progress を 1Hz push
                                       │
                                       ▼
                                  全 source ready or user が skip
                                       │
                                       ▼
                                  state-pairing (= 従来 BLE flow)
                                       │
                                       ▼
                                  state-riding
```

source 別進捗:
- `gsi_dem`: status (= ready / empty / partial) + tiles_present / tiles_expected (= 36)
- `osm`: status + tiles_present / tiles_expected (= 300、 brief 14 中央定数の `enumerate_coverage_tiles(course, OSM_VECTOR_ZOOMS, 3)` から算出)

## 実装設計

### A. bridge 側: setup_status endpoint

`src/fujihc/http_app.py` の `make_http_app` に route 追加、 logic は `src/fujihc/tile_server.py` に pure function で実装。

- 新 route: `GET /tiles/_setup_status` を `app.router.add_get` で mount (= L60-63 の隣)
- 新 pure function (tile_server.py): `get_setup_status(db_path, course_path) -> (status: int, dict | None)`
  - 各 source について `enumerate_coverage_tiles(course, GSI_DEM_ZOOMS / OSM_VECTOR_ZOOMS, DEFAULT_CORRIDOR_TILES)` で expected set を計算
  - DB の `tiles` 表で `source` 別に `COUNT(*) WHERE fetch_status=200 AND data IS NOT NULL` で present を計算
  - source 別 status: `tiles_present == 0` → empty / `< tiles_expected` → partial / `== tiles_expected` → ready
  - overall: 全 source ready → ready / 全 source empty → empty / 中間 → partial
- response 形式:
  ```json
  {
    "sources": {
      "gsi_dem": {"status": "ready", "tiles_present": 36, "tiles_expected": 36},
      "osm":     {"status": "empty", "tiles_present": 0,  "tiles_expected": 300}
    },
    "overall": "partial"
  }
  ```
- 503 (= DB 不在) は従来 contract と同じ、 viewer は同じく `state-dbinit` に遷移
- course path は `make_http_app(db_path, course_path)` の引数追加で bridge.py から渡す (= magic path 排除)

### B. bridge 側: GSI 自動 fetch endpoint

`scripts/fetch_gsi_dem.py` の main() を `src/fujihc/dbinit.py` (新規 module) に切り出し、 scripts は薄い CLI wrapper に。

- 新 module `src/fujihc/dbinit.py`:
  ```python
  async def fetch_gsi_async(db_path, course, zoom, corridor_tiles, rate_limit_sec, user_agent,
                            progress_cb=None) -> dict:
      """fetch_gsi_dem.main() の logic を async 化、 1 タイル fetch ごとに progress_cb({n, total}) を呼ぶ.
      return: {fetched: int, skipped: int, errors: int, total: int}
      """
  ```
  - `urllib.request` 同期呼出は `asyncio.to_thread(fetch_one, ...)` で wrap、 既存 rate_limit (= 1 req/sec) はそのまま
- 新 route: `POST /tiles/_fetch_gsi` body `{}` で発火、 内部で `fetch_gsi_async(..., progress_cb=ws_push)` を spawn、 即座に 202 Accepted
- WS push message 形式: `{"type": "dbinit_progress", "source": "gsi_dem", "n": 12, "total": 36, "phase": "fetching"}`、 完走時 `"phase": "done"`
- 中央定数: `GSI_DEM_ZOOMS[0]` (= 14)、 `GSI_RATE_LIMIT_SEC` (= 1.0)、 `DEFAULT_CORRIDOR_TILES` (= 3) を tile_constants から import、 magic 化禁止
- `scripts/fetch_gsi_dem.py` 側は `argparse` + `asyncio.run(fetch_gsi_async(...))` の薄い wrapper にして既存 CLI 互換維持

### C. bridge 側: OSM PMTiles 取り込み endpoint

- 同様に `scripts/fetch_osm_pmtiles.py` の main() を `src/fujihc/dbinit.py` の `extract_osm_async(db_path, pmtiles_path, course, zooms, corridor_tiles, progress_cb=None) -> dict` に分離
- 新 route: `POST /tiles/_extract_osm` body `{"pmtiles_path": "..."}` で発火、 同様 202 + WS push
- WS push: `{"type": "dbinit_progress", "source": "osm", "n": 120, "total": 300, "phase": "extracting"}`
- pmtiles path は user 入力、 path traversal 防止のため `Path(p).resolve()` で正規化 + 存在 check のみ (= 任意位置許可、 ローカル運用前提)

### D. viewer 側: 状態機械拡張

- `web/viewer-maplibre.js` L204-205 の `setAppState` 関数はそのまま、 呼び出し側で `'checking' / 'dbinit'` の 2 state を追加
- 起動分岐 L433 を以下に置換:
  ```js
  if (TEST_MODE) {
    initTestMode();  // checking skip、 従来通り
  } else {
    setAppState('checking');
    checkSetupStatus().then(s => {
      if (s.overall === 'ready') connectBridge();
      else                       initDbInit(s);  // setAppState('dbinit') + overlay 開く
    });
  }
  ```
- `checkSetupStatus()` = `fetch('/tiles/_setup_status')` → 200 なら body parse、 503 なら `{overall: 'empty', sources: {}}` に正規化
- 既存 `state-pairing / state-riding` の CSS 表示制御 (= index.html L11-13) と同型で `body.state-checking #map { ... }` と `body.state-dbinit #dbinit-overlay { display: flex }` を追加

### E. viewer 側: dbinit-overlay 新規

- `web/index.html`: `<div id="dbinit-overlay">` を `setup-overlay` の直下に新規追加 (= BLE と責務混合は NG-R1-3 / NG-R1-7 再演、 独立 DOM)
- 中身:
  - source 別進捗バー (= `<div id="dbinit-gsi-bar"><span class="fill"></span> 12/36</div>` × 2)
  - 「GSI 標高 36 タイルを取得 (約 36 秒)」 button (`#btnFetchGsi`) → `POST /tiles/_fetch_gsi`
  - 「OSM ベクトル PMTiles 取り込み」 path input (`#osmPmtilesPath`) + button (`#btnExtractOsm`) → `POST /tiles/_extract_osm`
  - 「skip (地形のみで進む)」 button (`#btnDbinitSkip`) → 直接 `connectBridge()` 呼ぶ
  - 完走時自動: setup_status 再 GET で overall=ready なら `connectBridge()` 自動遷移
  - cancel button (`#btnDbinitCancel`) は本 brief 範囲外 (= async task の cancel 機構は phase 2)
- `web/viewer-maplibre.js` の `wsHandlers` に dbinit_progress 追加:
  ```js
  dbinit_progress(msg) {
    const bar = document.getElementById(`dbinit-${msg.source}-bar`);
    if (!bar) return;
    bar.querySelector('.fill').style.width = `${100 * msg.n / msg.total}%`;
    bar.querySelector('.label').textContent = `${msg.n}/${msg.total}`;
    if (msg.phase === 'done') maybeAdvanceToPairing();
  }
  ```
- `maybeAdvanceToPairing()` = setup_status 再 GET → ready なら `connectBridge()` を 1 回だけ呼ぶ (= idempotent flag で再入防止)

### F. test 戦略

backend (pytest):
1. `tests/test_setup_status.py` 5-6 件: 空 DB → empty / 36 GSI のみ → partial / 全揃 → ready / 不正 source → 400 / DB 不在 → 503 / 部分 GSI (10/36) → partial
2. `tests/test_dbinit_module.py` 6-8 件: `fetch_gsi_async` の progress_cb が n=0..N で呼ばれる / 既存 tile は skip / rate_limit 守る (= mock clock) / 404 は fetch_status=404 で行残す / `extract_osm_async` happy / PMTiles 不在 → IOError

frontend (vitest):
3. `web/tests/setApp_state.test.js` 4 件: `setAppState('checking')` で body class / 'dbinit' で同 / setup_status=ready で connectBridge 呼ばれる / empty で initDbInit 呼ばれる (= module 切り出した state machine 関数を test)
4. `web/tests/dbinit_overlay.test.js` 5 件: dbinit-overlay の DOM 構造 grep gate (= `dbinit-gsi-bar` / `dbinit-osm-bar` / `btnFetchGsi` / `btnExtractOsm` / `btnDbinitSkip` の 5 要素 id 存在 + クラス独立性 = `setup-overlay` 内に dbinit 要素が混入していないこと)
5. `web/tests/ws_dispatch.test.js` 3 件: dbinit_progress msg で bar 進捗更新 / phase=done で maybeAdvanceToPairing 呼ばれる / 不明 source は no-op

integration:
6. `tests/test_setup_status_curl.py` 1 件: bridge 起動 + 空 DB で `curl /tiles/_setup_status` → `{"overall": "empty", ...}` (= 既存 `test_ws_smoke.py` と同層)

合計 約 25-29 件、 既存 pytest + npm 全 green を維持。

## 数値見積もり

- GSI 自動 fetch: 36 タイル × 1 req/sec = **約 36 秒** (= brief 14 中央定数 `GSI_RATE_LIMIT_SEC=1.0` × `enumerate_coverage_tiles(course, [14], 3)` = 36 タイル)
- OSM PMTiles 取り込み: 300 タイル × PMTiles random access 1 タイル ~10 ms = **約 3 秒** (= ファイル内 read、 外部 fetch ゼロ)
- 起動 → DB ready 判定: setup_status endpoint = SQLite COUNT × 2 source + coverage 列挙 (= 既に in-memory) = **< 100 ms**
- 起動 → state-checking → state-pairing 遷移時間 (= overall=ready ケース): **< 1 秒** (= fetch 1 回 + state 切替)
- 起動 → state-dbinit 遷移時間 (= overall=empty ケース): **< 1 秒** (= 同上 + overlay display)
- DB サイズ: GSI 36 × 30KB + OSM 300 × 50KB = **約 16 MB** (= brief 14 見積もりと一致、 変動なし)

## やらないこと

- Protomaps PMTiles の **自動 DL** (= 数 GB、 Rule 10 / 11 C1 gate が必要、 別 brief 27 で安全 gate 確定後 user 認可 per-action 必須)
- 26a で fix する OSM vector style 修正 (= 別 brief)
- BLE setup flow の改修 (= 既存 `setup-overlay` は手付かず、 dbinit-overlay は完全独立 DOM)
- ride history / Strava export 連携 (= phase 2)
- async task の cancel / 中断 (= 一旦 fire-and-forget、 user は browser reload で中断、 phase 2 で cancel token)
- DB 部分破損 (= row 存在するが fetch_status=200 で data=NULL 等) の自動修復 (= 検知だけ、 修復は user が再 fetch 押す)
- WS reconnect 中の dbinit_progress 取りこぼし (= 完走時に setup_status 再 GET で整合確認、 phase 2 で session replay)
- 503 fallback DOM の独立化 (= brief 28 候補)

## 完了条件

1. `src/fujihc/tile_server.py` に `get_setup_status` 追加 (+30 行)
2. `src/fujihc/http_app.py` に `/tiles/_setup_status` + `/tiles/_fetch_gsi` + `/tiles/_extract_osm` の 3 route 追加 (+40 行)、 `make_http_app(db_path, course_path)` に引数追加
3. `src/fujihc/dbinit.py` 新規 (+120 行)、 `fetch_gsi_async` / `extract_osm_async` 2 関数 export
4. `scripts/fetch_gsi_dem.py` / `scripts/fetch_osm_pmtiles.py` を薄い CLI wrapper に短縮 (= main() が `asyncio.run(...)` 呼ぶだけ、 各 30 行以内)
5. `web/index.html` に `<div id="dbinit-overlay">` 新規 (+40 行)、 既存 overlay 群と CSS 独立
6. `web/viewer-maplibre.js` の起動分岐 L433 を `checkSetupStatus` + `initDbInit` に置換 (+50 行)、 `wsHandlers.dbinit_progress` 追加 (+10 行)
7. test 約 25-29 件 全 green (= pytest 既存 130+ 件 + 新規 12-15 件、 vitest 既存 168+ 件 + 新規 12-14 件)
8. 物理 grep gate (= dbinit-overlay 内 5 要素 id / setup-overlay 内 dbinit 要素ゼロ / `body.state-dbinit` CSS 規則 1 件以上)
9. 既存 `test_ws_smoke.py` / `test_tile_server.py` / `test_http_app.py` 不変
10. ローカル commit のみ、 push しない

## ハマる罠

- **NG-R1-3 再演**: dbinit / setup / pairing / fetch / extract が用語混在しやすい。 dbinit = DB 構築 step (= setup_status / fetch_gsi / extract_osm の総称)、 setup = BLE pairing flow (= 既存)、 これ以外の qualifier 禁止。 関数名 / id / state 名で統一
- **NG-R1-7 再演**: `wsHandlers` に dbinit_progress 系を inline でベタ書きすると 6 ハンドラ目で関数肥大、 単独関数 `handleDbinitProgress(msg)` に切り出して wsHandlers から呼ぶ
- **NG-R1-8 再演**: 「実走で確認」だけは NG、 setup_status / fetch_gsi_async / dbinit-overlay DOM 全部 unit test 必須。 frontend は vitest、 backend は pytest、 integration は curl で 1 件
- **NG-R1-12 再演**: WS message dbinit_progress を viewer body 直書きすると ws.send 散在の同型再演、 既存 `web/lib/bridge_client.js` の handler dispatch を経由
- **起動時 race**: setup_status fetch が完了する前に user が画面操作 → 既存 `setAppState('pairing')` が initial で発火していると flicker、 index.html L99 の `class="state-pairing"` を `class="state-checking"` に変更 (= initial state は checking 固定)
- **WS 接続前の progress push**: bridge 起動直後に POST /tiles/_fetch_gsi が来ると WS client が未接続で push 行き先なし → fetch_gsi_async の progress_cb は WS 接続済 client 一覧に対する broadcast、 接続ゼロなら no-op、 完走時の setup_status 再 GET で進捗を救う
- **既存 setup-overlay との順序**: dbinit-overlay は `z-index: 1400`、 setup-overlay (= 1500) より下、 confirm-overlay (= 1700) より下。 state-dbinit 中は body class で setup-overlay を `display: none` 強制 (= 排他)、 mix 表示禁止
- **abort 時の state ロールバック**: user が `#btnDbinitSkip` 押した時、 setAppState('pairing') に遷移するが dbinit-overlay は閉じる必要あり (= `classList.remove('visible')`)、 これを忘れると skip 後も overlay 残留
- **NG-R3-3 再演**: `dbinit.py` 内で SCHEMA_VERSION や zoom 値をローカル再定義するな、 必ず `tile_constants` から import
- **第三者 ToS (NG-R1-15/16)**: 自動 fetch は GSI のみ (= ToS が rate_limit 1 req/sec を許可、 既存 brief 15 で安全側)、 OSM 直叩きは絶対追加するな、 PMTiles ファイル経由のみ。 brief 26b でも OSM endpoint を増やすことは無い

## まとめ

ship される: 起動 → DB 状態検知 → 不足なら dbinit-overlay で GSI 自動 fetch / OSM PMTiles 取り込みを user 操作 → 完走で従来 pairing flow → riding に滑らかに遷移、 黒画面ゼロ。
ship されない: PMTiles 自動 DL、 OSM 直叩き、 async task cancel、 BLE flow 改修、 ride history。

## 次の atom

- brief 27 候補: Protomaps PMTiles URL 自動 DL の Rule 10 / 11 安全 gate (= user per-action 認可 flow / DL 上限警告 / hash 検証)
- brief 28 候補: 503 fallback DOM の独立 overlay 化 (= 現状 dbinit-overlay と一部責務重複、 503 検知時に dbinit に流すか別 overlay か分離判断)
- brief 29 候補: dbinit async task の cancel token 化 (= phase 2、 user が「やめる」押した時に urllib request を mid-flight abort)
