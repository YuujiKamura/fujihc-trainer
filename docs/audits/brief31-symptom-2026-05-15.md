# brief 31 (= GitHub Pages 静的サイト化) 起動 wiring 構造的問題

## 症状 (画面検証で発覚 2026-05-15)

`python -m http.server -d web/ 8765` で静的 server を起動し、 Chrome で `http://127.0.0.1:8765/?map=1` を開いたら:

- 地図キャンバスが「描画準備中…」のまま 1 分以上止まる
- console に `Error: GSI tile load failed: http://127.0.0.1:8765/tiles/gsi_dem/13/7256/3226.png` 200 件以上 (= bridge mode 用の URL prefix)
- 静的モードなら `/static/tiles/gsi_dem/...` を要求すべき

## 直前 1 行 fix (= 対症療法、 構造はそのまま)

viewer-maplibre.js の `checkSetupStatus()` line 336:
```
- if (!resp.ok) return { ... bridgeReachable: true };   // 404 も bridge と誤認
+ if (!resp.ok) return { ... bridgeReachable: false };  // 404 = static server
```
+ static_mode.test.js の対応 grep gate も「true 経路は 200/503 の 2 つだけ、 404/non-ok/catch は false」に修正済。
npm 389 全 green。 ただし画面検証は未済 (= Chrome cache か古いタブで old code を見てる疑いで再起動中)。

## 構造的怪しい点 (= 1 行 fix で済まない疑い)

1. **bridge / static の判定軸が `checkSetupStatus()` の 1 fetch に集中**: 失敗時の fallback で bridge と誤認すると path 全体が壊れる
2. **`_bridgeReachable` の module-scope mutable**: 初期値 `true`、 `bootMap()` で更新。 fetch 完了前に何かが参照すると bridge URL を使う race condition
3. **`TILE_BASE_URL = BRIDGE_TILE_BASE_URL` という後方互換 alias**: viewer 内で `${TILE_BASE_URL}/osm_raster/...` が残ってる (line 968)、 これは static mode でも bridge URL を生成してしまう
4. **`buildMapStyle({bridgeReachable})` 内の URL 組立**: 5 箇所で `BRIDGE_*` / `STATIC_*` を if 分岐、 grep gate がないと 1 source 追加で漏れる
5. **`loadCourse` 内も `_bridgeReachable ? 'course.json' : ...static/course.json` の手動分岐**: course / hillshade / osm / osm_raster / minimap raster の 5 種類が独立に分岐してる
6. **MAP_MODE / TEST_MODE の起動順序**: `if (MAP_MODE) initMapMode()` の直後に `ensureMapBooted()` が `checkSetupStatus()` を await するが、 その間に `loadCourse()` 等が `_bridgeReachable` 初期値を見る可能性
7. **テスト側に「true 経路 3 つ」を要求するアサーション** (元 test): grep gate が実装の bug を温存する形になっていた、 test design そのものが構造を間違えた

## 関連 file

- `web/viewer-maplibre.js`
  - line 42-52: BASE_PATH / TILE_BASE_URL 系の宣言
  - line 135-180: buildMapStyle で sources の分岐
  - line 183: `let _bridgeReachable = true;` (初期値 true)
  - line 185-200: bootMap
  - line 320-345: checkSetupStatus (= 直前修正済)
  - line 654-658: ensureMapBooted
  - line 700-740: bootCheckSetupStatus + module top dispatch
  - line 829: loadCourse の URL 分岐
  - line 968: osm_raster fallback で TILE_BASE_URL を直叩き
- `web/tests/static_mode.test.js`: grep gate (= 直前修正済)
- `web/tests/build_map_style.test.js`: 2 mode 別 source URL を pin
- `web/tests/viewer_url_audit.test.js`: 既存 audit gate

## 求める output (= 7 軸の audit report)

軸:
1. register (= viewer / bridge / static の責務境界が正しく分かれてるか)
2. 語彙 (= bridgeReachable / TILE_BASE_URL / BASE_PATH 等の命名が誤読しないか)
3. 抽象段差 (= URL 組立を一箇所に集約できるか、 5 箇所散らばってる現状の妥当性)
4. test (= grep gate が「実装の bug を温存する」test design になっていないか、 unit test と integration の埋め方)
5. 設計境界 (= bridge / static の単一判定軸 vs 各 source 独立判定、 race condition の可能性)
6. マイグレ可逆 (= 旧 TILE_BASE_URL alias を撤去できるか)
7. security (= static mode で外部叩く path が残ってないか、 ODbL / GSI ToS 観点)

各軸で BLOCK / LOAD-BEARING / MINOR を区別、 BLOCK 以上があれば「fix の方向性」を 1 案以上書け。 1 行 fix で済むか、 構造再設計かを判定。

簡潔に、 1 軸 50-150 字、 5 軸合計 1000 字以内。
