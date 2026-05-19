# commit ε-9 引き継ぎ brief (2026-05-15 12:08)

## 状況

fujihc-trainer の brief 34 ε-9 (= 地形 load ステータス + 全アクションボタン disabled) を実装中だが、 直前の executor が遅い。 動きはあるが output 沈黙が 15 分以上、 引き継いで完成させてほしい。

## repo / git 状態

- repo: `~/fujihc-trainer`
- HEAD: `e9fe508 feat: brief 34 commit ε-8 — 観るモード (= 区間選択型コース分析)`
- working tree: 7 file 変更中、 前 executor が編集途中 (= 中身は read で確認、 使えるなら活かす、 ダメなら捨てて書き直してよい)

## やる事 (= 仕様)

`~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md` (= v3 設計図) の **「commit ε-9: 地形データ準備ステータス + 全アクションボタン disabled」** 節を仕様の正本として読め。 要点:

1. 起動時の地形データ load (= pmtiles + course.json + GSI dem 数件) 進捗をステータスバーで表示
2. load 完了まで `terrainReady = false`、 完了で `true`
3. `terrainReady === false` 時は intro overlay の 3 ボタン (= 走る / 観る / 閉じる)、 setup-overlay の 4 ボタン (= btnTrainerScan / btnHrmScan / btnSkip / btnRideStart) すべて disabled
4. 既存 4 ステップインジケータ (= 機器検出 / BLE / ハンドシェイク / 走行準備) の頭に「地形データ準備」を追加して 5 ステップ化
5. 既存不変条件 (= pair-disabled / introConsented / Strava 文言 hardcode / 観るモード) は touch しない、 維持

過去訂正の同型に注意: 「ハンドシェイクが繋がる前でも走り出せる仕様は間違い」 = 「地形 load 前にボタン押せるのも間違い」、 同じ harm 形。

## test 要件

- `web/tests/terrain_loader.test.js` unit
- `web/tests/integration_terrain_ready_gate.test.js` integration:
  - `terrainReady=false` で intro / setup の全アクションボタン disabled
  - `terrainReady=true` で disabled 解除
  - ステータスバー文言遷移
- 既存 `integration_dispatch_guard.test.js` / `integration_ride_consent_pair.test.js` に「terrainReady false 中は dispatch しない」追加

## 動作原則

- Rule 1: 各 commit で `npm test -- --run` + `python -m pytest -q` 全 pass、 失敗時は自分で fix まで、 user 投げ禁止
- Rule 3: push 禁止、 commit のみ
- 外部 fetch 禁止: 既存 viewer 経路 (= pmtiles + GSI dem の static 経路) を再利用、 新規 endpoint 追加なし、 国土地理院 / OSM への追加アクセスゼロ
- 既存資産優先: ensureMapBooted / bootEnv / map.on('idle') 等の hook を流用、 新規は terrain_loader.js + step-0 UI のみ

## 完了通知

ε-9 landing + 全緑後:
- commit hash + subject
- 最終 npm / pytest 件数
- terrainReady 完了判定 trigger (= どの fetch を待つことにしたか、 1 行)
- 新規 file 数 / test 数
- 簡易動作確認 (= local server 起動 + browser で「load 中はボタン disabled、 load 完了で enable」目視 or curl 経由) の結果

## 参照すべき file

- `~/.agents/scratch/fujihc-trainer-project/phase-design-2026-05-15.md` (= v3 設計図、 ε-9 節は「実装計画」内)
- `~/fujihc-trainer/web/viewer-maplibre.js` (= 起動分岐周辺、 bootEnv / ensureMapBooted / dispatchAfterIntro)
- `~/fujihc-trainer/web/index.html` (= setup-overlay / intro overlay / step-indicator)
- `~/fujihc-trainer/web/lib/consent.js` / `web/lib/ride_state.js` (= ε-1〜ε-8 で landed 済の lib)
- `~/fujihc-trainer/web/tests/integration_*.test.js` (= 既存 integration test の pattern)

## 既存 executor の working tree 中身を引き継ぐ場合

`git status` で変更 file 一覧、 各 file を Read して妥当性確認、 流用できるなら活かす、 ダメなら `git checkout -- <file>` で破棄して書き直す。 working tree がそのまま使い物にならなければ、 `git stash` してから書き直しの方が確実。

進めて、 完成したら main に簡潔報告。
