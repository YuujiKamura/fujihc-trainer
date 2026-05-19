# Brief: ハンドシェイク完了後「ライド開始」が機能しない bug の修正

## はじめに

fujihc-trainer viewer で、trainer ハンドシェイク完了後に「▶ライド開始」を押しても ride が始まらない。
観測症状は 2 つ: (A) ボタンは緑 (= enabled) なのに直下の無効時説明文「trainer のハンドシェイク
完了後に押せるようになります」が残る。(B) クリックしても何も起きない。本 brief は root-cause と
修正方針をまとめ、7 軸 audit に掛ける対象。

## root-cause

症状 A と B は別原因の 2 バグ。

**(A) hint 文がボタン state と非同期**
`index.html` のヒント文は id 無しの静的 `<div>`。ボタン enable 経路 (`connect_status` connected
branch / `updateActionButtonsForTerrain` / `initTestMode`) はいずれも `btnRideStart.disabled` だけを
書き換え、hint を一切触らない。結果、ボタンが enabled になっても hint が残り永久にちぐはぐ。

**(B) preflight panel が setup-overlay の背後に隠れる**
click → `showPreflightAndStart` → `renderPreflightPanel` が `preflight-overlay` (z-index 1465) に
`.visible` を付与するが、`setup-overlay` (z-index 1500) が visible のまま。preflight が完全に背後に
隠れ、click ターゲット不在で「何も起きない」。これは consent-overlay の 2026-05-15 ε-3 fix と
同型 bug — preflight 統合時に同じ z-order ミスが再混入した (consent には fix 済、preflight には未適用)。

## 修正方針

**(A)** ヒント文に `id="ride-start-hint"` を付与。単一窓口 `setRideStartEnabled(enabled)` を新設し、
`btnRideStart.disabled` と `#ride-start-hint.hidden` を必ず同期して書き換える。enable 経路 3 箇所
(`connect_status` / `updateActionButtonsForTerrain` / `initTestMode`) を全てこの窓口経由に一本化。

**(B)** `showPreflightAndStart` が preflight 表示時に `setup-overlay` の `.visible` を剥がす。
`onCancel` (= キャンセル経路) は `state-riding` でなければ `setup-overlay` を復元。consent-overlay の
`showConsentOverlay` / `hideConsentOverlay` と同一パターンを踏襲。

## テスト

新規 `web/tests/integration_preflight_overlay.test.js` (13 test): hint 同期 / preflight z-order /
full flow を behavioral shim で pin + source 直 grep + z-index 関係 assertion。
既存 grep test 2 ファイルを `setRideStartEnabled` 集約に追随させて更新。`npm test` 897/897 green。

## まとめ

2 バグとも「ボタン state と別 DOM (hint / overlay) が同期しない」構造欠陥。修正は単一窓口化
(`setRideStartEnabled`) と既存 fix パターン (consent overlay) の踏襲で、symptom patch でなく
root-cause を断つ。回帰テストで「ハンドシェイク完了→有効化→ride 開始」経路を pin 済。
