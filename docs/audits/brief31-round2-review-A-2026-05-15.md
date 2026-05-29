# brief 31 round 2 audit — reviewer A (責務境界 + test gate)

## 1. register (責務境界) — **BLOCK**

zoom 範囲の真実源が分裂している。 `tile_constants.py` は fetch / extract 側の SoT を主張 (`GSI_DEM_ZOOMS=[14]`, `OSM_VECTOR_ZOOMS=[13,14,15]`), `viewer-map3d.js` は描画側で `gsi-terrain.minzoom:8 / maxzoom:14`, `map.minZoom:13` を**独立 hardcode**, `export_static.py` は DB 内容を**そのまま流すだけ** (zoom 範囲を聞く責務なし)。 viewer が「z=8 まで要求していい」と宣言する一方、 fetch / export には z=8-13 が一切無い。 fix: zoom contract を `tile_constants.py` に集約 (例: `GSI_DEM_VIEWER_MIN_ZOOM=14`)、 viewer は build 時 (= index.html や `<script type=module>` 経由 JSON 注入) で同一値を取り、 `gsi-terrain.minzoom = max(GSI_DEM_VIEWER_MIN_ZOOM, ...)` に bind。

## 2. 語彙 — **LOAD-BEARING**

`minzoom` (source 側、 「この zoom 未満を要求するな」) と `minZoom` (map 側、 「この zoom 未満に zoom out させない」) が**同名近似で別意味**。 viewer の `gsi-terrain.minzoom:8` は「z=8 まで降りても fetch していい」と読めるが、 実際の意図は「z=14 のみ存在」。 fix: 命名を `_viewer_floor` / `_dataset_min` / `_dataset_max` に label し直し、 dataset 側 (= 持ってる) と viewer 側 (= 要求する) を語彙で分離。

## 3. 抽象段差 — **BLOCK**

zoom 範囲が 5 箇所散在: (a) `tile_constants.GSI_DEM_ZOOMS`, (b) `viewer.gsi-terrain.minzoom/maxzoom`, (c) `viewer.map.minZoom/maxZoom`, (d) `dbinit` metadata, (e) `export_static.py` (= 暗黙、 DB に従う)。 brief 31 構造修正の根因はこの段差未整理のまま commit α/β/γ を打ったこと。 fix: 「dataset zoom 集合」「viewer 要求 zoom 範囲」「map 操作 zoom 範囲」の 3 層に明示分割、 `tile_constants.py` に 3 set 並置 + 不変条件 (`viewer 要求 ⊆ dataset`) を assert 関数化。

## 4. test (grep / runtime gate) — **BLOCK**

`tests/test_export_static.py` は **bytes 不変 + URL grep のみ**、 「viewer が要求する zoom 全部が DB / export に存在する」 contract test がゼロ。 z=8-13 抜けは現行 test を 100% pass で素通り。 pages.yml の件数 guard (`dem_count >= 100`) も「viewer が要求する zoom 範囲を満たしてるか」を聞いておらず、 z=14 だけ 100 タイル並んでれば緑になる。 fix: (1) `tests/test_zoom_contract.py` で `viewer-map3d.js` を静的 parse して `gsi-terrain.minzoom..maxzoom` を抽出 → `GSI_DEM_ZOOMS` の min/max と一致 assert。 (2) export 後の `_site/static/tiles/gsi_dem/<z>/` dir 存在を viewer 要求 zoom 全部で確認する CI step を pages.yml に追加。 これは「実装したけど結合 test なし」の典型 anti-pattern (= AI 大量生成 test の slip)。

## 5. 設計境界 (6 秒 fallback) — **LOAD-BEARING**

`viewer-map3d.js:800` の `setTimeout(() => { ... mapIdle = true; tryStart(); }, 6000)` は `initMapMode` 内 + `rideState` 準備済が条件。 画面で消えないのは fallback が走ってないのではなく、 **`loader.style.display='none'` が `tryStart` 内でのみ実行**で、 `rideReady` が false のまま (= `wsHandlers` / `rideState` 初期化が 404 連発で詰まる) なら `tryStart` 内の early return で loader が永遠に消えない。 fix: fallback timer を「loader hide」と「ride start」で分離、 6 秒経過したら **rideReady 無関係に loader だけは hide** + 警告 banner 表示。

## 6. マイグレ可逆 — **MINOR**

zoom 範囲を z=8-13 まで広げると `enumerate_coverage_tiles` の corridor 計算で `[8,9,10,11,12,13,14]` 列挙 + GSI 1req/sec で時間爆発 (z=8 は 1 タイルだが z=13 で数百)。 ただし dbinit は idempotent (= skip 済はスキップ) で可逆性は保たれる。 fix: zoom set を「viewer 要求最小 (= overview 1-2 枚)」と「ride 視点 (z=14-15)」で 2 段管理、 overview は bbox 全域 1 タイル、 ride 視点は corridor。

## 7. security (heavy fetch) — **MINOR**

z=8 を corridor 3 で取ると数タイルで終わるが、 z=11-13 を corridor 3 で取ると数百タイル + GSI 1 req/sec で十数分。 ToS 違反ではないが、 build runner 毎回これを走らせると CI 時間爆発。 fix: GitHub Actions では DB を commit 済前提 (= 既に pages.yml はそう)、 zoom 拡張時の初回 fetch は user ローカルでのみ走らせる規律を docs に明文化。

## 全体 verdict

zoom 契約が 5 箇所散在 + 結合 test ゼロ = brief 31 commit α/β/γ で塞いだ「bridge / static 分裂」の構造問題が、 zoom 軸で再演。 BLOCK 3 件 (register / 抽象段差 / test) は同一根 = **zoom contract を tile_constants.py に集約 + viewer parse test で物理 pin**。 LOAD-BEARING 2 件 (語彙 / 6 秒 fallback) は独立修正可。
