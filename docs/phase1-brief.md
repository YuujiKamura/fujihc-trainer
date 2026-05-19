---
phase: 1
target: trainer-bridge + viewer 接続
parent_project: ~/fujihc-trainer/
created: 2026-05-14
delegated_to: ghostty-55228 (claude + OMC)
---

# Phase 1 brief: trainer-bridge + viewer ↔ bridge

Phase 0 で `~/fujihc-trainer/` に course / discover / viewer (3D) が landed。
Phase 1 では trainer 制御と viewer の接続を作る。

## Phase 0 で landed 済 (= 触らない、前提)

- `src/fujihc/course.py` ── GPX → 距離 / 標高 / 勾配 sequence
- `src/fujihc/discover.py` ── BLE FTMS scanner
- `web/index.html` + `web/viewer.js` ── Cesium 3D viewer、camera が GPX を auto 進行 (test mode で playSpeed 固定)
- `web/course.json` ── course の JSON dump
- 依存: bleak, gpxpy 既に install 済

## Phase 1 で landing する物

### A. `src/fujihc/bridge.py` ── trainer ↔ WebSocket bridge

機能:
1. bleak で FTMS device (UUID 0x1826) に接続 (引数で device address 受け取る、なければ最初の FTMS を auto-select)
2. Indoor Bike Simulation Parameters (= 勾配 / wind / Crr / weight) を write_gatt_char で送信できる API を出す
3. Indoor Bike Data notification を subscribe、(timestamp, speed_mps, power_w, cadence_rpm, distance_m) を取り出す
4. WebSocket server (port 8765) を立てて、viewer に向けて受信データを 1Hz で push、viewer からの指示 (= 勾配 set) を受けて trainer に write
5. trainer が見つからない場合の dummy mode: viewer に対して固定 20km/h の speed を流して、勾配 set は no-op (= 開発時の standalone debug 用)
6. CLI: `python -m fujihc.bridge [--device <addr>] [--dummy] [--port 8765]`

### B. `web/viewer.js` の WebSocket 化

現状: `playSpeed` が test mode で固定。
変更: WebSocket (ws://localhost:8765) に接続して bridge からの speed を受け取り、playSpeed に反映。
進行に応じて、現在 index の slope を WebSocket message として bridge に送信 (= 勾配コマンド)。
接続失敗時は test mode (playSpeed=30) にフォールバック。

### C. ride log: 簡易 CSV

bridge が 1Hz で受信した state を `~/fujihc-trainer/logs/<YYYY-MM-DD-HHMMSS>.csv` に append。
列: `time_iso, distance_m, speed_mps, power_w, cadence_rpm, slope_sent_pct`
完走後の Strava 用 .fit 出力は Phase 2、CSV だけで十分。

## 完了基準

1. dummy mode で WebSocket round-trip 動く: `bridge --dummy` + viewer ブラウザで開く → viewer の HUD が 1Hz で更新、controls の pause / fast がコマンドとして bridge log に出る
2. trainer 接続 mode は実機テスト必要 (yuuji の environment)、bridge.py が discover で見つけた device address に対し接続試行できる exception を吐かないこと
3. ride log CSV が完走後に書かれる
4. 既存 Phase 0 file は壊さない (course.py / discover.py / web/index.html は触らない、viewer.js のみ拡張)

## 実装規律

- 既にある物を直すのが先、勝手な新規 file 増やすな (新規 file は bridge.py のみ予定)
- 内部用語ゼロ、人間の言葉で報告
- 完走後 `git init` してローカル commit、push しない、remote 作らない
- Strava OAuth / .fit / 過去 ride 比較 / 一人称↔三人称切替 は Phase 2 以降、本 brief に含めるな
- BLE pairing 失敗 / port 衝突 / device 見つからない の error path は明示的に dummy mode に落とす
- 完成したら main session に「DONE: Phase 1」とだけ報告

## 既知の落とし穴 (reviewer 集約から)

- Cesium Ion token なしで動かしている、Phase 1 で token 必要にしないこと (現状 OSM imagery + EllipsoidTerrain)
- bleak の Windows native pairing は 11 で hangs 報告あり、connect timeout 設けて 5s で諦め → dummy mode フォールバック
- FTMS の Indoor Bike Simulation Parameters write は trainer により support 不完全、write 失敗を error にせず warn ログのみ
- engine と bridge を別 process に分けるな、1 process (bridge.py 単独) で WebSocket server も持つ

## 参考ファイル

- `~/fujihc-trainer/src/fujihc/course.py` ── slope/distance データの取り扱い
- `~/fujihc-trainer/web/viewer.js` ── playSpeed / curDist の更新ロジック
- `~/.agents/scratch/fujihc-trainer-project/briefs/05-trainer-bridge.md` ── BLE FTMS 接続フロー詳細
- `~/.agents/scratch/fujihc-trainer-project/reviews/01-tech-feasibility.md` ── 技術現実性 review (engine 統合推奨等)
- `~/.agents/scratch/fujihc-trainer-project/reviews/03-landability.md` ── 着地可能性 review (scope creep 警告)
