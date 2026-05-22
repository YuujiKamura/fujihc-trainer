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

## タスク (engine リファクタ / Claude レーン)

計画の正本: `~/.agents/scratch/fujihc-trainer-project/refactor-plan-svelte-migration.md`

| ID | 内容 | 状態 | 担当 |
|---|---|---|---|
| b50 | loadCourse の純粋部を `course_loader.js` に抽出 | **done** (8cb70c0) | Claude |
| b51 | minimap を「データ算出」と「canvas 描画」に分離 | todo | Claude |
| b52 | autosave/restore の `_pendingRestore` global を整理 | todo | Claude |
| b53 | tick ループを `viewer_loop.js` に抽出 | todo | Claude |
| b54 | viewer 状態 (module global 50+ / setAppState / mode-view) を `viewer_state.js` に一元化 | todo | Claude |
| b55 | wsHandlers を emitter/adapter 化 | 将来 | - |
| b56 | bootApp 初期化フローの async 直列化 | 将来 | - |

Phase 1 (b50-b53) は全部 `viewer-maplibre.js` を編集するので**直列**に進める。

## Worklog (append-only、新しいものを上に)

- 2026-05-22 Claude — b50 完了。`loadCourse` の fetch→平滑化→terrain 構築を
  `web/lib/course_loader.js` に抽出。viewer は `loadCourseData` を import。
  挙動不変、vitest 1448 / e2e user_journey 13 件 green。commit 8cb70c0。
- 2026-05-22 Claude — viewer 載せ替え可能化リファクタ計画を策定。engine を
  viewer-maplibre.js から framework 非依存モジュールへ剥がす方針。
- 2026-05-22 Claude — b47/b48/b49 (観るモードフラグ修正 / カメラ視点永続化 /
  `?cap=1` 画面送信モード) を実装・push。
- 2026-05-22 Gemini — Svelte 版の殻を `svelte-poc/` → `web/src/` へ移行中。
  Vite ビルド (`web/src/main.js` → `web/dist/`)、`store.svelte.js` で状態一元管理。
