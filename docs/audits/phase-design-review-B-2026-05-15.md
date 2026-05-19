# phase-design 2026-05-15 reviewer B (実装観点)

評価対象: `~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md`
角度: A=設計の論理性 / B=**実装の現実性** (= code 化時の衝突 / 漏れ / 工数)
substrate 確認: commit 83c34b1 / 32 test files / 既存 view layer は state-checking → dbinit → pairing → riding の 4 状態 machine.

---

## 軸 1: register (welcome の責務境界) — **BLOCK**

既存は 4 overlay (`#setup-overlay` z=1500 / `#dbinit-overlay` z=1400 / `#postride-overlay` z=1600 / `#history-overlay` z=1550) + `body.state-*` 排他制御。phase-design 「setup-overlay 枠を流用」は **誤り** — `index.html:290` の `<body class="state-checking">` から起動直後 `#setup-overlay` が `class="visible"` で出る (= line 290)、 さらに `static_mode.test.js:107-122` が `setAppState('pairing')` 経路で setup-overlay の visible 化を pin。流用すると pairing flow の DOM が共有され NG-R1-3 (= 同時表示 = 排他制御崩壊) を再演する。

Fix方向性: **新 `#welcome-overlay` (z=1450) + `body.state-welcome` を 1 つ追加**、 既存 4 overlay は手付けず。dbinit / pairing / setup の DOM はそのまま、 visibility 制御だけ welcome class で抑止。

---

## 軸 2: 語彙 — **MINOR**

既存 UI 文字列: 「機器設定」「ライド終了」「pause」「trainer なしでデモ走行」「機器選択」「trainer のハンドシェイク完了後に押せるようになります」(`index.html:244-332`)。welcome の「自分の trainer で走る」「試走デモを見る」と整合可、 ただし「デモ走行」既存ボタンと「試走デモを見る」が二重になる。welcome ボタンを「試走デモ (BLE 不要)」「自分の trainer で走る」に整理し、 既存 `#btnSkip` (「trainer なしでデモ走行」) は welcome 経由でも到達できる導線として残す。

---

## 軸 3: 抽象段差 (C-1〜C-6 の分割) — **LOAD-BEARING**

C-1 (HTML+CSS+JS) は 1 commit、 C-2 (起動分岐) は別 commit、 C-3〜C-5 は単独小 commit、 C-6 は CSS のみで小。**brief 31 の α/β/γ 3 段階分割と同じ規律**で 6 commit に分けるのが正解。1 commit に纏めると test landing 順序で詰む — 特に C-2 の `bootCheckSetupStatus` 改変は `static_mode.test.js:81-104` の structural grep gate (= `env.mode === 'static'` 分岐に initMapMode が必須) と衝突する。

Fix方向性: 順序は **C-1 (welcome DOM + state-welcome class) → C-5 (帰属表記、 単独) → C-2 (起動分岐改修、 test 同時更新) → C-3 / C-4 / C-6** の 6 commit、 各 commit ごと `npm test` 全 402 件 green を維持。

---

## 軸 4: test (welcome 経由必須の physical block) — **BLOCK**

最大の論点。phase-design は test 設計を「あれば良い」レベルに留めてるが、 既存 grep gate (`viewer_url_audit.test.js:250-269`) が **「MAP_MODE は rideState.start を呼ぶ」「initMapMode は setAppState("riding") に遷移」を pin** している。welcome 経由必須化はこの test を直接破壊する。

必要な test 追加:
- `welcome_overlay.test.js`: (a) static mode の bootCheckSetupStatus 経由で `state-welcome` に遷移、 (b) welcome 経由しないと `?map=1` でも initMapMode が rideState.start を呼ばない、 (c) `?map=1` query 直叩きの優先順位 (軸 5 参照)
- `viewer_url_audit.test.js` の grep gate 修正: 「MAP_MODE 自動 start」を「welcome 通過後 → initMapMode 自動 start」に置換、 旧期待値の test は意図的に書き換え (= drift catalog に記録)

Fix方向性: brief 31 と同じ「behavioral test + grep gate」の 2 層、 welcome を経由しない経路から ride 開始関数が呼ばれないことを **構造的に pin**。

---

## 軸 5: 設計境界 (querystring 直叩きの優先順位) — **BLOCK**

`viewer-maplibre.js:748-751` の現状分岐は `MAP_MODE → TEST_MODE → BLE_MODE → default`。phase-design は「`?map=1` は開発者本人 demo 用、 普通の訪問者は welcome 経由」と書くが、 **「URL 直叩きの扱い」が決まってない**。3 つの選択肢:

- (a) `?map=1` は welcome を skip (= 開発者 escape hatch、 README に明記)
- (b) `?map=1` でも welcome を必ず通す (= harm 軽減最大、 開発者は毎回 click)
- (c) `?welcome=skip` を加えて opt-out 形式

実装観点で (a) が衝突最小 (= 既存 dispatch を温存)、 ただし通りすがり訪問者が SNS で `?map=1` link を踏むと従来挙動になる harm vector が残る。(b) が safe だが既存 `MAP_MODE` の用途 (= AI 自動 capture / 視覚 QA) を壊す。

Fix方向性: **(c) `?welcome=skip` 明示 opt-out + (a) は `?map=1` も welcome 必須化**、 開発者は `?map=1&welcome=skip` で従来動作。grep gate も同じ literal で pin。

---

## 軸 6: マイグレ可逆 (commit α/β/γ との両立) — **LOAD-BEARING**

`viewer-maplibre.js:716-737` の `bootCheckSetupStatus` は brief 31 commit β で `bootEnv() → env.mode === 'static' → bootMap(env) + initMapMode()` の structural 経路。welcome 挿入時は **env.mode === 'static' 分岐の中で `initMapMode()` 直前に `showWelcome()` を入れる** のが最小 diff、 commit β の race door close (= immutable ENV) は崩さない。

ただし `static_mode.test.js:93-104` の grep gate 「`if (env.mode === 'static')` branch 内で `showDbinit` を呼ばない + `bootMap(env)` + `initMapMode()` を呼ぶ」が welcome 挿入で fail する。test を `welcome → user click → initMapMode` の経路に更新する diff が α/β/γ と同じ class の修正。

Fix方向性: 「commit δ (welcome 追加) で α/β/γ を壊さない」を test 更新で physical 保証、 ENV / bootMap / bootEnv の structural shape は維持 (= revert 可能性を残す)。

---

## 軸 7: security (XSS / CSRF / 退会フロー) — **LOAD-BEARING**

CSP は `index.html:7` で `script-src 'self'` + `connect-src 'self' https://www.strava.com https://*.strava.com` の最小、 brief 33 §11.5 grep gate (`brief33_grep_gate.test.js:31-51`) で `unsafe-inline` ゼロを pin 済。welcome 追加で **inline event handler を増やすと CSP 違反**、 必ず `addEventListener` で。

退会 (= IndexedDB / localStorage opt-out 解除): 現状 `revokeLocalToken` (`strava_oauth.js:185`) は token 削除のみ、 IndexedDB rides 削除 / Strava client_id 削除 / PKCE verifier 削除 は **未実装**。phase-design C-4「IndexedDB 履歴の opt-in」と対称な「全削除ボタン」必須。fix は `lib/local_data_lifecycle.js` に純関数 `clearAllLocalData({localStorage, indexedDB})` を追加、 既存 `setup-overlay` 内 Strava section に「ローカルデータ全削除」を追加 (= 軸 1 で welcome に置くなら welcome 内に)。

XSS 観点で welcome 経由が増えること自体のリスクは低い (= 新規 input 要素なし、 button click のみ)、 ただし welcome HTML 内で `innerHTML` を絶対使わない (= `textContent` 強制) の lint pattern を test 化推奨。

---

## 個別問い回答

- **C-1 HTML 配置**: 新規 `#welcome-overlay` 追加 (z=1450)、 setup-overlay 上書きや dbinit 中身入替は NG-R1-3 同型予防違反 → 軸 1 参照
- **C-2 静的分岐改修**: `static_mode.test.js:93-104` 直撃、 test を「`env.mode === 'static'` → `showWelcome()` → user click → `initMapMode()`」経路に更新必須 → 軸 6 参照
- **C-3 VirtualRide フラグ**: 既に `strava_upload.js:38-39` で `activity_type='VirtualRide'` + `sport_type='VirtualRide'` hardcode 済、 `postride_buttons.js:103` でも明示。**C-3 の Strava 側対応は既に完了**、 残るは「opt-in 確認 dialog」UI のみ
- **C-4 IndexedDB 書込タイミング**: `ride_db.js:62 addRide` を `postride_buttons.js:117-134` の `btnSaveHistory` click で発火、 opt-in flag は `localStorage('fujihc.history.optin')` で持つのが最小衝突
- **C-5 帰属表記**: `index.html:42` で MapLibre attribution 自動描画 (= 「国土地理院 標高タイル | © OpenStreetMap contributors | MapLibre」相当)、 ただし **「公式 fujihc とは無関係」「Strava ToS 注意書き」は未表示** — Phase C の要件「帰属」は満たすが「免責」は不足、 welcome 内に追記必須
- **工数見積もり**: 「中 (半日)」は楽観的、 既存 402 件 test の 3-5 件更新 + welcome 5 件追加 + grep gate 2 箇所更新で **実 1.5 日**が現実、 6 commit 分割なら spread 可
- **公開不可判断**: 妥当。`?map=1` が default ではないが `bootCheckSetupStatus` の static mode 経路が `initMapMode()` を自動呼出 (= `viewer-maplibre.js:721-722`)、 訪問者は白紙どころか「勝手に走り出す ride」を見る。harm 軽減ではなく harm 増幅、 push 認可禁止は正しい

---

## verdict

**BLOCK** (= 軸 1 / 4 / 5)、 公開不可判定は妥当だが phase-design 自体が test 設計と URL 経路の優先順位を曖昧にしているため、 brief 化前に上記 3 BLOCK の解像度を上げる必要あり。welcome を「新規 overlay + state-welcome class + 6 commit 分割 + grep gate 更新」の structural pattern (= brief 31 と同じ) に組み直せば実装可能、 工数 1.5 日。
