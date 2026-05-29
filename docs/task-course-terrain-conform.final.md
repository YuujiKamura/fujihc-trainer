# タスク (確定版): 3D コースの帯が地形メッシュに埋まる問題の修正

## はじめに — この確定版が初版から何を変えたか

初版 `task-course-terrain-conform.md` を multi-axis-draft-audit (7軸並列 subagent) にかけた。
結果は **6軸 LOAD-BEARING NG / 1軸 OK → REDRAFT 必須**。初版の核心的欠陥は「実装機構を
コードで確認せず原因を断定した」こと (drift catalog の NG-RG-8 / task-g と同型)。本確定版は
実コード (`web/lib/terrain3d.js` / `web/lib/map3d/*.js`) を読んで機構を確定し、初版の誤りを
訂正したもの。

初版の誤り → 訂正:

- **初版**:「コースを地形に沿わせて形成しないと埋まる」「コースの各点で地形標高をサンプリング
  する頂点列に直す」 → **実機構**: `buildCourseRibbon` (`web/lib/terrain3d.js:324`) は既に
  course 各点の左右両頂点を緯度経度へ戻し `sampleHeightBilinear` で DEM 標高をサンプルして
  drape している (`terrain3d.js:368-373`)。「沿わせていない」のではない。やること3に書いた
  処方箋は既に実装済。原因は別にある。
- **初版**:「`web/lib/terrain3d.js` は地形メッシュ生成側で無改造、直すのはコース側」 →
  **実機構**: terrain3d.js は地形メッシュ生成 (`buildTerrainGeometry`) も**コース帯生成**
  (`buildCourseRibbon` / `buildCoursePath` / `courseRingSlopes`) も両方持つ。「地形側 vs
  コース側」というファイル二分は誤り。ただし terrain3d.js を無改造に保つ規約自体は有効
  (大量の `terrain3d.test.js` + スタンドアロン `terrain3d.html` と共有の SoT)。本修正は
  **terrain3d.js を 1 文字も触らずに**実現する (下記「修正方針」参照)。
- **初版**:「`web/lib/terrain3d.js` は配布元配慮で無改造」 → **実機構**: terrain3d.js は
  fetch / XHR / tile URL を一切持たない純関数群 (import は `tile_math.js` と
  `terrain_mesh.js` のみ)。配布元配慮の対象は GSI へ fetch する `tile_loader3d.js`
  (`GSI_FETCH_LIMIT` / `MAX_TILES` / `openTileCache` を持つ)。terrain3d.js の無改造理由は
  「テスト済 SoT」であって配布元配慮ではない。
- **初版**:「作業ツリーには別 worker の未 commit 変更がある (`web/viewer-map3d.js`,
  `web/tests/intro_consent_guard.test.js`, `e2e/user_journey.spec.js`)」 → **実態**:
  `git status` 時点で未 commit は `e2e/user_journey.spec.js` のみ (他2ファイルは commit 済)。
  本修正はそのいずれにも触らないので干渉しない。

## 確定した原因 (コードで裏取り済)

### コースが「埋まる」のは 2 つの面が食い違うから

3D viewer には **2 つの別々の標高面**がある:

1. **表示される地形メッシュ** — `buildTerrainGeometry` (`terrain3d.js`) +
   `buildTerrainMesh` (`terrain_mesh3d.js`)。標高グリッドを `terrainStep` で**間引いて**
   組む。`terrainStep = ceil(max(width,height) / 400)` (`TARGET_GRID_DIM = 400`)。数枚×256px
   を 1:1 で頂点化すると数百万頂点になるための間引き。富士スバルラインの外接矩形は DEM
   zoom 14 (`tile_loader3d.js: DEM_ZOOM = 14`) で 400px を確実に超え、`terrainStep` は
   2〜8 程度になる。つまり地形メッシュの頂点は DEM 数ピクセルおき (約 50〜60m 間隔) で、
   その間は GPU が**平らな三角形**(線形補間)で描く。

2. **コースの帯** — `buildCourseRibbon` (`terrain3d.js`) + `createCourseRibbon`
   (`course_ribbon3d.js`)。course 各点の左右頂点で `sampleHeightBilinear` を呼び、
   **間引きなしのフル解像度 DEM グリッド**から標高を取る。

帯はフル解像度 DEM に沿い、地形メッシュは間引いた粗い面を描く。**この 2 面は解像度が違う
ので食い違う。** 地形が凹んでいる区間 (谷・切り通し・ヘアピンの内側) では、間引いた地形
メッシュの三角形が真の DEM の上を弦のように渡るため、フル解像度に沿う帯が地形メッシュ
より下に来る → 帯が地形ソリッドの内側に入り遮蔽される = 「埋まる」。逆に凸の区間
(尾根) では帯が浮く。初版が言う「8m オフセットで埋まりが消える」は、8m が間引き誤差の
最悪値を上回るから隠れるだけ — 凹凸で誤差量が変わる幾何問題を一律定数で覆い隠す対症療法。

`exaggeration` (標高誇張) はこのバグの原因では**ない**: 地形メッシュ側 (`buildTerrainMesh`
の既定 `exaggeration = 1.0`) と帯側 (`buildCourseRibbon` の既定 `exaggeration = 1.0`、
`renderCourse` は `exaggeration` を渡さないので既定が効く) は現状一致している。原因は
あくまで**フル解像度 vs 間引き**の解像度不一致。

### なぜ MapLibre 版は埋まらなかったか (初版の必答課題)

旧 MapLibre 版 (`web/lib/map_renderer.js`、現在 dormant) では、コースは MapLibre の
**2D `fill` レイヤ** (`route-fill`) で、`buildGradeColoredRoadPolygons` が出す**標高を
持たない平面 GeoJSON ポリゴン** (緯度経度のみ)。MapLibre は `map.setTerrain({source:
'gsi-terrain', exaggeration:1.0})` で地形を有効化しており、2D の fill / line レイヤを
**自分が描く地形メッシュへ drape する** — ベクタレイヤをタイルテクスチャにラスタライズし、
そのテクスチャをレンダラが描く地形面そのものへ貼る。コースの fill は独立した 3D オブジェ
クトではなく、**唯一の地形面に塗られたテクスチャ**。面は 1 つしかないので、構造上、埋まる
ことも浮くこともできない。

Three.js 版はコースを**独立した 3D 三角形メッシュ**にし、その頂点標高を地形メッシュとは
**別解像度** (フル解像度) でサンプルした。2 つの面が 2 つの解像度で食い違う → 交差 → 埋まる。

**答え: MapLibre は地形面が 1 つだけで、コースをその面へ drape (塗布) していた。Three.js は
面が 2 つ (間引き地形メッシュ vs フル解像度サンプルのコースメッシュ) あり食い違う。**
本修正は Three.js のコースを「地形メッシュが実際に描く間引き面」と同じ面からサンプルさせ、
MapLibre が無償で持っていた「面は 1 つ」性質を復元する。

## 修正方針

コースの帯の各頂点を、フル解像度 DEM ではなく **地形メッシュが実際に表示する間引き面**
(同じ `step`・同じ三角形分割) からサンプルさせる。そうすれば帯は全区間で地形メッシュ表面
の上に乗り、z-fighting 回避用の小さなオフセット (現 `ROAD_OFFSET_M = 2m`) で埋まらない。

### terrain3d.js を触らずに実現する設計

`buildCourseRibbon` は terrain3d.js 内 (無改造対象)。だが帯の頂点 X/Z/index/uv は正しく、
**間違っているのは Y (標高) だけ** — 間違った面からサンプルしている。`buildCourseRibbon`
の戻り値の Y を、コース側のラッパー `course_ribbon3d.js` で**間引き面の標高に再計算
(re-drape) で上書き**する。これで terrain3d.js は無改造のまま、コース側だけで直る。

変更ファイル (全て編集可、terrain3d.js ではない):

1. **`web/lib/map3d/terrain_surface.js`** — 間引き面サンプラの追加 (3-free な純関数モジュール、
   既に `sampleHeightBilinear` を terrain3d.js から import して wrap する層)。
   - `export const TARGET_GRID_DIM` と `export function meshGridStep(width, height)` を新設
     — 地形間引き step の SoT。現在 `terrain_mesh3d.js` がローカルに持つ `TARGET_GRID_DIM` /
     `terrainStep` をここへ移し、terrain_mesh3d.js から参照させる (SoT 一元化、JS 内重複実装
     = NG-R5-15 を防ぐ)。`meshGridStep` の式は `terrainStep` と同一: `max(1, ceil(max(w,h)
     / TARGET_GRID_DIM))`。
   - `export function sampleMeshHeight(stitched, range, lat, lon, step, tileSize = 256)` を
     新設 — `buildTerrainGeometry` が描く間引き三角形面の標高 (m) を返す純関数。
     `sampleHeightBilinear` と同じ式で連続ピクセル座標 `fx,fy` を出し、`fx/step, fy/step` で
     間引きセルを特定、4 隅は間引き頂点の標高 (`buildTerrainGeometry` と同じ
     `px = min(width-1, i*step)` 写像)、`buildTerrainGeometry` と同じ三角形分割
     (セル `a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)`、tri1 = `a,c,b` / tri2 = `b,c,d`、
     対角は b-c) で barycentric 補間する。これで `sampleMeshHeight × exaggeration` が
     地形メッシュの Y と厳密一致する。
2. **`web/lib/map3d/terrain_mesh3d.js`** — `TARGET_GRID_DIM` / `terrainStep` のローカル定義を
   削除し `terrain_surface.js` から `meshGridStep` / `TARGET_GRID_DIM` を import して使う
   (`buildTerrainMesh` 内の `terrainStep(...)` を `meshGridStep(...)` に置換)。`terrainStep`
   は terrain_mesh3d.js 内部からしか使われていない (grep 確認済) ので後方互換 re-export 不要。
   ※ `terrain_mesh3d.js` は `'three'` を import するが、`terrain_surface.js` は 3-free な
   ので、この向きの import は循環も 3 汚染も生まない。
3. **`web/lib/map3d/course_ribbon3d.js`** — `createCourseRibbon` で `buildCourseRibbon` の
   戻り値を受けた直後、各頂点の Y を `sampleMeshHeight` 由来の値で再計算して上書きする
   `conformRibbonToMesh` 処理を追加。X/Z から緯度経度を逆投影 (`buildCourseRibbon` 内部と
   同じ式: `lon = centerLon + x/mPerDegLon`、`lat = centerLat - z/M_PER_DEG_LAT`) して
   `sampleMeshHeight` を引き、`Y = h * exaggeration + drapeOffset` を書き戻す。`step` は
   `meshGridStep(geo.stitched.width, geo.stitched.height)` で内部算出 (`index.js` の呼出は
   不変、`createCourseRibbon` の signature も不変)。`course_ribbon3d.js` は `terrain_surface.js`
   のみ追加 import (3-free を維持、injected THREE のまま、vitest node 環境でテスト可)。

terrain3d.js / index.js / viewer-map3d.js / e2e/* は無改造。

### マーカー (起点/終点) の扱い

`markers3d.js` は `buildCoursePath` (terrain3d.js) 経由でやはりフル解像度 DEM をサンプルする
ため、起点/終点マーカー球も同じ根本原因で凹区間に埋まりうる。ただし本タスクのスコープは
**コースの帯**。実装後の `desk_capture` 目視でマーカーが明らかに埋まっていれば、同じ
`sampleMeshHeight` を `markers3d.js` の起点/終点 Y にも適用する (同一根本原因の同一修正なので
その場合はその場で直す。`labels3d.js` の距離ラベルは `heightOffset` で高く持ち上がっており
埋まりにくいが、同様に目視で判断する)。rider は `index.js` で帯の頂点配列 (`ribbonPositions`)
の上に配置されるため、帯を直せば rider も自動的に地形メッシュ上に乗る。

## やること

1. **原因の最終確認** (= NG-RG-8 対策、断定の前にコードを観る): `web/lib/terrain3d.js` の
   `buildCourseRibbon` (L324-390) が既に per-vertex で `sampleHeightBilinear` を呼んで drape
   していること、`web/lib/map3d/terrain_mesh3d.js` の `terrainStep` が地形メッシュを間引く
   こと、`tile_loader3d.js` の `DEM_ZOOM = 14` を読んで確認する。上の「確定した原因」と
   一致することを自分の目で裏取りしてから実装に入れ。
2. 「修正方針」の 3 ファイルを実装する。`sampleMeshHeight` は `buildTerrainGeometry`
   (`terrain3d.js:104-181`) の頂点写像・三角形分割 (winding `a,c,b` / `b,c,d`) を**厳密に**
   なぞること — そこがズレると帯が間引き面とまた食い違う。
3. テストを足す (下記「テスト」)。
4. 真正性確認 (下記)。
5. `desk_capture` で実画面を観て、コースの帯が全区間で地形メッシュに埋まらず・浮かず乗って
   いることを批評する (下記「検証」)。

## テスト

既存の関連テスト (ファイル名 + 件数で確認済):

- `web/tests/course_ribbon3d.test.js` — `ribbonVertexColors` 7件 + `createCourseRibbon` 6件。
  現状 **頂点 Y (標高) を pin するテストはゼロ** (色 / index / material / dispose のみ)。
  fixture は 16×16 のフラット grid (`terrainStep` = 1、間引きなし) なので、このファイルの
  既存テストは本修正で挙動不変 (step 1 のフラット grid では `sampleMeshHeight` = フル解像度)。
- `web/tests/terrain_surface.test.js` — `ROAD_OFFSET_M` 2件 + `TerrainSurface.heightAt` 3件
  + `project` 4件。`meshGridStep` / `sampleMeshHeight` のテストはここに足す。
- `web/tests/terrain3d.test.js` — `buildCourseRibbon` の describe に「Y = DEM標高 +
  drapeOffset」テストあり。terrain3d.js は無改造なので**このファイルは触らない / 落ちない**。
- `web/lib/map3d/terrain_mesh3d.js` には専用テストファイルが無い (`'three'` import のため
  node test 不可)。`terrainStep` を移設しても壊れるテストは無い。

追加するテスト:

**`web/tests/terrain_surface.test.js` に追加:**

- `meshGridStep`: 境界値 — `(16,16)→1`、`(400,400)→1`、`(401,401)→2`、`(800,400)→2`、
  `(801,1)→3`。`max(width,height)` を使うこと、最小 1 を pin。
- `sampleMeshHeight`:
  - フラット grid (全 H) は step に関係なく H を返す。
  - 間引き頂点の緯度経度ちょうどでは、その頂点の grid 標高を返す。
  - **核心テスト**: 間引き頂点 (step 刻みの画素) は全て同一標高 H、頂点と頂点の間の画素は
    H-D に凹ませた grid を作る。`sampleMeshHeight` は頂点間の点でも ≈ H を返す (間引き面を
    サンプル) のに対し、`sampleHeightBilinear` (terrain3d.js) は同じ点で < H を返す。
    両者を比べて「フル解像度ではなく間引き面を見ている」ことを pin する。

**`web/tests/course_ribbon3d.test.js` に追加 (`createCourseRibbon` — 地形メッシュ追随):**

- **核心の判別テスト**: `meshGridStep` が 2 以上になる大きさの `stitched` grid (例 401×401)
  を作り、間引き頂点 (step 刻み画素) を全て同一標高 H に、頂点間画素を H-D (D は
  `ROAD_OFFSET_M` より十分大、例 50m) に凹ませる。この grid では地形メッシュ
  (`buildTerrainGeometry` を step 付きで呼ぶ) は標高 H の平面になる。この上に course を
  通して `createCourseRibbon` を呼び、**全リボン頂点の Y が H 以上** (= 平面の地形メッシュ
  より下に潜る頂点がゼロ) かつ **Y ≈ H + drapeOffset** (= 浮きもしない、面の上に乗る) を
  assert する。修正前のフル解像度サンプリングだと頂点間で Y < H になり**このテストが落ちる**。
- 回帰テスト: 既存 16×16 フラット fixture (step 1) で `createCourseRibbon` のリボン頂点 Y が
  従来どおり (DEM 標高 + offset)、既存テストと矛盾しないことを確認。

すべて vitest (`web/tests/`、node 環境) の純関数テスト。「埋まっていない」という**見え**は
vitest では固定できない (静的計算しか見ない) — それは `desk_capture` の実画面目視が担う。
e2e (Playwright) には埋まりを判定する手段が無く、追加すると misleading test (NG-R5-14) に
なるので **e2e にこの観点のテストは足さない**。役割分担: vitest = 頂点 Y の数値を pin /
desk_capture = 埋まりの見えを目視批評 / e2e = 既存の導線テストを壊さないことの確認のみ。

## 真正性確認 (必須)

`course_ribbon3d.js` の `conformRibbonToMesh` 呼び出しを 1 箇所だけわざと外す
(または `sampleMeshHeight` をフル解像度 `sampleHeightBilinear` に差し替える) と、上記
「核心の判別テスト」が落ちることを手元で 1 回確認する。落ちなければテストが真正でない =
書き直し。**確認したら必ず元に戻し、`git diff` で残存改変ゼロを確認してから commit する**
(壊した状態のまま commit する事故の防止 = NG-RG-9)。

## 検証

- `npm test` (vitest)、`npm run test:e2e` (Playwright)、`python -m pytest` を全て走らせ
  passed / failed 数を報告。全 green が条件。
- `desk_capture` で実画面を観て批評する。手順厳守 (制約欄参照): viewer を映した通常 Chrome
  ウィンドウが無ければ自分で 1 回だけ通常タブで `http://127.0.0.1:8000/?test=1&consent=dev`
  を開いてから `desk_capture`。**`chrome --headless` 直叩きも `headless-shot.ps1` も使うな**。
  撮ったら Read tool で画像を実際に開いて目で見る。期待 state = riding 画面でコースの帯が
  全区間で地形メッシュに乗っている。批評は「何か出た」ではなく「観ておかしい所を判断する」:
  どの区間も帯が地形に沈んでいない / 不自然に浮いていない、を具体的に述べる。マーカー
  (起点/終点球) と rider の埋まりも併せて観て報告する。
- 真正性確認の結果を報告。

## 制約

- **terrain3d.js は無改造** (`web/lib/terrain3d.js`)。理由は配布元配慮ではなく「`terrain3d.test.js`
  で広くテストされ `terrain3d.html` と共有の SoT」だから。本修正は terrain3d.js を 1 文字も
  変えずに `course_ribbon3d.js` / `terrain_surface.js` / `terrain_mesh3d.js` だけで実現する。
- **地図タイル配布元配慮**: 本修正は描画ジオメトリ (頂点標高の再計算) のみで、地図タイルの
  fetch を一切発生させない。標高は既に取得済みの `stitched` グリッドから読むだけ。fetch の
  実体 `tile_loader3d.js` (`GSI_FETCH_LIMIT` / `MAX_TILES` / `openTileCache`) と `bridge.py`
  (`127.0.0.1` bind 固定) には触れない。出典クレジット `#attrib` 要素にも触れない。
- **Service Worker**: 変更対象の `course_ribbon3d.js` / `terrain_surface.js` /
  `terrain_mesh3d.js` は全て `.js` 拡張子。`web/sw.js` の `isAppShell`
  (`/\.(html|js|css)$/`) により **network-first** で配信される (確認済) ため、`CACHE_NAME`
  bump も `?v=N` bump も不要 — オンラインなら次回ロードで最新版が届く。
- viewer は `http://127.0.0.1:8000/` で既存サーバが配信中。bridge を二重起動するな。
- **未 commit の別 worker 変更は `e2e/user_journey.spec.js` のみ。これに触るな。** commit は
  自分が触ったファイルだけを明示パスで `git add <path>`。`git add -A` / `git commit -am` 禁止。
- ローカル commit まで。`git push` 禁止。

## 完了報告

以下を全て埋めて報告する:

1. MapLibre 版が埋まらなかった理由 (上「なぜ MapLibre 版は…」の要約)。
2. 3D コースを地形メッシュ表面に沿わせるために直したファイルと方式
   (`sampleMeshHeight` / `meshGridStep` / `conformRibbonToMesh` / terrain_mesh3d.js の SoT 移設)。
3. 全区間で埋まりが無いことの `desk_capture` 実画面確認 — どの区間も沈んでいない、と具体的に。
   マーカー / rider の状態も。マーカーを追加で直したならその旨。
4. 追加 / 強化したテスト (ファイル名 + 件数 + 各テストが落ちたら何を検出するか)。
5. 真正性確認の結果 (わざと壊して核心テストが落ちたか、戻して `git diff` 残存ゼロを確認したか)。
6. `npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。

## まとめ

このバグは「コースを地形に沿わせていない」のではなく「**コースが地形メッシュとは別解像度の
面に沿っている**」こと。直し方は、コースの帯の頂点標高を、地形メッシュが実際に描く間引き面
(`sampleMeshHeight`) からサンプルし直すこと。terrain3d.js は無改造のまま `course_ribbon3d.js`
側で Y を上書きする。一律の大きなオフセットに頼らず、`ROAD_OFFSET_M = 2m` の小さな
オフセットで全区間埋まらなくなる。判別テストは「間引き頂点はフラット・頂点間は凹」の
合成 grid で、帯頂点が地形メッシュ平面より下に潜らないことを数値で pin する。

## 参照

- Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
- GSI 標高タイル (dem_png) 仕様: https://maps.gsi.go.jp/development/demtile.html
- 地理院タイル一覧・利用規約: https://maps.gsi.go.jp/development/ichiran.html
- MapLibre 地形 (setTerrain / 3D terrain で 2D レイヤを drape する仕組み):
  https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/
- 実装機構の所在: `web/lib/terrain3d.js` (`buildCourseRibbon` L324 / `buildTerrainGeometry`
  L104 / `sampleHeightBilinear` L221)、`web/lib/map3d/terrain_mesh3d.js` (`terrainStep` /
  `buildTerrainMesh`)、`web/lib/map3d/course_ribbon3d.js` (`createCourseRibbon`)、
  `web/lib/map3d/terrain_surface.js` (`TerrainSurface` / `ROAD_OFFSET_M`)。
