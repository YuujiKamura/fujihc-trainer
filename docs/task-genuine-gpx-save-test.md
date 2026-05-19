# タスク: GPX 保存の真正なテスト

## 目的

ライドを GPX として保存する部分を**真正に**テストする ── 実際にライドを模擬して GPX を保存させ、出力 GPX の中身（特に trackpoint の座標）が正しいことを検証する。過去の「trkpt の緯度が全点同じに固定される」バグを、テストが捕まえられるようにする。

## リポジトリ

- `C:\Users\yuuji\fujihc-trainer`、ブランチ `b11-phase5-tile-cache`。直接作業してよい。
- ローカル commit まで。`git push` は禁止。

## なぜ・現状のギャップ（調査済み）

過去のバグ: 保存された GPX の trackpoint の緯度（lat）が全点で同じ値に固定され、ライダーがコース上を進んでも座標が動かなかった。証拠が `scripts/fix_gpx_lat.mjs`（既に吐かれた壊れた GPX を、コースから距離で lat/lon/ele を補間し直して救済するスクリプト、untracked）。

今の GPX テスト `web/tests/gpx_builder.test.js` は `buildGpxXml` の**単体テスト**で、手で作った trkpt 配列を渡して XML 整形を検証している。整形器のテストとしては良いが、**「保存パイプライン」を通していない** ── ライドが trkpt を記録する段（rider がコース上を進む → trkpt に座標が積まれる）を飛ばしている。緯度固定バグはまさにその記録段にあったので、`gpx_builder.test.js` では原理的に捕まらない。

ギャップ: **記録 → GPX 構築 → 保存** の通しが真正にテストされていない。

## やること

まず既存の関連テストとコードを読め ── `web/tests/integration_gpx_download.test.js`, `viewer_trkpt_wiring.test.js`, `trkpt_lat_after_rider_tick.test.js`, `ride_state_trkpts.test.js`, `gpx_builder.test.js`、`web/lib/gpx_builder.js`、Python 側 `tests/test_gpx_export.py` と `src/fujihill/gpx_export.py`。何が既にテストされ、緯度固定バグを捕まえる経路があるか/無いかを把握しろ。

その上で、GPX 保存の真正なテストを書く（または既存を強化する）。要件:

1. **ライドを模擬する** ── rider がコース上を実際に複数 tick 進む。手で trkpt を作って渡すのではなく、ライドの記録経路を通す。
2. その記録から GPX を保存（構築）させる。
3. 出力 GPX の trackpoint を検証する: **lat / lon / ele が点ごとに正しく変化している**こと（全点同じでない、コースの形に沿っている）、点数が妥当、time / power / cad / hr 等のフィールドが妥当。
4. **真正性の確認（必須）**: 記録段で lat を固定する細工を一時的に入れたら、このテストが落ちることを手元で 1 回試せ（確認したら戻す）。落ちないなら真正でない ── 書き直し。

「既にある物を直す/強める」が優先。真正なテストが既存ファイルの強化で済むならそれでよい。新規ファイルは必要なときだけ。

## 検証

- `npm test`（vitest）と `python -m pytest` を両方走らせ全 green。
- 上記「やること 4」のわざと壊す確認を必ず実施し、結果を報告しろ。

## 制約

- `web/lib/terrain3d.js` は配布元配慮で無改造。
- リポ CLAUDE.md の配布元配慮ルールを破るな。
- ローカル commit まで。`git push` 禁止。

## 完了報告

何を読んで何が穴だったか、追加/強化したファイル、わざと緯度を固定したらテストが落ちた確認の結果、`npm test` と `python -m pytest` の passed / failed 数。
