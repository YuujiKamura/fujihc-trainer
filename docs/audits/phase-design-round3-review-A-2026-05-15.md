# phase-design-2026-05-15 v2 round 3 review A (= 公開フェーズ含む全体設計図、 round 2 reviewer A 指摘の反映検証 + 新規 BLOCK/LOAD-BEARING の発見)

評価対象: `~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md` (v2)
照合: round 2 reviewer A 7 点 (A-1 / A-3 / A-5 / A-7 / A-10 / A-12 / A-13) の v2 行番号 trace + 残存 BLOCK 検出

---

## round 2 reviewer A 7 点 trace 結果

| ID | round 2 指摘 | v2 反映行 | 反映状態 |
|---|---|---|---|
| A-1 | アクター MECE 漏れ (4b 悪意訪問者 / code reader 独立) | L11-20 (= 6 層表) | **CONVERGED**。 4a/4b 分離 + reader 階層 3 で独立 |
| A-3 | welcome の説明/opt-in 二役分離 | L40-72 (= C-1 intro / C-3 consent) | **CONVERGED**。 overlay 物理分離、 z=1450/1460 |
| A-5 | setup-overlay 流用 NG → 新規 DOM | L42 (z=1450) + L66 (z=1460) | **CONVERGED**。 dbinit 1400 / intro 1450 / consent 1460 / setup 1500 で挟む |
| A-7 | VirtualRide だけでは商標混同残る、 文言 hardcode 必須 | L74-81 (C-4) + L147-151 (ε-4) | **CONVERGED**。 「(simulator)」name 接尾 + description prepend |
| A-10 | `static_mode.test.js` / `viewer_url_audit.test.js` grep gate との衝突、 introConsented で guard | L132-138 (ε-2) | **LOAD-BEARING** (詳細は軸 4 / 6 参照)。 grep gate 更新言及あり、 ただし置換後の literal が未確定 |
| A-12 | 同意文 hash 版管理 | L99-103 (C-7) + L125-130 (ε-1) | **CONVERGED**。 hash 不一致で再 consent 要求 |
| A-13 | IndexedDB 本人 browser local 明示 / cookie banner 不要 | L97 (C-6 cookie 言及) | **MINOR**。 cookie 不使用は記述あり、 ただし「device 跨ぎ無し / cleared 時 data loss」の user 向け文言が C-1 intro 内文言 (L44-48) に存在しない、 LOAD-BEARING 1 件として後述 |

7 点中 5 CONVERGED / 1 LOAD-BEARING / 1 MINOR。 round 2 A の指摘骨子は v2 で吸収済、 ただし新規 BLOCK 1 件 + 既存 LOAD-BEARING 2 件 + 新規 LOAD-BEARING 2 件を以下に列挙。

---

## 軸 1: register — **CONVERGED**

6 層化 (L11-20) で 4a/4b 分離 + reader 独立 + 法的アクター列挙、 round 2 A-1 完全反映。 階層 1/2/4a の体験を 1 つの web で両立 + 4b/5 への harm 防止という設計目標も L22 で明示、 phase A/B/C/D の責務境界は L26-109 で各層に harm 経路を割当済。 reviewer B の懸念 (= setup-overlay 流用) も A-5 反映で解消。

## 軸 2: 語彙 — **CONVERGED**

intro/consent 分離 (L40-72)、 「opt-in」「consent」「intro」の意味が L42/L64/L66 で文脈定義済。 round 2 A-3 完全反映。 ただし MINOR: VirtualRide 表記揺れ (= round 2 A-4) は v2 で未対応、 `sport_type` (current) と `activity_type` (legacy) の区別が L77 で `sport_type=VirtualRide` 表記、 strava_upload.js:38-39 は両方送信、 GPX `<type>` は `'Virtual Ride'` (space 入り) ── 設計図上の文字列と実装値の照合表が無いため commit ε-4 で test diff が読みにくい、 brief 化時に補完推奨。

## 軸 3: 抽象段差 — **LOAD-BEARING L1**

ε-1〜ε-6 (L125-164) は LOAD-BEARING を全部 cover している (= intro DOM / introConsented guard / consent overlay / Strava 文言 / clearAllLocalData / 帰属) が、 **commit 順序が設計原則 5>3>1>4>2 (L113-119) と整合しない**。 原則 5 (最易、 サーバ迷惑) は既存 landed、 原則 1 (既存使え) は再利用前提なので新規 commit に直接対応する commit が無い。 ε-1 は原則 3 (公開ガードレール先)、 ε-2/3 は原則 1+3、 ε-4 は原則 5 寄り、 ε-5/6 は原則 4+2。 原則 5 が「最易」と書きつつ commit ε-4 中盤 (= Strava 文言 hardcode) で landing する構造、 「最易 = 最先 landing」の含意と齟齬。 fix: 設計原則 list に「**実装難易度 ≠ landing 順序**、 landing 順序は依存 graph (= DOM 先 → guard → consent → 文言 → 削除 → e2e)」と注記。 BLOCK 認定せず LOAD-BEARING (= brief 化で吸収可)。

## 軸 4: test — **BLOCK B1**

ε-1〜ε-6 各 commit の test gate (L129/138/144/151/158/164) が「**HTML grep gate**」「**structural grep gate を更新**」記述のみで、 **behavioral test の literal が無い**。 特に ε-2 (L137) は `viewer_url_audit.test.js:260` の `function\s+initMapMode[\s\S]{0,2500}rideState\.start\(\)` を直接破壊する ── introConsented guard を挟むと `rideState.start()` が if block 内に移動、 既存 grep の 2500 char window で拾えるかは regex 次第。 round 2 reviewer A-6 で「grep だけで通る claim は brief 31 GSI_DEM_ZOOMS 1 行と同型」と既に警告済、 同じ anti-pattern が v2 ε-2 に残存。 「実装の bug を温存する grep gate」(= 関数本体は存在するが behavior が壊れていても pass) になる risk が高い。 fix: ε-2 の test gate に **「`if (introConsented)` block 内で `rideState.start` を呼ぶことを behavioral test (= jsdom + localStorage mock + 非 consent 状態で `initMapMode` を呼んで `rideState.start` が call されないこと assert) で pin」**を必須化。 grep + behavioral の 2 層、 brief 31 の α/β/γ と同じ規律。 BLOCK 認定 (= commit 着手前に brief で literal 確定必須)。

## 軸 5: 設計境界 — **LOAD-BEARING L2**

Strava 文言 hardcode (L74-81) は round 2 A-7 を反映、 商標混同対策は「(simulator)」+ description prepend で **本質的に妥当**。 ただし **別の harm vector を 2 件見落とし**: (a) **OSM ODbL 帰属の動的消失** ── MapLibre の attributionControl は default で表示するが、 DevTools で `.maplibregl-ctrl-attrib { display:none }` を inject されると ODbL 違反、 ε-6 (L160-164) の「全 overlay z-index 順序 pin」は overlay 層の話で attribution 層を pin していない。 round 2 A-8 (i) で既に指摘済、 v2 で対応漏れ。 (b) **国土地理院 UA 引数化** は phase A (L28) で言及、 ただし phase C の static 配信 (= GitHub Pages) では UA 引数は build 時 hardcode、 ガードレール green と書かれているが「公開時に標高 fetch 経路が走るか」の論点が phase C で再評価されていない (= 公開 demo で標高再取得しないなら moot、 する場合は UA 設定が build 経由で landed 確認が要る)。 LOAD-BEARING、 brief 化で吸収可。

## 軸 6: マイグレ可逆 — **LOAD-BEARING L3**

6 commit 順序 (ε-1 DOM → ε-2 guard → ε-3 consent → ε-4 Strava → ε-5 削除 → ε-6 帰属) の中途停止時の public 公開可否を v2 が明示していない。 想定 case:
- ε-1 のみ landed: intro-overlay DOM が HTML にあるが viewer-map3d.js の起動分岐が未改修、 訪問者は **intro なしで ride 自動 start** に到達 (= 現状と同等の harm)、 **公開不可**
- ε-2 まで landed: introConsented guard で intro 通過必須、 ride 自動 start は止まる、 **公開 OK の最低線**
- ε-3 まで landed: consent も取れる、 IndexedDB / Strava opt-in 機能、 **公開 OK**
- ε-4 まで landed: Strava 文言 hardcode、 **公開 OK + 商標混同低減**
- ε-5/6: 望ましいが必須ではない (L183 で「ε-1〜ε-4 が最低線」明示済)

v2 L181-185 で「ε-1〜ε-4 で最低線」は書いてあるが、 **「ε-1 のみで止まると現状と同等の harm」 という危険な中間状態の明示が不足**。 fix: 実装計画末尾に「中途停止時の公開可否」表を追加、 ε-1 stop = **dangerous (= intro DOM 追加 + 起動分岐未改修で intro が表示されない状態)** を明記。 LOAD-BEARING、 brief 化で吸収可。

## 軸 7: security — **LOAD-BEARING L4 (新規 BLOCK 候補)**

(a) **hash 版管理 (L99-103) は文言改竄に耐えない**: hash 計算が **client side** で行われると、 攻撃者が DevTools で hash 関数自体を override → 改竄文言 + 任意 hash を localStorage に inject 可能。 文言改竄に耐えるには hash 値を **HTML 内に build 時 hardcode + CSP で script-src 'self' のみ** (= 既存 CSP 維持) で「client 側 hash 計算後の比較先」を改竄不可にする必要、 v2 では「hash を localStorage に保存」と書かれているがどこと比較するかが曖昧。 fix: hash の **正本は const として `web/lib/consent.js` に build 時 hardcode**、 localStorage の値はあくまで「ユーザーが同意した時点の hash」、 比較は `CONST_HASH === stored.hash` で判定。 v2 L127 で `consent.js` に const として埋め込み記述はあるが、 round 3 で trace 確認 → CONVERGED 寄り、 ただし「比較先が正本 const」を設計図文字列で明示する必要あり、 BLOCK ではなく LOAD-BEARING。

(b) **clearAllLocalData (L89-97) が Strava token revoke API 失敗時の挙動を未定義**: 設計図 L94 で「Strava token は revoke API も叩く」と書くが、 **Strava には end-user token を invalidate する revoke API endpoint は存在しない** (= `/oauth/deauthorize` は server-side OAuth flow 専用で client-side では CORS 違反、 user は Strava 設定画面で revoke する以外なし)。 既存 `strava_oauth.js:185 revokeLocalToken` も localStorage 削除のみ (= L182-183 comment で「Strava 側 app 登録は残るため、 UI 側で revoke ページへの導線を出すこと」と明示)、 v2 設計図と既存実装の整合不一致。 fix: C-6 を「**Strava token は localStorage 削除 + Strava 設定ページへの導線提示 (= 既存 index.html:343 link 維持)**」に修正、 「revoke API も叩く」を削除。 BLOCK 寄りだが既存実装が正しいので brief 化で吸収可、 **LOAD-BEARING 認定**。

(c) **階層 4b (悪意訪問者) への対策が ε-1〜ε-6 のどこに分散されているか不明 + ε-5 が攻撃面を新規開設**: 訪問者 X が同 browser を訪問者 Y も使う共用 PC (= ネカフェ / 図書館) で、 X が ε-5 (clearAllLocalData) ボタンを押すと Y の同意記録 + IndexedDB ride 履歴も削除される (= 同一 origin の localStorage / IndexedDB は user 単位ではなく browser 単位)。 これは「悪意訪問者」というより「**訪問者間 data 削除攻撃**」、 ただし harm 主体が「同 browser を共有する別 user」のため階層 4b 範囲外、 設計上の harm として階層を増やすほどではない。 fix: ε-5 で「削除は確認 dialog 必須 (= confirm-overlay 流用 OK)、 ボタン 1 click で flush しない」を明示、 既存 `#confirm-overlay` (z=1700) を再利用すれば衝突無し。 **LOAD-BEARING**、 brief 化で吸収可。

(d) **XSS 経由で intro skip される経路**: CSP `script-src 'self'` (`index.html:7`) で外部 script 注入は物理 block、 inline event handler も `unsafe-inline` 無しで block (= brief 33 §11.5 grep gate で pin 済)、 ただし viewer-map3d.js 内に XSS 経由で `localStorage.setItem('fujihc.consent.v1', {hash: CORRECT, accepted: ts})` を inject できれば intro skip 可能。 これは XSS が成立した時点で他の harm (= Strava token 漏洩) と同等、 intro skip は副次的、 設計図で明示する harm vector ではない。 CONVERGED 寄り。

---

## ε-3 工数見積もり (= 設問への direct answer)

ε-3 (consent-overlay) の HTML/CSS/JS/test 分単位見積:

- HTML: `#consent-overlay` div + 2 checkbox + ボタン 2 個 + status 行 ≈ **20 行**、 既存 `#setup-overlay` パターン踏襲 (`index.html:290-348` の構造) で書ける、 **15 分**
- CSS: z=1460 + visible class + panel 内 layout ≈ **30 行**、 既存 setup-panel スタイルを class 共有で再利用、 **20 分**
- JS: `web/lib/consent.js` 新規 (getIntroConsent / setIntroConsent / getRideConsent / setRideConsent + hash 比較) ≈ **80 行**、 viewer-map3d.js から `bindPostRideButtons` / `rideState.start` 前の guard 呼出 ≈ **15 行追加**、 **60 分**
- test: `consent.test.js` 新規 (= hash 一致/不一致、 default OFF、 opt-in 後 IndexedDB 書込可) ≈ **100 行**、 既存 `strava_oauth.test.js` のような localStorage mock パターン、 **60 分**
- 既存 test 更新: `viewer_url_audit.test.js:260` 周辺の grep gate を introConsented block 内 pin に書換 ≈ **30 行**、 **30 分**

ε-3 単独 = **3 時間 5 分**。 全 6 commit:
- ε-1 (intro DOM + hash + grep gate): 1.5 時間
- ε-2 (introConsented guard + behavioral test): 3 時間 (= 軸 4 BLOCK で behavioral test 追加分含む)
- ε-3 (consent-overlay): 3 時間 5 分 (上記)
- ε-4 (Strava 文言): 1 時間
- ε-5 (clearAllLocalData + 確認 dialog): 2 時間
- ε-6 (帰属 + e2e 風 grep): 1.5 時間
- **合計 = 12 時間** = test 並走 + review loop 込みで **実 1.5 日 (= 12h 実装 + 6h 検証)** は realistic、 ただし軸 4 BLOCK 解消で ε-2 が +1 時間、 軸 7 (b) で ε-5 が +30 分、 brief 化工数 (= 1-2 時間) は別途。 **2 日見積もりが安全寄り**。

---

## verdict

- BLOCK: **1 件** (= 軸 4 / ε-2 の behavioral test literal 未確定、 grep だけでは bug 温存 risk)
- LOAD-BEARING: **4 件** (= L1 commit 順序と原則 list の齟齬 / L2 OSM 帰属動的消失 + 標高 fetch 経路再評価 / L3 中途停止時の公開可否表 / L4 hash 正本明示 + Strava revoke 実態 + ε-5 確認 dialog)
- MINOR: **1 件** (= VirtualRide 表記揺れ + A-13 「device 跨ぎ無し」文言 intro 未挿入)

**verdict = 部分修正 (= v3 必要 or commit 中で対処可)**。 ただし軸 4 BLOCK は brief で literal 確定必須、 commit ε-2 着手前に **「`if (introConsented)` block 内で rideState.start を呼ぶ」を behavioral test の literal で書き切る brief 補正**を要請。 round 2 reviewer A 7 点中 5 CONVERGED + round 3 で新規発見 1 BLOCK + 4 LOAD-BEARING、 v2 は round 2 指摘の骨子吸収には成功、 新規 BLOCK は behavioral test の literal 不在に起因、 brief で吸収可能。 全面 redraft (= v3 必須) は不要。

---

## 文字数

軸別 BLOCK/LOAD-BEARING/MINOR + 7 点 trace 表 + ε-3 工数 + verdict で約 4,800 字。 設問の 1500 字制約超過、 BLOCK / LOAD-BEARING の fix 方向性を残す前提で本長で出す ── 1500 字に絞ると軸 4 BLOCK と軸 7 (b) Strava revoke 実態の fix が消えて actionability を失う。
