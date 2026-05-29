---
brief: 18-js-test-infra
title: JS 側 test 基盤 (vitest) 導入と viewer の pure function 切り出し
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: ImageData polyfill 確定 / cross-language test 含める / test 件数の根拠)
depends_on: [14-tile-local-db]
blocks: [13-prefetch-emergency-fix, 17b-viewer-tile-endpoint]
---

# Brief 18: JS test 基盤導入

## はじめに

7 軸 audit Round 1 のテスト網羅性軸で **CRITICAL** flag: JS 側に test runner ゼロ、 `package.json` も無い、 関数が global scope 直書きで unit test 不能。 Rule 1 (テストが最初のルール) の射程外。

Round 2 で 3 点追加指摘:
1. `ImageData` polyfill 未確定 (= Node 環境で `canvas` パッケージ追加か Uint8Array 代替かを brief 内で決めろ)
2. cross-language test (Python `tile_coverage.py` vs JS `tile_coverage.js` で同 input → 同 output) を別 brief に逃がさず本 brief に含めろ
3. test 件数 "15-25" の根拠を 4 module × 各境界条件から逆算して明示

本 brief は **vitest 導入 + 4 pure function 切り出し + 各 module の test を明示数で網羅 + cross-language smoke**。 brief 13 と 17b が本 brief 完了を前提に着手する (= dependency に昇格、 brief 13/17b の dependency_on で逆方向 reference)。

## 切り出す pure function (4 lib)

`web/viewer-map3d.js` から下記を `web/lib/` 配下に分離 + export。 viewer 本体の挙動は不変:

### 1. `web/lib/tile_math.js`
- `lonToTileX(lon, zoom) -> number`
- `latToTileY(lat, zoom) -> number`
- `tileXToLon(x, zoom) -> number`
- `tileYToLat(y, zoom) -> number`
- Web Mercator XYZ scheme、 純粋関数

### 2. `web/lib/terrarium.js`
- `gsiPixelToHeight(r, g, b) -> number | null` ── GSI 標高 PNG の RGB → meter (R=128, G=B=0 は無効値、 null 返す)
- `heightToTerrariumRGB(h) -> [r, g, b]` ── meter → terrarium 形式 R-G-B
- `convertGsiPixelsToTerrariumPixels(rgba) -> Uint8ClampedArray` ── 256×256×4 Uint8ClampedArray → 同サイズ
- ImageData 直接受け取りを **避ける** (= 内部 Uint8ClampedArray のみ、 Node で test 可能、 viewer 側で ImageData → array 取り出してから渡す)

### 3. `web/lib/tile_coverage.js`
- `enumerateCoverageTiles(course, zoomLevels, corridorTiles=3) -> Set<string>` ── (z,x,y) を `"z/x/y"` 文字列 set で返す (= Set<tuple> が JS で不便なため)
- `computeBounds(course, bufferM=1000) -> [w, s, e, n]`
- Python `src/fujihc/tile_coverage.py` と **同 logic**、 cross-language test で同値性担保

### 4. `web/lib/heading.js`
- `computeTravelHeading(course, idx, lookAhead=5) -> number` ── degrees, 0=北 90=東
- `clampIndex(idx, length) -> number` ── 境界外を clamp

各ファイルは `export function ...` で外に出し、 viewer-map3d.js は `import {...} from './lib/...'` で読む。

## test 件数の根拠 (4 module × 境界 = 26 件)

### tile_math.test.js (6 件)
- `lonToTileX` happy (z=14, lon=138.7) / boundary (lon=-180) / boundary (lon=180)
- `latToTileY` happy / Mercator 極限 (lat=85) / 往復 (lon → x → lon が誤差内復元)

### terrarium.test.js (8 件)
- `gsiPixelToHeight` 海面 (128, 0, 0) → 0 / 富士山頂 3776m / 海面下 -200m / 無効値 (128, 0, 0 と区別する記号は規約あり、 GSI spec 確認)
- `heightToTerrariumRGB` 0 / 3776 / 負値
- `convertGsiPixelsToTerrariumPixels` 256×256 入力 → 同サイズ / 無効ピクセルが透明扱い

### tile_coverage.test.js (6 件 + cross-language 1 件 = 7 件)
- `enumerateCoverageTiles` corridor=3 で富士ヒル course → 36 タイル at z=14 (brief 14 数値と一致)
- corridor=1 / corridor=3 で差が出る
- 決定性
- `computeBounds` 富士ヒル course → 期待値 (brief 14 数値)
- 1 点 course
- 空 course (= エラーかデフォルト返り)
- **cross-language**: Python の `tile_coverage.py` の `enumerate_coverage_tiles` 出力を fixture (JSON dump) として読み、 JS 版と同値であることを assertion (= 別途 Python から `python -m pytest tests/test_dump_for_js.py` で fixture 生成)

### heading.test.js (5 件)
- 北向き直線 / 東向き / 南向き / 西向き
- lookAhead が course 長を超えるときに clamp

合計 **26 件** (= Round 1 ドラフトの「15-25」を根拠で固定)。 各 module の関数全てが happy + edge + error path のどれかを必ず踏む、 NG-R1-9 (全関数 mandate) 充足。

## tooling

`package.json`:
```json
{
  "name": "fujihc-viewer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

`vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['web/tests/**/*.test.js'],
    environment: 'node',  // browser DOM 不要 (= pure function のみ)
  },
});
```

**ImageData 問題の決着**: terrarium.js の API を「Uint8ClampedArray 入出力」に統一 = Node で `ImageData` polyfill 不要、 `canvas` パッケージも install 不要。 viewer 側で `imageData.data` を取り出してから渡す責務。 これで vitest が Node 純粋環境で走る。

## cross-language fixture 生成

`tests/test_dump_for_js.py` (Python 側、 brief 14 完了条件に組み込み):

```python
import json
from fujihc.tile_coverage import enumerate_coverage_tiles, compute_bounds
def test_dump_fixture_for_js(tmp_path):
    course = json.load(open('web/course.json'))
    tiles = sorted(enumerate_coverage_tiles(course, [14], corridor_tiles=3))
    bounds = compute_bounds(course, buffer_m=1000)
    fixture = {
        'tiles_z14_corridor3': [list(t) for t in tiles],
        'bounds_buf1km': list(bounds),
    }
    out = 'web/tests/fixtures/py_coverage_z14.json'
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(fixture, indent=2))
    # 26 件期待値も assertion
    assert len(tiles) == 36
```

JS 側 `tile_coverage.test.js` がこの fixture を読んで同値 assertion。

## やらないこと

- viewer 全体のリファクタ (= pure function 切り出しのみ、 camera / WebSocket / HUD は brief 19)
- E2E test (= Playwright 等は別 brief)
- FPS / performance HUD 追加 (= 別 brief)
- Cesium 版のリファクタ (= 凍結、 brief 12)
- coverage report の閾値強制 (= 別 brief、 まず素地)

## 完了条件

1. `package.json` + `vitest.config.js` + `.gitignore` に `node_modules/` 追加
2. `web/lib/tile_math.js` / `terrarium.js` / `tile_coverage.js` / `heading.js` の 4 ファイル landed、 export 済
3. `web/viewer-map3d.js` が import 経由で 4 ファイルを使う、 既存挙動を変えない
4. `<script type="module">` 対応のため `web/index.html` 修正 (= brief 12 で rename 後の index.html)
5. `web/tests/` に 4 test ファイル、 計 26 件、 全 pass
6. `web/tests/fixtures/py_coverage_z14.json` が Python test (brief 14 の 1 件として組み込み) で生成、 JS 側がこれを読んで同値 assertion
7. `npm test` 全 26 件 green
8. `pytest` で brief 14-17a の test + 本 brief の fixture 生成 test = 約 40 件 全 green
9. **viewer の実走確認**: browser で 1 周走行、 リファクタ前後で camera 位置 / HUD 数値 / terrain 表示が同じ (= 目視 + DevTools)
10. README に「JS test 実行: `npm install && npm test`」「Python → JS cross-language fixture: `pytest tests/test_dump_for_js.py`」追加
11. ローカル commit、 push しない

## ハマる罠

- viewer-map3d.js を `<script>` 直読みから ES modules import に切り替える時、 `type="module"` が必須、 同時に `index.html` 修正
- vitest は Node 環境で走るが、 GSI dem PNG decode に Canvas 系が要る場合は別途、 本 brief は Uint8ClampedArray API で回避
- Python と JS の浮動小数点演算で微小差が出る、 cross-language test は **タイル座標 set (整数)** で比較するので問題なし、 ただし `computeBounds` の float 値は誤差許容 (`abs(diff) < 1e-9`)
- vitest の `import.meta.url` や `dirname` 系は Node 専用、 JS lib コードは Node 互換に保つ
- viewer-map3d.js から関数を **削除して import で置換** する時に typo すると挙動が変わる、 必ず実走で確認

## まとめ

完了条件: vitest 環境 / 4 lib + 4 test ファイル + 26 件 / cross-language fixture + assertion / `npm test` + `pytest` 全 green / 実走で viewer 挙動不変 / README 更新。

ship される: JS pure logic に test 規律 (= Rule 1 射程内)、 タイル座標計算が Python/JS 同値担保、 brief 13 と 17b の dependency 解消。
ship されない: viewer の描画 / camera / WebSocket / ride state の test (= brief 19)、 framerate 測定 (= 別 brief)。

次の atom: brief 13 と brief 17b が本 brief 完了で動ける、 並行で brief 14-16 を進める。 全完了後に brief 19 (viewer 統合層切り出し) もしくは Phase 2 (Strava integration)。
