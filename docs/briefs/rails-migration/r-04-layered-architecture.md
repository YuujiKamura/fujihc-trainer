# r-04 layered architecture (= 5 層配置規範)

depends-on: r-00, r-03

## はじめに

Rails 標準は MVC + concerns + service + channel の 5 層構造を持つが、 そのどこに何を置くかは規律しないとすぐ崩れる (= ActiveRecord に business logic が肥大、 concerns に PORO が紛れ込む、 service が単なる関数置き場化、 等)。 本 brief は Tier 0 で **5 層の配置規範** を Rails 8 + Hotwire で確定し、 r-03 の 5 aggregate (= Terrain / Rider / Course / Ride / Account) が各 layer のどこに座るかを物理化する。 r-10 の terrain ロジック重複実装 (= NG-R5-15) や `app/models/concerns/terrain.rb` 誤配置 (= 旧 brief 草稿) を未然に断つ。

## 何

5 層の責務と配置 path を確定:

1. `app/models/` — Active Record class (= DB schema を反映する class、 永続化責務)
2. `app/models/concerns/` — Active Record mixin (= 複数 AR が共有する behavior、 PORO はここに置かない)
3. `app/domain/` — PORO (= aggregate root の immutable / runtime instance、 AR 非依存の business model)
4. `app/services/` — 動詞的 use-case (= 複数 model に跨る orchestration、 idempotent な procedure)
5. `app/channels/` — ActionCable channel (= viewer ↔ server の WSS 境界)

## なぜ

1. **PORO と concern の混線阻止**: `app/models/concerns/terrain.rb` 等の誤配置は、 「concern = AR mixin」 という Rails 規約と衝突する。 PORO は `app/domain/` に置くことで AR / DB と切り離し、 単独で test 可能にする
2. **business logic の AR 肥大化阻止**: `Ride` AR が GPX export / Strava upload / 集計 / 通知を全部抱えるのが Rails の典型悪臭。 動詞的 use-case は `app/services/` に切り出す
3. **JS / Ruby 重複実装の阻止**: terrain 計算 (= terrarium decode / lat/lon projection / classifyGrade) を Ruby と JS の両方で書くと SoT 違反、 Ruby 側 `app/domain/terrain.rb` を **SoT** に置き、 JS 側は build time に Ruby が dump した JSON を読むだけ (= r-10 で encode)
4. **channel と service の境界**: ActionCable channel は薄く (= subscribe / receive / broadcast のみ)、 business logic は service / domain に投げる

## 仕様

### layer responsibility 表

| layer | path | 入れるもの | 入れないもの | 主な example |
|---|---|---|---|---|
| AR | `app/models/*.rb` | DB schema を反映する class、 validation、 association | 複雑な計算、 外部 API call、 GPX 生成 | `Account`, `Ride`, `Trkpt`, `Course`, `Section` |
| AR mixin | `app/models/concerns/*.rb` | 複数 AR で共有される behavior (= `Searchable`, `Trackable` 等) | PORO、 service 的なもの、 純関数 | (= 当面なし、 必要になったら追加) |
| domain | `app/domain/*.rb` | PORO aggregate (= runtime / immutable instance、 AR 非依存) | DB 永続化、 ActiveRecord 継承 | `Terrain`, `Rider` |
| service | `app/services/*.rb` | 動詞的 use-case (= `RideFinalizer`, `GpxExporter`, `StravaUploader`)、 idempotent な procedure | state 保持、 AR 依存の薄い wrapper | `GpxExporter`, `StravaUploader`, `RideFinalizer`, `IndexeddbImporter` (r-23) |
| channel | `app/channels/*.rb` | subscribe / receive / broadcast の薄い境界 | business logic、 DB 直接更新 | `RideChannel`, `RiderStateChannel` |

### `app/domain/` ディレクトリの autoload

Rails 8 (= Zeitwerk) は `app/*/` を自動 autoload する。 `app/domain/terrain.rb` を作ると `Terrain` 定数が autoload される。 設定不要、 ただし最初に 1 file 作る時に zeitwerk eager_load 確認 (= `bin/rails zeitwerk:check`)。

### Terrain SoT の置き場 (= NG-R5-15 fix)

```
app/domain/terrain.rb           # PORO、 lat/lon → elevation/slope/heading を計算
                                # build 時に self.build_from_gsi_tiles(cache_dir:) で JSON dump
                                # runtime に self.load_from_json(path:) で読む

config/terrain.json             # build 時に dump、 git commit (= GLB と一緒に固定 asset)
                                # 中身: heightmap grid + bbox + projection meta

rails-app/script/build_terrain_glb.mjs  # node、 config/terrain.json を読み GLB に焼く thin layer
                                        # terrarium decode / projection / classifyGrade は **行わない**
                                        # Three.js PlaneGeometry に setZ するだけ
```

(= Ruby 側が「計算」、 JS 側が「Three.js mesh 化」 に責務分離、 SoT は Ruby)

### service の書き方

```ruby
# app/services/ride_finalizer.rb
class RideFinalizer
  def initialize(ride:)
    @ride = ride
  end

  def call
    @ride.update!(
      finished_at: Time.current,
      avg_speed_mps: avg_speed,
      max_power_w: max_power,
      ...
    )
    @ride  # returns the finalized AR
  end

  private

  def avg_speed = @ride.trkpts.average(:speed_mps)
  def max_power = @ride.trkpts.maximum(:power_w)
end
```

(= POSO、 state 持たない、 `call` 1 個、 AR を返す。 controller / channel から `RideFinalizer.new(ride:).call`)

### channel の書き方

```ruby
# app/channels/rider_state_channel.rb
class RiderStateChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_account
  end

  def receive(data)
    # BLE sensor 値受信、 domain に投げる
    RiderStateUpdater.new(rider: current_rider, payload: data).call
    # broadcast は updater 側でやる
  end
end
```

(= channel は WSS 境界の薄い口、 business logic は service / domain に流す)

### filter_parameters baseline (= r-00 § Strava token 取扱 と合わせて encode)

`config/application.rb`:

```ruby
config.filter_parameters += [
  :password, :secret, :token, :access_token, :refresh_token,
  :code, :state,
  :hr, :power, :lat, :lon, :elevation
]
```

(= log に sensor 値 / GPS 座標が流れない物理 gate、 Rule 11 C2 の運用境界)

### dependency 方向

```
controller / channel ──→ service ──→ domain ──→ (Terrain JSON file)
                              │
                              └──→ AR ──→ DB

view (ERB / Stimulus) ──→ controller (data) | channel (realtime)
```

- 上から下への一方向、 逆参照禁止 (= AR が service を呼ぶ、 domain が channel を呼ぶは禁止)
- service が AR と domain を両方触ってよい (= 唯一の orchestration 層)

## 完了条件

- 本 brief が landing
- 後段 r-10 (GLB build) が「Ruby SoT + JS thin layer」 で encode
- 後段 r-20 (Terrain / Rider PORO) が `app/domain/` に配置、 `app/models/concerns/` には置かない
- 後段 r-22 (Ride AR) の `Ride#finalize!` が肥大化しそうな時は `RideFinalizer` service に切り出す規律を audit で verify
- `bin/rails zeitwerk:check` 通過 (= `app/domain/` が autoload される確認)

## 参照

- Rails 8 Guides — Autoloading and Reloading Constants (Zeitwerk): https://guides.rubyonrails.org/autoloading_and_reloading_constants.html
- Rails 8 Guides — Action Cable Overview: https://guides.rubyonrails.org/action_cable_overview.html
- Rails 8 Guides — Configuring Rails Applications (filter_parameters): https://guides.rubyonrails.org/configuring.html#config-filter-parameters
- Rails 8 Guides — Active Record Encryption: https://guides.rubyonrails.org/active_record_encryption.html
- 7 Patterns to Refactor Fat ActiveRecord Models (Code Climate): https://codeclimate.com/blog/7-ways-to-decompose-fat-activerecord-models

## まとめ

5 層 (= AR / AR mixin / domain / service / channel) と各 path / 責務 / dependency 方向を Tier 0 で確定。 Terrain SoT は Ruby `app/domain/terrain.rb`、 node script は thin layer。 r-03 で aggregate を決め、 本 brief でその座席を決める。 後段全 brief がこの規範に従う。
