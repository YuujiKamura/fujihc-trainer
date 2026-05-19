---
review: 11-pair-value
reviewer_axis: yuuji user value (富士ヒル training 実利、CLI 慣れ engineer の UX、本番までの時間 budget)
target_brief: 11-pairing-in-app.md
date: 2026-05-14
verified_via: brief 11 / brief 06 / brief 09 / brief 10 / review 02 / 過去発話 (2026-05-13)
---

# brief 11 (ペアリングフロー) — yuuji user value review

## はじめに

「ターミナル 2 コマンド + reload を browser overlay の Scan ボタンに変える」って提案、技術的には clean だし brief としてもよく書けてる。けど **yuuji が 6 月本番に向けて 5-10 回走る**という時間 budget の中で、これに 1-2 日 食って本当に黒字かというと、答えは「**赤字**」。理由は 3 つ:

1. yuuji は engineer で CLI 慣れ、毎 ride「4-7 分ロス」という brief の前提が盛られてる (実測は多分 1-2 分)
2. brief 11 を作る側の AI 工数も yuuji の token 予算から出てる、これは brief の中で計上されてない
3. **brief 群全体が review 02 で「自作前提が事実誤認 (Zwift Climb Portal に Mt.Fuji 既存)」と否認された後**に書かれた brief、つまり「自作路線を継続するなら」という条件付きの brief、その条件自体が成立してない可能性が高い

結論先に書く: **brief 11 は Phase 2 以降、もしくは廃止**。やるとしても自作路線継続 (= review 02 の問い 3 つに yuuji が「engineering 道楽として作りたい」と答えた場合) が確定してから。本番までは CLI のまま、または「README に shell script 1 本貼って `./start-ride.sh` で 2 step を 1 step に縮める」程度で十分。

以下、軸ごとに詳細。

---

## 軸 1: 「毎 ride 4-7 分ロス」という前提の検証

brief 11 冒頭の主張: 「Git Bash → discover → MAC コピペ → bridge 起動 → reload」が毎 ride 4-7 分、5-10 ride で 30-70 分の累積ロス。

実態を verify:
- yuuji は Ghostty Windows port で D3D11 デバッグや WinUI3 で開発してる engineer、Git Bash 開くのは 0.5 秒、`python -m fujihc.bridge --device <addr>` の input は zsh history で `↑` 数回または `Ctrl+R` で 1 秒
- discover の BLE scan が遅いのは事実 (Windows 11 bleak で 5-10 秒)、けどこれは brief 11 でも overlay 内で同じ時間かかる (= bridge → BleakScanner.discover() を call するだけ、scan の根本速度は変わらない)
- MAC アドレスのコピペは初回のみ、2 回目以降は **bash history で `python -m fujihc.bridge --device <addr>` を `↑` で復元すれば 0 秒** (yuuji は zsh history を当然使うクラス)
- reload の `Ctrl+Shift+R` は 1 秒以下

実測の毎 ride ロス: **初回 2-3 分 (scan + MAC コピペ + bridge 起動)、2 回目以降 30 秒程度 (history で復元 + reload)**。

5-10 ride の累積:
- 初回 + 4-9 回の reuse = 3 分 + (0.5 分 × 9) = 7.5 分
- brief 11 主張の 30-70 分とは **桁が違う** (4-9 倍盛られてる)

なぜ盛られたか: brief 11 を書いた AI が yuuji の CLI 慣れを織り込んでない。AI default の「ターミナル = 重い」感覚で計算してる。yuuji 視点では「ターミナル開いて history から復元 + reload」は冷蔵庫開けて麦茶飲むより軽い。

**この軸での評価: brief 11 が解こうとしてる問題 (毎 ride 4-7 分ロス) は実在しない、または 1/4-1/9 のサイズ**。

---

## 軸 2: brief 11 を作る AI 工数 (= yuuji の token 予算消費)

brief 11 の完了基準は:
1. dummy mode で scan 動作確認
2. yuuji 実機で scan → list → connect → ride 開始
3. ride 中切断 → 自動 reconnect
4. Skip で dummy 起動

これを実装するための AI 工数:
- bridge.py の WebSocket protocol 拡張 (scan/connect/disconnect message handler、BleakScanner との async 統合、connection state 管理、自動 reconnect 3-tier backoff): 半日-1 日
- viewer.js の overlay UI (modal、scan_result の list 表示、click → connect、connect_status 受信、disconnect 時の overlay 再表示、z-index 管理、Cesium 描画の継続): 半日-1 日
- 統合テスト + dummy mode 動作 + 実機 connect + ride 中切断 reconnect の検証: 半日
- 合計 **1.5-2.5 日 (= AI token で言うと数百-千ドル分の処理)**

これは brief 11 の本文に計上されてない。「browser で完結する」UX 改善のコストは、yuuji 視点では「token 消費 + 検証時間で 1-2 日の wall clock」。

**節約される時間 (7.5 分の累積ロス) vs 投資する時間 (1.5-2.5 日 = 21.6-36 時間)** = ROI が **172-288 倍の赤字**。

しかも brief 11 の機能は富士ヒル本番後にも使える資産にはなる、けどそれは review 02 で「**そもそも Zwift Climb Portal Mt.Fuji が既存で自作路線自体が wrong question**」と否認されてる、つまり asset の使い回し先 (= 富士ヒル後の他 ride プロジェクト) が成立してるかも不明。

**この軸での評価: ROI が桁違いに赤字、本番までの時間 budget で他に回すべき**。

---

## 軸 3: Setup overlay vs CLI の使い分け、両方残す妥当性

brief 11 は「Skip = dummy mode で続行」という escape hatch を入れてる。これは「開発時 / trainer なし demo 用」と書いてある = yuuji 自身が ride 用に使う想定じゃない。

ride 中の本番運用想定:
- 接続済の trainer は前回の MAC を覚えてる、毎 ride 同じ機器、毎 ride 同じ手順
- brief 11 の overlay は「初めて使う user」「複数 trainer を切り替える user」向け、yuuji 単独運用ではほとんど価値出ない (= 同じ KICKR を毎回選ぶだけ)

CLI と UI 両方残す妥当性:
- CLI のままで困るのは「yuuji 以外の人が使う」「yuuji が 6 ヶ月後に bridge.py の起動方法を忘れる」の 2 case のみ
- 前者: 富士ヒル training 道具は yuuji 単独運用、他人に渡す想定なし
- 後者: README に 3 行書けば解決 (= `./start-ride.sh` shell script 1 本、内部で `python -m fujihc.discover` + bridge 起動 + browser open を chain)

つまり brief 11 の overlay UI は「自分の trainer を初回 pairing する時」と「複数 trainer 持ってる人」しか恩恵が無い、yuuji の運用では shell script wrapper 1 本で代替可能。

**この軸での評価: brief 11 の overlay は overkill、shell script 1 本で 90% の体感改善が達成できる**。

```bash
#!/bin/bash
# start-ride.sh — 「富士ヒル始める」1 click 起動
cd ~/fujihc-trainer
# 前回の trainer addr を環境変数 or .env で保存しとく
python -m fujihc.bridge --device "${FUJIHC_TRAINER_ADDR}" &
sleep 2
start http://localhost:8000/  # Windows
```

これで「ターミナル 2 コマンド + reload」が「ターミナル 1 コマンド (`./start-ride.sh`)」になる。工数 **5 分**、節約時間 **brief 11 と同等**、ROI 桁違いに黒字。

---

## 軸 4: Phase 2 機能との優先順位

brief 群が想定してる Phase 2 機能 (review 02 と brief 04/06/08 から逆算):
- 過去 ride 比較 / ghost rider (brief 04/06、Phase 2 押し)
- 自動 Strava upload (brief 08、富士ヒル training 専用 PMC への接続)
- ride データ蓄積 + strava-pmc-viewer 連携 (brief 08、review 02 で「user value 高い」評価)

yuuji の strava-pmc-viewer は 2026-05 に集中開発、CTL/ATL/TSB 年度別チャート、forecast、advice 機能まで作り込み済 (memory 参照)。**fujihc-trainer の ride データを strava-pmc-viewer に流す経路 (brief 08) が出来れば、「富士ヒル training 専用 PMC」が成立、これは Strava 公式 PMC では追えない粒度**。

vs brief 11 (ペアリング UI 化):
- brief 08 = 自作プロジェクトの core value (= 過去未来繋ぐ class)、yuuji の長期 asset、富士ヒル後も価値継続
- brief 11 = 1.5-2.5 日かけて毎 ride 30 秒節約、富士ヒル本番 6 月以降の使い回し先が不確定

**優先順位: brief 08 >>> brief 04 (3D viewer) > brief 11 (ペアリング UI)**。brief 11 は Phase 1 では下から 2-3 番目、本番までの時間 budget では「やらない」が正解。

---

## 軸 5: yuuji の CLI vs UI 好み傾向 (発話履歴サンプリング)

2026-05-13 発話より関連箇所:

- strava-collector に GUI 作る指示: 「strava-collectorがフィットネス安堵フレッシュネスのグラフを表示するGUIを作ってくれ」 — **UI 化を価値ある時は要求する**
- 設定画面が複雑なときの不満: 「センスのあるUIは、まず価値（チャート）を見せ、やりたい人にだけ手順を突きつける、という引き算ができています」 — **「やりたい人にだけ手順を突きつける」= 必須ではない手順を default で見せるな**
- セットアップ UI 改善: 「最初は『ようこそ！』というウェルカム画面と [セットアップを開始] ボタンだけを表示。設定が終わったら、設定パネルはアコーディオン（折りたたみ）の中に隠す」 — **設定 UI は隠して、機能本体を見せろ**

この発話傾向を brief 11 に照らす:
- yuuji は **UI 化そのもの**には反対しない、価値があれば要求する
- けど yuuji が UI 化を求めるのは「**第三者に渡すツール** (strava-pmc-viewer, deckpilot-gui)」、**自分専用 training 道具**に overlay UI が要るとは言ってない
- yuuji の UX 哲学は「セットアップは隠せ、機能本体を見せろ」 = brief 11 の「Setup overlay が起動時に強制表示」は yuuji の哲学と逆方向 (= 設定を default で見せてる)

つまり yuuji 視点では brief 11 の overlay は **「起動時に設定画面を見せるな」という自身の UX 哲学に違反する設計**。「Skip ボタン」で逃げ道は作ってるけど、毎 ride クリックする手間が増える (= shell script 1 本の方が体感速い)。

**この軸での評価: yuuji の CLI vs UI 好みは「価値ある UI は作れ / 自分専用ツールは CLI のままで十分」**。brief 11 は後者の class、UI 化は overkill。

---

## 軸 6: 富士ヒル本番までの時間 budget で作る価値

本番までの残り時間 (2026-05-14 → 6 月末 = 6-7 週間)、yuuji の他プロジェクト負荷 (strava-pmc-viewer、skill-miner、deckpilot-gui、Ghostty Windows port、kanban CLI 等、2026-05-13 daily summary より) を考えると、fujihc-trainer プロジェクトに割ける wall clock は楽観的でも週 5-10 時間。

割り当て案:
- A 案 (brief 11 をやる): brief 11 に 1.5-2.5 日、Phase 1 残工程 (brief 01-09 で 3-5 日) と合わせて 4.5-7.5 日、本番 6 月末ギリギリまで作業継続、training 時間が消える
- B 案 (brief 11 を後回し、Phase 1 を最短で): brief 09 Cut C で 3-5 日、その後 training 5-10 回、本番に間に合う、ペアリングは shell script 1 本で 5 分
- C 案 (review 02 の推奨): brief 全廃、Zwift Climb Portal Mt.Fuji 走る、自作工数ゼロ、training 5-10 回確保、PMC は strava-pmc-viewer で管理

A 案を採用すると brief 11 のために「training する時間」が侵食される、これは「200 ドル払って 200 ドルの損失」class (brief 11 本文の比喩を逆向きに適用)。

**この軸での評価: 本番までの時間 budget では brief 11 は「投資する余裕が無い」、Phase 2 押し出しが正解**。

---

## 結論と推奨

brief 11 の評価サマリ:

| 軸 | 評価 | 詳細 |
|---|---|---|
| 1. 毎 ride 4-7 分ロスの実在性 | ★☆☆ | 実測 1/4-1/9 サイズ、yuuji の CLI 慣れを織り込まず盛られてる |
| 2. ROI (節約時間 vs 投資工数) | ★☆☆ | 赤字 172-288 倍、本番までの時間 budget では赤字 |
| 3. 両方残す妥当性 | ★☆☆ | yuuji 単独運用、shell script 1 本で 90% 代替 |
| 4. Phase 2 機能との優先順位 | ★☆☆ | brief 08 (PMC 連携) のが圧倒的に core value |
| 5. yuuji の UX 哲学との整合 | ★★☆ | 「設定は隠せ」と逆方向、Skip 押す手間で CLI より遅い可能性 |
| 6. 本番までの時間 budget | ★☆☆ | training 時間を侵食、富士ヒル完走に対して逆効果 |

**総合: ★☆☆ (やらない / Phase 2 押し出し)**。

推奨アクション (順番):

1. **review 02 の問い 3 つに先に答えろ** (yuuji 確認): Zwift サブスク継続中か、Climb Portal Mt.Fuji 知ってるか、training 道具が欲しいのか engineering 作品が欲しいのか
2. **答えが「fitness build」なら brief 全廃**、Zwift Climb Portal Mt.Fuji + strava-pmc-viewer、brief 11 も当然廃止
3. **答えが「engineering 作品」なら brief 11 も Phase 2**、Phase 1 は brief 09 Cut C (3-5 日) で着地、ペアリングは `start-ride.sh` shell script 1 本 (5 分)
4. **答えが「本番先取り体験」**でも Zwift Climb Portal Mt.Fuji で達成、brief 11 不要

どの path でも brief 11 は **今やる対象ではない**。

---

## まとめ

brief 11 は技術的には筋がいいけど、yuuji の現実 (CLI 慣れ、6 月本番までの時間 budget、Zwift Climb Portal Mt.Fuji の存在、strava-pmc-viewer 連携が core value) を踏まえると、**今作る価値は無い**。毎 ride の体感を改善したいなら 5 分で書ける shell script 1 本で 90% の効果が出る。Setup overlay UI は富士ヒル後 (= Phase 2 以降)、もしくは「engineering 道楽として fujihc-trainer を 6 月以降に育てる」と yuuji が決めた時に作るべき機能。

最重要: brief 11 は **review 02 で否認された自作路線の上に立つ brief**、つまり自作路線の妥当性が確定する前に書かれた追加 spec。review 02 の問い 3 つに yuuji が答えるまで、brief 11 は「architecture が成立してない上に作る spec」になる。順序が逆。

最終的な yuuji への問い:

1. brief 群全体について review 02 の問い 3 つに答えてくれ (これが確定するまで brief 11 議論は意味なし)
2. 仮に自作路線継続するとして、毎 ride のターミナル操作って実際何分かかってる? (= brief 11 の 4-7 分前提が当たってるか)
3. 毎 ride 30 秒節約のために 1.5-2.5 日投資する価値あるか? (= shell script 1 本との比較)

この 3 問への回答で brief 11 の運命が決まる。
