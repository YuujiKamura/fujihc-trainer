# タスク: ペアリングからライド開始までの一気通貫テスト

## 目的

トレーナーとのペアリング → ライド開始（走行画面への遷移）の全フローを、**実ブラウザで本物の viewer を動かして**通すテストを 1 本作る。実フローが壊れたら落ちるテストにする。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。直接作業してよい。
- ローカル commit まで。`git push` は禁止。

## なぜ・現状のギャップ（調査済み）

このフローのバグが過去に何度も出ている（ハンドシェイク後にライド開始を押しても画面遷移しない 等）。バグの本体は `viewer-maplibre.js` のグルー（setAppState の状態遷移、consent overlay の z-index 等）にあった。

今あるフロー系テスト（`web/tests/integration_ble_ride_start.test.js`, `integration_ride_consent_pair.test.js` 等）は、**`viewer-maplibre.js` を import せず、viewer の DOM 操作ロジックを test 内に shim として再実装**し、その shim の挙動を pin している（+ 実 source への regex grep）。

弱点: shim は viewer-maplibre.js の「写し」であって本体ではない。本体が shim と食い違う形で壊れても shim ベースのテストは通り続ける（＝偽の安心）。過去のバグは本体グルーにあったので、本体を動かさないテストでは原理的に捕まらない。「一気通貫」で本物の viewer を通すテストが無い。

## やること ── 実ブラウザ E2E

`bridge.py` を `--dummy --http-port 8000 --port 8765` で起動すると、本物の viewer が `:8000` で配信され、トレーナーもダミーで模擬される（呼出側が起動済の前提でよいが、落ちていたら起動してよい）。

実ブラウザで viewer を読み込み、ペアリング → ライド開始まで**実 viewer を駆動**し、走行画面（`state-riding`）に遷移したことを assert するテストを 1 本書く。フロー: トレーナー検出/接続（ハンドシェイク）→ 地形 ready → ライド開始 → consent → `state-riding`。

- ブラウザ自動操作の基盤がリポに無ければ Playwright を devDependency に足してよい。**ただし Playwright 専用ブラウザの巨大ダウンロードは避け、システムの Chrome を使え**（`channel: 'chrome'`）── C ドライブ容量に配慮。
- BLE（トレーナー）側は、`--dummy` bridge の模擬トレーナー、または `web/tests/_helpers/bluetooth_fake.js` の fake を使う。実機 Bluetooth は不要。
- 既存の `integration_ble_ride_start.test.js` / `integration_ride_consent_pair.test.js` がフローのどの段を見ているかを最初に読め。E2E はそれらと重複してよいが、「本体 viewer を通す」点で別物。
- もし真正な browser E2E が今夜のうちに安定して landing できないと判断したら、**実フローモジュール（`web/lib/ble_client.js` / `ws_client.js` / `ride_state.js` / `consent.js` ── node import 可）を実際に import・結線して駆動する vitest 統合テスト**に fallback してよい。その場合は「browser E2E に届かず fallback した、理由は X」と完了報告に明記しろ（黙って弱いテストにすり替えるな）。

核心要件（方式によらず）: 実コードを動かし、ペアリング→ライド開始の遷移が壊れたらテストが落ちること。shim 再実装の焼き直しは不可。

## 検証

- `npm test`（vitest）全 green。browser E2E を足したならその実行方法（npm script 等）を整え、実際に走らせて通ることを確認しろ。
- `python -m pytest` も走らせ全 green（壊していないこと）。
- **真正性の確認（必須）**: viewer / フローの遷移を 1 箇所わざと壊すと新テストが落ちることを手元で 1 回試せ（落ちることを確認したら戻す）。落ちないなら shim と同じ穴 ── 書き直し。結果を完了報告に書け。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。
- リポ CLAUDE.md の地図タイル配布元配慮ルール（`bridge.py` の bind 等）を破るな。
- `chrome --headless` の直叩き禁止。ブラウザは Playwright か `verify-fujihc-screen` スキルの安全な起動方法で。
- ローカル commit まで。`git push` 禁止。

## 完了報告

採った方式（browser E2E / 実モジュール統合 fallback）とその理由、追加/変更したファイル、真正性確認（わざと壊したら落ちた）の結果、`npm test` と `python -m pytest` の passed / failed 数。
