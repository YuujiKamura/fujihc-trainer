# ブリーフ: viewer QA 修正バッチ ── ミニマップ追随 / 影クリップ / コースパネル勾配

## はじめに

富士ヒル viewer の移動モデル作り直し (commit `b47cc14`) 完了後、ユーザーの実機 QA で 3 件の表示バグが見つかった。本ブリーフはその 3 件 + 既出 1 件を 1 バッチで直す単一タスク。担当 worker は「読む → 7軸レビュー (multi-axis-draft-audit) → ブリーフ改訂 → 実装 → 検証 → ローカルコミット」まで通す。push・PR・外部操作は一切しない。

すべて viewer の 3D / ミニマップ描画まわり。移動モデル本体 (rider.js / terrain.js の距離↔位置) は b47cc14 で正しく、journey test で実証済 ── 本バッチでは移動モデルを触らない。触るのは「描画が位置に追随しているか」の側。

## 直す内容

### 1. ミニマップ上半分のライダーマーカーが実位置に追随しない (LOAD-BEARING)

症状: ミニマップは上半分=2D地図、下半分=標高プロファイル。ヘッドレスでゴール手前 (距離 23826 / 全長 23839 = 99.95%) を撮ると、**下半分の点は正しく右端**だが、**上半分の2D地図のライダー三角マーカーはコース中ほどで止まっている**。距離99.95%なのに2D地図上の本体はコース途中 ── マーカーが実位置に追随していない。ユーザー観察「ミニマップと走ってるところが全然食い違ってる」の正体。

main が確認済 (worker は追認 + root-cause せよ):
- `buildMinimapTopBase` (viewer-map3d.js): course の lat/lon bbox から `project(lat,lon)` を作り、OSMタイル + コース線 + start/goal点を project で描き、最後に全体を180°回転。
- `updateMinimap`: 三角マーカーを `project(rLat,rLon)` + 180°回転で描く。三角もコース線も同じ project を通る → 構造上、三角はコース線上の rider 位置に乗るはず。
- 下半分 (`curDist/totalD`) は正常。journey test で「普通に走れば距離↔位置一致」も実証済。
- → 静的に読むと一貫しているのに追随しない。**実行時の値を見て root-cause しろ**: updateMinimap に渡る rLat/rLon が実位置か / project が正しいか / 再描画 gate (`minimapDirty`) で stale 化していないか / 180°回転の二重適用ズレ。

証拠画像 (scratch): `mm2-minimap-top.png` (ゴール付近、三角が中ほど)、`mm-start.png` / `mm-goal.png`。
ファイル: `web/viewer-map3d.js` の `buildMinimapTopBase` / `updateMinimap` / tick 内の updateMinimap 呼び出し。

### 2. ライダー倍率50倍 (実装済・未コミット ── 取り込め、捨てるな)

`web/viewer-map3d.js` の `CONTROL_DEFS`、`riderScale` スライダーの `max` を 80→500 に変更済 (表示 1.0×〜50.0×、既定3.6×据え置き)。main が実装し vitest 1357件パスで確認済、未コミット。worker はこれを取り込んでバッチのコミットに含める。下記 3 はこの「巨大ライダー可能化」の副作用・関連。

### 3. ライダーを巨大化すると影が四角くクリップされる (LOAD-BEARING)

症状: 倍率を上げてライダーを巨大にすると影が四角く切れる。影を落とす範囲 (影用カメラの錐台 / シャドウマップ) が巨大ライダーを想定しない固定サイズで、はみ出して切れる。

**ユーザー設計指示**: 影はコース外へはみ出たら地形に投影されるべき ── 巨大ライダーの影が山の地形面に自然に落ちる形。コースリボンだけを影の受け手にせず、地形メッシュも受け手にする / 影用カメラの錐台を十分広げる。倍率スライダーに連動して錐台を広げるのが筋ならそうする。
ファイル: `web/lib/map3d/scene.js` (シャドウマップ/光源設定)、`map3d/index.js`。

### 4. コースパネルが勾配通りに上下しない (LOAD-BEARING)

症状: コースの勾配色パネル/リボンが、道の勾配 (地形の起伏) に沿って上下していない。ユーザーは「なんで」と聞いている ── **原因を特定し report に明記しろ**。
手がかり: `course_ribbon3d.js` の `conformRibbonToMesh` が各リボン頂点 Y を地形メッシュ表面の高さに合わせる作りのはず。これが効いていない / パネルが別の平らな層になっている可能性。
ファイル: `web/lib/map3d/course_ribbon3d.js` (`conformRibbonToMesh` 等)、`map3d/index.js` (`renderCourse`)。

## 検証 (受け入れ条件 ── Rule 1)

触ったモジュールの全種類のテストを実走し passed/failed を report に明記:
- `npm test` (vitest) / `npm run test:e2e` (Playwright) / `python -m pytest` ── 全緑。journey test「一定の力で漕ぐと記録速度はなめらか」も緑のまま。
- `ai-code-review` を回し、NG は自力修正 (最大3回)。
- **目視 (必須)**: deskpilot の画面キャプチャ (desk_capture) はこのマシンで全方式とも真っ白で使えない。**ヘッドレス Playwright capture を使え** ── scratch に `capture-rider.mjs` / `capture-minimap.mjs` / `cap-mm2.mjs` があり、`python -m http.server -d web 8000` で serve して動かす。各修正を目視確認: (1) ミニマップ上の三角がゴール付近で右端側に来る、(2) 巨大ライダーで影が四角く切れず地形に落ちる、(3) コースパネルが勾配で上下する。スクショは Read で開いて、期待 state を先に言語化してから食い違いを批評しろ。

## 全関数テスト義務

変更した module の全 public/private 関数に test 必須。未 test 関数を残して commit するな。

## 7軸レビュー

本ブリーフをまず `multi-axis-draft-audit` skill の7軸並列レビュー (general-purpose subagent ×7) にかけ、LOAD-BEARING 指摘を反映して改訂してから実装に入る。drift catalog `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` を必読。

## 完了報告先

`~/.agents/scratch/fujihc-trainer-project/report-viewer-qa-fixes.md` に書け: コミットハッシュ / 各テスト passed-failed 数 / 3件それぞれの root-cause と修正内容 / ヘッドレス目視結果 / 7軸 audit verdict / skill firing log。

## handoff

中断・完了どちらでも `~/.agents/scratch/fujihc-trainer-project/handoff-viewer-qa-fixes.md` を書く。次に拾うセッションがブリーフ無しで再開できる粒度で。

## まとめ

完了 = 3バグ修正 + ライダー倍率50倍を取り込んだローカルコミット + vitest/e2e/pytest 全緑 + ai-code-review 通過 + ヘッドレス目視で3件確認。守る一線: 移動モデル本体 (rider.js/terrain.js の距離↔位置) は触らない、直すのは描画追随の側。

- ship: 3バグ修正 + 倍率変更を論理的なまとまりでローカルコミット。
- ship しない: push / PR / 外部操作。本件と無関係な dirty file (rails-app 等) もコミットに含めない。
