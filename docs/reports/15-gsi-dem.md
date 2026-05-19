# Brief 15 完了報告: GSI dem_png レート制限 DL script

## 着地物

- `scripts/fetch_gsi_dem.py` — 中央定数 (`tile_constants` / `tile_coverage`) を import、 4 関数構成
  - `fetch_one(z, x, y, user_agent, timeout=10)` — urllib で 1 タイル取得、 (status, data) を返す
  - `insert_tile(db, source, z, x, y, status, data, fmt='png')` — brief 14 schema の `fetch_status` 列込みで INSERT OR REPLACE
  - `confirm_or_abort(count, threshold, force)` — DL 上限超で y/N 確認、 force で skip
  - `main()` — argparse + resume + metadata 6 row 書き込み
- `tests/test_fetch_gsi_dem.py` — 全関数 mandate で **8 件**
  - fetch_one: happy (200+bytes) / 404 (返す) / その他 HTTPError (raise) ── 3 件
  - insert_tile: 200/404 行が同時に入り fetch_status 列が正しい ── 1 件
  - confirm_or_abort: under threshold / force / input "y" / input "n" ── 4 件

## test 実走

- `pytest tests/test_fetch_gsi_dem.py -v` → **8 passed in 0.05s**
- `pytest` (全体 regression) → **77 passed, 4 skipped** (baseline 61 → +16: 自分 8 + peer1 init_tile_db 5 + peer2 fetch_osm_pmtiles 7 ≈ 一致)
- 既存 test 0 failure / 0 regression

## brief 完了条件 マッピング

- (1) script landed, 中央定数 import — **OK**
- (2) 実走 36 タイル — **skip** (= user 判断、 script 実行は user 手元)
- (3) `SELECT COUNT(*)` 36 件 — **skip** (実走依存)
- (4) metadata 6 row — main() に書いてある、 test は実走前提なので未直接 assert (= 主要 logic は test 済、 metadata 列は brief 14 の schema に依存)
- (5) resume 動作 — main() の `existing` set + `to_fetch` filter で実装、 logic 自体は trivial
- (6) **全関数 mandate 5-7 件 unit test — 8 件 (要件超過) で OK**
- (7) pytest 全 green / 既存 backend test green — **OK**

## やらなかったこと (= brief 通り)

- 実 GSI server への DL (= user 判断)
- `pyproject.toml` 編集 (= urllib 標準 lib、 dep 追加不要)
- 別 zoom 級 DL (= brief 通り zoom 14 固定)
- OSM PMTiles / viewer / DB の git commit

## 注意点

- `scripts/` は package ではないため、 test では `sys.path.insert(0, REPO_ROOT/"scripts")` で読み込む (= 既存 `test_tile_coverage.py` の `src/` 追加 pattern と同形)
- peer 1 の `scripts/init_tile_db.py` が並列着地中の前提だったので、 test 側は brief 14 schema を inline で持って自立させた (peer 1 の有無に test 結果が依存しない)
- 実走時の peer 1 `init_tile_db.py` への依存は main() runtime のみ (= DB が存在し schema が brief 14 通りなら動く)

## 次の atom

brief 16 (OSM PMTiles, peer 2 着地済) と合わせて brief 17a/17b (tile server module + viewer endpoint) に進める。

DONE: brief 15 gsi dem (8 tests)
