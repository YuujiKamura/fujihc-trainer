# r-22 Camera follow + 自動 test 基盤 (= モデル空間操作系の破綻防止)

depends-on: r-03, r-04, r-05, r-20

## はじめに

2026-05-15、 user 訂正で「HUD / button / cable / power slider の上モノ を作る前に、 モデル空間 (= Terrain + Rider + camera 追随) が破綻なく動く自動 test 基盤を先に作れ」 と方針が引かれた。 r-20 で Rider PORO と Terrain PORO は landed、 `bin/rails test` で 28 件 green の最低限の足場ができたが、 **camera 追随** (= rider 位置に Three.js camera を寄せ、 進行方向に bearing を向け、 user 入力で zoom / pitch / 横ドラッグ offset を反映する) は test ゼロのまま viewer_3d_controller.js の `connect()` 内に Three.js / OrbitControls 直触りで居座っている。

JS 旧版で何を分離したか参照する。 旧 web 側は `web/lib/camera_controller.js` (= 本 brief 内では camera params 計算層と呼ぶ、 旧 file の物理名は camera_controller.js だが内容は params 計算の純関数 + zoom/pitch clamper) を独立 file に切り出し、 `computeCameraParams(course, {curIdx}, {userZoom, userPitch, lookAhead})` で MapLibre 用 `{center, zoom, pitch, bearing}` を返す pure function にした。 viewer-maplibre.js の tick はその戻り値を `map.jumpTo` に流すだけ、 計算は呼ばない。 `web/tests/camera_controller.test.js` で 12 件 (= 北向き / 東向き / clamp / default 等) を vitest で green。 Rails 側も同じ「pure 層を切り出して数値 test する」 形にする。

「camera 追随を自動 test できる」 とは Three.js / DOM / OrbitControls / WebGL canvas を一切触らず、 入力 (= rider 位置 + terrain + user 入力) と出力 (= camera position / target / bearing / pitch / zoom の Hash) の数値だけで verify できる pure layer に切り出すことを意味する。 viewer Stimulus 側は「server から受け取った camera Hash を OrbitControls / camera.position に setter で当てるだけ」 に痩せ、 計算ゼロにする。 これで camera 計算の SoT は server (= Ruby) 側 1 経路、 二重 SoT 事故 (= r-20-save-bug-audit T1) を camera 層でも未然に断つ。

本 brief は 3 層の test 基盤を確定する。 層 1 = `CameraParams.compute` 単独 (= service test、 8 件)、 層 2 = Terrain + Rider + CameraParams 組合せ (= integration test、 4 scenario)、 層 3 = RideLoop が broadcast する snapshot に camera params が乗っていることの verify (= channel integration、 2 件)。 Three.js / WebGL / DOM の test は本 brief の外、 viewer Stimulus 痩せ化の DOM test は別 brief。 r-20 (Rider PORO) と r-21 のうち既 landed 半分 (= RideLoop + RideChannel + viewer_3d_controller.js) との接続点を確定し、 r-21 残半分 (= UI 入力 round-trip) と viewer 痩せ化を後段に押し出すための土台にする。

## 何 — CameraParams service の責務

`app/services/camera_params.rb` に純関数 service を 1 個置く。 役割は rider と terrain と user 入力を受けて、 Three.js viewer が camera を寄せる際の数値 Hash 1 つを返すことに絞る。

```ruby
class CameraParams
  DEFAULTS = {
    zoom: 14.0,
    pitch_deg: 60.0,
    bearing_offset_deg: 0.0,
    look_ahead_m: 50.0,
  }.freeze

  # @param rider [Rider] 進行中の Rider PORO (= rider.position と rider.distance_traveled を読む)
  # @param terrain [Terrain] rider と同じ Terrain (= position_at 経由で look-ahead 点を引く)
  # @param user_input [Hash] {zoom:, pitch_deg:, bearing_offset_deg:, look_ahead_m:} の部分指定可
  # @return [Hash] {position:, target:, bearing_deg:, pitch_deg:, zoom:}
  #   position / target は {lat:, lon:, elevation_m:}
  def self.compute(rider:, terrain:, user_input: {})
    raise ArgumentError, "rider required" if rider.nil?
    raise ArgumentError, "terrain required" if terrain.nil?

    opts = DEFAULTS.merge(user_input.transform_keys(&:to_sym))
    zoom = opts[:zoom]
    pitch_deg = opts[:pitch_deg]
    bearing_offset_deg = opts[:bearing_offset_deg]
    look_ahead_m = opts[:look_ahead_m]

    target = rider.position  # {lat, lon, elevation_m, heading_deg, ...}

    # look-ahead 先の course 点を取り bearing を再計算 (= rider.position.heading_deg は
    # 単一 segment の atan2、 look_ahead_m 先を見ることで camera だけ先読み視点になる)。
    look_ahead_pos = terrain.position_at(rider.distance_traveled + look_ahead_m)
    bearing_deg = bearing_between(target, look_ahead_pos, fallback: target[:heading_deg])
    bearing_deg = (bearing_deg + bearing_offset_deg) % 360.0

    {
      position: target.slice(:lat, :lon, :elevation_m),
      target: target.slice(:lat, :lon, :elevation_m),
      bearing_deg: bearing_deg,
      pitch_deg: pitch_deg,
      zoom: zoom,
    }
  end

  def self.bearing_between(from, to, fallback:)
    return fallback unless from && to
    d_lat = to[:lat] - from[:lat]
    d_lon = to[:lon] - from[:lon]
    return fallback if d_lat.abs < 1e-12 && d_lon.abs < 1e-12
    x = d_lon * Math.cos(from[:lat] * Math::PI / 180.0)
    rad = Math.atan2(x, d_lat)
    deg = rad * 180.0 / Math::PI
    deg += 360.0 if deg < 0
    deg
  end
end
```

class method 1 個 + private な bearing_between の合計 2 method、 state なし、 Three.js / DOM / OrbitControls / WebGL を一切触らない。 戻り値の position と target を別 key にしたのは将来 (= 別 brief) で「rider の少し後上方に position、 rider 自身を target」 にするための拡張余地で、 v0 では position == target で問題ない (= viewer 側 OrbitControls が camera-target 距離を offset として吸収する形)。

viewer Stimulus 側の rewire 方針は本 brief では「方向だけ encode、 impl は別 brief」 とする。 当面は RideLoop の broadcast snapshot に camera params を一緒に乗せ、 Stimulus は受け取った camera Hash を OrbitControls.target / camera.position に setter で当てるだけ、 計算ゼロ。 後段で user 入力 (= zoom slider / pitch drag / 横ドラッグ bearing offset) を channel#receive 経由で server に送り、 server で次 broadcast に反映する round-trip を作る (= 別 brief、 本 brief の外)。

## なぜ — 設計の load-bearing 根拠

第一に、 数値 test できる pure layer に出すと「破綻」 が回帰 test で物理 deny できる。 JS 旧版は brief 19 で camera_controller.js を切り出すまで viewer-maplibre.js の tick 内 inline で curIdx の bearing を計算しており、 人が画面を見て「カクついた」 「視線が真後ろになった」 を目視確認するしか方法がなかった。 切り出し後は `web/tests/camera_controller.test.js` の 12 件で「北向き course → bearing≒0」 「東向き → 90」 「curIdx 末尾超過で clamp + heading 破綻なし」 を数値 pin できるようになり、 viewer rewire のたびに gate として効いた。 Rails 側で同じ pure 層を作らないと、 viewer Stimulus 内 inline で書いて「動いた」 「動かない」 を目視するしかなくなる ── 旧 viewer-maplibre.js の 2200 行肥大 (= NG-R1-7 / NG-R5-10) を Rails 側で再演する道だ。

第二に、 Three.js / OrbitControls / DOM は test 不可、 pure 切り出しが test 化の必要条件。 viewer_3d_controller.js の `connect()` は WebGLRenderer 構築 + Scene + Camera + Lighting + GLB load + rider_marker 配置 + OrbitControls + RAF tick + ActionCable subscription を 1 関数で抱える肥大 controller で、 ここに camera 計算を足すと 11 責務同居 (= NG-R5-10 の brief 版再演) になる。 数値計算を `app/services/camera_params.rb` に切り出すと、 controller は「snapshot.camera を OrbitControls に当てる」 setter だけが残り、 controller 自体の test は「snapshot を mock で流して setter が呼ばれた」 だけで足りる (= controller test の範囲を最小化する効果も合わせて取れる)。

第三に、 r-20 の Rider PORO + Terrain PORO と同じ `app/domain` / `app/services` 層に置けば aggregate 整合が取れる (= r-04 配置規範)。 camera params は「Rider と Terrain と user 入力の 3 つから派生する read-only な view」 で、 これは r-04 表で言う service (= 動詞的 use-case、 idempotent な procedure、 state 持たない) に該当する。 `app/domain/` に置くと「camera は aggregate root」 という違う誤解を招くので避け、 `app/services/` に PORO で置くのが筋。

第四に、 viewer Stimulus の責務縮小は v0 の連続価値として一番大きい。 viewer_3d_controller.js は今 8 責務同居 (= Three.js setup / GLB load / rider 配置 / OrbitControls 操作 / ActionCable subscribe / HUD update / ride lifecycle button / power slider debounce) で test 困難、 camera 計算が足された瞬間に 9 責務に増える ── 切り出した camera 層を server で算出し snapshot に乗せる形にしておけば、 v0 viewer は「snapshot を受け取って描画に当てる」 だけになり、 後段の DOM 痩せ化が機械的に進む。

## なぜ camera を server 側で計算するか — 設計判断の補足

rider snapshot と camera params の整合性を server 側 1 箇所で保証する。 client 側で「snapshot.lat/lon を読んで camera を自分で計算する」 ことも可能だが、 そうすると rider の SoT (= server) と camera の SoT (= client) で 2 経路が並ぶ。 r-20-save-bug-audit T1 (= 二重 SoT) の camera 版が同じ機序で起き得る ── 例えば snapshot に乗ってない look-ahead 用の course 点を client が独自に持つと、 server 側で course が更新された瞬間に camera だけ古い course を見続ける。 SoT を server 1 経路に寄せ、 client は受信値を表示するだけにする方が破綻ベクトルを 1 減らせる。

user 入力 (= bearing offset / zoom / pitch / look-ahead) は client → server に websocket で送る。 これは r-21 の channel#receive で既に「set_power」 と同じ経路がある (= RideChannel#set_power が RideLoop.set_power を呼んで rider.update_sensors へ伝播)、 同じ書き方で `set_camera_input(data)` を追加し RideLoop 側に camera_input を持たせる。 server は次 broadcast の compute 時に user_input として渡す。 input は class instance state (= RideLoop の entry Hash に camera_input field を 1 つ生やす) として保持。 これも本 brief 内で「方向の encode のみ、 impl は別 brief」 とする (= 受け入れ条件には書かない)。

## 仕様 — class 配置と method 一覧

### `app/services/camera_params.rb` (= 純関数 service、 state なし)

class method `compute(rider:, terrain:, user_input: {})` 1 個 + 同 class の bearing 計算 helper。 上記 `## 何` の Ruby code 例を SoT とする。

defaults を `DEFAULTS` で凍結する: zoom=14.0、 pitch_deg=60.0、 bearing_offset_deg=0.0、 look_ahead_m=50.0。 これらは現状の Three.js viewer / 富士スバルライン scale で「rider が画面中央に見える程度の俯瞰」 を取る初期値 (= JS 版の MapLibre 用 zoom 23.95 / pitch 85 とは別、 Three.js 座標系 + camera_positioner.js の現状 offset 50/50/100 を踏まえた値)。 v0 ではこれらは触らない default のみで動かす、 数値の調整は viewer 痩せ化後の別 brief に持ち越す。

戻り値 Hash schema は `{position: {lat:, lon:, elevation_m:}, target: {lat:, lon:, elevation_m:}, bearing_deg:, pitch_deg:, zoom:}`。 position と target を分離してあるが v0 では同値、 OrbitControls 側で offset を吸収する。 後段 brief で「rider の後上方に camera position」 と分離する余地を schema に残す。

look-ahead heading 計算は `terrain.position_at(rider.distance_traveled + look_ahead_m)` で先読み点を取り、 そこと rider 現在位置の 2 点間で atan2 を取る。 これは旧 viewer-maplibre.js の curIdx + curIdx+1 frac 補間より単純な式だが、 純関数化の利点を取って単純式から始める (= 旧 viewer の frac 補間は MapLibre の jumpTo が discrete idx 遷移で「カクつく」 問題への mitigation、 Three.js + OrbitControls なら毎 frame 補間で滑らかさは別経路で取れる)。 user_input[:bearing_offset_deg] を base bearing に加算して最終 bearing を作る (= 旧 viewer の userBearingOffset と同型)。

### viewer Stimulus 側の rewire 方針 (= 本 brief 範囲外、 別 brief で impl)

viewer_3d_controller.js が CameraParams.compute を直接呼ぶことはしない。 server から broadcast される snapshot に camera Hash を一緒に乗せ、 Stimulus は受け取った camera Hash を OrbitControls / camera.position に setter で当てるだけにする。 camera 計算の SoT は server 側 1 個、 client は表示のみ。 controller から `lookAt` / `Math.atan` / `bearing` を grep で物理消去する完了条件は viewer 痩せ化 brief で encode する (= 本 brief は CameraParams 切り出し + test 基盤のみ)。

### RideLoop の broadcast に camera を載せる経路

`app/services/ride_loop.rb` の `maybe_broadcast(entry)` で snapshot を作る部分に camera params 計算を 1 行足す。

```ruby
def maybe_broadcast(entry)
  snap = nil
  camera = nil
  entry[:mutex].synchronize do
    snap = entry[:rider].snapshot
    camera = CameraParams.compute(
      rider: entry[:rider],
      terrain: entry[:terrain],
      user_input: entry[:camera_input] || {},
    )
  end
  snap_with_camera = snap.merge(camera: camera)
  RideChannel.broadcast_to(entry[:ride], snap_with_camera)
rescue => e
  Rails.logger.error("[RideLoop broadcast] #{e.class}: #{e.message}")
end
```

`entry[:camera_input]` は default `{}`、 user 入力受信時に RideChannel#set_camera_input で書き換える (= round-trip は別 brief)。 mutex 内で rider と terrain 両方を読む点に注意 (= camera_input は読み取り、 rider の position は terrain.position_at を内部で呼ぶので排他が要る)。

## テスト網羅 — 3 層

r-05 質的 gate (= happy / error / 1 edge case を必須、 misleading / tautological 禁止) に従う。 量的 coverage gate は採用しない。

### 層 1: CameraParams 単独 test — `test/services/camera_params_test.rb`、 最低 8 件

1. **平坦 course の起点で compute → target が起点座標と一致** (happy)。 SyntheticCourse.linear で Terrain、 Rider.new(terrain:).tap(&:start)、 distance_traveled=0 のまま compute → camera[:target] の lat/lon が course[0] と一致 (= 浮動小数点 1e-9 許容)。
2. **rider が 100m 進んだ位置で compute → target が 100m 先 course 点と一致** (happy)。 rider.update_sensors(power: 200) + 適度な tick 列で distance_traveled を 100m 近辺に動かし (= 直接 setter は無いので tick を回す)、 compute → camera[:target][:lat] が terrain.position_at(100.0)[:lat] と一致。
3. **user_input[:bearing_offset_deg] = 90 → bearing が base + 90** (入力反映)。 base bearing (= look_ahead 算出値) を別 compute 呼びで取り、 同 input + offset 90 で再 compute、 差分が 90 ± 1e-9。
4. **user_input[:zoom] = 18 → zoom = 18** (入力反映)。 default 14 とは別の値を指定し戻り値の zoom が一致。
5. **user_input[:pitch_deg] = 30 → pitch_deg = 30** (入力反映)。 default 60 とは別の値を指定し戻り値の pitch_deg が一致。
6. **look_ahead が course 範囲外 (= rider が終端付近) → 終点 bearing が安定値** (edge: 境界)。 distance_traveled を total_distance - 5 に置き compute、 戻り値 bearing が NaN / Infinity ではない有限値 (= Terrain.position_at が末端 clamp で同点を返しても fallback で rider.position[:heading_deg] が返る)。
7. **rider=nil / terrain=nil → ArgumentError** (error)。 引数欠落で raise を `assert_raises(ArgumentError)` で verify、 2 件 (= rider nil, terrain nil)。
8. **空 course の terrain で compute → bearing=fallback、 target=position の最小破綻** (edge: 空)。 Terrain.new(course: []) + Rider.new(terrain:) で compute、 lat/lon は 0.0 で返り NaN 漏れなし、 bearing は rider.position[:heading_deg]=0.0 が返る。

### 層 2: Terrain + Rider + Camera 組合せ integration — `test/integration/camera_follow_test.rb`、 最低 4 scenarios

1. **camera 追随 — 100 step tick で target と rider.position の距離が常に 1m 以内** (happy)。 SyntheticCourse.linear(distance_m: 1000)、 Rider.start + update_sensors(power: 200)、 dt=0.1 で 100 回 tick、 各 step で CameraParams.compute → 戻り値の `target[:lat]/lon` と `rider.position[:lat]/lon` の equirectangular 距離 が 1m 以内 (= position と target が同点である gate、 v0 では恒等)。
2. **bearing 差分は user_input.bearing_offset_deg と一致** (累積 drift なし)。 同 setup で各 step に user_input: {bearing_offset_deg: 30} を渡し、 同 step に user_input: {} で別 compute、 bearing 差分が 30 ± 1e-9 で全 step 一定 (= 累積される shim 不在の物理 gate)。
3. **rider が pause 中 → CameraParams が変わらない** (静止)。 rider.pause 後の tick は no-op (= r-20 Rider#tick は paused で early return)、 連続 compute で `target` `bearing_deg` が完全一致。
4. **rider が at_goal → camera target が終点座標で fix** (edge: 完走)。 distance を total_distance まで進め at_goal? true、 compute → target が course 末端と一致、 bearing は fallback (= NaN / 突発回転なし)。

### 層 3: RideLoop が broadcast snapshot に camera params を乗せる — `test/integration/ride_loop_camera_test.rb`、 最低 2 件

1. **`RideLoop.tick_once!(ride_id)` 経由の broadcast に :camera key が含まれる** (構造)。 既存 `ride_loop_test.rb` 同様の setup で ride を作り `RideLoop.start(ride_id:, broadcast: false)` で thread を起こさず、 `RideLoop.tick_once!(ride_id)` を呼んだ後、 別途 `RideLoop.maybe_broadcast` を test 内で同期呼び出すか、 `RideChannel.broadcast_to` を `assert_broadcasts(ride, 1)` で gate しつつ broadcast payload に `:camera` key が含まれること、 中身が CameraParams.compute(rider: entry[:rider], terrain: entry[:terrain]) と一致することを assert。
2. **ride_channel#set_camera_input action 受信 → 次 broadcast の camera に反映** (入力 round-trip、 v0 受け入れ条件には含めない)。 本 test は **r-21 後半 (= UI 入力 round-trip) の brief に持ち越し**、 本 brief では skeleton (= pending mark) のみ置く ── server 側 RideChannel#set_camera_input + RideLoop.set_camera_input(ride_id, input) の薄い impl と test を別 brief で encode する。

注意: 層 3 は ActionCable broadcast を踏むため flaky になりやすい。 `assert_broadcasts` で件数 gate と payload 検査の両方を踏む、 thread 起動 (= `broadcast: true`) は test では使わない (= `broadcast: false` + `tick_once!` + 内部 `maybe_broadcast` を private 公開する shim を test だけで足す)。

### Three.js / OrbitControls / DOM の test

本 brief の範囲外。 viewer_3d_controller.js は今 Three.js 直触り + OrbitControls + RAF + ActionCable subscribe + GLB load を抱えていて test 困難、 これは別 brief で「viewer Stimulus 痩せ化 + DOM system test」 として分離する。 本 brief 完了時点では viewer 側は変更なし (= camera 計算は server 側に置くが、 viewer は当面これまで通り client 側で camera を雑に置いている動作のまま、 snapshot.camera を読む rewire は別 brief)。 これは「server で計算 + broadcast 経路を先に通す」 → 「viewer rewire は後段」 という順序で、 各 commit を小さく保つための切り分け。

## 受け入れ条件

`app/services/camera_params.rb` が landed、 `bin/rails zeitwerk:check` 通過、 r-04 配置規範 (= service 層、 純関数 / state なし / DB 非依存) と整合。 r-20 が landed 済みの環境 (= app/domain/rider.rb と app/domain/terrain.rb 存在前提) で動くこと。

層 1 (= 8 件) + 層 2 (= 4 scenario) + 層 3 (= 2 件、 うち 1 件は pending mark) の全 test が `bundle exec bin/rails test` で green。 r-20 で landed した既存 28 test を 1 件も壊さない (= regression なし)、 全体 `bin/rails test` で 28 + 14 = 42 件以上が green。

RideLoop の broadcast snapshot に `:camera` key が含まれる (= 層 3 test #1 で物理 verify)、 `camera[:position]` `camera[:target]` `camera[:bearing_deg]` `camera[:pitch_deg]` `camera[:zoom]` の 5 key が含まれる。

viewer_3d_controller.js が「camera を計算する」 code を持たない物理 verify は **本 brief 範囲外** (= viewer 痩せ化 brief で encode)。 本 brief 完了時点では viewer は無変更で、 controller から `lookAt|Math\.atan|bearing` を grep で消す検証は次段に持ち越す。

二重 SoT 設計 (= viewer 側に camera を独自計算する経路、 server snapshot を無視する経路、 旧 camera を cache して差分計算する経路) が impl 上に存在しないことを audit で照合 (= 本 brief は server 側 1 経路のみ encode、 viewer は受信値を見るだけの design 宣言を本 brief 内に encode する)。

## 依存と順序

depends-on: r-03 (= aggregate map で Rider が Terrain を query する形が確定) / r-04 (= service 層配置規範) / r-05 (= test baseline、 質的 gate) / r-20 (= Rider PORO + Terrain PORO + RideLoop が landed)。

blocks: viewer Stimulus 痩せ化 (= 別 brief、 camera 計算を controller から削り snapshot.camera を OrbitControls に当てる setter のみに rewire)、 user 入力 round-trip 完成 (= 別 brief、 zoom / pitch / bearing slider が channel#receive 経由で server に届き次 broadcast に反映)、 ride_state.js shim 撤廃の最終決着 (= 旧 web 側、 Rails 移植が viewer まで進んだ後)。

commit 粒度: 2-3 commit に分割可。 (1) CameraParams service + 層 1 単独 test、 (2) RideLoop に camera を載せる修正 + 層 2 組合せ integration + 層 3 構造 test、 (3) layer 3 #2 の round-trip skeleton + pending mark。 (3) を本 brief 内に入れず別 brief に切るのも可、 receive 経路の impl は別 brief 推奨。

revert 経路: 各 commit を個別 `git revert <sha>` で戻せる。 全 revert で `app/services/camera_params.rb` が消え、 `app/services/ride_loop.rb` の `maybe_broadcast` が camera を含まない元の snapshot のみ broadcast に戻る。 viewer 側は無変更なので revert で client 側の表示は影響を受けない。

## 保存バグ防止 — 必須遵守

camera params の SoT は server 側 `CameraParams.compute` 1 経路にする。 viewer に「前回 camera」 を cache して差分計算する pattern、 client が rider.position から camera を独自再計算する pattern、 旧 camera と新 camera を blend する補間 cache を viewer 側に持つ pattern ── すべて二重 SoT 温床なので impl 禁止。 滑らかさが必要なら server 側 compute を高 Hz で broadcast するか、 OrbitControls の damping (= built-in) に任せる。

rider position と camera target は **同じ rider snapshot 元から導出**、 別経路で計算しない。 RideLoop.maybe_broadcast 内では mutex 内で rider と terrain と camera_input を 1 つの critical section で読む (= rider state 更新中の中間値で camera を計算しない、 broadcast されない / 部分的 snapshot 事故を防ぐ)。

user_input は RideLoop entry の 1 field (= `entry[:camera_input]`) に集約し、 RideChannel#set_camera_input 経由でのみ書き換える。 controller / direct call で書き換える経路を作らない。

shim を作らない。 旧 JS 版の `userBearingOffset` 等の名前を Ruby 側に蘇生させる誘惑が出たら、 r-20 brief §保存バグの轍 §設計原則 を引いて却下する (= 「後方互換 shim」 は Ruby 側に持ち込まない、 新 layer は新 API のみ公開)。

## 参照

公式 doc:

- Rails 8 Guides — Action Cable Overview: https://guides.rubyonrails.org/action_cable_overview.html
- Rails 8 Guides — Testing Action Cable: https://guides.rubyonrails.org/testing.html#testing-action-cable
- Rails Service Object pattern: https://codeclimate.com/blog/7-ways-to-decompose-fat-activerecord-models
- Three.js OrbitControls: https://threejs.org/docs/#examples/en/controls/OrbitControls

ローカル:

- r-03 (= aggregate map): `r-03-aggregate-map.md`
- r-04 (= 5 層配置規範、 service 層の置き方): `r-04-layered-architecture.md`
- r-05 (= test baseline、 質的 gate): `r-05-test-baseline.md`
- r-20 (= Rider PORO + Terrain PORO 仕様): `r-20-rider-model.md`
- r-20-save-bug-audit (= 二重 SoT 防御、 T1 物理 gate): `r-20-save-bug-audit.md`
- 旧 JS camera params 計算 (= 物理名 camera_controller.js、 役割は params): `web/lib/camera_controller.js`
- 旧 JS test (= vitest 12 件、 北向き / 東向き / clamp / default): `web/tests/camera_controller.test.js`
- viewer-maplibre.js camera 呼出 line refs: `web/viewer-maplibre.js` line 1604 (= 起動初期 cam0) / line 1930-1936 (= tick 内 cam + camNext 補間 + userBearingOffset)
- 現状 Rails viewer (= Three.js 直触り、 痩せ化対象): `app/javascript/controllers/viewer_3d_controller.js`
- 現状 camera_positioner.js (= anchor 固定 offset、 追随なし): `app/javascript/lib/camera_positioner.js`
- 現状 RideLoop (= broadcast 経路): `app/services/ride_loop.rb`
- 現状 RideChannel (= action method dispatch): `app/channels/ride_channel.rb`
- drift catalog: `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` (= NG-R5-10 / NG-R1-7 / 二重 SoT 系)
- 動作原則: `~/CLAUDE.md` Rule 1 (= test 先 verify) / Rule 12 (= shortcut 禁止)

INDEX 名前衝突注意: 既存 INDEX.md の Tier 1 に r-22-ride-session-db.md が予約 (= Ride AR + IndexedDB 撤廃) されているが、 本 brief は user 訂正 (= 2026-05-15) で「上モノより先に camera 追随 test 基盤」 と明示指示された別 scope。 INDEX.md 側の番号調整 (= 本 brief を r-22 にする / 旧 r-22 を r-25 等に逃がす / 別系統 prefix を使う) は本 brief 確定後に INDEX.md update commit で対処する。

## まとめ

CameraParams service (= 純関数 1 個、 rider + terrain + user_input → position/target/bearing/pitch/zoom の Hash) を `app/services/` に切り出し、 RideLoop の broadcast snapshot に camera key を 1 つ追加する。 3 層 test (= 単独 8 件 / 組合せ 4 scenario / RideLoop integration 2 件) で「camera 追随の破綻」 が回帰 test で物理 deny される基盤を立てる。 viewer Stimulus 側の rewire と DOM test は別 brief、 本 brief は server 側 pure layer + broadcast 経路 + 数値 test の確立に絞る。 SoT は server 側 1 経路、 client は表示のみ、 二重 SoT 事故 (= r-20-save-bug-audit T1 の camera 版) を未然に断つ。
