# brief 31 round 2 構造修正 directive (= reviewer A + B 統合)

## 統合判定 (= A/B 共通 BLOCK)

1. **register**: viewer 要求 (z=8-14 broad view) と export 出力 (corridor 細帯) が独立に決まる
2. **抽象段差**: zoom 範囲が 5 箇所散在 (tile_constants / viewer source / map control / dbinit / export)
3. **test**: viewer 要求と DB coverage の不一致を block する gate ゼロ、 結合 test ゼロ

LOAD-BEARING:
- 語彙: `GSI_DEM_ZOOMS=[14]` が fetch zoom しか表していない、 view 範囲を別定数に
- loading indicator: 6 秒 fallback は実装済だが `rideReady` 経由で loader hide が止まる、 hide 独立化
- security: 山体 bbox export は repo/artifact 制限の安全側、 ただし README/UA に正当性明記

## 修正の 4 commit 構成

### commit δ-1: tile_constants を SSoT 化、 viewer は constants 参照
1. `tile_constants.py` に明示宣言:
   - `GSI_DEM_FETCH_ZOOM = 14` (= dbinit が 1 zoom 単一化で取る、 既存挙動維持)
   - `GSI_DEM_VIEW_ZOOM_RANGE = (8, 14)` (= viewer source の minzoom..maxzoom)
   - `FUJI_MOUNTAIN_BBOX = (138.65, 35.30, 138.85, 35.50)` (= 山体覆う bbox、 minimap_BBOX と同値)
2. viewer 側 `buildMapStyle` の hillshade source `minzoom: 8` / `maxzoom: 14` を JSON 注入で constants と同期:
   - 新規 `web/static/tile_ranges.json` を `scripts/export_static.py` が出力 (= `{gsi_dem: {min: 8, max: 14}, ...}`)
   - viewer 起動時 fetch して `buildMapStyle(env, tileRanges)` に渡す、 hardcode 撤去
3. 結合 test `tests/test_zoom_contract.py`: viewer JS の `minzoom: N / maxzoom: M` literal を parse → `GSI_DEM_VIEW_ZOOM_RANGE` と一致 assert

### commit δ-2: 山体 bbox の z=8-13 fetch を dbinit に追加 (= code のみ、 実行は user 認可待ち)
1. `dbinit.py` に `fetch_gsi_mountain_overview_async(bbox, zoom_range)` を新設:
   - `FUJI_MOUNTAIN_BBOX` 内の z=8-13 全 tile を 1 req/sec で fetch
   - 既存 corridor fetch (= z=14) と独立 mode、 idempotent (= 既取得 skip)
2. `scripts/init_tile_db.py` に `--overview` flag を追加、 default off (= 既存挙動破壊しない)
3. README に「山体 broad view を有効化したければ `python scripts/init_tile_db.py --overview` を 1 回実行」と明記、 UA に「fujihc-trainer/0.1 mountain overview」を含める
4. `scripts/export_static.py` は DB 全件出力なので、 dbinit に overview 入れば export も追従 (= 既存実装で OK)
5. **実 fetch は user が手元で 1 度走らせる**、 私は code だけ landing、 GSI への ToS 配慮で実行は user 認可必要

### commit δ-3: loading indicator の 6 秒 fallback で hide だけ独立実行
1. `#loading-indicator` DOM 存在 grep gate を `index.html` に追加 (= regression block)
2. viewer line 800 付近の 6 秒 setTimeout を分離:
   - 旧: `setTimeout(() => { mapIdle = true; tryStart(); }, 6000)` → tryStart 内で rideReady=false なら loader hide まで届かない
   - 新: 6 秒で **rideReady 無関係に loader を即 hide** + 警告 banner 表示 (= 「タイル一部欠損、 地図描画が不完全な可能性」)
3. fallback の test: `tests/static_mode.test.js` に「6 秒 timeout の hide は rideReady 無関係」を pin
4. このコミットは即効性あり (= 山体 fetch しなくても loader が消えて画面状況が見える)

### commit δ-4: 結合 test 追加
1. `tests/test_export_coverage.py`:
   - 「viewer source.minzoom..maxzoom 全 zoom で、 `FUJI_MOUNTAIN_BBOX` 内の tile が DB / `_site/static/tiles/gsi_dem/` に 100% 存在」を assert
   - 不足あれば list を出して fail (= user に「`init_tile_db.py --overview` 走らせろ」と教える)
2. `pages.yml` の verify step に上記 contract check を追加

## 完了後の動作

- commit δ-1: 既存挙動維持、 ただし viewer が JSON 経由で zoom 範囲を読むので、 dbinit 拡張時に viewer 同期は自動
- commit δ-2: code landed、 user が `python scripts/init_tile_db.py --overview` で実 fetch (= 6 分)
- commit δ-3: 即効、 fetch なしで loader が消えて画面が見える、 山体外 zoom は灰色 tile
- commit δ-4: 山体 fetch 完了後の CI で「山体 bbox 全 zoom 揃ってる」を確認、 不足ならビルド fail

## 順序判断

- δ-3 を最優先 (= 即時 visual 改善、 山体 fetch なしで「灰色だが loader 消える」状態確認可)
- δ-1 を次 (= 構造の根を直す、 SSoT 化)
- δ-4 を次 (= test gate)
- δ-2 を最後 (= 実 fetch は user 認可、 code は先に landing 可)

各 commit 後 npm/pytest 全 pass を gate。
