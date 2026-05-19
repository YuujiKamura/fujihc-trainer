# brief 23 v2 — GPX smoothing window tune

**Status**: DONE
**Date**: 2026-05-15
**Scope**: `web/lib/gpx_smooth.js`, `src/fujihc/gpx_smooth.py`, `web/tests/gpx_smooth.test.js`, `tests/test_gpx_smooth.py`

## 何をやったか

User 指示「やりすぎると変くなる、 短距離ジグザグ補正程度で十分」を受けて、
GPX smoothing の default window を **11 → 5** に下げた。

- `smoothCourse(course, window = 5, options = {})` (JS)
- `smooth_course(course, window=5, smooth_fields=None)` (Python)
- 関数 signature は不変 (default 値のみ変更)
- docstring に「やりすぎ禁止 / 道路カーブも消える」明記
- 既存 window=11 は調査用として残せる (= 引数で渡せば動く、 default ではない)

## なぜ window=5 が妥当か (= 実測根拠)

富士ヒル course 1968 点 (12km, 平均 6m/点) に対する **course 全長変化率**:

| window | smoothed length | ratio   | 解釈 |
|-------:|----------------:|--------:|:-----|
| (orig) | 23947.27 m      | -       | 原 GPX (ジッター込) |
| 3      | 23866.65 m      | 0.337%  | 効きが弱い |
| **5**  | **23798.51 m**  | **0.621%** | **default、 ジグザグ補正レベル** |
| 7      | 23727.11 m      | 0.919%  | やや強い |
| 11     | 23533.04 m      | 1.730%  | 旧 default、 道路カーブまで削る |

window=5 の lat/lon 移動量実測 (全 1968 点中の最大):
- max Δlat ≒ 0.00046° (≒ 50m)
- max Δlon ≒ 0.00066° (≒ 60m at lat 35°)

= ジッター除去としては十分、 道路カーブの保存も維持。

## テスト変更点

### Python (`tests/test_gpx_smooth.py`)

- 既存 `test_smooth_course_*` の window=11 hardcode を `smooth_course(fuji_course)` (= default) に置換
- 全長変化 threshold を **< 3% → < 1%** に締める (実測 0.62% < 1%)
- **新規 `test_smooth_course_window11_is_stronger`** 追加: 大 window (= 11) が default (= 5) より強く平滑化することを確認 (= 引数で渡せば動く + 大きいほど道路カーブも消える挙動の pin)
- cross-language fixture の schema を `py_gpx_smooth/v1 → v2`、 `course_smoothed_window5` と `course_smoothed_window11` の両方を出力 (= default パスと window=11 調査パスの両方を JS から検証可能)

### JS (`web/tests/gpx_smooth.test.js`)

- 既存 smoothCourse テスト 3 件 (= preserves fields / lat-lon close / total distance) を default 引数呼び出しに変更、 全長 threshold を < 3% → < 1%
- **新規 `window=11 は default (5) より course 全長を大きく削る`** 追加 (Python の `test_smooth_course_window11_is_stronger` に対応)
- cross-language 等価性テスト: 既存の `window=11` 一致確認をそのまま残し、 **新規 `default window=5 が Python と一致`** を追加 (= JS の default 呼び出しと Python の default 呼び出しが同値であることを fixture 経由で pin)

### Fixture (`web/tests/fixtures/py_gpx_smooth.json`)

Python の `test_dump_gpx_smooth_fixture_for_js` で自動再生成。
schema は v1 → v2、 `course_smoothed_window5` (新規) + `course_smoothed_window11` (継続) を含む。

## 検証結果

### `pytest tests/test_gpx_smooth.py -v`

```
14 passed in 0.06s
```

- moving_average: 5 件
- smooth_course (= window=5 default): 8 件 (新規 window11_is_stronger 含む)
- cross-language fixture dump: 1 件

### `npm test -- --run gpx_smooth`

```
17 passed in 40ms
```

- movingAverage: 5 件
- smoothCourse: 7 件 (新規 window=11 vs window=5 比較含む)
- cross-language (Py ↔ JS): 5 件 (新規 default window=5 一致 + 既存 window=11 一致)

### 全体回帰

- `python -m pytest` → **125 passed, 4 skipped** (= 既存 WebSocket smoke skip のみ)
- `web && npm test -- --run` → **156 passed (12 files)**

= 他の test に影響なし、 default 引数変更が他 caller を壊していない。

## file 一覧 (= 触ったもの)

- `C:\Users\yuuji\fujihc-trainer\src\fujihc\gpx_smooth.py`
- `C:\Users\yuuji\fujihc-trainer\web\lib\gpx_smooth.js`
- `C:\Users\yuuji\fujihc-trainer\tests\test_gpx_smooth.py`
- `C:\Users\yuuji\fujihc-trainer\web\tests\gpx_smooth.test.js`
- `C:\Users\yuuji\fujihc-trainer\web\tests\fixtures\py_gpx_smooth.json` (= pytest 走で自動再生成)

## 注意事項

- 関数 signature 不変、 既存 caller (= window 値を明示渡し) は無影響
- main の viewer 統合側で `smoothCourse(course)` (= default) で呼び出している場合、 自動的に window=5 に変わる。 もし viewer 側で window 値を hardcode していたら、 そこも更新が必要 (= 本 brief の scope 外、 main に申し送り)
- brief 25 (= 道路幅 polygon) は別 peer (G) が並列作業中、 file 干渉なし
