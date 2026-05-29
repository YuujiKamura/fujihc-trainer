# brief 31 構造修正 directive (= reviewer A + B 統合、 2026-05-15)

## 統合判定

両 reviewer 共通 BLOCK:
- 抽象段差: URL 組立が 8 箇所散らばってる、 line 971 で現に bug 漏洩
- test: 「出現回数 == N」 grep gate が **実装の bug を温存** (= 元 test が「true 経路 3 つ」を要求 = 404 も true にする実装を強制)

B 追加 BLOCK:
- register: `let _bridgeReachable` の module-scope mutable + 初期値 true = race door 3 箇所
- 設計境界: `MAP_MODE` 起動で `ensureMapBooted` await 中の 500ms 間、 他 caller が初期値 true を読む可能性

B 追加 LOAD-BEARING (= 第三者 harm vector、 最優先):
- security: **static mode (= GitHub Pages) で minimap OSM が `${TILE_BASE_URL}/osm_raster/...` = `<user>.github.io/tiles/osm_raster/...` を叩く → 404 → onerror で `tile.openstreetmap.org` 直叩き fallback → GitHub Pages 訪問者全員が OSM ToS heavy use 違反 / attribution 責務が viewer 公開元に移る**。 Rule 11 class C1 隣接 harm。

## 修正の 3 commit 構成 (= 直列、 viewer-map3d.js が全 commit で触られるため並列不可)

### commit α: 第三者 harm の即時 close + alias 撤去
1. `TILE_BASE_URL = BRIDGE_TILE_BASE_URL` alias を完全撤去 (= line 52 削除)
2. `loadOsmTile` (line 971 付近) を mode 分岐:
   - bridge mode: 従来通り `${BRIDGE_TILE_BASE_URL}/osm_raster/...` で bridge から取得
   - static mode: **OSM 直叩き fallback を最初から無効化**、 失敗時は灰色 tile (= placeholder) で諦める
3. `web/tests/viewer_url_audit.test.js` の `TILE_BASE_URL` リテラル grep を `BRIDGE_TILE_BASE_URL` に rename
4. `web/tests/static_mode.test.js` に「static mode で OSM 直叩き fallback が走らない」 behavioral test 追加 (= grep ではなく仕様 literal)
5. CSP `img-src` から `https://tile.openstreetmap.org` を **明示的に除外**保証 (= 元から無いが、 regression block で grep gate 1 行)

完了条件: npm test + pytest 全 pass、 README 上の「(c) は ToS 範囲内 1-shot」記述があれば更新。

### commit β: `_bridgeReachable` mutable → immutable ENV object
1. `let _bridgeReachable = true;` 削除
2. 新規 module-scope const として `let ENV = null;` 宣言、 起動 entry で 1 回だけ resolve
3. 新規 helper `async function bootEnv()`:
   ```js
   async function bootEnv() {
     if (ENV) return ENV;
     const s = await checkSetupStatus();
     ENV = Object.freeze({
       mode: s.bridgeReachable ? 'bridge' : 'static',
       tileBase: s.bridgeReachable ? BRIDGE_TILE_BASE_URL : STATIC_TILE_BASE_URL,
       courseUrl: s.bridgeReachable ? 'course.json' : `${BASE_PATH}static/course.json`,
       httpBase: location.origin,
       setupStatus: s,
     });
     return ENV;
   }
   ```
4. 全起動 entry (`MAP_MODE` / `TEST_MODE` / `BLE_MODE` / default) を `await bootEnv()` 経由に一本化、 その後 `bootMap(ENV)` / `initXxx()` を呼ぶ
5. `buildMapStyle` / `loadCourse` / `bootMap` を ENV 引数受けに改める、 `_bridgeReachable` 参照 全削除
6. `bootMap(env)` の signature 変更で test `build_map_style.test.js` を ENV ベースに書き換え

完了条件: race window 3 箇所が構造的に消失、 npm test + pytest 全 pass、 source-grep で `_bridgeReachable` ゼロヒット。

### commit γ: grep gate を仕様 literal に書き換え + behavioral test 追加 + pages.yml guard
1. `web/tests/static_mode.test.js` の「出現回数 == N」アサーション撤廃、 代わりに:
   - `checkSetupStatus` を viewer から export
   - `fetch` を `vi.spyOn(global, 'fetch')` で stub、 200/503/404/timeout/network error の 5 経路を behavioral test
   - 各経路で戻り値の `bridgeReachable` が期待 boolean になることを assert
2. `buildMapStyle` を ENV 引数で呼んで戻り値 object を snapshot test (= bridge/static 2 fixture)
3. `viewer_url_audit.test.js` の「TILE_BASE_URL リテラル」要求行を撤廃 (= alias 自体が消えた)
4. `.github/workflows/pages.yml` の staging step 直後に guard:
   ```yaml
   - name: Verify static assets staged
     run: |
       test -f _site/static/map.pmtiles || (echo "ERROR: map.pmtiles missing" && exit 1)
       test -f _site/static/course.json || (echo "ERROR: course.json missing" && exit 1)
       count=$(find _site/static/tiles/gsi_dem -name '*.png' | wc -l)
       test "$count" -ge 100 || (echo "ERROR: gsi_dem tiles missing (count=$count)" && exit 1)
   ```
5. `scripts/export_static.py` を未実行で push したら CI が止まる事を確認 (= 空 deploy 防止)

完了条件: npm test + pytest 全 pass、 grep gate を撤廃した分の coverage を behavioral test が補完してる事を確認。

## 完了後

- 静的サーバ (`python -m http.server -d web/ 8765`) で `?map=1` 起動して目視確認 (= 地図描画、 minimap、 trkpt 蓄積、 GPX download)
- audit-drift-catalog.md に「grep gate が実装の bug 形状を pin する anti-pattern」を NG entry として追加
