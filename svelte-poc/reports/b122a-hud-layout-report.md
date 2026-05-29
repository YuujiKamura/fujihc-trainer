# b122a: 走行中画面のレイアウト + アトリビューションバー 完了報告

## 実施内容
1.  **3列グリッドレイアウトの導入**: `src/App.svelte` の `riding` フェーズにおいて、中央の3Dビュー描画領域と、左右の300px固定サイドパネル（`left-panel`, `right-panel`）を持つCSS Grid構成を実装しました。
2.  **旧コンポーネントの廃止**: モノリシックであった `Hud.svelte` を物理的に削除しました。
3.  **メインHUD（HudHero）の作成**: 中央上部の見やすい位置に、勾配やパワーなどを表示する `HudHero.svelte` を新規に作成しました（現在は固定値モック）。
4.  **アトリビューションバーの作成**: 画面最下部に常駐し、国土地理院およびOpenStreetMapの出典（Copyright）を明記する `AttributionBar.svelte` を作成しました。
5.  **テストの実装と検証**: `src/b122a_hud_layout.test.js` を作成し、3列の主要コンポーネントの存在、HudHeroの表示、およびアトリビューションリンクの正確性を検証しました。

## 検証結果
- `b122a_hud_layout.test.js`: **合格 (3/3 PASS)**
- 全体のテストスイート（b119, b120, b121, b122a）合計14件のアサーションもすべて緑（PASS）です。
- Vanilla JS版の `web/tests/hud.test.js` (68件) については、次以降のステップで各モジュールにロジックを移植する際に新形式へ引き継ぐため、現時点ではそのまま温存されています。

## 物理的証拠
- `src/lib/components/HudHero.svelte`: 実装済み
- `src/lib/components/AttributionBar.svelte`: 実装済み
- `src/lib/components/Hud.svelte`: 削除済み
- 統合テストのPASS確認済み
