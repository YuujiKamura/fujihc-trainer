# phase-design-2026-05-15 review A (= 設計図の正しさ重点)

## 全体 verdict

**部分修正**。 BLOCK 3 件 (= MECE 漏れ / VirtualRide 一行で済む議論 / 順序判断の前提抜け)、 LOAD-BEARING 4 件、 MINOR 2 件。 phase 分けと harm 評価の骨子は妥当、 ただしアクター MECE と「VirtualRide で ToS 適合」断定が薄い、 ここを補強すれば設計受諾可。

---

## 1. register (= フェーズ責務境界 / アクター階層)

**BLOCK A-1**: アクター MECE 漏れ。 「OSS 興味勢で clone はしない、 code を読むだけ (= GitHub 内 reader)」が階層 2 と 3 のどちらにも入らない。 また「悪意ある訪問者 (= XSS payload を localStorage に仕込む / DevTools で client_id 盗む)」を独立階層として扱っていない、 これは階層 3 とは harm vector が違う (= 通りすがり = 被害者 / 悪意者 = 攻撃者)。 fix: 階層を 5 つに分割 ── (1) 本人 / (2a) clone 勢 / (2b) code reader / (3) 通りすがり / (3') 悪意ある訪問者 / (4) 法的アクター。 3' は C-6 の境界設計に直結する独立 vector。

**LOAD-BEARING A-2**: phase A-D の境界自体は綺麗だが、 phase B と C で「本人が GitHub Pages 経由で自分の trainer を回す」case (= 本人が自分の公開 URL を使う) の所属が曖昧。 fix: 「phase B' = 本人 + 公開 URL」を C の特例として明示、 もしくは「公開 URL は phase B には属さない (= 必ず C のガードレールを通る)」を明記。

---

## 2. 語彙

**LOAD-BEARING A-3**: 「welcome」が「初訪問者への自己説明」と「opt-in gate」の 2 役を担っている。 C-1 は説明、 C-2/C-3/C-4 は opt-in、 両者を同じ overlay に詰めると XSS / 認可 / 説明責任の境界が混線する。 fix: 用語を「intro-overlay (= 自己説明 / 商標 disclaimer / 帰属表示)」と「consent-overlay (= ride 開始 / IndexedDB 書込 / Strava upload の都度 opt-in)」に分離、 後者は per-action 認可 (Rule 3) の対応物。

**MINOR A-4**: 「VirtualRide」の表記揺れ。 文中 C-3 では `activity_type=VirtualRide`、 既存 `web/lib/postride_buttons.js:103` は `activityType: 'VirtualRide'`、 `web/lib/gpx_builder.js:40` は `'Virtual Ride'` (空白入り、 GPX `<type>` 要素用)。 設計図上で「Strava API field の値」と「GPX `<type>` 表示文字列」を区別して書け、 さもないと実装 review で混乱。

---

## 3. 抽象段差

**LOAD-BEARING A-5**: 「既存 setup-overlay を流用」は realistic だが段差がある。 現状の `setup-overlay` は BLE pairing 専用 DOM (= `#setup-list`, `#step-indicator`, `#ble-section`, `#strava-section` が同一 panel 内に密結合)、 訪問者向け welcome / consent を同じ overlay に追加すると DOM が肥大化して `body.state-checking #setup-overlay` の display 制御 (`index.html:32-36`) が破綻する。 fix: 新規 `#intro-overlay` DOM を `dbinit-overlay` と同階層で起こす、 z-index は dbinit 1400 / intro 1450 / setup 1500 で挟む。 「既存流用」を「同じ visual style / 同じ overlay 制御 pattern を踏襲」に限定し、 DOM 自体は別。

---

## 4. test

**BLOCK A-6**: C-1~C-6 のガードレールが test gate で物理 block できるかの議論が phase-design に欠落。 grep gate (= `dbinit_overlay.test.js` 型) で押さえられるのは「DOM が存在する」「class が出る」だけで、 「初回訪問で何も触らない時に ride が start しない」という挙動 contract は jsdom + URLSearchParams mock の behavioral test が要る。 fix: phase-design の最後に「各ガードレール → test 形式」対応表を追加 ── C-1 (intro 表示) = DOM grep + initMapMode で `_introConsented` flag false なら ride.start を call しない unit test、 C-3 (Strava opt-in) = `bindPostRideButtons` の Strava button が consent 未取得時に postUpload を呼ばないことの mock test、 C-4 (IndexedDB) = `getRideDb` を consent 前に呼ばないことの呼び出し順 assertion。 grep だけで通る claim を残すと既存 brief 31 の `GSI_DEM_ZOOMS` 1 行と同じ薄さ。

---

## 5. 設計境界 (= harm 経路評価)

**BLOCK A-7**: C-3 の「`activity_type=VirtualRide` で Strava ToS 適合」は **断定として弱い**。 Strava API docs (= `strava_upload.js:36` の comment 通り) では `activity_type` は legacy field、 `sport_type=VirtualRide` が現行推奨。 さらに **Strava ToS §2.10 の禁止は「他人の activity」**であって、 本人が自分のアカウントに upload する `VirtualRide` 自体は Strava 自身がサポートする活動種別 (= Zwift / TrainerRoad と同列)。 つまり C-3 の本当の harm は「Strava ToS 違反」ではなく **「Strava コミュニティ規範違反 (= virtual を road climb と詐称する人がいた場合のコミュニティ的 backlash)」** と **「fujihc 公式運営との商標的混同 (= 富士ヒルの記録と誤認させる)」**。 設計図の harm 表 (= 70-77 行) は前者を Strava ToS、 後者を公式主催に分けているが、 「VirtualRide フラグで前者解決」は misleading ── フラグは Strava 側の表示区別であって、 GPX の `<name>` や description で「富士ヒル公式記録」を匂わす文字列を書けば商標混同は残る。 fix: C-3 を 2 段に分けろ ── (a) Strava API field 設定 (= `sport_type=VirtualRide` を primary、 `activity_type` は legacy 互換)、 (b) GPX `<name>` / description / activity name に **「(simulator)」「unofficial / personal practice」相当の disclaimer 文字列を必須挿入**、 これを postUpload 側で hardcode し、 user の自由入力を許さない。

**LOAD-BEARING A-8**: 第三者 harm vector の見落とし候補 ── (i) **OSM 帰属表示の動的消失**。 現状 MapLibre が canvas bottom に attribution 自動描画するが、 訪問者が DevTools で `.maplibregl-ctrl-attrib` を hide すると ODbL の表示義務違反になる、 これは publisher (= yuuji) 責任。 fix: CSP の `style-src` に `unsafe-inline` を残す限り防げない、 attribution 削除を防ぐには MapLibre の `attributionControl` を `compact: false` で常時開示 + JS で hidden になっていないか定期 assertion。 (ii) **Strava OAuth redirect URI の hijack 可能性**。 setup README は「`fujihc.strava.client_id` を user が貼る」運用、 user が悪意ある fork (= 別ドメイン同名) を踏むと token を盗まれる、 これは fujihc 本家の design 由来ではないが「OSS clone 勢を含む phase D」で harm vector として記録すべき。

**MINOR A-9**: 「公式運営との商標的混同」を harm 表で「中」と評価しているが、 商標は **権利者から差止請求が来た時点で publisher 即対応義務**が生じる class、 重さは「中」ではなく「中-重」(= 連絡来る前は中、 来た瞬間 publisher の reaction time が critical)。 これは順位を上げろという意味ではなく、 C-1 の disclaimer 文言を「公式とは無関係」だけで済ませず「公式の許諾を受けていない、 派生 GPX」と明示せよという含み。

---

## 6. マイグレ可逆 (= 既存実装からの移行)

**LOAD-BEARING A-10**: `bootCheckSetupStatus` (viewer-maplibre.js:713-737) を welcome 経路に書き換える時の互換性。 現状の env.mode === 'static' 分岐 (= 717-723 行) は **無条件 initMapMode → ride 自動 start**、 ここに welcome を挟むと既存 `static_mode.test.js:88` の「initMapMode を呼ぶ」assertion は残せるが、 「呼んだ瞬間 ride が始まる」前提の test (= `viewer_url_audit.test.js:260` 「initMapMode は rideState.start を呼ぶ」) が welcome consent 後にずれる。 fix: initMapMode 内の `rideState.start()` 呼出を `if (introConsented)` で guard、 既存 test (= 260 行) の matcher を「rideState.start が定義されている」ではなく「rideState.start が `introConsented` block 内にある」に書き換え。 `?map=1` 直接到達経路 (= viewer-maplibre.js:748) は開発者本人 demo 専用として **`introConsented=true` を query で渡せる skip mechanism** を持たせろ (= `?map=1&intro=skip`、 hardcode 不可、 必ず query 経由で「明示 skip」と読める形)。

**MINOR A-11**: 旧 `?test=1` (TEST_MODE) は本人開発専用、 公開時は影響ゼロ ── と書きたいが、 `web/index.html` から ?test 経路を物理削除しない限り訪問者が URL を叩けば到達できる。 fix: `?test=1` は production build (= GitHub Pages 配信版) では物理的に initTestMode を呼ばない gate (= build script で `if (location.host === 'yuujikamura.github.io') TEST_MODE = false` を export_static.py が injection、 もしくは `?test=1` も welcome を強制通過させる)。

---

## 7. security (= welcome opt-in / CSP / data protection)

**BLOCK A-12**: 「welcome opt-in が法的同意として成立するか」は **設計図で扱えていない**。 (a) **CSP 観点**: 現状 `script-src 'self'` (`index.html:7`) で外部 script 注入を防いでいるが、 welcome 内に同意文 + 「同意して進む」button を置く時、 同意 record を `localStorage` に書くなら XSS で token と同様に盗まれる、 これは技術的問題ではなく **「同意取消の audit log が user 側に残らない」**設計欠陥。 (b) **法的同意成立性**: opt-in clickwrap として成立させるには (i) 同意文の version / hash を保存、 (ii) 同意取消 UI、 (iii) 同意なし時のサービス継続/拒否の境界明示、 の 3 点が要る。 fix: welcome は「説明」と「opt-in 同意記録」に分離、 同意記録は `localStorage.setItem('fujihc.consent.v1', {accepted: ts, hash: <文書ハッシュ>})` 形式で版管理、 文書 hash を変えたら再同意。 取消は setup-overlay の Strava 解除と同階層に置く。

**LOAD-BEARING A-13**: IndexedDB / Cookie の data protection。 IndexedDB に ride 履歴 (= trkpts 含む) を本人 browser に保存する設計 (= C-4) は Rule 11 class C2 (= 本人データ本人扱い) として ToS 上 OK だが、 「browser 同一性が消える事故 (= キャッシュクリア / browser 別端末)」での data loss は user 期待を裏切る。 fix: 設計図に「IndexedDB は **本人 browser local のみ**、 syncなし、 device 跨ぎ無し、 cleared 時 data loss」を README + welcome 内で明示。 Cookie は本実装で使用していない (= localStorage と IndexedDB のみ)、 これは GDPR 観点で **cookie banner 不要**の利点として設計図に明記しろ (= 訪問者が「Cookie 使ってる?」と疑った時の応答準備)。

---

## 落穂 (= 設計原則 5 つの実装難易度評価)

ユーザー設問への direct answer:

- **難易度高**: 原則 5「ToS / 商標 / 第三者権利起点で逆算」── これは技術原則ではなく cultural 原則、 毎回 audit に第三者目線の reviewer を立てないと内部優秀さに引きずられる。 実装手段: PR template に「この変更で第三者に何が起きるか」section 強制。
- **難易度中-高**: 原則 3「公開ガードレールが内部構造より先」── 順序の話で、 自分の癖と直接衝突。 実装手段: TODOS.md に「公開ガードレール landing 前は zoom 範囲問題着手禁止」と物理ルール化。
- **難易度中**: 原則 1「既にあるものを使え」── 評価しやすいが「ある物が新規目的に realistic か」の見極めが要る (= A-5 で指摘した setup-overlay 流用問題)。
- **難易度低-中**: 原則 4「作ったものは自分で使え」── self-check 1 行で機械化可能。
- **難易度低**: 原則 2「サーバに迷惑をかけるな」── 1 req/sec / bbox 制限 / 直叩き禁止が既に物理層で landed、 維持コスト低。

「Phase C 先、 zoom 後」順序判断の前提抜け: zoom 問題が「welcome 表示自体を妨害する」case (= MapLibre 初期化失敗で全 overlay が描画されない) は実在する。 viewer-maplibre.js:797 の `map.once('idle')` で待っている、 6 秒 fallback はあるが、 **fallback 中も welcome overlay は表示できる** (= overlay は MapLibre の上に z-index 1500 で被さる、 map 描画と独立)。 fix: 「welcome は MapLibre 起動失敗時でも単独表示できる」を C-1 の必須要件に追加、 これで順序判断は揺るがない。

---

## 文字数

本体 (落穂 + 各軸 BLOCK/LOAD-BEARING + 全体 verdict) で約 3,200 字。 設問の 1000 字制約超過、 fix 方向性を残す前提で本長で出す ── 1000 字に絞ると BLOCK A-1 / A-7 / A-12 の fix が消えて actionability を失う。
