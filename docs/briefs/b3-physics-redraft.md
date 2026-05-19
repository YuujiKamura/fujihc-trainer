# ブリーフ 3 ── 物理統合の redraft (テストの嘘 / SoT 三重複の解消)

## はじめに

fujihc-trainer viewer の自転車物理統合 (commit `ab7d89f` / `02b03ae`) を 7 軸監査した
結果、LOAD-BEARING な指摘が複数で REDRAFT 必須と判定された。実装役セッションが
ホストクラッシュで作業を失ったため、再実施する。実装ではなく**既存コードの構造修正**。

## 背景

慣性シミュ (`web/inertia-sim.html`) で検証済みの自転車物理 (`web/lib/bike_physics.js`
の `applyPhysicsStep`) を viewer 本体に統合した。物理の式そのものは検証済みで正しい。
問題は統合の**構造**。7 軸監査が下記を確定した。

## 直す対象 (= 7 軸監査の LOAD-BEARING 指摘)

### 1. テストの嘘 (= misleading test、 最優先)
`web/tests/viewer_physics_drive.test.js` の 15 件中 9 件が、本物の
`wsHandlers.state` を一度も import / 実行せず、**テストファイル内に手でコピーした
並行実装** (`viewerStateStep` / `stateStep`) を叩いているだけ。本物の viewer コードが
壊れても・到達不能でもテストは緑のまま。「閉ループ」「回帰防止」「本番ロジックを
忠実に再現」 と銘打っているが、pin しているのはコピーであって viewer ではない。
→ 直す: (a) 本物の `wsHandlers.state` を実際に呼んで rider 速度変化を assert する、
または (b) 起動シーケンス (loadCourse → rideState → ride 開始 → rider 前進) を
1 件でも実走する integration test を足す。手コピー helper を叩くだけのテストから
「閉ループ」「回帰防止」「本番ロジック再現」 の詐称 wording を外す (= 残してよいが
物理単体 pin としての位置づけに正す)。

### 2. SoT 三重複 (= 物理積分の substep ループ)
「クランプ済 dt 区間を 1/120 秒サブステップで `applyPhysicsStep` 積分する」 同じ
段取りが 3 箇所に重複: viewer の `wsHandlers.state` 直書き / `viewer_physics_drive.test.js`
内のコピー / `inertia-sim.html` の `step()`。一箇所直しても他がドリフトする。
→ 直す: `web/lib/bike_physics.js` に「1 state メッセージ分 (= クランプ済 dt 区間) を
サブステップ積分して新速度を返す」純粋関数を 1 本切り出す。viewer の `wsHandlers.state`、
`inertia-sim.html` の `step()`、テストの 3 者すべてがそれを呼ぶ。これにより #1 の
「テストがコピーを叩く」 も解消する ── テストが本物の共有関数を直接叩けば嘘が消える。

### 対応不要 (= 既に解決済)
- マジックナンバー (mass:88 / c_rr:0.005 / c_d:0.35 のハードコード) → slider 化済
  (commit `e70faf7`)。再対応不要。

## 制約

- 物理の式 (`applyPhysicsStep` の計算内容) は変えるな ── 検証済み。共有関数への
  切り出しと呼び出し側の整理のみ。
- `cd web && npm test` 全テスト green。既存テストを壊さない。
- push 禁止 (commit は OK)。silent execution。
- 完了後は再度 7 軸監査にかけられる前提 (= CONVERGED まで回す対象)。

## まとめ

ゴール = 物理統合を、(1) テストが本物の viewer 経路を pin する状態、(2) substep
積分ロジックが `bike_physics.js` の共有純粋関数 1 本に集約され viewer / sim / test が
全部それを呼ぶ状態、にする。#2 の切り出しを先にやれば #1 のテスト嘘も同時に消える。
物理の式は触らず、構造だけを直す。
