# タスク: 自転車の前後の向きが逆なのを直す

## 目的

走行画面の自転車が前後逆を向いている（進行方向に背を向けている）。前（−Z）が進行方向を向くように直す。

## なぜ・根本原因（調査済み）

直前の回転軸修正（commit `aee68bf`）で `updatePose` の向き付けを `group.lookAt(position + forward3d)` にした。これが前後を逆にした。

Three.js の `Object3D.lookAt` は、**カメラ・ライト以外の通常オブジェクトでは、オブジェクトのローカル +Z を対象点へ向ける**（カメラだけが −Z を対象へ向ける ── 通常オブジェクトとは逆）。bike model の前方は **−Z**（`rider_mesh3d.js` の座標系コメント「bike model は -Z 前方」）。

つまり `lookAt(position + forward3d)` は bike の **+Z（後ろ）**を進行方向へ向けてしまう → 前（−Z）が進行方向の逆を向く → 前後逆。

（回転軸修正の前の `setFromUnitVectors((0,0,-1), forward3d)` は −Z を forward3d へ正しく向けていた。lookAt に変えたとき軸の規約を取り違えて逆になった ── ブリーフ側のミス。）

## 変更（決め切った仕様）

`web/lib/map3d/rider_mesh3d.js` の `updatePose` の `lookAt` の対象点を、`position + forward3d` から **`position − forward3d`** に変える（forward3d の 3 成分すべて符号反転）。

- 通常オブジェクトの lookAt は +Z を対象へ向ける。対象を「自転車の真後ろの点」(`position − forward3d`) にすれば、+Z が後ろを向き、**−Z（前）が forward3d 方向＝進行方向**を向く。
- これで前後の向きが正しくなる。ピッチも正しくなる（登りで forward3d は上向き → −Z が上前を向く → 前上がり）。lookAt の up=+Y によるロール 0 は保たれる。
- **なぜ後方の点を lookAt するのかをコメントで明記しろ**（bike は −Z 前方、通常オブジェクトの lookAt は +Z を対象へ向けるため）。同じ取り違えの再発防止。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全 green。
- `rider_mesh3d.test.js` の `updatePose` 系テストを符号反転に追従させろ。現状は lookAt 対象が `position + forward3d` 前提（107 行付近: 東進コースで `target.x > position.x`、121 行付近: 登りで `target.y > position.y`）。`position − forward3d` に直すと両方逆転する（`target.x < position.x`、`target.y < position.y`）。**この「lookAt 対象が自転車の後方にある」ことを pin することが「前が進行方向を向く」の検証になる** ── テストのコメントもそう書け。
- 画面（`verify-fujihc-screen` スキル）: 走行画面で自転車の前（ハンドルバー側）が進行方向（コースの先・富士山側）を向いているか批評しろ。bridge は `:8000` 起動済み、Chrome 窓「fujihill viewer」(PID 7116) が開いたまま ── リロードして使ってよい。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。`rider_mesh3d.js` とそのテストは変更してよい。
- カメラ追従（`camera3d.js`）の挙動を変えるな。
- `chrome --headless` 直叩き禁止。撮影は `verify-fujihc-screen` の手順（普通のブラウザ + desk_capture）。
- ローカル commit まで。`git push` 禁止。

## 完了報告

変更したファイル、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで自転車の前後の向きがどう変わったかの批評。
