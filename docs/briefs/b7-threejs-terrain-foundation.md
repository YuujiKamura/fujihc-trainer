# ブリーフ b7 ── 地形データを Three.js で表現する (Path B viewer の基礎)

## はじめに

fujihc-trainer の viewer は現在 MapLibre GL JS で動いている。MapLibre は地図エンジン
であって3Dエンジンではない。本物の3Dオブジェクトが置けず、rider は fill-extrusion の
角柱 (= 豆腐) にしかならず、球も描けない。さらに「世界中どこでもパンできる」汎用地図
エンジンの overhead を毎フレーム抱えるが、このアプリは富士ヒル24km1本の固定コース
しか使わない。

方針を決めた ── viewer を本物の3D空間 (Three.js) で組み直す (Path B)。その基礎の
最初の一石が「地形を Three.js で描く」こと。本ブリーフはその基礎**だけ**を対象にする。
目先の hack ではなく、基礎から建てる。

## ゴール

スタンドアロンの HTML ページ (inertia-sim.html と同じ独立ページ) で、富士ヒル
コース区間の地形を Three.js の本物の3Dメッシュとして表示する。MapLibre は使わない。
ページを開いて、富士山麓の起伏地形だと目で見て分かること。

## 背景・既存資産 (= 作り直すな、再利用しろ)

- 地形の元データは国土地理院の DEM (標高タイル、GSI dem_png 形式)。MapLibre は
  これでメッシュを変位させているだけ ── 同じ DEM から Three.js でメッシュを直接組める。
  MapLibre から「エクスポート」する必要はない、データ源は DEM。
- `web/lib/terrain_mesh.js` に GSI dem_png の decode と bilinear upsample が既にある。
  DEM の読み取り部分はこれを再利用しろ。
- `web/inertia-sim.html` で Three.js (vendored r160) が既にこのプロジェクトで動いている。
  その vendored Three.js を使え (新規 CDN 取得はするな)。
- `web/course.json` (または `web/static/course.json`) にコースの緯度経度列がある。
  地形の対象範囲はこの bounding box (+ 余白) から決める。

## やること (基礎のみ ── これだけ)

1. course.json からコースの bounding box を出し、その範囲 (+余白) を覆う DEM タイル
   群を特定・取得する。
2. terrain_mesh.js の decode で各タイルを標高グリッドにし、範囲全体の標高グリッドに
   つなぐ。
3. Three.js の地形メッシュを組む ── BufferGeometry に、緯度経度を平面座標へ直し、
   標高で高さを変位させた頂点格子、三角形 index、computeVertexNormals() の法線。
4. 地図画像 (GSI 標準地図か写真の raster タイル) を地形にテクスチャとして貼る
   (= 灰色メッシュではなく地形に見えるように)。
5. ライティング (DirectionalLight + AmbientLight)。
6. カメラはマウスで回して見られる程度 (OrbitControls か簡易実装)。
7. スタンドアロン HTML ページ (例: `web/terrain3d.html`) として完結させる。

## やらないこと (この基礎ブリーフの対象外 ── 後続の石)

rider、自転車モデル、物理、ride 駆動、HUD、ミニマップ、コースの道路ライン、
本番 viewer (index.html / viewer-maplibre.js) への置き換え。基礎 (地形) が立って
実画面で確認できてから、次の石を別ブリーフで積む。一度に全部やろうとするな。

## なぜスタンドアロンか

現行の MapLibre viewer は master で動いていて、5機能 + b6 が入っている。それを
壊さないため、基礎は別ページで建てる。建てて、目で見て確かめてから、本番を移すか
判断する。

## 検証

- ページを実画面で開き、富士の地形が3Dメッシュとして起伏込みで見えること。
  desk_capture か headless-shot.ps1 で目視 (raw chrome --headless 直叩き禁止)。
- DEM decode → 標高グリッド → メッシュ頂点 のデータ経路の単体テスト
  (頂点数、座標範囲、標高の min/max が妥当か)。
- `cd web && npm test` 全テスト green、既存テストを1件も壊さない。

## 制約

- MapLibre / viewer-maplibre.js / index.html には触らない。既存 viewer を壊すな。
- push 禁止 (commit は OK)。silent execution。
- 調査メモは repo 外 (`~/.agents/scratch/fujihc-trainer-project/`) へ。

## まとめ

ゴール = 富士ヒルコースの地形が Three.js の本物の3Dメッシュとして1枚のスタンドアロン
ページに見えること。MapLibre から書き出すのではなく DEM データから直接組む。
地形だけ、rider も物理も後。これが Path B viewer の基礎石。
