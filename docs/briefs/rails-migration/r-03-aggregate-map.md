# r-03 aggregate map (= Terrain / Rider / Course / Ride / Account)

depends-on: r-00

## はじめに

旧 fujihc-trainer は `ride_state` に `curIdx / curDist` しか持たず、 「テラインマップの中の Rider 管理」 概念が不在のまま brief 34 ε-9 系列で逐次 fix を重ねた (= user 過去訂正「テラインマップの中の Rider 管理が無い」 直撃)。 本 brief は Rails 移植の Tier 0 で **aggregate 階層 / mutability / lifecycle / ownership を 1 表で確定** し、 viewer (= 描画層) に Rider 概念が侵食する Tier 順序事故を未然に断つ。 r-04 (配置規範) と対 (= ここでは何が aggregate か、 r-04 ではそれをどの layer に置くか)。

## 何

5 つの aggregate root を確定:

1. `Terrain` — 富士山周辺の標高 + 起伏の immutable 客観 model
2. `Rider` — 現在位置 + 速度 + 心拍 + power の mutable runtime state
3. `Course` — 富士スバルライン (= 起点 / 終点 / 区間 / route meta) の immutable AR meta
4. `Ride` — 1 回の走行の trkpt 列 + duration + 結果 の永続化 snapshot
5. `Account` — single-user 想定下の論理的 user (= Strava token / settings 保有)

## なぜ

1. **責務混線の阻止**: 旧構造は Rider が course を所有していた (= `curIdx` を `course[curIdx]` で引く) ため、 course が変わると Rider が壊れる。 Rider は Terrain への query で「今ここ (= lat/lon/elevation/heading/slope)」 を取る形に分離する
2. **mutability 境界の明示**: immutable (= Terrain / Course) vs mutable (= Rider) vs append-only (= Ride) を Tier 0 で fix することで、 後段 brief で「Rider が Terrain を書き換える」 「viewer が Course を mutate する」 等の事故を未然に阻止
3. **viewer 侵食の阻止**: viewer は描画層であり model を持たない。 Rider state は ActionCable で server → viewer に push、 viewer は描画にしか触らない (= Flow A、 r-00 §viewer ↔ server data flow 参照)
4. **後段の references 確立**: r-10 (GLB build) / r-11 (viewer) / r-20 (PORO) / r-21 (channel) / r-22 (Ride AR) / r-90 (観るモード) すべてが本表を参照する

## 仕様

### aggregate 階層表

| aggregate | mutability | lifecycle | ownership | 主な responsibility | 配置 (= r-04 参照) |
|---|---|---|---|---|---|
| `Terrain` | **immutable** | build time に確定、 runtime で不変 | `Course` が参照、 単独存在も可 (= 観るモードで純粋な 3D 表示用) | lat/lon → elevation/slope/heading の query | `app/domain/terrain.rb` (PORO) |
| `Course` | immutable AR meta | DB seed で 1 件 (= 富士スバルライン) | 単独 | `Section` 列、 起点 / 終点、 距離、 区間勾配の SoT | `app/models/course.rb` (AR) |
| `Rider` | **mutable** | 1 ride 中だけ生存 (= ride 開始で create、 ride 終了で discard) | Account が所有、 Ride に snapshot | 現在の lat/lon/heading/speed/hr/power/cad、 Terrain への query で elevation/slope を逐次取得 | `app/domain/rider.rb` (PORO、 redis や memory に runtime 保持) |
| `Ride` | **append-only** | 1 ride = 1 record、 走行中は `Trkpt` append、 終了で finalize | Account が所有 | trkpt 列、 開始 / 終了時刻、 平均 / 最大 値、 GPX export 源 | `app/models/ride.rb` (AR) `has_many :trkpts` |
| `Account` | mutable | 半永久 (= single-user では 1 record) | 単独 (= top of graph) | Strava token (= `encrypts`)、 settings (= JSON column)、 ride history の owner | `app/models/account.rb` (AR) |

### 所有関係 (= aggregate ER)

```
Account 1 ─── n Ride 1 ─── n Trkpt
   │
   └── 0..1 Rider (= 走行中のみ存在、 in-memory / Solid Cable)
            │
            └── 参照 ──→ Terrain (= immutable 客観)

Course 1 ─── n Section
  │
  └── 参照 ──→ Terrain (= 同じ Terrain を共有)
```

- `Account has_many :rides`
- `Ride has_many :trkpts`
- `Rider` は AR ではなく runtime PORO、 Solid Cable / Solid Cache に乗る (= server 再起動で消えてよい、 永続化は `Ride` 側)
- `Course has_many :sections` (= AR meta、 r-33 で実装)
- `Terrain` は AR ではなく PORO + JSON file 1 個 (= r-10 で build time に生成、 SoT は GSI DEM cache)

### Rider が Terrain を query する形

```ruby
# app/domain/rider.rb (PORO 概念図、 真の impl は r-20)
class Rider
  attr_reader :lat, :lon, :speed_mps, :hr, :power, :cad

  def initialize(terrain:, course:)
    @terrain = terrain
    @course = course
    # 初期位置 = course.start_point
  end

  def advance(elapsed_s)
    # speed_mps × elapsed_s で進む、 course 沿いに lat/lon 更新
  end

  def elevation_m
    @terrain.elevation_at(@lat, @lon)  # Terrain への query
  end

  def slope_pct
    @terrain.slope_at(@lat, @lon, @heading)
  end
end
```

(= Rider は course / terrain を所有せず参照のみ、 mutation は self の `lat/lon/speed/hr/power/cad` に閉じる)

### lifecycle の trigger

- `Terrain` create: r-10 build time に `bin/rails terrain:build` で JSON dump、 runtime には 1 個 load
- `Course` create: DB seed (= `db/seeds.rb`) で 1 件、 r-33 で section 含む
- `Rider` create: `state-pairing` 完了 + `state-riding` 遷移時に `Rider.new(terrain:, course:)`
- `Rider` discard: `state-riding` → `state-postride` 遷移時、 最終 snapshot を Ride に書き、 Rider object 破棄
- `Ride` create: `state-riding` 開始時に `Account#rides.create!(started_at: ..., course: ...)`
- `Ride` finalize: `state-postride` 遷移時に `Ride#finalize!` (= 集計 + GPX export 候補化)
- `Account` create: single-user 想定下では migration の seed で 1 record (= `id: 1`)

### viewer (= 描画層) の touch 範囲

viewer は **Terrain / Course の immutable data** + **Rider の broadcast snapshot** だけを読む:

- Terrain mesh / Course polyline は GLB に焼かれて load (= r-10 / r-11)
- Rider の現在位置 (= lat/lon/heading/elevation) は ActionCable broadcast で受け、 `rider_marker` mesh の transform を update
- viewer は Rider / Ride / Account を mutate しない (= server 側 PORO / AR が SoT)

## 完了条件

- 本 brief が landing (= scratch dir の commit)
- 後段 r-20 (PORO 実装) / r-22 (Ride AR) / r-33 (Course / Section) / r-30 (Account + Strava token) が本表の aggregate / mutability / ownership に整合
- r-11 viewer の Stimulus controller が Rider / Ride / Account の AR を直接触らない (= ActionCable broadcast 経由のみ)
- 後段 audit (= r-20 着手前) で本表と実 model 定義の照合 verify

## 参照

- Rails 8 Guides — Active Record Basics: https://guides.rubyonrails.org/active_record_basics.html
- Rails 8 Guides — Active Record Associations: https://guides.rubyonrails.org/association_basics.html
- DDD aggregate root の概念: Eric Evans "Domain-Driven Design" (= AR / Active Record の文脈で aggregate root = AR class、 entity = AR instance、 value object = PORO with `==` を踏襲)
- 旧 brief 26b (= `state-checking / state-dbinit` の 4 state 体系) — `~/.agents/scratch/fujihc-trainer-project/briefs/26b-*.md`
- user 過去訂正: 「テラインマップの中の Rider 管理が無い」 (= 2026-05-14)、 「Rider が course 所有じゃなく Terrain query」 (= 本 brief で encode)

## まとめ

5 aggregate (= Terrain / Rider / Course / Ride / Account) と mutability / lifecycle / ownership を 1 表で確定。 viewer 侵食、 旧 ride_state 失敗、 mutation 境界曖昧化を Tier 0 で物理的に阻止。 r-04 (配置規範) と組で読むこと。
