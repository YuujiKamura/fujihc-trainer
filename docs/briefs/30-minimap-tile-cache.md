---
brief: 30-minimap-tile-cache
title: minimap タイルを起動時 1-shot で DB cache 化 (= OSM 直叩き → DB 保存、 2 回目以降 cache hit)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [14-tile-local-db, 15-gsi-dem-bulk-dl, 16-osm-pmtiles-fetch, 17a-tile-server-module, 17b-viewer-tile-endpoint, 26b-first-run-setup-flow, 29-minimap-osm-direct]
blocks: []
---

# Brief 30: minimap タイルを起動時 1-shot で DB cache 化

## はじめに

user 訂正 (= 引用):

> いっとくけどミニマップも事前フェッチして DB に登録するようにしろ。 キャッシュが効くように

経緯整理:

- brief 29 で minimap を旧 OSM 直叩き方式 (= z=11 周辺 9-16 タイル / canvas drawImage、 起動時 1-shot) に rollback、 ToS 範囲内ではあるが viewer 起動ごとに OSM タイルサーバへ毎回 fetch する形になっている。
- main viewer (= brief 14-17 で landed) は GSI dem / OSM vector PBF を SQLite DB に事前格納し `${TILE_BASE_URL}/...` 経由で読む構造で、 起動ごとに外部 fetch ゼロ。 minimap だけがこの cache から外れている状態。
- user 判断: minimap も同じ DB cache pattern に揃える。 起動時 1 回だけ OSM タイルサーバから raster PNG を fetch して `tiles` table に新 source `osm_raster` で保存、 2 回目以降は viewer が `${TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png` で DB から読む。 結果 OSM サーバへの再 fetch ゼロ、 offline 動作可、 個人配布時にも安全。
- brief 26b の dbinit pattern (= /tiles/_setup_status + WS dbinit_progress + bridge async fetch) を踏襲、 既存 GSI / OSM (vector) と並列の 3 つ目の source として追加する。

本 brief の責務は「minimap raster タイル (= osm_raster) を `osm` / `gsi_dem` と同格の DB source として加え、 viewer の minimap base 構築を `/tiles/osm_raster/...` 経由に切り替え、 起動時に未取得分を自動 fetch して DB cache に流す」の 1 点のみ。 main viewer の OSM vector PBF source は不変、 prefetchTilesAlongCourse 復活絶対 NG、 bridge bind 0.0.0.0 化絶対 NG。

## 何が今足りないか (= 現状)

- `web/viewer-map3d.js` L731-753 `loadOsmTile`: `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png` を `new Image().src` 直指定。 起動ごとに OSM サーバへ 9-16 req。 ToS 範囲内ではあるが「キャッシュが効く」状態ではない (= browser HTTP cache に乗っていれば再 fetch 抑止されるが、 cache の生存期間 / VPN / シークレット mode 等で容易に外れる、 物理的に DB 保存していないので不確実)。
- `src/fujihc/tile_constants.py`: minimap 用 zoom / bbox の中央定数なし。 viewer L823-828 で `const z = 11` `const buffer = 1` をマジック直書きしているのが load-bearing (= NG-R1-1 再演に近い、 brief 29 から持ち越し)。
- `src/fujihc/tile_server.py` L29 `VALID_SOURCES = ('osm', 'gsi_dem')`: raster minimap タイル用の source 名が未定義。 `get_tile` は受け取った瞬間 400 で reject する。
- `src/fujihc/tile_server.py` L152-213 `get_setup_status`: 計算対象は `gsi_dem` (= 36 タイル) + `osm` (= 300 タイル) の 2 source 固定。 minimap raster の充足度を viewer に返す手段ゼロ。
- `src/fujihc/dbinit.py`: GSI 標高用 (`fetch_gsi_async`) と OSM PMTiles 抽出用 (`extract_osm_async`) の 2 関数のみ。 OSM raster を url 経由で 9-16 タイル fetch する helper なし。
- `src/fujihc/http_app.py` L109-167: route は `/tiles/_fetch_gsi` `/tiles/_extract_osm` の 2 種、 minimap raster 用の async fetch 起動 endpoint なし。
- `web/tests/viewer_url_audit.test.js` L16-29: `tile.openstreetmap.org` を `loadOsmTile` 関数内のみに限定する grep gate。 cache 化後は `loadOsmTile` が `/tiles/osm_raster/` 経由 (= localhost) になるため OSM URL は (= fallback 用に) 1 箇所限定維持できるか / 削除できるかを再定義する必要。

## あるべき構造

```
起動 (state-checking)
  │
  ▼
GET /tiles/_setup_status
  │
  ├─ overall=ready & osm_raster=ready ──▶ state-pairing
  │
  └─ それ以外 ──▶ state-dbinit
                   │
                   │  既存 GSI 自動 fetch / OSM PMTiles 取込 / skip に加えて、
                   │  起動と同時に POST /tiles/_fetch_minimap_raster を自動発火
                   │  (= user 操作不要、 サイズ小 = 9-16 タイル / ~50 KB 上限)
                   │
                   ▼
              source=osm_raster の 9-16 タイルが DB tiles table に landed
                   │
                   ▼
              次回起動以降は GET /tiles/osm_raster/{z}/{x}/{y}.png で DB から hit
                                              (= OSM サーバ再 fetch ゼロ)
```

key point:

1. `osm_raster` は `osm` / `gsi_dem` と同格の 3 つ目の source 名。 `tiles` table schema (= source / zoom_level / tile_column / tile_row / format / data / fetched_at / fetch_status) を共用、 format は `'png'`。 schema migration 不要 (= brief 14 schema の column 既存)。
2. fetch logic は `dbinit.fetch_gsi_async` を踏襲、 ただし URL は `https://tile.openstreetmap.org/{z}/{x}/{y}.png`、 1 req/sec、 User-Agent `fujihc-trainer/0.1 (https://github.com/YuujiKamura/fujihc-trainer)` (= GSI と同形)。 9-16 タイルなので逐次でも 16 秒以内に完走、 並列化不要。
3. fetch 対象は bbox `(138.65, 35.30, 138.85, 35.50)` (= 富士山周辺、 brief 29 で確定した course bbox + 余裕)、 zoom 固定 11。 中央定数 `MINIMAP_OSM_ZOOM = 11` / `MINIMAP_BBOX` を `tile_constants.py` に置く。
4. viewer 側は `loadOsmTile` の URL を `${TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png` に切替、 fallback で従来の OSM 直叩きを残す (= 起動時 cache 構築前 / DB 不在 / bridge 未起動でも minimap が出る)。
5. setup_status は `gsi_dem` + `osm` に `osm_raster` を追加して 3 source 返す。 viewer の dbinit-overlay に 3 つ目の進捗 row (= 任意で出す、 minimap 用 9-16 / N の bar) を生やすかは optional、 backend は揃える。
6. dbinit_progress の WS event payload は既存 GSI / OSM と同 schema (= `{type: 'dbinit_progress', source: 'osm_raster', n, total, phase}`)。

## ToS 安全範囲

OSM Tile Usage Policy (= <https://operations.osmfoundation.org/policies/tiles/>) の制約と本 brief の運用を再照合:

| 制約 | minimap DB cache 化後 | brief 29 (= 起動毎 fetch) | brief 13 違反 (= 物理 freeze 済) |
|---|---|---|---|
| bulk download 禁止 | OK (= 初回起動時 9-16 タイル / 1 回限り、 以降 DB から hit) | OK (= 起動毎 9-16 タイル) | NG (= ride 開始毎 2700 タイル並列) |
| 個人小規模 OK | OK (= 1 DB build = 9-16 タイル) | OK (= 9-16 / 起動) | NG |
| User-Agent 必須 (識別可能) | OK (= `fujihc-trainer/0.1 ...` 明示) | OK (= browser 標準 UA) | NG (UA 無し) |
| rate limit (heavy use 禁止) | OK (= 1 req/sec 逐次、 16 秒で完走) | OK (= 9-16 並列 1 burst) | NG (= 並列 rate limit なし) |
| cache 推奨 (= 「Tile servers should be used efficiently. Apps should cache aggressively」) | **OK 明示準拠** (= DB cache、 二度と再 fetch しない) | △ (= browser HTTP cache 任せ、 cache 揮発で再 fetch あり) | NG |

DB cache 化は OSM Tile Usage Policy の「cache aggressively」推奨に積極的に沿う方向、 brief 29 (= browser HTTP cache 頼り) よりさらに安全側。 個人配布時にも初回 DL 9-16 タイル / 16 秒の負荷で完結、 再配布側で更に外向き fetch を伴わない。

Rule 11 classification: `osm_raster` source の DB 内 tile bytes は OSM raster (= ODbL ライセンス、 再配布許可) 由来。 class B (= 公開 redistributable) 相当、 ODbL の attribution 維持義務 (= viewer 内 `© OpenStreetMap contributors`) を満たせば DB ファイル自体は配布可。 ただし本 brief は配布物の話ではなく viewer 起動時 cache 化なので、 配布判断は別 issue。

## 実装設計

### A. tile_constants.py 追加定数

```python
# brief 30: minimap raster (= 上半分 OSM 直叩き → DB cache) の zoom / bbox
MINIMAP_OSM_ZOOM = 11
# 富士山周辺の bbox (lon_min, lat_min, lon_max, lat_max). 富士スバルライン
# 24 km + 周辺余裕、 z=11 で 9-16 タイルに収まる範囲. brief 29 で確定済値.
MINIMAP_BBOX = (138.65, 35.30, 138.85, 35.50)
```

### B. tile_server.py の VALID_SOURCES 拡張

- L29: `VALID_SOURCES = ('osm', 'gsi_dem', 'osm_raster')` に拡張。
- L33 `_metrics`: 新 source の初期 dict を生やす。
- `get_setup_status`: `sources_spec` に `('osm_raster', [MINIMAP_OSM_ZOOM])` を追加。 ただし expected 計算は course corridor ではなく bbox 直接 tile 列挙 (= 既存 `enumerate_coverage_tiles` は course 点列依存、 minimap は bbox 直接なので新 helper を `tile_server` 内に書く or `tile_coverage` 側に `enumerate_bbox_tiles(bbox, zoom)` を生やす)。 spec 不一致を避けるため bbox 列挙 helper を新規 `tile_coverage.enumerate_bbox_tiles` として追加 (= 単純な lonToTileX / latToTileY ループ、 pure function)。

### C. dbinit.py に fetch_minimap_raster_async 追加

```python
async def fetch_minimap_raster_async(
    db_path,
    bbox=MINIMAP_BBOX,        # (lon_min, lat_min, lon_max, lat_max)
    zoom=MINIMAP_OSM_ZOOM,    # 11
    rate_limit_sec=GSI_RATE_LIMIT_SEC,  # 1.0
    user_agent=DEFAULT_USER_AGENT,
    progress_cb=None,
) -> dict:
    """OSM raster タイルを bbox + zoom 内で 1 req/sec 逐次 DL → DB 格納.

    Returns: { fetched, skipped, errors, total }
    """
```

実装は `fetch_gsi_async` を踏襲、 URL を `https://tile.openstreetmap.org/{z}/{x}/{y}.png`、 source 名を `'osm_raster'`、 format を `'png'`、 metadata に `attribution=© OpenStreetMap contributors (ODbL)` `license=ODbL-1.0` `format=png` `minzoom=11` `maxzoom=11` を書く。 progress_cb の dict は `{source: 'osm_raster', n, total, phase}`。

### D. http_app.py に /tiles/_fetch_minimap_raster 追加

- 新 route: `POST /tiles/_fetch_minimap_raster`、 body 不要 (= bbox / zoom は定数)。
- `inflight['osm_raster']` で二重起動防止 (= GSI / OSM と同 pattern)。
- `dbinit.fetch_minimap_raster_async` を spawn、 progress_cb は既存 `_progress` (= `progress_broadcaster` 経由で WS push)。
- 戻り値 202 `{state: 'started', source: 'osm_raster'}` (= 既存 GSI / OSM 同型)。

### E. viewer-map3d.js 切替

- `loadOsmTile` の `img.src` を `${TILE_BASE_URL}/osm_raster/${z}/${tx}/${ty}.png` に変更。 ただし 1 引数目の URL を fetch する形にせず、 (1) まず DB 経由を試す、 (2) 503/404 のみ OSM 直叩きに fallback、 の二段にする。 fallback 経路は cache 構築前の初回起動でも minimap polyline + OSM (= 初回 fetch) が出る保証。
- 具体実装: `img.onerror` の中で `img.src` を `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png` に再設定 (= 1 回だけ retry、 二度目の onerror で resolve(silent fail))。 旧 brief 29 の挙動を超 set 維持。
- `buildMinimapTopBase` 関数の先頭で `fetch('/tiles/_fetch_minimap_raster', { method: 'POST' })` を fire-and-forget で呼ぶ (= 起動 1 回、 await しない、 失敗無視)。 これで初回起動時に bridge 経由で DB 構築開始、 ride 中 / 次回起動からは DB hit。
- viewer 内の `tile.openstreetmap.org` 出現箇所は `loadOsmTile` 関数 body 内の 1 箇所 (= fallback) に限定維持。

### F. viewer_url_audit.test.js gate 維持

- 既存 brief 29 例外 (= `loadOsmTile` 内のみ literal 許可) は維持。
- 追加 test (= 2 件):
  - `loadOsmTile` 内に `${TILE_BASE_URL}/osm_raster/` literal が現れる (= 一次経路 DB)。
  - `buildMinimapTopBase` 内に `/tiles/_fetch_minimap_raster` POST 呼出 literal が現れる (= 起動時 DB 構築 trigger)。
- prefetchTilesAlongCourse 関数定義禁止 (= 既存 brief 13 物理 freeze) は維持、 緩和しない。

### G. pytest 追加

`tests/test_minimap_raster_fetch.py` 新規 (= 5-6 件):

1. `fetch_minimap_raster_async` happy path: 4 タイル (= bbox を test fixture で絞る) を mock urlopen で fetch、 DB に source='osm_raster' の row が 4 件 / fetch_status=200。
2. progress_cb が n=0 → done で呼ばれる、 phase は fetching → done、 source は `osm_raster`。
3. 既存 row は skip (= `fetch_gsi_async` と同 dedup logic、 skipped に count up)。
4. 404 でも DB に fetch_status=404 で row 残す (= 再 fetch 抑止)。
5. metadata table に `attribution` / `license=ODbL-1.0` / `format=png` / `minzoom=11` / `maxzoom=11` / `fetched_by` が書かれる。

`tests/test_setup_status.py` に追加 (= 1-2 件):

6. empty_db 状態で `osm_raster` source も `status=empty, tiles_present=0, tiles_expected=<bbox 由来>` を返す。
7. `osm_raster` の expected 数だけ insert すると `osm_raster` の status=ready、 overall は `gsi_dem` / `osm` 次第で partial / ready。

### H. vitest 追加

`web/tests/viewer_url_audit.test.js` に追加 (= 2 件):

8. `loadOsmTile` 関数内に `/tiles/osm_raster/` literal が現れる (= 一次経路 DB)。
9. `buildMinimapTopBase` (= 旧 buildMinimapBase) 内に `/tiles/_fetch_minimap_raster` POST 呼出が現れる (= 起動時 DB 構築 trigger)。

合計 npm 227 → 229 件、 pytest 159 → 165 件 (= +6) 程度を目標。

## やらないこと (= scope 外)

- main viewer (= `${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf` 経由の vector pbf) の URL 変更 (= 既存 brief 26a 完了済、 不変)。
- GSI dem の minimap 直叩き復活 (= NG-R1-16、 minimap には不要、 元から GSI は使わない)。
- prefetchTilesAlongCourse (= 数 100 タイル一気 prefetch) の復活 (= NG-R1-15 物理 freeze 維持、 brief 13 freeze)。
- viewer_url_audit の `tile.openstreetmap.org` 全面禁止への戻し (= fallback 経路を破壊する、 brief 29 例外維持)。
- bridge.py の bind を 0.0.0.0 にする (= 127.0.0.1 物理 gate 維持、 LAN 内 ODbL 再配布事故防止)。
- git push (= main 判定外、 local commit 1 つで停止)。
- 配布物としての DB 同梱判断 (= 別 issue、 本 brief は viewer 起動時 cache 化のみ)。
- dbinit-overlay の UI に osm_raster bar を追加 (= optional、 backend だけ揃える、 UI 拡張は別 atom)。

## 完了条件

- 本 brief draft (= `30-minimap-tile-cache.md`) が `~/.agents/scratch/fujihc-trainer-project/briefs/` に landed (= 1500 字以上、 11 section)。
- `src/fujihc/tile_constants.py` に `MINIMAP_OSM_ZOOM` / `MINIMAP_BBOX` 追加。
- `src/fujihc/tile_coverage.py` に `enumerate_bbox_tiles(bbox, zoom)` 追加 (= 新規 helper、 pure function)。
- `src/fujihc/tile_server.py` の `VALID_SOURCES` 拡張 + `get_setup_status` で `osm_raster` 計上。
- `src/fujihc/dbinit.py` に `fetch_minimap_raster_async` 追加。
- `src/fujihc/http_app.py` に `POST /tiles/_fetch_minimap_raster` route 追加。
- `web/viewer-map3d.js` の `loadOsmTile` が `${TILE_BASE_URL}/osm_raster/...` 一次経路 + OSM 直叩き fallback、 `buildMinimapTopBase` が起動時 1 回 POST。
- `web/tests/viewer_url_audit.test.js` に新 2 件 (= osm_raster 経路 + 起動 trigger) 追加、 `loadOsmTile` 限定例外維持。
- `tests/test_minimap_raster_fetch.py` 新規 5-6 件、 `tests/test_setup_status.py` に 1-2 件追加。
- `npm test --silent` 全 green (= 227 → 229)。
- `python -m pytest -q` 全 green (= 159 → 165、 pre-existing bridge 不在 fail / error は scope 外で許容)。
- local commit 1 つ (= push しない)。

## ハマる罠

1. **`osm_raster` source 名の衝突**: 既存 `osm` (= vector pbf) と 1 文字違いではないが「osm」prefix を共有、 grep で混在しやすい。 viewer 内で `${TILE_BASE_URL}/osm/` (= vector) と `${TILE_BASE_URL}/osm_raster/` (= raster) を厳格に書き分ける、 schema や code review で誤置換しない。
2. **tile coverage の計算ズレ**: 既存 `enumerate_coverage_tiles` は course 点列を corridor で覆う形、 minimap は bbox 直接列挙。 新 helper `enumerate_bbox_tiles` を pure function で `tile_coverage.py` に書く。 viewer 側の `lonToTileX` / `latToTileY` と一致する数式 (= floor(lonToTileX(min)) .. ceil(lonToTileX(max)) 等) で揃える、 端タイル fence post 誤算注意。
3. **既存 row の dedup**: `fetch_gsi_async` と同じく `_existing_tiles_sync` で skip。 ただし source 名が `osm_raster` で query するため `('osm_raster',)` を正しく渡す、 string 直書き typo で `'osm'` を見るとバグる。
4. **fallback の二段 retry**: `img.onerror` で `img.src` を再設定する書き方は browser の event ループ次第で onerror が再帰呼び出しになりうる。 `tried` flag を closure に持って 1 回だけ retry、 2 回目以降は silent resolve。 旧 brief 29 の単純 resolve に近い safety net を維持。
5. **dbinit_progress の WS payload**: 既存 viewer の `handleDbinitProgress` は `source !== 'gsi_dem' && source !== 'osm'` で reject。 `osm_raster` を受け付けるように分岐拡張、 ただし dbinit-overlay に bar 不在の場合は silent skip (= 既存 `bar` 取得 null check で安全側)。
6. **POST /tiles/_fetch_minimap_raster の二重起動**: dbinit-overlay の自動発火 + user が再起動した時の二重 fire-and-forget で衝突しないよう、 既存 `inflight['osm_raster']` を立てる。 busy = 409 を viewer は無視 (= 既存 GSI / OSM と同形)。
7. **OSM Tile Usage Policy の cache 推奨**: 「cache aggressively」推奨に従う形だが、 cache TTL を持たない (= 1 度入れたら永久 hit)。 minimap raster は静的 (= 道路網が年単位で安定)、 OSM 側 tile 更新を取りに行く必要なし、 TTL 不要で正解。 ただし将来「DB cache を 1 年で再 fetch するか」議論が出たら別 brief。
8. **dbinit_progress overlay の row 不在**: index.html の dbinit-overlay には `dbinit-gsi-bar` / `dbinit-osm-bar` の 2 bar しかない。 `osm_raster` 用 bar を追加するなら HTML / CSS / `updateDbinitBar` の dispatch 拡張が必要、 ただし scope 外 (= optional)。 backend だけ揃える、 UI は別 atom で。
9. **brief 29 grep gate の緩和範囲**: `tile.openstreetmap.org` を `loadOsmTile` 内に限定する正規表現は brief 29 のまま機能する (= fallback 経路に literal が残る)。 cache 化後に literal を 0 件にしてしまうと fallback 完全削除で初回起動時 minimap が空白になる、 fallback 維持を gate 側も尊重。

## まとめ

minimap (= 上半分 #minimap-top canvas) の raster タイルを既存 main viewer と同じ DB cache pattern に揃え、 起動時 1 回だけ OSM タイルサーバから 9-16 タイル / z=11 / bbox 富士山周辺を fetch して `tiles` table に source='osm_raster' で保存、 2 回目以降は `${TILE_BASE_URL}/osm_raster/{z}/{x}/{y}.png` で DB から hit。 OSM Tile Usage Policy の「cache aggressively」推奨に積極準拠、 brief 29 (= browser HTTP cache 任せ) より物理的に安全側。 既存 `osm` (= vector pbf) / `gsi_dem` source と同格の 3 つ目として加え、 fetch logic は `fetch_gsi_async` を踏襲、 setup_status / dbinit_progress / inflight 二重起動防止も既存 pattern を再利用。 viewer 側は `loadOsmTile` の URL を DB 経由に切替 + OSM 直叩き fallback、 `buildMinimapTopBase` の冒頭で起動時 POST `/tiles/_fetch_minimap_raster` を fire-and-forget で発火。 main viewer / prefetchTilesAlongCourse / bridge bind の物理 freeze は不変。

## 次の atom

- `tile_constants.py` に `MINIMAP_OSM_ZOOM=11` / `MINIMAP_BBOX=(138.65,35.30,138.85,35.50)` 追加
- `tile_coverage.py` に `enumerate_bbox_tiles(bbox, zoom)` 追加 (= pure function、 lonToTileX / latToTileY ループ)
- `tile_server.py` の `VALID_SOURCES` 拡張 + `get_setup_status` の sources_spec に `osm_raster` 追加
- `dbinit.py` に `fetch_minimap_raster_async` 追加 (= GSI 踏襲、 URL / source 名 / metadata を OSM raster 用に振替)
- `http_app.py` に `POST /tiles/_fetch_minimap_raster` route + inflight 制御追加
- `viewer-map3d.js` の `loadOsmTile` を `${TILE_BASE_URL}/osm_raster/...` 一次経路 + OSM 直叩き fallback に書換、 `buildMinimapTopBase` の冒頭で起動時 POST、 `handleDbinitProgress` に osm_raster 分岐追加
- `viewer_url_audit.test.js` に 2 件追加 (= DB 経路 + 起動 trigger)
- `test_minimap_raster_fetch.py` 新規 5-6 件、 `test_setup_status.py` に 1-2 件追加
- `npm test` 全 green (227 → 229)、 `pytest -q` 全 green (159 → 165)
- local commit 1 つ (= push しない)
