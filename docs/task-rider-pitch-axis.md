# タスク: 自転車の傾きの回転軸を直す（ヨー＋ローカル X 軸ピッチ）

## 目的

自転車の前後の傾き（ピッチ）が、登りカーブで横傾き（ロール）を起こしている。向きを「ヨー（進行方向）」と「ピッチ（前後の傾き）」の 2 段に分け、ピッチは自転車のローカル X 軸まわりの回転にする。横傾きを出さない。

## なぜ・根本原因（調査済み）

`web/lib/map3d/rider_mesh3d.js` の `updatePose`（110〜119 行）:

    group.quaternion.setFromUnitVectors(MODEL_FORWARD, forward3d);

これは「自転車の前方向 −Z を `forward3d`（路面の 3D 方向）へ**最短回転**で合わせる」。
- 平らな道（forward3d が水平）→ Y 軸まわりの回転（ヨーのみ）。正しい。
- 坂だけ・カーブなし（forward3d が南北＋上下のみ）→ X 軸まわりの回転（ピッチのみ）。正しい。
- **坂 ＋ カーブ（forward3d に東西成分と上下成分が両方ある）→ 最短回転の軸が X と Y の混合になり、自転車のローカル X 軸（車軸）が水平でなくなる ＝ ロール（横傾き）が出る。**

富士ヒルは登りカーブだらけなので、登りながら自転車が横に倒れ込む。これが症状。最短回転（setFromUnitVectors）はベクトルを 1 本合わせるだけで、剛体の横傾きを固定しない。

## 変更（決め切った仕様）

向きを「ヨー（進行方向、ワールド Y 軸）」＋「ピッチ（前後の傾き、自転車のローカル X 軸）」の 2 段で与え、ロールを 0 にする。

最も素直なのは `Object3D.lookAt`（`rider_placement.js` のコメントも lookAt を参照している）:
- `updatePose` で `setFromUnitVectors(...)` をやめ、`group.lookAt(group.position + forward3d 方向の点)` にする（forward3d 方向の先の点を見させる）。
- `lookAt` は −Z を対象方向へ向けつつ、up（既定 +Y）でロールを 0 に固定する ── ヨー＋ピッチが入り、ロールは出ない。これがまさに「ヨーで向き、ローカル X でピッチ」。
- bike model は −Z 前方なので lookAt の −Z 規約とそのまま一致する。
- group は scene 直下・スケール付きだが lookAt は回転だけなので問題ない。`group.position` を確定してから lookAt を呼ぶこと。

`lookAt` を使わず明示的に組むなら、ヨークォータニオン（−Z → 水平 forward、ワールド Y 軸）× ピッチクォータニオン（ローカル X 軸、角度 = `asin(forward3d[1])`）でも同じ結果。worker が読みやすい方を選んでよいが、**結果はロール 0** であること。

`rider_placement.js` の `forward`（水平）/ `forward3d`（路面方向）はそのまま使ってよい。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全 green。`rider_mesh3d` 系テストで向きを pin しているものがあれば追従改訂。可能なら「登り＋カーブの forward3d を与えてもロール 0（自転車のローカル X 軸＝車軸が水平、Y 成分が 0）」を検証するテストを足せ。
- 画面（`verify-fujihc-screen` スキル）: 走行画面で**登りカーブ**を通過するとき、自転車が前上がりにはなるが**横に傾かない（ロールしない）**ことを批評しろ。修正前（setFromUnitVectors）と修正後を撮って見比べろ。bridge は `:8000` 起動済み。viewer の Chrome 窓が最小化されていれば開き直すかサイズを 1400×900 以上に戻せ。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。`rider_mesh3d.js` とそのテストは変更してよい。
- カメラ追従（`camera3d.js`）の挙動を変えるな。
- `chrome --headless` 直叩き禁止。撮影は `verify-fujihc-screen` の手順（普通のブラウザ + desk_capture）。
- ローカル commit まで。`git push` 禁止。

## 完了報告

変更したファイル、回転をどう組み直したか、`npm test` と `pytest` の passed / failed 数、修正前後のスクショで登りカーブの自転車の横傾きがどう変わったかの批評。
