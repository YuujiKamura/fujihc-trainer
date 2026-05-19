# Handoff: Rider 移動モデルの作り直し（rider-position-model）

## 状態: 完了

富士ヒル viewer の rider 移動モデルを「位置が主・距離は派生値」へ作り直すタスク。実装・検証・ローカルコミット まで完了。push・PR はしていない。

## 何をやったか（done）

1. **移動モデルの作り直し** ── 走行記録の距離欄と記録緯度経度の道のりが 3.3倍食い違うバグ（距離 52m / 実道のり 15.7m）を、移動モデルの構造から直した。
   - `web/lib/terrain.js`: 距離スケールを course の lat/lon の haversine 累積長に一本化。`course.json` の `distance_m` フィールドを読む経路を terrain から削除。位置 `(segmentIdx, fracInSegment)` ⇄ 距離 ⇄ lat/lon を相互変換する `getPositionAt` / `distanceAt` / `locate` / `segmentLength` / `segmentCount` を追加。`haversineMeters` を export。
   - `web/lib/rider.js`: 一次 state を位置 `(segIdx, segFrac)` に。`tick` はセンターラインを実メートルぶん歩く（距離からの逆算なし）。`distanceTraveled` は位置から導出する getter。
   - `web/lib/ride_state.js`: 後方互換 shim。legacy `_idx` 機構を廃し `rider.position` に委譲。
   - `web/viewer-maplibre.js`: `totalDist` を `terrain.totalDistance` に切替。minimap 標高プロファイルの x 軸を `terrain.distanceAtIdx` に揃え同一距離スケールに統一。
2. **3D 自機の配置ずれ修正** ── `web/lib/map3d/index.js` の `updateRider` が、再サンプリング後のリボン頂点配列を非再サンプリング course の index で引いていた食い違い（commit `056259c` 起因）を修正。`savedCourse`（リボンと同じ再サンプリング列）で引くよう変更。
3. **未コミット変更の取り込み** ── `web/lib/ws_client.js`（fake trainer の trainer/HR メッセージ交互送信）・`web/tests/ws_client.test.js`・`e2e/user_journey.spec.js`（受け入れジャーニーテスト）を本コミットに含めた。
4. **テスト修正** ── 既存 fixture が新 haversine モデルで壊れたため、`web/tests/_helpers/course_fixture.js` を新設し 11 テストファイルを新モデルの正しい期待値に直した。

## 未着手 / 対象外

- **autosave 復元の互換境界**（既知の罠、下記）── 本タスクで autosave / 履歴のスキーマ・保存経路は変更していない。
- `smoothCourse` 自体は変更していない（新モデルが `distance_m` を読まないので無関係になった）。
- 作業ツリーに残る本件と無関係な dirty file（`rails-app/*` / `web/inertia-sim.html` / `web/terrain3d.html` / `scripts/fix_gpx_lat.mjs` / `test-results/`）はコミットに含めていない。触っていない。

## 再開の起点

- ブランチ: `b11-phase5-tile-cache`
- 直近コミット: 本タスクのコミット（「コミット」節のハッシュ）。`git log -1` で確認。
- 起動・検証コマンド:
  - `npm test` ── vitest（1357 passed）
  - `npm run test:e2e` ── Playwright（10 passed）。webServer は playwright.config.js が `python -m fujihill.bridge --dummy --http-port 8000 --port 8765` を起動。
  - `python -m pytest` ── 176 passed / 1 xfailed
  - test モード目視: bridge 起動後 `http://127.0.0.1:8000/?test=1&consent=dev`。使い捨て capture script は `~/.agents/scratch/fujihc-trainer-project/capture-rider.mjs`。
  - ai-code-review: `~/ai-code-review/target/release/review.exe --diff --target C:/Users/yuuji/fujihc-trainer`

## 既知の罠

1. **autosave 互換境界（最重要の申し送り）**: IndexedDB 保存済の autosave `distanceM` / ride 履歴 `summary.distance_m` は旧（壊れた）距離目盛り由来の値。新 `placeAtDistance` は haversine メートルとして解釈するため、旧 record を読み戻すと位置がずれる。現状は autosave 復元が `SKIP_RESTORE = true`（viewer-maplibre.js）で停止中、ride 履歴は read-only 表示のみのため実害なし。**復元機能を再有効化するときは旧 autosave record の migration / 破棄が必要**。
2. **テスト fixture の距離は haversine 自己整合にする**: 新 terrain は `distance_m` フィールドを無視し lat/lon の haversine 実長を距離にする。テスト course を組むときは `web/tests/_helpers/course_fixture.js` の `withCumulativeDistance`（distance_m を haversine 累積で埋める）/ `DEG_LAT_PER_M`（1m スケール fixture 用の緯度刻み）を使う。`distance_m: i*111` のような幾何と無関係な値を書くと fixture が嘘をつく。
3. **距離の exact assertion は `toBeCloseTo`**: haversine 距離は非整数。整数（segmentIdx / 件数 / フラグ）は `toBe`、距離は `toBeCloseTo`。1m スケール course のセグメント境界（整数 m）で idx を assert すると float 誤差で揺れる ── 区間内部の値で assert する。
4. **trkpt の観測は `rideState.getTrkpts()`**: shim（ride_state.js）は Rider 内部とは別の独自 trkpts buffer を持つ。viewer の tick は `rideState.appendTrkpt` 経由。`rider.getTrkpts()` を読むと実走しても 0 のまま。
5. **3D 自機配置はリボンと同じ course 列で**: `web/lib/map3d/index.js` の `renderCourse` は course を `resampleCourse(course, 8)` してからリボンを組む。自機をリボン上に置く処理は同じ `savedCourse`（再サンプリング列）を使うこと。非再サンプリング course の index でリボン頂点を引くと自機が別地点に飛ぶ。

## main セッションが知るべき決定・仮定

- **設計の核（ユーザー指示）**: 位置を `(segmentIdx, fracInSegment)` で持つことを必須化。自由な 2D 点（lat/lon を独立に積分）として持つことは禁止 ── 位置は定義上センターライン上に固定され横ずれが構造的に起きえない。`distanceTraveled` は保持 state ではなく位置の getter。
- **terrain は `distance_m` を読まない**: course.json の `distance_m` フィールドは `smoothCourse` 後に lat/lon とずれる壊れた目盛り。terrain は構築時に lat/lon から haversine で距離スケールを作り直す。`getSections`（観るモードの区間分割、`course_sections.js` 委譲）だけは `distance_m` を使うが、これは rider 移動とは別系統の表示機能なので対象外とした。
- **3D 自機の Y は `elevation_m` 由来ではない**: 自機はコースリボン中心に乗り、リボンは `conformRibbonToMesh`（course_ribbon3d.js）が描画地形メッシュ表面 `sampleMeshHeight` の高さに頂点 Y を再計算済。自機 Y は既に「描画中の地形サーフェス」由来。観測されていた「浮き/ずれ」は再サンプリング index 食い違いによる配置ずれだった（上記既知の罠 5）。
- **ブリーフは改訂版に全面書き換え済**: `~/.agents/scratch/fujihc-trainer-project/brief-rider-position-model.md` は 7軸 audit 反映後の改訂版。`## 用語` `## 参照` `## プライバシー境界` `## 位置の補正` 節を新設済。
- **検証結果**: vitest 1357 / e2e 10 / pytest 176+1xfailed 全緑。受け入れジャーニーテスト「一定の力で漕ぐと記録速度はなめらか」緑（`saved.distM ≒ pathLen`）。ai-code-review 通過。test モード目視で等速移動・地形接地を確認。

## コミット

- ハッシュ: `b47cc14714544069ba22cc9c1213927c3ce824cd`
- メッセージ: `feat: rider 移動モデルを「位置が主・距離は派生値」に作り直す`
- ブランチ: `b11-phase5-tile-cache`（ローカルのみ、push なし）
- 19 ファイル変更。本件と無関係な dirty file（`rails-app/*` 等）は未コミットのまま残してある。
