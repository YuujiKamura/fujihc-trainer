# brief 16 report — Protomaps PMTiles 抽出 script

## 結果

`DONE: brief 16 osm pmtiles` ── 7 件 unit test 全 pass、 全体 regression なし (77 passed, 4 skipped)。

## 触ったファイル (3)

- `scripts/fetch_osm_pmtiles.py` ── 新規。 brief 骨格をほぼそのまま実装。`extract_tile` / `insert_tile` / `compute_to_fetch` / `main` の 4 関数。中央定数 (`DEFAULT_CORRIDOR_TILES`, `OSM_VECTOR_ZOOMS`, `TILE_FETCH_WARN_THRESHOLD`) を `fujihc.tile_constants` から import、 corridor 列挙は `fujihc.tile_coverage.enumerate_coverage_tiles`。`pmtiles` import は `main()` 内で遅延 try-except、 未 install なら exit 1。
- `tests/test_fetch_osm_pmtiles.py` ── 新規。 7 件 (mandate は 5-6 だが extract/insert/compute 各々 happy + edge で 7 件):
  - `test_extract_tile_happy_returns_bytes`
  - `test_extract_tile_out_of_range_returns_none`
  - `test_insert_tile_status_200_with_data`
  - `test_insert_tile_status_404_with_none_data`
  - `test_compute_to_fetch_happy_subtracts_existing_and_sorts`
  - `test_compute_to_fetch_all_existing_returns_empty`
  - `test_compute_to_fetch_deterministic_same_input_same_output`
  brief 14 schema が peer 1 から landed していない時点でも test 通るよう、テスト内に inline `CREATE TABLE tiles / metadata` を持つ。
- `pyproject.toml` ── `pmtiles>=3.0` を dependencies に追加 (alphabetical 位置: gpxpy と websockets の間)、 trailing comma 維持。

## 設計 note

- pmtiles の lazy import: `main` 内で `try: from pmtiles.reader import Reader, MmapSource except ImportError: print(...) raise SystemExit(1)` パターン。 module top-level import を回避することで test 環境に pmtiles install 不要。
- `compute_to_fetch` は `sorted([t for t in wanted if t not in existing])` で決定性を担保 (= JS 版 cross-check に効く)。
- test の sys.path 設定: `tests/test_tile_coverage.py` と同 pattern (`src/` + `scripts/` を両方 prepend)。

## verify (Rule 1)

- `pytest tests/test_fetch_osm_pmtiles.py -v` → 7 passed
- `pytest` 全体 → 77 passed, 4 skipped (= ws_smoke の既存 skip)、 regression なし
- import smoke: `python -c "import fetch_osm_pmtiles"` (= sys.path 注入後) で 4 関数全部 ref 可、 pmtiles 未 install でも import 成功

## やってないこと (brief 通り)

- PMTiles 元ファイル DL
- pmtiles パッケージの実 install (= dep 追加のみ、 install は user が `pip install -e .`)
- raster レンダリング
- commit / push (= main session 一括)
