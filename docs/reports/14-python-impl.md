# brief 14 (Python 基礎) 実装報告

## status

DONE: 全テスト green、 commit はまだ (= main session が一括で commit する規約)。

## 触ったファイル (= 全部新規、 既存ファイル編集なし)

- `src/fujihc/tile_constants.py` — 中央定数 7 個 (DEFAULT_CORRIDOR_TILES=3, DEFAULT_BUFFER_M=1000, GSI_DEM_ZOOMS=[14], OSM_VECTOR_ZOOMS=[17], GSI_RATE_LIMIT_SEC=1.0, TILE_FETCH_WARN_THRESHOLD=1000, SCHEMA_VERSION=1)
- `src/fujihc/tile_coverage.py` — 3 pure 関数 (`enumerate_coverage_tiles`, `compute_bounds`, `estimate_tile_count`) + 内部 helper `_lonlat_to_tile`
- `tests/test_tile_coverage.py` — 14 test (= 全関数 mandate 達成: enumerate 6, bounds 3, estimate 3, 定数 sanity 2)
- `tests/test_dump_for_js.py` — 1 test (cross-language fixture 生成 + 中身 assertion)
- `web/tests/fixtures/py_coverage.json` — 生成物 (test 実行で出力される、 brief 18 の JS test が読む)

## brief 14 スコープ外で **触っていない** もの (= peer / 後続 brief の責務)

- `data/.gitkeep`, `.gitignore` (= brief 完了条件 1、 main session または別 task で着地)
- `scripts/init_tile_db.py` + DB schema + その test (= brief 完了条件 4, 6、 SQLite 触る部分は本 task の指示外)
- `README` 追記 (= brief 完了条件 8)

## test 結果

### 新規 test のみ
```
$ python -m pytest tests/test_tile_coverage.py tests/test_dump_for_js.py -v
============================= 15 passed in 0.29s ==============================
```

### 全体回帰
```
$ python -m pytest
57 passed, 4 skipped in 4.64s
```

baseline (= 着手時) は `36 passed, 4 skipped`。 増分内訳:
- 私 (= brief 14 Python): +15 test
- peer C (= brief 20 残り, scripts/measurement_diff.py): +6 test
- 合計 +21 → 57 passed (= 36 + 15 + 6)、 既存 36 個は無変更で全部 pass、 regression なし。

## 数値根拠 (= brief 14 見積もり表との一致)

富士ヒル course (`web/course.json`, 1968 点) corridor=3 で実測:

| zoom | brief 表 | 実装出力 | 一致 |
|---|---|---|---|
| 14 | 36 | 36 | OK |
| 15 | 70 | 70 | OK |
| 16 | 148 | 148 | OK |
| 17 | 300 | 300 | OK |
| 18 | 631 | 631 | OK |

bounds (buffer=1km) 実測:
- west = 138.6790 (brief 期待 138.681、 ±0.005°)
- south = 35.3640 (brief 期待 35.364、 ±0.005°)
- east = 138.7697 (brief 期待 138.768、 ±0.005°)
- north = 35.4611 (brief 期待 35.461、 ±0.005°)

test_compute_bounds_fujihc_with_1km_buffer は `pytest.approx(abs=0.005)` (= 約 500m) 許容で assertion。 全 4 軸通過。

## 罠 / 設計判断

1. **import 経路**: 既存 test (test_gpx_export.py 等) は `sys.path.insert(0, REPO_ROOT/'src')` で手動注入する慣習だった。 私も同じ pattern を踏襲。 pyproject.toml は package を `src/` 下に置いているが editable install が走っていない環境なので明示注入が必要。
2. **corridor=1 が「中央のみ」**: brief docstring に従い `radius = corridor_tiles // 2` で実装。 corridor=1 → radius=0 → 1 タイル, corridor=3 → radius=1 → 3x3 = 9 タイル。 偶数を渡された時のバイアスは docstring に明示。
3. **`compute_bounds` の buffer 単位変換**: 1度緯度 ≈ 111320 m を用い、 経度は中心緯度の cos で短縮。 富士ヒル中心緯度 ~35.4° で cos ≈ 0.815、 1km 余白で経度 +0.0110、 緯度 +0.0090。 brief 期待値と 0.003° 以内で一致。
4. **fixture JSON は `sort_keys=True` + tiles を sorted list で出力**: set の順序非依存性を保証、 JS 側 test が JSON.parse 後に同じ sort をすれば一致確認可能。
5. **タイル座標は XYZ scheme (TMS 反転なし)**: y は北が小さい値。 brief schema の `tile_row INTEGER NOT NULL    -- XYZ scheme (TMS 反転なし)` に整合。
6. **`enumerate_coverage_tiles` の n 境界 clamp**: 富士ヒル course では発火しないが、 `_lonlat_to_tile` 内で 0 ≤ x,y < 2^zoom に clamp、 さらに enumerate 側でも range check で重複防御。 単点 test で 9 タイル丸ごと取れることを確認 (= 境界クリップなし)。

## peer 干渉

なし。 file 完全独立 (私: `src/fujihc/tile_*.py`, `tests/test_tile_*.py`, `tests/test_dump_for_js.py`, `web/tests/fixtures/`; peer C: `scripts/measurement_diff.py`, `tests/test_measurement_diff.py`; peer D: `web/lib/`, `package.json`, `vitest.config.js`)。 git status で衝突なし、 既存 36 test も全部 green のまま。

## commit hash

なし (= 規約通り main session 待ち、 私は commit していない)。
