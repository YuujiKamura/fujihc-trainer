---
brief: 32-web-bluetooth-trainer
title: GitHub Pages 配信 Phase 2: Web Bluetooth で FTMS trainer 直接接続
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [31-github-pages-static, 19-viewer-integration-layer]
blocks: [33-strava-upload-history]
---

# Brief 32: Web Bluetooth で FTMS trainer 直接接続

## はじめに

brief 31 で viewer が GitHub Pages の静的配信下で起動するようになる (= bridge.py 無し、 tile も remote)。 ただし trainer 接続は依然 `ws://localhost:8765` 前提、 PC で Python bridge を立ち上げないと riding に入れない。 本 brief は **Web Bluetooth API** で viewer から直接 FTMS (= Fitness Machine Service 0x1826) trainer / HRM (= Heart Rate Service 0x180D) を掴むこと。 Chrome / Edge (= Windows / macOS / Android) で「ブラウザだけで富士ヒルを走る」 path を開く、 iOS Safari は Apple 方針で Web Bluetooth 非対応のため対象外。

## 何が今足りないか (= 現状)

- `web/lib/ws_client.js` L27-97: `createBridgeClient` は WebSocket 前提、 `createTestModeClient` (L113-) は固定 fake state、 trainer に直接話す client が存在しない
- `web/viewer-maplibre.js` L591-592: 起動分岐は `MAP_MODE / TEST_MODE / (default) connectBridge` の 3 way、 BLE 直接接続 path 無し
- BLE 関連 logic は Python 側のみ: `src/fujihc/discover.py` L14-46 (= FTMS scan)、 `src/fujihc/bridge.py` L40-46 (= FTMS / HRM UUID 定数)、 L89-108 (= `_parse_heart_rate`)、 L111-151 (= `_parse_indoor_bike_data`)、 L251-270 (= `_encode_set_indoor_bike_simulation`)、 L375-419 (= Control Point indication + 3 段ハンドシェイク)、 L597-651 (= `_hrm_loop`)
- 上記 5 関数は pure binary decode / encode、 JS に移植可能 (= bleak / websockets 依存ゼロ部分)。 だが port 先のテスト基盤が無い (= NG-R1-8 再演を避けるため本 brief 内で test 同時 land)
- GitHub Pages 環境では `http://localhost:8765` への WebSocket は CORS 以前に届かない (= user の PC に bridge が立ってない、 brief 31 の前提)、 BLE 経路が無いと riding 不能

## あるべき構造

```
                                viewer
                                  │
                  起動 4 way 分岐 (= MAP_MODE / TEST_MODE / ?ble=1 / default)
                                  │
                ┌────────────┬────┴───────┬─────────────┐
                ▼            ▼            ▼             ▼
           createMapMode  createTest   createBle    createBridge
           Client         ModeClient   Client       Client
           (fake state)   (fake state) (Web BT)     (WebSocket)
                                          │             │
                                          ▼             ▼
                                       FTMS GATT    bridge.py
                                       + HRM GATT   + trainer
```

4 client は全て **`createBridgeClient` と同 interface** (= `sendRideStart / sendRideEnd / sendScan / sendConnect / sendHrmConnect / sendDisconnect / sendSetSlope / sendPosition / isOpen / close`)、 viewer 側は `client` 変数経由でしか触らないため分岐は起動時の 1 箇所のみ。 既存 `wsHandlers` の dispatch table も再利用 (= `state / scan_status / scan_result / connect_status / hrm_status / ride_status` を BLE 経路でも生成して dispatch)。

## 実装設計

### A. `web/lib/ble_client.js` 新規 (= ws_client と同 interface)

```js
/**
 * Web Bluetooth で FTMS trainer + HRM に直接接続する client.
 *
 * createBridgeClient と同 interface (= viewer 側の起動分岐 1 箇所で切替可).
 * scan / connect は user gesture (= button click) からのみ呼べる (Web BT 仕様).
 *
 * @param {Object} handlers - createBridgeClient と同形 dispatch table
 * @param {Object} [options]
 * @param {Bluetooth} [options.bluetooth] - navigator.bluetooth 注入 (test 用)
 * @param {Storage} [options.storage] - localStorage 注入 (test 用)
 */
export function createBleClient(handlers, options = {}) { /* ... */ }

export function isWebBluetoothSupported(nav = navigator) {
  return !!(nav && nav.bluetooth && typeof nav.bluetooth.requestDevice === 'function');
}
```

内部 state: `{ ftmsDevice, ftmsServer, controlPointChar, hrmDevice, hrmServer, lastDeviceId }`、 全 `null` 初期化。 `sendXxx` は GATT char へ write / state 受信は notify event listener から handlers 経由で dispatch。

### B. FTMS Indoor Bike Data binary parser を JS へ port

`src/fujihc/bridge.py` L111-151 (`_parse_indoor_bike_data`) を `web/lib/ftms_parse.js` に pure function で移植:

```js
/**
 * FTMS Indoor Bike Data (UUID 0x2AD2) notification を decode.
 * spec FTMS 1.0 § 4.9: 16-bit flags + 各 field の little-endian.
 * @param {DataView} view - notification の DataView (event.target.value)
 * @returns {{speed_mps?, cadence_rpm?, distance_m?, power_w?}}
 */
export function parseIndoorBikeData(view) { /* ... */ }

export function parseHeartRate(view) { /* ... */ }   // 0x2A37、 bridge.py L89-108

export function parseControlResponse(view) { /* ... */ }   // 0x80 indication、 bridge.py L231-248
```

`DataView.getUint16(offset, true)` で little-endian、 `getInt16` で signed (= power_w が負値を取り得る、 brake regen 等)。 flag bit assignment は bridge.py と完全一致 (= `more_data=0x0001`、 `cadence=0x0004`、 `distance=0x0010`、 `power=0x0040`)、 既存 pytest fixture の binary を test 共有資産として再利用。

### C. Control Point opcode encoder

`src/fujihc/bridge.py` L251-270 (`_encode_set_indoor_bike_simulation`) を同 module に port:

```js
/**
 * FTMS Set Indoor Bike Simulation Parameters payload (opcode 0x11) を pack.
 * @param {number} gradePct - -32.0 ~ +32.0
 * @returns {Uint8Array} - 7 bytes (opcode + wind(s16) + grade(s16) + crr(u8) + cw(u8))
 */
export function encodeSetIndoorBikeSimulation(gradePct, windMps = 0, crr = 0.004, cw = 0.51) { /* ... */ }
```

clamp 範囲 / scale factor (= grade ×100、 wind ×1000、 crr ÷0.0001、 cw ÷0.01) は bridge.py L258-262 と完全一致。 `DataView` + `setInt16(_, _, true)` で little-endian pack。

3 段ハンドシェイク (= Request Control 0x00 → Reset 0x01 → 省略 Start 0x07) も `connectFtms()` 内で再現、 bridge.py L407-413 の判断 (= Start は Wahoo 系で Operation-Failed を返すため省略) をそのまま踏襲。

### D. HRM 並走接続 (= 別 BLE device)

Web Bluetooth は `requestDevice` 1 回につき 1 device、 trainer と HRM は別 device。 viewer 側 BLE button が 2 つ (= trainer / HRM 別) になる、 `sendScan` を統合せず:

- `sendConnect(undefined)` → `requestDevice({filters: [{services: [0x1826]}]})` を呼んで trainer を取る
- `sendHrmConnect(undefined)` → 同 0x180D で HRM を取る

address 引数は Web BT に存在しない (= browser が device chooser を出す)、 既存 `sendConnect(address)` シグネチャは互換維持のため受け取るが BLE 経路では `device.id` (localStorage 用) として保存のみ。

### E. viewer 起動分岐 4 way 化

`web/viewer-maplibre.js` L591-592 を拡張:

```js
const BLE_MODE = new URLSearchParams(location.search).has('ble');
if (MAP_MODE)        initMapMode();
else if (TEST_MODE)  initTestMode();
else if (BLE_MODE)   initBleMode();   // ← 新規
else                 initBridgeMode();   // L572-585 の従来分岐を関数化
```

`initBleMode()` 内: `setAppState('checking')` → BLE support check → 不支持なら `state-dbinit` overlay に「お使いのブラウザは BLE 非対応 (= iOS Safari / Firefox)、 Chrome / Edge / Android Chrome をご利用ください」表示 → 支持なら setup-overlay の「Trainer に接続」button を user gesture 起点で active 化。

L506 `connectBridge()` も同様に「実装は同 interface の client を作る」へ統一、 関数名は `createClientFromMode()` 等に rename 候補 (= 本 brief 内で実施するか別 brief は判断)。

### F. setup-overlay の BLE button

`web/index.html` の setup-overlay 内、 既存 `#scan / #scan_result` 由来 button group の上 (= BLE mode 専用 section) に:

```html
<section id="ble-section" hidden>
  <button id="btn-ble-trainer">Trainer に接続 (BLE)</button>
  <button id="btn-ble-hrm">心拍計に接続 (BLE、 任意)</button>
  <p class="ble-support-msg" hidden>このブラウザは BLE 非対応です</p>
</section>
```

BLE_MODE 起動時のみ `ble-section` を unhide、 既存 `scan_result` handler は無効化 (= Web BT は browser chooser、 scan_result 概念無し)。 click → `client.sendConnect()` / `client.sendHrmConnect()`、 既存 `connect_status / hrm_status` handler が `state-pairing` 表示を進める。

### G. ブラウザサポート判定 + 永続化

- `isWebBluetoothSupported(navigator)` を起動 1 行目で評価、 false なら BLE button を `disabled`
- 接続成功時 `localStorage.setItem('fujihc.lastBleDeviceId', device.id)` を保存、 next visit で button label を「前回接続: ABC...」に変更 (= 1-click 再接続用)
- ただし Web BT の `device.id` は origin-bound + browser session 単位で変動する仕様、 自動再接続は **試行のみ** で失敗時は通常 chooser に fallback、 過剰な「自動接続できます」を約束しない

## test 戦略

### 新規 test (vitest 約 21-25 件)

1. **`web/tests/ftms_parse.test.js` 8-10 件** (= pure binary decode、 backend pytest と共有 fixture):
   - `parseIndoorBikeData` happy: flags=0x0044 + speed/cadence/power → 全 field decode (= bridge.py L211-221 と同 binary)
   - `parseIndoorBikeData` more_data flag set で speed_mps 不在
   - `parseIndoorBikeData` 短すぎる payload → 空 dict
   - `parseIndoorBikeData` flags 全 1 で全 field 順次 advance
   - `parseHeartRate` uint8 mode (flags bit0=0) / uint16 mode (bit0=1)
   - `parseHeartRate` 空 payload → 空 dict
   - `parseControlResponse` 0x80 + req_op + result_name dispatch
   - `parseControlResponse` 非 0x80 → null
   - `encodeSetIndoorBikeSimulation` happy: gradePct=2.5 → 7 bytes (= bridge.py と一致 hex)
   - `encodeSetIndoorBikeSimulation` clamp: 100.0 → +32.0 / -100.0 → -32.0
2. **`web/tests/ble_client.test.js` 8-10 件** (= Bluetooth API mock 注入):
   - `isWebBluetoothSupported` true / false
   - `createBleClient` 同 interface 5 関数存在 (= `isOpen / close / sendRideStart / sendSetSlope / sendConnect`)
   - `sendConnect` で `bluetooth.requestDevice` が `{filters: [{services: [0x1826]}]}` で呼ばれる
   - `sendHrmConnect` で services=[0x180D]
   - notify event → `parseIndoorBikeData` → `handlers.state(msg)` dispatch
   - `sendSetSlope` で control point char へ `encodeSetIndoorBikeSimulation` の bytes が書かれる
   - `sendDisconnect` で `gatt.disconnect` 呼ばれる、 handlers.connect_status({state: 'disconnected'}) dispatch
   - device 切断 event → `handlers.disconnected` dispatch
3. **`web/tests/viewer_ble_branch.test.js` 2 件**:
   - `?ble=1` で `createBleClient` が select される (= window.location stub)
   - BLE 非対応 (`isWebBluetoothSupported=false`) で `ble-section .ble-support-msg` が visible
4. **`web/tests/ble_responsibility_grep.test.js` 3 件** (= 完了条件 7 の物理 grep gate を test 化、 NG-R1-8 半再演回避):
   - `web/lib/ble_client.js` を `fs.readFileSync` で読み、 `/\bWebSocket\b/` match ゼロを assert (= BLE client に WS 文字列ゼロ)
   - `web/lib/ws_client.js` を読み、 `/\bbluetooth\b/i` match ゼロを assert (= WS client に BLE 文字列ゼロ)
   - `web/viewer-maplibre.js` を読み、 `/navigator\.bluetooth/` match ゼロを assert (= viewer 直叩き禁止、 ble_client.js に閉じる)
   - 既存 brief 19b / 26b の物理 grep gate test (= `web/tests/dbinit_overlay.test.js` 等) と同 pattern、 import path を相対 (`../lib/ble_client.js`) で固定

mock 戦略: `web-bluetooth-mock` library を入れず、 vitest fake で `navigator.bluetooth.requestDevice` / `BluetoothRemoteGATTServer` / `BluetoothRemoteGATTCharacteristic` の最小 surface (= `connect / getPrimaryService / getCharacteristic / startNotifications / writeValueWithResponse / writeValueWithoutResponse / addEventListener / removeEventListener`) を手書き fake で stub (= NG-R3-7 の依存 sprawl 回避、 vendor mock library 追加禁止)。fake は `web/tests/_helpers/bluetooth_fake.js` に切り出し、 ble_client.test.js から import (= test 間で重複させない)。

### 既存 test 不変

- pytest (= 149 件、 brief 26b Round 1 時点) regression なし
- vitest (= 192 件、 brief 26b Round 1 時点) regression なし、 本 brief で +21-25 件 → 約 213-217 件

## やらないこと

- **ANT+ 対応**: Web USB / Web Serial の世界、 FTMS と互換性ゼロ、 別 brief
- **iOS Safari workaround**: Apple は Web Bluetooth を明確に拒否、 Bluefy 等の 3rd-party ブラウザは選択肢だがサポートしない、 user に Chrome / Android / Mac Chrome を案内
- **bridge.py 削除**: ローカル trainer + bridge 環境はそのまま維持 (= GitHub Pages 環境と 2 path 並存)、 `web/lib/ws_client.js` は触らない
- **GSI / OSM tile 取得を BLE 経路に統合**: brief 31 (= GitHub Pages 配信、 remote tile) の責務
- **Strava upload / IndexedDB ride history**: Phase 3 (= brief 33 候補)
- **trainer scan UI の Python `scan` メッセージ互換**: Web BT は browser chooser、 viewer 内 scan list を出さない (= `scan_result` handler は BLE mode で no-op)
- **Power Meter (CPS / Cycling Power Service 0x1818)、 Speed/Cadence Sensor (0x1816) 単独接続**: 富士ヒル用 trainer は FTMS で完結、 対応は別 brief
- **自動再接続 (= visibility change で reconnect / sleep 復帰)**: GATT 切断時の reconnect loop は phase 2、 本 brief は user 手動 reconnect button のみ
- **WebSocket 経路と BLE 経路の同時利用**: 1 viewer = 1 client、 切替は reload 必須 (= 起動分岐 4 way の前提)

## 数値見積もり

- `web/lib/ble_client.js` 新規: 約 **220-260 行** (= scan/connect/notify subscribe/control point write/HRM 並走/disconnect/event listener cleanup)
- `web/lib/ftms_parse.js` 新規: 約 **80-100 行** (= 3 関数、 binary 取り回し)、 bridge.py L89-151 + L231-270 の合計 (= 約 90 行) と同等
- viewer 起動分岐拡張 (= L591-592 周辺): **+20-30 行** (= `BLE_MODE` 定数、 `initBleMode()` 関数、 if 1 行追加)
- `web/index.html` の `ble-section`: **+15-20 行**
- test 新規: **4 file、 21-25 件** (= ftms_parse / ble_client / viewer_ble_branch / ble_responsibility_grep)
- viewer 全体行数: 1225 行 → 約 1255-1275 行 (= +2-4 %、 抑制範囲)
- `npm test`: 192 件 → 約 213-217 件 (= +21-25 件)

## ハマる罠

- **user gesture 制約**: `bluetooth.requestDevice` は `click` / `keydown` event 由来の synchronous 呼出からのみ許可、 起動時自動 scan は仕様で不可。 button click handler 内で直接呼べ、 `setTimeout` 経由は user activation 失効。 「前回 device 自動再接続」も visibility/load 時には呼べない、 必ず button click。
- **GATT 接続失敗 / 再接続**: `device.gatt.connect()` は frequently 失敗する (= OS BT stack の race)、 1 回失敗で諦めず 3 回まで指数 backoff retry が現実解、 ただし retry 間で user activation 失効するため retry も同 click handler の loop 内で完結させろ。
- **notify subscription の重複 / 漏れ**: `startNotifications` を同 char に 2 回呼ぶと event listener が二重発火、 必ず `removeEventListener` で前 listener を外してから再 subscribe。 `disconnect` 時に listener cleanup を忘れると GC されない閉路、 leak 原因。
- **Indoor Bike Data flags の variant**: 実機により対応 field が違う (= power 不在の roller、 cadence 不在の simple trainer)、 `parseIndoorBikeData` は欠落を `undefined` で返し handler 側で null 扱いに正規化、 「存在仮定」のコードを書くな。
- **localStorage device ID の privacy 制約**: Web BT の `device.id` は origin + session 内で stable だが、 browser 再起動 / OS 再 pair で変わる、 完全な「次回 1-click」は保証されない、 UI 文言は「前回の再接続を試みます」止まり。
- **Web Bluetooth は HTTPS 必須**: `localhost` (= http) は許可、 GitHub Pages (= https) も許可、 ただし `file://` は不可。 brief 31 の static 配信が GitHub Pages 前提なら自動的に満たす、 user が `python -m http.server` 等で開いた瞬間に壊れる罠あり、 起動時 `location.protocol !== 'https:' && location.hostname !== 'localhost'` を warn 表示。
- **Control Point response=True の Wahoo 罠**: bridge.py L716-732 の two-mode write fallback (= response=True が失敗したら response=False で retry) は Web BT でも踏襲必要、 `writeValueWithResponse` / `writeValueWithoutResponse` の両方を順に試す logic を `sendSetSlope` 内に置く。
- **Start (0x07) opcode は投げるな**: bridge.py L402-406 で明文化、 多くの実機で Operation-Failed を返し HUD の ack 行が赤で止まる、 Request Control + Reset の 2 段で打ち切れ。
- **第三者 ToS / Rule 11 関連**: Web BT は user の trainer (= user 所有 device) との直通信、 第三者 provider への送信無し、 Rule 11 class C 該当せず。 ride log の Strava upload は brief 33 の責務、 本 brief 範囲内では外部送信ゼロ。
- **NG-R1-3 再演リスク**: 「bridge / trainer / client / BLE / GATT」が用語混在しやすい。 本 brief 内では: **bridge** = Python bridge.py / **trainer** = 物理 FTMS device / **client** = viewer 側の send/recv 抽象 (= `createXxxClient`) / **BLE** = transport / **GATT** = BLE 上の attribute protocol、 この 5 qualifier 固定。
- **NG-R1-7 再演リスク**: `createBleClient` 内に scan / connect / notify dispatch / HRM 並走 / disconnect / state push を全部詰めると 1 関数肥大、 内部 helper (= `_connectFtms` / `_connectHrm` / `_onIndoorBikeNotify` / `_disposeListeners`) に分けて主関数は dispatch のみ。
- **NG-R1-12 再演リスク**: 既存 `wsHandlers` を BLE 経路用に複製しないこと、 同 handlers を `createBleClient` にも渡し、 client 側で `state / connect_status / hrm_status / ride_status` メッセージを合成して dispatch (= 既存 contract 互換)。

## 完了条件

1. `web/lib/ftms_parse.js` 新規、 `parseIndoorBikeData` / `parseHeartRate` / `parseControlResponse` / `encodeSetIndoorBikeSimulation` の 4 関数 export
2. `web/lib/ble_client.js` 新規、 `createBleClient` + `isWebBluetoothSupported` の 2 関数 export、 既存 `createBridgeClient` と同 interface 9 method
3. `web/viewer-maplibre.js` の起動分岐 L591-592 を 4 way 化、 `BLE_MODE` + `initBleMode()` 追加、 既存 3 mode (= MAP/TEST/default) 不変
4. `web/index.html` に `<section id="ble-section">` 追加、 BLE mode 時のみ unhide、 既存 `setup-overlay` の DOM は触らない (= NG-R1-3 / NG-R1-7 再演回避、 独立 section)
5. test 新規 21-25 件 (= `ftms_parse.test.js` 8-10 / `ble_client.test.js` 8-10 / `viewer_ble_branch.test.js` 2 / `ble_responsibility_grep.test.js` 3)、 全 green
6. `npm test` 約 213-217 件 全 green、 `pytest` 149 件 regression なし
7. 物理 grep gate (= `ble_responsibility_grep.test.js` 3 件で test 化、 inline doc には書かない、 落ちれば必ず止まる物理層): (a) `web/viewer-maplibre.js` 内に `navigator.bluetooth` 文字列ゼロ (= ble_client.js に閉じる、 viewer 直叩き禁止)、 (b) `web/lib/ble_client.js` 内に `WebSocket` 文字列ゼロ、 (c) `web/lib/ws_client.js` 内に `bluetooth` 文字列ゼロ (case-insensitive)
8. ローカル commit のみ、 push は user per-action 認可 (Rule 3) 待ち
9. brief 31 (= GitHub Pages 静的配信) との接続確認: BLE_MODE 起動 → trainer 接続 → ride 開始 → tile 表示 (= remote tile を brief 31 が解決) が end-to-end で動く mental model 説明を完了条件文書に含める
10. 既存 `test_bridge.py` / `test_ws_smoke.py` / `web/tests/ws_client.test.js` 不変 (= bridge / WS 経路は触らない、 並存維持の証跡)

## まとめ

ship される: `?ble=1` で起動した viewer が Chrome / Edge / Android Chrome 上で FTMS trainer と HRM に直接接続、 bridge.py 無しで riding に入れる。 FTMS Indoor Bike Data の binary parse / Control Point の勾配 write / HRM の心拍取得を JS 側で完結、 既存 ws_client interface と完全互換のため viewer 本体の 1 起動分岐追加で済む。

ship されない: ANT+、 iOS Safari、 自動再接続 loop、 Strava 連携、 IndexedDB ride history、 power meter / cadence sensor 単独接続、 WebSocket + BLE 同時利用。

## 次の atom

- brief 33 候補: ride 終了後の Strava OAuth + IndexedDB ride history (= Phase 3、 Rule 11 C2 範囲内で本人 OAuth + ローカル保存、 公開 redistribution は禁止維持)
- brief 34 候補: Web BT GATT 切断時の指数 backoff 自動再接続 + visibility change hook (= 本 brief の「自動再接続なし」制約を解除、 user activation 制約と折り合いをつける設計)
- brief 35 候補: BLE mode 用 setup-overlay の UX (= 「Chrome 以外で開かれた時の案内」「前回接続 device 再接続 UI」「HRM 任意 skip flow」を独立 brief 化、 本 brief は実装のみで UX 磨きは別)
