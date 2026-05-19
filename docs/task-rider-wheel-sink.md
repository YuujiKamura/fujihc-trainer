# タスク: 自転車の車輪が路面にめり込むのを直す

## 目的

走行画面の自転車は、前後の車輪の底が路面より下にめり込んでいる（路面に乗っていない）。両輪の接地点が路面の高さにぴたりと乗るようにする。

## なぜ・根本原因（調査済み）

`web/lib/map3d/rider_mesh3d.js` の `buildBikeMesh`:
- 60 行目 `const hubY = wheelR;` ── コメントは「車輪の接地点が group の y=0 になる高さ」とあるが、これが間違い。
- 車輪は `TorusGeometry(wheelR, tubeR, ...)`（64〜69 行）。トーラスの一番低い点はハブ中心から `wheelR + tubeR` 下（major 半径 + tube 半径）。`hubY = wheelR` だと車輪の底は group ローカルで `hubY - (wheelR + tubeR) = -tubeR = -0.04`。
- `updatePose` は group 原点を路面（リボン中心）に置くので、車輪の底が路面より `tubeR` 分下、ワールドで `tubeR × scale` ≈ `0.04 × 3.6 ≈ 0.14m` めり込む。
- 前後の車輪は同じ `hubY` なので互いには水平。狂っているのは「路面に対する高さ」で、両輪が同じだけ沈んでいる。

## 変更（決め切った仕様）

`hubY` を `wheelR + tubeR` にする（60 行目）。これで車輪の一番低い点が group ローカル y=0 になり、updatePose が group を路面に置いたとき車輪の底が路面に乗る。
- コメントも実態に合わせて直す。
- `hubY` を使っている所（車輪位置・frontHub・rearHub・`bb = hubY*0.7`）は連動して上がる。自転車の見た目は tubeR ぶん（モデル全長の 4%）わずかに変わるだけで、自転車として読める範囲。
- `bikeTotalLength` は `wheelR` と Z で計算していて `hubY` 非依存なので影響なし。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全 green。`rider_mesh3d` 系テストで `hubY` や接地点を pin しているものがあれば `wheelR + tubeR` に追従改訂。
- 画面（`verify-fujihc-screen` スキル）: 走行画面で前後の車輪の底が路面（黄色いコースリボン）に乗っているか ── めり込んでいない・浮いていないか批評しろ。**修正前・修正後の両方を撮って見比べろ**（修正前は車輪が約 0.14m 沈んでいるはず）。bridge は `:8000` 起動済み。viewer の Chrome 窓は今最小化されているかもしれないので、必要なら開き直すかサイズを 1400×900 以上に戻せ。
- カメラが俯瞰気味で沈み込みが見えにくいときは、車輪と路面の境目が分かる角度・距離で撮ること。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。`rider_mesh3d.js` とそのテストは変更してよい。
- カメラ追従（`camera3d.js`）の挙動を変えるな。
- `chrome --headless` 直叩き禁止。撮影は `verify-fujihc-screen` の手順（普通のブラウザ + desk_capture）。
- ローカル commit まで。`git push` 禁止。

## 完了報告

変更したファイル、`hubY` をどう直したか、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで車輪の接地がどう変わったかの批評。
