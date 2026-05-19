# r-05 test baseline (= Minitest + capybara + 質的 gate)

depends-on: r-00, r-04

## はじめに

旧 fujihc-trainer は **frontend test runner 自体不在** (= NG-R1-8 CRITICAL) で、 tile 計算 / terrarium 変換 / prefetch 順序 / FPS のいずれも検証手段ゼロのまま 2200 行の viewer-maplibre.js が育った。 Rails 移植では Tier 0 で test framework を確定し、 後段 brief (= r-10 / r-11 / r-20 / r-22 ...) が test 規律を**未決事項に依存せず**書き始められる baseline を立てる。

更に、 user 過去訂正「**無駄な test を大量に作ってそうだな**」 (= NG-R5-6) に基づき、 量的 gate (= coverage 80%) ではなく **質的 gate** を採用 ── 触った全 class / module に対し happy / error / 1 edge case の最小 3 種、 misleading test は禁止、 tautological test の量産も禁止。

## 何

### test framework 選定

- **unit / model / controller / channel / service / domain**: **Minitest** (= Rails 8 default、 `bin/rails new` 直後に動く、 RSpec は採用しない)
- **system test**: **capybara + selenium-webdriver** (= Rails 8 default、 headless Chrome)
- **node 側 (= r-10 GLB build script の pure function)**: **node:test** (= Node 20+ 標準、 `node --test script/test/*.test.mjs`、 vitest / jest は採用しない)

### 採用根拠

- Minitest: Rails 8 default で `bundle install` のみで動く、 外部 gem 追加なし、 test 文法が assertion ベースで AI が tautological test を書きにくい (= RSpec の matcher 拡張は誘惑が大きい)
- node:test: r-10 script の terrarium decode / projection / classifyGrade の pure function test を依存 0 で書ける (= vitest 依存追加は build script 側にも node_modules 肥大を持ち込む)

### 質的 gate

各 brief で「触った class / module」 に対し下記 3 種を必須 (= happy + error + 1 edge case):

1. **happy path**: 正常入力 → 期待 output (= 1 件以上)
2. **error path**: 不正入力 / 例外発生条件 → 期待された raise / nil / error mark (= 1 件以上)
3. **edge case**: 境界値 / 0 件 / 空配列 / 最大値 / type 境界 (= 触った function ごとに 1 件以上)

**追加禁止**:

- tautological test (= `assert_equal foo, foo`、 `assert_equal 1, 1`)
- misleading test (= 「`assert_selector "canvas"`」 だけで「3D 表示できた」 と主張するような assertion、 NG-R5-14)
- coverage を上げるための副作用なし method test (= `def foo; end` を `assert_nothing_raised` で囲うだけ)

**追加推奨**:

- `RideFinalizer` のような service は **1 ride 分の AR fixture を作って call → 状態確認** (= happy)、 **trkpts が空のとき** (= edge)、 **DB 制約違反** (= error) を minimum
- domain PORO (= Terrain / Rider) は **1 known input → known output** (= happy)、 **lat/lon 範囲外** (= error)、 **境界 lat** (= edge)

### system test の規律 (= NG-R5-14 fix)

`/v2` viewer の system test (= r-11 で書く) は **canvas タグ存在の 1 行 assertion で済ませない**。 GLB load 成否を **DOM data-state attribute** で expose し、 system test で verify:

```ruby
# test/system/viewer_test.rb
class ViewerTest < ApplicationSystemTestCase
  test "v2 path renders viewer canvas and loads GLB" do
    visit "/v2"
    # GLB load 成功で Stimulus controller が data-state="loaded" を立てる
    # selenium で最大 10s 待機
    assert_selector "canvas[data-state='loaded']", wait: 10
  end

  test "v2 path shows error state if GLB missing" do
    # public/models/fuji_course.glb を一時 rename
    # GLB load 失敗で data-state="error" を立てる
    assert_selector "canvas[data-state='error']", wait: 10
  end
end
```

(= 1 件で「3D 描画 OK」 と主張する misleading は禁止、 load 成功 / load 失敗 / canvas mount の 3 件で「3D pipeline 動いてる」 をやっと assert)

### node 側 pure function test (= NG-R5-15 fix と関連)

r-10 build script の pure function を test 可能形で書く規律:

```
rails-app/script/build_terrain_glb.mjs    # 入口、 thin
rails-app/script/lib/terrarium.mjs        # terrarium decode (= R,G,B → meter)
rails-app/script/lib/projection.mjs       # lat/lon → x/z (= bbox 中心からの相対 m)
rails-app/script/lib/classify_grade.mjs   # slope_pct → color (= 既存 route_styling.js から)
rails-app/script/lib/heightmap.mjs        # tile grid 統合
rails-app/script/test/terrarium.test.mjs  # node:test
rails-app/script/test/projection.test.mjs
rails-app/script/test/classify_grade.test.mjs
rails-app/script/test/heightmap.test.mjs
```

各 test file は happy / error / edge の 3 種、 1 file 5-10 test 程度 (= 30 test 量産禁止)。

### Stimulus controller の pure module 切り出し (= r-11 で encode、 本 brief は規律のみ)

`viewer_3d_controller.js` の `connect()` に 11 責務同居 (= NG-R5-10) を防ぐため:

- `app/javascript/lib/scene_setup.js` — WebGLRenderer + Scene + Camera 構築
- `app/javascript/lib/lighting.js` — HemisphereLight + DirectionalLight 配置
- `app/javascript/lib/rider_placement.js` — rider_marker mesh を Three.js scene に add (= rename: 旧 `Rider cube` → `rider_marker`)
- `app/javascript/lib/camera_positioner.js` — Rider 位置に応じた camera 配置

各 pure module は node:test で test 可能な形 (= DOM / Three.js global に依存せず、 引数で渡す)。

### capybara 設定

`test/application_system_test_case.rb`:

```ruby
require "test_helper"
require "capybara/rails"

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :selenium, using: :headless_chrome, screen_size: [1400, 1400]
end
```

screen size: 1400x1400 (= viewer の aspect / Three.js camera 確認に十分、 retina factor 不要、 既存 rails-app/test/application_system_test_case.rb と一致)。

## 完了条件

- 本 brief が landing
- `bin/rails test` が空の状態で緑 (= test ゼロでも exit 0)
- `bin/rails test:system` が空の状態で緑
- `node --test script/test/` が `script/test/` ディレクトリ存在で緑 (= test ゼロでも exit 0)
- 後段 brief で test 追加する時、 本 baseline (= happy / error / edge の 3 種、 misleading 禁止) を audit で照合
- coverage 量的 gate は採用せず (= `simplecov` 等の coverage 計測も Tier 0 で導入しない、 r-94 で再検討)

## 参照

- Rails 8 Guides — Testing Rails Applications: https://guides.rubyonrails.org/testing.html
- Rails 8 Guides — System Testing: https://guides.rubyonrails.org/testing.html#system-testing
- Minitest: https://github.com/minitest/minitest
- Capybara: https://github.com/teamcapybara/capybara
- Node.js Test Runner: https://nodejs.org/api/test.html
- selenium-webdriver: https://www.selenium.dev/documentation/webdriver/
- user 過去訂正「無駄な test を大量に作ってそうだな」 (= 2026-05-15)、 「全関数のユニットテスト」 (= 2026-04-25、 ただし量ではなく質、 NG-R1-8 fix の文脈)

## まとめ

Minitest + capybara + node:test の 3 framework を Tier 0 で確定、 量的 coverage gate (= 80%) は採用せず、 質的 gate (= happy / error / edge + misleading 禁止) を全 brief 共通の規律にする。 system test は canvas 1 行で済まさず、 GLB load 成否を `data-state` で expose して verify。 後段 r-10 / r-11 / r-20 / r-22 等が本 baseline を前提に test を書ける。
