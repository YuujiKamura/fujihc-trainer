# ブリーフ b11-Phase2 ── 距離・勾配の数字を道路リボンのテクスチャに焼き込む

## はじめに

Path B 移行 (b11) の Phase 2。terrain3d.html / lib/terrain3d.js のコース道路は
b10 で地形追従のリボン mesh になり、各頂点に uv (u = コース始点からの距離 0..1、
v = 幅方向 0..1) が仕込んである。Phase 2 は、その uv を使い距離と勾配 % の数字を
canvas に描いてテクスチャ化し、道路リボンに貼る ── 数字が路面の一部として焼き
込まれた状態にする (= ツール・ド・フランスの登坂路面に巨大なペイントが描かれて
いるあの姿。billboard ラベルではない)。距離・勾配は course データの実値を使い、
丸めた偽値は出さない。MapLibre 暫定版 (segment_labels.js) は「路面に寝かせると
走行 camera で読めない」として脇に billboard を立てたが、Phase 2 は user 明示
指示で「路面に焼き込む」を採る。

本版は初版を 7 軸監査にかけ、語彙・抽象段差・テスト網羅・設計境界の 4 軸で出た
LOAD-BEARING 指摘を埋めた改訂版。

## 現状 (読んだ結果)

- `buildCourseRibbon` (terrain3d.js) が positions / indices / **uvs** を返す。
  u = distance_m / 総距離、v = 0(左)/1(右)。geometry に uv は設定済み。
- terrain3d.html はリボンを `MeshBasicMaterial({ vertexColors: true })` で描き、
  頂点色を `gradeColorContinuous(slope_pct)` (route_styling.js) で塗っている。
  uv は「後続の石で使う」とコメントされ未使用。
- course.json は各点 `{distance_m, elevation_m, slope_pct, lat, lon}`、distance_m
  は単調増加 (0, 30.58, 62.21, ...)、総距離およそ 24km。

## 用語 (この brief 内で固定)

- **マーク** ── 道路テクスチャに焼く距離点。segment_labels.js の「ラベル」
  (= コース脇に立てる billboard) とは別概念なので別語にする。マークは路面の
  一部、ラベルは路面外の立て札。混用しない。
- **major マーク** = 数字を焼く距離点 (既定 1000m 間隔)。**minor マーク** =
  位置の刻み線のみで数字なし (既定 100m 間隔)。
- データ場のキーは course.json に合わせ `distance_m` / `slope_pct` (snake_case)。
  スカラ引数は terrain3d.js の既存規約 (`bufferM` / `widthM`) に合わせ
  `majorIntervalM` 等の camelCase。

## やること

### 1. 純モジュール `web/lib/road_texture.js` (新規、DOM/Three.js/fetch 非依存)

terrain3d.js の純関数群と同じ規律 (node test 可) で書く。

- `courseTotalDistance(course)` → 最終点の `distance_m`。空配列・非有限は
  RangeError。
- `slopeAtDistance(course, distanceM)` → distanceM を挟む 2 course 点の
  `slope_pct` を `distance_m` で線形補間した**実値**。範囲外 (始点前 / 終点後) は
  端の値へ clamp。**この関数が勾配値の唯一の SoT** ── 背景色もマーク数字も
  全てこの 1 関数を通す (後述)。
- `buildRoadMarks(course, {majorIntervalM=1000, minorIntervalM=100})` →
  `{totalDistanceM, major:[{distance_m,u,slope_pct}], minor:[{distance_m,u}]}`。
  major は `majorIntervalM, 2·majorIntervalM, …` で `≤ totalDistanceM` のもの。
  各 major マークの `slope_pct` は `slopeAtDistance(course, distance_m)` の値を
  そのまま格納 (= 描画側が再計算しなくて済むようにした convenience、算出式は
  1 つ)。minor は `minorIntervalM` 間隔で数字なし。`u = distance_m /
  totalDistanceM`。`majorIntervalM` が総距離超なら major は空配列。

### 2. 描画 (terrain3d.html 内、I/O・描画層なのでここに置く)

`buildRoadTextureCanvas(course, marks)` ── canvas を作り道路テクスチャを焼く。
**この関数は新しい数値ロジックを持たない** ── マーク位置・勾配値・色は全て
§1 の純関数 (`buildRoadMarks` / `slopeAtDistance`) と `gradeColorContinuous`
(route_styling.js、テスト済) の出力をそのまま使い、自身は canvas API
(`fillRect` / `fillText` / `strokeLine`) を呼ぶだけ。よって数値の正しさは §1 の
node test で担保され、この関数自体は実画面目視で検証する (terrain3d.html の
他の描画コードと同じ扱い)。

- canvas 寸法と間隔の根拠 (load-bearing な数字):
  - **canvasW = 16384px** ── u 軸 = 約 24km の進行方向。GPU テクスチャ幅の
    一般的上限が 16384 で、最も細い (= 引き伸びる) 軸の解像度をその上限まで
    上げる。24000m ÷ 16384 ≒ **1.46 m/px**。
  - **canvasH = 128px** ── v 軸 = 路面幅 24m。24m ÷ 128 ≒ 0.19 m/px。勾配色は
    幅方向一様で解像度要求が低く、数字の縦エッジが出れば足りるので 128 で十分。
    canvas 全体 16384×128×4B = 8MB ── RX 6400 (4GB VRAM) でも軽い。
  - **major 1000m / minor 100m** ── major は 24km で 24 マーク、各マークに
    1000m ÷ 1.46 ≒ 685px を占有でき「12km 5.9%」が描ける。100m 間隔だと
    68px で数字が描けないため minor (刻み線のみ) に回す。
- 列ごとに `distanceM = (x / canvasW)·totalDistanceM`、`slopeAtDistance` →
  `gradeColorContinuous` で背景を勾配色に塗る (= 道路の色を全部テクスチャが持つ)。
  major マークの数字の勾配値も同じ `slopeAtDistance` 由来 (marks.major[].slope_pct)
  なので、マーク位置の背景色と数字は同じ実値で必ず一致する。
- minor マークを細い線、major を太い線 + 数字で焼く。数字は km 値 (major は
  整数 km ちょうどなのでその実値) を大きく、勾配 % を 1 桁で。路面ペイント風の太字。
- `CanvasTexture` 化し anisotropy を上げる (異方テクセルの滲み低減)。
- リボン material を `MeshBasicMaterial({vertexColors})` から
  `MeshBasicMaterial({map: roadTexture})` に差し替える。頂点 `color` 属性の
  生成コードは不要になるので削除。リボンの uv は既設なのでそのまま貼れる。
  `buildCourseRibbon` 自体は無改変 ── revert は material 行を戻すだけ。

### 3. テスト `web/tests/road_texture.test.js`

§1 純モジュールの全 export 関数を「落ちたら何のバグか」を 1 行で言える形で
網羅。happy / edge / error の 3 path:

- `courseTotalDistance`: 最終点距離を返す (happy) / 空配列は RangeError (error)。
- `slopeAtDistance`: course 点ちょうどの距離 → その点の slope (happy) /
  2 点間 → 線形補間値 (happy) / 始点前・終点後 → 端 clamp (edge)。
- `buildRoadMarks`: major 数 = `floor(総距離/majorIntervalM)` / `u ∈ [0,1]` /
  各 major の `slope_pct` が `slopeAtDistance` と一致 (= 偽値でない) /
  minor 数 = `floor(総距離/minorIntervalM)` で minor は数字を持たない (edge) /
  `majorIntervalM > 総距離` で major 空配列 (edge)。

描画 `buildRoadTextureCanvas` は §2 の通り新ロジックを持たないので node test
対象外、実画面目視で検証する (canvas タグ存在だけ見るような misleading test は
書かない)。既存 `web/tests/terrain3d.test.js` は `buildCourseRibbon` 等の純関数を
検証しており、本 Phase は同関数を無改変なので uv テスト (terrain3d.test.js
L495-517 等) を含め緑のまま ── material 差し替えは terrain3d.html 側のみ。

## 検証

- `npm test` (リポジトリ root の vitest、`web/tests/` を拾う) 全緑。新規
  road_texture テストも緑。触った範囲 = 新規純モジュール + その test + 既存
  terrain3d.html (純関数無改変)、回帰 gate は既存 terrain3d / viewer 系テスト
  が緑のまま。
- terrain3d.html を新規プロファイルの実 Chrome で開き desk_capture で目視 ──
  道路リボンに数字が路面の一部として焼き込まれて見えること。raw headless 厳禁。
  期待 state: 航空写真モードの地形上に、勾配色のリボンに沿って km 数字が並ぶ。
- MapLibre 版 (index.html 系) は触らない。viewer 系テストが緑のまま。
- Service Worker: 新規 `lib/road_texture.js` は `.js`、terrain3d.html は `.html`。
  sw.js の fetch handler は `.html`/`.js`/`.css` を network-first で配るので
  (`isAppShell`)、常に最新版が出る。CACHE_NAME bump も PRECACHE 変更も不要 ──
  NG-R2-1 (stale cache door) は構造的に発生しない。

## 参照

- Three.js CanvasTexture: https://threejs.org/docs/#api/en/textures/CanvasTexture
- MDN CanvasRenderingContext2D: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
- Three.js Texture.anisotropy: https://threejs.org/docs/#api/en/textures/Texture.anisotropy
- 既存資産: web/lib/terrain3d.js (buildCourseRibbon)、web/lib/route_styling.js
  (gradeColorContinuous)、web/lib/segment_labels.js (MapLibre 暫定版の数字整形)

## リスク

- **テクセル異方性**: 道路は約 24km × 24m (1000:1)。canvasW 16384px でも
  1px ≒ 1.46m、数字は進行方向に引き伸びる。これは長く細い路面に焼く以上不可避で、
  実際の登坂ペイントも進行方向に伸びている。Phase 5 の追従 camera (路面に近い)
  で読めることを主眼に置き、俯瞰では勾配色が概況を担う。第一実装後に desk_capture
  で見て、読めなければ数字サイズ・間隔を調整して再検証する。
- 背景色をテクスチャが持つので、頂点色版と色が一致することを `gradeColorContinuous`
  共用で担保する (テクスチャは距離等間隔サンプル ── course 点より細かい)。

## 制約

- push 禁止、commit (worktree) は OK。MapLibre 版を壊さない・消さない。
- 調査メモ・本ブリーフは repo 外 (~/.agents/scratch/)。

## まとめ

Phase 2 = リボンの既設 uv を使い、距離 km と勾配 % の実値を canvas に焼いた
テクスチャを道路に貼る。純ロジック (総距離・距離→勾配補間・マーク列) を
road_texture.js に出し、勾配値は `slopeAtDistance` 1 関数を SoT に背景色も数字も
そこを通す。描画は terrain3d.html、material を頂点色から map へ差し替え。canvasW
16384 / canvasH 128 / major 1000m / minor 100m は進行方向解像度と数字の可読性
から逆算した値。検証は npm test 全緑 (純関数を全 path 網羅) + 実 Chrome 目視。
読めなければサイズ・間隔を調整して再目視する。
