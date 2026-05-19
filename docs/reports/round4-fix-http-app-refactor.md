# Round 4 fix — bridge.py から HTTP app を `http_app.py` に切出 refactor

## はじめに

Round 3 audit の設計境界軸で flag された「bridge.py monolith 982 行」を解消する refactor を実施。`Bridge._make_http_app()` method を module 関数 `make_http_app(db_path) -> web.Application` として `src/fujihc/http_app.py` に切出した。logic 不変、test 全 pass。

## 変更内容

### 1. `src/fujihc/http_app.py` (新規, 64 行)

- `make_http_app(db_path: str | Path) -> web.Application` を export
- handler 4 個 (`h_tile`, `h_metadata`, `h_style`, `h_metrics`) は bridge.py の旧 `_make_http_app` から **行単位コピー**、 logic 不変
- 依存: `aiohttp`, `fujihc.tile_server` のみ (Bridge への依存なし = 一方向)

### 2. `src/fujihc/bridge.py` 修正

- 旧: `from fujihc import tile_server` import 削除 (http_app.py に移譲)
- 新: `from fujihc.http_app import make_http_app` 追加
- `_make_http_app` method (約 48 行) 削除
- `Bridge.run()` 内: `http_app = self._make_http_app()` → `http_app = make_http_app(self.db_path)`
- WebSocket bind / `web.AppRunner` / `web.TCPSite("127.0.0.1", ...)` は維持

### 3. `tests/test_bridge_http_integration.py` 修正

- `from fujihc.bridge import Bridge` → `from fujihc.http_app import make_http_app`
- `_make_bridge` helper 削除 (Bridge instance 不要に)
- 各 test: `bridge._make_http_app()` → `make_http_app(db_with_one_tile)` に置換 (7 件)
- `test_bind_is_127_0_0_1_in_source` source-grep gate は **変更なし**: bridge.py に `TCPSite(http_runner, "127.0.0.1"` + `websockets.serve(self._ws_handler, "127.0.0.1"` 両方とも残存している事を確認、 `"0.0.0.0"` 文字列も無い → pass

## 完了条件の verify

| 条件 | 結果 |
|---|---|
| `src/fujihc/http_app.py` 新規, `make_http_app` export | done |
| `bridge.py` から `_make_http_app` 削除, import + 呼び出し更新 | done (`grep tile_server\|_make_http_app` → no matches) |
| 既存 7 件 integration test 全 pass | **8 件全 pass** (元々 8 件 = 7 endpoint test + 1 source-grep gate) |
| 全体 `pytest -q` で 111 passed / 4 skipped 維持 | **111 passed, 4 skipped in 7.99s** |
| `npm test` で 52 passed 維持 | **52 passed** (6 test files) |
| bridge.py 行数減 (約 -50 行, 982 → 930 程度) | **982 → 933 (-49 行)** ✓ target 達成 |
| 依存方向: bridge.py → http_app.py 一方向 | done (http_app.py 側は Bridge を import しない) |

## test 結果 (詳細)

```
$ python -m pytest tests/test_bridge_http_integration.py -v
============================== 8 passed in 0.29s ==============================

$ python -m pytest -q
111 passed, 4 skipped in 7.99s

$ npm test
Test Files  6 passed (6)
     Tests  52 passed (52)
```

## bridge.py 行数 confirmation

```
  933 C:/Users/yuuji/fujihc-trainer/src/fujihc/bridge.py
   64 C:/Users/yuuji/fujihc-trainer/src/fujihc/http_app.py
```

bridge.py: **982 → 933 lines (-49)**。target「約 -50 行、 982 → 930 程度」に合致。

## まとめ

- HTTP app 関連 (route 定義 + handler 4 個) を `bridge.py` から `http_app.py` に切出済。
- 依存方向は `bridge.py → http_app.py` の一方向、 設計境界が明示化された。
- 既存 logic は行単位コピー、 振る舞いは不変。
- 全 test (Python 111 / npm 52 + skipped 4) で regression なし。
- ローカル commit は行わず、 main session の commit を待つ。

DONE: http_app refactor (bridge.py: 982 → 933 lines, pytest 111 passed / 4 skipped, npm 52 passed)
