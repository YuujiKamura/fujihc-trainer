# タスク: ライダーの前後傾きを路面の勾配に追随させる

## 目的

走行画面のライダー（3D 自転車）が、坂でも水平のまま立っている。路面が登り・下りで傾いているのに、自転車の前後の角度がそれに追随しない。自転車の前後の傾きを、その位置の路面の勾配にぴたりと合わせる ── 登りは前上がり、平坦は水平、下りは前下がり。

## なぜ

viewer は実際の走行に近い見た目を狙っている。坂を登っているのに自転車が水平のままだと地面から浮いて見えて嘘くさい。位置はすでに路面に乗っているので、残るは「向きの前後成分」だけ。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`
- このリポで直接作業してよい。ローカル commit まで。`git push` は禁止。

## 根本原因（調査済み）

`web/lib/rider_placement.js` の `riderPlacementAtDistance`:
- `position`（72〜76行）はリボン中心の線形補間で Y（標高）込み → 位置は路面に追随できている。
- `forward`（82〜87行）は `fx`（x差）, `fz`（z差）だけで作り、**Y成分を 0 に落としている**（`[fx/len, 0, fz/len]`、`len` は XZ 平面の長さ）。コメントにも「Y=0 ── 路面に水平」とある。

`web/lib/map3d/rider_mesh3d.js` の `updatePose`（110〜119行）が、この水平 `forward` で自転車 mesh の向き（quaternion、115〜117行）を決めている。Y を落とした向きなので自転車は坂でも水平のまま。これが原因。

## 変更（決め切った仕様）

### rider_placement.js

`riderPlacementAtDistance` の戻り値に 3D の進行方向ベクトルを 1 つ足す（名前は `forward3d`）。
- `fy = fc1[1] - fc0[1]`（区間の標高差）を計算し、`[fx, fy, fz]` を **3D の長さ**で正規化したものを `forward3d` とする。
- **既存の `forward`（XZ 水平、Y=0）はそのまま残せ** ── カメラ追従（`camera3d.js` の `followPlacement` / `update`）がこの水平 forward を使っている。変えるとカメラが壊れる。新フィールド追加で既存は不変。
- XZ 退化フォールバック（`len <= 1e-9 → [0,0,-1]`）が既存にある。`forward3d` も 3D 長さが零に近いとき同じ向きにフォールバックしておけ。

### rider_mesh3d.js

`updatePose` で自転車 mesh の quaternion を、`pl.forward`（水平）ではなく `pl.forward3d`（3D）で決める。`setFromUnitVectors(MODEL_FORWARD, forward3d)` にすれば坂の傾き分だけ前後にピッチする。
- 坂は左右バンクが無い前提なので、3D forward への最小回転はピッチ＋ヨーのみでロールは出ない。実画面で確認しろ。

### なめらかさ

リボンは折れ線なので、区間ごとに勾配が一定なのは路面そのものの形。区間の傾きをそのまま使うのが「路面に追随」。ただしコース点は約 12m 間隔で、区間境界で傾きが切り替わる。走行速度域でこの切り替わりが目障りなら、隣接区間で pitch を補間してなめらかにしてよい ── 実画面を見て判断しろ。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全て green。落ちたら直す。
- `rider_placement` 系テストに `forward3d` の検証を足せ ── 平坦区間で `forward3d` が `forward` と一致、登り区間で Y>0、下り区間で Y<0。`rider_mesh3d` 系テストがあれば追従改訂。
- 画面（`verify-fujihc-screen` スキル）: 走行画面で、登り勾配のところで自転車が前上がり、平坦で水平、下りで前下がりになっているか批評しろ。bridge は `:8000` で `--dummy` 起動済み。`fujihill viewer` の Chrome 窓が開いたままなのでリロードして使ってよい。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。1 文字も触るな。`rider_placement.js` / `rider_mesh3d.js` とそのテストは変更してよい。
- カメラ追従（`camera3d.js`）の挙動を変えるな。既存 `forward` は不変のまま。
- `chrome --headless` の直叩き禁止。撮影は `verify-fujihc-screen` スキルの手順（普通のブラウザ + desk_capture）。headless は GPU 無効で 3D が黒くなり使えない。

## 完了報告

変更したファイル、`forward3d` の作り方、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで坂のところの自転車の傾きがどう変わったかの批評。
