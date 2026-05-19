# brief 31 round 2 review B (runtime + Pages 容量 + ToS)

## 事実確認 (DB / export 実測)

- `data/tiles.sqlite`: 18 MB, 179 GSI dem tile (z=8:2, 9:2, 10:2, 11:6, 12:12, 13:35, 14:120) + 129 OSM vector tile (z=13/14/15).
- `web/static/tiles/gsi_dem/`: 179 PNG export 済 (z=8..14 全部). **DB と export は同期している**。
- ところが `tile_constants.GSI_DEM_ZOOMS = [14]`、 `dbinit.fetch_gsi_async(zoom=GSI_DEM_ZOOMS[0])` で **fetch path は z=14 only**。 z=8-13 の 59 tile は constants の外で history 的に流入 (= 中央定数の single source of truth が破れている)。
- z=8-14 の x/y bbox は course corridor (= 富士スバルライン沿いの細帯) のみ、 富士山山体全体を覆っていない。 viewer は center [138.7587, 35.4521] pitch=60 maxZoom=24 で広域 overview を要求 → corridor 外で 404 量産。

## 7 軸

### 1. register (viewer 要求 vs export 出力の責務)
**BLOCK**。 viewer は「z=8-14 raster-dem + broad view」を declare、 export は「course corridor のみ」を出す。 責務が overlap して両方が zoom 範囲を独立に決めている。 fix 方向: **viewer 側の source minzoom を引き上げる** (z=13 か 14) か、 **export 側を bbox 列挙に切替** (= MINIMAP_BBOX と同じパターンで富士山山体 bbox を中央定数化)。 後者推奨、 山体描画は user 要求。

### 2. 語彙
**LOAD-BEARING**。 `GSI_DEM_ZOOMS=[14]` という命名が「zoom range」を装って「fetch zoom」しか表していない。 viewer 側の minzoom=8/maxzoom=14 と意味が一致せず、 中央定数のはずが信用できない。 fix: `GSI_DEM_FETCH_ZOOM=14` + `GSI_DEM_VIEW_ZOOM_RANGE=(8,14)` に分離、 viewer 側 source も constants 参照に統一。

### 3. 抽象段差
**BLOCK**。 zoom 範囲が (a) tile_constants.GSI_DEM_ZOOMS, (b) viewer buildMapStyle minzoom/maxzoom, (c) bootMap maxZoom/minZoom, (d) export_static (= 暗黙、 DB 全件), (e) GSI metadata minzoom/maxzoom の 5 箇所に散在。 fix: tile_constants を SSoT 化、 viewer は static asset として `tile_ranges.json` を生成して読む (= build 時 emit、 grep gate)。

### 4. test (grep gate)
**BLOCK**。 viewer の minzoom=8 と DB の z=8 spatial coverage を物理 block する gate なし。 fix: `tests/test_export_coverage.py` で「viewer source.minzoom..maxzoom の全 zoom 範囲で、 富士山山体 bbox の tile が 100% 出力されているか」を assert、 不足なら CI fail。 viewer JS 側の minzoom 値も import + 一致 check。

### 5. 設計境界 (loading indicator fallback)
**LOAD-BEARING**。 `map.once('idle')` 6 秒 fallback は実装されてる (line 800)、 mapIdle=true → tryStart → loader hide まで動くはず。 画面で消えてないなら rideReady 側 (setInterval) が動いていない可能性、 もしくは `loader = document.getElementById('loading-indicator')` の DOM 要素自体が無い (= 旧 HTML に存在しない可能性)。 fix: `index.html` の `#loading-indicator` 存在を grep gate + DOM 存在しない時に warn 出す。

### 6. マイグレ可逆
**MINOR**。 z=8-13 を bbox 列挙で再 fetch しても GSI 1 req/sec で 富士山 0.4°×0.3° bbox = z=8(1) + z=9(2) + z=10(6) + z=11(20) + z=12(70) + z=13(280) ≈ **380 tile / 約 6 分 30 秒**。 既存 z=14 corridor 120 と合わせて ~500 tile / ~9 分。 DB 増分 ~75 MB (= 現 17 MB + 60 MB)。 fully reversible。

### 7. security (Pages 容量 + GSI ToS)
**LOAD-BEARING**。
- **Pages 容量**: repo 1 GB / artifact 10 GB / single file 100 MB。 500 tile × ~200 KB ≈ 100 MB。 repo 1 GB に余裕、 artifact / single file 制限も clear (= map.pmtiles 4 MB + tiles.sqlite 18 MB → 100 MB 級)。
- **GSI ToS (大量アクセス自粛)**: 1 req/sec 維持で 380 tile = 6.3 分、 ToS 「大量アクセス」閾値の安全側。 ただし **course 外の山体 bbox を fetch する正当性 (= 視覚要求)** を README + UA + metadata に明記すべき。
- **OSM PMTiles**: pmtiles:// は単一 file 全 zoom 内包 (z=0-15)、 broad zoom は PMTiles 側で OK、 追加 export 不要。 raster とは別経路。

## verdict

BLOCK 3 件 (register / 抽象段差 / test gate)、 LOAD-BEARING 3 件 (語彙 / loading indicator / security)、 MINOR 1 件 (マイグレ)。 構造修正必須、 viewer/export 双方を tile_constants の SSoT に巻き直し + bbox 列挙 + grep gate の 3 点 fix で round 2 を閉じる。
