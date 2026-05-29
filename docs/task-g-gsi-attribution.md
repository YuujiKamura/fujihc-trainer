# タスク: 国土地理院クレジット表記の復活

## 目的

viewer の画面から国土地理院 (GSI) の地形データ出典クレジット表記が消えている。GSI タイルの利用規約は出典明示を必須としており、表記が無い状態はコンプライアンス違反。原因を特定して復活させ、二度と黙って消えないようテストで固定する。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit まで、`git push` 禁止。

## 現状（調査の手がかり）

- viewer には出典表記用の `#attrib` 要素があり、`© 国土地理院タイル` のテキストと `https://maps.gsi.go.jp/development/ichiran.html`（地理院タイル一覧）へのリンクを表示する仕様だった。
- それが今、画面に出ていない。最近の改修（OSM の vector 化、terrain3d 統合、viewer-map3d.js 改修）のどこかで、CSS で隠れた / DOM から要素が消えた / 他要素に z-index で覆われた / 生成経路が壊れた、のいずれか。
- viewer は GSI タイルと OSM の両方を使う。GSI（© 国土地理院）と OSM（© OpenStreetMap contributors）の両方の出典が要る。OSM 側の表記の有無も併せて確認しろ。

## やること

1. viewer を実際に動かして（`verify-fujihc-screen` スキルで実画面を観て）、GSI 出典表記が画面に出ていないことを確認し、消えた原因を特定する。原因を推測で済ませず、コードと実画面で突き止めろ。
2. 出典表記を復活させる。GSI（`© 国土地理院` ＋ 地理院タイル一覧へのリンク）と OSM（`© OpenStreetMap contributors`）の両方が、checking / dbinit / pairing / riding のどの画面でも常時見える状態にする。
3. 出典表記が DOM に存在し可視であることを固定するテストを足す（既存のテスト機構を使え）。`display:none` にされた / 要素が消えた / 他要素に覆われた、を捕まえられること。
4. 真正性確認（必須）: 出典要素を 1 箇所わざと壊す（隠す）と、足したテストが落ちることを手元で 1 回試せ（確認したら戻す）。落ちないなら真正でない、書き直し。

既存の関連テスト・コード（`web/viewer-map3d.js` の attribution 生成箇所、index 系 HTML、attribution 関連の既存テストがあれば）をまず読め。「既にある物を直す/強める」が優先、新規ファイルは必要なときだけ。

## 検証

- `npm test`（vitest）、`npm run test:e2e`（Playwright）、`python -m pytest` を全て走らせ全 green。
- `verify-fujihc-screen` スキルで実画面を観て、GSI と OSM の出典が画面に見えることを批評しろ（「出てる」で済ませず、どこに何の文字で出ているかを書け）。
- 真正性確認の結果を報告。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。
- 地図タイル配布元配慮ルール（GSI タイルの取得上限・並列数、`bridge.py` の `127.0.0.1` bind 固定）を破るな。
- **画面確認は `desk_capture` のみ使え。`chrome --headless` 直叩きも `headless-shot.ps1` も使うな** ── viewer は never-idle なページ（無限 rAF + Service Worker）で headless Chrome が終わらず、前の G worker はこれで端末ごと固まって全滅した。`desk_capture`（deskpilot、既存の Chrome ウィンドウを撮るだけで Chrome を spawn しない）だけを使え。viewer を映した通常の Chrome ウィンドウが無ければ、自分で 1 回だけ通常の Chrome タブで `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` しろ。
- ローカル commit まで。`git push` 禁止。

## 完了報告

出典表記が消えていた原因、直したファイル、復活後の実画面の観察結果（GSI/OSM の文字がどこに出ているか）、追加したテスト、真正性確認（わざと隠したら落ちた）の結果、`npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。
