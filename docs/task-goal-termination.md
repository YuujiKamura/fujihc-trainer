# タスク (確定版): ゴール（コース終端）でviewerが固まるバグを直す

> 改訂履歴: 草案を multi-axis-draft-audit の 7 軸並列監査にかけ、全 7 軸 NG
> (LOAD-BEARING 多数) で REDRAFT した確定版。草案は原因を「距離→座標変換が範囲外
> 入力で例外を投げ rAF が止まる」と推測で断定していたが、実コードを確認した結果
> これは誤り。真因・実機構をコードで裏取りして本確定版に書き直した。

## はじめに

ライドがゴール（コース終端）に到達すると、カメラ操作を含め viewer の操作が全部
効かなくなり、ページをリロードするしか復帰できない。これを直す。

真因は単純で、コードで確認済み。`viewer-maplibre.js` の描画ループ `tick`
（2015〜2196 行）の末尾がこうなっている:

```
mapRenderer.render();
if (!rider.atGoal) {
  requestAnimationFrame(tick);   // ← ゴール前: 次フレームを予約
} else {
  status('完走');
  if (!_autoEnded) { _autoEnded = true; rideState.end(); sendRideEnd(); }
  // ← ゴール後: requestAnimationFrame(tick) を呼ばない = ループがここで死ぬ
}
```

viewer のカメラ・HUD・描画・rider 更新はすべてこの 1 本の `tick` ループで回って
いる。ゴール到達（`rider.atGoal` が true）で `else` 分岐に入ると次フレームが予約
されず、ループが止まる。以後フレームが回らないので操作が全部死ぬ。これは「例外で
クラッシュ」ではなく、ループの寿命管理のバグ。

草案の仮説（距離→座標変換が範囲外入力で壊れる）は誤り。距離 `distanceTraveled` は
`rider.js` の `clampDist`（46〜50 行）で常に `[0, totalDistance]` にクランプされ、
`rider.tick`（207 行）も `rider.placeAtDistance`（106 行）も `clampDist` を通す。
範囲外の距離が座標計算に届く経路は存在しない。だから「距離をクランプし直す」作業は
不要（既に三重に実装済み）。直すのは `tick` 末尾の 1 箇所だけ。

## 用語

- **ゴール / コース終端** = `rider.atGoal`（rider.js:52、`distanceTraveled >= totalDistance`）。
- **完走** = ゴール到達後の状態。画面表示文字列は `status('完走')`。
- **viewer が固まる / フリーズ** = `tick` の `requestAnimationFrame(tick)` が再予約されず
  描画ループが停止すること。カメラもHUDも描画もこの 1 ループ依存なので全部止まる。
- **完走の自動終了** = ゴール初到達で 1 度だけ走る `_autoEnded` フラグ + `rideState.end()`
  + `sendRideEnd()`。2026-05-15 に入った既存機構（手動で「ライド終了」を押さなくても
  postride に行けるようにした fix）。
- **postride** = 完走後オーバーレイ。`showPostride()`（viewer-maplibre.js:627）が出す。
  `sendRideEnd()` → `ride_status('ended')`（593 行）→ `showPostride` の経路。

## 目的（達成条件）

- ゴール到達後も viewer が生きている: `tick` の rAF ループが回り続け、カメラ操作が
  効き、HUD が最終値で残る。リロード不要。
- ゴール初到達で ride を終了状態にする処理（`_autoEnded` / `rideState.end` /
  `sendRideEnd`）は今までどおり **1 度だけ** 発火する。ループを生かしても再発火しない。
- 完走の表示と「先へ進む」導線は、既存の postride 経路をそのまま使う（新規 UI を
  作らない）。ゴール時に postride が出ているかを step 1 で実画面確認し、出ていなければ
  既存 `showPostride` 経路が発火するように直す。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit
  まで、`git push` 禁止。
- viewer は `http://127.0.0.1:8000/` で配信中（既存サーバ稼働、bridge を二重起動するな）。
- 別 worker が同リポで稼働中。自分が触らないファイルに触れるな。

## 実機構（コードで確認済み）

- `tick`（`web/viewer-maplibre.js`:2015〜2196）が viewer 唯一の rAF ループ。カメラ更新
  （`mapRenderer.updateCamera`）・HUD・描画（`mapRenderer.render`）・trkpt 蓄積・
  autosave が全部この中。
- 末尾 2182〜2195 行が真因（上記「はじめに」のコード）。
- `rider.atGoal`（`web/lib/rider.js`:52〜54）= `totalDistance > 0 && distanceTraveled
  >= totalDistance`。
- `clampDist`（rider.js:46〜50）が `distanceTraveled` を `[0, totalDistance]` に
  クランプ。座標変換が範囲外入力で壊れる経路は無い。
- `rider.placeAtDistance(d)`（rider.js:106〜107）= 距離を任意地点へ置く（`clampDist`
  を通す）。ジャーニーテストでゴール直前へ素早く飛ばすのに使う。
- 完走自動終了（`_autoEnded` / `rideState.end` / `sendRideEnd` / `ride_status('ended')`
  → `showPostride`）は既存。trkpt 蓄積（2158 行）と autosave（2168 行）は
  `snap.active && !snap.paused` ゲート。`rideState.end()` で ride が非アクティブに
  なれば両方とも自然に止まる。

## やること

1. **まず実画面でゴール到達時に何が起きるか観る**。TEST_MODE で `rider.placeAtDistance`
   等を使ってコース終端へ飛ばし、ゴール到達させて desk_capture + コンソールを見る。
   真因が `tick` 末尾の rAF 非再予約だけか、postride がゴール時に出るか出ないか、を
   実画面で確認しろ。推測で patch するな。
2. **`tick` 末尾を直す**。ゴール到達後も `requestAnimationFrame(tick)` を必ず呼ぶ。
   完走初到達の終了処理（`status('完走')` + `_autoEnded` + `rideState.end()` +
   `sendRideEnd()`）は `_autoEnded` ガードで 1 度だけに保つ。ループが回り続けて毎
   フレーム「ゴール済み」分岐に入っても、終了処理が再発火しないこと。
3. **ゴール後の挙動を確認**。ループは回るが ride は `rideState.end()` で非アクティブ。
   trkpt 蓄積と autosave は `snap.active` ゲートなので自然に止まる ── 止まることを
   テストで pin（ゴール後に trkpt 数・autosave 呼び出しが増えない）。
4. **完走表示・導線は既存 postride を使う**。step 1 で postride がゴール時に出るか
   確認し、出ないなら既存 `showPostride` 経路が発火するように直す。新規オーバーレイや
   ボタンを作るな。
5. **ジャーニーテスト用のフックを足す**。ゴールまで実時間で 24km 走るのはテストでは
   不可能。`rider.placeAtDistance` を TEST_MODE 限定の URL パラメータ（例
   `?seekTo=<メートル>`）から呼べる最小フックを `viewer-maplibre.js` に足し、コース
   ロード後に rider をコース終端の直前へ置けるようにしろ。フックは TEST_MODE
   ゲートで囲み、本番経路からは絶対に発火しないこと。
6. テストを足す（下記「テスト」）。
7. 真正性確認（下記）。

## 不可侵（壊すな）

- `rider.js` の `clampDist` / `atGoal` / `placeAtDistance` のロジックを変えるな。
  距離は既にクランプ済み。
- 完走自動終了（`_autoEnded` 経路）の発火回数を変えるな。ゴール 1 回につき 1 度だけ。
- `web/lib/terrain3d.js` は本タスクの対象外、無改造 ── テスト済の地形ジオメトリ
  純関数群で、地図タイルの取得もせずゴール終端処理と無関係。
- `bridge.py` は `127.0.0.1` bind 固定。地図タイル配布元配慮ルールを破るな。
- 新規 UI を作るな。完走表示・導線は既存 postride を使う。

## テスト

- **vitest（振る舞いの pin）**: `tick` ループは `viewer-maplibre.js` 内の
  module-scoped 関数で vitest からは到達不能。「ループが回る」を vitest 層に置くな。
  `rider.js` の `atGoal` / `clampDist` は既存ロジックで、本タスクで変更しない予定 ──
  変更しないなら新規 vitest は不要、既存テストを壊さないことだけ確認。`rider.js` の
  ロジックを触る判断をしたときだけ、その関数の happy / edge を pin しろ。
- **e2e ジャーニーテスト（必須、本タスクの主検証）**: `e2e/user_journey.spec.js` の
  通しジャーニー（ライド→終了→保存→閲覧）と同じ流儀で 1 本足す ── ライド開始 →
  （`?seekTo` でゴール直前へ）→ ゴール到達 → **viewer が固まっていない** → ライドが
  履歴に保存される → 保存されたライドを履歴で確認できる。
  - 「固まっていない」の観測点を具体的に決めろ。現状フリーズは例外を投げないので、
    `console.error` の数では検出できない（固まっても green = 嘘のテスト）。実際に
    生きていることを観測する信号を 1 つ決めて assert しろ ── 例: ゴール到達後に
    プログラムでカメラを動かして実際にカメラ中心座標が変わることを確認する、または
    rAF が回るたびに増えるカウンタを `window` に出して、ゴール後もそれが増え続ける
    ことを確認する。観測点を決め、それをテストで assert しろ。
  - 既存 e2e（`e2e/user_journey.spec.js` の 8 本）を壊さないこと。

## プライバシー境界

この修正は描画ループを生かすだけで、何が保存されるか・consent の判定を変えない。
ゴール到達時の履歴保存は既存の「自動終了 → postride → `addRide`」経路のままで、
`addRide` は観るモードを記録対象外にする consent ガードを既に持つ。本タスクで保存
経路にも consent 判定にも手を入れるな。trkpt（lat/lon/power/hr の個人データ）の
蓄積は、ゴール後 `rideState.end()` で ride が非アクティブになり自然に止まる。

## 真正性確認（必須）

`tick` の修正（ゴール後にも `requestAnimationFrame(tick)` を呼ぶ箇所）を 1 箇所
わざと外して、ジャーニーテストの「固まっていない」assert が落ちることを手元で 1 回
確認しろ → 戻す。落ちないなら観測点が真正でない、書き直し。戻したら
`git diff web/viewer-maplibre.js` と他の触ったファイルの `git diff` で、意図した
差分以外（壊しの戻し漏れ）が無いことを確認してから commit。

## 検証

- `npm test`（vitest）、`npm run test:e2e`（Playwright）、`python -m pytest` を全て
  走らせ全 green。passed / failed 数を報告。
- `desk_capture` で実画面を観て批評しろ。期待する最終状態を先に言語化する:
  「ゴール到達後、3D ビューが固まらずカメラがマウス操作で動く。完走表示（または
  postride オーバーレイ）が出ている」。viewer を映した通常 Chrome タブで実際に
  ゴールまで到達させ、撮った画像を見て、カメラが動くか・完走表示が出ているかを
  断定しろ。固まったままなら未完。
- 真正性確認の結果を報告。

## 制約

- 画面確認は `desk_capture` のみ。`chrome --headless` 直叩きも `headless-shot.ps1` も
  使うな ── viewer は無限 rAF + Service Worker の never-idle ページで、headless
  Chrome が終わらず worker ごと固まる（前の worker がこれで全滅した）。viewer を
  映した通常 Chrome ウィンドウが無ければ、自分で 1 回だけ通常タブで
  `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` しろ。
  `desk_capture` が GPU 描画を白紙でしか返さない時は、PowerShell の
  `CopyFromScreen` で実画面をグラブしてよい。
- `viewer-maplibre.js` は `.js` = `sw.js` の `isAppShell` で network-first 配信。
  online の限り常に最新が届くため CACHE_NAME / `?v=N` の bump は不要。
- commit は自分が触ったファイルだけを `git commit -- <明示パス>` の一発でやれ
  （`git add` と `git commit` を分けるな、`git add -A` 禁止、他 worker のレース巻き
  込みを防ぐ）。ローカル commit まで、`git push` 禁止。

## 参照

- MDN `requestAnimationFrame`: https://developer.mozilla.org/docs/Web/API/Window/requestAnimationFrame
- MDN Page Visibility API（タブ非表示時の rAF 挙動）:
  https://developer.mozilla.org/docs/Web/API/Page_Visibility_API
- Playwright（e2e ジャーニーテスト）: https://playwright.dev/docs/writing-tests
- 真因の箇所: `web/viewer-maplibre.js` の `tick`（2015〜2196、特に末尾 2182〜2195）
- rider モデル: `web/lib/rider.js`（`atGoal` / `clampDist` / `placeAtDistance`）
- 既存ジャーニーテスト: `web/../e2e/user_journey.spec.js`

## 完了報告

固まっていた真因（どのファイルのどの行）、直したファイルと方式、ゴール後もカメラが
効くことの実画面確認、完走表示・先へ進む導線がどうなっているか、足したジャーニー
テストと振る舞いテスト、ジャーニーテスト用フックの形（`?seekTo` 等）、真正性確認の
結果、`npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。

## まとめ

ゴールで viewer が固まるのは、描画ループ `tick` がゴール到達時に次フレームを予約
しないから。例外でも座標バグでもない。直すのは `tick` 末尾の 1 箇所 ── ゴール後も
ループを回し続ける。完走の自動終了（1 回だけ）と postride 表示は既存機構をそのまま
使う。ジャーニーテストでゴールに素早く到達するため `?seekTo` の最小フックを足す。
これでゴール到達後もカメラが効き、リロード不要で先へ進める。
