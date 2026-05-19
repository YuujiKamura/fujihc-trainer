# brief 31 構造修正 round 2: zoom 範囲不一致

## 症状 (画面検証 2 度目、 commit 83c34b1 状態)

`python -m http.server -d web/ 8765` 起動 + Chrome で `http://127.0.0.1:8765/?map=1` を fresh profile で開いた DevTools console 画面:

- **bridge URL `/tiles/...` への要求は完全に消失** (= commit α/β/γ の構造修正は効いてる)
- 全 fetch が `/static/...` 経路
- しかし z=14 の周辺 + z=12 / z=13 の overview tile (例: `/static/tiles/gsi_dem/12/3626/1614.png`, `/static/tiles/gsi_dem/14/14509/6452.png`) が **404 量産** (= console に 100 件以上)
- 結果、 地図 canvas は灰色のまま「描画準備中…」が消えない
- HUD (= dist 0/? m, ack OK MAP MODE) は出てるので JS 実行は正常

## 原因仮説

1. **viewer の MapLibre 設定 (= maxTileCacheSize / minzoom 13 / maxZoom 24 + pitch 60) が広域低 zoom overview を要求**するが、 `scripts/export_static.py` の出力 zoom 範囲は z=14 中心の富士山ピンポイントのみ
2. viewer の `buildMapStyle` 内 gsi-terrain source は `minzoom: 8, maxzoom: 14` で MapLibre に z=8 まで広域要求を許可
3. しかし export_static.py は z=14 周辺の数百タイルだけ出力、 z=8-13 の overview や z=14 でも富士山以外の周辺領域は出してない
4. **viewer の zoom 範囲設定と export_static.py の出力範囲が独立に書かれてる、 grep gate ゼロ** = 別 brief で片方が変わると即 unsync 入る (= brief 31 構造問題の延長)
5. さらに、 描画完了しないまま loading indicator 6秒 timeout fallback が走るはずだが画面で消えてない、 これは別 bug (= map.idle が永遠 fire しない時の fallback が壊れてる疑い)

## 確認すべき事実

- `scripts/export_static.py` で実際に出してる zoom と bbox
- `tile_constants.py` の OSM_VECTOR_ZOOMS / GSI_DEM_ZOOM_RANGE 等の定数
- viewer の hillshade source 設定 (minzoom/maxzoom)
- viewer の `bootMap` 内 maxZoom / minZoom
- MAP_MODE 起動時の loading indicator 6 秒 timeout fallback (= `setTimeout(hideLoading, 6000)` 系)

## 求める audit (7 軸)

軸:
1. register (= viewer と export の責務境界、 zoom 範囲を誰が決めるか)
2. 語彙 (= zoom / minzoom / maxzoom / OSM_VECTOR_ZOOMS 等の命名と意味)
3. 抽象段差 (= zoom 範囲を single source of truth に集約できるか、 現状 4-5 箇所散在)
4. test (= viewer 要求と export 出力の不一致を grep gate で物理 block できるか)
5. 設計境界 (= MAP_MODE の loading indicator 6 秒 fallback がなぜ効いてないか)
6. マイグレ可逆 (= zoom 範囲を変えた時の export 再実行コスト)
7. security (= 広範囲 export で GSI / OSM への heavy fetch 発生しないか、 1 req/sec rate limit 維持)

各軸 50-150 字、 BLOCK / LOAD-BEARING / MINOR、 BLOCK 以上で fix 方向性。 全体 1000 字以内。 reviewer A と B で別角度 (A は責務境界 + test、 B は runtime 動作 + GitHub Pages 公開時の容量)。
