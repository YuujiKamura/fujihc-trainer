# Rails Migration Briefs — Round 1 audit 後の REDRAFT TASK

## 状況

Rails 8 移植用 brief 4 件 (= INDEX.md, r-00-context.md, r-10-glb-build.md, r-11-viewer-view.md) を 7軸 audit にかけ、 28 マス中 26 LOAD-BEARING NG で **全面 REDRAFT 判定**。 本 task はその redraft。

drift catalog (`~/.agents/state/fujihc-trainer/audit-drift-catalog.md`) Round 5 を **必読**、 NG-R5-1〜16 の新規 pattern + 過去 Round 1-4 の継続 pattern を全て解消する形で redraft する。

## redraft 対象

すべて `C:\Users\yuuji\.agents\scratch\fujihc-trainer-project\briefs\rails-migration\` 配下:

- `INDEX.md` (= 全 35 brief 一覧 + Tier + 移植順)
- `r-00-context.md` (= 全体方針)
- `r-10-glb-build.md` (= GLB build script)
- `r-11-viewer-view.md` (= Rails viewer view)

加えて新規 brief を最低 2 件追加:

- `r-03-aggregate-map.md` (= Terrain / Rider / Course / Ride / Account の aggregate 階層 + mutability + ownership)
- `r-04-layered-architecture.md` (= Rails の models / models/concerns / domain or PORO / services / channels 配置規範)

## 必須 fix (= drift catalog NG-R5-* の解消)

### 構造 (NG-R5-1, NG-R5-4, NG-R5-12)
- Tier 番号と移植順の関係を明示 (= 「Tier 番号 = 機能分類 label、 実装順は別 list、 両方を表で対応付ける」)
- 各 brief 冒頭に「depends-on: r-XX, r-YY」 を bookend slot として追加
- `root "viewer#show"` の Tier 1 切替は **`/v2` 等の並走 URL 戦略** に変更、 旧 viewer は `/` で残置、 Tier 6 完了で root 入れ替え
- 「revert 容易」 主張に concrete な戻し方を 1 段書く (= `git revert &lt;sha&gt;` で `/` が welcome に戻る、 旧 viewer は `file:///.../web/index.html` で引き続き開ける、 等)

### aggregate / model 階層 (NG-R5-2)
- 新規 `r-03-aggregate-map.md` で Terrain ⊃ Rider の階層 + 各 aggregate の mutability / lifecycle / ownership を 1 表で明示
- Rider は course を所有せず Terrain への query で「今ここ (= lat/lon/elevation/heading/slope)」 を取る
- INDEX / r-00 で Terrain と Course / Ride の関係を明示 (= Terrain は immutable 客観、 Course は AR meta、 Ride は走行 snapshot)

### 配置規範 (NG-R5-2, NG-R5-15)
- 新規 `r-04-layered-architecture.md` で 5 層を明示: models (AR) / models/concerns (mixin) / domain or PORO / services / channels
- `app/models/concerns/terrain.rb` は誤り → `app/models/terrain.rb` (= PORO クラス) または `app/domain/terrain.rb`
- r-10 の build script で terrain 計算ロジックを Ruby と JS で重複実装しない設計 (= Ruby PORO の Terrain が JSON dump、 node script は dump 読んで GLB に焼くだけの thin layer)

### 移植順 (NG-R5-2)
- r-20 (= Terrain/Rider PORO) を Tier 0 (= 土台) に昇格、 r-10 / r-11 より前に landing
- r-90 (= 観るモード) を Tier 2 末尾 or Tier 3 に昇格 (= Rider model 単独動作確認の forcing function)

### backfill (NG-R5-3)
- 新規 brief または INDEX に「旧 IndexedDB の本番 ride データを Rails DB に backfill する経路」 を明示 (= 旧 web/ を別 server で起動 → /export → Rails 側 /import の経路)
- 「IndexedDB 撤廃」 1 語で済まさず、 user の手元 data を消失させない手順を明文化

### test 規律 (NG-R5-6, NG-R5-10, NG-R5-13, NG-R5-14)
- coverage 80% という量的 gate を **削除**、 質的 gate に変更 (= 「触った全 class / module に対し happy / error / 1 edge case を unit test、 misleading test の禁止」)
- test framework 選定 (= RSpec or Minitest、 capybara 設定) を **Tier 0 に昇格** (= 新規 r-05-test-baseline.md or r-04 内 inline、 Tier 1 で system test 書く時に未決にしない)
- r-11 の system test を **canvas DOM 存在 assert 1 件のみ から強化**: GLB load 成功で `data-state="loaded"` を立てる、 system test で `assert_selector "canvas[data-state='loaded']"` を verify
- r-11 の Stimulus controller `connect()` の 11 責務を **pure module に分解** (= scene_setup.js / lighting.js / rider_placement.js / camera_positioner.js)、 各 module を unit test 可能に
- r-10 の build script の pure function (= terrarium decode / projection / classifyGrade / heightmap grid) を unit test 化 (= script/test/*.test.mjs)

### 認可境界 (NG-R5-7)
- r-00 で single-user / multi-user 方針を Tier 0 で確定
- single-user なら localhost only (= 127.0.0.1 bind) を物理化、 multi-user なら Account モデル + Devise/Rodauth 等の選定を Tier 0 brief 化
- `/` のアクセス境界を明示 (= anonymous でいいか認証必須か)

### Strava / token (NG-R5-16)
- r-30 (= Strava OAuth) を Tier 0 か r-00 本文に inline 化、 access token は `encrypts :strava_access_token` で暗号化保存
- `filter_parameters` baseline を r-00 か r-04 で確定 (= `:password, :secret, :token, :access_token, :refresh_token, :code, :state, :hr, :power, :lat, :lon` 等)
- Rule 11 C2 (= 自分の Strava データはローカル保存 + 本人 UI 表示 OK、 redistribution 禁止) を r-00 で明示引用

### CSP / vendor (NG-R5-8, NG-R5-9)
- r-11 完了条件に「`bin/importmap pin three --download` 実走済、 `vendor/javascript/*.js` 存在、 `config/importmap.rb` に CDN URL ゼロ確認 grep」 を物理 gate
- CSP baseline (= `script-src 'self'; img-src 'self' data:; connect-src 'self' ws://localhost:* wss://localhost:*; default-src 'none'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'`) を r-11 か r-72 で Tier 0 確定
- r-10 で GSI DEM 取得経路を build script から削除 (= 「既に手元にある cache を入力」 と限定、 再取得が必要な時は別 brief 経由)、 GLB に `asset.copyright = "Terrain: 国土地理院 DEM | Course: 富士スバルライン"` 等の attribution metadata

### 参照 URL (NG-R5-11)
- 全 brief の `## 参照` section に **外部公式 doc の実 URL** を最低 3 件:
  - Rails 8 official guides URL
  - Three.js / GLTFLoader / GLTFExporter docs URL
  - importmap-rails README URL
  - GSI 利用規約 URL (= r-10 の場合)
  - Strava API Agreement URL (= r-30 関連 brief の場合)
- ローカル path 列挙のみ / `"docs"` の文字列のみは NG

### 語彙 (NG-R5-2)
- 旧 brief 26b で確立した `dbinit-overlay` / `state-checking` / `state-dbinit` の 4 state 体系を INDEX で継承
- r-11 の `Rider cube` (= BoxGeometry placeholder) は `rider_marker` に rename、 「Rider PORO の現在位置を視覚化する mesh」 と明示、 Rider PORO と概念混線させない

### viewer ↔ server data flow (NG-R5-2, NG-DB-4)
- r-00 で Flow A (= ブラウザ完結 + ActionCable で server に push) を採用と明言、 r-21 の文言も整合させる
- viewer 側で BLE 接続 + sensor data parse は **専用 Stimulus controller** (= `trainer-ble`, `hrm-ble`) に分離、 `viewer-3d` controller には BLE を持ち込まない

## redraft 後の確認

redraft 後、 再度 7軸 audit を起動 (= multi-axis-draft-audit skill か Agent tool 並列) して **LOAD-BEARING 0 + COSMETIC ≤ 2 = CONVERGED** まで loop。 ただし polish loop で token 浪費しないように、 LOAD-BEARING ゼロ確認できたら CONVERGED 判定して止める。

## 完了通知

- redraft 後の各 brief path + 主要変更点 1 行ずつ
- 再 audit 結果 (= 7×4+ verdict 表、 CONVERGED か redraft 続行か)
- 新規 brief (= r-03 / r-04 / r-05) の path + 中身要約
- drift catalog Round 6 への追記内容 (= 今回 fix で RESOLVED した patterns、 残存 NG)

## 動作原則

- Rule 1 (= 各 phase で test verify) は brief redraft phase なので vitest / pytest 直接実走は不要、 ただし redraft の中身は test 規律を必ず含む
- Rule 3 (= push 禁止)、 commit は brief draft の scratch dir のみ (= git tracked じゃないが backup として OK)
- Rule 6 (= 認可済 scope 内 re-ask 禁止) で redraft 全 brief は authorized scope、 個別の polish 判断は自分で
- 過去訂正「無駄な test を大量に作る」 = brief 内 test 記述は質ベース、 「触った関数全部 test」 ではなく「misleading でない最小 + edge case」
- 過去訂正「お前の agent の建て方は見えねえ」 = Ghostty window で動くからこの prompt 自体が user に見える、 透明性 OK
