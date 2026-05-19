---
review: 11-pair-errors
reviewer_axis: エラー処理 / 失敗 mode (失敗時に user に何が見えるか、復帰経路はあるか、誤判定は起きないか)
date: 2026-05-14
target_brief: 11-pairing-in-app.md
verified_via: 既存 bridge.py / discover.py / viewer.js 実コード読解、Brief 01 (技術現実性レビュー) の bleak Windows hang 警告 (#789/#827/#1470) を参照
---

# Brief 11 失敗 mode レビュー

## はじめに

Brief 11 は「ペアリングを browser UI で完結」という UX 改善を狙うが、提案中の protocol/UX 仕様は「成功 path」が前面で「失敗 path」が「リスク + 回避」セクションに 4 項目しか書かれていない。一方で BLE pairing は **失敗 path のほうが日常**で、bleak の Windows 実装は Brief 01 が指摘した通り hang / pairing 拒否 / 占有競合の 3 大失敗 mode が known issue として残っている。「失敗時のリトライ」「失敗の理由表示」と書いてあるが、**何を**「失敗」と判定し、**何を**「理由」として人間に出すかが decision されていない。

結論を先に書く: 失敗 mode の **classification (= 何が起きたかの判定)** と **message vocabulary (= 人間に何と言うか)** が brief で欠けている。protocol 仕様 `connect_status: failed, message` の `message` の中身を AI 任せ / bleak の exception 文字列任せにすると、`BleakError: [WinError -2147023673] The operation was canceled by the user` のような stack trace が overlay に出て user が読めない。本レビューでは 10 個の失敗 mode を一つずつ「**検知 (= bridge 側で何を catch)** → **classification (= protocol の state/reason enum)** → **表示 (= 日本語 message)** → **復帰 (= user の次手)**」の 4 段で詰める。

---

## 失敗 mode 別レビュー

### 1. BLE scan timeout (5s + α でも device 見つからない)

**現状の brief 記載**: 「5 秒後 list 表示」「FTMS 機器がなくても空 list が返る」(完了基準 1)。

**未決の問題**:
- 「空 list」と「scan エラー (BLE adapter なし)」が UI 上で区別されない。空 list → user は「trainer の電源 ON 忘れ?」と推測するが、scan エラーなら推測しても無駄。
- bridge.py の現コード (`_resolve_device`) は scan timeout を `BleakError` で catch して dummy fallback するが、**「scan が timeout で空だった」と「scan が exception で死んだ」を区別しない**。Brief 11 は scan_result protocol 1 種だけで「devices: []」を返す設計、これだと両者は同じ表示になる。
- 5 秒は短い。`discover.py` 既存は 10 秒、bridge の `_resolve_device` は 6 秒、Brief 11 は 5 秒。**timeout 値が 3 箇所で違う**、根拠なし。FTMS trainer の advertisement 周期は 1-2 秒だが、Windows の BLE stack は最初の scan 起動に 2-3 秒かかることがある (cold start)。5 秒だと cold start を引いて実質 2-3 秒しか scan できず、bursty な advertisement を取りこぼす。最低 8 秒、推奨 10 秒。

**推奨**:
- protocol 拡張: `{type: "scan_result", devices: [...], scan_status: "ok"|"empty"|"adapter_off"|"adapter_missing"|"timeout"}`
- 「devices=空 + status=ok」と「devices=空 + status=empty (= 8 秒走り切ったが何も advertise していなかった)」を区別
- timeout は 8 秒、UI の「scanning...」表示は経過秒数を出す (= 「scanning... (3s / 8s)」)
- 失敗時 message: scan_status=empty なら「機器が見つかりません。トレーナーの電源を入れて、ペダルを 1 回踏んで確認してください。」、status=adapter_missing なら「PC の Bluetooth が見つかりません。Windows の設定で Bluetooth を確認してください。」

---

### 2. PC の Bluetooth adapter が無い / OFF

**現状の brief 記載**: なし。「リスク + 回避」にも書かれていない。

**未決の問題**:
- これは scan timeout (mode 1) と別 class。timeout は「scan は走った、見つからない」、adapter なし/OFF は「scan を起動できない」。Windows では `BleakScanner.discover()` が `BleakError: Bluetooth device is turned off` や `OSError: [WinError -2147467259]` を raise する。
- bridge.py 現コードは `BleakError` のみ catch、`OSError` は catch していない (`_resolve_device`) → adapter OFF で unhandled exception で bridge process が落ちる可能性。
- Brief 11 が WebSocket protocol で `scan_status` を区別しない場合、user は「機器なし」と表示されて延々 scan を繰り返す。

**推奨**:
- bridge.py の scan path で `BleakError` + `OSError` + `RuntimeError` を 3 つとも catch (bleak の Windows backend は OSError も投げる)
- 「Bluetooth adapter not found」「Bluetooth radio turned off」を文字列マッチで判定し、protocol の `scan_status` enum を分岐
- message: 「PC の Bluetooth が OFF です。Windows の設定で Bluetooth を ON にして、もう一度 Scan を押してください。」

---

### 3. connect 試行で BleakError / pairing 拒否 / device 占有 (他アプリ使用中) の切り分け

**現状の brief 記載**: 「失敗時は赤メッセージ + 同 list でリトライ or 別 device 選択」「Zwift 等が pair 済の trainer は scan に出るが connect 失敗、エラーメッセージで『他アプリ停止してから』と表示」(リスク 2)。

**未決の問題**:
- リスク 2 で「他アプリ停止してから」と書いてあるが、これは **占有競合のときだけ正しい message**。同じ「connect failed」でも次の 3 ケースは原因が全く違う:
  - (a) pairing 拒否: trainer 側が pairing dialog を出している、user が dialog で OK を押すまで stuck (bleak Issue #827)
  - (b) 占有: Zwift / TrainerRoad が既に connection を握っている → BLE は 1 connection per device の制約、新 client は ATT_ERROR_INSUFFICIENT_AUTHORIZATION や connection refused
  - (c) 単純な距離 / 電池切れ / advertisement 停止: trainer がスリープに入った
  - (d) Windows pairing cache 破損: 過去に paired → forget せずに別 PC で paired → 新 PC で SecureBondedDevice モード fail (bleak Issue #789)
- bridge.py 現コードは `(asyncio.TimeoutError, BleakError, OSError)` を 1 つの except 節で catch して「connect failed (%s)」とログ出力するだけ。**例外の中身で classification していない** → protocol の `message` field に bleak の生 exception 文字列が乗ると user に無意味。
- 「他アプリ停止してから」を全 connect 失敗で出すと、実は trainer がスリープしているだけのとき user が Zwift を疑って混乱する。

**推奨**:
- bridge.py の connect path に classification 関数を追加: BleakError の `.args[0]` 文字列 + asyncio.TimeoutError の有無で 4 種に分岐
  - `"connection refused"` / `"resource busy"` → reason="busy", message="他のアプリ (Zwift / TrainerRoad 等) が接続中の可能性があります。終了してから再試行してください。"
  - `"pairing"` / `"insufficient authentication"` → reason="pairing", message="トレーナーで pairing 承認が必要です。Windows の通知に出る『ペアリングを許可』を押してください。"
  - asyncio.TimeoutError → reason="timeout", message="接続応答なし (5 秒)。トレーナーが sleep の可能性、ペダルを 1 回踏んで再試行してください。"
  - その他 BleakError → reason="other", message="接続失敗。詳細: <truncated 1 行に絞った理由>。再試行できます。"
- protocol: `{type: "connect_status", state: "failed", reason: "busy"|"pairing"|"timeout"|"other", message: "<日本語>", raw: "<デバッグ用、UI には出さない>"}`
- 失敗回数を bridge 側で数え、3 回連続失敗で「Windows の Bluetooth 設定で機器を一旦 forget してから再 pair」をサジェスト

---

### 4. 接続成功直後の characteristic discover 失敗 (= FTMS protocol を喋らない trainer)

**現状の brief 記載**: なし。Brief 05 で「機種未確認問題」として挙げられているが、Brief 11 の protocol には連動していない。

**未決の問題**:
- scan の advertisement で FTMS service UUID (0x1826) を持っていても、connect 後の GATT discover で `INDOOR_BIKE_DATA_UUID` (0x2AD2) が見つからない trainer が存在する (= FTMS 部分実装、status 通知のみで simulation 未対応)。bridge.py 現コードは `start_notify` で `BleakError` を catch して dummy fallback するが、Brief 11 の新 protocol だと「connected → 即 disconnect → dummy fallback」が viewer から見えない。
- 「接続成功で overlay 閉じる」(brief 完了基準 2) → 閉じた直後に裏で dummy fallback されると、user は「接続成功」表示を見たまま速度が常時 20 km/h (= dummy) で進む → 「接続できたのに trainer が反応しない」と感じる、最悪の UX。
- これは brief 05 の bleak `start_notify` 失敗 path と直結、Brief 11 の `is_ftms` flag は scan の advertisement 段階の判定で、**connect 後の実体検証ではない**。

**推奨**:
- bridge.py に「接続検証」フェーズを追加: connect 成功 → start_notify 成功 → **2 秒以内に最初の Indoor Bike Data notification を 1 つ受信** までを 1 unit とする。受信できなければ connect_status: failed, reason="no_ftms_data" を返して disconnect。
- protocol の `connect_status: connected` は **検証フェーズまで通った時のみ送る**、検証中は `connect_status: verifying, message: "接続後の応答を確認中..."`
- 「scan で FTMS と表示されたが実際に喋らなかった」場合の message: 「この機器は FTMS の advertisement を出していますが、データ送信に応答しません。別の機器を選択するか、Skip で dummy mode に切替えてください。」

---

### 5. ride 中の切断: 自動 reconnect 3 回 (3/6/12 秒) が現実的か

**現状の brief 記載**: 「自動 reconnect を 3 回試行 (3/6/12 秒間隔)、全失敗で手動選択」。

**未決の問題**:
- 3/6/12 秒間隔は exponential backoff として書かれているが、**何が起きたかの想定が無い**。trainer 切断の現実 mode は:
  - (a) trainer の **電源 OFF / スリープ**: BLE advertisement が止まる、復帰には user がペダルを踏む等の物理アクションが必要 → reconnect は user action の後でないと無意味、3/6/12 秒で完結しても無駄
  - (b) **BLE 距離 over / 電波干渉**: 数秒で復帰するケースあり、この時は 3 秒で再接続成功する
  - (c) **bleak 内部 hang (Brief 01 #1470)**: bridge process 側の hang、reconnect しても client が dead lock しているので無理
- 3 回で諦めて「手動選択」は (b) には fit するが、(a) では user は「scan からやり直し」を強要される。(a) のケースが圧倒的に多い (90 分 ride で trainer がスリープに入る、または user が pause で trainer を止める)。

**推奨**:
- reconnect の間隔は **2 秒固定で 30 秒間試行継続** が現実解。exponential backoff より「定期的に試し続けて trainer 復帰を待つ」のほうが (a) に fit する。3/6/12 秒 = 合計 21 秒、user は「もう一度ペダル踏もう」と思う前に手動 mode に放り出される。
- 30 秒経過で「自動 reconnect 停止、手動 Scan or Skip を選択してください」と提示
- reconnect 中の overlay 表示は「再接続中... (15s / 30s) — トレーナーの電源を確認してください」のように **進捗 + user への hint** を出す、無音で 21 秒待たせない
- 自動 reconnect 中も dummy mode で ride 進行を継続 (= Cesium viewer は動き続ける、Brief 06 の「裏で停止しない」と整合)

---

### 6. WebSocket 切断 (= bridge process 落ち) と BLE 切断 (= trainer 切れ) の区別

**現状の brief 記載**: 「ride 中切断 → overlay 再表示」とだけ、WebSocket と BLE が区別されていない。

**未決の問題**:
- viewer.js 現コードは `ws.addEventListener('close', ...)` で「bridge 切断 - test mode にフォールバック」と status に出すだけ、reconnect しない。Brief 11 が overlay を再表示する設計は viewer 側に新規実装が要る。
- **WebSocket 切断と BLE 切断は復帰方法が完全に違う**:
  - WebSocket 切断 = bridge process が死んだ / port 衝突 / OS が WebSocket を kill。復帰には user が PowerShell で `python -m fujihc.bridge` を再起動する必要、browser 側からはどうにもならない
  - BLE 切断 = bridge は生きている、trainer との link が切れただけ。bridge が reconnect を試みる、または viewer から `{type: "connect", address}` を再送できる
- これを区別せず「overlay 再表示」だけしても、WebSocket 切断時に「Scan」ボタンを押しても WebSocket が死んでいるので何も起きず user は混乱する。

**推奨**:
- viewer.js に WebSocket reconnect ロジックを追加: `ws.close` → 2 秒後に `new WebSocket(WS_URL)` を試行、5 回 (合計 10 秒) 失敗で「bridge process が停止しています。PowerShell で再起動してください: `python -m fujihc.bridge`」を overlay に出す
- BLE 切断 (= `{type: "disconnected", reason}` 受信) と WebSocket 切断 (= `ws.onclose`) で異なる overlay を出す
  - BLE 切断: 「トレーナーとの接続が切れました。再接続を試行中...」+ 自動 reconnect 進捗
  - WebSocket 切断: 「Bridge process との接続が切れました。PowerShell で `python -m fujihc.bridge` を再起動してください。」+ retry counter

---

### 7. page reload 中の connection state と bridge process 再起動時

**現状の brief 記載**: 「bridge 側は connection state を保持、新 WebSocket 接続で `{type: "current_state"}` を即送り返し、overlay を skip 可能」(リスク 4)。

**未決の問題**:
- bridge.py 現コードは BLE connection を `self._ble_client` に持つが、これは process が生きている限り保持される。Brief 11 の `current_state` 提案は **新 WebSocket 接続時に bridge が「現在 BLE 接続中」と知らせる** という意味で実装可能。問題は **bridge 自体が再起動された時**。
- bridge 再起動シナリオは複数: user が PowerShell で Ctrl+C → 再起動、PC 再起動、Windows update で kill、bleak hang から user が強制 kill。再起動直後の bridge は `dummy=False` で起動されたら scan を試み、`dummy=True` で起動されたら scan 待ち。**user が Brief 11 の流れに従って起動するなら `--dummy` で起動して viewer から scan/connect を指示する**ので、新 protocol は `--dummy` を default 起動形式に変える必要がある。
- 現 bridge.py の main argparse は `--device <addr>` を取って `scan + connect` を bridge 起動時に行う設計。Brief 11 の新 flow なら **bridge 起動引数を整理**:
  - 旧: `python -m fujihc.bridge --device XX:XX:...` (起動時 connect)
  - 新: `python -m fujihc.bridge` (起動時 WebSocket のみ、scan/connect は viewer 指示)
- この変更は brief 11 で明示されていない (「`--dummy` 起動時も WebSocket は立てる」とだけ書かれているが、`--device` flow との整合は未決)

**推奨**:
- Brief 11 の bridge 起動形式を **新 default = scan/connect 待ち** に変更する旨を明示
- protocol 追加: viewer 側起動時に `{type: "get_state"}` を送り、bridge が `{type: "current_state", connection_state: "idle"|"connected"|"connecting", device_address: "..."}` を返す
- bridge 再起動を viewer が検知する仕組み: `current_state.connection_state == "idle"` なら overlay 再表示、`connected` なら overlay 即 skip

---

### 8. overlay の error 表示が日本語で人間に通じるか (BleakError stack trace 生出しは NG)

**現状の brief 記載**: 「失敗時は赤メッセージ + 同 list でリトライ」、message の中身仕様なし。

**未決の問題**:
- bridge.py 現コードは `log.warning("connect failed (%s) - falling back to dummy mode", exc)` で exception 文字列をログ出力する。WebSocket protocol で `connect_status: failed, message: str(exc)` を直で渡すと、overlay に `[WinError -2147023673] The operation was canceled by the user` のような文字列が出る。これは **user が読めない、不安にさせる、何をすべきか分からない**。
- 「リトライできます」と書いてあっても、なぜ失敗したかが分からなければリトライしても再失敗する。
- Mode 3 で classify した reason enum (busy/pairing/timeout/other) を **日本語 message + 推奨 action** のセットで vocabulary 定義する必要がある。

**推奨 vocabulary** (bridge.py の reason → viewer の overlay 表示):

| reason | 日本語 message | 推奨アクション |
|---|---|---|
| `adapter_off` | PC の Bluetooth が OFF です。Windows 設定で ON にしてください。 | [Scan 再試行] |
| `adapter_missing` | PC に Bluetooth adapter が見つかりません。 | [Skip (dummy)] |
| `scan_empty` | 機器が見つかりません。トレーナーの電源を入れてペダルを 1 回踏んでください。 | [Scan 再試行] / [Skip] |
| `busy` | 他のアプリ (Zwift / TrainerRoad 等) が接続中です。終了してから再試行してください。 | [再試行] |
| `pairing` | トレーナーで pairing 承認が必要です。Windows の通知をご確認ください。 | [再試行] |
| `timeout` | 接続応答がありません (5 秒)。トレーナーが sleep の可能性、ペダルを踏んで起こしてください。 | [再試行] |
| `no_ftms_data` | この機器は FTMS データを送信していません。別の機器を選択してください。 | [一覧に戻る] |
| `other` | 接続失敗。トレーナーの電源を確認して再試行してください。 | [再試行] / [Skip] |
| `disconnected_during_ride` | トレーナーとの接続が切れました。再接続中... | (自動) |
| `bridge_dead` | Bridge process が停止しています。PowerShell で再起動してください: `python -m fujihc.bridge` | (手動) |

raw な BleakError 文字列は overlay には**絶対に出さない**、ただし F12 console には `console.warn` で raw を出してデバッグ可能にする (= advanced user / yuuji 自身が原因究明できる)。

---

### 9. Skip = dummy mode の判断を user が "失敗" と混同する risk

**現状の brief 記載**: 「Skip (dummy mode で続行)」と overlay 内ボタン、「開発時 / trainer なし demo 用」と書かれている。

**未決の問題**:
- yuuji が trainer の電源を入れ忘れて Skip を押すと「dummy で ride が始まる、速度 20 km/h 固定」になる → yuuji は「あれ、踏んでも速度上がらない」と気づくが、原因が「trainer の電源 OFF」だと判断できない (Skip を押した自覚が無いか、押した理由を忘れている)。
- HUD の `(test)` 表示は viewer.js 現コードにあるが、これは小さい。Brief 11 の Skip 後の表示が「dummy mode で動作中」と常時 visible に出るか不明。
- 「失敗時のリトライ」と「dummy 続行の Skip」のボタン色を区別しないと、user は「とりあえず Skip しとけば動く」と学習してしまい trainer 接続を諦める癖がつく (= 本来の use case が達成できない)。

**推奨**:
- Skip ボタンの色を gray、Connect 系を accent color に分ける (= 第一選択は接続、Skip は escape hatch)
- Skip 後の HUD に常時 banner: 「Dummy Mode (実トレーナー未接続) — クリックで再接続」、これを押すと overlay 再表示
- 「Skip」より「Skip → Demo Mode で続行 (実走データは取れません)」と長めの label にして誤押しを減らす
- ride 開始後 1 分経過しても dummy のままなら 1 度だけ toast 通知「Demo mode で 1 分経過。実トレーナーに接続しますか?」を表示

---

### 10. 接続成功通知 (= overlay 閉じる) 前に trainer が即切断した場合の race condition

**現状の brief 記載**: なし。

**未決の問題**:
- 想定シナリオ: user が device list をクリック → bridge が connect → 0.5 秒で connect 成功 → bridge が `{type: "connect_status", state: "connected"}` を送る → viewer が overlay を閉じる準備 → **その 0.3 秒後に trainer が切断** (距離 over / 電波干渉 / trainer の不安定) → bridge が `{type: "disconnected", reason}` を送る → viewer は overlay が閉じる前後で 2 つの message を受ける。
- viewer.js が「connected で overlay hide」「disconnected で overlay show」を素直に書くと、視覚的にちらつく (= overlay が 0.3 秒で hide → show)。
- Mode 4 (no_ftms_data 検証) を入れる推奨と組合せれば、検証 2 秒中に切断したら `connect_status: failed, reason: "disconnected_during_verify"` を返して overlay は閉じない → race が避けられる。

**推奨**:
- viewer.js: `connect_status: connected` を受けても overlay は **3 秒 grace period** を置いてから hide する、grace 中に `disconnected` が来たら hide をキャンセル
- bridge.py: connect 成功後 2 秒の検証フェーズ (Mode 4 推奨) で `connect_status: verifying` → 成功で `connected` → 失敗で `failed`。`connected` を送るのは検証通過後のみ
- race の状態遷移を明示: `idle → scanning → connecting → verifying → connected ↔ reconnecting → idle` の state machine を brief に図示すべき

---

## protocol 仕様 修正提案 (summary)

Brief 11 の WebSocket protocol を、上記 10 mode を反映して改訂:

```
viewer → bridge:
  {type: "get_state"}                    — 起動時の state 問い合わせ
  {type: "scan"}                          — scan 開始 (8s timeout)
  {type: "connect", address}
  {type: "disconnect"}
  {type: "set_slope", slope_pct}         (既存)

bridge → viewer:
  {type: "current_state", connection_state: "idle"|"connecting"|"verifying"|"connected"|"reconnecting", device_address, device_name}
  {type: "scan_result", scan_status: "ok"|"empty"|"adapter_off"|"adapter_missing"|"timeout", devices: [...]}
  {type: "connect_status", state: "connecting"|"verifying"|"connected"|"failed", reason: "busy"|"pairing"|"timeout"|"no_ftms_data"|"other"|null, message: "<日本語>", raw: "<デバッグ>"}
  {type: "disconnected", reason: "trainer_sleep"|"signal_lost"|"other", message: "<日本語>", reconnecting: true|false}
  {type: "reconnect_progress", elapsed_s: <int>, deadline_s: 30}
  {type: "state", ...}                   (既存)
```

---

## 完了基準 修正提案

Brief 11 の完了基準 4 項目に以下を追加:

5. **Bluetooth OFF 状態で起動 → 「Bluetooth が OFF」と日本語で表示、Windows 設定起動を案内する** (BleakError stack trace を出さない)
6. **scan で FTMS 機器が出たが connect 後に応答しない trainer をシミュレート (= dummy で notify を返さない fake bridge mode) → 「FTMS データを送信していません」と表示、dummy fallback されない**
7. **ride 中 trainer 電源 OFF → 30 秒間 reconnect 試行、各回 2 秒間隔、進捗 overlay 表示、その間 viewer は dummy speed で進行継続 (Cesium viewer が停止しない)**
8. **bridge process を Ctrl+C で kill → viewer が WebSocket 切断を検知 → 「bridge 再起動が必要」を表示、手動再起動後に viewer 自動 reconnect**
9. **Skip 後 1 分経過 → 「Demo mode で 1 分経過、実トレーナーに接続しますか?」toast 表示**
10. **Zwift 起動中の trainer に対し connect 試行 → 「他のアプリが接続中」と表示** (Zwift がない場合は手動で別 BleakClient を握る簡易 fake で代用)

---

## まとめ

Brief 11 の UX 設計 (overlay / scan list / 自動 reconnect) は流れとして正しいが、**失敗 mode の classification + 日本語 vocabulary + race condition の state machine が未決**。具体的に欠けているのは:

1. **scan の失敗 4 種** (timeout/empty/adapter_off/adapter_missing) を 1 つの「空 list」に潰している
2. **connect の失敗 4 種** (busy/pairing/timeout/other) を 1 つの `message` field に raw exception で乗せようとしている
3. **「FTMS と advertise したが notify しない」trainer** が dummy fallback で UI に invisible に切替わる (= 最悪の silent failure)
4. **自動 reconnect 3/6/12 秒** は exponential backoff の常套だが、実シナリオ (trainer スリープ) には合わない、定間隔 30 秒継続が正解
5. **WebSocket 切断と BLE 切断**を区別しないと user の復帰アクションが取れない
6. **bridge 起動形式の変更** (`--dummy` default 化) が brief で明示されていない
7. **state machine** (idle/scanning/connecting/verifying/connected/reconnecting) が無い → connected ↔ disconnected race で UI ちらつき
8. **error vocabulary** が brief で 1 つも定義されていない → 実装時に AI / bleak の exception 文字列任せになる
9. **Skip の誤押し / 誤判断**を防ぐ仕組みなし、demo mode に silent に落ちる
10. **完了基準 4 項目は全て成功 path**、失敗 path が 0、これでは「動くケース」しか検証されない

最も危険なのは **mode 4 (FTMS 部分実装 trainer での silent dummy fallback)** と **mode 8 (raw BleakError 文字列の overlay 表示)**。前者は brief 05 の「機種未確認問題」と直結するため yuuji の実 trainer 確認なしには検証不能、後者は実装時の「いったん exception 文字列を出しとけ」AI default で確実に発火する → brief 段階で vocabulary を明示しない限り防げない。

Brief 11 を採用するなら **protocol/vocabulary/state machine/完了基準** の 4 項目を改訂してから着手すべき。
