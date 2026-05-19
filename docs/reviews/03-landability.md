---
review: 03-landability
axis: 着地可能性 (3-5 日で MVP まで本当に運べるか)
reviewer: landability reviewer (sub agent)
date: 2026-05-14
verdict: 自作は 5 日では着地しない、まず案 1-2 を 30 分で殺せ、それでも作るなら Cut B (ERG only) → C
---

# 着地可能性レビュー

## はじめに

11 本の brief は「動くもの」の絵としては綺麗。だが「3-5 日で yuuji が富士ヒル GPX を 1 本走り切れる」という着地条件で見ると、**書いた通りに進む前提が壊れている**箇所が複数ある。

特に深刻な問題は 3 つ。

1. **brief 自身が「Cut C で 3-5 日」と書いているが、3-5 日の中身を割ったら 1 つも収まっていない** ── 「ざっくり数字」がそのまま残っているだけ
2. **yuuji が今持ってる trainer の機種が確定していない** ── brief 05 にも「機種特定が必要」と書いてあるが、特定できなかった場合の path 分岐 (= trainer 買う or 既存で動かない場合) が決まっていない、ここで止まる
3. **BLE FTMS / Cesium / FIT export いずれも yuuji の過去 repo を Glob しても着手痕跡なし** ── 全部「初めて触る」、初手の troubleshooting cost が 0 日で計上されている

富士ヒル本番が 6 月 1-2 週 (本ファイル時点 2026-05-14、残り 17-24 日)。**「6 月本番で実際に使う」を目的に置くと、自作 path は工数的に既に手遅れに近い**。fitness build が目的なら案 1 / 案 4 を真剣に検討すべき phase。

---

## 各 brief の着地可能性スコア

★★★ = 書いた通りに着地できる / ★★☆ = 詰めれば着地、踏み外し点あり / ★☆☆ = 着地前提が崩れている

| brief | スコア | 短評 |
|---|---|---|
| 00-context | ★★★ | 前提整理として正常。空白市場 framing は正しい |
| 01-mvp-definition | ★☆☆ | 「5 機能全部入って 1 ride 完走」を MVP と定義したのが過大。trainer + 3D + log + FTMS write + 受信 を同時に landing させる前提、初学者で 3-5 日は無理 |
| 02-architecture | ★★☆ | 3 process 分担は妥当だが「engine ↔ viewer の WebSocket」「engine ↔ bridge の JSON line」の通信 framing が ground されていない。実装は debugging で半日溶ける |
| 03-oss-evaluation | ★★☆ | 評価軸は正しい。だが QZ を「読む / 真似る」に下げた判断は楽観 ── 実は QZ 採用が最短で、自作前提を引き上げる引力になっている。再評価必須 |
| 04-3d-viewer | ★☆☆ | Cesium Ion token / terrain provider / 進行追従 camera を「sizing 30m mesh で 60fps 想定」だけで処理できる前提は薄い。Cesium 初学者で camera 追従 + HUD overlay は 2-3 日喰う |
| 05-trainer-bridge | ★☆☆ | **着地の最大リスク**。yuuji の trainer 機種が未確定、FTMS 対応していない trainer (中華 / ANT+ only) だと pycycling が刺さらない。"確認すべき" と書いてあるだけで未確認 |
| 06-ux | ★★☆ | 失敗してはいけない UX を列挙したのは正しい。だが「ride 中 crash しない」を満たすには 3D + 3 process 全部の error path を踏むテスト工数が必要、別途 1 日 |
| 07-deployment | ★★☆ | B (Local web app) 推しは妥当。だが「3 process を docker-compose / pm2 で一発起動」を windows native で組むのは初学者で半日喰う |
| 08-data-pipeline | ★★★ | CSV / .fit 保存は単純、過去比較 / Strava は Phase 2 と明示。MVP 段階で削れている、これは正しい削り方 |
| 09-mvp-cut | ★★☆ | Cut A / B / C の切り方は正しい。だが「Cut C = 3-5 日」の根拠が薄い、後述 |
| 10-alternative-paths | ★★★ | 案 1-4 を並べて「30 分で確認するのが最短 ROI」と書いた最後の一文が、この project 全体で**一番価値ある一文**。これを真っ先にやるべき |

---

## scope creep の罠 — MVP に入れちゃダメな機能ベスト 3

brief 全体を通読して「文中では Phase 2 / MVP 外と書いてあるのに、なぜか脳内で必須化されている」機能を 3 つ。

### 1. 過去 ride 比較 / ghost rider (brief 06, 08)

- 「同コースを 5-10 回走るので過去比較が価値」と書いてあるが、**5-10 回走った後**の話
- 1 回目走るまでに ghost rider 実装は不要、データもない
- 罠: 「最終形」の絵を見ると「過去比較がないと魅力薄い」と感じて MVP に滲み出てくる
- **絶対に MVP に入れるな**。1 ride 完走できるまで存在価値ゼロ

### 2. Strava 自動 upload / OAuth 連携 (brief 08)

- 富士ヒル本番が 6 月、それまでに本番 ToS class C2 の OAuth flow を組む工数 = 1-2 日
- yuuji は strava-collector / strava-pmc-viewer で既に Strava OAuth を 1 度組んでいる、再利用したくなる ── これが罠
- **MVP は手動 .fit upload で済む**。.fit 生成だけ実装、upload は user が Strava UI に drag-drop
- 自動 upload は本番後 Phase 2、3 時間で landing する

### 3. 3D camera mode 切替 / 一人称 ↔ 三人称 (brief 04)

- 「キーボード s / 3 で切替」と書いてあるが、Cesium camera 制御 + smoothing + 切替 transition で半日溶ける
- MVP は **三人称固定**、一人称は後で
- 「視点酔いで使い物にならない」を恐れて両方入れたくなる ── 罠。三人称が酔いやすければ実装後に三人称→一人称 1 path に絞れ
- 切替は Phase 2

### 番外: ghost rider と camera mode 切替を組み合わせると、Cesium の Entity 2 個並走 + camera state machine で landing 工数 +2 日。両方 Phase 2 へ。

---

## 11 brief 全部実装した場合の工数 — 楽観バイアス除去版

brief 09 が書いた「Cut C で 3-5 日」を**初学者前提 (BLE / Cesium / FIT 全部初手) + 楽観 2-3 倍倍率**で割り直す。

### 各 brief 単位の実工数 (man-day = 1 日 = 集中 4 時間想定、業務外趣味前提)

| brief | brief 内記載 | **現実値 (2-3x)** | 主な工数喰い要因 |
|---|---|---|---|
| 02-architecture (3 process 通信骨格) | 0.5 日? | **1.5 日** | WebSocket / JSON line 設計 + 起動 script + process 監視 |
| 03-OSS 採用判断 (QZ 読む) | 0.5 日 | **1 日** | C++/Qt の QZ source を読んで真似る = 短くない |
| 04-3D viewer (Cesium 初手 + 進行追従 + HUD) | 1-2 日 | **3-4 日** | Cesium token / terrain provider / GPX polyline / camera follow / HUD layer 全部初手 |
| 05-trainer-bridge (BLE FTMS + 勾配書込み + 受信) | 1 日 | **2-3 日** | yuuji の trainer 機種次第。FTMS 対応で素直に動けば 1 日、ハマれば 5 日 |
| 06-UX (HUD レイアウト + 視点切替 抜き) | 0.5 日 | **1 日** | brief 04 と連結、別計上不要に見えるが UX polish で 1 日喰う |
| 07-deployment (3 process 起動 script) | 0.5 日 | **1 日** | docker-compose or pm2 で本当に「1 click 起動」を満たすのは Windows で煩雑 |
| 08-data-pipeline (CSV + .fit export) | 1 日 | **1.5 日** | .fit binary format は library 使えば早い、CSV は単純、これは現実的 |
| **Cut C 合計** | **3-5 日** | **11-14.5 日 ≈ 2-3 週間** | |

### 「Cut C で 3-5 日」がなぜ過小か

- brief 内の各「半日 / 1 日」見積りが、**初学者要因と integration debugging 工数を含んでいない**
- 3 process アーキは設計が正しくても「engine が viewer に WebSocket で push できているか」「bridge が engine に勾配を送れているか」を実走で詰める integration day が必須、これが計上ゼロ
- yuuji の業務外趣味で 1 日 4 時間 (現実は 2-3 時間の日も多い) を想定すると、11-14.5 日 = **暦上 3-4 週間**
- 富士ヒル本番まで残り 2.5-3.5 週、**完走前に本番が来る**

### 11 brief 全部 (Cut なし、過去比較 / Strava / ghost rider 全部入り) の場合

- Cut C の 11-14 日 + 過去比較 (3 日) + Strava OAuth (2 日) + ghost rider (3 日) + camera mode 切替 (1 日)
- 合計 **20-23 日 ≈ 1.5 ヶ月**
- これは富士ヒル本番には間に合わない、来年 2027 用と割り切る形

---

## MVP コア — これだけは削れない

11 brief から「これがないと『富士ヒル GPX で trainer が動いて 3D で走った』と言えない」最小要素を絞る。

1. **GPX → 勾配シーケンス変換** (brief 02 engine 部分)
2. **BLE FTMS 接続 + 勾配 set** (brief 05 送る側)
3. **trainer からの距離 / 速度受信** (brief 05 受ける側)
4. **3D 地形 + GPX line 描画 + camera 追従 (三人称固定)** (brief 04 から camera 切替と一人称を除いたもの)
5. **HUD で速度 / 距離 / 勾配 / 残距離 表示** (brief 06 最小版)
6. **CSV 出力** (brief 08 最小版、.fit は後)

これだけ。**5-6 個**。brief で書いた 11 本のうち、03 (OSS 評価) は判断、07 (deployment) は組み立て、09 (cut) は判定 prompt なので実装本数ではない。10 (alternative) は実装前検証。実質「実装する brief」は 02 / 04 / 05 / 06 / 08 の 5 本、これらの **最小版** だけ。

---

## 「途中で挫折する確率が高い brief」ランキング

挫折リスク = (技術的初手難度) × (yuuji の主観モチベ低下しやすさ) × (依存先未確定)。

### Rank 1: brief 05 (trainer-bridge) ── 最大の挫折地点

- yuuji の trainer 機種未確定。FTMS 非対応 (ANT+ only / 中華 trainer / 古い Tacx) だった瞬間、pycycling では刺さらず、ANT+ 経由ドライバ (FE-C) を別途実装する必要、ここで挫折する
- 仮に FTMS 対応でも、ペアリング / GATT char UUID / FTMS Control Point の write 順序 / Indoor Bike Data の parse で **必ず 1-2 日溶ける** ── BLE は仕様書と現物が乖離する
- 対策: **brief 着手前に「yuuji が使う trainer の機種 + FTMS 対応バージョン」を 30 分で確認**

### Rank 2: brief 04 (3D viewer) ── Cesium 初手 + 進行追従 camera

- Cesium は強力だが学習曲線あり。token 取得 / Ion 認証 / terrain provider / Entity polyline / camera follow / HUD overlay を全部初手
- 「camera が進行に追従しつつ視点酔いしない smoothing」を 1 発で landing は無理、調整に 1-2 日
- 視点酔いで yuuji 自身が使う気を失う → 挫折

### Rank 3: brief 02 (architecture) ── 3 process 統合

- 設計自体は正しいが、3 process が**初期セットアップから安定走行**するまで必ず半日-1 日喰う
- Windows で Python + Node + Chromium を docker / pm2 抜きで管理するのは煩雑
- bridge ↔ engine ↔ viewer の通信失敗 (= WebSocket 切断 / JSON parse error) で debugging に 1 日喰う

### 挫折しにくい brief: 08 (data pipeline)、03 (OSS 評価)、01 (MVP definition の文書化部分)

---

## Cut A / B / C のうち、最短で着地するのはどれか

brief 09 は「Cut C 推し」だが、**着地可能性最優先**ならランキングは変わる。

### Cut A (viewer only) ── 1.5-2 日で着地

- Cesium + GPX 描画 + camera 追従 + HUD のみ、trainer なし
- 着地確率高い、初手 Cesium だけハマる可能性ある程度
- **価値**: 本番当日のコース予習、室内 training の補助、富士ヒル「次の登りどこ」visual
- **不足**: trainer 連動ゼロ、室内 training に直結しない

### Cut B (ERG only) ── 3-4 日で着地

- GPX → 勾配シーケンス → trainer FTMS write、画面は 2D 縦断プロファイル only
- BLE FTMS のハマりリスクは残るが、Cesium 工数ゼロが効く
- **価値**: 富士ヒル相当の負荷を室内で再現、fitness build に直結 ── 本番完走目的なら**ここが本命**
- **不足**: 3D 体験ゼロ

### Cut C (両方絞り込み) ── brief は 3-5 日だが現実 11-14 日

- 上記分析通り、富士ヒル本番に間に合わない
- 「Zwift+GPX の実感」を yuuji が必要としているかが分岐点
- 趣味としては正しいが、本番完走目的では非合理

### 着地可能性最大: **Cut B 単独**

- 「富士ヒル本番完走」が yuuji の本音なら fitness build 優先 = B
- 3D を諦めれば Cesium 学習曲線がゼロ、BLE FTMS 1 個に集中して 3-4 日で本番までに動く形
- 3D は本番後の余興 Phase で

---

## 推奨着地経路

### Step 0 (30 分): 案 1-2 を殺す

brief 10 が書いた通り、**まず確認系**。これが project 全体で一番 ROI 高い行動。

1. **Rouvy で富士ヒル既製コース検索** (10 分): あれば $15-20/月 でサブスク、自作工数ゼロで本番まで使える形が手に入る
2. **QZ をインストールして富士ヒル GPX 読ませてみる** (20 分): GPX route following + FTMS 制御が**既に動いている**、3D は Zwift の標準コースで代用 → 「富士ヒルそのものを 3D で走る」を諦めれば自作工数ゼロ
3. **yuuji の trainer 機種特定** (5 分): 既存 trainer を確認、FTMS / ANT+ FE-C / その他を type 化

ここで「自作必要」と判定したら Step 1 へ。

### Step 1 (1 日): yuuji の trainer 機種で BLE FTMS が刺さるか確認

- pycycling install + BLE scan + FTMS Service detection + Indoor Bike Data subscribe まで
- ここで 1 日かけて FTMS が動かないと判明したら、ANT+ / 別 path 検討 (= MVP path 再設計)
- 動いたら次へ

### Step 2 (Cut B, 3-4 日): ERG only で本番完走できる形に landing

- engine (Python or Node) で GPX → 勾配シーケンス変換
- 2D 縦断プロファイル + 現在位置 marker + HUD 最小
- 距離 / 速度 / 勾配の表示
- CSV log 出力
- 5-10 ride 走って fitness build

### Step 3 (本番後、Phase 2): 3D viewer を後付け

- Cesium で 3D viewer 実装、Cut B の engine に接続
- ここで初めて Cut C 相当が完成
- 過去比較 / ghost rider / Strava 自動 upload も Phase 2

### 「3D が無いと意味ない」と yuuji が判断する場合

- 富士ヒル本番完走は QZ で代用 (案 1)、自作は本番後に 3D viewer を腰据えて
- 本番前の training は QZ + 富士ヒル GPX で fitness build、本番後に「来年に向けて 3D 化」project

---

## まとめ

- **brief 09 の「Cut C で 3-5 日」は楽観すぎる**。現実は 11-14 日、富士ヒル本番に間に合わない
- **最も価値ある一文は brief 10 末尾の「案 1-2 を 30 分で確認するのが最短 ROI」**。これが全 brief 中 single best advice、優先実行
- **MVP コアは 5 本** (brief 02 / 04 / 05 / 06 / 08 の最小版)、ghost rider / Strava OAuth / camera mode 切替は絶対に MVP に入れるな
- **最大の挫折リスクは brief 05 (trainer-bridge)**、yuuji の trainer 機種未確定が landing 全体を blocker 化している
- **本番完走目的なら Cut B (ERG only) が現実的着地点**、3D は本番後
- **本気で「富士ヒル 3D で走る」が必須なら、それは 2027 年 project**、今年の本番は QZ で済ませろ

「作る」と決める前に Step 0 を 30 分回せ。それで自作不要が判明したら project 全体が成立しない (= 不要だった) と判明する、それが今 phase で最大の勝ち筋。
