# Rails Migration Briefs — INDEX

## はじめに

fujihc-trainer (= JS + Python の旧構成) から Rails 8 + Hotwire + Three.js + ActionCable への移植 brief 群。 prefix `r-` で旧 brief 群 (= 00-33) と区別。

**Tier 番号 は機能分類 label であり、 実装順とは別**。 Tier 番号順に impl してはならず、 §移植順 の表に従う。 各 brief は **bookend 構造** (はじめに / 何 / なぜ / 仕様 / 完了条件 / 参照 / まとめ) + 冒頭の `depends-on:` slot で書く。

## 動機 (= なぜ Rails 化か)

user 判断 (2026-05-15):

1. JS / Python は学習データに「クソコード」 が大量混入、 AI 出力品質が低い (= 規律の薄い書き方を再生産)
2. Ruby (= Rails 中心、 Rubocop 規律、 community 平均品質高) なら AI が自然に綺麗に書く、 手戻り少ない
3. ブラウザ縛りは「描画層」 だけ、 model 層 (= Terrain / Rider / Course / Ride / Account の aggregate 階層) は Ruby 側で書ける
4. 観るモード起動の度に DEM + polygon を組み立てる現状は無駄、 build 時に完成 GLB を 1 個焼いて配信、 viewer は load するだけにする

## 範囲

旧 JS / Python 全廃 → Rails 8 + Hotwire + Three.js + ActionCable + SQLite。 配信は localhost (= default、 single-user 想定) または GitHub Pages 静的 export の選択肢を r-70 で検討。 旧 fujihc-trainer 配下に `rails-app/` サブディレクトリで併存、 機能完成毎に旧側を archive する commit を打つ段階的移行。

## viewer ↔ server data flow

**Flow A 採用**: trainer / HRM ↔ Web Bluetooth ↔ ブラウザ (BLE 接続 + sensor parse) ↔ ActionCable WSS ↔ Rails server (Rider PORO + Ride 永続化) ↔ ActionCable broadcast ↔ ブラウザ viewer (Three.js 描画)。 BLE 接続 + GATT parse は専用 Stimulus controller (= `trainer_ble_controller.js`, `hrm_ble_controller.js`) に分離、 描画 controller (= `viewer_3d_controller.js`) には BLE を持ち込まない (= NG-R5-2 mitigation)。

## viewer state 体系 (= 旧 brief 26b 継承)

旧 web/ で確立した 4 state を Rails 側でも継承:

- `state-checking` (起動直後の DB 存在チェック)
- `state-dbinit` (DB 構築中、 `dbinit-overlay` が前面)
- `state-pairing` (trainer / HRM ペアリング待ち)
- `state-riding` (走行中)

Hotwire Turbo Frame で server 側 view 切替に置換、 body class 切替の物量を消す (= r-60-ride-flow.md 参照)。

## brief 一覧 (= Tier = 機能分類 label、 ✱ は新規)

### Tier 0 — 土台 (= Rails baseline)

- [r-00-context.md](r-00-context.md) — 全体方針 / 移植順 / 旧側の扱い / 認可境界 / Strava token 方針 / 完了条件
- [r-01-repo-layout.md](r-01-repo-layout.md) — `rails-app/` サブディレクトリ構成、 旧 `web/` `src/` の archive 戦略
- [r-02-asset-pipeline.md](r-02-asset-pipeline.md) — importmap-rails + Three.js vendor 取得、 jsbundling 不採用の根拠
- ✱ [r-03-aggregate-map.md](r-03-aggregate-map.md) — Terrain / Rider / Course / Ride / Account の aggregate 階層 + mutability + lifecycle + ownership
- ✱ [r-04-layered-architecture.md](r-04-layered-architecture.md) — models (AR) / models/concerns (mixin) / domain (PORO) / services / channels の 5 層配置規範
- ✱ [r-05-test-baseline.md](r-05-test-baseline.md) — Minitest + capybara + 質的 gate (= happy / error / 1 edge case unit、 misleading test 禁止)

### Tier 1 — 走行状態モデル (= 描画層より先に置く土台)

- [r-20-rider-terrain-models.md](r-20-rider-terrain-models.md) — Terrain (= immutable PORO) + Rider (= mutable PORO) の Ruby 実装、 ActiveRecord 不採用の根拠
- [r-21-action-cable-state-push.md](r-21-action-cable-state-push.md) — trainer/HRM → server → viewer の Flow A state push、 channel 設計
- [r-22-ride-session-db.md](r-22-ride-session-db.md) — `Ride` モデル + `Trkpt` 関連 + IndexedDB の **新規書込み停止**
- ✱ [r-23-indexeddb-backfill.md](r-23-indexeddb-backfill.md) — 旧 web/ を別 server で起動 → `/export` → Rails 側 `/import` で IndexedDB 本番 ride データを SQLite に backfill

### Tier 2 — 3D 表示

- [r-10-glb-build.md](r-10-glb-build.md) — Ruby PORO `Terrain` が JSON dump、 node script が `script/build_terrain_glb.mjs` で GLB に焼く (= SoT は Ruby、 node は thin layer)
- [r-11-viewer-view.md](r-11-viewer-view.md) — `/v2` で並走起動、 GLTFLoader + `rider_marker` mesh (= Rider PORO の位置を視覚化、 r-11 § 語彙 参照) の最小 viewer、 旧 `/` は当面残置
- [r-12-stimulus-split.md](r-12-stimulus-split.md) — viewer_3d / hud / minimap / controls の Stimulus controller 分割
- [r-90-view-mode.md](r-90-view-mode.md) — 観るモード (= trainer 無しで Rider PORO を時間進行) Rails 版。 Rider model 単独動作確認の forcing function として Tier 2 末尾に置く

### Tier 3 — センサー接続

- [r-40-web-bluetooth-bridge.md](r-40-web-bluetooth-bridge.md) — `trainer_ble_controller.js` + `hrm_ble_controller.js` で BLE 接続、 受信値を ActionCable で server に送る
- [r-41-pairing-ui.md](r-41-pairing-ui.md) — Hotwire frame で trainer / HRM ペアリング画面、 `state-pairing` の Rails 版
- [r-42-trainer-auto-reconnect.md](r-42-trainer-auto-reconnect.md) — `navigator.bluetooth.getDevices()` 経由の起動時自動再接続

### Tier 4 — UI (= HUD / minimap / 区間 / controls)

- [r-50-hud.md](r-50-hud.md) — 速度 / 距離 / 標高 / slope / power / cad / hr の Stimulus controller、 ActionCable push を DOM update
- [r-51-minimap.md](r-51-minimap.md) — Three.js 別 viewport 案 vs canvas 残置案、 OSM タイル配信は Rails 側 controller か `public/tiles/` 配置
- [r-52-section-panel.md](r-52-section-panel.md) — 右上の区間 list panel、 click で rider 位置移動
- [r-53-controls.md](r-53-controls.md) — pause / 速度倍率 / 光源方向 / 光源強度 slider 群、 値は `Account#settings` に保存
- [r-91-mouse-pitch-bearing.md](r-91-mouse-pitch-bearing.md) — 旧 setupPitchDrag / userBearingOffset の Stimulus 化

### Tier 5 — ride lifecycle

- [r-60-ride-flow.md](r-60-ride-flow.md) — `state-checking` → `state-dbinit` → `state-pairing` → `state-riding` → `state-postride` の Hotwire frame 切替、 旧 `body.state-*` 撤廃
- [r-61-history-views.md](r-61-history-views.md) — `Rides#index` + `Rides#show`、 過去 ride の表示 / GPX DL / Strava upload 再試行
- [r-62-clear-all-data.md](r-62-clear-all-data.md) — `Account#destroy` で ride 全消し、 confirm dialog、 Strava app revoke 案内
- [r-93-gpx-import.md](r-93-gpx-import.md) — 既存 GPX upload で履歴に追加 (= Strava からの逆輸入)
- [r-33-course-sections.md](r-33-course-sections.md) — `Course has_many Sections`、 区間平均/最大勾配の計算 service

### Tier 6 — Strava 連携

- [r-30-strava-oauth.md](r-30-strava-oauth.md) — omniauth-strava + Account モデル + `encrypts :strava_access_token` + filter_parameters
- [r-31-gpx-export.md](r-31-gpx-export.md) — `Ride#to_gpx` で Strava 互換 GPX 1.1 出力、 既存 `gpx_export.py` の Ruby 移植
- [r-32-strava-upload.md](r-32-strava-upload.md) — ActiveJob + Solid Queue で background upload、 retry / status polling

### Tier 7 — 配信 / 切替 / DX

- [r-70-static-export.md](r-70-static-export.md) — GitHub Pages 静的 export の検討
- [r-71-production-deploy.md](r-71-production-deploy.md) — Render / Fly / Heroku の選定、 Strava OAuth redirect URI 設定
- [r-72-csp-security.md](r-72-csp-security.md) — CSP baseline 確定 (= r-11 の暫定 CSP を全 view に拡張)、 PII / token 取扱
- [r-80-root-cutover.md](r-80-root-cutover.md) — Tier 5-6 完了後に `/` を viewer に切替、 旧 `web/index.html` を `web/archived/v1/` に移動
- [r-92-dev-experience.md](r-92-dev-experience.md) — `bin/dev` で foreman、 Tailwind watch、 Rails server、 ホットリロード前提
- [r-94-tests.md](r-94-tests.md) — r-05 の baseline を踏まえた system test polish

## 移植順 (= 実装順、 Tier 番号と独立)

「Tier N が完了してから Tier N+1」 ではない。 下表が正、 Tier 番号は機能分類 label に過ぎない。

| 順 | brief | Tier label | 主要 deliverable | 戻し方 (= revert) |
|----|-------|----------|----------------|-----------------|
| 1 | r-00 | 0 | 全体方針 doc | brief commit revert |
| 2 | r-01 | 0 | `rails-app/` scaffolding | `git revert <sha>` で空 dir に戻る |
| 3 | r-04 | 0 | 配置規範 doc | brief commit revert |
| 4 | r-05 | 0 | Minitest baseline + capybara | `bin/rails test` が空緑 |
| 5 | r-02 | 0 | importmap + Three.js vendor 取得 | importmap.rb の pin 削除 |
| 6 | r-03 | 0 | aggregate map doc | doc revert |
| 7 | r-20 | 1 | Terrain / Rider PORO (= 描画層より先) | `app/domain/` 削除 |
| 8 | r-10 | 2 | Ruby Terrain → JSON dump → node script → GLB | GLB 削除、 PORO は残置 |
| 9 | r-11 | 2 | `/v2` viewer (= `/` は welcome のまま残置) | `routes.rb` から `/v2` 削除、 旧 `/` 無傷 |
| 10 | r-21 | 1 | ActionCable channel + Rider state push | channel 削除 |
| 11 | r-22 | 1 | `Ride` + `Trkpt` AR (= 新規 ride は SQLite に保存) | migration revert |
| 12 | r-23 | 1 | IndexedDB → SQLite backfill | import 済 data は Rails 側に残るが mark を立てて選別可 |
| 13 | r-90 | 2 | 観るモード (= Rider 時間進行 viewer) | `/v2/view` route 削除 |
| 14 | r-40 | 3 | `trainer_ble_controller.js` 等の BLE controller | controller 削除 |
| 15 | r-41 | 3 | pairing UI | view 削除 |
| 16 | r-42 | 3 | auto reconnect | feature flag off |
| 17 | r-50〜r-53 | 4 | HUD / minimap / 区間 / controls | view 削除 |
| 18 | r-91 | 4 | pitch / bearing controller | controller 削除 |
| 19 | r-60 | 5 | state machine + Hotwire frame 切替 | frame 削除 |
| 20 | r-61 | 5 | rides index / show | controller 削除 |
| 21 | r-33 | 5 | section model + service | migration revert |
| 22 | r-62 | 5 | clear all data | controller 削除 |
| 23 | r-93 | 5 | GPX import | controller 削除 |
| 24 | r-30 | 6 | Strava OAuth + token encrypts | omniauth 設定削除 |
| 25 | r-31 | 6 | GPX export | service 削除 |
| 26 | r-32 | 6 | Strava upload | ActiveJob 削除 |
| 27 | r-72 | 7 | CSP baseline 拡張 | initializer revert |
| 28 | r-80 | 7 | root cutover (= `/` を viewer に切替) | `git revert <sha>` で `/` が welcome に戻り、 旧 viewer は `web/archived/v1/index.html` を `file:///` で開ける |
| 29 | r-70 | 7 | 静的 export 検討 | (= 検討のみで code change なし) |
| 30 | r-71 | 7 | production deploy | deploy 切戻し |
| 31 | r-92 | 7 | bin/dev DX 整備 | Procfile 削除 |
| 32 | r-94 | 7 | system test polish | test 削除 |

(= 「動く Rider model」 → 「観るモードで Rider 単独動作確認」 → 「BLE 接続」 → 「UI」 → 「lifecycle」 → 「外部連携」 → 「配信 / 切替」 の順)

## まとめ

35+ 件の brief で Rails 移植を網羅。 完了条件は r-00 に集約。 7軸 audit で LOAD-BEARING ゼロ + COSMETIC ≤ 2 まで redraft、 各 brief 1 commit で landing、 push 禁止。
