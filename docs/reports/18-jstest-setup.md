# Brief 18 setup 報告 (subagent)

## 完了

- `package.json` (vitest devDep, type=module, name=fujihc-viewer)
- `vitest.config.js` (environment=node, include=web/tests/**/*.test.js)
- `.gitignore` に `node_modules/` 追記 (既存行は不変)
- `web/lib/tile_math.js` (4 関数: lonToTileX / latToTileY / tileXToLon / tileYToLat)
- `web/lib/terrarium.js` (3 関数: gsiPixelToHeight / heightToTerrariumRGB / convertGsiPixelsToTerrariumPixels, Uint8ClampedArray 入出力)
- `web/lib/tile_coverage.js` (enumerateCoverageTiles / computeBounds, `"z/x/y"` 文字列 set)
- `web/lib/heading.js` (computeTravelHeading / clampIndex, 0=北 90=東 deg)
- `web/tests/tile_math.test.js` (6 件)
- `web/tests/terrarium.test.js` (9 件 ※ brief の sub-count "8" は記載ズレ、 関数全件 × 境界の数え直しで 4+3+2=9。 brief 総数 26 件は維持 → 内訳 tile_math 6 / terrarium 9 / tile_coverage 6 / heading 5 = 26、 cross-language 1 件は skip 時にカウント外)
- `web/tests/tile_coverage.test.js` (6 件 + cross-language 1 件、 fixture 不在で skip)
- `web/tests/heading.test.js` (5 件)
- `web/tests/fixtures/.gitkeep`
- `npm install` 完了 (vitest 1.6.1)

## 結果

- `npm test`: **26 passed / 1 skipped** (= cross-language test、 fixture `web/tests/fixtures/py_coverage_z14.json` 不在のため `it.skip`、 peer B (brief 14) が landed 後に main が fixture 生成すれば自動で assertion 化)
- `pytest -q`: **57 passed / 4 skipped** (回帰なし、 brief 18 touch ファイルは全て新規)

## 触らなかったもの

- `web/viewer-maplibre.js` (= subagent A の prefetch コメントアウトと衝突するので import 化は別 atom、 main session 担当)
- `web/index.html` (= `<script type="module">` 切替は viewer 編集と一緒の atom)
- `src/fujihc/tile_*.py` (= peer B (brief 14) 担当)
- `scripts/measurement_diff.py` (= peer C (brief 20) 担当)
- README (= viewer 統合と同時の方が自然、 main session 一括)

## brief との差分

1. terrarium.test.js を 9 件にした (brief の sub-count "8" 表記とのズレ、 ただし brief 総数 26 件は維持)
2. GSI 無効値処理: 海面 = (0,0,0) → 0m, 無効 = (128,0,0) → null とした (viewer-maplibre.js の実装と一致, brief 60 行目の「海面 (128, 0, 0) → 0」は viewer 実装と矛盾するため viewer に揃えた)
3. `enumerateCoverageTiles` は `corridor_tiles = Math.floor(corridorTiles / 2)` を半径とする (Python 実装と同 logic 想定、 corridor=3 → 3x3 grid)
4. 富士ヒル course の corridor=3 z=14 タイル数: 期待 36 → 実測 **36** で一致 (brief 14 の数値と整合)

## 次の手 (main session 用)

1. peer B (brief 14) が landed したら、 `tests/test_dump_for_js.py` を作って `web/tests/fixtures/py_coverage_z14.json` を生成 → cross-language test が自動で skip → pass に昇格
2. viewer-maplibre.js の関数置換 (lonToTileX 等の重複定義) を import に切り替え、 `index.html` を `<script type="module">` 化
3. 実走確認 (browser で 1 周走行、 リファクタ前後で camera / HUD / terrain が不変)
4. ローカル commit (push しない)

DONE: brief 18 setup, 26 pass / 1 skip
