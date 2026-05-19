---
brief: 29-minimap-osm-direct
title: minimap を旧 OSM 直叩き方式に rollback (= brief 28 MapLibre 2nd 撤回、 ToS 範囲内 1-shot 9 タイル)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [13-prefetch-emergency-fix, 17b-viewer-tile-endpoint, 28-minimap-maplibre]
blocks: []
---

# Brief 29: minimap を旧 OSM 直叩き方式に rollback

## はじめに

user 訂正 (= 引用):

> これミニマップは旧版のやり方でタイル取ってきてもそんなに配布先に負担がかからないんではないのか？ ここだけ以前の実装に戻したらどうだ。 Git の履歴辿って

経緯整理:

- brief 13 (= 2026-04-30 緊急 freeze) で `prefetchTilesAlongCourse` を物理削除。 ride 開始時 OSM 2700 タイル + GSI dem 450 タイル並列 fetch は OSM Tile Usage Policy の bulk DL 禁止条項 + GSI 標高タイル利用規約に明確違反 (= NG-R1-15)、 ToS 侵害事故。
- 巻き添えで brief 17b は viewer 内の OSM/GSI 直叩き全面禁止に振った (= `viewer_url_audit.test.js` L16-22 の grep gate)。 ride 中の hot path だけでなく、 起動時 1 回・低 zoom 数枚の minimap base 取得まで道連れで遮断。
- minimap base は本来 ToS 安全側 (= 個人小規模・1-shot・低 zoom 数枚) で OSM Tile Usage Policy の制約範囲内、 巻き添えの過剰反応だった。
- brief 28 で「ローカル経由 OSM vector の 2nd MapLibre instance」を試したが visual 機能せず (= 直前 commit `ce10cb3` で staged)、 また実装規模が大きく minimap という UI 部品にしては overkill。
- user 判断: minimap だけ旧方式 (= z=11 周辺 9 タイルを 1 回 fetch、 canvas drawImage) に戻す。 ToS 範囲内 1-shot DL であれば配布先 (= OSM タイルサーバ) への負担は無視できる範囲。

本 brief の責務は「brief 28 で建てた MapLibre 2nd instance を撤回し、 commit `2c1e116` 時点の canvas + loadOsmTile + drawImage minimap を復活させる」+「物理 gate (= 17b 全面禁止) を minimap 限定で緩和する」の 2 点のみ。 main viewer の ride 中タイル fetch は brief 13 + 17b の物理 freeze 維持 (= 絶対変更しない)。

## 何が今足りないか (= 現状)

- `web/viewer-maplibre.js` L715-765 `initMinimapMap`: 2nd MapLibre instance を立て `buildMapStyle()` を共有、 fitBounds(course) で固定俯瞰、 course polyline + start/goal markers + rider Marker (cyan) を載せる構造。 ── **visual 機能していない** (= 灰白固定で OSM が出ない、 user 確認済)。 推定要因は MapLibre 2nd instance の resize timing / canvas size 0 / source-layer 名 mismatch / minzoom 13 で z=11 リクエストが空振り、 等の複合だが diagnose せずに rollback する判断 (= brief 14-16 の OSM PMTiles 整備 ≠ 即 minimap で動く、 だった)。
- `web/index.html` L257-260: `#minimap-container` div の中に `<div id="minimap-top">` (= MapLibre container) + `<canvas id="minimap-bottom">` の 2 要素。 旧 1 canvas 構造 (= commit `2c1e116` の `<canvas id="minimap" width="320" height="720">`) は廃止済。
- `web/tests/viewer_url_audit.test.js` L16-22: `tile.openstreetmap.org` / `cyberjapandata.gsi.go.jp` への 直叩きを全面禁止 grep gate。 brief 17b の物理 freeze。 minimap 限定の例外を持たない。
- `web/tests/minimap_maplibre.test.js` (= 16 件): brief 28 の MapLibre 2nd instance を pin する gate。 rollback すると全件 obsolete。
- 結果: ride 中の全体俯瞰で道路 / 緑地 / 水域が出ず、 user は polyline 1 本と標高曲線しか見れない (= brief 28 前の状態と実質同じ、 だが実装は brief 28 の MapLibre 2nd instance で複雑化)。

## あるべき構造

```
+ #minimap-container (left top, absolute, 320x720) ───────+
| #minimap-top canvas (320 x 561 = 78%)                   |
|   = course bbox を覆う z=11 周辺 9-16 OSM タイル        |
|     を起動時 1 回 fetch して drawImage                  |
|     + course polyline (= ctx.stroke で手描き)           |
|     + start/goal dot (= ctx.arc で手描き)               |
|     + rider 三角形 (= 毎フレーム drawDirTriangle で上書き)
|     fetch は loadOsmTile で 1-shot、 ride 中 再 fetch せず
+---------------------------------------------------------+
| #minimap-bottom canvas (320 x 159 = 22%)                |
|   = 標高プロファイル (= 現行 buildMinimapBottom 維持)   |
|     塗り gradient + 白線 + min/max ラベル + rider 縦線/dot
+---------------------------------------------------------+
```

key point:

1. `#minimap-top` は MapLibre instance ではなく **2D canvas** (= 旧版踏襲)。 fetch + drawImage 完結、 MapLibre のライフサイクル管理ゼロ。
2. OSM タイル fetch は `https://tile.openstreetmap.org/{z}/{x}/{y}.png` を `new Image()` の `src` 直指定で行う (= browser が自動で `User-Agent: Mozilla/...` を送る、 OSM Tile Usage Policy の `User-Agent 必須` 条項を browser 自動 UA で満たす)。
3. ride 中の minimap 再描画 (= `updateMinimap`) は base 画像の上に rider 三角形を上書きするだけ、 OSM 再 fetch 一切なし (= 起動時 1-shot の不変)。
4. main viewer (= ride 中の地形描画) は brief 13 + 17b の物理 freeze 維持。 `prefetchTilesAlongCourse` 復活絶対禁止。 main map source は `${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf` (= local DB) のまま。
5. GSI dem は minimap には不要 (= 標高プロファイルは course.json 内 `elevation_m` を使う、 タイル fetch ゼロ)。

## ToS 安全範囲

OSM Tile Usage Policy (= <https://operations.osmfoundation.org/policies/tiles/>) の制約と minimap 1-shot との照合:

| 制約 | minimap 1-shot | main viewer (= 維持) |
|---|---|---|
| bulk download 禁止 | OK (= 起動時 9-16 タイル 1 回限り) | OK (= local DB / TILE_BASE_URL 経由のみ) |
| 個人小規模 OK | OK (= 1 viewer instance = 1 ride 起動 = 9-16 タイル) | N/A |
| User-Agent 必須 (識別可能なもの) | OK (= browser 標準 `Mozilla/5.0 ...` で OSM 側区別可) | N/A |
| max zoom | z=11 周辺 (= 上限 z=19 より遥か下、 余裕) | N/A |
| heavy use 禁止 (= 大量自動 fetch / proxy 化) | OK (= ride 1 回 = 9-16 タイル、 prefetch ゼロ) | OK (= local DB 経由) |

これは個人利用範囲、 ToS 安全側。 ride 中の大量 prefetch (= brief 13 で freeze 済) と質的に違う:

- brief 13 で freeze した違反: 1 ride 開始時に 2700 OSM + 450 GSI = 3150 タイルを並列 fetch、 zoom 14-19 の高解像度、 5 km 走行ごとに反復。
- 今回の運用: 1 ride 起動時に 9-16 OSM タイルを逐次 fetch、 zoom 11 (= 1 タイルが約 24 km 圏)、 ride 中再 fetch ゼロ。

桁が 200 倍以上違う、 OSM 側に与える負荷も別物。 GSI dem の minimap 直叩きは依然 NO (= NG-R1-16、 元から minimap には不要)。

## 実装設計

### A. brief 28 関連の削除

`web/viewer-maplibre.js`:
- `initMinimapMap()` 関数 (= L715-765) 削除 ── MapLibre 2nd instance 不要
- `buildMapStyle()` 関数 (= L69-113) 削除 ── 共有不要、 main map 初期化 (= L116-) の `style:` に inline 化
- module-scope `let minimapMap = null;` `let minimapRider = null;` 削除、 `let minimapBase = null;` 復活 (= 1 canvas off-screen base)
- `updateMinimap` を旧版仕様に書き直し (= base 画像を drawImage で onscreen に貼り、 上半分に rider 三角形、 下半分に rider 縦線+dot)
- `drawDirTriangle` 関数復活 (= 旧 L775-779)
- `loadOsmTile` 関数復活 (= 旧 L407-419、 ただし URL は `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png` 直指定)
- `lonToTileX` / `latToTileY` / `tileXToLon` / `tileYToLat` は `web/lib/tile_math.js` から import (= 既に切り出し済、 旧 inline 定義は復活しない)
- `loadCourse` 末尾の `initMinimapMap()` 呼出を `buildMinimapBase()` (= 旧版踏襲) に置換、 `buildMinimapBottom()` は廃止 (= base 画像 1 枚に上下統合)

### B. 旧 buildMinimapBase 復活

仕様 (= 旧版踏襲):
- onscreen canvas `#minimap-top` の width/height を取る (= 旧版 320 x 720 単一 canvas を `#minimap-top` 320 x 561 + `#minimap-bottom` 320 x 159 に分けるか、 1 canvas に戻すかは下記 C で決定)。
- course bbox を 20% margin で広げる
- zoom 選択: `z = 11` を default (= 富士山周辺 24 km 圏内を 2-3 タイルで covers、 9 タイル grid で十分な padding)。 旧版は z=14 で 9-16 タイル fetch だったが、 minimap は全体俯瞰用なので z=11 で「全体が小さく入る」表現が適切。
- tile 範囲: `lonToTileX(minLon, z)` ~ `lonToTileX(maxLon, z)` の整数範囲を `buffer=1` で広げ、 latitude 同様。 結果 3x3 = 9 タイル、 富士山 + ふもとっぱら ride だと最大 4x4 = 16 タイル。
- 各タイルを `loadOsmTile()` で 並列 (= `Promise.all`) で fetch、 off-screen canvas に drawImage、 上半分 clip 領域内に projection。
- 上半分: course polyline (= 黄 #ffd54a) を `ctx.stroke`、 start dot (= 緑 #7fff00)、 goal dot (= 赤 #ff3030) を `ctx.arc`。
- 上半分は 180 度回転 (= 旧版踏襲、 ride 進行方向との視覚整合のため画面下が前方になるよう反転)。
- 下半分: 標高プロファイル (= 既存 `buildMinimapBottom` の塗り gradient + 白線 + min/max ラベル) をそのまま off-screen canvas の同じ canvas の下半分に描画。
- 完成した off-screen canvas を `minimapBase` global に保存。

zoom 11 を選ぶ根拠: 富士山ヒルクライムコースは bbox 約 0.2 度 (= 約 22 km) × 0.15 度 (= 約 17 km)。 z=11 タイル 1 枚は赤道で約 19.5 km 角、 緯度 35 度で実質約 16 km 角 (= cos補正)、 3x3 = 9 タイルで約 48 km 角 = course 全体 + 周辺余裕で収まる。 z=10 だと粒度粗すぎ、 z=12 だと 16+ タイル必要で OSM への負担が増える。

### C. minimap DOM 構成

選択肢:
- 案 1: `#minimap-top` を `<canvas id="minimap-top" width="320" height="561">` に書き換え、 `#minimap-bottom` 維持 (= 2 canvas)、 旧 `buildMinimapBase` を 2 canvas 前提に rewrite。
- 案 2: 旧版踏襲で `<canvas id="minimap" width="320" height="720">` 1 canvas に統合、 内部で TOP_H=561 / BOT_H=159 で分割描画。

→ 案 1 を採用。 理由: (1) `#minimap-container` 構造 (= brief 28 で landed) を活用、 #minimap-bottom の標高プロファイル責務は既に分離済、 1 canvas に戻すと前進記録の取り消しになる。 (2) `viewer_url_audit.test.js` の brief 28 describe block (= L265-281) を minimap-bottom 維持側に shrink するだけで済む。

案 1 詳細:
- `<div id="minimap-top">` → `<canvas id="minimap-top" width="320" height="561">`
- 旧 `buildMinimapBase` のうち、 上半分 OSM + course polyline + start/goal dot + 180度回転 → `#minimap-top` canvas に描画
- 下半分 標高プロファイル → 既存 `#minimap-bottom` canvas に維持 (= `buildMinimapBottom` 維持、 関数名は `buildMinimapBottom` のまま)
- `updateMinimap`:
  - 上半分: `#minimap-top` を `clearRect` + `drawImage(minimapTopBase)` + rider 三角形 (`drawDirTriangle`)
  - 下半分: `#minimap-bottom` を `clearRect` + `drawImage(minimapBottomBase)` + rider 縦線 + dot
  - 2 canvas に独立 base 画像 (`minimapTopBase` / `minimapBottomBase`) を持つ

### D. 物理 gate の minimap 限定緩和

`web/tests/viewer_url_audit.test.js`:
- L16-18 の `expect(viewer).not.toMatch(/https?:\/\/tile\.openstreetmap\.org/);` test 削除。
- 代替 test 追加: 「`tile.openstreetmap.org` 出現箇所が `loadOsmTile` 関数内に限定されていること」を grep で pin。 具体には `loadOsmTile` 関数の body 範囲を正規表現で抽出し、 その中に 1 回だけ `tile.openstreetmap.org` literal が現れることを assert。 別箇所 (= ride hot path 等) で復活したら fail。
- L20-22 の GSI 直叩き禁止 test は維持 (= minimap には GSI 不要)。
- L28-31 の `prefetchTilesAlongCourse` 関数定義禁止 test は維持 (= brief 13 物理 freeze、 絶対変更しない)。

### E. test 更新

`web/tests/minimap_maplibre.test.js`:
- file rename → `web/tests/minimap_osm_direct.test.js`
- 内容書き換え (= 5-7 件):
  1. `#minimap-top` は **canvas** (= `<canvas id="minimap-top"`) で存在する (= 案 1 採用 pin)
  2. `#minimap-bottom` canvas が存在する (= 維持)
  3. 旧 `<canvas id="minimap">` 1 canvas は不在 (= NG-R1-11)
  4. `loadOsmTile` 関数定義が viewer に存在する (= 旧版踏襲)
  5. `buildMinimapBase` 関数定義が viewer に存在する (= 旧版踏襲)
  6. `loadOsmTile` 内に `tile.openstreetmap.org` URL literal が 1 回現れる (= ToS 範囲内 1-shot)
  7. brief 28 の `initMinimapMap` / `buildMapStyle` 関数は不在 (= rollback pin)

`web/tests/viewer_url_audit.test.js` brief 28 describe block (= L265-281):
- describe block 内の 3 件 (= #minimap-top div / initMinimapMap / #e8e8e8 不在) を minimap_osm_direct.test.js 側に統合・rewrite。 viewer_url_audit.test.js の brief 28 describe block は削除。

## やらないこと (= scope 外)

- ride 中の minimap タイル prefetch (= NG-R1-15 再演)
- GSI dem の minimap 直叩き (= NG-R1-16、 元から不要)
- main viewer (= `#map` の地形描画) の OSM 直叩き化 (= brief 13 + 17b 物理 freeze 維持、 main は `${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf` のまま)
- `prefetchTilesAlongCourse` の復活 (= brief 13 物理 freeze、 絶対 NO)
- ride 中の minimap 再描画で OSM 再 fetch (= 1-shot 限定、 起動時 1 回のみ)
- bridge.py / scripts/ / tile_server.py / http_app.py の変更 (= backend 無関係)
- git push (= local commit 1 つ、 push は user 判断)

## 完了条件

- 本 brief draft (= `29-minimap-osm-direct.md`) が `~/.agents/scratch/fujihc-trainer-project/briefs/` に landed
- `web/viewer-maplibre.js` から `initMinimapMap` / `buildMapStyle` / `buildMinimapBottom` (= brief 28 版) 削除
- `web/viewer-maplibre.js` に 旧 `loadOsmTile` / `buildMinimapBase` / `drawDirTriangle` 復活、 z=11 周辺 9-16 タイル 1-shot
- `web/index.html` の `<div id="minimap-top">` を `<canvas id="minimap-top" width="320" height="561">` に書き換え
- `web/tests/viewer_url_audit.test.js` の brief 17b OSM 直叩き禁止 gate を `loadOsmTile` 限定例外に緩和、 brief 28 describe block 削除
- `web/tests/minimap_maplibre.test.js` を `minimap_osm_direct.test.js` に rename、 内容 5-7 件に書き換え
- `npm test --silent` 全 green
- `python -m pytest -q` regression なし (= 157 維持、 bridge running なら 159 でも OK)
- local commit 1 つ (= push しない)

## ハマる罠

1. **zoom 選択**: z=11 は富士山周辺で 1 タイル ≒ 16 km 角、 3x3 で 48 km 角。 z=10 だと粒度粗すぎ、 z=12 以上は OSM 側負担増。 z=11 固定で正解だが、 course bbox が極端に小さい場合 (= 短距離 ride) は overzoom してタイルが薄ぼやけて見える。 minimap は「全体俯瞰」用途なので z=11 固定で割り切る (= 旧版も z=14 固定だった、 zoom 動的選択は ToS 範囲を超えるリスク)。
2. **タイル数**: course bbox + buffer=1 で 3x3 = 9 タイル想定、 富士山〜ふもとっぱらだと最大 4x4 = 16 タイル。 これ以上に膨らむと「個人小規模」の境界を曖昧にする (= brief 13 freeze 違反の再演リスク)。 buffer=1 固定で律する。
3. **fetch 並列度**: 旧版は `Promise.all` で 9 タイル並列 fetch、 OSM 側への突発負荷は最大 9 同時。 ToS 上は許容範囲 (= 並列禁止条項なし)、 ただし「heavy use」境界を意識して `Promise.all` のまま `setTimeout` での逐次化はしない (= 旧版踏襲)。
4. **cache**: `new Image().src = URL` 直指定なら browser の HTTP cache に乗る、 ride 中 / ride 再起動でも cache hit する。 cache busting query string は **絶対付けない** (= OSM 側への重複 fetch 抑制、 ToS 配慮)。
5. **CORS**: `img.crossOrigin = 'anonymous'` 必須 (= drawImage 後の `getImageData` を呼ばないので不要にも見えるが、 OSM 側は `Access-Control-Allow-Origin: *` を返すので付けておけば canvas が「tainted」にならない、 旧版踏襲)。
6. **失敗時 fallback**: `img.onerror` で `resolve()` のみ呼ぶ (= reject しない、 旧版踏襲)。 1 タイル fetch 失敗で minimap 全体が出ないのを避け、 polyline + 標高プロファイルだけは確実に出す。
7. **rotate 上半分のみ**: 旧版は canvas 全体を 180 度回転していたが、 案 1 で上下 canvas 分離した結果、 `#minimap-top` だけ 180 度回転、 `#minimap-bottom` (= 標高プロファイル) は正向きを維持。 rider 縦線 / dot は `#minimap-bottom` 側で正向き計算。
8. **brief 17b grep gate の緩和範囲**: `loadOsmTile` 関数 body に限定する正規表現を間違えると、 ride hot path への OSM 直叩き復活を見逃す。 関数定義から `^}` 終端までを capture して、 その内部にだけ literal を許す書き方が安全。 `viewer_url_audit.test.js` の test description で「minimap 限定例外」と明記。
9. **MapLibre 2nd instance の resource leak**: brief 28 で立てた `minimapMap` を削除する際、 `.remove()` 呼出は不要 (= 一度も `new maplibregl.Map()` を呼ばなくする、 module-scope `let minimapMap = null;` ごと削除)。

## まとめ

brief 28 で MapLibre 2nd instance を立てた判断を撤回、 commit `2c1e116` 時点の canvas + loadOsmTile + drawImage minimap に rollback。 ToS 範囲内 1-shot 9-16 タイル fetch (= z=11) で OSM タイルサーバへの負担は無視できる範囲。 main viewer の ride 中 fetch は brief 13 + 17b の物理 freeze 維持、 minimap だけ例外。 grep gate は「`loadOsmTile` 関数内のみ literal 許可」で限定緩和。 案 1 (= `#minimap-top` を canvas、 上下分離 2 canvas) を採用、 brief 28 で landed した `#minimap-container` 構造は活用。

## 次の atom

- 旧 `loadOsmTile` / `buildMinimapBase` / `drawDirTriangle` 復活 + brief 28 関数群 削除
- `index.html` の `#minimap-top` を `<div>` → `<canvas>` に書換
- `viewer_url_audit.test.js` の OSM 直叩き禁止 gate を minimap 例外で緩和
- `minimap_maplibre.test.js` → `minimap_osm_direct.test.js` rename + 内容書換 5-7 件
- `npm test` 全 green
- `pytest -q` regression なし
- local commit 1 つ (= push しない)
