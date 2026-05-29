---
brief: 19-viewer-integration-layer
title: viewer 統合層 (camera tick / WebSocket / ride state) を pure function に切り出す
parent_project: ~/fujihc-trainer/
created: 2026-05-14
depends_on: [17b-viewer-tile-endpoint, 18-js-test-infra]
blocks: []
---

# Brief 19: viewer 統合層 切り出し

## はじめに

7 軸 audit Round 2 の設計境界軸で「brief 18 後も viewer-map3d.js 580 行が残存、 camera tick / WebSocket client / HUD / button bind / ride state machine / loadCourse / MapLibre style 構築が同居、 NG-R1-7 (1 関数 multi-層) と NG-R1-12 (ws.send 7+ 箇所散在) は brief 18 後も解消しない」が flag された。

brief 18 は **pure 計算ロジック (tile 数学 / terrarium / coverage / heading)** の切り出しに留まり、 「統合層」(= state を持つ / 副作用ある / browser API 直依存) は触っていない。 本 brief は残る 580 行を更に切り分け、 viewer-map3d.js を「初期化 + import + 配線」だけの薄い entry にする。

scope を絞るため、 高優先 (= test 規律と再利用性が効く) 3 module だけを対象。 viewer 全部を割らない。

## 切り出す 3 module

### 1. `web/lib/ws_client.js` ── WebSocket protocol client
- 役割: bridge.py との protocol (= 7+ 箇所の `ws.send(JSON.stringify({type:...}))` を集約)
- API:
  ```js
  export function createBridgeClient(url, handlers) {
    // url: ws://127.0.0.1:8765
    // handlers: { onState, onScan, onConnect, onRideStatus, ... }
    // return: { sendStartRide(), sendEndRide(), sendScan(), sendConnect(addr), sendSlope(pct), close() }
  }
  ```
- 副作用: WebSocket 接続のみ、 viewer DOM 依存ゼロ、 純粋に protocol を encapsulate
- test: mock WebSocket で 6 message type の往復、 reconnect 動作、 connection failure handling

### 2. `web/lib/ride_state.js` ── ride 進行 state machine
- 役割: course index / 距離 / speed / slope / paused の管理 (= 現状 viewer.js 内に散在する `curIdx`, `curDist`, `paused`, `lastSlopeSent` 等を集約)
- API:
  ```js
  export function createRideState(course) {
    // return: { advance(dt, speedMps), getCurrentSlope(), getHeading(lookAhead), pause(), resume(), reset() }
  }
  ```
- 副作用ゼロ、 pure data + method
- test: 仮想 course で advance 200 回 → 期待距離、 pause/resume、 reset、 境界 (= course 末尾) 動作

### 3. `web/lib/camera_controller.js` ── camera 位置 + 視野計算 (jumpTo の入力を計算するだけ)
- 役割: ride state → MapLibre camera params (`center`, `zoom`, `pitch`, `bearing`) の計算 (= 現状 tick 関数内に inline)
- API:
  ```js
  export function computeCameraParams(rideState, options) {
    // options: { userZoom, userPitch, lookAheadM }
    // return: { center: [lon, lat], zoom, pitch, bearing }
  }
  ```
- 副作用ゼロ、 MapLibre オブジェクト依存ゼロ (= 計算結果を viewer 側で map.jumpTo に渡す)
- test: 北向き / 東向き / 上り / 下り / userZoom 変更時の bearing と pitch、 ヘディング計算は brief 18 の heading.js を使う

## やらないこと

- 描画関連 (= MapLibre の layer / source 操作は viewer 本体に残す、 純粋な計算層と副作用層を分ける)
- HUD DOM 更新 (= viewer 本体に残す、 ただし数値は ride_state から取る)
- button bind / event listener (= viewer 本体に残す、 ただし handler 中身は createBridgeClient で集約)
- minimap canvas 描画 (= 別 brief、 これも複雑)
- Cesium 版の同様リファクタ (= 凍結)

## 完了条件

1. `web/lib/ws_client.js` / `ride_state.js` / `camera_controller.js` の 3 ファイル landed、 export 済
2. `web/viewer-map3d.js` がこの 3 module を import、 既存挙動を変えない
3. 行数比較: viewer-map3d.js を 580 行 → 250-300 行 (= 残るのは初期化 + import + DOM event 配線)
4. `web/tests/` に 3 test ファイル、 計 15-20 件:
   - `ws_client.test.js` 6 件: 6 message type 送受信、 reconnect、 close
   - `ride_state.test.js` 7 件: advance 累積、 slope 取得、 pause/resume/reset、 course 末尾、 1 点 course
   - `camera_controller.test.js` 5 件: 4 方向 + zoom/pitch 変更
5. `npm test` 全 green (brief 18 までの 26 件 + 本 brief 18 件 = 約 44 件)
6. **viewer 実走確認**: 1 周走行で挙動不変
7. `pytest` 全 green
8. ローカル commit、 push しない

## ハマる罠

- WebSocket は `globalThis.WebSocket` を使う、 Node 環境 (vitest) では `ws` パッケージ等で polyfill 不要 (= mock で済む)
- ride state の `advance(dt, speedMps)` で `dt` 単位を秒で固定、 ミリ秒と混在しない
- camera_controller の戻り値は MapLibre Camera options 形式に合わせる、 ただし内部計算は経緯度 + degrees で完結
- 切り出し後の viewer は「state を持つ部分 (= 3 module) + 副作用部分 (= viewer 本体)」が完全分離、 副作用部分も将来 test する場合は jsdom 系の別 brief
- 行数 580 → 250-300 は目安、 実装で前後する。 重要なのは「state と副作用が分離されている」こと

## まとめ

完了条件: 3 module landed / 18 件 test / viewer-map3d.js 250-300 行 / 実走で挙動不変 / 全 test green。

ship される: viewer 統合層が test 規律内、 ws.send 散在問題解消 (= NG-R1-12)、 1 関数 multi-層問題の主因解消 (= NG-R1-7)、 viewer 本体が「配線層」だけになり可読性向上。
ship されない: 描画 / HUD DOM / button bind の test (= 別 brief、 jsdom 系)、 minimap リファクタ。

次の atom: viewer の残作業 (minimap / DOM event) の test、 Phase 2 (Strava integration)、 もしくは OSS 公開準備。
