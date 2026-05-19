---
brief: 11-pairing-in-app
title: スマートトレーナー ペアリングフローを web app 内に取り込む
parent_project: ~/fujihc-trainer/
created: 2026-05-14
---

# Brief 11: ペアリングフロー を web app 内で完結させる

## 現状の不便さ

ride 開始までに以下 3 ステップが必要:
1. Git Bash でターミナル開く
2. `python -m fujihc.discover` → BLE scan → 結果の MAC アドレスを目で読んでコピペ
3. `python -m fujihc.bridge --device <addr>` で実機 bridge を起動
4. browser を Ctrl+Shift+R で reload

毎 ride 4 アクション、毎回 trainer の電源を入れる/切る都度に MAC を確認するなら 5-7 分 ロス。富士ヒル本番までに 5-10 回走るなら 30-70 分 の累積ロス、これは「200 ドル払って 200 ドルの損失」class に近づく。

## 望ましい flow

bridge 1 回起動しておけば、以下が全て browser UI で完結:
1. browser で `localhost:8000/` を開く
2. 画面に「Trainer Setup」overlay が出る (= 未接続時のみ)
3. 「Scan」ボタン押す → 5 秒後に FTMS 機器リスト表示 (= device name + RSSI)
4. リスト項目クリック → 「Connecting...」 → 接続成功で overlay 閉じる → ride 開始可能
5. 接続失敗時は overlay に「失敗 (理由)」を表示、リトライ可能
6. ride 中 にトレーナー切断 → overlay 再表示 (Auto reconnect 試行 + 手動再選択)

## 技術 path 比較

### A. Web Bluetooth API (browser 直 BLE)
- pros: Python bridge 完全不要、構造単純化、HTTPS なし (localhost 許可)
- cons: Chrome / Edge 限定、Firefox は未サポート、FTMS の write_gatt_char は可能だが characteristic UUID の手書き入力が必要。Python の pycycling を捨てる規模、Phase 0-1 で landed した bridge.py 全廃。
- 判定: scope 大きすぎ、現実装の捨て直しになる → 不採用

### B. bridge.py 経由 (WebSocket でコマンド送受信)
- pros: bridge.py を拡張するだけ、pycycling/bleak の Python 資産を活かす、既存 viewer の WebSocket connection を流用
- cons: bridge.py に protocol 拡張、UI と bridge 両方触る
- 判定: 「既にある物を直すのが先」directive と整合、採用

### C. HTTP API + Server-Sent Events
- pros: 単純な GET/POST、debugging しやすい
- cons: 2 つの protocol (HTTP + WebSocket) 並走、message 統一性なし
- 判定: B より構造的に複雑、不採用

## 採用案 = B (bridge.py 経由 WebSocket protocol 拡張)

### 既存 protocol (= 維持)
- bridge → viewer: `{type: "state", speed_mps, power_w, cadence_rpm, distance_m}`
- viewer → bridge: `{type: "set_slope", slope_pct}`

### 追加 protocol
- viewer → bridge:
  - `{type: "scan"}` — BLE scan 開始指示
  - `{type: "connect", address: "XX:..."}` — 選択した device に接続
  - `{type: "disconnect"}` — 切断
- bridge → viewer:
  - `{type: "scan_result", devices: [{address, name, rssi, is_ftms}]}` — scan 完了
  - `{type: "connect_status", state: "connecting"|"connected"|"failed", message}` — 接続経過
  - `{type: "disconnected", reason}` — 切断通知

### bridge.py 実装変更
- `--dummy` 起動時も WebSocket は立てる、scan/connect 命令で実機 mode に switch
- BLE scan は `BleakScanner.discover()` を非同期で呼ぶ
- connection state を保持、現 device address を内部 attribute に
- disconnect → dummy mode に fallback、新 connect で再接続

### viewer 側 UI 変更
- index.html: `<div id="trainer-setup">` overlay (modal style、半透明背景 + 中央 panel)
- viewer.js:
  - 起動時 WebSocket 接続成立で `{type: "scan"}` 自動送信、scan_result が来たら overlay 表示
  - overlay 内 list の各項目クリックで `{type: "connect", address}` 送信
  - `connect_status: connected` で overlay hide、ride 開始可能に
  - `disconnected` で overlay 再表示、reconnect ボタン

## UX 設計

### Setup overlay の中身
```
+-------------------------------+
| Trainer Setup                 |
|                               |
| [ Scan ]   状態: scanning... |
|                               |
| 検出された機器:                |
|   Wahoo KICKR    rssi -45     |
|   Tacx Neo       rssi -67     |
|   Garmin HR      rssi -55     |
|                               |
| Skip (dummy mode で続行)      |
+-------------------------------+
```
- 起動時自動 scan、5 秒後 list 表示
- FTMS 持つ機器を上位、HR モニタ等は下位
- list 項目クリック → 接続試行、進捗は同 overlay に「Connecting to KICKR... (3s)」
- 失敗時は赤メッセージ + 同 list でリトライ or 別 device 選択
- 「Skip」で dummy mode 継続 (= 開発時 / trainer なし demo 用)

### ride 中の切断
- 切断検知 → overlay 再表示、自動 reconnect を 3 回試行 (3/6/12 秒間隔)、全失敗で手動選択

## 失敗してはいけない UX (brief 06 から継承)

- overlay 表示中に裏の Cesium viewer が描画停止しない (= 動き続ける、ただし bridge speed なし時は test mode で進行)
- overlay の z-index を最上位、controls (右下) より上
- ride 中 application crash しない

## リスク + 回避

1. **Windows 11 bleak の hangs** (review 01 警告) — connect_timeout 5 秒、超過で `connect_status: failed` を viewer に返して overlay でリトライ可能
2. **trainer の prior pairing** — Zwift 等が pair 済の trainer は scan に出るが connect 失敗、エラーメッセージで「他アプリ停止してから」と表示
3. **scan 中の UI freeze** — bleak の scan は async、bridge は別 task で実行、viewer は state push 待ち中も UI 操作可能 (Skip ボタン押せる)
4. **page reload で connection 切れる** — bridge 側は connection state を保持、新 WebSocket 接続で `{type: "current_state"}` を即送り返し、overlay を skip 可能

## 完了基準

1. dummy mode で起動 → scan 動作確認 (BLE 機器がなくても空 list が返る)
2. yuuji の trainer 実機で scan → list に表示 → クリック → 接続成功 → overlay 閉じる → ride 開始
3. ride 中 trainer の電源 OFF → overlay 再表示 → 電源 ON → 自動 reconnect 成功
4. 「Skip」で dummy mode 起動も可能

## scope 外 (Phase 2)

- 複数 trainer / HR モニタ / power meter の同時接続
- device の電池残量表示
- 接続履歴の保存 (= 前回 device を default 候補に)
- カスタム device name (例 "KICKR (自宅)")
