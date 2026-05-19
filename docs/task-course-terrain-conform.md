# タスク: 3D コースが地形に埋まる問題の修正

## 目的

viewer の 3D コース（富士スバルラインの帯）が、地形メッシュに部分的に埋まってしまう。高さオフセットを 8m まで上げれば埋まらなくなるが、それは対症療法。コースを地形メッシュの表面に沿わせて（地形の起伏に追随する形で）形成し、自然な小さいオフセットで埋まらないようにする。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。ローカル commit まで、`git push` 禁止。
- viewer は `http://127.0.0.1:8000/` で配信中（既存サーバが稼働している、bridge を二重起動するな）。

## 現状・なぜ（user の分析）

- 3D（Three.js）のコースの帯は地形メッシュと食い違っていて、部分的に埋まる区間が出る。一律の上方オフセットを大きくする（8m）と隠れるが、それは誤魔化し。
- user の見立て: コースを「地形メッシュと同一法線の面」として、つまり地形の起伏に沿った形で形成しないと、食い違って埋まる。
- user の疑問: **MapLibre 版のコースは埋まりが気にならなかった。なぜか。** ── これを必ず調べろ。MapLibre 版がコースをどう地形に乗せているか（標高サンプリング、drape、per-vertex elevation 等）と、3D（Three.js）版がどうしているかを比較し、差を突き止めてから直せ。MapLibre 版の方式が答えのヒント。

## やること

1. 3D コースの帯を生成しているコードを特定して読む（`web/lib/map3d/` 配下のコース系モジュール等）。`web/lib/terrain3d.js` は地形メッシュ生成側で無改造、直すのはコース側。
2. MapLibre 版のコース描画と比較し、「なぜ MapLibre 版は埋まらないか」を突き止める。完了報告にその理由を書け。
3. 3D コースの帯を、地形メッシュの表面に沿う形（コースの各点で地形標高をサンプリングし起伏に追随する頂点列）で生成するよう直す。一律の大きな上方オフセットに頼らず、自然な小さいオフセットで全区間埋まらないようにする。
4. 全区間で埋まりが出ないことを確認する（`desk_capture` で実画面を観て、コースが地形から浮かず沈まず乗っていることを批評）。
5. 走るテストを足す/強める（コース頂点が地形標高に追随していること、地形より下にめり込む頂点が無いこと、を pin できるテスト。既存のテスト機構を使え）。
6. 真正性確認（必須）: コースの標高追随を 1 箇所わざと壊すとテストが落ちることを手元で 1 回試せ（確認したら戻す）。落ちないなら真正でない、書き直し。

## 検証

- `npm test`（vitest）、`npm run test:e2e`（Playwright）、`python -m pytest` を全て走らせ全 green。
- `desk_capture` で実画面を観て、コースが地形に埋まっていないことを批評（どの区間も沈んでいない、と具体的に）。
- 真正性確認の結果を報告。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。コース側のコードを直せ。
- **画面確認は `desk_capture` のみ。`chrome --headless` 直叩きも `headless-shot.ps1` も使うな** ── viewer は never-idle なページ（無限 rAF + Service Worker）で headless Chrome が終わらず worker ごと固まる（前の worker がこれで全滅した）。`desk_capture`（既存の Chrome ウィンドウを撮るだけで Chrome を spawn しない）だけを使え。viewer を映した通常 Chrome ウィンドウが無ければ、自分で 1 回だけ通常タブで `http://127.0.0.1:8000/?test=1&consent=dev` を開いてから `desk_capture` しろ。
- **作業ツリーには別 worker の未 commit 変更がある（`web/viewer-maplibre.js`, `web/tests/intro_consent_guard.test.js`, `e2e/user_journey.spec.js`）。それらには絶対に触るな。** commit は自分が触ったファイルだけを明示パスで `git add <path>` しろ。`git add -A` / `git commit -am` は禁止（他 worker の未 commit 変更を巻き込む）。万一コース描画コードが `viewer-maplibre.js` 内にあると判明したら、そこで止めて報告しろ（その場合は干渉するので差配側の判断が要る）。
- `bridge.py` は `127.0.0.1` bind 固定。地図タイル配布元配慮ルールを破るな。
- ローカル commit まで。`git push` 禁止。

## 完了報告

MapLibre 版が埋まらなかった理由、3D コースを地形表面に沿わせるために直したファイルと方式、全区間で埋まりが無いことの実画面確認、追加/強化したテスト、真正性確認の結果、`npm test` / `npm run test:e2e` / `python -m pytest` の passed / failed 数。
