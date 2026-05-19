# タスク: 前後の車輪の底を路面に正確に乗せる（2 点接地方式）

## 目的

走行画面のライダー（自転車）の前輪・後輪の底（接地点）が、路面に正確に乗っていない。勾配が変わる所で前輪か後輪のどちらかが路面から浮く、またはめり込む。前輪・後輪それぞれの接地点の高さが、その位置の路面の高さにぴたりと一致するようにする。

## なぜ

直前のタスク（commit 274baf4）で自転車のピッチを路面の勾配に追随させたが、その直し方は「自転車を中心の 1 点で置いて剛体ごと回す」だけ。自転車は接地点間およそ 2m の剛体、コース点は約 12m 間隔で勾配が変わる。中心 1 点で回しただけでは、勾配が変わる区間をまたぐとき前後どちらかの車輪が路面から外れる。両輪の接地点を別々に路面へ合わせる必要がある。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`
- 直接作業してよい。ローカル commit まで。`git push` 禁止。

## 現状（調査済み）

`web/lib/rider_placement.js` の `riderPlacementAtDistance`:
- `position` = 距離 d のリボン中心（自転車の中心 1 点）。
- `forward3d` = 距離 d が入る区間の 3D 接線。

`web/lib/map3d/rider_mesh3d.js` の `updatePose`:
- 自転車 group の原点を `position` に置き、group 全体を `forward3d` に向けて剛体回転している。
- `BIKE_DIMENSIONS`: 前輪ハブ `frontZ = -0.28`、後輪ハブ `rearZ = +0.28`（モデル単位）。車輪接地点は各ハブの真下、group ローカルで前輪 `(0,0,-0.28)`・後輪 `(0,0,+0.28)`。ホイールベース（接地点間の Z 距離）= `rearZ - frontZ = 0.56`（モデル単位）。
- group は `index.js` で `riderScale`（既定 3.6）倍にスケールされる。ワールドのホイールベース = `0.56 × scale` ≈ 2.0m。

中心 1 点に置いて剛体回転しているだけなので、両輪の接地点が路面に乗る保証は「区間が直線のとき」だけ。勾配の変わり目で破綻する。

## 変更（決め切った仕様）── 2 点接地方式

自転車を「中心 1 点＋区間接線」で置くのをやめ、**前輪と後輪それぞれの接地点を路面でサンプリングして、両輪が路面に乗るように置く**。

### rider_placement.js

2 点接地の配置を返す純関数を足す。`riderPlacementAtDistance` をホイールベース引数付きに拡張するか、新関数（例 `riderTwoContactPlacement(positions, course, distanceM, wheelbaseM)`）を足すか、API の形は worker が決めてよい。**既存 `riderPlacementAtDistance` の戻り（position / forward / forward3d）は他（カメラ等）が使うので壊すな。**

- 後輪接地点 = リボン中心を距離 `d - wheelbaseM/2` でサンプリング。
- 前輪接地点 = リボン中心を距離 `d + wheelbaseM/2` でサンプリング。
- 自転車の置き場所（group 原点）= 前後接地点の中点。
- 自転車の向き = `前輪接地点 - 後輪接地点` を正規化したベクトル（ヨーとピッチの両方がこれ 1 本で決まる。区間接線 forward3d はこの用途では使わなくなる）。
- これで前後の車輪接地点が、それぞれサンプリングした路面点の高さに乗る。
- 端の処理: `d ± wheelbaseM/2` がコース範囲外になるときは距離を [0, 総距離] にクランプ（既存の clamp と同じ方針）。

### rider_mesh3d.js

`updatePose` で上の 2 点接地配置を使い、group の原点と向きを決める。ホイールベースのワールド長は `(BIKE_DIMENSIONS.rearZ - BIKE_DIMENSIONS.frontZ) × group.scale.x`（= 0.56 × scale）。`updatePose` は group を握っているので `group.scale.x` を読める。

### 注意

- `setFromUnitVectors(MODEL_FORWARD, axis)` で向きを与えればヨー＋ピッチが入りロールは出ない（路面に左右バンクが無い前提）。
- カメラ追従（`camera3d.js`）は水平 `forward` を使い続ける。触るな。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全 green。
- `rider_placement` 系テストに 2 点接地の検証を足せ ── 勾配が一定の区間では中心 1 点方式と同じ結果、勾配が変わる区間（凸・凹）で前輪接地点 Y と後輪接地点 Y がそれぞれ別々の路面高さに一致すること。
- 画面（`verify-fujihc-screen` スキル）: 走行画面で、特に勾配の変わり目を通過するとき、前輪・後輪の底が両方とも路面に接しているか批評しろ。車輪が浮かない / めり込まないこと。bridge は `:8000` 起動済み、`fujihill viewer` の Chrome 窓が開いたまま。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。`rider_placement.js` / `rider_mesh3d.js` とそのテストは変更してよい。
- カメラ追従（`camera3d.js`）の挙動を変えるな。既存 `forward` / `forward3d` を壊すな。
- `chrome --headless` 直叩き禁止。撮影は `verify-fujihc-screen` の手順（普通のブラウザ + desk_capture）。
- ローカル commit まで。

## 完了報告

変更したファイル、2 点接地の作り方、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで勾配の変わり目の車輪接地がどう変わったかの批評。
