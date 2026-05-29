# r-00 全体方針

depends-on: (なし — Tier 0 起点)

## はじめに

fujihc-trainer (= JS + Python の旧構成、 brief 00-33 で結実) を Rails 8 + Hotwire + Three.js + ActionCable + SQLite に全面書き直す。 旧側は `web/` `src/fujihill/` `scripts/` `tests/` として残置、 機能を移し終えるたびに **`web/archived/v1/` に move する commit を打つ段階移行**。

本 brief は Tier 0 (= 土台) の起点。 ここで認可境界、 viewer ↔ server data flow、 Strava token 取扱、 移植順、 旧側残置方針を確定し、 後段 brief (= r-04 配置規範、 r-05 test baseline、 r-03 aggregate map、 r-10 GLB、 r-11 viewer view 等) が依存する前提を全て fix する。

## 何 (= 移植のスコープ)

| 旧 | 新 |
|---|---|
| `web/viewer-map3d.js` (= ~2200 行) | `app/views/viewer/show.html.erb` + 複数 Stimulus controller (= `viewer_3d_controller.js` + 純 module 群) + Three.js GLTFLoader |
| `web/lib/terrain.js` | `app/domain/terrain.rb` (= PORO、 r-04 layered architecture 参照、 ActiveRecord 不要) |
| `web/lib/rider.js` | `app/domain/rider.rb` (= PORO、 Terrain を query して「今ここ」 を取る) |
| `src/fujihill/bridge.py` (= Python WebSocket BLE bridge) | **Flow A**: ブラウザ完結 BLE (= `trainer_ble_controller.js` + `hrm_ble_controller.js`) + ActionCable で server に state push |
| `src/fujihill/gpx_export.py` | `app/services/gpx_export.rb` |
| `src/fujihill/tile_server.py` + DB tile cache | Rails の static file 配信 (= `public/tiles/`) + 必要なら controller |
| IndexedDB rides | SQLite `Ride` モデル (= r-22)、 既存 data は r-23 で backfill |
| localStorage settings | `Account#settings` (= multi-user 化した時) または signed cookie (= single-user) |
| Strava OAuth (= 自前実装) | omniauth-strava (= r-30)、 `encrypts :strava_access_token` 必須 |
| 旧 viewer の起動毎 dynamic 構築 | build 時に 1 個の GLB に焼いて `public/models/` 配信 (= r-10) |

## なぜ

1. **AI 出力品質**: 学習データの平均は言語に縛られる、 JS / Python は「クソコード母数」 が大きい、 Ruby (= Rails 中心) は規律された OSS が支配的で AI が綺麗に書く (user 主張、 反論不可)
2. **設計力の補強**: 旧 viewer は Terrain / Rider 概念不在で「ride_state に curIdx / curDist しかない」 設計、 brief 34 ε-9 系列で fix を重ねたが根本は Rails ✕ aggregate root ✕ 配置規範で再設計するのが筋 (= r-03 / r-04 参照)
3. **配信完成度**: 起動毎 DEM fetch + 構築は計算機資源浪費、 build 時 1 GLB 配信なら 1 download + GPU upload で済む (user 訂正「最初から完成したものを置いたほうが早い」 反映)
4. **Hotwire の親和性**: viewer の状態切替 (= `state-checking` / `state-dbinit` / `state-pairing` / `state-riding` の 4 state、 旧 brief 26b 継承) は Turbo Frame で server 側 view 切替が自然、 body class 切替の物量を消せる

## 仕様

### 認可境界 (= NG-R5-7 fix)

**single-user 想定**を default 採用。 根拠: 旧 fujihc-trainer の使用形態が「user 自身の PC で 1 人で走る」 一択であり、 multi-user 化要件が現時点で存在しない。 ただし設計上は Account 概念を導入 (= r-03 aggregate map に Account 明示)、 後段で multi-user 拡張時に Account を実体化する余地を残す。

物理境界:

- Rails server bind は `127.0.0.1` 明示 (= `bin/rails s -b 127.0.0.1`、 `0.0.0.0` 禁止) — 旧 bridge.py の `"localhost"` 文字列曖昧化 (NG-R3-4) を再演しない
- `/` および `/v2` ともに anonymous access 可、 認証なし
- multi-user 拡張時は Devise / Rodauth を r-30 と同じ Tier に置き、 r-00 の本セクションを update する (= 後付け retrofit を避けるため Tier 0 で意思決定済にしておく)

### viewer ↔ server data flow (= Flow A 採用、 NG-R5-2 / NG-DB-4 fix)

**Flow A**: trainer / HRM ↔ Web Bluetooth ↔ ブラウザ (BLE 接続 + GATT parse) ↔ ActionCable WSS ↔ Rails server (= Rider PORO 更新 + Ride 永続化) ↔ ActionCable broadcast ↔ ブラウザ viewer (= Three.js 描画)。

- BLE 接続 + GATT parse は `trainer_ble_controller.js` + `hrm_ble_controller.js` に閉じる
- 描画 controller `viewer_3d_controller.js` には BLE を持ち込まない (= 責務分離)
- server 側は Rider PORO の `update(speed_mps:, hr:, power:, cad:)` を ActionCable receive 時に呼び、 broadcast で viewer 全 client に push
- WSS bind: `wss://127.0.0.1:3000/cable` (= localhost 専用、 LAN 露出禁止)

Flow A を選んだ根拠: bridge.py を ActionCable に置換することで Python 依存を全廃でき、 Tier 7 (= 配信) でも Ruby のみで完結 (= `Procfile` に Python 不要)。 r-21 の文言を本方針と整合させる。

### 並走 URL 戦略 (= NG-R5-4 fix)

`root "viewer#show"` の Tier 1 切替は **しない**。 代わりに:

- Tier 0-6 の間: `/` は既存 Rails welcome page (= `bin/rails new` 直後の default)、 旧 viewer は `web/index.html` を引き続き `file:///` で開ける、 Rails viewer は **`/v2`** に mount (= 並走)
- Tier 7 の r-80-root-cutover で `/` を `/v2` の content に切替、 同時に `web/index.html` を `web/archived/v1/index.html` に move
- 旧 viewer は move 後も `file:///path/to/repo/web/archived/v1/index.html` で開ける (= retire ではなく archive)

「revert 容易」 の concrete (= NG-R5-12 fix): r-80 の commit `<sha>` を `git revert <sha>` すると `routes.rb` の `root` が welcome に戻り、 `web/index.html` の move も巻き戻る。 旧 viewer は `git revert` 前も後も `file:///.../web/archived/v1/index.html` (= move 後) か `file:///.../web/index.html` (= move 前) のどちらかで必ず開ける。 つまり「戻せる」 の保証は r-80 commit 単位、 Tier 1-6 の各 commit は `/` に触れないので revert もそもそも不要。

### Strava access token 取扱 (= NG-R5-16 fix、 CLAUDE.md Rule 11 C2 直結)

- `Account#strava_access_token` は `encrypts :strava_access_token` (= Rails encrypts、 Active Record Encryption) で DB 暗号化保存。 平文 column は禁止
- `config/application.rb` の `Rails.application.config.filter_parameters` baseline (= r-04 で encode):
  ```ruby
  config.filter_parameters += [
    :password, :secret, :token, :access_token, :refresh_token,
    :code, :state,
    :hr, :power, :lat, :lon, :elevation
  ]
  ```
  (= sensor 値 / GPS 座標は Rule 11 上は C2 だが log には流さない)
- Rule 11 C2 の運用境界引用 (= 本 brief で明示):
  > 自分の Strava activity (OAuth で取得した自分のデータ) は Strava API Agreement §5.1 + §2.10 によりローカル DB 保存 + Developer App での「to that user」 UI 表示は許可。 第三者への disclose / redistribute / sublicense は §2.9 / §2.14 / §2.15 で禁止。 → 本 Rails app の運用 (= 本人 UI に表示、 外部 push なし、 git に commit しない) は C2 の正当範囲内。
- Strava 関連のあらゆる data (= ride / activity / token) を git に commit しない物理 gate を `.gitignore` + pre-commit hook で確保 (= r-30 で encode)、 2026-05-06 事故 (= Google Places / Strava push) の再演を物理層で阻止

### 移植順 (= 実装順)

INDEX.md §移植順 の 32 行表が SoT。 本 brief では概念のみ:

1. **Tier 0 (土台)**: r-00 / r-01 / r-04 / r-05 / r-02 / r-03 ── Rails baseline + 配置規範 + test framework + asset pipeline + aggregate map
2. **Tier 1 (model)**: r-20 (Terrain / Rider PORO) / r-21 (ActionCable) / r-22 (Ride AR) / r-23 (IndexedDB backfill)
3. **Tier 2 (3D)**: r-10 (GLB build) / r-11 (`/v2` viewer) / r-12 (Stimulus 分割) / r-90 (観るモード)
4. **Tier 3 (BLE)**: r-40 / r-41 / r-42
5. **Tier 4 (UI)**: r-50-53 / r-91
6. **Tier 5 (lifecycle)**: r-60 / r-61 / r-33 / r-62 / r-93
7. **Tier 6 (Strava)**: r-30 / r-31 / r-32
8. **Tier 7 (配信 / 切替)**: r-72 / r-80 / r-70 / r-71 / r-92 / r-94

### 旧側の扱い

- `web/` `src/fujihill/` `scripts/` `tests/` は Tier 6 完了まで残置 (= 動作確認の比較対象 + 移植漏れ検知 + IndexedDB backfill の source server)
- r-23 (= IndexedDB backfill) で旧 web/ を別 server (= `python -m http.server 8001` 等) で起動し、 旧 viewer の `/export` UI で IndexedDB 全 ride を JSON dump、 Rails 側 `/import` で SQLite に書込む
- Tier 7 の r-80-root-cutover で `/` を `/v2` に切替 + `web/index.html` → `web/archived/v1/index.html` move
- r-72 CSP baseline 拡張時に `web/` を server 配信から外す
- `src/fujihill/bridge.py` 削除は Tier 6 完了後 (= ActionCable + BLE が end-to-end 動いてから)
- 各 commit は「旧側残置、 新側追加」 の段階で進める (= revert 容易、 §並走 URL 戦略 で concrete)

### 各 brief の責務粒度

1 brief = 1 commit (or 同主題の 2-3 commit) に納める。 brief 1 個で「viewer 全体」 みたいな大粒度は禁止、 「viewer の HUD だけ」 「minimap だけ」 で分ける。 brief 内に新規 file path / class 名 / method 名 / depends-on を必ず書く (= scope 明確化、 audit 時の照合用)。

## 完了条件

- 全 brief の commit が landing 済 (= r-00 〜 r-94)
- `rails-app/` 配下に Rails 8 アプリ完成 (= `bundle install` / `bin/rails db:setup` / `bin/rails test` / `bin/rails test:system` 全緑)
- 旧 `web/index.html` viewer は `web/archived/v1/index.html` に retire 済 (= ただし `file:///` で開けば動く形で保存)
- Rails viewer (= `/`、 r-80 で `/v2` から昇格済) で 富士山 3D + コース + `rider_marker` (= Rider PORO の現在位置を視覚化する viewer mesh、 r-11 § 語彙 で定義) が表示
- trainer に Web Bluetooth で繋ぎ ride 開始 → 終了 → GPX DL → Strava upload まで end-to-end 通る
- test 完了条件 = **r-05 の質的 gate を全 brief で満たす** (= 触った全 class / module に対し happy / error / 1 edge case を unit、 system test は misleading でない最小、 80% カバー量的 gate は採用しない)

## 参照

公式 doc (= NG-R5-11 fix、 後段 impl で AI が old API を再生産しないための load-bearing):

- Rails 8 Guides: https://guides.rubyonrails.org/
- Active Record Encryption: https://guides.rubyonrails.org/active_record_encryption.html
- importmap-rails: https://github.com/rails/importmap-rails
- Hotwire Turbo: https://turbo.hotwired.dev/
- Stimulus: https://stimulus.hotwired.dev/
- Three.js: https://threejs.org/docs/
- Strava API Agreement: https://www.strava.com/legal/api
- 国土地理院タイル利用規約: https://maps.gsi.go.jp/development/ichiran.html

ローカル:

- 旧 brief 群: `~/.agents/scratch/fujihc-trainer-project/briefs/00-context.md` 以下
- 既存 vault: `~/user-context-vault/`
- 動作原則: `~/CLAUDE.md` (= Rule 1-13、 特に Rule 1 test 先 verify / Rule 3 per-action 認可 / Rule 11 C2 Strava 自データ運用)
- drift catalog: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md`

## まとめ

35+ 件の brief で旧 fujihc-trainer を Rails 8 に移植、 7軸 audit を経て LOAD-BEARING NG ゼロ + COSMETIC ≤ 2 まで redraft、 階段状に 1 commit ずつ landing。 認可境界 (= single-user / 127.0.0.1)、 Flow A、 並走 URL (= `/v2` → r-80 で `/` 切替)、 Strava token 暗号化、 質的 test gate を本 brief で Tier 0 確定。 完了で「動く Rails アプリ + 旧 JS / Python 全廃」 を達成。
