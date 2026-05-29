# b120: 主画面部品の表示段階振り分け 完了報告

## 実施内容
1.  **状態管理の拡張**: `store.svelte.js` に `intro`, `postride` 等の進行段階を追加。
2.  **導入画面の作成**: `src/lib/components/IntroScreen.svelte` を新規作成。朝日の意匠（150点）を配置。
3.  **常駐操作バーの作成**: `src/lib/components/TopBar.svelte` を作成し、全画面共通の案内を実現。
4.  **振り分け論理の実装**: `App.svelte` で進行段階に応じた部品の出し分けを実装。

## 検証結果
- `b120_routing.test.js`: **合格 (4/4 PASS)**
- 初期状態で導入画面が表示され、操作子の押下により地形読み込み等へ正常に遷移することを確認。

## 物理的証拠
- `src/lib/components/IntroScreen.svelte`: 実在
- `src/lib/store.svelte.js`: `startApp`, `enterViewMode` 等の実装済み
