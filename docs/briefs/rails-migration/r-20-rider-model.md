# r-20 Rider model (= Rider PORO + BikePhysics + Ride AR の責務分離)

depends-on: r-00, r-03, r-04, r-05

## はじめに

旧 fujihc-trainer の JS 版は `ride_state.js` が `curIdx / curDist / trkpts` を全部抱える 1 file design で、 brief 35 で **Terrain (= 客観地形) ⊃ Rider (= 走行中の主体)** に分離した後も shim (= `ride_state.js`) が後方互換のため legacy 経路を残していた。 2026-05-15、 viewer が `rider.tick` 直接呼びに rewire されたが shim の `_legacyAppendTrkpt` は依然 `_idx` を見ていたため、 viewer rewire 後の ride では `_idx=0` のまま全 trkpt が `course[0]` の lat/lon で push され、 **Strava upload で 0km 認識される実害** が出た (= commit de57ce1 で fix)。 これは「同じ情報を 2 箇所が独立に持って drift する」 という典型失敗 mode で、 Rails 移植では同じ轍を踏まないように **位置の SoT を Rider 1 つに固定** する設計を起こす。

本 brief は Tier 1 (= 走行状態モデル) の起点。 r-03 で確定した aggregate 階層 (= Terrain ⊃ Rider、 Account ⊃ Ride) を Ruby で物理化し、 r-04 で確定した 5 層配置規範 (= PORO は `app/domain/`、 AR は `app/models/`、 動詞は `app/services/`) に沿って Rider / BikePhysics / Terrain / Ride / Trkpt を配置する。 r-05 の質的 gate (= happy / error / edge + misleading 禁止) に従って test を組む。

物理計算 (= Zwift 方式、 trainer 由来の speed を捨てて power + 勾配 + 体重で v を時間積分する model) は 2026-05-15 に JS 版 `web/lib/bike_physics.js` で確立、 11 件 test green。 これを Ruby に 1:1 翻訳して `BikePhysics` service として置き、 Rider が ride 中の 1 step ごとに呼ぶ形にする。 trainer からは power のみ受け取り、 speed は server 側計算値が SoT になる (= Flow A、 r-00 § viewer ↔ server data flow 参照)。

r-21 (= ActionCable channel) が Rider snapshot を viewer に push する前段として、 Rider が時間進行で正しく動くこと、 Ride AR への snapshot 保存が完走時に行われること、 Trkpt の lat/lon が Rider の現在位置に追従することを本 brief で確定する。

## 何 — Rider PORO の責務 (= ride 中の状態)

`app/domain/rider.rb` (= PORO、 AR 非継承)。 1 ride 中だけ生存する mutable 主体で、 永続化は持たない (= ride 終了時に Ride AR に snapshot を切り出す)。

保有する state は「自分の主観値」のみ:

- `distance_traveled` (= m、 ride 開始時 0、 tick で増加)
- `speed_mps` (= m/s、 BikePhysics で算出される値、 直接 setter なし)
- `power_w` (= W、 trainer からの入力、 setter `update_sensors`)
- `cadence_rpm` (= rpm、 trainer から)
- `hr_bpm` (= bpm、 HRM から)
- `paused` (= bool、 ride 中の一時停止)
- `active` (= bool、 ride 開始から終了まで true)
- `at_goal` (= bool、 distance_traveled >= terrain.total_distance で true)
- `terrain` (= Terrain への参照、 lat/lon/elevation/slope の query 用、 read only)

直接持たない値 (= Terrain query で都度取る):

- `lat` / `lon` / `elevation_m` / `slope_pct` / `heading_deg`

これは「位置の SoT は Rider の distance_traveled 1 つ」 を物理化するため。 Trkpt 書き込みも viewer 描画も同じ `rider.position` query を経由する (= 中間 cache を持たない)。

主な動詞:

- `tick(dt:, terrain:)` — 1 step 進める。 BikePhysics で new speed を算出 → distance_traveled += speed * dt → at_goal 判定
- `update_sensors(power:, cadence:, hr:)` — trainer / HRM 受信値の部分更新 (= nil は不変、 0 は反映)
- `start` / `pause` / `resume` / `end` — lifecycle 状態遷移
- `position` — terrain.position_at(distance_traveled) の薄い proxy、 lat/lon/elevation/slope/heading を返す
- `snapshot` — viewer broadcast 用の immutable Hash (= position + 主観値の全部)

## なぜ — 設計の load-bearing 根拠

1. **位置の SoT を Rider 1 つに固定 (= 0km lat 固定事故の物理 mitigation)**: JS 版の shim `_legacyAppendTrkpt` は `_idx` ベースで lat/lon を取っていたが、 viewer が `rider.tick` 直接呼びに rewire された後 `_idx` が更新されない死に code になり、 全 trkpt が `course[0]` 固定で push された。 Ruby 側では Trkpt 書き込みも viewer broadcast も「`rider.position`」 1 経路に集約し、 `rider.distance_traveled` が増えれば lat/lon が必ず追従する形にする。 二重 SoT は最初から作らない。

2. **物理計算は service 切り出し (= r-04 配置規範に整合)**: Zwift 方式の物理 model (= power + 勾配 + 体重で v を積分) は Rider が抱えると Rider が肥大化する。 `app/services/bike_physics.rb` に純関数として切り出し、 Rider は `BikePhysics.apply_step(v:, dt:, power_w:, slope_pct:, opts:)` を呼ぶだけ。 これで 11 件の物理 test を service 単独で書け、 Rider test は「service が呼ばれる」 「結果が distance に反映される」 だけに絞れる。

3. **trainer 由来の speed を捨てる**: 旧経路は trainer が報告する speed をそのまま使ったが、 trainer の内部物理は平地 + power のみ前提が多く、 下り勾配や慣性が入らない。 結果「足止め = 即減速」 の不自然挙動。 Rails 側では trainer から power のみ受け取り、 server で BikePhysics.apply_step を毎 tick 呼んで自前計算する。 speed の SoT は Rider.speed_mps 一本。

4. **Rider は PORO、 永続化は Ride AR**: Rider を ActiveRecord にすると 60Hz の tick で DB 更新が走り SQLite が詰まる + 中断時の partial state を rollback で消す手段がない。 Rider は in-memory PORO (= Solid Cache / Solid Cable に乗る、 r-04 と r-03 で合意済)、 Ride AR は「完走時 snapshot + trkpt 列の永続化」 という append-only な責務に絞る。 Rider が `Ride#tick` のような method を持たない、 Ride が `update_position!` のような method を持たない (= 責務逆転禁止)。

5. **完走時 snapshot ではなく逐次 Trkpt 永続化**: Rails 側の trkpt 書き込みは「Rider 1 step ごとに 1 件」 ではなく「1Hz cadence で Rider.position を読んで 1 件」 にする (= 旧 JS 版同様)。 60Hz の DB 書き込みは無理、 1Hz なら 100 km ride で ~7200 行で済む。 cadence 制御は呼出側 (= ActionCable channel または ride loop service) の責務、 Rider は「呼ばれたら現位置を返す」 だけ。

## 仕様 — class 配置と method 一覧

### `app/domain/rider.rb` (= PORO)

```ruby
class Rider
  attr_reader :distance_traveled, :speed_mps, :power_w, :cadence_rpm, :hr_bpm,
              :paused, :active, :terrain

  def initialize(terrain:)
    raise ArgumentError, "terrain required" if terrain.nil?
    @terrain = terrain
    @distance_traveled = 0.0
    @speed_mps = 0.0
    @power_w = 0
    @cadence_rpm = 0
    @hr_bpm = 0
    @paused = true
    @active = false
  end

  def start
    @distance_traveled = 0.0
    @speed_mps = 0.0
    @paused = false
    @active = true
  end

  def pause = (@paused = true)
  def resume = (@paused = false)
  def end!; @paused = true; @active = false; end

  def update_sensors(power: nil, cadence: nil, hr: nil)
    @power_w = power.to_i if power
    @cadence_rpm = cadence.to_i if cadence
    @hr_bpm = hr.to_i if hr
  end

  def tick(dt:, physics_opts: {})
    return if @paused || !@active
    return unless dt.is_a?(Numeric) && dt > 0
    return if at_goal?

    pos = position
    @speed_mps = BikePhysics.apply_step(
      v: @speed_mps,
      dt: dt,
      power_w: @power_w,
      slope_pct: pos[:slope_pct],
      opts: physics_opts
    )
    @distance_traveled += @speed_mps * dt
    @distance_traveled = @terrain.total_distance if at_goal?
  end

  def at_goal?
    @terrain.total_distance.positive? &&
      @distance_traveled >= @terrain.total_distance
  end

  def position
    @terrain.position_at(@distance_traveled)
  end

  def snapshot
    pos = position
    {
      distance_m: @distance_traveled,
      speed_mps: @speed_mps,
      power_w: @power_w,
      cadence_rpm: @cadence_rpm,
      hr_bpm: @hr_bpm,
      paused: @paused,
      active: @active,
      at_goal: at_goal?,
      lat: pos[:lat],
      lon: pos[:lon],
      elevation_m: pos[:elevation_m],
      slope_pct: pos[:slope_pct],
      heading_deg: pos[:heading_deg],
    }
  end
end
```

### `app/services/bike_physics.rb` (= 純関数 service、 state なし)

JS 版 `web/lib/bike_physics.js` の 1:1 Ruby 翻訳。 default 係数は `DEFAULTS` 定数で凍結 (= JS 版と同値、 user 体感調整余地は `opts:` 上書きで残す)。

```ruby
class BikePhysics
  DEFAULTS = {
    mass: 88.0,    # kg (= rider 80 + bike 8)
    c_rr: 0.005,   # rolling resistance coefficient
    rho: 1.225,    # kg/m^3 (= 海面付近空気密度)
    c_d: 0.88,     # drag coefficient, rider posture 込
    area: 0.4,     # m^2 (= 前面投影)
    g: 9.80665,
    v_min: 0.5,    # m/s (= 推進力発散防止)
    max_v: 30.0    # 安全 cap (= 108 km/h、 下りで突き抜ける防止)
  }.freeze

  # m * dv/dt = (power / max(v, v_min)) - m*g*sin(slope) - C_rr*m*g*cos(slope) - 0.5*rho*C_d*A*v^2
  def self.apply_step(v:, dt:, power_w:, slope_pct:, opts: {})
    o = DEFAULTS.merge(opts)
    return v unless dt.is_a?(Numeric) && dt > 0

    slope_val = slope_pct.is_a?(Numeric) && slope_pct.finite? ? slope_pct : 0.0
    slope_rad = Math.atan(slope_val / 100.0)
    v_eff = [v, o[:v_min]].max
    propulsion = (power_w.to_f) / v_eff
    gravity = o[:mass] * o[:g] * Math.sin(slope_rad)
    rolling = o[:c_rr] * o[:mass] * o[:g] * Math.cos(slope_rad)
    drag = 0.5 * o[:rho] * o[:c_d] * o[:area] * v_eff * v_eff
    net_force = propulsion - gravity - rolling - drag
    accel = net_force / o[:mass]
    new_v = v + accel * dt
    new_v = 0.0 if new_v < 0
    new_v = o[:max_v] if new_v > o[:max_v]
    new_v
  end
end
```

(= `app/services/bike_physics.rb` は state を持たない、 class method 1 個のみ。 service と呼ぶには軽すぎるが、 Rider の test を physics と切り離せる利点が大きい。 r-04 §service の書き方 で許容する純関数 service の形)

### `app/domain/terrain.rb` (= PORO、 r-03 で確定済、 本 brief で API 仕様確定)

JS 版 `web/lib/terrain.js` の Ruby 翻訳。 immutable、 course (= GPX 由来の点列) を constructor で受け取り、 distance → position の query を返す。

```ruby
class Terrain
  attr_reader :total_distance

  def initialize(course:)
    raise ArgumentError, "course must be Array" unless course.is_a?(Array)
    @course = course.dup.freeze
    @total_distance = course.empty? ? 0.0 : (course.last[:distance_m] || 0.0).to_f
    @last_idx = [course.size - 1, 0].max
  end

  # distance (m) → {lat, lon, elevation_m, slope_pct, heading_deg, segment_idx, frac_in_segment}
  def position_at(distance_m, look_ahead: 5)
    return empty_position if @course.empty?
    d = clamp_distance(distance_m)
    idx = idx_at_distance(d)
    p = @course[idx]
    p_next = @course[[idx + 1, @last_idx].min]
    seg_len = (p_next[:distance_m] - p[:distance_m]).to_f
    frac = seg_len.positive? ? [[(d - p[:distance_m]) / seg_len, 1.0].min, 0.0].max : 0.0
    {
      lat: p[:lat] + (p_next[:lat] - p[:lat]) * frac,
      lon: p[:lon] + (p_next[:lon] - p[:lon]) * frac,
      elevation_m: p[:elevation_m] + (p_next[:elevation_m] - p[:elevation_m]) * frac,
      slope_pct: p[:slope_pct] || 0.0,
      heading_deg: compute_travel_heading(idx, look_ahead),
      segment_idx: idx,
      frac_in_segment: frac,
    }
  end

  # 他 method: idx_at_distance / distance_at_idx / point_at_idx / bounds / sections
  # (= 旧 terrain.js 同等、 r-33 で section 関連を追加実装)
end
```

(= `compute_travel_heading` は private、 旧 `lib/heading.js` を Ruby 移植。 r-33 で sections 移植時に extract method 検討)

### `app/models/ride.rb` (= AR、 永続化境界)

```ruby
class Ride < ApplicationRecord
  belongs_to :account
  belongs_to :course
  has_many :ride_trkpts, dependent: :destroy

  validates :started_at, presence: true

  # snapshot を Ride に焼き付ける (= ride 完走時 / 中断時に呼ぶ)
  # tick は持たない (= Rider PORO の責務、 Ride は永続化のみ)
  # 集計値計算は `RideFinalizer` service に切り出す (= r-04 配置規範)
end
```

migration スキーマ:

```ruby
create_table :rides do |t|
  t.references :account, null: false, foreign_key: true
  t.references :course, null: false, foreign_key: true
  t.datetime :started_at, null: false
  t.datetime :finished_at
  t.float :distance_m
  t.integer :duration_s
  t.float :avg_speed_mps
  t.integer :avg_power_w
  t.integer :max_power_w
  t.integer :avg_hr_bpm
  t.integer :max_hr_bpm
  t.timestamps
end
```

### `app/models/ride_trkpt.rb` (= AR、 1Hz 粒度の trkpt 履歴)

```ruby
class RideTrkpt < ApplicationRecord
  belongs_to :ride
  # lat/lon/elevation_m を float column で保存 (= filter_parameters で log から除外、 r-04 と整合)
end
```

migration:

```ruby
create_table :ride_trkpts do |t|
  t.references :ride, null: false, foreign_key: true
  t.datetime :t, null: false
  t.float :lat, null: false
  t.float :lon, null: false
  t.float :elevation_m
  t.integer :power_w
  t.integer :cadence_rpm
  t.integer :hr_bpm
  t.timestamps
end

add_index :ride_trkpts, [:ride_id, :t]
```

### `app/services/ride_finalizer.rb` (= 完走時 snapshot 集計、 r-04 §service の書き方 に従う)

```ruby
class RideFinalizer
  def initialize(ride:, rider:)
    @ride = ride
    @rider = rider
  end

  def call
    @ride.update!(
      finished_at: Time.current,
      distance_m: @rider.distance_traveled,
      duration_s: (Time.current - @ride.started_at).to_i,
      avg_speed_mps: @ride.ride_trkpts.average(:power_w) && safe_avg_speed,
      avg_power_w: @ride.ride_trkpts.average(:power_w).to_i,
      max_power_w: @ride.ride_trkpts.maximum(:power_w).to_i,
      avg_hr_bpm: @ride.ride_trkpts.average(:hr_bpm).to_i,
      max_hr_bpm: @ride.ride_trkpts.maximum(:hr_bpm).to_i,
    )
    @ride
  end

  private

  def safe_avg_speed
    return 0.0 if @ride.ride_trkpts.empty?
    @rider.distance_traveled / ((Time.current - @ride.started_at).nonzero? || 1)
  end
end
```

(= AR を touch する集計は Rider PORO ではなく service が触る、 Rider は in-memory state に閉じる)

## 保存バグの轍 (= 必須 section、 過去事故 commit de57ce1 由来)

JS 版で起きた 0km lat 固定事故 (= 2026-05-15、 commit de57ce1 で fix) を Ruby 側で再演しないための物理 mitigation を明示する。

### 何が起きたか

1. brief 19 で `viewer-maplibre.js` から `curIdx / curDist / paused / active` を吸い出して `createRideState({course})` に pure state machine 化 (= 旧 ride_state.js)
2. brief 33 で trkpts 機能も ride_state.js に移送
3. brief 35 で「Terrain ⊃ Rider」 上位モデル分離、 `ride_state.js` は **後方互換 shim** に格下げ (= 既存 caller / test を破壊しないため `createRideState` を Terrain + Rider 生成の wrapper として残置)
4. shim の `_legacyAppendTrkpt` は内部の `_idx` field を見て `course[_idx]` の raw lat/lon を使っていた
5. viewer が `rider.tick` 直接呼びに rewire された (= shim の `advance` を bypass)
6. `_idx` を更新するのは `shim.advance` 内の `_idxAdvance` のみ、 viewer rewire で `_idx` は 0 のまま動かない死に code 化
7. 結果: viewer rewire 後の ride では全 trkpt が `course[0]` の lat/lon (= 起点固定) で push、 Strava upload で「移動 0km」 認識される実害

根本原因: **同じ「現在位置」 情報を `_idx` (= shim 側) と `rider.distanceTraveled` (= Rider 側) の 2 箇所が独立に持って drift する 2 重 SoT**。 fix は `_legacyAppendTrkpt` が `rider.position` を SoT として読むように rewire (= commit de57ce1)。

### Ruby 側で防ぐ方法

1. **SoT を Rider.distance_traveled 1 つに固定**: Trkpt 書き込みでも viewer broadcast でも `rider.position` (= `terrain.position_at(rider.distance_traveled)` の薄い proxy) を経由する。 「現在位置」 を保持する場所を他に作らない (= 中間 cache 禁止、 shim 禁止)

2. **Ride AR への保存は完走時 snapshot + 1Hz trkpt append のみ**: 60Hz の tick で AR を update するパターンを作らない (= AR と PORO の役割逆転事故の温床)。 trkpt 書き込み cadence (= 1Hz) は呼出側 (= channel / ride loop service) が制御、 Rider は「呼ばれたら現位置を返す」 だけ

3. **trkpt 書き込みも Rider.position 直 source**: `RideTrkpt.create!(ride: ride, t: Time.current, **rider.position, power_w: rider.power_w, ...)` で書く。 ride_loop service 内で前回の position を変数に取って使う、 という cache パターンを禁止 (= 二重 SoT 再演)

4. **shim を移植しない**: `ride_state.js` の後方互換 shim は Ruby 側で持ち込まない (= JS 側との後方互換は不要、 Rails 移植は新規 layer)。 shim を作る誘惑が出たら「同じ責務を 2 箇所が独立に書くな」 と本 section を参照

5. **test で物理 gate**: 下記 reg test を Ruby 側でも書く:
   - 「Rider が 50 秒進んだ後、 RideTrkpt 列の lat unique 数 > 5」 (= 起点固定でないこと)
   - 「Rider.tick を 60Hz で呼びつつ 1Hz で trkpt 書き込み、 末尾 lat が起点と異なる + 進行方向に増える」
   - これは JS 版 `web/tests/trkpt_lat_after_rider_tick.test.js` の Ruby 翻訳に相当

### 設計原則

旧 JS shim 経路は「既存 caller / test 群を壊さないため」 の暫定 layer で、 本来は呼出側を全部 Rider 直接に書き直すべきだった。 Rails 移植は新規 layer なので暫定 layer を作る正当性がなく、 最初から Rider 直接呼びの 1 経路に統一する。 「後方互換 shim を作る」 という選択が出てきたら、 それは Rule 12 の「shortcut」 (= 整理ではなく層を増やす) に該当、 本 section を引いて却下する。

## テスト網羅 (= 全関数 mandate、 r-05 質的 gate に従う)

各 class / module に対し happy / error / 1 edge の最小 3 種、 misleading / tautological 禁止。

### `BikePhysics` 物理挙動 (= JS test と 1:1 対応、 11 件)

`test/services/bike_physics_test.rb`:

1. 平地 + power 一定: v が収束値に向かう (= 60 秒シミュ、 v が 7-12 m/s range、 happy)
2. 下り 5% + power=0: v が加速する (= 5 秒シミュ、 v > v0、 happy)
3. 下り 8% + power=0: 平地時より遥かに減速が小さい (= 3 秒シミュ、 v_down > v_flat + 維持以上、 edge: 下り bias)
4. 登り 8% + power=0: 急減速 (= 3 秒シミュ、 v < 3 m/s、 edge: 登り bias)
5. 登り 10% + power=400W: ほぼ維持 (= 20 秒シミュ、 v 2-7 m/s、 edge: 力釣合領域)
6. max_v cap: 下り急勾配の暴走を止める (= 10 分下り、 v <= DEFAULTS[:max_v]、 edge: 物理 cap)
7. v=0 + power=0 + 平地: 静止維持、 NaN や負値にならない (= edge: 0 境界)
8. v=0 + power=300W + 平地: 発進できる (= 5 秒シミュ、 v > 2、 edge: 発進)
9. dt <= 0: no-op、 v 不変 (= error: dt 不正)
10. opts override: mass=60 が mass=88 より登りで速い (= edge: 体重 dependency)
11. slope_pct = nil / NaN: 平地扱い、 NaN 漏れなし (= error: 入力不正)

### `Rider` tick 進行

`test/domain/rider_test.rb`:

- happy: terrain + start + tick(dt: 1.0) を 10 回 → distance_traveled > 0、 position.lat != initial、 active && !paused
- happy: update_sensors(power: 200) 後 tick → speed_mps が BikePhysics の結果と一致
- error: terrain=nil で initialize → ArgumentError
- error: tick(dt: 0) / tick(dt: -1) → no-op
- edge: paused 中 tick → distance_traveled 不変
- edge: at_goal 後 tick → distance_traveled 不変、 at_goal? true 維持
- edge: 空 course の terrain で tick → distance_traveled 不変、 NaN 漏れなし

### `Terrain` position query

`test/domain/terrain_test.rb`:

- happy: 既知 course で position_at(0) → 起点座標、 position_at(total_distance) → 終点座標
- happy: 中間 distance で線形補間 (= 2 点間の中点座標)
- error: course=nil で initialize → ArgumentError
- edge: 空 course → position_at(任意) で empty_position (= lat: 0 等)、 NaN 漏れなし
- edge: distance > total_distance → clamp で末尾座標
- edge: distance < 0 → clamp で起点座標

### `Ride` AR

`test/models/ride_test.rb`:

- happy: valid な ride を create、 belongs_to: account / course、 has_many: ride_trkpts
- happy: ride_trkpts << RideTrkpt.new(...) で n+1 ではない通常 association
- error: started_at 不在で create → invalid
- edge: dependent: :destroy で ride 削除時 ride_trkpts も削除

### `RideFinalizer` service

`test/services/ride_finalizer_test.rb`:

- happy: 1 ride + 10 trkpt 作って call → finished_at / distance_m / avg_power_w 等が反映
- edge: trkpt 0 件で call → avg / max が nil ではなく 0 (= 集計の null 安全性)
- error: ride 不在で initialize → ArgumentError 相当

### 完走 integration

`test/integration/ride_lifecycle_test.rb`:

- happy: rider.start → tick を 5 秒分 (= 60Hz、 計 300 tick) + 1Hz で RideTrkpt 書き込み (= 計 5 件) → rider.distance_traveled > 0 + RideTrkpt 5 件 + 各 trkpt の lat が前後で異なる
- happy: 完走 (= distance_traveled >= total_distance) → at_goal? true + RideFinalizer.call で Ride finished_at セット
- edge: 完走前に rider.end! → Ride finished_at セット、 ride_trkpts は途中まで保存済

### 0km lat reg test (= JS 版 `trkpt_lat_after_rider_tick.test.js` の Ruby 翻訳)

`test/integration/trkpt_lat_pin_test.rb`:

```ruby
test "Trkpt lat/lon が rider 進行に追従し、起点固定しない (= 0km bug 再演防止)" do
  course = make_test_course  # 100 点、 lat 0.0001 刻みで北上、 distance_m 1m 刻み
  terrain = Terrain.new(course: course)
  rider = Rider.new(terrain: terrain)
  rider.start
  rider.update_sensors(power: 200)
  ride = accounts(:one).rides.create!(course: courses(:one), started_at: Time.current)

  # 50 秒、 60Hz tick + 1Hz trkpt 書き込み
  last_trkpt_ms = 0
  3000.times do |i|
    rider.tick(dt: 1.0 / 60)
    now_ms = i * (1000.0 / 60)
    if now_ms - last_trkpt_ms >= 1000
      ride.ride_trkpts.create!(t: Time.current, **rider.position.slice(:lat, :lon, :elevation_m),
                                power_w: rider.power_w, cadence_rpm: rider.cadence_rpm, hr_bpm: rider.hr_bpm)
      last_trkpt_ms = now_ms
    end
  end

  trkpts = ride.ride_trkpts.order(:t)
  assert trkpts.size > 40, "trkpts は 40 件超で push されているべき"
  unique_lat = trkpts.pluck(:lat).uniq.size
  assert unique_lat > 5, "lat unique 数が 5 超 (= 起点固定でない)、 actual: #{unique_lat}"
  assert_not_equal trkpts.first.lat, trkpts.last.lat, "末尾 lat が起点と異なる"
  assert trkpts.last.lat > trkpts.first.lat, "末尾 lat が起点より北上 (= 進行方向)"
end
```

(= 起点固定の二重 SoT 事故が起きると `unique_lat == 1` で fail、 物理 gate になる)

## 移植マッピング表 (= JS file → Ruby file)

| JS source | Ruby target | 配置 layer (= r-04) | 翻訳方針 |
|---|---|---|---|
| `web/lib/bike_physics.js` | `app/services/bike_physics.rb` | service (= 純関数) | 数式 + DEFAULTS 1:1、 11 件 test も翻訳 |
| `web/lib/rider.js` | `app/domain/rider.rb` | domain (= PORO) | API 名は Ruby 慣習に直す (= camelCase → snake_case)、 setter は `update_sensors`、 lifecycle は `start/pause/resume/end!` |
| `web/lib/terrain.js` | `app/domain/terrain.rb` | domain (= PORO) | immutable、 `position_at(distance_m)` を中核 method、 r-33 で sections 追加 |
| `web/lib/ride_state.js` (shim) | **移植せず** | (= N/A) | 後方互換不要、 二重 SoT の温床、 本 brief で移植禁止を明示 |
| `web/lib/heading.js` | `app/domain/terrain.rb` private | domain (= 内包) | Terrain private method として吸収、 単独 PORO 化不要 |
| (= 新規) | `app/models/ride.rb` | AR | 永続化境界、 has_many ride_trkpts |
| (= 新規) | `app/models/ride_trkpt.rb` | AR | 1Hz trkpt、 ride に belongs_to |
| (= 新規) | `app/services/ride_finalizer.rb` | service (= 動詞) | 完走時 snapshot 集計、 Ride 肥大化阻止 (= r-04) |
| `web/tests/bike_physics.test.js` | `test/services/bike_physics_test.rb` | test | 11 件 1:1 翻訳、 Minitest assertion 形 |
| `web/tests/trkpt_lat_after_rider_tick.test.js` | `test/integration/trkpt_lat_pin_test.rb` | test | reg test、 二重 SoT 再演防止の物理 gate |

## 受け入れ条件

- `app/domain/rider.rb` / `app/domain/terrain.rb` / `app/services/bike_physics.rb` / `app/services/ride_finalizer.rb` / `app/models/ride.rb` / `app/models/ride_trkpt.rb` が landed
- migration (= `db/migrate/*_create_rides.rb` / `*_create_ride_trkpts.rb`) が landed + `bin/rails db:migrate` 通過
- `bundle exec bin/rails test` で本 brief で列挙した全 test が green
- 0km lat reg test (= `test/integration/trkpt_lat_pin_test.rb`) green
- 完走 integration test green
- `ride_state.js` shim 相当の Ruby class が存在しないこと (= grep で `app/domain/` 配下に `RideState` / `LegacyRide` 等の名前がない物理 verify)
- `bin/rails zeitwerk:check` 通過 (= r-04 § app/domain autoload と整合)
- 本 brief の §保存バグの轍 で示した二重 SoT 設計 (= 中間 cache / shim layer) が impl 上に存在しないこと、 audit で照合

## 依存と順序

- **depends-on**: r-04 (= 5 層配置規範) + r-05 (= test baseline) + r-03 (= aggregate 階層) を Tier 0 で済ませてから着手
- **blocks**: r-21 (= ActionCable で Rider.snapshot を viewer に push)、 r-22 (= Ride AR と IndexedDB 撤廃の最終確認)、 r-90 (= 観るモード = Rider 時間進行 viewer)
- **commit 粒度**: 1 brief = 3-4 commit に分割可 (= (1) Terrain PORO + test、 (2) BikePhysics service + test、 (3) Rider PORO + test + integration、 (4) Ride / RideTrkpt AR + migration + RideFinalizer service + reg test)
- **revert 経路**: 各 commit を個別 `git revert <sha>` で戻せる (= migration は `bin/rails db:rollback`)、 全 revert で `app/domain/` `app/services/` `app/models/ride*` が消える状態に戻る

## 参照

公式 doc:

- Rails 8 Guides — Active Record Basics: https://guides.rubyonrails.org/active_record_basics.html
- Rails 8 Guides — Active Record Migrations: https://guides.rubyonrails.org/active_record_migrations.html
- Rails 8 Guides — Active Record Validations: https://guides.rubyonrails.org/active_record_validations.html
- Rails 8 Guides — Testing Rails Applications: https://guides.rubyonrails.org/testing.html
- 7 Patterns to Refactor Fat ActiveRecord Models: https://codeclimate.com/blog/7-ways-to-decompose-fat-activerecord-models

ローカル:

- r-00 (= 全体方針): `r-00-context.md`
- r-03 (= aggregate map): `r-03-aggregate-map.md`
- r-04 (= 5 層配置規範): `r-04-layered-architecture.md`
- r-05 (= test baseline): `r-05-test-baseline.md`
- 旧 JS Rider PORO: `web/lib/rider.js`
- 旧 JS Terrain PORO: `web/lib/terrain.js`
- 旧 JS BikePhysics: `web/lib/bike_physics.js`
- 旧 JS 物理 test: `web/tests/bike_physics.test.js`
- 0km lat 事故 reg test: `web/tests/trkpt_lat_after_rider_tick.test.js`
- shim 教訓 (= 移植しない理由): `web/lib/ride_state.js`
- drift catalog: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md`
- 動作原則: `~/CLAUDE.md` Rule 1 (= test 先 verify) / Rule 12 (= shortcut 禁止)

## まとめ

Rider PORO (= ride 中の主観 state、 永続化なし) + BikePhysics service (= Zwift 方式の純関数物理) + Terrain PORO (= immutable 客観地形) + Ride / RideTrkpt AR (= 永続化境界) + RideFinalizer service (= 完走時 snapshot 集計) の 6 file 構成で、 JS 版 4 file (= rider.js / terrain.js / bike_physics.js / ride_state.js) のうち shim を移植せず本流 3 file を 1:1 Ruby 翻訳する。 位置の SoT は `Rider.distance_traveled` 1 つに固定、 Trkpt 書き込みも viewer broadcast も `rider.position` 経由で取り、 2026-05-15 の 0km lat 固定事故 (= 二重 SoT) を物理 mitigation する。 test は r-05 質的 gate に従って happy / error / edge の 3 種 + 0km lat reg test + 完走 integration、 misleading / tautological を作らない。 本 brief 完了で r-21 (= ActionCable) と r-22 (= IndexedDB 撤廃) の Rider state push / 永続化が docked、 r-90 (= 観るモード) の Rider 単独動作確認の forcing function が成立する。
