# Round 3 Fix F — SCHEMA_VERSION dedupe (single source of truth)

## 修正対象

Round 3 audit 設計境界軸 flag:
- `scripts/init_tile_db.py` が `SCHEMA_VERSION = 1` をローカル再定義
- 中央定数 `src/fujihc/tile_constants.py` (= SoT) を import せず
- 中央が `SCHEMA_VERSION = 2` 等に bump した時にここが追従しない (silent drift)

## 修正内容

### scripts/init_tile_db.py

- ローカル `SCHEMA_VERSION = 1` を削除
- `sys.path` に `src/` を挿入してから `from fujihc.tile_constants import SCHEMA_VERSION` で中央から import
  - test 側 (`tests/test_init_tile_db.py`) が `scripts/` を `sys.path` に挿入する形で `import init_tile_db` するため、test 経由でも script を直接実行した時 (`python scripts/init_tile_db.py`) でも動くよう、 script 側でも sys.path に `src/` を補う
- `SCHEMA_DESCRIPTION = 'initial schema, brief 14'` は scripts 固有の描写なので残置 (中央には description は無い、 brief 番号は script の責務)

### init_db() 関数内の hardcode 確認

- `apply_schema_v1()` は既に `SCHEMA_VERSION` 変数を使用しており (`INSERT INTO schema_migrations VALUES (?, ...)` / `PRAGMA user_version = {SCHEMA_VERSION}`) hardcode `1` は存在しなかった
- error message `f'expected {SCHEMA_VERSION}'` も変数経由
- 追加置換は不要 (= 中央 SoT 化だけで自動追従する)

### tests/test_init_tile_db.py

- 既存 5 件はすべて「結果として user_version=1 / version=1 / 99 mismatch」を assert する形で書かれており、中央定数を直接参照していないため改変不要
- 改変最小限の方針通り、 0 行差分

## verify

- `pytest tests/test_init_tile_db.py -v` → **5 passed** (0.15s)
- `pytest` 全体 → **111 passed, 4 skipped** (8.01s) (baseline 維持)
- script 直接実行 smoke:
  ```
  python scripts/init_tile_db.py --db smoke_tiles.sqlite
  → created
  PRAGMA user_version = 1
  schema_migrations = [(1, 'initial schema, brief 14')]
  ```

## 修正件数

- file 修正: 1 (= scripts/init_tile_db.py)
- 行 diff: -2 / +9 (= ローカル定義削除 + sys.path 操作 + import 追加)
- test 改変: 0

## 完了

DONE: schema_version dedupe
