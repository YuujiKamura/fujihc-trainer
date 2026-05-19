# brief 31 — reviewer B (= 起動 wiring 構造 audit)

view 重心: runtime order-of-operations / GitHub Pages BASE_PATH 解決 / export_static.py vs viewer 期待 / pages.yml staging。

---

## 1. register (= 責務境界)

**BLOCK**: `_bridgeReachable` の責務が viewer module 全体に染み出している。「**1 fetch で確定する transient な judgement**」を「**module-scope let の常時 readable な world state**」に格上げしている。bridge / static は「**起動時の 1 度だけ env を確定する**」性質の決定 (immutable after boot) だが、`let _bridgeReachable = true` という mutable 宣言で「いつでも変わりうる」semantics を出している。`loadCourse` / `buildMapStyle` / `tick` がそれを別 timing で読む = race door。fix: `let _bridgeReachable` を廃止、`const ENV = { mode: 'bridge'|'static', tileBase, courseUrl, httpBase }` を `bootMap` 内で freeze、全 caller は `ENV` 経由で読む (= 単一 immutable env object)。

## 2. 語彙 (= 命名の誤読率)

**LOAD-BEARING**: `TILE_BASE_URL = BRIDGE_TILE_BASE_URL` の alias は **viewer\_url\_audit の grep gate に追随するためだけ**の dead alias、source の語彙を歪めている。`loadOsmTile` (line 971) が `${TILE_BASE_URL}/osm_raster/...` を直叩き = static mode で localhost を叩く。minimap は static mode で潜在的 broken (= 起動時の OSM 直叩き fallback で救われているだけ)。fix: audit gate を `BRIDGE_TILE_BASE_URL` リテラルに置換、alias 撤廃、`loadOsmTile` を mode 分岐 or static で skip。`BRIDGE_*` / `STATIC_*` / `HTTP_BASE_URL` も**「役割」と「destination」が混在**してる (HTTP\_BASE\_URL も実は bridge 専用)。

## 3. 抽象段差 (= URL 組立の集約)

**BLOCK**: URL 組立が**最低 8 箇所**散らばってる: buildMapStyle 内 2x source、loadCourse 1、loadOsmTile 1、buildMinimapTopBase POST 1、startFetchGsi POST 1、startOsmExtract POST 1、checkSetupStatus 1。これらを「bridge mode 専用 endpoint (POST /\_fetch\_gsi / \_extract\_osm / \_fetch\_minimap\_raster / \_setup\_status / WS)」と「2-mode tile/course」に分離すべき。fix: `const ENDPOINTS = { setupStatus, fetchGsi, extractOsm, minimapRaster, osmTile, gsiDemTile, courseJson, mapStyleSources }` を 1 箇所で構築、`bootMap` で mode を渡して resolve、以後の caller は ENDPOINTS の field 名で参照のみ。これで grep gate も「ENDPOINTS の field 集合」を pin する形に簡略化される。

## 4. test (= grep gate が bug を温存)

**BLOCK**: `static_mode.test.js` の「true 経路 3 / false 経路 1」アサーション (= 修正前) が **bug そのものを literal にコピペした gate**。grep gate は「実装と test が同型に進化する」前提だが、本件は「**実装の bug を test が pin する**」逆方向に動いた。これは brief 31 単独の事故ではなく、**source-grep test design pattern 全体の構造欠陥**。fix: grep gate は「**仕様の literal**」のみを pin、「**実装の数え上げ**」を pin しない。`bridgeReachable: true` の出現数を数えるな、「200 / 503 → true」「404 / catch → false」を**仕様文として decision table 化**して個別 unit test (= viewer から checkSetupStatus を export して fetch を mock、行動 test) で押さえろ。grep は「`AbortSignal.timeout(500)` が存在」までで止める。

## 5. 設計境界 (= race + 単一判定軸)

**BLOCK**: order-of-operations を 1 step ずつ追うと race window が 3 箇所。(a) `let _bridgeReachable = true;` (line 183、初期値 true) → script 評価 → module top `if (MAP_MODE) initMapMode()` (line 737) は async `ensureMapBooted()` を kick → checkSetupStatus が pending の **500ms** 間、もし他の code path (例えば setup-overlay button bind / `addEventListener` 内 closure) が `_bridgeReachable` を読めば true 誤認。(b) `initMapMode` が `if (!map) { ensureMapBooted().then(initMapMode); return; }` で 2 度呼ばれる構造 → 1 度目で kick した checkSetupStatus と、`bootCheckSetupStatus` 経路 (default) で kick する checkSetupStatus が**同時に 2 本走る可能性** (MAP\_MODE 経路では bootCheckSetupStatus は呼ばれないので実害なしだが、構造が脆い)。(c) `loadCourse` は `ensureMapBooted` → `map.on('load')` の後で初めて呼ばれるなら safe だが、**`map.on('load')` 内で loadCourse が呼ばれてる箇所が viewer 内に明示無く**、tick callback 系で参照される `_bridgeReachable` 初期 true は static mode で 1 frame 漏れうる。fix: `_bridgeReachable` を完全削除し `ENV` immutable object に置換、起動 dispatch を 1 本化 (= 4 branch 全部が `await bootEnv()` を通る単一 entry)、`bootEnv()` 内で **全 URL を resolve してから** `bootMap` / `initXxx` を呼ぶ。

## 6. マイグレ可逆 (= 旧 alias 撤去)

**MINOR**: `TILE_BASE_URL` alias は viewer\_url\_audit.test.js の 3 行 (`tile_math` / `osm_raster` / `TILE_BASE_URL`) のためだけに残ってる。audit gate を「`BRIDGE_TILE_BASE_URL`」literal に rewrite すれば即撤去可。後方互換用件は実質ゼロ (= 内部 const、外部 consumer 無し)。fix: 1 commit で `TILE_BASE_URL` → `BRIDGE_TILE_BASE_URL` 全置換 + audit test 修正。

## 7. security (= ToS / 外部叩く path)

**LOAD-BEARING**: static mode (= GitHub Pages) で `loadOsmTile` の `${TILE_BASE_URL}/osm_raster/...` が **`<user>.github.io/tiles/osm_raster/13/...`** に解決される (= BRIDGE base = `${location.origin}/tiles`、BASE\_PATH を経由しない) → 404 連発 → onerror fallback で `https://tile.openstreetmap.org/...` を直叩き。**GitHub Pages 訪問者全員が OSM を直叩きする** = OSM ToS の "heavy use" / attribution の責務が viewer 公開元 (= yuujikamura.github.io) に移る。さらに `pages.yml` line 47-52 の `cp web/static _site/static` は OK だが、**`web/static/` を user が `python scripts/export_static.py` する前に push したら空 dir で deploy** される (= `.gitignore` 状況によっては staging で `cp -r web/static` が失敗) → CI silent break か空 static で deploy。fix: (a) `loadOsmTile` を mode 分岐、static mode では minimap OSM 直叩きを最初から skip するか `${STATIC_TILE_BASE_URL}/tiles/osm_raster/...` 経路を export\_static.py に追加。(b) pages.yml で `web/static/` 存在チェック + 中身件数チェック (= `[ -d _site/static/tiles/gsi_dem ] || exit 1`) を staging step に追加。(c) `scripts/export_static.py` は `tiles/gsi_dem/` を出してるが viewer は `${STATIC_TILE_BASE_URL}/tiles/gsi_dem/...` を期待 = path 一致 OK。ただし pmtiles の path は viewer が `${STATIC}/map.pmtiles`、export が `out_dir / "map.pmtiles"` = OK。`course.json` も OK。

---

## verdict

**構造修正 NEED**。1 行 fix (line 339) は症状を消すが、`_bridgeReachable` mutable + URL 散在 + grep gate が bug を pin + `TILE_BASE_URL` alias が static mode で localhost を叩く構造はそのまま残る。次の brief で `?map=1` を public Pages 上で叩いた瞬間、minimap で OSM 直叩き → ToS exposure が顕在化する (= reviewer A が見てない第三者 harm vector、Rule 11 class C1 隣接)。最低限 fix すべき順序:

1. `loadOsmTile` の static mode 経路を確定 (= ToS 由来、最優先)
2. `_bridgeReachable` を immutable `ENV` object に置換
3. URL を `ENDPOINTS` に集約
4. grep gate を「仕様 literal」に書き直して bug-pin を解除
5. `TILE_BASE_URL` alias 撤去
6. pages.yml に `web/static/` 存在 + 中身件数の guard 追加
