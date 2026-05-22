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

## 全ワーカーへの通達 — 画面検証はキャプチャ機構で実画面を観る (PDCA 必須)

UI / viewer に触る全 brief の検証で、`?cap=1` キャプチャ機構 (b49 で実装、
`web/lib/map3d/` の index.js / scene.js が viewer の描画フレームを画像バッファに
出力する) を使い、出力画像を**実際に開いて目視批評**しろ。

test green / HTTP 200 / build 成功は「画面を観た」ことにならない ── intro 画面・
loading 中・別 state でも撮れてしまう。手順:

1. 期待する最終 state を 1 つ先に言語化する。
2. その state へ実際に到達させる (intro / consent overlay を抜ける等、到達まで責任を持つ)。
3. `?cap=1` でキャプチャする。
4. 出力画像を開いて、期待した要素・配置・色と画面の食い違いを具体的に述べる。

食い違いゼロを無言で PASS と言うな。観た上で批評しろ。これを各 brief の verify /
PDCA ループに必ず組み込むこと。

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

- 2026-05-23 Claude — b67 完了 (commit `f9386c8` + `14b1e35`、 ブリーフ
  `~/.agents/scratch/fujihc-trainer-project/b67-pages-terrain-static-direct.md`)。
  3D 地形 (`loadDemStitched`) の DEM タイル取得を「IndexedDB タイルキャッシュ
  → GSI 直」 の 2 段に統一 (`f9386c8`、 bridge 段撤去 + zoom 引数追加 +
  `GSI_DEM_PNG_DIRECT_BASE` 新設)、 高精細 z15 dem5a メッシュの外側を z12
  dem_png の広域低精細メッシュで覆って富士山体の全景を背景に敷く (`14b1e35`、
  `WIDE_DEM_ZOOM=12` 定数 + `index.js boot()` に try/catch 非致命ブロック +
  座標オフセット平行移動 + polygonOffset / renderOrder 二段で z-fighting 回避 +
  `bootMap` の opts に `wideBounds: fujihill.dbBounds`)。 b67 brief を
  `multi-axis-draft-audit` で 2 round 7軸 audit (Round 1 軸3/4 LOAD-BEARING →
  値根拠表 + 既存テスト行番号+件数 表 + 新規 expect 4 件の具体記述 + negative
  grep + error path test 追加で Round 2 RESOLVED)、 LOAD-BEARING=0 / COSMETIC=0
  で CONVERGED。 検証: vitest 1528 passed (新規 4 件 b67 describe + 1 件
  zoom_bounds + 3 件 viewer_url_audit)、 pytest 239 passed / 4 skipped、
  bridge 無し `python -m http.server 8090 --directory web` + playwright で
  実画面 2 枚キャプチャ目視 (= b67-shot-1-default.png / b67-shot-2-wide.png、
  scratch/ 配下) → 完了条件 (a) z15 高精細 (b) 広域低精細メッシュ富士山体全景
  (c) コース箱縁の「ぶつ切りの虚空」 不在 すべて PASS。 配布元配慮: GSI 通信は
  不変 (消えるのは Pages オリジン宛の死んだ 404 のみ)、 広域メッシュ 12 タイル
  追加分も IndexedDB 90日 TTL で 2 回目以降ゼロ。 注: 完了条件 (d)「コンソール
  に /tiles/gsi_dem 404 なし」 は厳密 FAIL ── 起動 probe (terrain_phase.js /
  terrain_loader.js) が同型の死んだ往復 `STATIC_TILE_BASE_URL/static/tiles/gsi_dem`
  を 3 タイル probe して 404 を出すが、 これは本 brief §注意の「3D 地形
  (`loadDemStitched` 経路) のみ」 scope 外、 viewer は GSI direct fallback で
  正常起動。 同型問題なので別 brief b70 (仮称) で起動 probe にも同じ撤去を
  適用するのが自然。 詳細は brief §実画面検証で発見した残課題。
- 2026-05-23 Claude — b68 完了 (commit `1576e1e`)。完成済みブランチ `b62-atmosphere-tuning-sliders` を `b46-terrain-loader-screen` にマージし、富士遠景の物理ベース大気散乱 (b61) と散乱パラメータ調整スライダー 4 本 (`atmoMie` / `atmoG` / `atmoDensity` / `atmoSun`、b62) を現行ブランチへ復活 (新規実装でなくブランチ合流)。実コンフリクトは AI-COORDINATION.md の Worklog のみ ── b62 側 2 エントリと b46 側「全ワーカー通達」1 エントリを時系列順で両方残して解決。`viewer-maplibre.js` は auto-merge で b62 の atmosphere 4 def と b46 のパワー def が共存、`index.js` / `scene.js` / `map3d_index.test.js` は b46 が分岐点以降未 touch で b62 版がそのまま入る。7軸 audit 3 round で CONVERGED (LOAD-BEARING 0 / COSMETIC 1)。検証: vitest 1519 passed / 0 failed、pytest 239 passed / 4 skipped / 0 failed (test_fake_trainer はポート衝突で既知ハング、b59 と同じく --ignore)、e2e `atmosphere_sliders.spec.js` 2/2 passed、bridge 無し静的サーバ (python http.server 8090) で viewer を起動 → atmoMie デフォルト (5e-6) と 40e-6 で 2 枚キャプチャを比較、Mie 上昇で富士遠景が霞み Mie 低下で山体の輪郭が戻る挙動を目視確認、機器設定パネルに散乱スライダー 4 本が並ぶことも確認。
- 2026-05-22 Claude — b62 完了 (branch `b62-atmosphere-tuning-sliders`、base `ada555f`)。
  b61 の大気散乱が白っぽすぎる件を是正。`atmosphere3d.js` の `ATMO_BETA_MIE` を
  21e-6 → 5e-6 に下げ Rayleigh 優位に (= 白濁を脱し青い透明感)。散乱パラメータを機器設定
  スライダー 4 本に露出 (`atmoMie` / `atmoG` / `atmoDensity` / `atmoSun`、`CONTROL_DEFS`)。
  Rayleigh (青み) は空気分子由来の物理定数なのでスライダーにせず固定 ── 日々変わるのは
  Mie (もや) なので調整つまみは Mie 側に絞った (user 指摘反映)。配線は viewer →
  `index.js` facade (`setAtmosphereParams` / `getAtmosphereUniforms` を追加、pending 機構
  対応) → `scene.js` → `atmosphere`。差し替え口契約のため `map_renderer.js` に no-op
  スタブ 2 本 + `map3d_index.test.js` の `CONTRACT_METHODS` を 24 に更新。
  `effectiveCoefficients` / `setParams` を betaMie 可変に拡張 (1 引数呼びは b61 と完全
  一致の後方互換)。太陽方位は既存 `lightDir` が兼ねる (仰角は `sunElevationFromAzimuth`
  SoT、新規スライダー無し)。7軸 audit を 2 round で CONVERGED (Round1 6軸 LOAD-BEARING
  → 改訂で全 RESOLVED)。検証: vitest 1496/1496 green (atmosphere3d.test.js 拡張 +
  atmosphere_control_defs.test.js 新規)、e2e `atmosphere_sliders.spec.js` 2/2 green、
  実画面 `?cap=1` で atmoMie 上下のキャプチャ比較を目視 (Mie=40 で白濁・Mie=5/0 で
  富士遠景が青く澄む・近景ディテール保持を確認)。注: `playwright.config.js` の webServer
  に `env:{PYTHONPATH:'src'}` を追加 ── bridge の web 配信 root が fujihill パッケージ
  `__file__` 相対で、editable install が元 repo を指すため git worktree から e2e を
  回すと worktree の変更が配信されない問題を修正 (通常 checkout でも同 repo を指すので
  無害)。注: e2e の terrain-loader / camera / tile_load_budget 系 spec 群は worktree に
  tile cache fixture が無く GSI timing 依存で flaky ── base `ada555f` でも同 spec 群が
  同様に fail し b62 起因ではない (別途 fixture 整備が要る別案件)。
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
- 2026-05-22 Claude (差配) — 全ワーカー通達を追加: 画面検証は `?cap=1` キャプチャ
  機構で実画面を観て批評すること (test green ≠ 画面確認)。各 brief の verify /
  PDCA ループに必須。詳細は上「全ワーカーへの通達」節。
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
- 2026-05-22 Claude — b53 (brief `b53-section-collapse-and-power-slider`、 タスク表の
  b53「tick ループ抽出」とは別件、 user 直接指示の UI 追加)。観るモードに 2 機能を追加。
  (1) 区間リストパネル `#section-list-panel` のヘッダ折りたたみトグル `#btnSectionCollapse`
  (index.html / CSS / viewer-maplibre.js)。(2) 調整パネル `CONTROL_DEFS` にパワー
  スライダー power def (default 250W)。`createFakeStateGenerator` に `getPower` 第 3
  引数を追加 (省略時 150 で後方互換)、 観る/デモ/TEST の fake trainer の power_w を
  スライダー値 `manualPowerW` にした ── 既存の `wsHandlers.state` → `integratePhysics`
  経路がそのまま rider 速度に反映。実ライドは fake generator を通らないため trainer
  接続中はスライダー無効 (実行時分岐なし)。挙動の足し算。7軸 draft audit CONVERGED。
  vitest 1453 green (b53 新規 15 件含む)、 e2e `section_collapse_and_power` 2/2 +
  `view_mode_exit` green (単独実行で確認)。
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
