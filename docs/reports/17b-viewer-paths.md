# brief 17b: viewer 外部 fetch ゼロ化

## やったこと

`web/viewer-maplibre.js` から外部第三者 endpoint への runtime fetch を物理的にゼロ化。
gate は新規 `web/tests/viewer_url_audit.test.js` の 4 件 source-grep assertion で固定。

### 1. TILE_BASE_URL 定数追加 (line 7 付近)
- `const TILE_BASE_URL = ${location.origin}/tiles;` を MapLibre 初期化前に宣言。
- 以降の全タイル URL はこの定数経由でしか組み立てない。

### 2. main map source URL を localhost に切替
- `'osm'` source: tiles を `${TILE_BASE_URL}/osm/{z}/{x}/{y}.png` に。 type は `raster` のまま (= brief 16 の PMTiles 統合は別 brief、 拡張子だけ .png のまま tile_server.py 側の routing に合わせる)。
- `'gsi-terrain'` source: tiles を `gsidem://${TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png` に。 `addProtocol('gsidem', ...)` の変換ロジックはそのまま残し、 内部 fetch URL のみ localhost に向ける (= 選択肢 A: ES modules 化はしない)。

### 3. minimap の OSM 直叩きを廃止
- `loadOsmTile` 関数を完全削除。
- `buildMinimapBase` 内の OSM タイル fetch ループを削除し、 上半分を単色背景 (`#e8e8e8`) で塗る実装に置換。 course polyline + 標高曲線で全体俯瞰の責務は維持。
- minimap タイル経由化 (= ローカル経由で OSM タイル表示) は別 brief、 本 brief は「外部 fetch ゼロ」が主目的。

### 4. prefetchTilesAlongCourse + 関連 dead code 完全削除
- 関数本体 (旧 line 529-566) 削除。
- 呼出側の comment out + `console.info('[fujihc] prefetch frozen...')` 削除。
- 関連の未使用変数 `lastJumpToT` / `JUMP_INTERVAL_MS` 削除 (= grep で参照ゼロを確認済)。
- minimap が外部タイル取得をやめた結果、 タイル座標変換ヘルパ (`lonToTileX` / `latToTileY` / `tileXToLon` / `tileYToLat`) も参照ゼロになったため削除。 必要になれば `web/lib/tile_math.js` を import する設計に統一する (= brief 18 残り)。

### 5. 新規 source-grep gate test
`web/tests/viewer_url_audit.test.js` に 4 件:
- `tile.openstreetmap.org` の URL 文字列を含まない
- `cyberjapandata.gsi.go.jp` の URL 文字列を含まない
- `TILE_BASE_URL` を使う
- `prefetchTilesAlongCourse` 関数定義を含まない (= dead code 削除済)

これで 1 ヶ月後に誰かが OSM 直叩きを復活させた瞬間に `npm test` が fail する。

## 確認結果

### `npm test`
- 36 tests passed (前回 32 既存 + 新規 4 = 36)。 (※ brief の「既存 27 件」表記は古く、 peer B の tile_coverage 追加分などで現時点 32 件、 全件 green)
- 内訳:
  - `web/tests/heading.test.js`: 5
  - `web/tests/tile_math.test.js`: 6
  - `web/tests/terrarium.test.js`: 9
  - `web/tests/tile_coverage.test.js`: 12
  - `web/tests/viewer_url_audit.test.js`: 4 (NEW)

### `pytest -q`
- 111 passed, 4 skipped (= 既存 baseline 維持、 viewer 編集だけなので Python 側に影響なし)

### 削除行数
- 元: 735 lines
- 後: 689 lines
- 差分: -46 lines (dead code + 外部 URL 直叩き削除)

## やらなかったこと (= scope 外、 別 brief 待ち)

- viewer-maplibre.js の全体 ES modules 化 (= brief 18 残り)
- `web/lib/terrarium.js` への addProtocol 変換ロジック委譲 (= 選択肢 A 採用、 ES modules 化と一括で行う)
- 503 fallback DOM (= 別 brief)
- camera tick / WebSocket / ride state のリファクタ (= brief 19)
- browser 実走確認 (= AI 不能、 user 手動)
- minimap への local タイル経由地図表示 (= 単色背景に簡略化、 別 brief で改善)

## peer 干渉

なし。
- peer B (`web/lib/tile_coverage.js`) と peer C (`scripts/init_tile_db.py`) には触っていない。
- 編集 file は `web/viewer-maplibre.js` + 新規 `web/tests/viewer_url_audit.test.js` のみ。
- `web/index-maplibre.html` は元から外部 URL 参照がなく編集不要だった。

## commit suggest

```
brief 17b: viewer 外部 fetch ゼロ化 + source-grep audit gate

- viewer-maplibre.js: TILE_BASE_URL 経由に切替、 OSM/GSI 直叩き削除
- prefetchTilesAlongCourse + 関連 dead code 完全削除 (-46 lines)
- minimap の OSM 直叩きを単色背景に置換 (= 外部 fetch ゼロ優先)
- web/tests/viewer_url_audit.test.js: 4 件 source-grep gate
- npm test 36 green / pytest 111 passed (baseline 維持)
```

DONE: brief 17b viewer paths -46 lines
