---
review: 11-pair-landing
axis: 着地可能性 / 工数
reviewer: landing reviewer (sub agent)
date: 2026-05-14
verdict: brief 通り全部入れると 6-9 日、本番に間に合うが「最後の 1 週」を喰う。**Phase 1.1 (scan + connect + Skip) を 3-4 日で landing、ride 中切断 / 自動 reconnect は本番後**に押し出すべき
---

# Brief 11 ペアリングフロー — 着地可能性 / 工数 レビュー

## はじめに

Phase 0 + Phase 1 は landed 済 (bridge.py / viewer.js / Cesium 3D / minimap)。
brief 11 は ride 開始の 4 ステップ (terminal → discover → bridge → reload) を
全部 browser に取り込むという ride-prep UX の改修。

結論: **brief の scope は本番までに着地はする、ただし scope が膨らんでいる**。
特に「ride 中切断 → 自動 reconnect 3 回」と「dummy ⇄ 実機 runtime switch」は
brief 全体の半分の工数を喰う。本番完走目的なら**これ 2 つは Phase 2 へ押し出せ**。

残り 17-23 日のうち、yuuji は本番直前 1 週は実走 training に振りたい (これは
スポーツ常識、本番前 7-10 日は taper period)。**実質 landing 可能期間は 10-16 日**、
そのうち本 brief に割けるのは多くて 4-5 日。これに収まる scope に切れ。

---

## 工数見積もり (初学者 + 楽観 2-3 倍)

yuuji の Python / WebSocket / DOM 経験: Phase 0+1 で bridge.py と viewer.js は
触っているので「初手」ではない (これは review 03 時点とは状況違う)。
ただし **bleak の async scan と WebSocket state machine 拡張は新規領域**。

| 部位 | brief 楽観 | **現実値** | 主な工数喰い要因 |
|---|---|---|---|
| bridge.py に WebSocket protocol 4 message 種追加 (scan / connect / disconnect / scan_result / connect_status / disconnected) | 0.5 日 | **1 日** | message 型定義 + json schema + viewer 側との往復 debug |
| bridge.py の async scan task + connection state machine (dummy ⇄ 実機 ⇄ disconnected の 3 状態) | 0.5 日 | **1.5-2 日** | state transition の race condition (例: scan 中に connect 来たらどうする) で必ず半日溶ける、asyncio.Task の cancel / cleanup 順序で 1 日溶ける可能性あり |
| viewer.js の overlay 起動・hide・再表示ロジック + setup modal の DOM 構築 | 0.5 日 | **1 日** | z-index 問題 (Cesium viewer の widget UI と被る)、Cesium が描画停止しない事の検証、再表示の trigger 条件 |
| index.html overlay の HTML/CSS (modal style、半透明背景、scan 進捗表示) | 0.3 日 | **0.5 日** | これは brief 通り、CSS だけなら早い |
| 接続 / 切断 / reconnect の error path + 視覚 feedback | 0.5 日 | **1.5 日** | 失敗パターンが多い (BLE adapter off / 他アプリ pair 済 / device 電源 off / timeout / write 失敗) 各々に user 向け文言、リトライ可否、overlay 表示の出し分け |
| dummy ⇄ 実機 mode runtime switch + 状態同期 (= Skip 後に再 scan / connect 可能、connected 後に dummy に戻る path) | 0.5 日 | **1.5-2 日** | **本 brief で最も risk 高い部位**。dummy_loop と ftms_loop を runtime で生成 / cancel する、self.dummy flag が起動時の判断から runtime 切替に意味変化する、既存 _push_loop が壊れない事を担保 |
| ride 中切断検知 + 自動 reconnect 3 回 (3/6/12 秒間隔) + overlay 再表示 | 0.5 日 | **2 日** | bleak の disconnect callback 設定、reconnect 中の bridge state、page reload で state 復元 (brief 4.) で記述あるが実装重い |
| 統合テスト (yuuji の trainer 実機必須) | 0.5 日 | **1 日** | trainer 電源 on/off cycle、reload、ペアリング干渉、複数 device 環境 |
| **合計** | **3.8 日** | **10-11 日** | (brief 楽観の 2.5-3 倍) |

「業務外趣味 4 時間/日」前提で 10-11 man-day = **暦上 2-3 週間**。
本番までの実質 landing 期間 10-16 日に**ほぼフルで喰い込む**、これは過剰。

---

## Phase 0/1 を壊さない段階導入順序

bridge.py / viewer.js は既に passing state。**1 PR / 1 step ごとに run-able を維持**
する切り方を以下に提案。

### Step 1 (0.5 日): protocol 拡張だけ先、no-op で着地

- bridge.py: scan / connect / disconnect / scan_result / connect_status の
  message 種を json 受信 / 送信できる構造だけ追加、handler は stub (log 出すだけ)
- viewer.js: 既存 WebSocket handler に新 message 種の case を追加、UI は触らない
- **既存 ride flow を一切壊さない**、test mode と dummy mode は今まで通り動く
- これだけで commit 1 本、verify は既存 flow が回ること

### Step 2 (1 日): scan の実装

- bridge.py: `{type: "scan"}` 受信で `BleakScanner.discover(timeout=6.0)` を別 task で実行
- scan 中は scan_result を待ち、完了で viewer に送信
- viewer.js: setup overlay の HTML 構築 (modal、scan ボタン、list 領域)、起動時表示
- **この時点では connect は未実装**、Skip ボタンで dummy mode に落とせる
- 検証: dummy mode bridge 起動 → viewer 開く → overlay 表示 → Scan → 空 list 返る (BLE adapter 無い場合) → Skip → 既存 ride 開始

### Step 3 (1.5 日): connect の実装 (= ここが峠)

- bridge.py: `{type: "connect", address}` 受信で **既存の `_ftms_loop` 相当を runtime 起動**
- 既存 bridge.py の構造変更が必要: `self.dummy` が起動時 flag → runtime state に意味変化
- 現実装の `run()` は dummy / ftms を起動時に決め打ち、これを「常に WebSocket 立てる + source は runtime で切替」に refactor
- 検証: yuuji の trainer 実機 → scan → list 表示 → click → connecting → connected → overlay 閉じる → 実機 speed が viewer に反映
- **この Step は必ず実機で 1 ride 動作確認、push しない**

### Step 4 (0.5 日): page reload 対応

- bridge.py: 新規 WebSocket 接続成立時に `{type: "current_state", connected: bool, address?, name?}` を即送信
- viewer.js: current_state.connected=true なら overlay skip、false なら scan から
- これで reload しても overlay 再表示なしで ride 続行可能

### Step 5 (Phase 2 に push 推奨): ride 中切断 / 自動 reconnect

理由は後述。

---

## 「絶対 MVP に入れちゃダメ」 scope creep 候補 ベスト 3

brief 11 の文面で `MVP として扱われそうだが本番完走目的には**過剰**` な機能を 3 つ。

### 1. ride 中切断 → 自動 reconnect 3 回 (3/6/12 秒間隔) + overlay 再表示

**工数: 2 日、価値: ride 中 trainer 電源 off になった時の救済**

- 実装重い: bleak の disconnect callback / reconnect 中の bridge state machine / 再接続 timeout / 失敗時の overlay 出し直し / Cesium が描画停止しないこと検証
- **発生頻度**: yuuji が室内で 5-10 ride 走る間に「ride 中切断」は起きるか?
  - trainer 電源は ride 中切らない (yuuji が物理的に触る必要)
  - BLE 干渉での切断は起きうるが、本番までに本当に発生するかは不明
- **代替案**: 切断検知だけ実装 (HUD に "DISCONNECTED" 赤表示)、自動 reconnect なし
  - 切断したら bridge を terminal で kill + 再起動、page reload で復帰
  - 工数 0.3 日 (HUD に状態表示するだけ)、これで本番完走目的は十分

**判定**: 自動 reconnect は Phase 2 へ。切断検知 + HUD 警告だけ Phase 1.1 に入れろ。

### 2. dummy ⇄ 実機 mode の runtime 切替 (= Skip 後にもう一度 scan / connect 可能)

**工数: 1.5-2 日、価値: 開発時 / demo 時の便利機能**

- 「Skip で dummy mode に入った後、もう一度 scan で実機に繋げる」は brief 文面に
  明示はないが、自然な expectation として滲み出ている
- 実装重い: dummy_loop と ftms_loop の lifecycle 管理、source_task の cancel / 再生成、state 同期
- **発生頻度**: 本番 1 ride 中に dummy ↔ 実機を切替えるか? = 0 回
- **代替案**: Skip = dummy mode、再 scan は bridge 再起動が必要 (page reload で setup overlay 再表示)
  - 工数 0.2 日 (実装はほぼ無し、UX 文言だけ)、本番完走目的は十分

**判定**: runtime switch は Phase 2 へ。「Skip 後の再接続は bridge 再起動」で十分。

### 3. page reload で connection state 復元 (= bridge 側が current_state を保持)

**工数: 0.5 日、価値: reload しても overlay が出ない**

- これは brief リスク回避 4. に書いてあるが、実は**復元しなくても困らない**
- Reload は yuuji が意図的にやる action、その時 overlay 出ても問題ない (Connected な
  device が list の先頭に出ていればワンクリックで再接続)
- **代替案**: 接続済 device address を localStorage に保存、次回 scan で先頭表示
  - 工数 0.2 日、UX は同等以上 (前回 device が分かる)

**判定**: bridge 側の current_state 保持は Phase 2 へ。localStorage で「前回の device」記憶 だけで実用十分。

---

## 番外: 4 番目の risk = scan 時の prior pairing 失敗

brief 文中 risk 2. に「Zwift 等が pair 済の trainer は connect 失敗」と書かれているが、
これは「他アプリ停止して」エラーメッセージで済むか?

- Windows 11 の BLE は「最後に pair したアプリが優先」、Zwift backgrounded でも掴んだまま
- user は Settings → Bluetooth → device → 削除 して再 pair が必要、これは「他アプリ停止」では済まない
- brief 11 の error 文言「他アプリ停止してから」は**現実より楽観**

**対策**: error メッセージを「Bluetooth 設定で trainer を一度削除してから再 scan」に
具体化、yuuji 自身が yuuji の trainer で 1 度踏むのを覚悟。これは Step 3 の検証時に実踏。

---

## 推奨着地経路 — Phase 1.1 = 3-4 日で本番に間に合わせる

### 必須 (Phase 1.1、3-4 日で landing)

1. Step 1: protocol 拡張 stub (0.5 日)
2. Step 2: scan + setup overlay + Skip (1 日)
3. Step 3: connect + 実機 1 ride 検証 (1.5 日)
4. Step 4: localStorage で前回 device 記憶、reload は overlay 再表示で OK (0.3 日)
5. 切断検知だけ実装 (HUD に "DISCONNECTED" 表示、自動 reconnect なし) (0.3 日)
6. error メッセージ整備 (BLE adapter / 他アプリ pair / timeout) (0.3 日)
7. **合計 3.9 日 ≈ 暦上 1 週間**

これで本番までに「terminal を 1 度起動するだけで、毎 ride の手間ゼロ」が実現。
本番直前 1 週は実走 training に振れる。

### 後回し (Phase 2、本番後)

- ride 中切断の自動 reconnect 3 回
- dummy ⇄ 実機 runtime switch
- bridge 側 current_state 保持
- 複数 trainer / HR / power meter 同時接続 (brief 既に Phase 2 記載)
- device 電池残量 (brief 既に Phase 2 記載)
- 接続履歴保存 (brief 既に Phase 2 記載)

---

## 検証チェックリスト (Phase 1.1 完了時)

実機 yuuji の trainer で以下を全部踏む:

- [ ] `python -m fujihc.bridge` 起動 (引数 `--device` なし、`--dummy` なし)
- [ ] browser で `localhost:8000/` 開く
- [ ] setup overlay が表示される
- [ ] Scan ボタンクリック → 5-10 秒で list 表示
- [ ] yuuji の trainer が list に出る
- [ ] 前回繋いだ device が list 先頭に出る (2 回目以降)
- [ ] click → "Connecting..." → "Connected" → overlay 閉じる
- [ ] ride 開始、HUD speed が trainer 実速度
- [ ] 勾配を 5% に変えて trainer の負荷が変わる事を体感
- [ ] trainer 電源 off → HUD に "DISCONNECTED" 表示 (自動 reconnect なし)
- [ ] bridge を kill + 再起動 → page reload → 再度 setup overlay → 再接続
- [ ] Skip ボタン → dummy mode で ride 開始可能
- [ ] BLE adapter off → scan が失敗 → error メッセージ表示
- [ ] yuuji の trainer が Zwift と先に pair 済 → connect 失敗 → 「Bluetooth 設定で削除してから」error 表示

---

## まとめ

- brief 11 を**書いた通り全部実装**: **10-11 日**喰う、本番に間に合うが余裕ゼロ、training 削る
- **Phase 1.1 = 必須 3 部位だけ landing**: **3-4 日**、本番直前 1 週を training に残せる
- **Phase 2 に押し出す 3 機能**:
  1. ride 中切断 → 自動 reconnect (代替: HUD に DISCONNECTED 表示)
  2. dummy ⇄ 実機 runtime switch (代替: bridge 再起動)
  3. bridge 側 current_state 保持 (代替: localStorage で前回 device 記憶)
- **段階導入順序**: Step 1 (protocol stub) → Step 2 (scan + Skip) → Step 3 (connect + 実機検証) → Step 4 (localStorage 記憶)
- **隠れ risk**: prior pairing 干渉 = brief 文言の「他アプリ停止」では済まない、yuuji が 1 度踏む覚悟必要

「自動 reconnect いる?」を**ride 中に 1 度も切れない**で答えるのが本番完走最短経路。
brief 11 を着地させる前に、この 3 機能を Phase 2 に押し出す判断を yuuji に確認しろ。

DONE: 11-pair-landing
