# brief 19 — ws_client subagent report

## Scope
- 切出対象: `web/lib/ws_client.js` (新規)
- テスト: `web/tests/ws_client.test.js` (新規)
- viewer-map3d.js は触っていない (= main session の統合責務)

## 成果物

### `web/lib/ws_client.js`
- `createBridgeClient(url, handlers, options)` — 本物 WebSocket を使う client
  - `options.WebSocketImpl` で実装注入 (テストで FakeWebSocket を入れる)
  - `options.onOpen / onClose / onError` で接続状態 callback
  - `options.autoConnect` (default true) で即座 connect、 false なら手動 `connect()`
  - send helpers: `send(payload)` / `sendRideStart` / `sendRideEnd` / `sendScan` / `sendConnect(address)` / `sendHrmConnect(address)` / `sendDisconnect` / `sendSetSlope(slopePct)` / `sendPosition(distance_m, lat, lon, elevation_m)`
  - OPEN 前 send は `false` を返して silent drop (viewer 既存挙動と一致)
  - 受信は `handlers[msg.type](msg)` に dispatch、 未知 type / 非 JSON は silent drop
  - `isOpen()` / `close()` / `getWebSocket()` も export
- `createTestModeClient(handlers, options)` — fake client (brief 22 `?test=1` 用)
  - `fakeStateInterval` (default 1000ms) ごとに `handlers.state(generator())` を呼ぶ
  - `sendRideStart` → `ride_status({state:'started'})` loopback
  - `sendRideEnd` → `ride_status({state:'ended'})` loopback
  - `sendScan` → `scan_status({state:'failed', message:'TEST MODE (no BLE)'})` loopback
  - その他の send は silent (trainer 不在のため応答なし)
  - `options.setInterval/clearInterval/setTimeout` で timer 注入 (vi.useFakeTimers と協調)

### `web/tests/ws_client.test.js`
- 20 tests、 全 green
  - connection lifecycle (3): autoConnect / close / impl 未指定 throw
  - send helpers (9): RideStart / RideEnd / Scan / Connect+HrmConnect / SetSlope / Position / Disconnect / OPEN 前 silent
  - message dispatch (3): type 別 dispatch、 未知 type silent、 handlers={} 安全
  - test mode client (6): state 定期 push / ride_start loopback / scan loopback / close 後停止 / カスタム generator / 未知 type silent

## 検証 (Rule 1)
- baseline: `npm test` 52/52 passed
- 実装後: `npm test` **96/96 passed** (= peer B `ride_state.test.js` 12 件と peer C `camera_controller.test.js` 12 件も既に landed、 衝突なし)
- 既存 52 件は壊していない (heading / tile_math / tile_coverage / terrain_mesh / terrarium / viewer_url_audit)
- ws_client.test.js 単体: 20/20 passed
- viewer-map3d.js は無変更、 main session が後続 commit で `createBridgeClient` を呼ぶ統合作業

## 注意点 (main session 向け統合メモ)
1. viewer は今 `WS_URL` 定数 + `connectBridge()` + `initTestMode()` + `wsHandlers` + `maybeSendSlope` を内包している
2. 統合時の置換手順:
   - `import { createBridgeClient, createTestModeClient } from './lib/ws_client.js'`
   - `TEST_MODE ? createTestModeClient(wsHandlers) : createBridgeClient(WS_URL, wsHandlers, { onOpen: ..., onClose: ... })`
   - `ws.send(JSON.stringify({type:'ride_start'}))` → `client.sendRideStart()` 等で置換 (= 7-10 箇所)
   - `maybeSendSlope` の rate-limit 部分は viewer 側に残し、 最終 send だけ `client.sendSetSlope()` に置き換える (rate-limit は client の責務ではない、 ride state の責務)
3. `wsHandlers` は今 DOM 操作を含むので viewer 側に残す (= 本 module は触らない)
4. fake ws の `readyState: 1` ハック (viewer 既存 372-387 行) は `createTestModeClient` で吸収済、 統合時は丸ごと削除可能

DONE: ws_client (20 tests)
