# ブリーフ確定版: viewer QA 修正バッチ ── 巨大ライダーの影スケール対応 + 倍率50倍取り込み

## はじめに

富士ヒル viewer の移動モデル作り直し (commit `b47cc14`) 後の実機 QA で挙がった 3 件の表示バグ候補 + 既出 1 件 (倍率50倍) を 1 バッチで処理する。初版ブリーフ (`brief-viewer-qa-fixes.md`) を `multi-axis-draft-audit` の 7軸並列レビューにかけたところ **LOAD-BEARING 12 件で REDRAFT 判定**。本確定版は各項目を**実行時の値・実コード・ヘッドレス Playwright 目視で root-cause してから**書き直したもの。

結論を先に: **実バグは item 3 (巨大ライダーの影が四角くクリップ) の 1 件のみ。** item 1 (ミニマップ追随) と item 4 (コースリボンの勾配追従) は実行時計測で「正しく動作している = バグではない」と判明した。初版は実画面・実コードを確認せず証拠画像の見た目から推測で断定しており、これは drift catalog の NG-RG-8 (「壊れている」を所与にし実画面確認の段を欠く) / 推測断定 pattern の再演。本確定版で訂正する。

## 用語 (NG-R1-3 対策 ── 同一概念の語を 1 つに固定)

- **ミニマップ上半分** = `#minimap-top` canvas。course の外接矩形を OSM タイル + コース線で 2D 描画し、canvas 全体を 180° 回転したパネル (`buildMinimapTopBase`)。
- **三角マーカー** = 自機の現在位置を示す指標 (`drawDirTriangle`)。初版の「ライダーマーカー」と同義、本ブリーフは「三角マーカー」に統一。
- **コースリボン** = 3D シーンの勾配色の道路帯 (`course_ribbon3d.js` の `createCourseRibbon` が組む 1 本の Mesh)。初版の「コースパネル」「勾配色パネル」は同義、本ブリーフは「リボン」に統一。
- **影オルソカメラ** = 自機の影を shadow map で落とすための平行投影カメラ (`sun.shadow.camera`)。その視野範囲を「錐台」と呼ぶ。コード語は `sun.shadow.camera` / `focusShadowOn`。
- **影ボード** = 自機足元の影専用の透明ボード (`rider_mesh3d.js` の `shadowBoard`)、`setShadowBoardEnabled` トグルで切替、既定オフ。本バッチでは触らない。

## 直す内容

### 1. ミニマップ上半分の三角マーカー追随 ── 実行時検証の結果「バグでない」

初版の主張: 距離 99.95% 地点で三角マーカーがコース中ほどに止まる。

**実行時検証 (instrumented headless capture で `projectLatLon` の戻り値を直接ダンプ):**
- 起点付近 (距離 1.7m): `projectLatLon(自機 lat/lon)` = (265.7, 131.3)、`projectLatLon(course[0])` = (265.7, 131.2) ── **一致、三角は起点に乗る**。
- ゴール付近 (距離 23826m): `projectLatLon(自機 lat/lon)` = (179.8, 350.7)、`projectLatLon(course[last])` = (180.3, 350.6) ── **一致、三角はゴールに乗る**。

結論: 三角マーカーは自機位置に正しく追随している。`updateMinimap` に渡る `rLat/rLon` は実位置で、`projectLatLon` (= polyline 描画と同一の `project`) も正しい。初版が `mm2-minimap-top.png` を「中ほど」と誤読した正体は、ゴール点が 180° 回転後のミニマップで視覚的中央付近に投影されるため (course bbox はゴールより外まで広がり、コース最南の折返し区間 i≈1467 がゴールより外側に投影される)。**コード変更なし。** report に実行時証拠を明記する。

### 2. ライダー倍率50倍 (実装済・未コミット ── 取り込む)

`web/viewer-map3d.js` の `CONTROL_DEFS`、`riderScale` スライダーの `max` を 80→500 に変更済 (表示 1.0×〜50.0×、既定3.6×据え置き)。main が実装し未コミット。worker はこれを取り込みバッチのコミットに含める。下記 item 3 はこの「巨大ライダー可能化」が露出させた副作用。

### 3. 巨大ライダーで影が四角くクリップされる (LOAD-BEARING ── 実バグ、本バッチの主修正)

症状: 倍率を上げると影が四角く切れる。

**実コードでの root-cause (初版の機構記述を訂正):**
- 初版は「影用カメラの錐台が固定サイズ」と書いたが**誤り**。`scene.js` の `focusShadowOn` は既に `reach = min(SHADOW_CAM_BASE + RIDER_HEIGHT_M/tan(仰角), SHADOW_CAM_MAX)` で錐台を仰角に応じ可変にしている (初版の「固定サイズ」処方は drift catalog の「死んだ処方箋」)。
- 真因: `focusShadowOn` が `riderScale` を**一切受け取らない**。`RIDER_HEIGHT_M=2.6` は riderScale 3.6 の自機高さ基準の固定値、`SHADOW_CAM_MAX=18` も固定。倍率50倍 (自機が約14倍) では影が錐台 ±18 を遥かに超え、shadow map の被覆正方形に四角くクリップされる。光源距離 `SHADOW_LIGHT_DIST=60` も固定で、巨大ライダーの全高より光源が低くなり影が壊れうる。
- もう一点: `index.js` の地形メッシュは `receiveShadow` 未設定 (コメント `// 地形は影を受けない`)。影の受け手はコースリボン (幅10m) のみ。巨大ライダーの影はリボン幅をはみ出し、はみ出たぶんは受け手不在で消える。

**修正方針 (ユーザー設計指示 = 地形に投影 + 錐台を倍率連動):**
- `sun_model.js`: 純関数 `shadowCameraConfig(riderScale, elevationDeg)` を新設。影オルソカメラの半幅 `reach` と光源距離 `lightDist` を `k = riderScale / 3.6` 倍して相似に拡大。影定数 (`RIDER_HEIGHT_M` / `SHADOW_CAM_*` / `SHADOW_LIGHT_DIST` / `RIDER_SCALE_BASE`) も `sun_model.js` へ集約 (= THREE 非依存、node テスト可能。`scene.js` は `import * as THREE` のため node テスト不可)。
- `scene.js`: `focusShadowOn(pos, riderScale)` に変更、`shadowCameraConfig` を使い `cam.far` も光源距離に追従。
- `index.js`: `render()` が `rider3d.group.scale.x` を `focusShadowOn` に渡す。`terrainMesh.receiveShadow = true` (= 地形も影を受ける、ユーザー指示)。

ファイル: `web/lib/map3d/sun_model.js`、`web/lib/map3d/scene.js`、`web/lib/map3d/index.js`。

### 4. コースリボンが勾配通りに上下しない ── 実行時検証の結果「バグでない」

初版の主張: コースリボンが地形の起伏に沿って上下しない、`conformRibbonToMesh` が効いていない可能性。

**実行時検証 + コード照合:**
- 実行時ダンプ: リボン頂点 Y は `yMin 1052m / yMax 2297m`、ySpread = **1245m** ── コースの全標高差ぶん上下している。サンプル頂点 Y は 1052→1120→1201→…→2294 と滑らかに climb。
- コード照合: `createCourseRibbon` は `conformRibbonToMesh` を無条件で呼ぶ (`course_ribbon3d.js:190`)。`conformRibbonToMesh` は各頂点 Y を `sampleMeshHeight(...) + drapeOffset(2)` に再計算。`sampleMeshHeight` (terrain_surface.js) の頂点写像・三角形分割は `buildTerrainGeometry` (terrain3d.js) と厳密に一致 ── リボン Y = 地形メッシュ表面 + 2m。
- ヘッドレス目視 (`dbg-wide-50x-near.png`): リボンは地形の起伏に沿って湾曲・上下している。

結論: コースリボンは地形に追従済。初版の「`conformRibbonToMesh` が効いていない」は推測で、実機構は正しい。**コード変更なし。** report に実行時証拠を明記する。

## 検証 (受け入れ条件)

- `npm test` (vitest) / `npm run test:e2e` (Playwright) / `python -m pytest` 全緑。journey test「一定の力で漕ぐと記録速度はなめらか」も緑。
- 変更モジュール `sun_model.js` の新規 public 関数 `shadowCameraConfig` に単体テスト必須。既存テスト `web/tests/scene_sun.test.js` (sun_model.js を対象、変更前 8 件) に追加。`scene.js` / `index.js` は `import * as THREE` / WebGLRenderer のため node テスト不可 ── 数値ロジックを `shadowCameraConfig` (純関数) に切り出してそこで担保 (drift catalog の「描画関数は純関数 test で担保」pattern)。
- `ai-code-review` を回し NG は自力修正 (最大3回)。
- ヘッドレス Playwright capture で目視: 倍率50倍で影が四角く切れず自転車型の影が地形に落ちる (item 3 修正の確認)。item 1 / item 4 は実行時値ダンプで「正しい」を確認済。

## 参照 (NG-R5-11 対策)

- Three.js DirectionalLightShadow (影オルソカメラ): https://threejs.org/docs/#api/en/lights/shadows/DirectionalLightShadow
- Three.js OrthographicCamera: https://threejs.org/docs/#api/en/cameras/OrthographicCamera
- Three.js Object3D.receiveShadow / castShadow: https://threejs.org/docs/#api/en/core/Object3D.receiveShadow
- Vitest: https://vitest.dev/
- Playwright: https://playwright.dev/
- SoT ファイル: `web/lib/map3d/sun_model.js` (太陽・影モデル純ロジック)、`web/lib/map3d/scene.js` (シーン/影 THREE グルー)、`web/lib/map3d/index.js` (facade)、`web/lib/map3d/course_ribbon3d.js` / `terrain_surface.js` (リボン地形追従、item 4 で照合)。

## まとめ

完了 = item 3 (影の倍率連動 + 地形 receiveShadow) の修正 + item 2 (倍率50倍) を取り込んだローカルコミット + vitest/e2e/pytest 全緑 + ai-code-review 通過 + ヘッドレス目視で item 3 を確認。item 1 / item 4 はコード変更なし (実行時検証で正しいことを確認、report に証拠を記載)。

- ship: item 3 修正 + item 2 倍率変更を 1 コミットでローカル commit。
- ship しない: push / PR / 外部操作。本件と無関係な dirty file (rails-app / inertia-sim.html / terrain3d.html 等) はコミットに含めない。
- 守る一線: 移動モデル本体 (rider.js / terrain.js の距離↔位置) は触らない。
