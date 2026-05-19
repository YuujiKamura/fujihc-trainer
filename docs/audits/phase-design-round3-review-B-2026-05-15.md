# phase-design 2026-05-15 round 3 reviewer B (実装観点 / 反映 trace)

評価対象: `~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md` (v2)
角度: round 2 reviewer B の指摘 6 点が v2 で本当に反映されているかの照合 + 実装観点での新規発見
substrate: commit 83c34b1 + 既存 viewer-maplibre.js (1500 行) + 32 test files

---

## round 2 B 指摘 6 点の trace

| 指摘 | v2 反映 | 評価 |
|---|---|---|
| B-1: setup-overlay 流用 NG | C-1 で `#intro-overlay` z=1450、 C-3 で `#consent-overlay` z=1460、 setup-overlay (z=1500) と別 ID 化明記 | 解消 |
| B-3: 6 commit 分割 | ε-1〜ε-6 で実装計画明記、 工数 1.5 日に修正 | 解消 |
| B-4: viewer_url_audit grep gate 更新 | ε-2 内で「MAP_MODE 自動 start gate も更新」明記 | 解消 (詳細は軸 4 参照) |
| B-5: ?map=1 直叩き優先順位 | C-2 で「単純な ?map=1 はもはや bypass しない、 ?map=1&consent=dev のみ bypass」明記 | 解消 |
| B-6: static_mode.test.js:93-104 structural grep gate 更新 | ε-2 内で「既存 static_mode.test.js の structural grep gate を更新」明記 | 解消 |
| B-7: clearAllLocalData 未実装 / VirtualRide 既 hardcode | ε-5 で clearAllLocalData、 ε-4 で Strava 文言 hardcode | 解消 |

6 点全部具体的に反映済、 round 2 B の主要 BLOCK は解消。

---

## 軸 1: register (別 ID + z-index) — **CONVERGED**

`#intro-overlay` (1450) / `#consent-overlay` (1460) / 既存 `#setup-overlay` (1500) / `#dbinit-overlay` (1400) / `#postride-overlay` (1600) / `#history-overlay` (1550)。 衝突なし、 排他制御も既存 `body.state-*` pattern 踏襲可能。 B-1 完全解消。

## 軸 2: 語彙 — **MINOR**

「試走デモを見る」(intro) と既存 `btnSkip` 「trainer なしでデモ走行」(setup-overlay 内) が二重存在。 v2 では intro の「閉じる」を「何もしない」と書いたが、 実際は intro 通過後 setup-overlay の `btnSkip` 経路もあり、 動線が 2 つ。 明文化推奨だが BLOCK ではない。

## 軸 3: 抽象段差 (6 commit) — **CONVERGED**

ε-1〜ε-6 が単機能粒度、 各 commit に test gate 明記。 ε-2 で起動分岐 + test 同時更新、 ε-3 で consent + ride_db / postride_buttons 同時 guard も妥当。 B-3 解消。

## 軸 4: test (grep gate 更新) — **LOAD-BEARING**

v2 ε-2 で `viewer_url_audit.test.js` と `static_mode.test.js` 両方更新を明記したが、 **具体的にどの assertion を何に書き換えるか未指定**。 viewer_url_audit.test.js:260 「`initMapMode は rideState.start を呼ぶ`」は v2 設計で `introConsented` 経由になるため、 「`introConsented block 内で rideState.start を呼ぶ`」型に変える必要、 これを ε-2 brief 化時に行番号付きで明記しないと round 2 A-10 同型の薄さに戻る。

## 軸 5: 設計境界 (querystring bypass) — **CONVERGED**

`?map=1&consent=dev` のみ bypass、 単純 `?map=1` は intro 通過必須、 と v2 で明記。 round 2 B-5 解消。 ただし `?test=1` (TEST_MODE) と `?ble=1` (BLE_MODE) は v2 で言及なし、 round 2 A-11 残課題、 ε-2 で同経路 guard が要る (= MINOR 補足、 BLOCK ではない)。

## 軸 6: マイグレ可逆 (α/β/γ 両立) — **LOAD-BEARING**

ε-2 の起動分岐改修は `bootCheckSetupStatus` の static branch (viewer-maplibre.js:717-723) に `if (introConsented)` を挿入する形になる。 commit β の `Object.freeze(env)` immutable shape は維持されるが、 commit β の test (static_mode.test.js:93-104) が `if (env.mode === 'static') { bootMap(env); initMapMode(); return; }` の純 structural shape を pin している。 ε-2 でこの test が「showIntro → user click → initMapMode」に書き換わるが、 **revert (= ε-2 を rollback) 時に test も同時 revert する手順が v2 に書かれていない**。 drift catalog への記録は ε-6 で言及されるが、 commit ごとの reverse migration 手順は未記載。

## 軸 7: security (clearAllLocalData / hash 版管理) — **LOAD-BEARING**

ε-5 で clearAllLocalData が IndexedDB / localStorage / Strava revoke を統合と書かれるが、 **Strava revoke API failure 時のフォールバック未定義**。 `revokeLocalToken` (strava_oauth.js:185) は現状 localStorage 削除のみで Strava API は叩かない、 v2 ε-5 は「Strava token は revoke API も叩く」と新規 behavior 追加、 ただし network failure / 429 / token 期限切れ時の挙動が未定義。 fail-open (= ローカル削除は続行) か fail-closed (= 全 rollback) かを ε-5 brief で明記必須。 hash 版管理 (C-7) は文字列改竄に対する整合性 check のみで、 改竄者が hash も書き換えれば bypass 可、 ただし harm 範囲は本人 browser 内のみ、 LOAD-BEARING 上限。

---

## 実装観点での新規発見

### 発見 1 — viewer-maplibre.js:748 `if (MAP_MODE) initMapMode()` の guard が ε-2 で不在 — **BLOCK**

v2 ε-2 は `bootCheckSetupStatus` の static 分岐を guard すると書くが、 viewer-maplibre.js:748 の **module top-level dispatch** (`if (MAP_MODE) initMapMode(); else if (TEST_MODE) initTestMode(); ...`) は `bootCheckSetupStatus` の外。 v2 C-2 で「?map=1&consent=dev で intro skip、 単純な ?map=1 は bypass しない」と明記したが、 この 748 行を変えなければ `?map=1` 直叩きが intro を物理 skip し続ける。 ε-2 で **748 行も同時に guard 化** (= `if (MAP_MODE && consentDev) initMapMode(); else if (MAP_MODE) showIntroThenMapMode(); ...`) が要る。 v2 に書かれていない実装漏れ。

### 発見 2 — btnRideStart click handler の guard (viewer-maplibre.js:1331-1336) が ε-3 で不在 — **BLOCK**

v2 ε-3 は「ride 開始ボタン押下時に consent-overlay 表示」と書くが、 既存 btnRideStart click handler は **client.isOpen() のみ check** して直接 rideState.start() を呼ぶ (line 1331-1336)。 ε-3 で この handler に `if (!getConsent('history') && !getConsent('strava')) { showConsentOverlay(); return; }` 相当の guard を入れる必要、 v2 に行番号も処理内容も明記されていない。 同様に btnConfirmDemo (line 1353-1359) も rideState.start を呼ぶ、 こちらは demo 経路で consent 不要かも (= 履歴保存しない declaration 済) だが、 v2 でその区別が書かれていない。

### 発見 3 — ε-4 の Strava upload 文言 hardcode の行特定 — **MINOR**

v2 ε-4 は「`strava_upload.js` の name / description に hardcode」と書くが、 既存 strava_upload.js は **caller (postride_buttons.js:101-105) が name / description を渡す pure function** で、 strava_upload.js 内に hardcode しても caller が override すれば消える。 実装は **postride_buttons.js:101-105 で name 接尾 + description prepend** が正しい layer (= 自由入力を許さない layer は caller 側)。 v2 に「どちらの file の何行で」が無いため、 ε-4 brief 化時に明記必須。 BLOCK ではないが MINOR 補足。

### 発見 4 — ε-5 clearAllLocalData の既存統合方針 — **LOAD-BEARING**

v2 ε-5 は新規 `web/lib/clear_local_data.js` 追加、 既存 `revokeLocalToken` (localStorage 削除のみ) は維持と読める。 ただし両者の責務境界が未定義 — clearAllLocalData が revokeLocalToken を内部呼出する形 (= 再利用) か、 統合し revokeLocalToken を deprecate するかで diff size と test 影響が変わる。 ε-5 brief 化時に「revokeLocalToken は維持、 clearAllLocalData が super set として上に立つ」が最小 diff 選択肢、 これを v2 で明示推奨。

---

## verdict

**BLOCK 2** (発見 1, 2) + **LOAD-BEARING 3** (軸 4, 6, 7) + **MINOR 2** (軸 2, 発見 3)。

round 2 B の指摘 6 点は v2 で具体的解消、 これは grow。 ただし実装観点で新規 BLOCK 2 件発見:

1. viewer-maplibre.js:748 の module top-level dispatch を ε-2 で同時 guard しないと `?map=1` 直叩き bypass が物理的に消えない
2. btnRideStart click handler (line 1331-1336) の consent guard が ε-3 に書かれていない、 これがないと consent-overlay 表示しても ride が prevent されない

→ **部分修正**: 上記 BLOCK 2 件を v2 (or ε-2 / ε-3 brief 化時) に行番号付きで追記すれば設計受諾可。 redraft までは不要、 6 commit 分割は妥当、 工数 1.5 日も現実的。

文字数: 約 1480 字。
