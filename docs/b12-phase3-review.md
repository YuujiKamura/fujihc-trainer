# b12 Phase3 コードレビュー — web/lib/map3d/

- レビュー実施: ワーカー 34528（course_ribbon3d / markers3d / labels3d の実装担当）
- 対象: `web/lib/map3d/` の scene / terrain_mesh3d / tile_loader3d / course_ribbon3d /
  camera3d / rider_mesh3d / markers3d / index ＋ labels3d（計9ファイル）
- 観点: (1) バグ、特に地形が出ない問題 (2) 設計メモ `b12-phase3-design.md` からの逸脱
  (3) エラーハンドリングの穴 (4) `CLAUDE.md` の GSI / OSM タイル制約違反
- 実コードは read のみ。修正はしていない。
- 日付: 2026-05-18

---

## はじめに — この文書で分かること

地形が出ない問題の原因候補を2つ（A: カメラの初期位置、B: DEM 取得経路）、
それぞれ根拠・コード箇所（ファイル名:行番号）・どの実行モードで起きるかとともに示す。
main がこれを 34888 の7軸レビューと突き合わせて真因を絞るための材料。

加えて、boot を静かに殺す TypeError 経路、`courseRendered` フラグの早期セット、
私自身が書いた labels3d の transparent 欠落バグを記録する。

結論を先に: **候補A（カメラ初期位置）が最有力**。bridge mode でも static mode でも
起きる、モード非依存の問題だから。候補B は static mode 限定。

---

## 1. 地形が出ない問題 — 原因候補

### 候補A: カメラの初期位置が boot 直後に入っていない【最有力】

**コード箇所**: `index.js` L232（`createCamera3d` 呼び出し）、`camera3d.js` L82-112、
`index.js` boot() 全体（L182-257）。

**根拠**:
`boot()` は L232 でカメラを作るが、**作った直後に初期位置を適用していない**。
`camera3d.js` の `createCamera3d`（L82）はカメラを生成するだけで、位置を決める
内部関数 `applyOrbit`（L100-112）は `update()` / `onDrag` / `onWheel` 経由でしか
呼ばれない。つまり boot 完了時点で `camera.position` は Three.js の
`PerspectiveCamera` 既定値 `(0,0,0)` のまま。

地形メッシュは原点を中心に組まれる（`buildTerrainGeometry` が centerLat/centerLon を
原点に取るため、地形の中心が world 原点）。カメラが原点にいる = 地形メッシュの
中心に埋まった状態。

boot 完了から `renderCourse` 内の `camera3d.update`（`index.js` L385）が呼ばれるまでの間、
viewer 本体の tick が `render()`（`index.js` L327）を呼んでも、カメラが地形の内部に
いて**地形が画面に映らない**。`renderCourse` が呼ばれない / 失敗すると永久に映らない。

`terrain3d.html` は地形を組んだ直後に `applyCamera()`（terrain3d.html L679）を呼んで
初期カメラ位置を確定している。`index.js` の boot にはこの初期カメラ適用が欠けている。

**どのモードで起きるか**: bridge mode / static mode **両方**。boot が成功して
地形メッシュが scene に乗っても（`index.js` L225 `scene.add(terrainMesh)`）、
カメラが原点なら映らない。モード非依存なので、これが最有力。

**修正の方向（参考、修正は別途差配）**: boot の地形生成後（`index.js` L246
`terrainReady = true` の前後）で、`camera3d.update(terrainCenter(), {x:0,y:0,z:-1})`
相当を1回呼んで初期カメラ位置を確定する。`terrain3d.html` L679 と同じ役割。

### 候補B: DEM 取得が bridge 一本で static mode 経路が無い

**コード箇所**: `tile_loader3d.js` L36-38（`demBaseUrl`）、L124-148（`loadDemStitched`）。

**根拠**:
`demBaseUrl()` は DEM タイルを `${location.origin}/tiles/gsi_dem` だけで取る。
設計メモ `b12-phase3-design.md` の tile_loader3d 節（L281-283）は
「**bridge / static のローカル DB**」── `${origin}/tiles/gsi_dem/...` **か**
`${origin}${base}static/...` の2経路を、`map_renderer.js` の `BRIDGE_TILE_BASE_URL` /
`STATIC_TILE_BASE_URL` と同じ導出で叩け、と明記している。

実装は bridge 経路のみ。static 経路が欠落している。`tile_loader3d.js` のコメント
L13-15 は「bridge 一本」を意図的設計と書いているが、設計メモは static 経路も
要求している ── **設計メモからの逸脱（観点2）**。

bridge が起動していない環境では `/tiles/gsi_dem/...` が全部 404 になり、
`loadDemStitched` が「DEM タイルが1枚も取得できませんでした」で throw する
（`tile_loader3d.js` L143-145）。これが boot の catch（`index.js` L248-252）に
落ちて `terrainReady = false`、地形メッシュは作られず scene にも追加されない
── 地形が出ない。

なお「DEM の GSI online フォールバックを持たない」こと自体は設計メモ・CLAUDE.md
通りで正しい。問題は GSI フォールバックではなく、**static mode のローカル配信経路**
（`${origin}${base}static/...`）が落ちていること。

**どのモードで起きるか**: static mode（bridge なし、GitHub Pages 等）**のみ**。
bridge mode（localhost で bridge.py 起動）では `/tiles/gsi_dem` が配信されるので
DEM が取れ、候補B は起きない。

### 候補の切り分け方

- 34888 が **bridge mode** で地形が出ないのを再現しているなら、原因は **候補A**
  （候補B は bridge mode では起きない）。
- **static mode** で再現しているなら、候補B が一致するが、候補A も同時に効いている
  （候補A はモード非依存）。

---

## 2. boot を静かに殺す TypeError 経路

**コード箇所**: `index.js` L216、`tile_loader3d.js` L125、`terrain3d.js` L37-38。

`index.js` の boot() L216 は `loadDemStitched({ bounds: opts.dbBounds })` を呼ぶが、
`opts.dbBounds` を検証していない。`opts.dbBounds` が undefined のとき:

1. `tile_loader3d.js` の `loadDemStitched`（L125）が `tileRangeForBounds(bounds, DEM_ZOOM)` を呼ぶ
2. `terrain3d.js` の `tileRangeForBounds`（L38）が `const [w, s, e, n] = bounds` で
   undefined を分割しようとして **TypeError**

この TypeError は boot の try-catch（`index.js` L248）に拾われ、`console.error` と
`fireOnLoaded()` だけが走る。terrainReady は false のまま、地形は出ない。
**例外が console にしか出ず、画面には何の手がかりも出ない**ので、viewer 側で
`dbBounds` の渡し漏れ・型違いがあると静かに boot 失敗する。

Phase4 で viewer が `dbBounds` を渡す契約だが、boot 入口での検証
（`dbBounds` が4要素の数値配列か）が無いと、配線ミスが沈黙バグになる。

---

## 3. courseRendered フラグの早期セット

**コード箇所**: `index.js` L343（`renderCourse` 内）。

`renderCourse` は L343 で `courseRendered = true` を**関数の頭**でセットしている。
その後 L356 `createCourseRibbon` / L367 `buildGradeColoredRoadPolygons` /
L368 `createLabels3d` / L376 `createRiderMesh3d` のいずれかが throw すると、
`courseRendered` は true のまま残る。

`renderCourse` は L338 `if (courseRendered) return` で冪等化されているため、
一度途中で throw すると二度と `renderCourse` できず、コースが半端なまま固定される。

**修正の方向（参考）**: `courseRendered = true` を関数末尾（全部成功した後）に移す。

---

## 4. 各ファイルの判定

| ファイル | 判定 | 要点 |
|---|---|---|
| scene.js | PASS | 軽微: `resize`（L100-101）は container サイズ 0 のとき renderer を 1×1 にする。terrain3d.html も同型、Phase4 で #map のサイズ確認で足りる。 |
| terrain_mesh3d.js | PASS | terrain3d.html L490-507 の忠実な移植。地形が出ない直接原因は見えない。 |
| tile_loader3d.js | 問題あり | 候補B（L36-38、static 経路欠落）。 |
| index.js | 問題あり | 候補A（L232 付近、カメラ初期位置）、TypeError 経路（L216）、courseRendered 早期セット（L343）。 |
| camera3d.js | PASS | 純関数化されたオービット / 投影。問題は見えない。 |
| rider_mesh3d.js | PASS | terrain3d.html L320-379 の移植。問題は見えない。 |
| course_ribbon3d.js | PASS | 実装担当本人が他人の目で再読 ── バグは見えない。 |
| markers3d.js | PASS | 同上。軽微: `index.js` L361 が `createMarkers3d` を drapeOffset 指定なしで呼ぶ（`buildCoursePath` 既定 25m）、一方リボン L356 は 15m。マーカーとリボンで地形からの持ち上げが 10m ずれる。マーカー球が大きく実害は小さいが、index.js 側で揃えるのが綺麗。 |
| labels3d.js | 問題あり | 下記 §5。 |

---

## 5. labels3d.js のレビュー（8ファイルリスト漏れの補完）

main の最初のレビュー指示の8ファイルリストに labels3d.js が入っていなかったため、
ここで補完レビューする。labels3d.js も 34528（私）の実装。他人の目で見直した。

### 問題あり（バグ）: SpriteMaterial に transparent 指定が無い

**コード箇所**: `labels3d.js` L168（`new THREE.SpriteMaterial({ map: texture })`）、
L116-139（`makeLabelCanvas`）。

`makeLabelCanvas`（L116-139）は文字と縁取りだけを描き、**背景を塗らない** ──
canvas の文字以外の領域は alpha 0（透明）。この canvas を `CanvasTexture` にして
`SpriteMaterial` に渡しているが、`SpriteMaterial` の `transparent` は既定 false。

Three.js の material は `transparent: false` だと alpha ブレンドをしないため、
texture の透明部分（alpha 0、RGB は黒）が**黒い不透明ピクセル**として描かれる。
結果、看板が「透明背景に立つ文字」ではなく「**黒い四角の札に文字**」になる。

設計メモ部品7 が想定する「コース脇に立つ立て看板」の見た目にならない。
Phase4 の画面確認で黒い札が並ぶはず。

**修正の方向（参考、修正は別途差配）**: `labels3d.js` L168 を
`new THREE.SpriteMaterial({ map: texture, transparent: true })` にする。
（この1行で直る。なお markers3d / course_ribbon3d / 地形は不透明 material なので
transparent 問題は無い ── 透明テクスチャを使うのは labels3d だけ。）

これは私が書いたコードのバグ。前回 commit `a048b6c` に既に入っている。

### 軽微: 初期の表示窓が適用されない

`createLabels3d`（L156-217）は初期化時に `updateLabelWindow` を呼ばない。
Three.js Sprite の既定 visible は true なので、`renderCourse` 後・viewer tick が
`updateLabelWindow` を初めて呼ぶまで、全ラベルが表示される。

MapLibre 版 viewer は `loadCourse` 内で `updateSegmentLabelFilter()` を1回呼んで
ライダー起点（距離0）の窓を初期適用している。labels3d はこれをしないので、
ride 開始前（起点で待機中）に遠方のラベルまで全部見える。実害は小さい。

### 設計メモ逸脱・GSI 制約

- 設計メモ部品7 の指定（50m 間隔 / 後方150m・前方450m の窓 / 50m bucket 間引き /
  canvas→CanvasTexture→SpriteMaterial→Sprite）はすべて満たしている。逸脱なし。
- labels3d は GSI / OSM タイルを取得しないので、CLAUDE.md のタイル制約は非該当。
- 純関数（`labelDistanceBucket` / `labelWindowFlags` / `labelSpriteScale` /
  `labelWorldPositions`）は問題なし。

---

## まとめ

- **地形が出ない問題の最有力候補は A（カメラ初期位置、`index.js` L232 付近）**。
  boot がカメラを作った後に初期位置を適用していないため、boot 完了〜renderCourse の
  間カメラが原点 `(0,0,0)` に埋まり、地形が画面に映らない。bridge / static 両モードで起きる。
- 候補B（`tile_loader3d.js` L36-38、DEM の static 経路欠落）は static mode 限定。
  設計メモ L281-283 の「bridge / static 2経路」に対し bridge 一本になっている。
- boot は `opts.dbBounds` を検証せず、未指定なら `tileRangeForBounds`（terrain3d.js L38）で
  TypeError が出て catch に握りつぶされ、地形が静かに出なくなる。
- `renderCourse` は `courseRendered` フラグを関数の頭でセットするため、途中で throw すると
  二度とコースを描けない。
- labels3d.js（私の実装）に1件バグ ── `SpriteMaterial` L168 に `transparent: true` が無く、
  看板が黒い四角になる。前回 commit `a048b6c` に入っている。
- 残り（scene / terrain_mesh3d / camera3d / rider_mesh3d / course_ribbon3d / markers3d）は
  PASS。

実コードは read のみ、修正はしていない。修正の差配は main に委ねる。
