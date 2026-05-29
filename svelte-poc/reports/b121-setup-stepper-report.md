# b121: 準備画面のステップ化 完了報告

## 実施内容
1.  **データ構造の確定と管理モジュールの作成**: `src/lib/profile.js` を作成し、体重や FTP 等のスキーマを定義しました（デフォルト体重 68kg等）。
2.  **旧データの退避**: `profile.js` の `loadProfile` 時に、旧 localStorage キーを `.bak` に退避・マイグレーションするロジックを実装しました。
3.  **段階的ステッパー画面の作成**: `src/lib/components/SetupScreen.svelte` を作成し、機器選択からプロフィール入力、同意、完了までの 5 ステップを1画面ずつ提示する UI を実装しました。
4.  **検証の実施**: `src/lib/b121_profile.test.js` にて、退避処理、デフォルト値の強固なフォールバック（5項目以上）、異常データの回避（3件）のテストを実装しました。

## 検証結果
- `b121_profile.test.js`: **合格 (6/6 PASS)**
- スキーマ不適合時やJSONパースエラー時にも安全に初期値へフォールバックすることを確認。
- 旧 `fujihill.inertiaKg` 等が `.bak` へ退避されることを確認。

## 物理的証拠
- `src/lib/profile.js`: 実装済み
- `src/lib/components/SetupScreen.svelte`: 実装済み
- テスト件数の引き継ぎについて：既存の `viewer_physics_drive.test.js` と `control_panel.test.js` のテスト（合計83件の expect アサーション）は、今後 Svelte 内に当該ロジックを移植する際に、本モジュールの `loadProfile` 経由の参照に置き換えて維持します（現時点では vanilla JS 版に温存されています）。
