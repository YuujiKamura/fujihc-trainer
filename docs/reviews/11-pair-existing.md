# Brief 11 (in-app pairing) — 既存資産との整合性 軸レビュー

## はじめに

Brief 11 「スマートトレーナー ペアリングフローを web app 内に取り込む」 を、**既存コード資産との整合性** の 1 軸だけで読んだ。bridge.py / viewer.js / discover.py / index.html / logs/ の現状を実物で読み合わせて、「採用案 = B (bridge.py 経由 WebSocket protocol 拡張)」の各論が **既存 file の構造を壊さず挟めるか**、**fork や全廃が必要か**、**実装順序が Phase 0 で landed した描画資産を破壊しないか** を判定した。

結論を先に言う:

1. **bridge.py は fork なしで挟める**。protocol 拡張は handler 関数 1 つの分岐追加、scan / connect は既存の `_resolve_device` と `_ftms_loop` を**部品単位で分割**できる構造になっており、新規 class 不要。ただし brief が触れていない「state machine 化」を avoid して書くと、`self.dummy`, `self._ble_client`, `self._stopping` の 3 つのフラグが整合せずデッドロックする経路がいくつかある (詳細は後述)。state は明示的に enum 化する必要あり。
2. **viewer.js は case 追加で済む**。既存 message handler (`viewer.js:89-99`) は `msg.type === 'state'` だけを見ている **switch なし** の if 構造で、case 数が 5 type に増える時点で **明示 dispatch table への refactor** が望ましいが、refactor 自体は 20 行以下で landable。connect / scan_result の handler を追加してもデータフローが既存 `playSpeed` 更新と干渉しない。
3. **discover.py の library 化は採用すべき**。現 `discover.py` は scan loop が 30 行で、`print` だけが副作用。`bleak.BleakScanner.discover(timeout, return_adv=True)` を呼んで FTMS UUID 持ちを列挙する core 部分は **bridge.py の `_resolve_device` がほぼ同じことをやっている** ── つまり既に二重実装。1 関数 `scan_ftms_devices() -> list[dict]` を新規 module (`src/fujihc/ble_scan.py` 等) に切り出して両者から import するのが正解、brief の「discover.py を library 化して bridge から呼ぶ」は方向として正しいが naming で誤解が出ている (CLI と library を同 file に混ぜると後で再分離する)。
4. **Phase 0 viewer 資産は壊れる経路がある**。camera 追従 / ミニマップ / 三角マーカー / 進行補間は viewer.js の `tick()` ループに集約されており、overlay 表示中も `requestAnimationFrame(tick)` が継続すれば描画は止まらない ── **ここは安全**。だが brief が「起動時 WebSocket 接続成立で `{type: "scan"}` 自動送信、scan_result が来たら overlay 表示」と書いている **「scan_result 来てから overlay 表示」が後手に回る race** が存在する: `connectBridge()` は viewer.js:119 で同期実行されるが、`loadCourse()` の `viewer.camera.flyTo` が 2.5 秒の duration を持ち、tick 開始は flyTo 完了後。scan が 5 秒なら問題ないが、scan が即座に空 list を返すと flyTo 中に overlay が立ち上がって camera 操作と競合する。**overlay は DOM 構築直後に visible state で出して、scan_result で内容を埋める**順序にすべき (brief の文言を 1 行変える)。
5. **CSV 形式は無変更で正しい**。pairing 状態を別 file に分離する方針 ── ride log と device log は性質が違う (前者は時系列高頻度、後者はイベント低頻度)、現 CSV (`time_iso, distance_m, speed_mps, power_w, cadence_rpm, slope_sent_pct`) を変えずに `device_events.csv` か log line として stderr に出すのが妥当。ただし brief は「別 file に分離」とだけ書いて schema を決めていない、ここで decision を 1 つ詰める必要あり (= scope 内、後述)。
6. **新規 file 数は許容範囲だが 1 つ過剰**。brief が暗黙に想定している新 file は `src/fujihc/ble_scan.py` (library) + viewer 側の overlay markup + 状態管理。**新規 .py file は 1 つに収めるべき** ── pairing logic を bridge.py 内 method として持つと bridge.py が 600 行超に膨らむため、`src/fujihc/pairing.py` に scan + connect の async helper を集約して bridge.py から compose する分離がきれい (discover.py を library 化、というより pairing.py 新設 + discover.py CLI 化が正しい再配置)。

---

## 各論

### A. bridge.py 拡張 — fork 不要、ただし state 設計が brief で抜けている

**A-1. 構造的観察**

bridge.py は現状 434 行、1 つの `Bridge` class に集約。BLE / WebSocket / CSV / 状態 / 制御の責務を持つ。class 内 method の依存図は以下:

- 入り口: `run()` → WebSocket server + source_task (= `_ftms_loop` か `_dummy_loop`) + push_task
- BLE 入り口: `_ftms_loop()` → `_resolve_device()` → `BleakClient.connect` → `start_notify` → `_stopping.wait()`
- viewer 入り口: `_ws_handler()` → JSON parse → `set_slope` だけを処理
- 押し出し: `_push_loop()` → 1 Hz で state を全 client に send + CSV 追記

brief の拡張要求は (a) viewer → bridge の新 msg type 3 つ (`scan` / `connect` / `disconnect`)、(b) bridge → viewer の新 msg type 3 つ (`scan_result` / `connect_status` / `disconnected`)、(c) `--dummy` でも WebSocket は立てる、(d) scan/connect で実機 mode に switch、(e) connection state を保持。

**(a) (b) の protocol 拡張**: `_ws_handler` 内の `if msg.get("type") == "set_slope":` の if/elif 連鎖に追加するだけ。3 branch なら可読性は OK、4 branch 超えるなら dict dispatch にする (= mini refactor、5 行)。fork 不要、merge 可能。

**(c) `--dummy` でも WebSocket は立てる**: 既に `run()` が `websockets.serve(...)` を `async with` で抱えており、`source_task` が `_dummy_loop` でも `_ftms_loop` でも同じ outer scope で立つ。「dummy だから WebSocket 立てない」分岐は現コードに存在せず、要求は **既に満たされている**。brief は「`--dummy` 起動時も WebSocket は立てる」と書いているが、これは既存挙動の追認なので「変更不要、既存仕様の文書化」と書き直すべき。

**(d) scan/connect で実機 mode に switch**: ここが非自明。現 bridge は `run()` 起動時に dummy か実機を **二者択一で固定** し、`_ftms_loop` が失敗したら `self.dummy = True` にして `_dummy_loop` に切り替えるが、**逆方向の遷移 (dummy → 実機) は実装されていない**。viewer から `{type: "connect", address}` を受けたとき、現走行中の source_task (= `_dummy_loop`) を cancel して `_ftms_loop` を新 task として spawn する制御を新規実装する必要がある。これは brief の文面では 1 行で書かれているが、実装上は **state machine** が必要:

```
state = IDLE | SCANNING | CONNECTING | CONNECTED_REAL | CONNECTED_DUMMY | DISCONNECTING
```

state を持たないと、以下のような race が起きる:
- viewer A が `connect` を送って `_ftms_loop` 起動中 (5 秒の connect_timeout 待機中) に、viewer B が `connect` を別 address で送る → 2 つの `_ftms_loop` が並走、`self._ble_client` が上書きされて先行 client が leak。
- `connect` 中に viewer が `disconnect` を送る → 走行中の connect が cancel されないと完了まで block。
- `--dummy` で起動 → viewer が `connect` を送らない → `_dummy_loop` のままだが、viewer 側 UI は scan を期待して overlay 出している → デッドロック。

**brief への指摘**: brief は「connection state を保持、現 device address を内部 attribute に」とだけ書いている。state machine 化を **明示** すべき。最低限 `self._mode: Literal["dummy", "real", "connecting", "scanning"]` の enum と、modeの遷移を 1 箇所 (`async def _set_mode(new)`) に集約しないと、上記 race が production で踏まれる。

**(e) connection state を保持**: 既存の `self._ble_client` (`Optional[BleakClient]`) + `self.device` (Optional[str]) で表現できる。追加で `self._mode` を足すだけ、新規 dataclass 不要。

**A-2. scan の実装**

`BleakScanner.discover(timeout=N, return_adv=True)` は既に bridge.py:157 で使用済、`_resolve_device` がほぼ同じ処理 (FTMS UUID 持ちを探す)。brief の `scan_result` は全 device + is_ftms フラグを返すので、`_resolve_device` の「FTMS だけ返す」logic から **逆 filter** で「全部返す + FTMS flag を付ける」に書き換える必要あり。新関数として書くか、`_resolve_device` を `_scan_devices() -> list[dict]` + 「FTMS だけ pick する pure 関数」に分割するのが綺麗。後者を採用すると discover.py の library 化と自然に合流する。

**A-3. 結論 (bridge.py)**

fork 不要、protocol 拡張は handler 1 つの分岐追加で済む。ただし brief は (i) state machine 化、(ii) `_resolve_device` の分割、(iii) `--dummy` の挙動が既存仕様であること、の 3 点を文面に追加すべき。これらを追加しないと「protocol 拡張するだけだから 2 時間で終わる」と見積もって 1 日 race debug する。

### B. viewer.js — case 追加で済む、ただし dispatch table 化が望ましい

**B-1. 現 message handler**

`viewer.js:89-99`:
```javascript
ws.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.type === 'state' && typeof msg.speed_mps === 'number') {
    // ...
  }
});
```

`msg.type === 'state'` の単一 if、switch は使われていない。brief の追加要求は 3 type (`scan_result` / `connect_status` / `disconnected`)、合計 4 type。

**B-2. case 追加 vs dispatch table**

4 type なら if/elif でも辛うじて読める、ただし `connect_status` が `state: "connecting"|"connected"|"failed"` の 3 sub-state を持つので実質 6 branch。**dispatch table** か **switch (msg.type)** にすべき:

```javascript
const handlers = {
  state: handleState,
  scan_result: handleScanResult,
  connect_status: handleConnectStatus,
  disconnected: handleDisconnected,
};
ws.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  const h = handlers[msg.type];
  if (h) h(msg);
});
```

refactor 自体は 15 行、existing `playSpeed` 更新 logic は `handleState` 内に**そのまま**移動。データフロー無変更、既存 tick ループとの干渉なし。**安全に landable**。

**B-3. overlay と Phase 0 描画の干渉**

Phase 0 で landed した描画資産:
- Cesium viewer (camera 追従、`tick` ループで毎フレーム `setView`)
- ミニマップ canvas (`#minimap`, top-down + elevation profile、`updateMinimap()` で更新)
- 三角マーカー (`riderEntity`, billboard 形式)
- 進行補間 (`tick` 内、`curIdx` と `curIdx+1` の間で線形補間)

これら全て `tick()` ループに集約され、`requestAnimationFrame(tick)` で連鎖駆動。**overlay は単に DOM 要素を `position: fixed; z-index: 1000;` で重ねるだけ**なので、`tick()` を止めない限り Cesium の描画 (camera 追従、ミニマップ更新) は継続する。brief の「裏の Cesium viewer が描画停止しない」要件は満たせる。

**ただし**、brief の `bridge speed なし時は test mode で進行` を実装するためには、`playSpeed` の初期値 (= 現 `20 / 3.6`) を維持しつつ、bridge から `state` msg が来た時だけ override する current logic で正しい。追加要件なし。

**B-4. race — flyTo と overlay の競合**

`viewer.js:196-203`:
```javascript
viewer.camera.flyTo({
  destination: Cesium.Rectangle.fromDegrees(...),
  duration: 2.5,
  complete: () => {
    lastT = performance.now();
    requestAnimationFrame(tick);
  },
});
```

起動シーケンス:
1. `connectBridge()` (line 119) ── WebSocket 即接続
2. `loadCourse()` ── course.json fetch (数百 ms) → Cesium entity 追加 → `viewer.camera.flyTo` 開始 (2.5 秒)
3. flyTo `complete` callback で `tick` 開始

brief が指定する「起動時 WebSocket 接続成立で `{type: "scan"}` 自動送信、scan_result が来たら overlay 表示」が成立するためには、

- ws.open イベントで `scan` を送信 → bridge が scan に 5 秒かけて応答 → scan_result 到着 → overlay 表示

このシーケンスだと overlay は **flyTo 完了後 + tick 開始後 + 数秒後** に出る。これは UX 的に「app が動き出してから overlay が後付けで出る」ので最悪。

**修正案**: overlay は DOM 構築直後 (= `loadCourse()` 開始前か並走で) に **visible state** で出しておき、内容を `<div id="trainer-setup-content">Scanning...</div>` から徐々に埋める。scan_result 到着で device list 描画、connect_status: connected で hide。これなら起動瞬間から overlay が見えており、Cesium は裏で初期化進行。

brief の文面はこの順序を decree していないので、**順序を明示する 1 行を追加すべき**: 「overlay は app 起動直後に表示 (= DOM 構築時に visible)、scan 結果到着まで Scanning... を表示、scan_result で device list、connect_status:connected で hide」。

### C. discover.py の library 化 — 方向正しい、naming を変えるべき

**C-1. 現状の二重実装**

`discover.py:17-42` (scan 関数) と `bridge.py:152-167` (`_resolve_device`) は同じことをやっている:

- `BleakScanner.discover(timeout, return_adv=True)`
- 結果 dict を iterate
- service_uuids に FTMS UUID が入っているかチェック

差分は出力先 (print vs return) と filter logic (FTMS 全列挙 vs FTMS 1 つ pick) だけ。

**C-2. library 化の正しい形**

brief の「discover.py を library 化して bridge から呼ぶ」は **方向は正しい** が、discover.py という file 名のまま library 化すると CLI と library が同 file に混在して気持ち悪い。提案する分離:

- **新 file `src/fujihc/ble_scan.py`** ── `async def scan_devices(timeout: float = 6.0) -> list[ScanResult]` を export、ScanResult は `dataclass(address, name, rssi, is_ftms)`。pure な library、副作用なし。
- **既存 discover.py** ── `from .ble_scan import scan_devices` して、print loop だけ残す。`__main__` block 維持で CLI 互換性確保。30 行 → 15 行に縮む。
- **bridge.py** ── `from .ble_scan import scan_devices, ScanResult` して、`_resolve_device` を `scan_devices()` を呼ぶ薄い wrapper にする。FTMS の filter は呼び出し側で `[r for r in results if r.is_ftms]`。

これで二重実装解消、CLI として `python -m fujihc.discover` も生き続け、bridge.py 内の scan logic も同じ source を使う。

**C-3. brief 文面の改訂**

「discover.py を library 化して bridge から呼ぶ」 → 「**scan core を `src/fujihc/ble_scan.py` に分離**、discover.py と bridge.py の両者から import」と書き直すべき。「library 化」は CLI を library に変えると読めるが、CLI は維持したい。

### D. CSV format — 無変更で正しい、ただし device_events の schema 未定義

**D-1. 現 CSV**

`logs/2026-05-14-181856.csv`:
```
time_iso,distance_m,speed_mps,power_w,cadence_rpm,slope_sent_pct
```

`bridge.py:312-315` で header 書き込み、`_append_csv` で各 tick (1 Hz) で 1 行。**ride 中の高頻度時系列データ**。

**D-2. pairing 状態は別 file に分離 — 妥当**

pairing event は (scan_started, device_found, connect_attempt, connect_success, disconnect, etc.) の **低頻度イベント**。ride CSV と schema が違う (列が違う) ので **同 file に混在不可**。別 file 分離は妥当。

brief は「pairing 状態だけ別 file に分離」とだけ書いて schema 未定義。決めるべきこと:

- (i) file 名: `logs/2026-05-14-181856-events.csv` か `logs/2026-05-14-181856-pairing.log` (JSON lines) か。CSV で揃えるなら schema 必須、JSON Lines なら柔軟。
- (ii) schema: `time_iso, event_type, device_address, device_name, detail` あたりが minimal。
- (iii) 開閉: ride CSV は `_open_csv()` で開いて `_close_csv()` で閉じる。同じ lifecycle に乗せるか、event 専用 file は bridge 起動時 / 終了時を端とするか。

**ride CSV を一切触らない** という brief の方針は正しい (schema 変更は viewer 側 import 影響、後方互換性破壊)。brief の「別 file に分離」に上記 (i)(ii)(iii) の決定を 3 行追加すべき。

scope 内、Phase 1 で landable。

### E. Phase 0 viewer 資産破壊リスク — 0 件、ただし overlay z-index 注意

**E-1. 既存 z-index 競合**

`index.html:8-33`:
- `#hud` ── `z-index: 999`、左下
- `#controls` ── `z-index: 999`、右下
- `#status` ── `z-index: 999`、右上
- `#minimap` ── `z-index: 999`、左上

全て 999。brief は「overlay の z-index を最上位、controls (右下) より上」と書いている。新 overlay は `z-index: 1000` 以上 + 半透明 backdrop で背後の UI を覆う形にすべき。CSS 1 行で済む。

**E-2. minimap canvas との重なり**

`#minimap` は左上、`#status` は右上。overlay を画面中央に出すと minimap と status を覆うが、これは brief の意図通り (= 「Trainer Setup」 modal が ride 開始まで前面)。問題なし。

**E-3. tick ループは止まらない**

overlay 表示中も `requestAnimationFrame(tick)` は継続。`tick()` 内で `playSpeed` がデフォルト値 (= 20/3.6 m/s) なら test mode で進行、bridge から `state` 来れば override。**Phase 0 描画は overlay 表示中も生き続ける**、brief の要件を満たす。

唯一の懸念は **overlay 表示中の user 入力経路**: 「Skip (dummy mode で続行)」 button 押下は `ws.send({type: "skip"})` か、あるいは overlay を単純に `display: none` にして tick の `playSpeed` だけで動かすか。brief は「dummy mode で続行」と書いているので、後者 (= bridge 側 mode は dummy のまま、overlay hide のみ) が単純。これも明示すべき 1 行。

### F. 「既にある物を直すのが先」directive との整合性

`CLAUDE.md` の優先度 (= 既存 file の修正を新規より優先) に照らすと、brief 11 は:

- 既存修正: bridge.py (protocol 拡張、state machine 化)、viewer.js (handler 増)、index.html (overlay markup)、discover.py (library 化のラッパー)
- 新規 file: `src/fujihc/ble_scan.py` (1 つ)、event log file (新規 .csv だがコード新規ではなく runtime 生成物)

新規 .py file は 1 つ。**既存修正の方が体積として大きく、新規は最小限**。directive 違反ではない。

ただし、brief が「pairing.py を新設」と書く方が誤読されにくい (= 新規 file 数の正直な記述)。現 brief は「discover.py を library 化」と書いて新規 file 1 件の存在を暗黙にしている、ここを明示すべき。

### G. 実装順序の推奨

Phase 0 viewer を壊さない順序:

1. **`src/fujihc/ble_scan.py` 新設** ── scan core を pure library として切り出す。test 容易 (mock しやすい)。discover.py + bridge.py から import するが両者の挙動はまだ無変更。**この時点でユニットテスト緑、既存 CLI / bridge 動作無変更**。
2. **bridge.py の `_resolve_device` を `ble_scan.scan_devices` に置換** ── 外面挙動同じ、内部の二重実装解消。**dummy / 実機両 mode で 1 回ずつ起動して既存挙動と差分なしを確認**。
3. **bridge.py に state machine 導入** ── `self._mode` enum 追加、現 `dummy` / `_ble_client` を mode から導出する property に。**既存 protocol だけで再 round-trip テスト**。
4. **bridge.py に scan / connect / disconnect msg type 追加** ── 新 protocol、まだ viewer 側は受け取らない。**手動で WebSocket client から msg 投げて scan_result が返ることを確認**。
5. **viewer.js の message handler を dispatch table 化** ── 既存 `state` 処理を `handleState` に隔離、case 追加準備。**画面挙動無変更を確認**。
6. **index.html に overlay markup 追加** ── CSS で `display: none` 初期、scan / connect の UI 要素を配置。**画面挙動無変更**。
7. **viewer.js に overlay 表示 logic + connect_status handler 追加** ── overlay 表示 / hide / state 更新を実装。**ここで初めて新 UX が動く**。
8. **dummy mode で全 flow 通し試験** ── overlay 表示 → Skip → dummy で ride → 終了。
9. **実機で全 flow 通し試験** ── overlay 表示 → scan → device 選択 → connect → ride → 切断時 reconnect。

この順序なら、各 step が小さく独立に landable、roll back 単位が小さい。step 1-3 が landed した時点で Phase 0 と完全互換 (= 新機能ゼロだが内部リファクタ完了)、step 4-9 で機能追加。

brief の「完了基準」は最終姿しか書いていないが、上記 9 step の中間 commit point を提案として brief に追記すべき。

---

## まとめ

Brief 11 の **採用案 = B (bridge.py 経由 WebSocket protocol 拡張)** は既存資産との整合性として **本質的に妥当**。fork 不要、Phase 0 描画資産を破壊しない。ただし brief 文面に **以下 7 点の追記** が必要:

1. **bridge.py に state machine (`self._mode`) を明示**、scan/connect 中の race を防ぐ
2. **scan core を `src/fujihc/ble_scan.py` に分離** (discover.py 「library 化」を file 新設として明示)
3. **`--dummy` でも WebSocket 立つ** は既存仕様の文書化 (新規実装ではない)
4. **viewer.js の message handler を dispatch table 化** (4 type 以上で必須)
5. **overlay は DOM 構築直後に visible state**、scan_result 待ちで描画埋め (flyTo との race 回避)
6. **event log file の schema を 3 行で決め切る** (file 名 / 列 / lifecycle)
7. **9 step の実装順序を完了基準セクションに追記** (step 1-3 は機能ゼロの内部リファクタ、step 4-9 で機能追加)

「既にある物を直すのが先」 directive 違反なし。新規 .py file は 1 つ (ble_scan.py)、existing 修正は bridge.py / viewer.js / discover.py / index.html の 4 file、いずれも追記 / 分岐追加で fork 不要。CSV ride log の format は無変更、event log は別 file 新設。Phase 0 で landed した camera 追従 / ミニマップ / 三角マーカー / 進行補間は overlay と直交する layer なので破壊リスク 0、ただし z-index と overlay 表示順序の 2 点だけ brief で明文化が要る。

DONE: 11-pair-existing
