# Round 3 fix C report

## Scope

- `src/fujihc/tile_server.py`
- `tests/test_tile_server.py`

## 修正内容

### 1. `tile_server.py` — encoding 名統一 + 中央定数経由 default

- `from fujihc.tile_constants import GSI_DEM_ZOOMS, OSM_VECTOR_ZOOMS` を追加
- `build_style_json` の gsi_dem source の `encoding` を `'gsi-dem-png'` →
  `'terrarium'` に変更 (MapLibre 標準, viewer の addProtocol が変換後に渡す名)
- `osm.minzoom/maxzoom` の magic number default 14/18 を
  `min(OSM_VECTOR_ZOOMS)` / `max(OSM_VECTOR_ZOOMS)` に置換
- `gsi.minzoom/maxzoom` の magic number default 14/14 を
  `min(GSI_DEM_ZOOMS)` / `max(GSI_DEM_ZOOMS)` に置換
- docstring に encoding 注記 (viewer 側で terrarium 変換する前提、 server は
  変換しない) と minzoom/maxzoom default 注記を追加

### 2. `test_tile_server.py` — assertion 更新 + central constant default test 追加

- `from fujihc.tile_constants import GSI_DEM_ZOOMS, OSM_VECTOR_ZOOMS` を追加
- `test_build_style_json_happy`:
  - `encoding == 'gsi-dem-png'` → `'terrarium'` に書き換え
  - populated_db fixture が metadata 14/18 を pin している点を comment 化
- `test_build_style_json_zoom_defaults_from_central_constants` を新規追加:
  - metadata table に attribution のみ入れて minzoom/maxzoom を省略する fixture
  - default が `min/max(OSM_VECTOR_ZOOMS)` / `min/max(GSI_DEM_ZOOMS)` 経由で
    入ることを assertion (= OSM_VECTOR_ZOOMS=[17] → 17/17, GSI_DEM_ZOOMS=[14]
    → 14/14)
  - 中央定数を拡張した瞬間 default 値が追従することを物理層で pin

## 完了確認

- `python -m pytest tests/test_tile_server.py -v` → 21/21 passed (新 test 1 件含む)
- `python -m pytest` (全体) → **108 passed, 4 skipped** (regression 0)
- skip は既存 `test_ws_smoke.py` の 4 件、 本 fix と無関係

## 修正件数

- file: 2 (tile_server.py, test_tile_server.py)
- code change loci: 3 (encoding name / osm zoom default / gsi zoom default)
- test 追加: 1 (zoom_defaults_from_central_constants)
- test assertion 書き換え: 1 (test_build_style_json_happy の encoding)

## peer 干渉

なし. peer A (gpu_poll/bridge bind), peer B (README/dep pin), peer D
(bridge integration test) とは file 重複ゼロ.
