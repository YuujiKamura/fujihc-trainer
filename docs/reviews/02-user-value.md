---
review: 02-user-value
reviewer_axis: 富士ヒル user value (yuuji の training 実利、UX 集中環境、自作 vs 既存サブスクの効用)
date: 2026-05-14
target_briefs: 00-context.md + 01-10 (11 本)
verified_via: WebSearch (Zwift Climb Portal Mt Fuji の実在 / Rouvy Mt.Fuji 既製コース / Zwift GPX 取り込み policy / QZ GPX following), yuuji の Strava 履歴 (`strava-collector/data/activities/`, 1771 ファイル), 過去発話 (`user-context-vault/voice/by-date/`)
---

# 富士ヒル user value レビュー — fujihc-trainer briefs 01-10

## はじめに

このレビューでは「技術的に作れるか」「ライセンス的に通るか」ではなく、**「yuuji が 6 月の富士ヒル本番に向けて、これを作って実際に使うか」**だけを軸にする。

最初に結論を書く: **このプロジェクトは全 brief で前提が一つ抜けている**。それは「**Zwift Climb Portal に Mt.Fuji が既に存在する**」事実だ (2024 年 4 月追加、25.6km、勾配色分けあり、Real World / Heroic 難度切替あり)。yuuji 自身が 2023 年に Zwift Climb Portal の Bealach na Ba、Col de la Madone、Volcano を実走したログが strava-collector に残っている。つまり「Zwift では富士ヒル走れない → 自作必要」という brief 00 の出発点が事実誤認。

この事実を踏まえて評価すると、brief 01-09 (自作路線) は user value ★☆☆、brief 10 の案 1 (QZ そのまま運用) や案 4 (Zwift workout 化) ですら本来不要、**正解は「Zwift サブスク継続して Climb Portal Mt.Fuji を走る」** だけ。yuuji の本音が「fitness build」なら 30 秒で着地、本音が「自作の作品が欲しい」なら別軸 (engineering 道楽) として議論しなおすべき。

以下、各 brief を user value 軸で 11 本評価する。最後に yuuji の goal 推定と着地推奨を書く。

---

## 各 brief の user value スコア

### 00-context.md — 前提条件

**スコア: ★☆☆**

「Zwift では GPX 走れない → OSS で自作」という前提が、yuuji の利用環境では成立しない。確かに Zwift は任意 GPX の取り込みをサポートしない (forums.zwift.com で 2024-2025 通じて議論継続、feature request は archived)。だが Zwift Climb Portal には Mt.Fuji が既に landed していて、これは「公式が用意した GPX 相当の climb」を yuuji が踏むだけで体験できる。

yuuji の Strava 履歴に 2023 年の Zwift Climb Portal 実走ログが 4 本ある (Bealach na Ba 2023-10-30、Col de la Madone 2023-10-18、Volcano 2023-10-10、Crow Road 2023-10-17)。つまり yuuji は Climb Portal という機能を**知って、使って、評価済み**。にもかかわらず「Zwift では富士ヒルは走れない」と brief 00 に書かせている → これは AI が外部検索で Zwift の機能を取り違えたか、yuuji 自身が記憶から落としているか。前者なら brief 全体の起点が崩れる、後者なら yuuji に確認して 5 分で全 brief 廃止判断ができる。

死角: brief 00 が触れている QZ も、Climb Portal Mt.Fuji を Zwift 内で踏むなら不要。QZ は「Zwift にない GPX を Zwift と並走させる」ための bridge、Zwift 内に既製 climb がある時点で QZ 自体が解決すべき問題が消える。

---

### 01-mvp-definition.md — MVP の最小機能セット

**スコア: ★☆☆**

MVP 定義 (3D + trainer 連動 + ログ) は brief としては clean だが、「yuuji が 6 月本番までに 5-10 回走る」の前提に対して the wrong question を解いている。yuuji が必要なのは「富士ヒル相当の勾配 sequence で 50-90 分回して心拍 / power を積む」だけ、3D 視覚は Zwift の Watopia 標準コースで十分代用できる (yuuji の 2023 Tour of Watopia 8 本完走履歴がそれを証明)。

具体的な失敗 mode: yuuji が「3-5 日で MVP 着地」を信じて着手 → trainer 機種特定で 1 日 → BLE FTMS 接続デバッグで 2 日 → Cesium の Ion access token で 1 日 → ride 中 crash で 1 日 → 気がつくと 1 週間溶けて 6 月本番 1 ヶ月前 fitness は 0 ramp、つまり「training 道具を作る」プロジェクトに食われて「training する」時間が消える。

検証コマンド (= yuuji への質問 1 行で済む): 「Zwift Climb Portal の Mt.Fuji 知ってる? 2023 に Bealach na Ba とか走ってたよね」。Yes なら本 brief 廃止、No なら自作議論継続。

---

### 02-architecture.md — アーキテクチャ

**スコア: ★☆☆**

3 process 構成 (bridge / engine / viewer) は「自作する」と決まった後の話。user value 軸では「そもそも作るか?」が先で、本 brief は前提が確定する前に作業を始めている。

加えて、3 process 構成は **yuuji が ride 中 (50-90 分集中、扇風機 ON、bike 固定済み)** に踏む UX として致命的に脆い。1 process でも crash すれば ride 中断、再起動で集中切れて再開できない (brief 06 でも yuuji 激怒シナリオとして自己警告している)。Zwift は 1 単一 application で動く、crash 率も低い、これに比較して 3 process 自作の安定性は user の主観品質で 1 桁下。

---

### 03-oss-evaluation.md — OSS 評価

**スコア: ★★☆**

「QZ を fork するより読む / 真似る」「Cesium が viewer の core」と判断したのは sober。ただし「QZ そのまま使う」案を「fork 改造の learning cost 高い」で蹴っているのが浅い。実際は QZ をそのまま動かせば brief 05 (bridge) と brief 02 (engine) は全部 QZ 内で完結する、自作部分は viewer (Cesium) だけになる。これは brief 10 の案 1 とほぼ同義、だが brief 10 では別 case として扱われていて、本 brief 03 と整合が取れていない。

user value 観点: QZ + Zwift Climb Portal Mt.Fuji の組み合わせが本来の正解。Climb Portal が「3D 視覚 + 既製コース」を提供、QZ は trainer がもし FTMS 弱機種なら間に入って bridge する。yuuji が既存 Zwift サブスク + QZ install (無料、約 30 分) で動く構成。

---

### 04-3d-viewer.md — 3D viewer (Cesium)

**スコア: ★☆☆**

「勾配で polyline 色分け、camera 進行追従、HUD は隅」── 設計としては筋がいい。だがこれは Zwift Climb Portal Mt.Fuji が**既に提供している機能**: 路面を勾配で青/黄/橙に色分け、10 セクション分割表示、ride 中の HR/power/time セグメント別表示。つまり「無料の OSS で自作する」と書いてあるが、yuuji 視点では「既存 Zwift サブスクに乗っている機能の劣化版を 5 日かけて自作」になる。

UX 集中環境への耐性: Cesium での 60fps 想定 (本 brief) は modern GPU 前提、yuuji の PC GPU は GhosttyWin の D3D11 開発で WinUI3 動かしている世代 (発話履歴の D3D11 文脈から推定)、Cesium で富士周辺 30m mesh + 1968 trkpt を確実に 60fps で回せるかは不明。低 fps 時の 2D fallback も brief には書いてあるが、それは「3D で走りたい」要件を満たさない時点で MVP 失敗。

ghost rider (過去 ride 比較) を Phase 2 に押し出しているのも user value 軸で逆。yuuji が「過去未来繋ぐ」class を作りたい (CLAUDE.md 系の発話、strava-pmc-viewer も同じ class) なら、過去 ride 比較こそが core value、3D 視覚は装飾。Phase 1/2 の優先度が逆転している。

---

### 05-trainer-bridge.md — trainer 接続

**スコア: ★★☆**

技術的には clean だが、本 brief の冒頭で「yuuji の trainer 機種が未確認」と書いている時点で brief を書く順序が間違っている。**MVP 着手の前に 30 秒で確認すべき**前提条件、後段の brief で扱う件ではない。

機種が FTMS 対応の現代品 (Wahoo KICKR / Tacx Neo / Elite Suito 等) なら本 brief 不要、Zwift も QZ もそのまま動く。FTMS 非対応の古い trainer (= yuuji が Zwift をやめた 2024 年 1 月以降、indoor 環境を thin out している可能性あり、Strava trainer ログが 2024-01-16 で停止しているのは要確認) なら、bridge 開発以前に **trainer 買い替え** が先 (中古 Tacx Flow Smart ¥30k、新品 Wahoo KICKR CORE ¥120k)。買い替えれば本 brief 全部不要。

user value 観点: 「yuuji が 6 月本番に向けて確実に training する」を最大化するなら、bridge を自作する 2-3 日 < trainer 買い替えて Zwift サブスク継続の 30 分。前者は AI に作らせて token 消費だけ、後者は yuuji 自身が判断する 1 click。

---

### 06-ux.md — UX 設計

**スコア: ★★★**

本 brief 単独では一番質が高い。yuuji の ride 環境 (集中 50-90 分、扇風機、bike 固定、PC) を踏まえて「glance で読める / 視点酔いしない / 1 click 起動 / crash 厳禁」を列挙しているのは正しい。失敗 UX 4 つも具体的で実用的。

ただし user value 軸では、この brief で列挙している UX 失敗 mode を**全部回避済みのアプリが既に存在する** (= Zwift)。自作で本 brief の品質基準を達成するには、Zwift 開発チームと同等の UX 投資が必要、yuuji 1 人 + AI で 5 日では絶対に届かない。本 brief は「自作する場合の UX 要件」としては正しい、だが「自作する」前提自体が user value を毀損している。

ghost rider (過去 ride との比較) を MVP 外 Phase 2 にしているのは brief 04 と同じ priority 逆転、ここでも user value 軸で減点。

---

### 07-deployment.md — deploy 形態

**スコア: ★☆☆**

「推し: B (Local web app)」と書いているが、yuuji の ride 中環境 (50-90 分集中、画面に張り付き) で「Chromium で localhost を開く + Python daemon + Node daemon」の 3 process 構成は UX 脆弱性が高い。ブラウザの自動更新で何か壊れる、Chromium が他タブで重くなる、daemon の片方が ghost で残る、これらは yuuji が ride 中に踏む地雷。Zwift / Rouvy は 1 native app で完結している、これと比較して B 案は user value 軸で大幅減点。

本 brief 全体が「自作する」前提で書かれていて、「自作しないで Zwift 使う」を deployment 比較軸に入れていない。これは brief 10 で扱う件と建前上分業されているが、brief 07 単独で読むと「自作以外の選択肢が無い」と誤認させる構造になっている。

---

### 08-data-pipeline.md — ride データ蓄積

**スコア: ★★★**

本 brief は別軸で評価すると user value が高い。yuuji は既に strava-pmc-viewer で「過去未来繋ぐ」class のツールを作り込み中 (CTL/ATL/TSB の年度別チャート、5月12日のライド ATL 跳ね上がりを観察できている)。fujihc-trainer の ride データを strava-pmc-viewer に流せれば、「富士ヒル training 専用 PMC」が成立する、これは Strava の generic PMC では追えない粒度。

ただし本 brief が ride データを蓄積するためには **brief 01-07 (自作 stack) 全部が動いていることが前提**。Zwift Climb Portal Mt.Fuji を走れば Strava に自動 upload、strava-pmc-viewer が自動で取り込み、本 brief の機能は**自作部分ゼロで達成済み**になる。つまり本 brief の価値そのものは高いが、独立価値ではなく「Zwift 経路で同じ result が得られる」ため自作部分の追加 user value はゼロ。

ghost rider (過去 ride 並走) のアイデアは Zwift 標準にはないので、ここだけは Zwift 経路で代替不可。だがこれは「Zwift で走った ride を strava-pmc-viewer 上で過去 ride と並べて見る」で機能としては成立する (3D 並走は装飾、データ比較が core)。

---

### 09-mvp-cut.md — MVP cut 案

**スコア: ★★☆**

Cut C (富士ヒル絶対外せないだけ) を推しているが、user value 軸では Cut B (ERG only) のほうが上。理由: 3D 視覚は Zwift 標準コースで代用可、ERG は富士ヒル相当の負荷を確実に再現できる、yuuji の fitness build に直結する。Cut C で 3D + trainer 両方積むなら、Zwift Climb Portal Mt.Fuji と機能重複していて自作の delta が薄い。

本 brief の末尾で「B 単独もあり得る、本音が本番完走なら fitness build 最優先」と yuuji の好みに投げているが、yuuji の goal は strava-pmc-viewer の存在から見て **fitness build + データ蓄積で長期トレンド管理**、3D 視覚は道具立てとして必須ではない。Cut B を推すべき brief、Cut C を推すのは「視覚で楽しみたい」前提を密輸している。

---

### 10-alternative-paths.md — 代替案

**スコア: ★★★**

本 brief 群で**唯一の正解 path** を内包している brief。案 1 (QZ そのまま) + 案 2 (Rouvy 確認) を 30 分で先に確認しろという推しは正しい、だがその先で **Zwift Climb Portal Mt.Fuji の存在に触れていない** のが致命的な抜け。

追記すべき案:
- **案 1-B**: Zwift サブスク継続 + Climb Portal Mt.Fuji を待つ / 探す。2024 年 4 月以降「climb of the month」として rotation、5 月の featured climb として復帰履歴あり。yuuji が既存 Zwift サブスク (もし継続中) で 0 円 / 0 工数。
- **案 1-C**: Zwift サブスクが切れていれば再開 ($24.99/month)、Climb Portal Mt.Fuji + Tour of Watopia (yuuji の 2023 実走履歴あり) で fitness build。

yuuji への問いも brief で書かれている (「3D で走りたい」or「fitness build できれば視覚問わない」) が、yuuji の Zwift Climb Portal 実走履歴を見ると「**3D で走りたい (Climb Portal の体験を求めている)**」は既に Zwift で満たされた経験あり、つまり「Zwift では物足りないから自作」ではなく「Zwift で既に十分」が真実。

---

## yuuji の真の goal 推定

過去履歴と発話から 3 つの可能性を順位付け:

### 順位 1 (推定確度 60%): fitness build & 長期 PMC 管理が本音

根拠:
- strava-pmc-viewer を 2026-05 に集中開発、CTL/ATL/TSB の年度別チャート、forecast、advice 機能まで作り込み
- 2025-10-12 に 151km / 1941m elev / 7h15m の big ride、2026-04-28 から ride 再開 (4 本)、5月13日の発話で「5月12日のライドで ATL が 66 まで跳ね上がった」を観察
- 2013 年に 254km / 5048m elev の monster ride 記録あり、本気の cyclist だった過去
- FTP=200W、avg 87-129W に落ちている = 現在は recovery / rebuild phase

この goal なら **brief 全部不要**。Zwift サブスク再開 (もし切れていれば) + Climb Portal Mt.Fuji が rotation in する月を待つ + outdoor ride 継続 + strava-pmc-viewer で trend 管理、で 100% 達成。自作工数ゼロ、token 消費ゼロ。

### 順位 2 (推定確度 30%): engineering 道楽として「自分の training 道具を 3D で作る」

根拠:
- Ghostty Windows port の WinUI3 / D3D11 開発で 3D rendering 文脈に強い興味
- strava-pmc-viewer も自作、既存サービス (Strava 公式 PMC、TrainingPeaks 等) を使わない美学あり
- 「過去未来繋ぐ」class の自作系プロジェクトに執着 (skill-miner、places-map、agent-deck 等)

この goal なら brief 全体の前提を変える必要がある: 「training 道具」ではなく「engineering 作品」として brief を書きなおす。富士ヒル本番までに動く必要はない、6 月本番後にゆっくり育てる project として再定義。fitness は別経路 (Zwift Climb Portal) で確保、自作は技術的探求として並走。

### 順位 3 (推定確度 10%): 富士ヒル本番完走の体験を 3D で**先取り**したい

根拠: brief 00 の「富士ヒル本番に向けて 5-10 回 室内 training で同コースを走る」記述、yuuji が公式 QR から GPX を取得した行動。

この goal でも答えは **Zwift Climb Portal Mt.Fuji**。25.6km / 勾配色分け / 10 セクション分割表示、yuuji の Strava 履歴に Climb Portal 実走実績あり = 体験を既に評価済み。これ以上の 3D 体験を自作で 5 日で出すのは事実上不可能。

---

## user value 最高の brief / 薄い brief

### 最高: brief 06 (UX) と brief 08 (データ pipeline)

- brief 06 は ride 中の集中環境を理解した UX 要件、これは Zwift / Rouvy の選定基準にもそのまま使える
- brief 08 は ride データの長期蓄積、strava-pmc-viewer との接続 path が見える、ride を「過去未来繋ぐ」class に組み込む設計

ただし両者とも「自作する場合の」要件、自作前提なしでも価値があるのは brief 08 (Zwift 経路でも .fit が strava-pmc-viewer に流れる pipeline は同じ価値)。

### 薄い: brief 01 / 02 / 04 / 07

- brief 01 (MVP 定義) は trainer 機種未確認のまま走り出している
- brief 02 (architecture) は 3 process 構成が ride UX に対して脆い
- brief 04 (3D viewer) は Zwift Climb Portal の劣化版を作っている
- brief 07 (deploy) は Local web app 推しが ride UX に対して脆い

これら 4 本は「自作する」を所与とした内部最適化、user value 軸では「やめろ」が正しい。

---

## 着地推奨

yuuji の本音が**順位 1 (fitness build)** なら、以下の順番で動け:

1. **30 秒で確認**: yuuji の Zwift サブスク status (継続中 / 解約済み)、trainer 機種 (FTMS 対応 / 非対応 / 所有していない)
2. **5 分で確認**: Zwift Climb Portal Mt.Fuji の次回 rotation schedule (zwiftinsider.com/climb-portal-schedule)、現在 available なら即実走
3. **10 分で実走**: Zwift サブスク継続 + trainer 接続 + Climb Portal Mt.Fuji を 1 セッション完走、Strava に自動 upload、strava-pmc-viewer で TSS / CTL 反映を確認
4. **以後**: 富士ヒル本番 (6 月末) までの 5-10 セッションを Climb Portal Mt.Fuji + Tour of Watopia (FTP build) + outdoor で組む、strava-pmc-viewer で trend 管理

この path の総工数: **30 分 (確認) + Zwift ride 時間** のみ。自作部分ゼロ、brief 01-09 は廃止。

yuuji の本音が **順位 2 (engineering 道楽)** なら、富士ヒル本番との紐付けを切り、別プロジェクト「3D ride viewer (= Zwift の OSS 代替を作ってみる)」として brief を書き直せ。富士ヒル本番への training は順位 1 と同じ Zwift 経路で並走、自作は趣味として 6 月以降ゆっくり進めろ。

yuuji の本音が **順位 3 (本番先取り体験)** なら、これも Zwift Climb Portal Mt.Fuji で達成可能、自作部分ゼロ。

**brief 10 の案 1-2 を 30 分で確認** が brief 群の自己評価でも最短 ROI、本 review はそれに「**Zwift Climb Portal Mt.Fuji 自体を確認**」を追加する。これが順位 1-3 すべての答え。

---

## まとめ

11 本の brief は内部一貫性が高く、技術的にも筋が通っているが、**「Zwift では富士ヒル走れない」という brief 00 の出発点が事実誤認**。Zwift Climb Portal Mt.Fuji が 2024-04 から存在、yuuji 自身が 2023 年に Climb Portal 機能を実走済み。この事実が brief 群に反映されていないため、自作前提の議論が全て the wrong question を解いている。

user value 軸での着地: **Zwift サブスク + Climb Portal Mt.Fuji + strava-pmc-viewer** で順位 1-3 全部の goal を達成、自作工数ゼロ。brief 10 の案 1 (QZ) ですら不要、Zwift 単体で完結する。

それでも自作したい (= 順位 2 の engineering 道楽) なら、富士ヒル本番との紐付けを切って「別プロジェクト」として再定義、6 月本番後に育てる前提で brief を書きなおせ。training 道具と engineering 作品は別レイヤー、混ぜると training が engineering に食われて 6 月本番に間に合わない。

最終的な yuuji への問い 3 つ:

1. Zwift サブスク継続中か?
2. 2023 年の Climb Portal Bealach na Ba / Col de la Madone 走った記憶あるか? Climb Portal Mt.Fuji を知っているか?
3. 富士ヒル本番に向けた training 道具が欲しいのか、それとも「自分で 3D viewer を作る」engineering 作品が欲しいのか?

この 3 問への回答で brief 全廃 / 継続 / 再定義が 5 分で決まる。
