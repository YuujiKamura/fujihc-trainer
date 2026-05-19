# b12 Phase3 設計メモ — Three.js 地図描画モジュール

担当: ワーカー34888 (Phase3 準備)。

2026-05-18 更新: Phase2.5 完了 (40324 commit cb5bccc) で差し替え口が
`web/lib/map_renderer.js` の意味メソッド15個に確定した。本メモを実際の契約に
突合して書き直した。実コードは read のみ、viewer-maplibre.js / map_renderer.js /
web/courses/ は不可侵で遵守。

---

## はじめに — このメモで決めること

Phase3 で作る Three.js 地図描画モジュールを、どんな部品に割るか、各部品が
`map_renderer.js` の15個の意味メソッドのうちどれを実装するかを対応づける。
40324 のレビュー指摘「リネームでなく粒度の突合」に従い、部品名の言い換えではなく、
契約のメソッド単位で「この部品がこのメソッドを持つ」を決める。

差し替え口は意味ベースに切り直されている。viewer 本体は地図インスタンスを持たず、
`createMapRenderer()` が返す renderer オブジェクトの15メソッド経由でしか地図を
操作しない。Phase3 の Three.js 実装は、この同じ `createMapRenderer()` の形
(= 15メソッドを持つオブジェクトを返す factory) を満たせばよい。中身が MapLibre か
Three.js かは viewer から見えない。

地図背景は航空写真テクスチャ方式で決定済 (brief 判断3)。汎用抽象は作らない
(brief 判断2、YAGNI)。

---

## 1. 差し替え口の契約 — 意味メソッド15個

`map_renderer.js` の `createMapRenderer()` が返すオブジェクトのメソッド。
viewer はこれだけを呼ぶ。Three.js 実装も同じ15個を同じシグネチャで実装する。

ライフサイクル系:
- `isBooted()` — 地図インスタンスが生成済か (boot 済か) を bool で返す。
- `boot(env, opts)` — 地図を生成し、load / idle / error / カメラ入力を結線する。
  `opts = { dbBounds, dbCenter, onLoaded }`。onLoaded は地形セット + 操作系
  無効化 + カメラ入力結線が終わった後に呼ばれ、viewer の起動継続を回す。
- `onceIdle(cb)` — 「idle」(= viewport 内の全タイル読込 + 描画完了) を購読する。
  既に idle 済なら即 cb。

カメラ系:
- `setCameraDefaults({ zoom, pitch })` — 初期 zoom / pitch を指定する。
- `updateCamera({ course, curIdx, fracInSegment, lon, lat, lookAhead, apply })` —
  毎フレーム、カメラをライダー現在位置に追随させる。apply=false なら動かさず
  進行方位だけ計算。戻り値 `{ headingRad, bearingDeg }` を minimap / debug HUD が使う。
- `projectToScreen(lon, lat)` — 地理座標を画面 pixel `{ x, y }` に投影する
  (= rider 追随 HUD の座標計算)。
- `getCameraInfo()` — デバッグ HUD 用に `{ zoom, pitch, centerLng, centerLat }`。
- `render()` — 1 フレーム描画。MapLibre は自動再描画で no-op、Three.js はここで描く。

コース描画系:
- `renderCourse(course)` — course 点列から地形上のコース (勾配色の道路リボン +
  距離ラベル + 起点終点マーカー + ライダー層) を組み、初期カメラを起点に寄せる。
  起動時 1 回のみ (冪等)。

ライダー系:
- `updateRider({ course, curIdx, lat, lon, spin })` — ライダーを現在位置に置く。
  前フレームから動いた時だけ geometry 再構築。

距離ラベル系:
- `setLabelScale(scale)` — ラベル表示倍率を変える (機器設定の slider 連動)。
- `updateLabelWindow(riderDistM)` — ラベルの表示窓をライダー現在地に追従させる
  (50m 刻みの bucket 変化時だけ実反映)。

光源系:
- `setSunlightDirection(deg)` — 太陽の方位 (0..360°)。
- `setSunlightStrength(exaggeration)` — 陰影の強さ (0..1)。

起点/終点マーカー系:
- `setStartGoalVisible(visible)` — ride 中はメイン地図から起点終点ピンを退ける
  (minimap には残す)。

合計15個。Three.js 実装はこの15個を SoT として作る。

---

## 2. terrain3d.html / terrain3d.js の現状分析 (Phase3 の下敷き)

### 2-1. terrain3d.js (web/lib/、純関数、node test 済) — そのまま資産

DOM / Three.js / fetch 非依存。Phase3 でも無改造で使う。

- `tileRangeForBounds(bounds, zoom)` — bbox → DEM タイル矩形範囲。
- `stitchHeightGrid(tileGrids, range, tileSize)` — タイル別標高グリッド → 連続グリッド。
- `buildTerrainGeometry(stitched, range, opts)` — 標高グリッド → BufferGeometry 用
  typed array。投影は東+X / 上+Y / 北-Z。
- `courseBounds(course, bufferM)` — course → 外接 bbox + 余白。
- `sampleHeightBilinear(stitched, range, lat, lon)` — 標高グリッドを緯度経度で
  bilinear サンプル (= drape の核、投影の逆写像にも使える)。
- `buildCoursePath` / `buildCourseRibbon` / `courseRingSlopes` — コースの 3D 化。
- `decodeGsiHeightGrid` — terrain_mesh.js の再 export。

座標系 SoT: 東 = +X、上 = +Y (標高 m)、北 = -Z。terrain3d.js / rider_placement.js /
terrain3d.html が全部この系で一致。Phase3 モジュールも厳守する。

関連純関数で Phase3 が再利用するもの: `computeMiterOffsets` (road_polygon.js)、
`gradeColorContinuous` (route_styling.js)、`riderPlacementAtDistance`
(rider_placement.js)、`computeTravelHeading` (heading.js)、`adjustZoom` / `adjustPitch`
(camera_controller.js)。`buildSegmentLabels` (segment_labels.js) は距離ラベルに使う。

### 2-2. terrain3d.html (779 行、HTML 直書き) — 整理して取り込む

terrain3d.html が今やっていること:

地形メッシュ・コースリボン・始点終点マーカー・ライダー 3D mesh・シーン/ライティング・
カメラ・rAF ループを HTML に直書きで全部持っている。HUD / 物理 / rider ロジックは
共有 lib (`createHud` / `integratePhysics` / `createTerrain` / `createRider`) を
import して使っており、ロジック自体の二重実装はしていない。

「間違ったアーキテクチャ」と叱られた正体は、ロジックの二重実装ではなく統合構造の
二重実装。`loop()` が「物理積分 → rider 更新 → bike 配置 → カメラ → HUD 更新 →
rider-hud 画面投影 → render」を全部やっており、これは viewer の rAF ループと丸かぶり。
つまり terrain3d.html は「地図を描く部分」だけでなく「ride を回す部分」まで抱えている。

Phase3 の整理方針はこの契約構造からそのまま出る。15メソッドのうち rAF ループは
存在せず、`render()` が「1 フレーム描く」だけ。viewer の tick が毎フレーム
`updateRider → updateCamera → render` を呼ぶ。terrain3d.html の `loop()` が
やっていた物理 / HUD オーケストレーションは Phase3 では捨て、viewer 本体の tick が SoT。

distance label (route-labels) は terrain3d.html には無い。MapLibre 版は
`renderCourse` 内で約 50m 間隔の「距離+勾配」標識を billboard で立てている。
Three.js 版はこれを新規に作る (後述 部品7)。

---

## 3. モジュール部品分割 — 8 部品 + タイル取得

Three.js 地図描画モジュールを下記 8 部品に割る。配置は `web/lib/map3d/` 配下を
想定 (Phase3 着手時に確定)。各部品が15メソッドのどれを担うかを明記する。

純ロジック (buildTerrainGeometry / buildCourseRibbon / riderPlacementAtDistance /
computeMiterOffsets / buildSegmentLabels 等) は terrain3d.js / 既存 lib に既にある。
新規に作らない。下記部品は「純関数の出力を Three.js オブジェクトに変換し、scene を
組み立て、毎フレーム更新する」薄い描画層に徹する。

### 部品0: createMapRenderer ファサード (Three.js 版)

`map_renderer.js` の `createMapRenderer()` と同じ形の factory を Three.js 用に作る。
15メソッドを持つオブジェクトを返し、内部で部品1〜7を組み合わせる。
担当メソッド: `isBooted()` / `boot(env, opts)` / `onceIdle(cb)`。

- `boot` は env (bridge / static) からタイル取得経路を決め、部品1でシーンを生成、
  部品4でカメラを生成、カメラ入力を結線、地形 DEM 取得を開始する。準備が済んだら
  `opts.onLoaded` を呼ぶ。
- `idle` の Three.js 的意味は「DEM タイル + 航空写真テクスチャの取得が済み、地形
  メッシュ + コースが組まれ、最初の 1 フレームを描き終えた」。そこで onceIdle の
  cb を発火する。MapLibre の「viewport 全タイル読込完了」と意味が対応する。
- `isBooted()` はシーン生成済か。

配置の判断 (要 Phase3 着手時に確定): MapLibre 版は地形を `boot` 時に作り
(style に dbBounds がある)、コース固有物を `renderCourse` で作る。Three.js 版は
地形メッシュも `courseBounds(course)` で範囲を出すか `opts.dbBounds` で出すか選べる。
`boot` に dbBounds が来るので地形 DEM 取得は `boot` で先行開始でき、course 依存の
リボン / ラベル / マーカーは `renderCourse` で作る ── この分担を推奨する
(= boot 中に重い DEM 取得を走らせ、idle までに間に合わせる)。

### 部品1: シーン / レンダラ / ライティング (scene)

担当メソッド: `render()` / `setSunlightDirection(deg)` / `setSunlightStrength(exaggeration)`。

- `THREE.Scene` / `THREE.WebGLRenderer` / `THREE.Fog` の生成と canvas の container 追加。
- ライティング: DirectionalLight (太陽) + AmbientLight + HemisphereLight。
  terrain3d.html L592-597 の移植。
- `render()` は scene + camera を 1 フレーム描く。rAF は持たない。
- `setSunlightDirection(deg)` は DirectionalLight の方位 (太陽の azimuth) を更新する。
  MapLibre の hillshade-illumination-direction の Three.js 対応。
- `setSunlightStrength(exaggeration)` は DirectionalLight の強度を更新する。
  MapLibre は hillshade レイヤーの exaggeration をいじるが、Three.js には hillshade
  レイヤーが無い ── 航空写真テクスチャに陰影が既に焼き込まれており、Three.js の
  太陽光は地形メッシュの法線陰影 (computeVertexNormals + MeshStandardMaterial) に
  しか効かない。exaggeration 0..1 を光の強度にマップするのが最も素直な対応。
  見え方は MapLibre の hillshade とは厳密一致しないが、設定スライダーが「太陽を
  強める / 弱める」という意味は保たれる。Phase4 の画面確認で違和感が出たら調整する。
- `resize()` (container サイズ → renderer / camera aspect)。

### 部品2: 地形メッシュ (terrain_mesh3d)

担当メソッド: なし (renderCourse / boot から呼ばれる内部部品)。

- 入力 = stitched 標高グリッド + range + 航空写真テクスチャ。
- `buildTerrainGeometry` を呼び、BufferGeometry + `computeVertexNormals()` +
  MeshStandardMaterial(map=航空写真) で `THREE.Mesh` 化。terrain3d.html L490-507 の移植。
- 戻り値に geo メタ (minH/maxH/sizeX/sizeZ/centerLat/centerLon) を含める。カメラ初期化・
  fog 距離・リボン投影・projectToScreen がこれを参照する。

### 部品3: コースリボン (course_ribbon3d)

担当メソッド: なし (renderCourse から呼ばれる内部部品)。

- 入力 = course 点列 + stitched + range + geo メタ。
- 道路リボンの BufferGeometry を組む。各点 slope_pct → `gradeColorContinuous` で
  頂点色、左右端を `sampleHeightBilinear` で drape、MeshBasicMaterial(vertexColors)。
- terrain3d.html はリボンを main() 内にインライン実装し、terrain3d.js の
  `buildCourseRibbon` を import しつつ使っていない。両者の差は「頂点色を持つか」だけ。
  推奨は `buildCourseRibbon` に頂点色出力を足し、部品3はそれを呼ぶだけにする
  (= 純ロジックを 1 箇所に集約)。ただし terrain3d.js はテスト有 (terrain3d.test.js)
  なので、改修前に test 影響を grep 確認してから着手する。
- MapLibre 版は `renderCourse` で道路 polygon を 5m 幅に展開し勾配色分けしている
  (`buildGradeColoredRoadPolygons`)。Three.js 版は 3D リボンで同じ「勾配色の走路」を
  表現する ── 出力形 (2D fill polygon と 3D ribbon) は違うが、viewer から見た
  `renderCourse` の意味「コースの走路を勾配色で描く」は同じ。

### 部品4: カメラ (camera3d)

担当メソッド: `setCameraDefaults({ zoom, pitch })` / `updateCamera(...)` /
`projectToScreen(lon, lat)` / `getCameraInfo()`。

- `THREE.PerspectiveCamera` の生成と球面オービット計算。terrain3d.html L602-679 の移植。
- マウス操作: ドラッグ → bearing / pitch、ホイール → zoom。`map_renderer.js` の
  `wireCameraInput` (L250-277) の Three.js 対応。
- `setCameraDefaults` は userZoom / userPitch の初期値を入れる。
- `updateCamera` はライダー現在位置にカメラを追随させ、`{ headingRad, bearingDeg }`
  を返す。進行方位は `computeTravelHeading` (heading.js、純関数) を再利用できる。
  apply=false なら方位だけ計算して返す。
- 要注意の突合点: MapLibre の zoom (21) / pitch (85) は Three.js の
  PerspectiveCamera に 1:1 では写らない。zoom → カメラ距離、pitch → 仰角に翻訳する
  変換が要る。terrain3d.html のカメラは既に pitch を度で、距離を radius で持って
  いるので、この変換層は terrain3d.html のカメラ式を下敷きにできる。Phase3 で
  最も実装判断が要るのがここ ── 「MapLibre の zoom 値を渡されたとき Three.js の
  どのカメラ距離にするか」を Phase3 着手時に決め、Phase4 の画面確認で詰める。
- `projectToScreen(lon, lat)` は地理座標を画面 pixel に変換する。Three.js では
  lon/lat → ワールド XYZ (terrain3d の投影、centerLat/centerLon と DEM 標高が要る)
  → `vec.project(camera)` → screen pixel。MapLibre の `map.project` のように
  直接 lon/lat を取れないので、部品4 は地形の投影パラメータ (geo メタ) と標高サンプル
  経路を持つ必要がある。これを省くと ride 中の rider-hud が画面に固まる
  (brief L110-111)。
- `getCameraInfo` は debug HUD 用に zoom / pitch / 中心緯度経度を返す。

### 部品5: ライダー 3D mesh (rider_mesh3d)

担当メソッド: `updateRider({ course, curIdx, lat, lon, spin })`。

- `buildBikeMesh()` (terrain3d.html L331-379) + `addBikeTube()` の移植。Three.js
  primitive で自転車 unit モデルを組む。
- `updateRider` は与えられた現在位置から bike mesh の position / quaternion を更新する。
  距離 → 配置は `riderPlacementAtDistance` (rider_placement.js、純関数) を再利用。
  contract の引数は curIdx / lat / lon / spin なので、course と curIdx から距離を
  引くか、lat/lon から直接ワールド座標を出す。spin (車輪の回転) も mesh に反映する。
- MapLibre 版のライダーは `fill-extrusion` の立体だが、Three.js 版は本物の自転車
  mesh。viewer から見た `updateRider` の意味「ライダーを現在位置に置く」は同じ。
- 物理・速度は持たない。走行距離は viewer 本体の rider / 物理モジュールが出す。

### 部品6: 起点 / 終点マーカー (markers3d)

担当メソッド: `setStartGoalVisible(visible)`。

- `renderCourse` 時にコース両端へマーカー mesh を置く (起点 = 緑、終点 = 赤、
  MapLibre の Marker 色に合わせる)。terrain3d.html L564-579 を下敷きにしつつ、
  起点側も Marker として置く (terrain3d.html は起点に自転車があるとして球を省いて
  いたが、contract が起点終点両方の可視制御を要求するので両方 mesh を持つ)。
- `setStartGoalVisible(visible)` はマーカー mesh の visible を切り替える。

### 部品7: 距離ラベル (labels3d) ── terrain3d.html に無い、新規

担当メソッド: `setLabelScale(scale)` / `updateLabelWindow(riderDistM)`。

- `renderCourse` 時に `buildSegmentLabels` (segment_labels.js、純関数) で約 50m
  間隔の「距離+勾配」標識を出し、各標識を Three.js の billboard sprite として
  コース脇に立てる。MapLibre 版は canvas 画像 + symbol layer の icon-image 方式。
  Three.js では canvas → CanvasTexture → SpriteMaterial → Sprite で同じ「常にカメラを
  向く立て看板」を作れる。
- `setLabelScale(scale)` は sprite の scale を倍率変更する。
- `updateLabelWindow(riderDistM)` はライダー近傍の距離窓 (後方 150m 〜 前方 450m)
  外の sprite を非表示にする。50m 刻みの bucket 変化時だけ反映 (= MapLibre 版の
  `lastLabelBucket` 間引きと同じ)。
- terrain3d.html はラベルを持たないので、ここは下敷きが無い純新規。距離ラベルの
  数値ロジック自体は `buildSegmentLabels` が持つので、新規なのは billboard 描画だけ。

### タイル取得 (tile_loader3d)

担当メソッド: なし (boot / renderCourse から呼ばれる内部部品)。

- DEM タイルと航空写真 (seamlessphoto) タイルを取得し、標高グリッド / テクスチャを返す。
  terrain3d.html の `resolveDemBase` / `loadDemGrid` / `fetchLayerCanvas` /
  `buildPhotoTexture` / `mapLimit` / `loadImage` を移植する。
- 経路の切り分け (main 監査で確定、2026-05-18):
  - **DEM タイル**は bridge / static のローカル DB にある。DEM の GSI online
    フォールバックは持ち込まない (Axis4)。`map_renderer.js` の
    `BRIDGE_TILE_BASE_URL` / `STATIC_TILE_BASE_URL` (L31-33) と同じ導出で
    `${origin}/tiles/gsi_dem/...` か `${origin}${base}static/...` を叩く。
  - **航空写真 (seamlessphoto)** は bridge に無く、GSI からの取得が唯一経路。
    CLAUDE.md が seamlessphoto を 1 回・数十枚・IndexedDB キャッシュで取ることを
    中核設計として許容しているので (「seamlessphoto 固定」)、terrain3d.html の
    `fetchLayerCanvas` / `buildPhotoTexture` の seamlessphoto 取得経路を移植する。
  - 「GSI online フォールバック禁止」は DEM に対する規律。seamlessphoto の
    GSI 取得はフォールバックではなく唯一経路であり、CLAUDE.md 許容範囲。
- 守る定数: `GSI_FETCH_LIMIT = 6` / `MAX_TILES = 200` / DEM_ZOOM 14 /
  seamlessphoto 固定 (std/relief/hybrid 追加禁止) / `openTileCache` の IndexedDB
  キャッシュを外さない / `© 国土地理院タイル` クレジット維持。

---

## 4. 15メソッド → 部品 対応表 (粒度の突合結果)

40324 のレビュー指摘に答える形で、契約のメソッド単位で担当部品を一覧する。

- `isBooted()` → 部品0 (ファサード)
- `boot(env, opts)` → 部品0 が orchestrate (部品1 シーン生成、部品4 カメラ生成、
  tile_loader3d で DEM 取得開始)
- `onceIdle(cb)` → 部品0 (DEM + テクスチャ取得 + 初回描画完了で発火)
- `setCameraDefaults(...)` → 部品4 (カメラ)
- `updateCamera(...)` → 部品4 (カメラ)
- `projectToScreen(lon, lat)` → 部品4 (カメラ、地形投影 + camera.project)
- `getCameraInfo()` → 部品4 (カメラ)
- `render()` → 部品1 (シーン)
- `renderCourse(course)` → 部品0 が orchestrate (tile_loader3d、部品2 地形、
  部品3 リボン、部品7 ラベル、部品6 マーカー、部品5 ライダー mesh 生成、初期カメラ)
- `updateRider(...)` → 部品5 (ライダー mesh)
- `setLabelScale(scale)` → 部品7 (距離ラベル)
- `updateLabelWindow(riderDistM)` → 部品7 (距離ラベル)
- `setSunlightDirection(deg)` → 部品1 (シーン、DirectionalLight 方位)
- `setSunlightStrength(exaggeration)` → 部品1 (シーン、DirectionalLight 強度)
- `setStartGoalVisible(visible)` → 部品6 (マーカー)

15メソッド全部に担当部品が付いた。逆に、契約に無い責務 (rAF ループ、物理積分、
HUD オーケストレーション) はどの部品も持たない ── これらは viewer 本体の tick が SoT。
terrain3d.html の `loop()` が抱えていた分はここで捨てる。

---

## 5. HUD / 物理 / BLE — 再実装しない

viewer 本体の既存モジュールをそのまま使う。Three.js モジュールは触らない。

- HUD: `createHud` (hud.js) ── viewer の tick が更新。
- 物理: `integratePhysics` (bike_physics.js) + `createRider` / `createTerrain` ──
  走行距離・速度を出すのは viewer 本体。Three.js モジュールはその距離を
  `updateRider` / `updateCamera` の引数で受け取るだけ。
- BLE: viewer 本体のまま。Three.js モジュールは BLE を一切知らない。
- minimap: Canvas 2D 直描画で地図ライブラリ非依存。`updateCamera` の戻り値
  `headingRad` を minimap が使う ── この戻り値契約を Three.js の `updateCamera` も
  必ず満たす。

---

## 6. Phase3 着手時に確定 / 確認を要する点

確証がないものを確証あるように書かない (CLAUDE.md)。

1. MapLibre zoom / pitch 値 → Three.js カメラ距離 / 仰角の変換 (部品4)。Phase3 で
   最も実装判断が要る。terrain3d.html のカメラ式を下敷きに、Phase4 の画面確認で詰める。
2. `projectToScreen` の lon/lat → ワールド座標変換。部品4 が地形の投影パラメータと
   標高サンプル経路を持つ必要がある。設計上は解決済だが実装で要注意。
3. seamlessphoto の取得経路 → **確認済み (main 監査、2026-05-18)、未解決ではない**。
   bridge のローカル配信は標高タイルのみで航空写真は持たない (src 全体に
   seamlessphoto 文字列ゼロ)。terrain3d.html は `buildPhotoTexture` /
   `fetchLayerCanvas('seamlessphoto', 'jpg', ...)` で GSI から取得していた。
   fujihc CLAUDE.md は「seamlessphoto 固定」を地図テクスチャの中核設計とし、
   GSI から 1 回・数十枚・IndexedDB キャッシュという取得を明示的に許容している。
   → Phase3 の航空写真は terrain3d.html と同じ経路 (GSI から 1 回取得 +
   openTileCache) で確定。ユーザー判断は不要。
4. `buildCourseRibbon` に頂点色出力を足す改修 (部品3)。terrain3d.js はテスト有。
   着手前に terrain3d.test.js への影響を grep 確認。
5. `setSunlightStrength` の exaggeration → 光強度マッピング (部品1)。航空写真に陰影が
   焼き込み済のため MapLibre の hillshade とは見え方が一致しない。Phase4 の画面確認で調整。
6. Three.js 版 `createMapRenderer` をどこに置き、viewer がどちらの実装を使うかの
   切替 ── これは Phase4 (差し替え) の範囲。Phase3 は Three.js factory を作るところまで。

---

## まとめ

- 差し替え口は `map_renderer.js` の意味メソッド15個に確定。Phase3 の Three.js 実装は
  同じ `createMapRenderer()` の形 (15メソッドを持つオブジェクトを返す factory) を満たす。
- Three.js モジュールを 8 部品 (ファサード / シーン / 地形メッシュ / コースリボン /
  カメラ / ライダー mesh / マーカー / 距離ラベル) + タイル取得に割り、15メソッド全部に
  担当部品を対応づけた (4 節の対応表)。
- 距離ラベル (部品7) は terrain3d.html に無い純新規。数値ロジックは
  `buildSegmentLabels` が持つので、新規なのは billboard 描画だけ。
- 純ロジック (buildTerrainGeometry / buildCourseRibbon / riderPlacementAtDistance /
  computeMiterOffsets / buildSegmentLabels 等) は terrain3d.js / 既存 lib に既にある。
  新規に作らず、部品は薄い描画層に徹する。
- rAF ループ・物理・HUD オーケストレーションはどの部品も持たない。viewer 本体の
  tick が SoT。terrain3d.html の `loop()` が抱えていた分はここで捨てる
  ── これが「二重実装をやめる」の具体。
- タイル取得は GSI online フォールバックを持ち込まず、`map_renderer.js` と同じ
  bridge / static 経路に統一する。
- Phase3 着手時に確定を要する 6 点 (カメラ値変換 / projectToScreen 座標 / 航空写真の
  取得経路 / buildCourseRibbon 改修の test 影響 / 光強度マッピング / 実装の置き場と
  Phase4 の切替) は着手時に確認・ユーザー判断。確証なく進めない。

実コードは read のみ。viewer-maplibre.js / map_renderer.js / web/courses/ は不可侵で遵守。
