---
review: 11-pair-tech
reviewer_axis: 技術現実性 (bleak Windows 挙動、bridge.py 構造変更コスト、WebSocket protocol 整合性)
date: 2026-05-14
target_brief: 11-pairing-in-app.md
verified_via: bridge.py / viewer.js / discover.py 実コード読み込み、bleak 3.0.2 API 確認、review 01 (bleak hangs 警告) 参照
---

# 技術現実性レビュー — brief 11 (web app 内ペアリング)

## はじめに

「ターミナル開いて discover 走らせて MAC コピペして bridge 起動」を browser 1 画面に畳む案。狙いは妥当 (毎 ride 4 アクションを 1 click に圧縮)。本レビューは **実際に bridge.py を書き換えて期待通り動くか** を 6 観点で詰める。

結論を先に書く: **採用案 B (WebSocket protocol 拡張) は実装できる、ただし bridge.py の構造を 1 箇所だけ大きく変える必要がある**。現状の bridge.py は「dummy か実機かを起動時に固定」する片道構造、これを「runtime に切り替え可能」にするには `Bridge.run()` の supervisor loop を書き直す必要がある。これが最も重い変更、それ以外は素直に landed する。最大の懸念は **bleak の hang リスク** (review 01 の Issue #1470)、これは scan/connect で発火する可能性が ride 中より高い (scan は能動的に native API を叩く)、ただし `asyncio.wait_for` で timeout 包めば WebSocket は生き残る。**案 A (Web Bluetooth) と 案 C (HTTP API) の不採用は妥当**。

---

## 1. WebSocket protocol 拡張案の現実性 — ★★★

提案された 6 種 message (scan / connect / disconnect / scan_result / connect_status / disconnected) は既存 protocol (state / set_slope) と整合する。判定根拠:

- 既存 viewer.js (89-99 行) は `msg.type` で switch していて `state` のみ処理、未知 type は無視する設計。**新 type を追加しても既存処理を壊さない**。
- 既存 bridge.py (260-267 行) も同様に `msg.get("type")` で `set_slope` のみ処理、未知 type を黙って捨てる。**今の構造に scan / connect handler を追加するだけ**。
- JSON 1 行 message なので serialization コストは無視できる、1 ride で交換される control message は ~10 件以下。

唯一の整合性懸念: `scan_result` で device list を broadcast すると **複数 viewer (= 同時に 2 tab で開く)** で全 client が scan を始める競合が起きうる。が、これは brief の scope 外 (Phase 2 で「複数 trainer 同時接続」と書いてあるので、複数 viewer も Phase 2 でいい)。

判定: protocol 拡張案そのものは素直、debate の余地なし。

---

## 2. bleak の BleakScanner.discover() を WebSocket server 内で並行実行できるか — ★★☆

検証: 現在 installed `bleak == 3.0.2`、`BleakScanner.discover(timeout=5.0, return_adv=True)` が async method。

- **WebSocket handler 内で `asyncio.create_task(BleakScanner.discover(...))` で並行起動は可能**。bridge.py は既に `asyncio.create_task` で push_loop / dummy_loop / ftms_loop を並走させていて、scan task を追加で起動するのは同パターン。
- **scan 中も WebSocket server は生きる**。`BleakScanner.discover` は内部で WinRT advertisement watcher を起動して 5-6 秒待つだけ、他 task の event loop tick を妨げない。
- **scan を同時 2 つ起動は禁止**。bleak の Windows backend は WinRT BluetoothLEAdvertisementWatcher を per-process で 1 つしか持てない、2 つ目を Start すると `BleakError: scanner already running` が出る。bridge 側で **scan in-flight flag を持って 2 回目の scan_request を「busy」で返す** か、**既存 scan を await して結果を 2 viewer に broadcast** のどちらか必要。brief はここを書いていない。

Windows native の挙動懸念:

- review 01 で挙げた Issue #1470 (long-running hang) は connect 後の長時間稼働の話で **scan 自体の hang は別 issue**。Issue #1340 (Windows) で「discover() hangs forever if Bluetooth adapter is off」報告あり。adapter off / driver crash 状態で scan を投げると返ってこない、`asyncio.wait_for(scan_task, timeout=7.0)` で必須に包む。brief は scan 側の timeout を明示していない (connect_timeout=5s だけ書いてある)。
- Windows 11 で **bluetooth adapter が「Airplane mode」「ペアリング設定 OFF」のとき discover は空 list を返す**。エラーではないので「機器が無い」と区別できない。viewer 側で「scan で 0 件 = adapter 確認を促す」UX を要検討、brief には書いていない。

判定: 並行実行は可能、ただし **scan timeout (7s 推奨)** と **busy 状態の handling** を bridge.py に明示する必要あり。brief の記述だけでは不足。

---

## 3. dummy ⇄ 実機 runtime 切替が現状実装で可能か — ★☆☆ (最も重い変更)

これが本案で **最も重い変更点**。現在の bridge.py は dummy / 実機を runtime で切替えできない:

```
# bridge.py 339-369 行 run() 抜粋
if self.dummy:
    source_task = asyncio.create_task(self._dummy_loop())
else:
    source_task = asyncio.create_task(self._ftms_loop())
push_task = asyncio.create_task(self._push_loop())
await source_task   # ← ここで dummy か ftms のどちらか 1 つを永久待ち
```

`_ftms_loop` は connect 失敗で `self.dummy = True` をセットして return するが、**そのあと `run()` の continuation で `_dummy_loop` を起動する fallback コードはあっても、逆 (= dummy で起動 → 後から viewer command で実機 connect) の path は無い**。

brief 11 が要求するのは「dummy で起動しておいて viewer から scan/connect 命令で実機に上書き」、これを landed させるには:

1. `Bridge.run()` の片道 dispatch を捨てて、**source_task を入れ替え可能な supervisor loop** に書き直す必要がある (= 「現在の source_task を cancel して新しいのを start」できる構造)
2. `_ftms_loop` を「内部で resolve_device + scan する関数」から「**外部から address を受け取って接続するだけの関数**」に責務分離する (現状は `_resolve_device` が `_ftms_loop` 内部に embed されているので、scan と connect が分離できない)
3. `Bridge` に状態機械を入れる: `IDLE` / `SCANNING` / `CONNECTING` / `CONNECTED` / `DISCONNECTED`、各 transition を WebSocket message で trigger

実装規模見積もり: bridge.py は現状 435 行、上記書き直しで **150-200 行の変更** (新規 + 既存 refactor 含む)。テスト無し前提で 1 週末で landed、テスト書くなら 2 週末。

簡略案 (scope を絞る): **「dummy mode の bridge を上げる → viewer で connect → bridge 全体を asyncio.create_subprocess_exec で `--device <addr>` 付きで再起動 → 同 port で立て直す」**。これなら supervisor 書き直し不要、起動 script に process restart logic を入れるだけで済む。ただし「subprocess 再起動の間 WebSocket が一瞬切れる」を viewer 側で reconnect する必要があり、UX 的には fall short (overlay に「再起動中... 3s」表示で許容できるかは yuuji 次第)。

判定: **runtime 切替できる構造ではない、書き直しが必須**。brief は「dummy 起動時も WebSocket は立てる、scan/connect 命令で実機 mode に switch」と 1 行で書いているが、これが実装上は最大の作業項目。brief の見積もりが甘い。

---

## 4. 既存 viewer の WebSocket message handler に case 追加コスト — ★★★

viewer.js 89-99 行の `addEventListener('message')` を眺めた限り、新 case 追加は trivial:

```js
// 現状 (89-99 行)
if (msg.type === 'state' && typeof msg.speed_mps === 'number') { ... }

// 追加すべき (推定)
else if (msg.type === 'scan_result') { showDeviceList(msg.devices); }
else if (msg.type === 'connect_status') { updateOverlay(msg.state, msg.message); }
else if (msg.type === 'disconnected') { showOverlay(msg.reason); }
```

UI 側で新規追加する DOM 要素:

- `<div id="trainer-setup">` overlay (modal、半透明背景 + 中央 panel) — index.html に追加 ~30 行
- overlay 内の device list を動的生成する関数 — viewer.js に追加 ~50 行
- overlay の show/hide toggle ロジック — viewer.js に追加 ~20 行

実装規模見積もり: index.html (現状未読だが推定 70-100 行) に overlay 追加で 30 行、viewer.js (現状 559 行) に handler + UI helper で 100 行。**合計 130 行追加**、1-2 日 (yuuji の週末) で landed。

Cesium viewer 側との干渉: 「overlay 表示中に裏の Cesium viewer が描画停止しない」は **既存の `requestAnimationFrame(tick)` が常に走り続けている**ので、overlay は単に z-index 上位の半透明 div を被せるだけで OK。frame rate に影響しない。

判定: viewer 側の変更コストは小さい、設計通り landed する。

---

## 5. connect_timeout 5s で hang 回避が現実か — ★★☆

検証: bridge.py 既存 `_ftms_loop` (181-188 行) は既に `connect_timeout=5.0` で `asyncio.wait_for(client.connect(), timeout=5.0)` を実装済み。**これは review 01 の Issue #1470 (long-running hang) には効かない、connect 自体の hang には効く**。

懸念点:

- **bleak の `BleakClient.connect()` が 5s で timeout した後の状態**: bleak の Windows backend は WinRT BluetoothLEDevice を内部で持っていて、`timeout` 後の `disconnect()` を必ず呼ばないと **OS 側に paired session が残る**。brief は failed 後の cleanup を書いていないが、bridge.py 既存実装 (213-214 行) は `with contextlib.suppress(Exception): await client.disconnect()` で cleanup している、これを scan/connect 経路でも踏襲する必要あり。
- **5s が短すぎる可能性**: Wahoo KICKR は wake から advertisement 開始まで 3-5 秒、connect は更に 2-3 秒。**初回 connect で 5s では足りないケースがある**。pycycling の document では「connect timeout 10-15s 推奨」と書かれている (= 安全寄り)。brief の 5s は scan 5s + connect 5s = 10s 待ち、UX 上の許容範囲だが **失敗率が上がる**。**connect_timeout=10s に上げる方が現実的**。
- **「他アプリが pair 済」の検出**: brief リスク 2 で「Zwift 等が pair 済の trainer は scan に出るが connect 失敗」と書いているが、**bleak の Windows backend は WinRT 経由なので「他 process が exclusive lock 持ち」状態を区別する error code が無い**。timeout で fail するだけ、エラーメッセージは「The device is busy」ではなく `BleakError: connect failed` の generic。viewer 側で「他アプリ停止してから」と表示する判定根拠が無いので、**「接続失敗、Zwift 等の他アプリが起動中の場合は停止してリトライ」と汎用文言で出す** のが現実解。

判定: 5s timeout は技術的に動く、ただし **10s に伸ばし、failed 後の disconnect cleanup を必須にする** 必要あり。brief の「5s で hang 回避」は「hang は防げる、ただし正常 connect の成功率は下がる」trade-off。

---

## 6. 不採用案 A / C の根拠は妥当か — ★★★

### 案 A (Web Bluetooth API) 不採用 — 妥当

- review 01 で確認済: Web Bluetooth は Chrome 70+ Windows 10 1703+ のみ、**user gesture 必須で起動時に毎回手動 device 選択 dialog が出る**。これは ride のたびに「Scan device」button → OS 選択 dialog → 機器 click が必須、UX 的に brief 11 の狙い (= 「browser UI で完結、毎 ride スムーズ」) と矛盾。
- 「Phase 0-1 で landed した bridge.py 全廃」も正しい指摘。pycycling の Python 資産 (`fitness_machine_service` の IndoorBikeData parse、勾配 write の opcode encoder) は web bluetooth で書き直しになる。bridge.py 既存 _parse_indoor_bike_data (68-108 行) は FTMS Indoor Bike Data の flag 解析を 40 行で書いてあるが、これを JS に porting すると **endianness handling + uint24 / sint16 の符号扱い** で踏みがちな typo bug class が再発する。

判定: 不採用妥当。

### 案 C (HTTP API + SSE) 不採用 — 妥当だが理由が弱い

brief は「2 つの protocol (HTTP + WebSocket) 並走、message 統一性なし」を理由にしているが、**これは技術的にはどっちでも landed する** (HTTP `/scan` POST → JSON response、SSE で `connect_status` push は実装容易)。本当の不採用根拠は別:

- WebSocket は既存 viewer.js で「**1 connection で双方向、reconnect logic が landed 済**」。HTTP + SSE にすると 2 endpoint + 2 reconnect logic が要る。
- WebSocket 単一 channel なら **scan / connect / state / set_slope の order が保証される**。SSE + HTTP だと「scan が pending 中に set_slope が先に到着」のような race が起きうる、bridge 側で order を強制する必要が出る。
- debugging しやすさは tie。WebSocket は Chrome DevTools Network tab の "Frames" で見える、HTTP は素直に「Network」で見える。

判定: 不採用妥当、ただし brief の理由付け (「2 protocol 並走」) は誤解を招きやすい、**「単一 channel で order 保証 + 既存 reconnect logic 流用」が正しい根拠**。

---

## 横断的な漏れ — brief 11 の死角

### 漏れ 1: BLE adapter off / driver crash の detection

scan で 0 件返ったとき、それが「機器が無い」なのか「PC の Bluetooth adapter が off」なのか **区別する API が bleak には無い**。Windows native では `Get-PnpDevice -Class Bluetooth | Where-Object Status -ne 'OK'` で adapter 状態を取れるが、Python から呼ぶには subprocess + parse。brief は overlay に「Skip (dummy mode で続行)」を出すので、最悪 user 判断で進めるが、**「scan 0 件のとき adapter 確認ヒント を overlay に表示」** を入れる方が UX 良い。

### 漏れ 2: scan 中に Skip 押されたときの handling

brief は「scan 中の UI freeze」を「bleak は async、bridge は別 task で実行、viewer は state push 待ち中も UI 操作可能 (Skip ボタン押せる)」と書いているが、**「Skip 押された瞬間に scan_task を cancel するか?」が書かれていない**。

- cancel しない場合: scan task は最後まで走って `scan_result` を送る、viewer は overlay 既に hide してるのでこれを捨てる → 5s 後に何故か device list が一瞬チラつく不具合あり得る
- cancel する場合: `scan_task.cancel()` が必要、bleak の `BleakScanner.discover` は cancel 中に内部 watcher の stop を await するので 100-300ms かかる。viewer の「Skip → dummy 開始」が即時にならない

brief はここを書いていない。**Skip 押下で scan_task を cancel、cancel 完了を await してから dummy mode 開始** が正しい。実装 5 行程度だが、書かないと再現性低い UI 不具合 vector になる。

### 漏れ 3: page reload で「current_state 即送り返し」が不可能なケース

brief リスク 4 で「page reload で connection 切れる → bridge 側は state 保持、新 WebSocket で `{type: "current_state"}` を即送り返し」と書いているが、**bridge.py の現状実装には「現 connection state」を保持する attribute が無い**:

- `self._ble_client` (`Optional[BleakClient]`) は存在するが、これは BleakClient instance、connected か否かは `_ble_client.is_connected` で都度確認
- connect 成功時の device address は **bridge.py に保存されていない** (`self.device` は起動時の `--device` 引数のみ、`_resolve_device` 経由で scan して取得した address は local variable で消える)

brief 11 を landed するなら **`Bridge.current_device_address: Optional[str]` と `Bridge.connection_state: str ("idle"|"connected"|...)`** を新規 attribute として追加する必要あり。これは「3. dummy ⇄ 実機 runtime 切替」の状態機械追加と同じ作業に含まれるが、brief は state attribute を明示していない。

### 漏れ 4: scan_result の device sort 順

brief UI 設計に「FTMS 持つ機器を上位、HR モニタ等は下位」と書いてあるが、**`BleakScanner.discover` の戻り値は dict (Python 3.7+ で insertion order 保持)、bleak が見つけた順 = RSSI とは無関係**。brief 通りに sort するなら bridge 側で:

```python
ftms_devices = [d for d in devices if FTMS_SERVICE_UUID in d.service_uuids]
non_ftms = [d for d in devices if FTMS_SERVICE_UUID not in d.service_uuids]
sorted_devices = sorted(ftms_devices, key=lambda d: -d.rssi) + sorted(non_ftms, key=lambda d: -d.rssi)
```

5 行で landed するが brief には書いていない。

### 漏れ 5: dummy fallback の連動

brief は「Skip で dummy mode 継続」「自動 reconnect 3 回失敗で手動選択」と書いているが、**自動 reconnect 失敗中も dummy mode (= 20km/h 一定速度) を流すか?** を決めていない。流す場合は ride が止まらず本来の意図 (= 実機 ride の continuation) が壊れる、流さない場合は viewer の speed=0 で camera が止まる。**reconnect 試行中は viewer に「reconnecting...」状態を push、speed は 0 で進行停止** が正しいが brief は書いていない。

---

## 総合判定

### 技術現実性スコア

| 観点 | スコア | 主な根拠 |
|---|---|---|
| WebSocket protocol 拡張 | ★★★ | 既存構造と整合、追加コスト小 |
| BleakScanner 並行実行 | ★★☆ | 可能、ただし scan timeout / busy 状態 / adapter off 検出が brief から漏れ |
| dummy ⇄ 実機 runtime 切替 | ★☆☆ | 現状 bridge.py は片道構造、150-200 行の書き直し必須 |
| viewer message handler 拡張 | ★★★ | trivial、1-2 日で landed |
| connect_timeout 5s | ★★☆ | hang 回避には効くが正常 connect 成功率が下がる、10s 推奨 |
| 不採用案 A/C の根拠 | ★★★ | 結論妥当、ただし C の根拠付けは弱い |

### 最も重い作業項目

**bridge.py の runtime mode 切替対応** (= 観点 3)。現状の片道構造から状態機械 + supervisor loop への書き直しが必須、150-200 行の変更。簡略案 (subprocess restart) もあるが UX 劣化、yuuji 判断。

### 推奨される brief 修正

1. **scan timeout を明示** (7s 推奨)、`asyncio.wait_for` で必須包み
2. **connect_timeout を 10s に上げる** (5s では Wahoo 系で初回失敗率が上がる)
3. **bridge.py に `current_device_address` / `connection_state` attribute を新規追加** を実装方針に明記
4. **Skip 押下で scan_task を cancel + dummy mode 開始** を明記
5. **scan 0 件のとき adapter 確認ヒント** を overlay に表示
6. **device sort 順 (FTMS 優先 + RSSI 降順)** を bridge 側で実装すると明記
7. **reconnect 試行中の dummy fallback policy** (= 進行停止 推奨) を明記
8. **runtime 切替の 2 path 比較** (= 状態機械 vs subprocess restart) を yuuji が選べる形で提示

### 完了基準への追記推奨

brief の完了基準 4 つはおおむね妥当、ただし以下を追加:

5. **Bluetooth adapter off 状態で scan → overlay に「Bluetooth adapter が off の可能性」表示**
6. **scan 中に Skip → 100-500ms 以内に dummy mode 開始 (scan_task cancel 完了)**
7. **connect 失敗 → 10s 以内に「失敗 (理由)」overlay 表示、リトライ可能**
8. **同 trainer に他アプリが接続中 (Zwift など) → 接続失敗時に「他アプリ停止してから」と汎用案内**

### 着地推奨

**Phase 11a (scope 絞り)**: subprocess restart path で landed、bridge を `--device <addr>` 付きで再起動するだけの shell wrapper。UX は overlay に「再起動中 3s」表示、yuuji が許容するなら 1 週末で landed。

**Phase 11b (本格)**: bridge.py の状態機械化、runtime 切替。2 週末。

11a → 11b の段階移行が「fitness build を止めない」現実解 (= review 01 の段階移行思想と整合)。最初から 11b を狙うと bridge 全面書き直し中に ride できない期間が生まれる。

## まとめ

brief 11 は **ペアリングフローを web app に取り込む狙いは妥当**、protocol 拡張案も viewer 変更も素直に landed する。ただし **bridge.py の runtime mode 切替が現状実装では不可能**、ここが最大の作業項目で brief の見積もりが甘い。bleak の Windows 挙動 (scan timeout / busy 状態 / adapter off 検出) も brief から漏れていて、これらを補足しないと「scan 0 件で謎フリーズ」「Skip 押しても反応しない」class の bug が発火する。

不採用案 A (Web Bluetooth) / C (HTTP+SSE) は結論妥当、ただし C の不採用根拠は brief の書き方では弱い、本当の根拠は「単一 channel で order 保証 + 既存 reconnect logic 流用」。

着地は **11a (subprocess restart で 1 週末) → 11b (状態機械化で 2 週末)** の段階移行が現実解。一気に 11b を狙うと bridge 書き直し中に ride できない期間が生まれて fitness build が止まる。
