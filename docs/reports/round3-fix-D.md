# Round 3 Fix D — テスト網羅軸 / セキュリティ軸の補強

## 担当範囲

- `tests/test_bridge_http_integration.py` (= bind 確認 source-grep test 追加)
- `tests/test_fetch_gsi_dem.py` (= main() smoke 追加)
- `tests/test_fetch_osm_pmtiles.py` (= main() smoke 追加)

`src/` 側 file は一切触らず (peer A の bind 修正と独立).

## 修正内容

### 1. bridge.py の 127.0.0.1 bind を source-grep で物理 pin

`tests/test_bridge_http_integration.py` に 1 件追加: `test_bind_is_127_0_0_1_in_source`.

bridge.py を `read_text` で読み取り、 3 つの assert を kept:
- `'TCPSite(http_runner, "127.0.0.1"' in text` — HTTP 側 bind
- `'websockets.serve(self._ws_handler, "127.0.0.1"' in text` — WebSocket 側 bind
- `'"0.0.0.0"' not in text` — 危険 bind の不在

これで bind が `0.0.0.0` (= LAN 露出, 別端末から ODbL 再配布事故 vector) に
化けた瞬間 fail する物理 gate になる. 既存 bridge.py は既に 127.0.0.1 で
serve していたので peer A の修正前後とも pass する.

### 2. fetch_gsi_dem.py の main() smoke

`tests/test_fetch_gsi_dem.py` に 1 件追加: `test_main_dummy_run`.

- `init_tile_db.init_db` で空 DB 作成 (= schema_v1 全部入り、本物の DDL を使う)
- 1 点 course (lat=35.4, lon=138.7) を tmp file に書く
- `urlopen` を `_CM` (context manager wrapper, PNG magic + 100 bytes return) で mock
- `time.sleep` を mock (= test 高速化, paranoia 防御)
- `sys.argv` 経由で `--force --rate-limit 0 --corridor-tiles 1 --zoom 14` 渡す
  (= 現行 `main()` は argv 引数を受けない実装、 `sys.argv` 経由しか道がない)
- 実行後 `tiles WHERE source='gsi_dem'` ≥ 1 と `metadata WHERE source='gsi_dem'` ≥ 4 を assert

これで argparse → course load → enumerate_coverage_tiles →
existing 集計 → confirm_or_abort → fetch loop → metadata 書き込みの
**main() 本体 path** が integration test 配下に入った.

### 3. fetch_osm_pmtiles.py の main() smoke

`tests/test_fetch_osm_pmtiles.py` に 1 件追加: `test_main_dummy_run`.

- 同じく `init_tile_db.init_db` で空 DB 作成
- ダミー .pmtiles file を tmp に作成 (= `open(args.pmtiles, 'rb')` が成功するためだけの 16 bytes)
- `sys.modules` に `pmtiles` / `pmtiles.reader` shim 挿入 (= pmtiles package 未 install
  でも import 可、 `Reader` は `fake_reader.get` で固定 bytes return)
- `sys.argv` 経由で `--force --pmtiles ... --corridor-tiles 1` 渡す
- 実行後 `tiles WHERE source='osm'` ≥ 1, `metadata WHERE source='osm'` ≥ 4

これで PMTiles reader 抽出 → DB insert → metadata 書き込みの
**main() 本体 path** が integration test 配下に入った.

## 完了条件チェック

- [x] `test_bridge_http_integration.py` に bind 確認 test 1 件追加
- [x] `test_fetch_gsi_dem.py` に main smoke 1 件追加
- [x] `test_fetch_osm_pmtiles.py` に main smoke 1 件追加
- [x] 全体 pytest で regression なし

## 検証

```
$ python -m pytest tests/test_bridge_http_integration.py tests/test_fetch_gsi_dem.py tests/test_fetch_osm_pmtiles.py -v
============================= 25 passed in 2.33s ==============================

$ python -m pytest --tb=short -q
......................................................................... [ 62%]
......................................ssss                                 [100%]
111 passed, 4 skipped in 8.91s
```

ベースライン 22 → 25 (= 新規 3 件 全 pass), 全体 111 passed / 4 skipped / 0 failed.

## brief との差分 / 設計決定

brief は `fetch_gsi_dem.main([...args list...])` という argv 引数を main に渡す
スタイルだったが、 現行 `fetch_gsi_dem.main()` も `fetch_osm_pmtiles.main()` も
`argparse.ArgumentParser().parse_args()` を引数なしで呼ぶ実装 (= sys.argv から読む).

main() の signature を変更すると script 本体の API 変更になり scope を超えるため、
test 側で `monkeypatch.setattr(sys, "argv", [...])` 経由で同等の効果を得た.
brief の意図 (= main() 本体 path を 1 周走らせる) は満たされている.

pmtiles package が install されていない環境でも test が回るよう、
`sys.modules` に `pmtiles` / `pmtiles.reader` shim を `monkeypatch.setitem` で挿入.
monkeypatch fixture は test 終了時に自動 cleanup するので他 test に影響しない.

## 件数

- 新規追加 test: 3 件
- 編集 file: 3 件 (test 専用)
- src/ 修正: 0 件 (peer A 領域、 触らず)

DONE: round3 fix D, +3 tests
