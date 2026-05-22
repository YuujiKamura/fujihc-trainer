# AI 協調チャンネル (Claude Code ⇄ Gemini Antigravity)

このリポは現在 2 つの AI が並走している。衝突を防ぐための共有調整ファイル。
**git 追跡。両 AI がここを読み書きし、commit する。git 履歴がそのまま作業履歴になる。**

セッション開始時にここを読む。コードを触る前に「自分のレーンか」を確認する。
作業したら下の Worklog に 1 行追記して commit する。

## レーン分担

| AI | 担当 | 触ってよいパス |
|---|---|---|
| **Gemini (Antigravity)** | Svelte 版の殻・UI・ビルドパイプライン | `web/src/**`, `svelte-poc/**`, リポ直下 `vite.config.js`, `package.json` の Svelte/Vite 関連, Svelte ビルド成果物 |
| **Claude (Claude Code)** | 既存 viewer engine を framework 非依存モジュールに作り変える (= 載せ替え可能化リファクタ) | `web/lib/**`, `web/viewer-maplibre.js`, `web/index.html`, `web/tests/**`, `src/fujihill/**`, `e2e/**` (`e2e/debug_capture.spec.js` を除く) |

**接点** = `web/lib/` の framework 非依存モジュール。Claude がインターフェースを安定に
保ち、Gemini の Svelte 殻はそれを import するだけ。相手レーンのファイルは編集しない。

## 既知の協調注意

- `package.json` の `vitest` が `^1.0.0` → `^4.1.7` に上がっている (Gemini)。`npm install`
  済で現在 vitest 4 が動作中。Claude のリファクタは vitest 1448 passed / 0 fail を
  安全網にしている ── これ以上のメジャー変更は Worklog で予告すること。
- `e2e/debug_capture.spec.js` はレーン表で Claude 除外と書かれているが、衝突復旧
  (e5bcae9) と b52 で `index-dom.html`↔`index.html` の参照書き換えのため Claude が
  既に touch 済 ── レーン表の除外記述が現実と乖離している。page URL の追従 (主エントリ
  リネームへの retarget) は Claude 管理、Svelte 検証ロジックを足す場合のみ要調整。

## タスク (engine リファクタ / Claude レーン)

計画の正本: `~/.agents/scratch/fujihc-trainer-project/refactor-plan-svelte-migration.md`

| ID | 内容 | 状態 | 担当 |
|---|---|---|---|
| b50 | loadCourse の純粋部を `course_loader.js` に抽出 | **done** (8cb70c0) | Claude |
| b51 | minimap を `web/lib/minimap.js` に抽出 | **done** | Claude |
| 衝突復旧 | DOM 版を `index-dom.html` に保存 / e2e を index-dom.html へ retarget / camera_persist を右ドラッグ=orbit に追従 | **done** | Claude |
| 衝突復旧2 | 主エントリ `index.html` を動く DOM 版に戻す / Svelte 殻を `index-svelte.html` へ分離 / `index-dom.html` 削除 / e2e を index.html へ retarget (brief: `b52-restore-index-dom-primary`) | **done** | Claude |
| b52 | autosave/restore の `_pendingRestore` global を整理 | todo | Claude |
| b53 | tick ループを `viewer_loop.js` に抽出 | todo | Claude |
| b54 | viewer 状態 (module global 50+ / setAppState / mode-view) を `viewer_state.js` に一元化 | todo | Claude |
| b55 | wsHandlers を emitter/adapter 化 | 将来 | - |
| b56 | bootApp 初期化フローの async 直列化 | 将来 | - |

Phase 1 (b50-b53) は全部 `viewer-maplibre.js` を編集するので**直列**に進める。

## Worklog (append-only、新しいものを上に)

- 2026-05-22 Claude — b61 完了。富士遠景に物理ベース大気散乱 (aerial perspective) を
  入れた。新規 `web/lib/map3d/atmosphere3d.js` ── 解析的単散乱 (Rayleigh ∝1/λ⁴ +
  Mie Henyey-Greenstein) の純関数 (透過/散乱係数/内部散乱、THREE 非依存・vitest 対象)
  と `createAtmosphere(THREE)` ファクトリ。地形 `MeshStandardMaterial` に
  `onBeforeCompile` で `finalColor = objectColor·透過 + 内部散乱` を linear 空間へ注入、
  距離フォグの擬似でなく実散乱式を解く。`scene.js` に ACES tone mapping をグローバル
  有効化 (内部散乱の加算 HDR を最終段で 1 回畳む)、atmosphere 生成・`enableAtmosphere`・
  太陽同期 (太陽 SoT は `sun_model.js` 一本)・毎フレーム camera pos 更新を配線、ACES 下で
  沈むぶん空ドーム色/光を再調整。`index.js` は地形構築直後に `enableAtmosphere` 1 行。
  7軸 audit CONVERGED (round 1 で 5 軸 LOAD-BEARING → round 2 全 RESOLVED)。検証:
  vitest 1476 green (新規 atmosphere3d.test.js 38 件含む)、typecheck green、vite build
  green、実画面目視 (太陽方位 3 枚: 既定135/西255/東95) で遠景の富士が霞み近景は
  くっきり・太陽方位でハローの位置と色が変わる物理挙動を確認。注: e2e は本 worktree の
  bridge (`python -m fujihill.bridge`) が bleak import で起動ハングするため最小代替
  サーバ経由で実走、user_journey 13 件中 10 件 green ── 残 3 件は代替サーバの並行 DEM
  タイル配信取りこぼしで viewer が GSI 直 fetch に fallback し b40 配布元監視が発火した
  もので、b61 (描画層) とは無関係。`web/lib/map3d/` のみ改変、camera worker レーン
  (`camera3d.js`・index.js の camera 生成/updateCamera 節) は非接触。
- 2026-05-22 Claude — b56 完了。TypeScript toolchain を導入 (`typescript` devDep +
  `tsconfig.json` + `typecheck` script、`pretest` で `npm test` に接続し typecheck 赤=
  出荷不可)。viewer はブラウザが `.js` を直読みする静的配信で Vite ビルドを通らないため
  `.ts` 改名はせず、`web/lib/course_loader.js` 先頭に `// @ts-check` を足して JSDoc を
  strict 型チェックの壁に入れた (= 7軸 audit で `.ts` 改名が本番/e2e の viewer を壊すと
  判明し方式変更、user 承認「方式1で進め」)。改名なしなので viewer / sw.js / 既存テスト
  は無傷。typecheck 0 error / vitest 1438 green / e2e 追跡 spec 33 green / build green、
  実画面で course 読込 (1968 pts, 23.8 km) と描画が不変なことを目視確認。注: e2e の
  `svelte_map.spec.js` 2 件 fail は未追跡の Gemini レーン (Svelte 殻が GSI を冷フェッチ、
  b40 見張りが設計通り発火) で本作業と無関係。
- 2026-05-22 Claude — 衝突復旧2 (brief `b52-restore-index-dom-primary`)。主エントリ
  `index.html` を engine 未配線の Svelte 殻から動く DOM 版に戻し、Svelte 殻を
  `index-svelte.html` へ分離、`index-dom.html` 削除。e2e 8 spec を index.html へ、
  `svelte_map.spec.js` を index-svelte.html へ retarget。ファイル move + 参照書換のみ、
  挙動不変。7軸 impl audit CONVERGED (LOAD-BEARING 0)。注: brief 名の b52 はタスク表の
  b52 (`_pendingRestore` 整理、todo のまま) と番号衝突、本作業は別タスクなので
  タスク表では「衝突復旧2」として記録した。
- 2026-05-22 Claude — b51 完了 + 衝突復旧。minimap を `web/lib/minimap.js` に抽出。
  Gemini が `index.html` の #intro-overlay を Svelte 用に置換したため、DOM 版を
  `web/index-dom.html` に保存して並行運用に。e2e を index-dom.html へ retarget、
  GSI route の基底 URL を origin 直書きに修正、camera_persist を Gemini の新カメラ
  操作 (左=パン/右=オービット) に追従。vitest 1447 green。
- 2026-05-22 Claude — b50 完了。`loadCourse` の fetch→平滑化→terrain 構築を
  `web/lib/course_loader.js` に抽出。viewer は `loadCourseData` を import。
  挙動不変、vitest 1448 / e2e user_journey 13 件 green。commit 8cb70c0。
- 2026-05-22 Claude — viewer 載せ替え可能化リファクタ計画を策定。engine を
  viewer-maplibre.js から framework 非依存モジュールへ剥がす方針。
- 2026-05-22 Claude — b47/b48/b49 (観るモードフラグ修正 / カメラ視点永続化 /
  `?cap=1` 画面送信モード) を実装・push。
- 2026-05-22 Gemini — Svelte 版の殻を `svelte-poc/` → `web/src/` へ移行中。
  Vite ビルド (`web/src/main.js` → `web/dist/`)、`store.svelte.js` で状態一元管理。
