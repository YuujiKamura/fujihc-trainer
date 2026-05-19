# タスク (確定版): 3D コースリボンの配色を MapLibre 版の段階別フラット色 (6 ビン) に戻す

> この確定版は、初版 draft を multi-axis-draft-audit (7 軸並列監査) にかけ、6 軸の
> LOAD-BEARING 指摘で全面改訂したもの。初版の主な誤り: (1) 現状を「連続グラデーション」と
> 誤記 (実体は 0.5% 刻みの細段)、(2) 離散ビン関数を「git 履歴に在るはず」と曖昧化 (実体は
> 現コードに live)、(3) terrain3d.js 無改造の根拠を「配布元配慮」と誤記 (catalog NG-RG-3 再演)。

## はじめに

3D (Three.js) viewer のコースリボンは今、勾配を 0.5% 刻みの段に量子化し 10 色ランプを
補間して塗っている (`route_styling.js` の `gradeColorContinuous`)。刻みが細かいため
見た目はほぼ滑らかなグラデーション。user はこれより、MapLibre 版でやっていた
「段階別フラット色」── 勾配を 6 つの粗いグレード bin に分け、各区間を 1 つのフラットな
bin 色で塗り、bin 境界で色がガクッと段に切り替わる見た目 (user の言葉で「タイル状」) ──
の方が良いと言っている。

3D コースリボンの配色を、その 6 ビンの段階別フラット色に戻す。閾値・色は MapLibre 版
= 現コード `web/lib/route_styling.js` の `classifyGrade()` + `GRADE_THRESHOLDS`
(既存・テスト済) をそのまま使う。**変えるのは頂点色だけ。形状は触らない。**

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit まで、`git push` 禁止。
- viewer は `http://127.0.0.1:8000/` で配信中 (既存サーバ稼働、bridge を二重起動するな)。

## 背景・なぜ (中段)

**配色の SoT は `web/lib/route_styling.js`**。ここに 2 つの配色関数が共存する:

- `classifyGrade(slope_pct)` → `{name, color}`。6 ビンの離散分類。`GRADE_THRESHOLDS` が
  閾値・色の表:

  | grade | slope_pct | hex | 色 |
  |---|---|---|---|
  | flat | ≤ 1% | `#3aa055` | 緑 |
  | gentle | 1–4% | `#a3c853` | 黄緑 |
  | moderate | 4–7% | `#f4d03f` | 黄 |
  | hard | 7–10% | `#e67e22` | 橙 |
  | very_hard | 10–15% | `#e74c3c` | 赤 |
  | extreme | > 15% | `#8e44ad` | 紫 |

  境界は min inclusive / max exclusive (= 4.0% は moderate)。MapLibre 版の道路 polygon
  paint expression (`buildGradeColoredRoute` / `makeGradeColorExpression`) が今もこれを
  使う。これが「MapLibre 版のタイル状配色」の実体。**git 履歴を漁る必要はない、現コードに
  live で在る。**

- `gradeColorContinuous(slope_pct)` → hex。slope を `GRADE_STEP_PCT` (0.5%) に量子化し
  10 色ランプ (`GRADE_COLOR_STOPS`) を線形補間。名前は Continuous だが実体は 0.5% 刻みの
  段。富士ヒルの勾配域 0〜10% を約 20 段に細分するため見た目が滑らかに見える。

**なぜ一度連続化したか、なぜ今戻すか**: 2026-05-17 に離散 6 ビン → 連続ランプへ変えた
(`route_styling.js` line 60-64 / `route_styling.test.js` line 221 にコメント記録)。理由は
「旧 6 段階では富士ヒルの登坂域がほぼ緑〜黄〜橙の狭い帯にしか見えず勾配差が乏しかった」。
今回はそれを user 判断で巻き戻す ── user は「色の豊かさ」より「区間ごとの勾配段が一目で
読め、隣の区間との段差が明確になる」見た目を取る。**色数が約 20 段ランプ → 6 ビンに減るのは
意図したトレードオフ**。実装者は「ビン化 = 善」ではなく「user が豊かさより読みやすさを
選んだ巻き戻し」と理解せよ。

**今 3D リボンが呼んでいるのは `gradeColorContinuous`**: `web/lib/map3d/course_ribbon3d.js`
line 31 で import、`ribbonVertexColors()` line 58 で `gradeColorContinuous(course[i].slope_pct)`
を呼ぶ。差し替え箇所はこの 1 import・1 呼び出しだけ。

## やること

### 主作業 (1 つ)

`web/lib/map3d/course_ribbon3d.js` の `ribbonVertexColors()` が、各 course 点の頂点色を
`gradeColorContinuous(slope_pct)` ではなく `classifyGrade(slope_pct).color` で決めるよう
差し替える。

- line 31 の import を `gradeColorContinuous` → `classifyGrade` に変える (route_styling.js から)。
- line 58 の `gradeColorContinuous(course[i].slope_pct)` を `classifyGrade(course[i].slope_pct).color`
  に変える (`classifyGrade` は `{name, color}` を返す ── `.color` を取る)。
- 関数 docstring (line 41-50) の「`gradeColorContinuous` が SoT」等の記述を新方式に直す。

### 不可侵制約 (壊すな)

- **リボンの形状を変えるな**。`buildCourseRibbon` の頂点・`conformRibbonToMesh` の Y 補正
  (地形追随) には触れるな。変えるのは頂点色だけ。
- **`route_styling.js` の `gradeColorContinuous` 関数本体を削除・改変するな**。
  `web/lib/road_polygon.js` と `web/lib/road_texture.js` が今も使う ── 削除すれば両 module が
  壊れる。差し替えは `course_ribbon3d.js` の呼び出し側 1 箇所のみ。
- **`course_ribbon3d.js` に色定数・閾値を新規定義するな**。配色 SoT は `route_styling.js` の
  `classifyGrade` / `GRADE_THRESHOLDS`。import して使え。
- `web/lib/terrain3d.js` は無改造 ── fetch を持たないテスト済の純関数 SoT (`terrain3d.test.js`
  が pin) であり配色変更の対象外。(配布元 GSI/OSM への配慮の対象は `tile_loader3d.js` /
  `bridge.py` 側であって terrain3d.js ではない。)

### 検証 (3 つ、後述「テスト」「真正性確認」「検証」節)

実画面目視 / テスト / 真正性確認。

## テスト

- **既存テストの書き換え (必須、見落とすな)**: `web/tests/course_ribbon3d.test.js` は
  `ribbonVertexColors` / `createCourseRibbon` を計 13 テストで pin する。配色関数を差し替えると
  以下 2 テストが**確実に落ちる、新方式に書き換えが必須**:
  - line 11 の import `gradeColorContinuous` → `classifyGrade`。
  - line 85-94「各点の色が `gradeColorContinuous(slope_pct)` と一致」── 参照を
    `classifyGrade(slope_pct).color` に書き換える。
  - line 104-113「slope_pct 欠損点は flat (緑) 色」── 参照 `gradeColorContinuous(undefined)`
    を `classifyGrade(undefined).color` に。期待値 (`#3aa055`) は両者同じだが参照関数を揃える。
- **離散ビンの本質を pin するテストを足す/強める** (`course_ribbon3d.test.js` の
  `ribbonVertexColors` describe ブロック内):
  - **同一 bin 内は同色**: 同じビンに入る 2 つの slope (例 moderate ビン内の 4.5% と 6.5%)
    が同一頂点色になる。
  - **bin 境界で色が段に切り替わる**: 隣接ビンをまたぐ 2 つの slope (例 3.9% gentle と
    4.1% moderate) が別色になる。`GRADE_THRESHOLDS` の境界値 1 / 4 / 7 / 10 / 15% を
    名指しで使い、境界の min inclusive / max exclusive (= 4.0% は moderate 側) を pin する。
  - これらは「離散ビン = 同一区間フラット・境界で段」という user の要求そのものを検証する強いテスト。
- **壊すな**: `web/tests/route_styling.test.js` の既存テスト (classifyGrade 6 ビン分・境界値・
  gradeColorContinuous) は本タスクで触らない、全 green を維持。
- **役割分担**: 色の数値的正しさ (どの slope がどの hex か、同色/別色) は vitest
  (`course_ribbon3d.test.js`)。タイル状に見えるか (実画面で段に塗り分けられているか) は
  `desk_capture` 目視。e2e (Playwright) に配色のビン状を判定する手段はない ── e2e に配色テストは
  足さない、既存 e2e を壊さないことだけ確認する。

## 真正性確認 (必須)

配色ロジックをわざと壊して `npm test` でテストが落ちることを手元で 1 回確認 → 戻す。
壊し方は「まさに防ぎたい回帰」= `ribbonVertexColors` の配色を旧 `gradeColorContinuous`
(連続ランプ) に戻す。この回帰で「同一 bin 内同色」(連続だと 4.5% と 6.5% が別色)・
「bin 境界で別色」「境界値で別色」「各点の色が classifyGrade と一致」が落ちることを確認する。
落ちないならテストが真正でない、書き直し。戻した後 `git diff web/lib/map3d/course_ribbon3d.js`
で意図した差分以外が残っていないことを確認してから commit。

## 検証

- `npm test` (vitest)、`npm run test:e2e` (Playwright)、`python -m pytest` を全て走らせ全 green。
  passed / failed 数を報告。
- `desk_capture` で実画面を観て、コースリボンが 6 ビンの段階別フラット色 (区間ごとにフラット、
  bin 境界で色がガクッと段に切り替わる) に塗られ、滑らかなグラデーションでないことを批評。
  期待: 緑→黄緑→黄→橙... と段で切り替わり、各段の中は 1 色。
- 真正性確認の結果を報告。

## 制約 (環境・運用)

- **画面確認は `desk_capture` のみ。`chrome --headless` 直叩きも `headless-shot.ps1` も使うな**
  ── viewer は never-idle なページで headless Chrome が終わらず worker ごと固まる。viewer を
  映した通常 Chrome ウィンドウが無ければ自分で 1 回だけ通常タブで
  `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` しろ。
- `bridge.py` は `127.0.0.1` bind 固定、地図タイル配布元配慮ルールを破るな。
  `tile_loader3d.js` / `bridge.py` は本タスクで一切編集しない (配色は `course_ribbon3d.js`
  内で完結)。
- `course_ribbon3d.js` は `.js` = `sw.js` の `isAppShell` で network-first 配信。配色変更は
  online ユーザに即反映され、`CACHE_NAME` bump は不要。
- 作業ツリーには別 worker の未 commit 変更がある (`viewer-maplibre.js` 等)。自分が触らない
  ファイルには触れるな。commit は自分が触ったファイルだけを `git commit -- <明示パス>` の
  一発でやれ (`git add` と `git commit` を分けるな、`git add -A` 禁止)。
- ローカル commit まで。`git push` 禁止。

## 参照

- 配色 SoT: `web/lib/route_styling.js` ── `classifyGrade` / `GRADE_THRESHOLDS` (6 ビン) と
  `gradeColorContinuous` (0.5% 刻みランプ)。
- 差し替え対象: `web/lib/map3d/course_ribbon3d.js` ── `ribbonVertexColors()` (line 51-71)。
- テスト: `web/tests/course_ribbon3d.test.js` (13 件) / `web/tests/route_styling.test.js`
  (classifyGrade 既存テスト)。
- 連続化の経緯: `route_styling.js` line 60-64、`route_styling.test.js` line 221-222。
- Three.js BufferGeometry 頂点色: https://threejs.org/docs/#api/en/core/BufferGeometry

## 完了報告

MapLibre 版のビン方式 (= `classifyGrade` / `GRADE_THRESHOLDS` の閾値・色)、3D コースの配色を
離散ビンに変えるために直したファイルと方式、実画面の `desk_capture` 観察と批評、書き換えた
既存テストと追加/強化したテスト、真正性確認の結果、`npm test` / `npm run test:e2e` /
`python -m pytest` の passed / failed 数。
