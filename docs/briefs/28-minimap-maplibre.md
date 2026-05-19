---
brief: 28-minimap-maplibre
title: minimap 上半分を MapLibre 化して OSM 地図を出す (= 17b 制約解除)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [26a-viewer-osm-vector-fix, 16-osm-pmtiles-fetch, 17b-viewer-tile-endpoint]
blocks: []
---

# Brief 28: minimap 上半分を MapLibre 化

## はじめに

user 訂正: 「ミニマップの地図が出てないのはなんでだ」。 brief 17b 時点で minimap 上半分は外部 OSM 直叩き禁止 (= NG-R1-15) の物理化のため `#e8e8e8` 単色固定にした (= `buildMinimapBase` L724-730)。 当時はローカル経由の OSM 入手手段ゼロが制約。 現在は brief 14-16 で OSM PMTiles が `tiles` 表に z=13/14/15 で landed、 brief 17b で `${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf` 経由が landed、 brief 26a で vector layer 群 (= earth/water/landuse/roads/roads-major) も整備済。 「作ったら使え」原則 (= NG-R3-1 系) で minimap 上半分を OSM vector で塗り直す段階。 下半分の標高プロファイルは現行 canvas 描画のまま維持。

## 何が今足りないか (= 現状)

- `web/viewer-maplibre.js` の `buildMinimapBase` (= L693-769): 上半分 clip 領域 (= L726-730) を `ctx.fillStyle = '#e8e8e8'` で塗りつぶし固定、 OSM 経由ゼロ。 course polyline (L733-735) と start/goal dot (L736-741) は手描きで重ねている。
- `web/viewer-maplibre.js` の `updateMinimap` (= L800-822): rider 位置を `drawDirTriangle` (= L775-779) で canvas に三角形描画、 minimap 上半分の base を 180 度回転して貼っているため `rotateTop` 再投影 (L808-815) が必要、 OSM 地図と整合させる仕組み無し。
- `web/index.html` L248: `<canvas id="minimap" width="320" height="720">` の 1 枚 canvas で上下責務同居、 MapLibre instance を載せる DOM 不在。
- 結果: ride 中の全体俯瞰で道路 / 緑地 / 水域がゼロ、 user は polyline 1 本と標高曲線しか見れない。

## あるべき構造

```
+ #minimap-container (left top, absolute, 320x720) ───────+
| #minimap-top (320 x 561 = 78%)                          |
|   = 2nd MapLibre instance                               |
|     source 'osm' (vector pbf, TILE_BASE_URL 経由)       |
|     layers: bg / earth / water / landuse / roads / roads-major
|     course polyline overlay (= source 'minimap-route')  |
|     rider marker (= maplibregl.Marker, cyan circle)     |
|     fitBounds(course) で固定、 interaction 全 disable   |
+---------------------------------------------------------+
| #minimap-bottom canvas (320 x 159 = 22%)                |
|   = 標高プロファイル (= 現行 buildMinimapBottom)        |
|     塗り gradient + 白線 + min/max ラベル + rider 縦線/dot
+---------------------------------------------------------+
```

役割分担: 平面マップは MapLibre 2nd instance に委譲 (= 上半分)、 標高プロファイル は canvas で従来通り (= 下半分)。 上下は別 DOM、 同一 canvas 内責務同居を解消 (= NG-R1-7 回避)。

## 実装設計

### A. index.html 変更

- L248 の `<canvas id="minimap" width="320" height="720">` を以下に置換:
  ```html
  <div id="minimap-container">
    <div id="minimap-top"></div>
    <canvas id="minimap-bottom" width="320" height="159"></canvas>
  </div>
  ```
- CSS (= L51-55 の `#minimap` 規則を置換、 既存 state-*** 非表示規則 L13-21 の `#minimap` セレクタを `#minimap-container` に書き換え):
  ```css
  #minimap-container { position: fixed; left: 1rem; top: 1rem; z-index: 999;
    width: 320px; height: 720px; background: rgba(0,0,0,0.8); border-radius: 6px; overflow: hidden; }
  #minimap-top    { width: 100%; height: 561px; }   /* 78% */
  #minimap-bottom { display: block; width: 100%; height: 159px; } /* 22% */
  ```

### B. viewer-maplibre.js 変更

- `buildMinimapBase` (= L693-769) を 2 関数に分割:
  - `initMinimapMap()`: `#minimap-top` に 2nd `maplibregl.Map` instance を作る (= 既存 main map L60-110 の style 定義を共有 helper `buildMapStyle()` に切り出して両方から呼ぶ、 二重 inline 化禁止 NG-R1-11)。 `fitBounds(courseBounds, {padding: 20, animate: false})` で course 全体を表示。 interaction を **全 disable** (= 後述「やらないこと」「ハマる罠」)。 ready 後に course polyline source / layer (= id `'minimap-route'`、 line color `#ffd54a` width 3) と start/goal marker 2 件を addLayer / addMarker。 rider marker は `maplibregl.Marker({color:'#00ffff'})` を 1 個生成して `minimapRider = marker` で保持 (= まだ addTo しない、 ride 開始時に追加)。
  - `buildMinimapBottom()`: 下半分 canvas (`#minimap-bottom`) に標高プロファイル描画。 既存 L744-754 の gradient 塗り + 白線 + min/max ラベル をそのまま移植。 `minimapStats` には botInnerW / botInnerH / botBaseY / botTopY / PAD / minE / maxE / totalD だけ載せる (= 上半分の `projectLatLon` / `rotateTop` は不要になり廃止)。
- `updateMinimap(curDistM, curEleM, curLat, curLon, heading)` (= L800-822):
  - **上半分**: `minimapRider.setLngLat([curLon, curLat])`。 初回呼出時のみ `.addTo(minimapMap)`。 bearing を rider の向きに合わせるなら `minimapMap.setBearing(...)` ではなく marker の rotation だけ更新 (= map 全体は固定俯瞰、 marker だけ向き)、 但し `maplibregl.Marker` の rotation 設定は cyan dot 円だけなら不要 (= 三角形が要るなら DivIcon で `transform: rotate(...)` の `marker.getElement().style.transform` を上書き、 詳細は impl で決定)。
  - **下半分**: 下半分 canvas のみ `clearRect` + 標高プロファイル画像 (= `minimapBottomBase` Image / Cached canvas)再描画 + rider 縦線 + dot。 上半分には触らない。
- minimap 180 度回転 (= 旧 L759-765 の上半分 rotate) は **廃止**: MapLibre は北上向き標準、 user 訂正で「タイトル文字無くて良い」決定 (= L732) してから rotate の理由 (= 文字反転回避) は消えている。

### C. test 戦略 (= Rule 1 必須)

新規 `web/tests/minimap_maplibre.test.js` 6-8 件:
- index.html 物理 grep: `#minimap-top` / `#minimap-bottom` / `#minimap-container` の 3 要素存在
- index.html 物理 grep: 旧 `<canvas id="minimap"` (= 単一 canvas) が消えている (= 二重実装ガード NG-R1-11)
- viewer-maplibre.js grep: `function initMinimapMap` 定義存在
- viewer-maplibre.js grep: `function buildMinimapBottom` 定義存在
- viewer-maplibre.js grep: `function buildMapStyle` 定義存在 (= main + minimap で共有)
- viewer-maplibre.js grep: minimap の interaction 全 disable (= `dragRotate.disable` / `scrollZoom.disable` / `dragPan.disable` / `keyboard.disable` / `doubleClickZoom.disable` / `boxZoom.disable` / `touchZoomRotate.disable` の 7 系全揃)
- viewer-maplibre.js grep: `updateMinimap` 内に `setLngLat` 呼出存在 (= rider marker 更新)
- viewer-maplibre.js grep: 旧 `'#e8e8e8'` (= 単色固定塗り) の string literal が消えている (= 旧実装ガード NG-R1-11)

既存 `web/tests/viewer_url_audit.test.js` に regression gate 3 件追加:
- `#minimap-top` を載せる `<div>` 要素が index.html に存在
- viewer に `function initMinimapMap` がある
- viewer に旧 `'#e8e8e8'` の単色塗り literal が無い

### D. 数値見積もり

- DOM 変更: index.html L248 周辺 +6 行 (= canvas 1 → div+div+canvas)、 CSS L51-55 を 3 規則化 +5 行、 state-*** セレクタ書き換え 0 行 (= 同行内置換)
- viewer-maplibre.js: `buildMinimapBase` 77 行 → `initMinimapMap` 約 60 行 + `buildMinimapBottom` 約 35 行 + `buildMapStyle` 抽出 約 50 行 (= 既存 main map L60-110 50 行 + minimap で共有)、 net +60 行
- 旧 `drawDirTriangle` (= L775-779) は updateMinimap 下半分 dot 用は不要、 上半分は marker 任せで参照ゼロ → 削除 -5 行
- 旧 `rotateTop` ロジック (= L808-815) 削除 -8 行
- test 追加: minimap_maplibre.test.js 約 50 行 + viewer_url_audit.test.js +12 行
- 全体: viewer 962 → 約 1010 行、 test 件数 +10 件前後 (= npm 201 → 211 件目標)

## やらないこと

- canvas 上で MVT pbf を自前 decode + render (= 工数大、 既存 MapLibre instance 再利用が筋、 工数 vs 体験で割に合わない)
- 標高プロファイル を MapLibre 化 (= 標高曲線は独自 chart 表現、 raster/vector tile では出ない、 下半分 canvas は保持)
- 元 canvas を残して上から MapLibre overlay を `z-index` で被せる (= 同概念に 2 実装が並走、 NG-R1-3 / NG-R1-11 の混在 risk)
- minimap MapLibre の interaction (= drag / zoom / rotate / wheel / pinch) を有効化 (= 表示専用 = 別 brief 候補、 本 brief 範囲外)
- 別 brief 候補に持ち越し (= OSM が DB に既に landed、 brief 26a の vector layer 群も整備済、 「作ったら使え」 = NG-R3-1 同型回避のため即着手)
- ride 開始前に minimap MapLibre 初期化 (= course 未 load 時は fitBounds 計算不能、 `loadCourse` 完了後の `buildMinimapBase` 呼出点 L664 を踏襲)

## 完了条件

1. `web/index.html` L248 周辺の minimap DOM 分割 (= container/top/bottom)、 CSS 3 規則 + state セレクタ書換
2. `web/viewer-maplibre.js` の `buildMinimapBase` を `initMinimapMap` + `buildMinimapBottom` + `buildMapStyle` の 3 関数に分割、 `updateMinimap` を上下分担で書き直し
3. 新規 `web/tests/minimap_maplibre.test.js` 6-8 件 全 green
4. 既存 `web/tests/viewer_url_audit.test.js` に regression gate 3 件追加、 全 green
5. `npm test` 既存 201 + 新規 8-10 = **209-211 件目標**で全 green
6. `pytest` regression なし (= 157 件維持、 backend 変更ゼロ)
7. 視覚確認 (= MAP_MODE / `?map=1` で minimap 上半分に OSM 道路 (= roads layer の橙系) と緑地 (= landuse-forest) と水域 (= water) が見える、 下半分は標高プロファイル維持、 rider 開始後に cyan marker が課題追従) ── これは AI 不能、 user 必須
8. 既存物理 gate 全維持 (= `ws.send` 不在、 `new WebSocket()` 不在、 OSM raster .png 不在、 外部 OSM/GSI 直叩き不在、 vector .pbf URL 維持、 brief 26b 系の dbinit 5 要素 id 維持)
9. ローカル commit のみ、 push しない

## ハマる罠

- **2 instance で同じ source url を共有**: MapLibre は instance 別に tile cache を持つ、 同じ URL でも別 fetch にはならない (= HTTP cache 経由で 1 度だけ landed、 ただし VRAM 上の decode 済 tile は別)。 `maxTileCacheSize` 累計 VRAM 増、 minimap 側は zoom 13-14 固定で 4-9 tile 程度に留まる見込み。
- **interaction disable 漏れ**: MapLibre は `dragRotate / scrollZoom / dragPan / keyboard / doubleClickZoom / boxZoom / touchZoomRotate` の **7 系**を個別 disable 必須、 1 個忘れると user が誤って zoom してしまい fitBounds 維持崩壊。 init 直後に全 disable 一括呼出を helper 化推奨。
- **updateMinimap 呼出頻度**: tick (= 60fps) から毎フレーム呼ばれる、 marker.setLngLat 自体は O(1) で安いが flushSync 系の repaint が走ると jank、 setLngLat は内部で requestAnimationFrame 統合済の想定 (= 検証要)、 不安なら 1Hz throttle に落とす (= rider 表示遅延 1 秒は許容)。
- **DOM 変更による既存参照破損**: viewer 内 `document.getElementById('minimap')` の参照箇所を grep して全部 `#minimap-top` / `#minimap-bottom` に置換要、 漏れがあると runtime null reference。 既存 `onscreen.width` / `onscreen.height` (= L696, L803) も bottom canvas 側へ向け直す。
- **fitBounds と course 未 load**: `initMinimapMap` は `loadCourse` 完了後の `course` グローバル参照前提、 `buildMinimapBase` の呼出点 (= L664) を踏襲して course populated を保証。 早期 init で空 bounds を渡すと MapLibre が NaN で例外。
- **180 度回転廃止の確認**: 旧上半分回転は文字反転回避が動機 (= L732 でタイトル文字廃止済)、 廃止しても user 体験は北上向き標準で OK の想定、 仮に user が南上向き運用 (= 仮想 ride 視点と minimap 向きを揃える) を要望すれば別 brief で marker rotation 経由で対応 (= map 自体は北上向き固定)。
- **state 切替時の再 init**: TEST_MODE / MAP_MODE / 通常 で `loadCourse` が呼ばれるのは map.on('load') ハンドラ内 (= 1 回)、 minimap MapLibre も同タイミング 1 回限り init で永続が筋。 setAppState 遷移 (= checking → dbinit → pairing → riding) で minimap を再 init しない、 既存 instance を保持。
- **NG-R1-11 再演**: main map と minimap で style 定義 (= source 'osm' + 5-6 layer) を片方 inline、 片方コピペ にすると即再演。 `buildMapStyle()` で 1 箇所定義して両 instance に渡せ。
- **NG-R1-3 再演**: `minimap` / `mini-map` / `minimap-top` / `minimap-bottom` / `minimap-container` / `minimapMap` / `minimapRider` の用語混在。 id / 関数名で `minimap-***` prefix に統一、 「mini-map」 (= ハイフン中央) は禁止。

## まとめ

ship される: minimap 上半分に OSM 道路 / 緑地 / 水域が描画、 course polyline と start/goal marker は MapLibre layer 経由でオーバーレイ、 ride 中の rider 位置は cyan marker が追従、 下半分の標高プロファイル + 縦線 + dot は現行維持、 17b の `#e8e8e8` 単色制約は物理的に解除 (= literal が grep gate で禁止)。
ship されない: minimap の interaction (= zoom/pan/rotate)、 標高プロファイルの MapLibre 化、 minimap 南上向き運用、 別 brief 候補への持ち越し。

## 次の atom

- brief 29 候補: minimap interaction の制限付き有効化 (= 「コース全体俯瞰」 ↔ 「rider 周辺ズーム」のトグル button)
- brief 30 候補: ride 完走後の post-ride map 表示 (= 走行 GPX を overlay、 elevation gain / 平均速度 を minimap 上に重畳)
- brief 31 候補: minimap rider marker の向き (= heading に合わせた三角形回転、 marker DivIcon + transform: rotate 経由)
