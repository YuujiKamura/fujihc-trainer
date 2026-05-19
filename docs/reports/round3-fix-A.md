# Round 3 fix A — schema_version migration + WebSocket bind explicit

## はじめに

Subagent A 担当の Round 3 audit fix。 触った file は brief 指定の 5 file のみ:
`scripts/gpu_poll.py`, `tests/test_gpu_poll.py`, `scripts/measurement_diff.py`,
`tests/test_measurement_diff.py`, `src/fujihc/bridge.py` の WebSocket bind 1 行。

Peer B (README + dep version pin) / peer C (encoding 名 + style.json maxzoom)
/ peer D (bridge integration test 拡充) とは file 干渉なし。

## 修正サマリ

### 1. `scripts/gpu_poll.py` — schema_version 列追加 (NG-R1-14 再演 fix)

- module-level `SCHEMA_VERSION = 1` 定数追加 (= 将来 QUERY 列変更時に bump する fork point)。
- `query_nvidia_smi()` 戻り dict の先頭に `'schema_version': SCHEMA_VERSION` を追加。
- 既存 `'ts'` / `'name'` / `'temperature.gpu'` 等の列は不変、追加だけ。

### 2. `scripts/measurement_diff.py` — schema-aware に

- module-level `SUPPORTED_SCHEMA_VERSION = 1` 定数追加。
- `load_samples()` を以下の 3-way 分岐に改修:
  - `schema_version` 不在 (= 古い jsonl) → stderr に WARNING 1 回 + そのまま読込 (後方互換)
  - `schema_version == 1` → silent 読込
  - `schema_version > 1` → stderr に WARNING 1 回 + そのまま読込 (forward-compat best effort)
- 戻り値の dict list の構造は不変、warning は stderr のみ。

### 3. test 更新

- `tests/test_gpu_poll.py::test_query_nvidia_smi_happy` に `assert result['schema_version'] == 1` 追加。
- `tests/test_measurement_diff.py` に 3 件追加:
  - `test_load_samples_schema_version_absent_warns` — 古い jsonl は warning 付きで読む
  - `test_load_samples_schema_version_1_no_warn` — 現行 schema は warning 出さない
  - `test_load_samples_schema_version_future_warns` — schema_version=99 は warning 付きで読む

### 4. `src/fujihc/bridge.py` L851-852 — WebSocket bind を `127.0.0.1` 明示

- `websockets.serve(self._ws_handler, "localhost", self.port)` → `"127.0.0.1"`
- `log.info("WebSocket server listening on ws://localhost:%d", ...)` → `ws://127.0.0.1:%d`
- Origin check (L445-453) は `http://localhost` / `http://127.0.0.1` 両方許可なので browser 側は影響なし。

## 検証

### unit test (scoped)

```
pytest tests/test_gpu_poll.py tests/test_measurement_diff.py -v
============================= 14 passed in 0.09s ==============================
```

内訳: 既存 5 (gpu_poll) + 6 (measurement_diff) = 11 件は維持、新規 3 件 (schema_version 系) 追加 = 14。

### 既存 baseline jsonl の後方互換 smoke

```
python scripts/measurement_diff.py \
  --before data/measurements/2026-05-15-idle-after-restart.jsonl \
  --after  data/measurements/2026-05-15-idle-after-restart.jsonl
WARNING: ...: schema_version 列が無い古い jsonl (= 後方互換で読込)
before: 29 samples ...
after:  29 samples ...
key                     before_mean   after_mean      delta
temperature.gpu               41.03        41.03      +0.00
...
```

crash せず、 warning が stderr に出て stdout の表は従来通り。

### 全体 pytest

```
1 failed, 106 passed, 4 skipped in 8.02s
```

- 既存 104 passed + skipped 4 → my 新規 test 3 件で 107 passed 期待、 実測 106 passed + 1 failed = 107。
- 失敗 1 件は `tests/test_tile_server.py::test_build_style_json_happy` で `gsi_dem` の tile encoding が
  `'gsi-dem-png'` を期待しているのに実装は `'terrarium'` を返す件、 これは **peer C の担当 file**
  (= `src/fujihc/tile_server.py` の encoding 名整合) なので私の scope 外、 regression ではない。
- 私の修正 file の test は全て pass。

## 完了条件 checklist

- [x] gpu_poll.py / measurement_diff.py / bridge.py に修正、 既存実装を壊さない
- [x] 新規 test 4 件 (gpu_poll 1 + measurement_diff 3) 全 pass
- [x] 既存 test は scope 内全 pass、 peer C 担当の test 失敗 1 件は scope 外
- [x] `data/measurements/2026-05-15-idle-after-restart.jsonl` を measurement_diff.py で読んでも
      crash しない (= warning 1 回 + 正常表示確認済)
- [x] 報告 file 出力 (本 file)

## まとめ

- schema_version=1 列で jsonl の互換性 fork point を確保、 measurement_diff は古い jsonl も crash せず読む。
- bridge WebSocket bind を `127.0.0.1` 明示で IPv6 / DNS 経路差異を排除、 HTTP tile server と統一。
- 残 fail 1 件は peer C scope、 main session で peer C 完了を待って commit。
- DONE: round3 fix A、 修正件数 = 5 file (gpu_poll.py / measurement_diff.py / bridge.py / 2 test file)。
