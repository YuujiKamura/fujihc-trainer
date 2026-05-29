# タスク: 履歴機能を直して走るテストを付ける

## 目的

viewer の「履歴」（過去ライドの一覧）が機能しない。直して、履歴の表示・削除・履歴からの GPX ダウンロードが動くようにし、それを通しで走るテスト（Playwright E2E）で pin する。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit まで、`git push` 禁止。

## 現状（調査済み）

履歴まわりの部品は一通り在る:
- `web/lib/ride_db.js` — IndexedDB の CRUD（openRideDb / addRide / listRides / getRide / deleteRide / auto-prune）。
- `web/lib/history_row.js` — appendHistoryRow が 1 ライド = 1 li、GPX ボタンと削除ボタン付き。
- `web/lib/postride_buttons.js` — ライド終了後の 4 ボタン（GPX / Strava / 履歴に保存 / 履歴を見る）。
- `viewer-map3d.js` — showHistoryOverlay()（2364 行付近）が setAppState('history') → rideDbList → appendHistoryRow で一覧描画。削除コールバックは rideDbDelete 後に再描画。

部品は在るのに「機能しない」。実際に動かして正体を特定しろ。疑わしい点:
- 履歴が空 ── ライドが保存されていない可能性。TEST_MODE（?test=1）のライドが記録対象外なら、テストモードで走ってきた user には履歴が常に空に見える。viewer-map3d.js の addRide guard /「観るモードは記録対象外」（2323 行付近）を確認しろ。
- 一覧 overlay が出ない / 行が描画されない / 削除・GPX ボタンが効かない、等。

## やること

1. viewer を実際に動かして履歴機能を通しで触り、「機能しない」の正体を特定して直す。
2. 履歴の削除と、履歴の各ライドからの GPX ダウンロードが動くことを確認・修正する（部品は history_row.js に在る、繋ぎ込み・到達経路を直す）。
3. 走るテストを足す ── Playwright E2E（Task A で e2e/ と playwright.config.js を導入済み、同じ仕組みを使え）。「ライドを保存 → 履歴を開く → 一覧に出る → 1 件削除できる → GPX ダウンロードが発火する」を通しで pin しろ。
4. 真正性確認: 履歴経路を 1 箇所わざと壊すと E2E が落ちることを手元で 1 回試せ（確認したら戻す）。

既存テスト（history_row.test.js / ride_db.test.js / postride_buttons.test.js / integration_gpx_download.test.js / clear_local_data.test.js）をまず読め。既にある物を直す/強めるが優先。

## 検証

- npm test（vitest）と npm run test:e2e（Playwright）と python -m pytest を全て走らせ全 green。
- 真正性確認の結果を報告。

## 制約

- web/lib/terrain3d.js は配布元配慮で無改造。chrome --headless 直叩き禁止。ローカル commit まで、git push 禁止。

## 完了報告

「機能しない」の正体、直したファイル、削除・GPX ダウンロードの動作確認、追加した E2E テスト、真正性確認の結果、npm test / test:e2e / pytest の passed / failed 数。
