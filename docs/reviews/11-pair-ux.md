---
review: 11-pair-ux
reviewer_axis: UX / UI (overlay 出現タイミング、click 数、再接続動線、既存 panel との重なり、ride 中の集中破り)
date: 2026-05-14
target_brief: 11-pairing-in-app.md
verified_via: brief 11 全文 + brief 06 (UX 上位仕様) + 既存 viewer (web/index.html + web/viewer.js)
---

# Brief 11 ペアリングフロー UX / UI レビュー

## はじめに

このレビューは brief 11 を「user value で必要か」「技術選定が妥当か」ではなく、**yuuji が ride 直前 / ride 中に画面の前に座っていて、目と手で何をどう動かすか**だけで見る。集中環境 50-90 分、扇風機 ON、bike 固定済み、汗で手が滑る、視線は基本 Cesium 視点、HUD は隅でちらり読む ── brief 06 で yuuji 自身が書いた条件。

結論を先に書く。**採用方針 (= bridge.py 経由 WebSocket protocol 拡張) は UX として妥当、ただし overlay デザインと挙動に 5 個の地雷がある。** いずれも実装着手前に直せる、直さないと「200ドル払って 200ドル損」class に届く。

主な地雷:
1. 起動時自動 scan + overlay 自動表示は「未接続時のみ」と書いてあるが、判定タイミングが曖昧 (WebSocket open 直後? 5 秒 timeout? device 接続済み state 受信時?) で、毎起動 1.5 秒 overlay がチカっと出る挙動になる risk
2. Scan → 候補 click → 接続待ち の 3 step は許容範囲だが、「接続待ち」状態の視覚 feedback が同 overlay 上で起きる設計だと、yuuji が「あれ進んでる? 止まってる?」で迷う risk
3. ride 中の自動 reconnect 3 回 (3/6/12 秒) は最大 21 秒 + 失敗判定、その間 modal 出しっぱなしだと「集中切れて再開できない」(brief 06) を確実に踏む
4. 「Skip = dummy mode」を一般 user に見せる UI に置くと、yuuji が ride 開始時に 1 click 間違えて dummy で走る事故
5. 既存 panel (右上 status / 左下 HUD / 右下 controls / 左上 minimap) との関係が brief で z-index 最上位とだけ書かれていて、overlay 閉じた後の **接続状態の常設表示**設計が抜けている

以下、レビュー観点ごとに詳述する。

---

## 1. Setup overlay の出現タイミング

### brief の記述
- 「起動時自動 scan、未接続なら表示」
- 「page reload で connection 切れる → bridge 側は state 保持、新 WebSocket 接続で current_state を即送り返し、overlay を skip 可能」(リスク回避 4)

### 実物の動線で起きること

yuuji が `localhost:8000/` を開くと、web app は:
1. course.json fetch (現実装は数百 ms)
2. Cesium 起動 + world terrain async fetch (現実装で 2-5 秒)
3. WebSocket `ws://localhost:8765` 接続試行 (現実装、open まで数十 ms 〜接続失敗で数秒 timeout)

ここで brief 11 が言う「起動時 scan」を**どの瞬間に発火するか**が決まっていない。3 つの候補がある:

- **(a) DOMContentLoaded 直後**: overlay は最初から表示、ws open まで「Connecting...」、open したら scan 送信
- **(b) WebSocket open 直後**: 普段は何も出ない、open → bridge 状態問い合わせ → 未接続なら overlay 表示
- **(c) bridge 側が「未接続 state」を push してきた時のみ**: viewer 側は受動的、bridge が「接続済み」を返したら overlay 出さない

brief は (c) を意図しているように読めるが (= リスク 4 の current_state 設計)、明文化されていない。実装担当 AI が (a) を選ぶと、**毎起動 1.5 秒間 overlay が必ずチカっと出てから消える** という最悪 UX になる。yuuji が training session 前の 5-10 回起動するたびにこれを踏む = 10 秒 / session × 10 session = 100 秒の visual flash 累積、accumulation harm。

### 推奨

brief に追記しろ。

> overlay 表示判定: viewer 起動時は overlay **非表示**から始める。WebSocket open 後 bridge から `{type: "current_state", connected: bool, device: {...} | null}` を必ず最初に送らせる。`connected: false` を受け取った時のみ overlay 表示。`connected: true` なら overlay は出さず、status panel に device 名を表示するだけで ride 開始可能。

これは brief リスク 4 の延長で書けば 2 行で済む、けど書かないと事故る。

---

## 2. Scan → click → 接続 の click 数と feedback

### brief の記述

```
[ Scan ]   状態: scanning...
検出された機器:
  Wahoo KICKR    rssi -45
  Tacx Neo       rssi -67
```
- 起動時自動 scan、5 秒後 list 表示
- list 項目クリック → 接続試行、進捗は同 overlay に「Connecting to KICKR... (3s)」

### click 数評価

ride 開始までの click は **1 click (FTMS device 行をタップ) + 接続成立待ち** = 富士ヒル training の前段として完全に許容範囲。これは brief 06 の「1 click で富士ヒル始める」とほぼ整合 (厳密には 2 click: device 選択 + ride 開始だが、device 選択は毎回必須ではない、これは項 1 で書いた「(c) connected で overlay 出さない」が成立すれば click 数ゼロ)。

trainer の電源を ride ごとに切るとして:
- 電源 ON → trainer の BLE 起動 (現実装で 2-3 秒)
- viewer 起動 → ws open → bridge が「未接続」push → overlay 表示
- yuuji が overlay の Scan を待つ (= 自動 scan が走る、5 秒)
- list に KICKR 出現、yuuji が 1 click
- 接続成立まで 3-5 秒
- overlay 閉じる、ride 開始

合計 15-20 秒、これは brief 11 が言う「現状 5-7 分」から見て劇的改善、合格。

### feedback 設計の地雷

問題は「scan 中」「connect 中」の **視覚 feedback が同 overlay 上で起きる**こと。brief は:
- Scan ボタン押下 → 「状態: scanning...」テキスト変更
- list 項目 click → 「Connecting to KICKR... (3s)」テキスト変更

これは text-only feedback、yuuji が ride 準備で目線を Cesium 側に移している瞬間に状態遷移すると気付けない。さらに「(3s)」のカウントアップが意味不明 (経過秒? 残り秒?)。

### 推奨

brief に追記しろ。

> overlay の状態遷移は text だけでなく **panel 自体の枠色** で示す:
> - scan 中: panel 枠 黄 (= action 中)
> - 接続中: panel 枠 シアン (= 待機中、Cesium の rider marker と同色)
> - 接続成立: panel 枠 緑、0.5 秒見せてから fade out
> - 失敗: panel 枠 赤、テキストで失敗理由

> 「(3s)」表記は「scan: 残り 3 秒」のような明示的 label にする。connect は経過秒、scan は残り秒で意味が逆だから両方ラベルする。

これで yuuji が視線を別所に向けていても、画面端の色変化で状態遷移に気付く (= glance で読める設計、brief 06 規約)。

---

## 3. ride 中の切断 → 自動 reconnect の最大時間

### brief の記述

- 切断検知 → overlay 再表示、自動 reconnect を 3 回試行 (3/6/12 秒間隔)、全失敗で手動選択
- 「overlay 表示中に裏の Cesium viewer が描画停止しない」(失敗してはいけない UX 1)

### 数字を直視

3 + 6 + 12 = 21 秒の reconnect 試行 + 各試行の connect timeout (brief 11 リスク 1 で 5 秒設定) = **最大 21 + 5 × 3 = 36 秒**、つまり trainer が一時的に sleep して再起動するまでの間、overlay は 36 秒間 modal として画面中央に出続ける。

brief 06 で yuuji 自身が書いた「ride 中に application crash する → 集中 broken、yuuji 激怒」と同 class の harm。modal 36 秒は crash ではないが、視線を景色から強制的に剥がす点で集中 break は同じ。trainer の電源不安定 (= USB 給電の電圧降下、よくある) で複数回踏むと、ride 1 回で 1-2 分が overlay に食われる。

### Cesium 視点との関係

brief は「裏で Cesium 描画停止しない」と書いているが、**modal が中央に大きく出ていれば描画が動いていてもそれは『見えない』** = 集中環境では事実上の停止と同義。さらに z-index 最上位 (brief 失敗 UX 2) で出すと景色全体が暗く半透明 mask で覆われる、これは「視点酔いで気持ち悪くなる」(brief 06) の引き金にもなる。

### 推奨

brief を**根本的に書き直せ**:

> 切断検知時の動作 (旧):
>   - overlay を画面中央に modal 再表示、reconnect 3 回試行 (最大 36 秒)
>
> 切断検知時の動作 (新):
>   - **画面中央の modal を出さない**。右上 status panel を赤 ✕ に変える + 「切断中、再接続試行 1/3」だけ表示
>   - Cesium 描画は継続、playSpeed は最後の bridge 値を保持 (= 同速で進む)、または test mode 30 km/h に fallback
>   - reconnect 全失敗 (= 21 + 15 秒経過) して初めて中央 modal を出す、それまでは右上 panel だけ
>   - yuuji 自身が止めたい時 (= 給水で trainer 電源切る等) は右下 controls の pause ボタンを押す、これは brief 11 の scope 外、既存 UI で対応済み

これで切断が「即 modal で集中破り」から「右上の小さな赤マーク」に格下げできる。yuuji が気付くなら気付く、気付かなくても景色は止まらない、これは brief 06 「glance で読める」の正しい実装。

---

## 4. 「Skip = dummy mode」ボタンの隔離

### brief の記述

```
| Skip (dummy mode で続行)      |
```
「Skip」で dummy mode 継続 (= 開発時 / trainer なし demo 用)

### 問題

yuuji の運用は実機 trainer (smart trainer + bike) を持っている前提、dummy mode は brief 11 内でも「開発時 / trainer なし demo 用」と書いている。つまり ride 開始 UI の中に **開発専用 button** が混ざっている状態。

ride 開始時の動線で起きること:
- yuuji が training に集中したい、trainer は電源 ON 済み
- overlay が出る、scan に時間がかかる (= 5 秒)
- yuuji が「待つの面倒」と感じて Skip を押す
- dummy mode で ride 開始、playSpeed = 30 km/h 固定で勝手に進む
- 5 分後 yuuji が気付く「あれ、ペダル踏んでないのに進んでる」
- ride 廃棄、再起動

これは brief 06 「設定画面に辿り着くのに 5 click 必要」と対の失敗、**「間違えて押せる場所に開発 mode が置いてある」**。

### 推奨

brief に追記しろ。

> dummy mode は UI から削除し、URL クエリパラメータでのみ起動可能にする (`localhost:8000/?dummy=1`)。これで開発者 (yuuji 自身) は brief 11 の動作確認で叩ける、ride 開始時の通常 UI には現れない。「scan が遅い」「device 見つからない」は overlay 上の文字でだけ案内する、Skip ボタンを置かない。

または:

> overlay の Skip ボタンは「scan list が空 (= BLE 機器 0 検出) のとき」のみ表示する、機器が 1 つでも検出されていれば表示しない。これで yuuji が「KICKR 見えてるけど面倒で skip」を物理的にできなくする。

後者の方が dev 動線も維持できて推奨。

---

## 5. 既存 panel との重なり / overlay 閉じた後の常設表示

### 既存 UI レイアウト (確認済み、`web/index.html` より)

```
+------------------------------------------+
| minimap (左上, 320x720)         status (右上) |
|                                            |
|     (Cesium full screen)                   |
|                                            |
| HUD (左下)                  controls (右下) |
+------------------------------------------+
```

### brief の記述

- overlay は modal、z-index 最上位
- 接続成立で overlay hide
- ride 中の切断で overlay 再表示

### 抜けている設計: 接続成立後の接続状態どこに表示?

brief は overlay を「未接続時に出して接続したら閉じる」設計だが、**overlay 閉じた後に「今 KICKR と繋がっています」がどこにも表示されない**。yuuji が ride 中に「今 trainer 繋がってる? 数字本物?」と疑問を持った時、確認手段がない。

現状 viewer.js は HUD の speed 表示で「20.0 km/h (bridge)」「20.0 km/h (test)」を出している (viewer.js:539)、これは bridge 接続有無しか分からない。**device name や信号強度は HUD にも status にも minimap にも出ない**。

### 推奨

brief に追記しろ。

> 接続成立後の常設表示は、既存の右上 `#status` panel を流用する:
> - 接続済み: `KICKR ●` (緑 dot)
> - test mode: `(bridge なし)` (灰色)
> - 切断中: `KICKR ✕ 再接続 1/3` (赤 dot)
> - 信号強度は表示しない (yuuji が ride 中に rssi を見て判断する場面がない、UI 密度上げて値ゼロ)
>
> HUD は変更しない (距離 / 標高 / 勾配 / speed のみ、brief 06 の「残距離 / 現在勾配 / 標高 を大きく」を維持)。
> 切断時の左下 minimap や右下 controls には触らない、Cesium も止めない。視覚 feedback は右上 status の 1 箇所に集約。

これで:
- ride 中 yuuji は右上をちらり見れば接続状態が確認できる
- 既存 4 panel (minimap / status / HUD / controls) の役割分担が明確
- 切断時の状態変化が右上だけに局所化、視野全体には影響しない

### z-index の指定

brief は「overlay の z-index を最上位、controls (右下) より上」とだけ書いている。具体的な数値が抜けている、実装担当が `z-index: 9999` とかを書いて controls (`z-index: 999`) との段差が雑になる。brief に明記:

> overlay の z-index は 1000 (= controls / hud / status / minimap の 999 + 1)。半透明背景の rgba は 0.5 以下 (= Cesium 景色が透けて見える、brief 06 「視点酔い」回避)。

これで「ride 中に切断 modal が出た瞬間に景色が全部黒くなって視点酔い」を防ぐ。

---

## 6. 補足: 接続失敗時のエラーメッセージ

brief リスク 2:
> trainer の prior pairing — Zwift 等が pair 済の trainer は scan に出るが connect 失敗、エラーメッセージで「他アプリ停止してから」と表示

これは正しいが「他アプリ停止してから」だけだと yuuji が具体的に何を停止すべきか分からない。Zwift / Wahoo Fitness / TrainerRoad / iOS Wahoo / Garmin Express など複数 candidate がある。

推奨:
> エラーメッセージのテンプレ:
>   - 「接続失敗: 他アプリが KICKR を使用中の可能性。Zwift / Wahoo Fitness / TrainerRoad を全て終了してから再試行してください」
> 具体的アプリ名を列挙する。汎用「他アプリ」では yuuji が判断できない。

これは brief 11 を 1 行修正で済む。

---

## まとめ

brief 11 の方向性 (= bridge.py 経由 WebSocket 拡張、overlay UI でペアリング完結) は yuuji の ride 動線に対して妥当、現状の 5-7 分ロスを 15-20 秒に圧縮できる見込み。

ただし以下 5 点を実装着手前に brief に追記しないと、UX 軸で別種類の地雷を作る:

1. **overlay 表示判定**: WebSocket open → bridge から `{type: "current_state"}` 受信 → `connected: false` の時のみ表示。デフォルト非表示開始。
2. **scan / connect の視覚 feedback**: panel 枠色 (黄 / シアン / 緑 / 赤) + 残り秒 / 経過秒の明示 label。
3. **ride 中の切断 modal を抑制**: 中央 modal を出さず、右上 status panel の色だけ変える。reconnect 全失敗時のみ中央 modal。
4. **Skip ボタンの隔離**: URL クエリ `?dummy=1` でのみ dummy mode、または scan list 空のときだけ表示。ride 開始 UI の通常状態に Skip を置かない。
5. **接続状態の常設表示**: overlay 閉じた後は右上 status を流用、`KICKR ●` / `(bridge なし)` / `KICKR ✕ 再接続 1/3` の 3 状態。HUD には触らない、Cesium も止めない、信号強度は出さない。
6. **(補足)** エラーメッセージで具体的アプリ名を列挙、z-index = 1000、半透明背景 rgba 0.5 以下。

これらを反映しなくても brief 11 は「動く」が、ride 中 1 回切断するだけで 36 秒の中央 modal が yuuji の集中を破る、毎 ride で踏めば 6 月本番までに「web app より Zwift の方が静かでいい」と乗り換える force が確実に生まれる。書き換える価値あり、実装前に 30 分修正で済む。

最大の地雷は 3 (ride 中切断 modal の 36 秒)、次が 4 (Skip 誤押) と 1 (起動時チカ)。優先順この 3 つだけでも踏み潰せば、UX 軸は合格まで届く。

---

DONE: 11-pair-ux
