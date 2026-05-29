# タスク: テストモード切替ボタンの追加

## 目的

viewer の TEST_MODE（URL の `?test` パラメータで起動時に決まる）が本番のトレーナー BLE ハンドシェイクを阻んでいる。実機トレーナーに繋ぎたいのに、テストモードを抜けるには URL を書き換えて再読込するしかなく、画面から制御できない。viewer 内に「テストモード ⇄ 本番モード」を切り替えるボタンを足し、本番モードに切り替えれば実機のトレーナースキャンとハンドシェイクが立ち上がるようにする。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit まで、`git push` 禁止。

## 現状（調査済みの手がかり）

- `web/viewer-map3d.js`: `TEST_MODE` 定数が `new URLSearchParams(location.search).has('test')` で起動時に確定（428 行付近）。`initTestMode()` が 775 行付近。起動ディスパッチで `else if (TEST_MODE) initTestMode()`（1132 行付近）── TEST_MODE が立つと本番ペアリング経路の代わりにテスト経路へ分岐している。
- このため `?test=1` で開くと、トレーナースキャン → 本番 BLE ハンドシェイクの経路に入れない。

行番号は手がかり。現物を読んで確定しろ。

## やること

1. `viewer-map3d.js` の TEST_MODE 分岐を読み、テストモードが本番ハンドシェイク経路をどう塞いでいるか正確に把握する。
2. viewer の画面に「テストモード ⇄ 本番モード」を切り替えるボタン（または明示的なトグル UI）を足す。現在どちらのモードかが一目で分かる表示にする。
3. 本番モードに切り替えたら、実機トレーナーのスキャン → BLE ハンドシェイク経路が実際に立ち上がること。テストモードに切り替えたら従来どおりテスト経路。
4. 切替方式: `?test` の有無を変えてページを再読込する方式が最も単純で堅い（TEST_MODE は起動時定数のまま、ボタンは URL を書き換えて reload）。再読込なしのランタイム切替は、TEST_MODE 定数の参照箇所が広く init 経路が既に走っているため侵襲的 ── 明確に安全だと確認できる時だけ採れ。どちらを採ったか完了報告に書け。
5. 走るテストを足す（既存のテスト機構を使え。Task A で導入済みの Playwright E2E が使える）。「ボタンでモードを切り替えられる」「本番モードでトレーナースキャン経路に到達する」を pin しろ。
6. 真正性確認（必須）: 切替経路を 1 箇所わざと壊すとテストが落ちることを手元で 1 回試せ（確認したら戻す）。落ちないなら真正でない、書き直し。

既存の関連コード・テスト（`viewer-map3d.js` の TEST_MODE / initTestMode、BLE ペアリング系、`integration_ble_ride_start.test.js` 等）をまず読め。「既にある物を直す/強める」が優先、新規ファイルは必要なときだけ。

## 検証

- `npm test`（vitest）、`npm run test:e2e`（Playwright）、`python -m pytest` を全て走らせ全 green。
- `verify-fujihc-screen` スキルで実画面を観て、切替ボタンが表示され、押すとモードが変わることを批評しろ。
- 真正性確認の結果を報告。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。
- `bridge.py` は `127.0.0.1` bind 固定。
- **画面確認は `desk_capture` のみ。`chrome --headless` 直叩きも `headless-shot.ps1` も使うな** ── viewer は never-idle なページ（無限 rAF + Service Worker）で headless Chrome が終わらず worker ごと固まる（前の worker がこれで全滅した）。`desk_capture`（既存の Chrome ウィンドウを撮るだけで Chrome を spawn しない）だけを使え。viewer を映した通常 Chrome ウィンドウが無ければ、自分で 1 回だけ通常タブで `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` しろ。
- ローカル commit まで。`git push` 禁止。

## 完了報告

TEST_MODE が本番経路をどう塞いでいたか、採った切替方式（reload / ランタイム）とその理由、追加/変更したファイル、本番モードでトレーナースキャンに到達することの確認、追加した E2E テスト、真正性確認の結果、`npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。
