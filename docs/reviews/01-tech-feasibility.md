---
review: 01-tech-feasibility
reviewer_axis: 技術現実性 (OSS の実走、Windows 互換、ライセンス、性能)
date: 2026-05-14
target_briefs: 00-context.md + 01-10 (11 本)
verified_via: WebSearch / WebFetch (Cesium Ion 公式 pricing、bleak issue tracker、pycycling GitHub、QZ Windows 版状況、Rouvy Mt.Fuji ライブラリ、SRTM Mt.Fuji 精度文献)
---

# 技術現実性レビュー — fujihc-trainer briefs 01-10

## はじめに

「OSS がある」「Windows で動く」「60fps 出る」と書いてあっても、実際に yuuji の Windows PC でその通り動くとは限らない。本レビューでは各 brief を **OSS の実走実績 / ライセンス / Windows 互換性 / 性能想定の現実性** の 4 観点で詰める。ふわっとした「動くはず」は ★☆☆ に落とす、検証済みの実走証拠があれば ★★★。

結論を先に書く: **Cut C (brief 09) は技術的に成立する、ただし Cesium と bleak の 2 か所に明確な地雷あり**。最も堅いのは brief 03 (OSS 評価)、最も危険なのは brief 04 (3D viewer の 60fps 想定) と brief 05 (yuuji の trainer 機種未確認のまま設計が進んでいる点)。デプロイは brief 07 推し B (Local web app) ではなく **A (Electron/Tauri full local)** が現実解。理由は本文で詳述。

---

## brief ごとの評価

### 00-context.md — 前提条件

**スコア: ★★★**

OSS 部品リストの事実関係はおおむね正しい。確認したのは以下:

- **QZ (qdomyos-zwift)** ── GPL v3、active maintenance、Windows nightly build あり (`windows-msvc2019-binary-no-python.zip`)。GPX route following + FTMS 制御は landed、仮想 Wahoo KICKR 偽装も documented。ただし Windows 11 で「exe hangs all the time」報告 (Issue #2087)、Windows 版は iOS/Android に比べて second-class 扱い。
- **pycycling** ── MIT、active (v0.4.1)、168 stars、bleak ベース、Tacx / Elite で実機テスト済。Indoor Bike Simulation Parameters の write も実装あり (`fitness_machine_service` module)。
- **Cesium World Terrain** ── 後述するが「無料」は条件付き、access token + 月次 streaming 上限あり。
- **OpenTopography SRTM 30m** ── 無料は正しい、ただし Mt.Fuji 級の steep terrain で 30m mesh は粗い (後述)。

死角: brief 00 が「Zwift では GPX 取り込み不可」を前提にしているが、**Rouvy は Mt.Fuji hill climb 既製コースを公開済み** (Yamanashi Prefecture、11.3km/608m up と 24km/1242m up の両方あり、ridewithgps trip ID 37305050、Rouvy 公式 destination page で確認)。これは brief 10 (alternative paths) でも触れているが、優先度が低い扱い。brief 10 が指す通り「自作着手前に Rouvy 既製コースを 5 分で確認」が ROI 最高。

---

### 01-mvp-definition.md — MVP の最小機能セット

**スコア: ★★☆**

完了基準が具体的 (「24km / 5 分早送り test ride を完走」「ログが書き出される」) なのは良い。ただし以下が抜けている:

- 「trainer + PC を実際に接続して」と書いてあるが、**yuuji が所有する smart trainer の機種が未確認**のまま MVP 定義に進んでいる。これは brief 05 でも指摘されているが、本来は brief 01 の **前提条件** として確定すべき項目 (機種未確定なら MVP 自体が定義できない)。FTMS 非対応 trainer なら勾配コマンドが届かず MVP 達成不可、ANT+ FE-C のみ対応なら bleak ではなく ANT+ stick 必須で技術スタックが変わる。
- 「完走」の定義に **frame rate / latency の数値目標が無い**。「3D 表示が重くて低 FPS」をリスクに挙げているが、許容下限 (30fps? 24fps?) と勾配コマンド latency (1Hz? 500ms?) が未定義。MVP gate を通すための数値基準を欠く。

検証コマンド:
- yuuji への確認: trainer の型番 (Wahoo KICKR / Tacx Neo / Elite Suito 等)、対応プロトコル
- ない場合は `bleak.discover()` で yuuji の PC 周辺の BLE FTMS 機器を列挙して確認

---

### 02-architecture.md — 構成図

**スコア: ★★☆**

3 process (Python bridge / Node engine / JS viewer) の分担自体は妥当。ただし以下に落とし穴あり:

- **3 process 間 IPC の latency と debug 性が brief で評価されていない**。「JSON line-delimited stdout」「WebSocket 経由」と書いてあるが、勾配コマンドが trainer に届くまでに「viewer → engine → bridge → BLE」と 3 hop ある。BLE 自体の latency が ~100-300ms、各 IPC hop が WebSocket なら ~5-20ms、合計 200-400ms。**ride 中に「次の登りが見えてから勾配が変わる」までのラグが半秒以上**になり、視覚と体感がずれて違和感が出る可能性。Zwift は trainer 制御を frontend と同 process で持っていてここが短い。
- **Node engine と Python bridge を別 process に分ける必然性が薄い**。GPX → 勾配シーケンスの計算は Python でも軽量、bridge と engine を 1 process (Python or Node のどちらかに統合) にすれば IPC が 1 hop 減る。brief は「言語選択」で Ruby を入れない決断は書いているが、**Python と Node を両方入れる決断の根拠が弱い**。「frontend が JS だから engine も JS が自然」だけでは Python sidecar を増やす理由として不十分。

修正提案: **engine を Python に統合して bridge と同 process、viewer のみ JS** にすれば 2 process で済む。または **Node 1 process で BLE まで触る** (Noble.js / web-bluetooth) なら Python を完全排除可能。後者は brief 07 の B (Local web app) と Web Bluetooth path で実現可能だが、bleak より成熟度が低い (Noble は Windows で BlueZ 非互換、Web Bluetooth は Chromium 限定)。

検証コマンド:
- 各 IPC hop の latency を簡易計測 (`time.perf_counter()` を engine/bridge 両端に仕込んで JSON round-trip)
- BLE FTMS の write 確認 → notification 受信までの actual latency 計測 (`bleak` の `start_notify` callback で timestamp 取得)

---

### 03-oss-evaluation.md — OSS 評価

**スコア: ★★★**

ライセンス記述は正確、採用判定も妥当:

- QZ = GPL v3 (派生物伝播あり、商用配布注意は正しい)、個人利用 OK
- pycycling = MIT、bridge core 採用は妥当
- Cesium = Apache 2.0 (これは Cesium**JS** の話、Cesium **Ion** はサービス側で別 ToS、後述)
- Golden Cheetah = GPL v3 (重い、scope オーバー判定 正しい)

死角:
- **Cesium のライセンスが 2 層構造である記述が無い**。CesiumJS ライブラリ自体は Apache 2.0 (自由)、ただし Cesium World Terrain や Bing Maps Aerial 等は Cesium Ion サービス経由で配信され、Ion の Terms of Service と無料 tier 制限がかかる。brief 04 で「Cesium World Terrain (無料 tier、要 Ion access token)」と触れているが、**brief 03 の OSS 評価セクションには Ion ToS 制約が含まれていない**。

検証コマンド:
- `https://cesium.com/legal/terms-of-service/` を実読 (公開時のライセンス制約確認)
- yuuji が将来公開 (brief 07) する場合、Ion 商用利用判定 (個人収益 $50K/年 が境界線、後述)

---

### 04-3d-viewer.md — Cesium 前提の viewer

**スコア: ★☆☆ (最も危険)**

ここが今プロジェクトで **最も推測が多い brief**。以下の検証されていない想定が積み重なっている:

#### 4-A. Cesium Ion 無料枠の制約

Cesium Ion Community (無料) tier の実際の制限を WebFetch で確認 (2026-05 時点、Cesium 公式 pricing page):

- 「5 GB storage」 「15 GB / month streaming」 「1,000 sessions / month for Global Imagery」 「Personal and non-commercial use」「Individual account only」
- 商用判定: 「more than $50K in annual gross revenues」「received funding exceeding $50K」「government projects」のいずれかに該当すると有償 plan 必要

yuuji が個人趣味で月 5-10 ride 程度なら **無料 tier の streaming 上限に余裕で収まる** (1 ride で消費する streaming は数十 MB 程度、月 10 ride で数百 MB)。**ただし将来 brief 07 で言及されている「公開」path に進むと session/月 1000 が即枯渇する**。1 ride = 1 session 換算で 100 user × 月 10 ride = 1000 session 即超過。公開時は Ion 有償化 ($99/月 ~) または地形 source を自前 (OpenTopography + Cesium 自前ホスト) に変更が必須。

brief 04 はこの境界を明示していない。「無料 tier、要 Ion access token」だけでは不十分。

#### 4-B. 「60fps 想定」の根拠が無い

brief 04 は「富士周辺 30m mesh で 1968 trkpt 描画、modern GPU で 60fps 想定」と書くが、**Cesium で 1968 点 polyline + 富士周辺 30m mesh terrain を camera 追従しながら 60fps 出る実証データは無い**。WebSearch でも Cesium 公式の 60fps benchmark はヒットしない (3D Tiles streaming の 10x 改善は building/photogrammetry の話で polyline + terrain の話ではない)。

実際の懸念点:
- 富士周辺の Cesium World Terrain は LOD で粗いタイル → 細かいタイルへ camera 移動で stream される、最初の数秒は tile loading で frame drop しやすい
- 1968 点を Cesium Entity polyline で描くのは軽量だが、勾配色分けで polyline を区間ごとに分割すると Entity 数が増える (例: 5m ごとに分割なら ~4800 Entity、これは Cesium で重い数)
- yuuji の Windows PC の GPU が未確認 (Intel iGPU なら 30fps すら厳しい、dedicated GPU なら問題なし)

#### 4-C. SRTM 30m の Mt.Fuji 精度

WebSearch (Hayakawa 2008 の Geophysical Research Letters 論文等) によると、**SRTM 30m は steep terrain で精度劣化が顕著**、Mt.Fuji 級の急峻地形では ASTER G-DEM や JAXA AW3D30 の方が現実的。富士ヒルの登り区間 (平均 5.2%、最大 7% 前後) は他の山岳路と比較すれば穏やかなので 30m mesh で「形は分かる」レベルだが、勾配色分けの精度に影響する可能性あり。

brief 04 の「30m で 1242m up コースは充分視認可能」は **形が見える** という意味では正しい、ただし **勾配計算の精度** という意味では微妙。GPX 自体に 1968 点の標高データがあるので、勾配は GPX から計算 (= DEM とは独立) すれば DEM 精度の影響を受けない。brief はここを明示的に書いていない。

#### 検証コマンド
- yuuji の GPU 確認: `dxdiag` または `Get-WmiObject Win32_VideoController | Select Name`
- Cesium 1968-point polyline + Mt.Fuji terrain の minimum reproducible: Cesium Sandcastle で `Cesium.GpxDataSource.load(<fujihc.gpx>)` + World Terrain で実フレーム計測 (Chrome DevTools FPS meter)
- Ion 無料 tier 残量確認: `https://ion.cesium.com/usage` (アカウント作成後)

---

### 05-trainer-bridge.md — pycycling + bleak

**スコア: ★★☆**

技術選定 (pycycling + bleak) は妥当。ただし以下に重大な未検証項目あり:

#### 5-A. bleak の Windows pairing 問題

WebSearch で確認した bleak の既知 issue:
- Issue #789: 「Could not pair with device: 19: FAILED」 (Windows での pairing 失敗、SecureBondedDevice モードで起こる)
- Issue #827: 「programmatically accept pairing request in python without dialog interaction」 (Windows で pairing dialog を programmatic に accept できない、UI dialog で手動 OK が必要なケース)
- Issue #1470: 「program hangs when connecting laptop with device via BLE for no apparent reason after running continuously for several hours」 (長時間連続稼働で hang)

これらは pycycling の上位 issue ではなく **bleak 本体の Windows 実装** の問題。FTMS smart trainer は通常 unpaired connection (Indoor Bike Service が pairing 不要で動作) なので #789/#827 は回避可能、ただし **#1470 の long-running hang は 90 分 ride の最終盤で発火する可能性**あり。ride 中に bridge が hang したら brief 06 (UX) の「失敗してはいけない UX: ride 中 crash」に直撃。

#### 5-B. yuuji の trainer 機種未確認問題

brief 05 自身が「yuuji の trainer 機種特定が必要」と挙げているが、**これが未確認のまま brief 01-10 全体が進んでいる**。技術現実性の観点では:
- yuuji が **FTMS 非対応 trainer** (古い dumb trainer / ANT+ FE-C のみ) を持っていたら、bleak path は破綻、ANT+ USB stick + Python の openant ライブラリに切り替え必要
- yuuji が **smart trainer を持っていない** なら brief 全体が demo mode しか動かない (= 視覚のみ、勾配コマンドは中空に消える)

検証コマンド (最優先):
```
yuuji への確認: 「室内ローラーの型番教えて」(1 行で解決)
```

または `bleak.discover()` で yuuji の PC 周辺の BLE 機器を列挙、FTMS Service UUID 0x1826 を Advertisement に持つ機器を確認。

#### 5-C. ANT+ FE-C path の欠落

brief 05 は FTMS only 前提で書かれているが、**ANT+ FE-C は smart trainer の defacto standard の一つ** (Wahoo / Tacx は両対応、古い Elite は ANT+ only)。pycycling は「ANT+ FE-C over BLE」 (= BLE 経由の ANT+ ブリッジ) は対応するが、**ANT+ USB stick 経由の生 ANT+** は openant 等の別ライブラリが必要。brief はここを書いていない。

---

### 06-ux.md — UX

**スコア: ★★☆**

UX 観点としては妥当 (HUD 最小、視点切替、glance で読める)。技術現実性の観点では:

- 「ride 中に application が crash する」を「失敗してはいけない UX」に挙げているが、**brief 05 で挙げた bleak の long-running hang リスク (#1470) と直結**しているのに対策が書かれていない。`bridge` を別 process にして crash 時に engine から自動再起動する supervisor 構造が必要だが、brief 02 の architecture には書かれていない。
- 「視点酔いで 5 分で気持ち悪くなる」リスクへの対策が brief 04 にも brief 06 にも書かれていない。Cesium の camera 動作 (急な向き変更、FOV、地表クランプの上下動) のパラメータ調整が要るが、項目立てされていない。

検証コマンド:
- yuuji が 5 分間 ride simulator を回して視点酔いしないかの主観テスト (= MVP 完了基準の 1 つに加えるべき)

---

### 07-deployment.md — deploy 形態

**スコア: ★☆☆ (推し B の判断に疑問)**

brief 07 は **B (Local web app)** を推しているが、技術現実性の観点では **A (Windows full local、Electron/Tauri)** が現実解。理由:

#### 7-A. B (Local web app) の隠れ問題

「viewer = Chromium で localhost を開く、bridge = Python daemon、engine = Node daemon」と書いてあるが:
- **Web Bluetooth で BLE FTMS を叩く path** を「Chrome 限定」と書いて選択肢から除いているが、これは正しい判断 (Web Bluetooth は Chrome 70+ の Windows 10 1703+ のみ、しかも user gesture 必須で起動時に毎回手動 device 選択 dialog が出る、ride のたびに click が要る = UX 失敗)
- **localhost で Python daemon + Node daemon + Chromium = 3 process を毎回手動起動 or pm2 で常駐**。「docker-compose / pm2 等で一発起動可」と書いてあるが、yuuji の Windows ネイティブ環境で pm2 を常駐させるのは Linux/Mac より煩雑 (Windows Service 登録 or タスクスケジューラ)。
- frontend = Chromium tab の場合、`tab を間違えて閉じる` `他タブの heavy site でフリーズ` 等の **ブラウザ環境由来の事故** が ride 中に起こる。

#### 7-B. A (Electron/Tauri) の優位性

- Electron なら **Node engine と viewer が 1 process** (main + renderer)、bridge だけ Python sidecar、IPC が 2 hop に減る (brief 02 の latency 懸念が緩和)
- Tauri なら **Rust main + WebView + Python sidecar**、bundle が小さい (Tauri 推し論文の典型結論) が、Cesium の WebGL が OS native WebView で動くか追加検証が必要 (WebView2 ベースなら問題ないはず、ただし Tauri + WebView2 + Cesium の組合せは事例が少ない)
- どちらも **ride 開始の click が 1 つ** で済む (Electron app の起動 click 1 回 → 自動で sidecar 起動)

検証コマンド:
- Electron + Cesium minimum app の `electron-quick-start` から Cesium を組み込んだ Hello World、Windows でビルド/起動して frame rate 確認
- Tauri + Python sidecar の公式サンプル (Tauri docs の sidecar セクション) を Windows で動作確認

#### 7-C. C (Pi + 別 PC) の現実

brief 07 は「yuuji は Pi 持ってる? 不明」と書いている。これは yuuji への確認 1 行で解決する項目を未確認のまま選択肢にしている。**Pi なしなら C は即除外**、Pi あっても scope オーバーで C は除外推奨。

---

### 08-data-pipeline.md — データ蓄積

**スコア: ★★★**

技術現実性の観点では問題ない。CSV 1Hz で 24km/90 分の 1 ride が 20-50KB は正しい (1 row ~50 bytes × 5400 rows ≈ 270KB、brief の見積もりは若干小さいが桁感は合っている)。`.fit` 変換は `python-fitparse` (read) と `fit_tool` (write) で landed。

死角:
- `.fit` の書き出しは fit_tool で可能だが、Strava upload で reject される malformed `.fit` を作りやすい (= `developer_data_id` の扱い、`session` message の必須 field 漏れ等)。検証コマンド: 書き出した `.fit` を Garmin Connect IQ FIT SDK の `FitToolUI.exe` で parse 確認、または Strava 手動 upload テスト。
- ride データを `~/user-context-vault/rides/` 配下に保存する設計は CLAUDE.md / Rule 11 と矛盾しないか?。**自分の Strava-equivalent のローカル ride データは C2 class (本人データ、ローカル保存 OK、git push 禁止)** に該当。brief 08 が `~/user-context-vault/` 配下を指定しているが、vault 自体が git 管理 (本人 commit 用) なら **ride データは別 dir (`~/.fujihc-rides/`) に置くのが安全**。brief は vault 内に置く理由を書いていない。

---

### 09-mvp-cut.md — MVP cut 案

**スコア: ★★☆**

3 案の切り方は妥当、推し C も理にかなう。技術現実性の観点では:

- **Cut A (viewer only)** ── 1-2 日 = 楽観的だが現実的範囲、ただし brief 04 の Cesium 60fps 問題を回避していない (3D が落ちると A 単独でも価値が出ない)
- **Cut B (ERG only)** ── 2-3 日 = 妥当、技術的に最も低リスク (BLE + ERG sequence は brief 05 + pycycling で landed pattern)、視覚は 2D 縦断プロファイルなら matplotlib / Chart.js で trivial
- **Cut C (3-5 日)** ── A + B の合算、最もリスク高い (Cesium 検証 + BLE 検証 + 統合)、yuuji が試して使い続けるかは 60fps が出るかに依存

「3-5 日」見積もりが yuuji の **休日のみ** で計算されているか **連続稼働** で計算されているかが書かれていない。週末 1.5 日 × 2 週末 = 3 日 で MVP 完成は楽観的。バッファ込みで 4-6 週末 (連続休日換算で 8-12 日) を見るのが現実的。

#### 推奨

**Cut B → Cut C に段階移行** が技術現実性最高:
1. 週末 1-2 回: Cut B (ERG only、勾配を trainer に送って yuuji が踏める形) を完成、これで富士ヒル本番に向けた fitness build が即始まる
2. 並行して Cut A (3D viewer minimum) を別 worktree で組み立て、60fps が出るか早期確認
3. 両方が立ったら Cut C に統合

これなら **fitness build (= 本番に向けた本来の目的) が止まらない**、3D は趣味の上乗せ。

---

### 10-alternative-paths.md — 作らない選択肢

**スコア: ★★★**

5 案の整理は適切、特に **案 2 (Rouvy 既製コース確認)** の優先度を上げている点は正しい。Rouvy の Mt.Fuji hill climb 既製ルートは WebSearch で確認 (Yamanashi Prefecture、約 11.3km/608m up と 24km/1242m up の 2 種類、Rouvy 公式 destination/japan page と ridewithgps trip 37305050 で landed)。

**つまり「自作着手前に Rouvy 1 ヶ月無料トライアルで本物のコースを走る」が ROI 最高**。これで以下が判明する:
- yuuji が「3D ではなく実写動画でも富士ヒルなら満足するか」のテスト
- Rouvy の Mt.Fuji コースが本番 24km / 1242m up と一致するか確認
- 不満なら brief 01-09 の自作 path に確信を持って戻れる (= 確認なしで自作着手するより手戻り少ない)

ただし brief 10 が指摘するように、yuuji が「**富士ヒルそのものを 3D で走りたい**」が必須要件なら Rouvy 実写では満たさない。これは趣味の優先度問題なので yuuji への確認 1 行で済む。

---

## 総合判定

### 技術現実性スコア集計

| brief | スコア | 主な根拠 |
|---|---|---|
| 00 | ★★★ | OSS 部品リストの事実関係は正確 |
| 01 | ★★☆ | trainer 機種未確認のまま MVP 定義 |
| 02 | ★★☆ | 3 process IPC latency 未評価 |
| 03 | ★★★ | ライセンス記述正確、ただし Cesium Ion ToS が抜け |
| 04 | ★☆☆ | Cesium 60fps + Ion 制約 + SRTM 精度すべて未検証 |
| 05 | ★★☆ | bleak Windows hang リスク + trainer 機種未確認 |
| 06 | ★★☆ | crash / 視点酔い対策が brief 02 に下りていない |
| 07 | ★☆☆ | 推し B より A (Electron/Tauri) が現実解 |
| 08 | ★★★ | データ設計は妥当、ride dir の置き場所のみ修正要 |
| 09 | ★★☆ | 推し C は妥当、ただし 3-5 日見積もりは楽観 |
| 10 | ★★★ | Rouvy 既製コース確認の優先度上げは正しい |

### 最も危険な brief

**brief 04 (3D viewer)**。理由:
- Cesium で 1968 点 polyline + 富士 terrain を 60fps 出す実証データが無い
- Cesium Ion 無料 tier の制約 (個人/非商用、月 15GB streaming、月 1000 session) が公開 path で即枯渇する境界線にある
- SRTM 30m は steep terrain で精度劣化、ただし GPX 標高使えば DEM 精度は問題にならない (このことが brief で明示されていない)

### 最も堅い brief

**brief 03 (OSS 評価)** と **brief 10 (alternative paths)**。ライセンス / maintenance の事実関係が正確、判断基準が明示されている、検証可能。

### 着地推奨

**Cut B (ERG only) → Cut C (3D 統合) の段階移行**。理由:

1. **fitness build が止まらない**: 富士ヒル本番が 6 月、yuuji の本来の目的は完走/タイム短縮。Cut B なら週末 1-2 回で勾配 ERG ride が始まり、本番に向けた fitness build に即貢献。
2. **技術リスクを分離**: BLE bridge (brief 05) と 3D viewer (brief 04) が独立で組める、Cesium が 60fps 出ない地雷を踏んでも fitness build は止まらない。
3. **検証コストが小さい**: Cut B 単独は pycycling サンプル + 2D plot で 1 週末で動く、地雷検出が早い。

### デプロイ推奨

**A (Windows full local、Electron か Tauri)**。理由:
- brief 07 の B 推しは Python+Node+Chromium 3 process の常駐管理が Windows ネイティブで煩雑、pm2 等の前提が yuuji 環境に合わない
- Electron なら viewer + engine が 1 process、Python sidecar 1 つで 2 process に圧縮、IPC latency 改善
- Tauri は bundle 小、ただし Cesium + WebView2 の事例が少ない (= Electron が無難)

### 並行優先タスク (yuuji 確認 1 行で解決する項目、ブロッカー)

1. **yuuji の smart trainer 機種** (= brief 01/05 の前提)
2. **yuuji の Windows PC の GPU** (Intel iGPU か dedicated か、= brief 04 の前提)
3. **yuuji が Pi を持っているか** (= brief 07 の C 案の生死)
4. **Rouvy 既製 Mt.Fuji コースを 1 ヶ月無料トライアルで走るか** (= 自作着手前の確認、brief 10 案 2)
5. **「富士ヒルそのものを 3D で走りたい」が必須か否か** (= 自作必要性判定、brief 10)

これら 5 項目が未確認のまま brief 01-09 を実装着手すると、機種不一致で BLE 動かない / GPU 不足で 60fps 出ない / Rouvy で満足できた場合の sunk cost、いずれかが発火する。

## まとめ

11 本の brief は全体として **「OSS は揃ってる、組み合わせれば動く」** という想定で書かれている。これは大筋正しい (pycycling + Cesium + GPX library は landed)、ただし **「組み合わせた時に Windows で 60fps + BLE 安定 + 90 分連続稼働」が成立するかは未検証**。

技術現実性の優先順位:
1. yuuji に 5 つの未確認項目を 1 行ずつ確認 (合計 5 分)
2. Rouvy 既製コースで「自作必要性」を再判定 (合計 30 分)
3. Cut B (ERG only) を週末 1-2 回で landed、fitness build を即開始
4. Cut B が動いた後、Cut A (3D minimum) を別 worktree で 60fps 検証
5. 両方立ったら Cut C に統合、Electron で配布

「Cut C を 3-5 日で landed」を 1 直線で目指すのは **brief 04 / 05 の地雷を同時に踏むリスク**、段階移行で分離するのが現実解。
