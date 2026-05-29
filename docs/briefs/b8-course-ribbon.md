# ブリーフ b8 ── コースの道路を地形表面に沿うリボン mesh で描く (Path B 第二石)

## はじめに

terrain3d.html (= b7 で建てた Three.js 地形ページ) には今、 富士ヒルコースが
slope 色分けのチューブ (= TubeGeometry の 3D パイプ) として乗っている。 チューブは
「線」としては見えるが、 道路には見えない ── 地形の上に丸い管が浮いている。

Path B の本番 viewer に育てる過程で、 コースは「道」として地形表面に貼り付いて
いてほしい。 本ブリーフはチューブをやめ、 コースを **地形表面に沿う平たいリボン
mesh** (= 道路状の帯) に置き換える石を 1 つ積む。

## ゴール

terrain3d.html のコース表示を、 地形表面に沿った平たいリボン (帯) の mesh に
する。 リボンは富士ヒルコースの幅を持ち、 各区間の勾配で色分けされ (緑 平坦 →
紫 激坂)、 地形の起伏に沿って上り下りする。 ページを開いて、 地形の上に「道」が
通っているのが目で見て分かること。

## 背景・既存資産 (= 作り直すな、再利用しろ)

- `web/lib/terrain3d.js` に既に純関数がある: `buildCoursePath` (course → 地形沿い
  中心線頂点列)、 `sampleHeightBilinear` (緯度経度で標高グリッドを bilinear
  サンプル)、 `courseRingSlopes`。 リボンの両端頂点も DEM 標高で drape するため
  `sampleHeightBilinear` を再利用する。
- 勾配色は `web/lib/route_styling.js` の `gradeColorContinuous(slope_pct)` を使う。
  これは MapLibre 非依存の純関数 (= coupling 調査で確認済)、 既存 viewer の道路
  ポリゴンと同一パレット。 MapLibre style 式を出す `makeGradeColorExpression` は
  使わない。
- `web/course.json` がコースの緯度経度・標高・slope_pct 点列 (= GPX 由来)。
- 投影は `buildTerrainGeometry` と同一でなければ地形とズレる: 同じ centerLat /
  centerLon、 東 = +X、 北 = -Z、 標高 = +Y。

## やること (この石だけ)

1. `web/lib/terrain3d.js` に純関数 `buildCourseRibbon(course, opts)` を追加する。
   - course 各点で進行方向 (= 前後点の接線) を XZ 平面で求め、 その直交方向に
     道幅の半分だけ左右へ振った 2 頂点を生成する。
   - 左右頂点はそれぞれ緯度経度へ戻して `sampleHeightBilinear` で DEM 標高を
     引き、 地形表面に沿わせる (= 中心線だけ沿わせて両端が地形を突き抜ける/
     浮くのを防ぐ)。
   - 戻り値: `{ positions, indices, vertexCount }`。 1 区間 = 2 三角形。
   - 道幅・drape 持ち上げ量・誇張は opts で受ける。 道幅の既定は load-bearing
     なので「実コース幅 ≒ N m」の根拠コメントを付ける。
2. terrain3d.html のチューブ (TubeGeometry) をこのリボン mesh に置き換える。
   - 頂点色 = 各頂点が属する course 点の slope_pct を `gradeColorContinuous` で。
   - 材質は `MeshBasicMaterial({ vertexColors: true, side: DoubleSide })`
     (= 陰影なしで色がそのまま出る、 法線・winding 不問)。
   - 始点 / 5合目終点の球マーカーと勾配凡例は現状維持。
3. `cd web && npm test` 全緑。 既存テストを 1 件も壊さない。 `buildCourseRibbon`
   の単体テストを追加する: 頂点数・index 数、 左右頂点が中心線を挟むこと、
   左右頂点間の距離 ≒ 道幅、 Y が DEM 標高 + 持ち上げ、 東の点ほど X 大、
   空 course で RangeError。

## やらないこと (この石の対象外)

rider / 自転車 / 物理 / ride 駆動 / HUD / ミニマップ / 本番 viewer 置換 /
表示モード切替の改変 / カメラ既定の変更。 リボン化だけ。

## 検証

- 実画面: range server (port 8024) で terrain3d.html を新規プロファイルの実
  Chrome (`--user-data-dir`) で開き、 desk_capture で目視。 地形の上にコースが
  「平たい帯の道」として乗り、 起伏に沿って上下し、 勾配色が出ていること。
  raw `chrome --headless` 直叩き厳禁、 headless-shot は never-idle ページで
  使えない。
- 単体テスト: `buildCourseRibbon` のデータ経路 (頂点・index・幅・drape・向き)。
  happy / edge / error path を揃え、 tautological にしない。
- `cd web && npm test` 全テスト green、 既存テスト無破壊。

## 制約

- MapLibre / viewer-map3d.js / index.html には触らない。
- push 禁止 (commit は OK)。 silent execution。
- 調査メモは repo 外 (`~/.agents/scratch/fujihc-trainer-project/`) へ。

## 参照

- Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
- Three.js BufferAttribute: https://threejs.org/docs/#api/en/core/BufferAttribute
- Three.js Material.vertexColors / side:
  https://threejs.org/docs/#api/en/materials/Material.vertexColors
- GSI 標高タイル仕様: https://maps.gsi.go.jp/development/demtile.html
- 既存純関数: `web/lib/terrain3d.js` / `web/lib/route_styling.js`

## まとめ

ゴール = コースがチューブではなく地形表面に沿う平たいリボン (道路状の帯) として
terrain3d.html に乗り、 勾配色付きで起伏に沿って見えること。 投影・色・標高
サンプルは既存純関数を再利用し、 `buildCourseRibbon` を 1 本足してテストで pin
する。 リボン化だけ、 rider も物理も後。 Path B viewer へ育てる第二石。
