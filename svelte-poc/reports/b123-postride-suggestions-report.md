# b123: 走行後画面とFTPサジェストの完了報告

## 実施内容
1.  **ステート管理の拡張**: `src/lib/store.svelte.js` に `postride` 状態を定義し、走行終了（`endRide`）から導入画面（`backToIntro`）へ遷移するライフサイクルを実装しました。
2.  **リザルト（サマリー）画面の作成**: `src/lib/components/PostRideScreen.svelte` を新規作成しました。走行中画面の上に半透明の黒いオーバーレイ（`var(--scrim)`）を重ね、中央にタイム、平均パワー、平均心拍、獲得標高を表示するUIを構築しました。
3.  **FTP提案（サジェスト）機能の導入**: 
    *   走行の平均パワーから安全係数（0.85）を掛けて「推定FTP」を自動計算するロジックを組み込みました。
    *   現在のプロフィール値（`localStorage`）より高い場合のみ「提案カード」が表示されるようにし、「適用する」ボタンで `saveProfile` を呼び出して設定を上書きする機能を実装しました。
4.  **テストの実装と検証**: `src/b123_postride.test.js` を作成し、提案ロジックの判定、適用時の `saveProfile` コール、スキップ処理、および既存テスト（`ride_db.test.js` 23件）との互換性を検証しました。

## 検証結果
- `b123_postride.test.js`: **合格 (6/6 PASS)**
- 全体のテストスイート（b119, b120, b121, b122a, b122b, b123）合計25件のアサーションもすべて緑（PASS）です。
- Vanilla JS版の `web/tests/ride_db.test.js` (23件) のアサーションは破壊されることなく温存されています。

## 物理的証拠
- `src/lib/components/PostRideScreen.svelte`: 実装済み
- `src/lib/store.svelte.js`: 状態遷移ロジック実装済み
- 統合テストのPASSおよび Playwright による実画面のスクリーンショットを確認済み。
