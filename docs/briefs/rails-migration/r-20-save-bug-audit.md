# r-20-save-bug-audit — Ruby 移植時の保存バグ防止 audit

## はじめに

直前 (2026-05-15) の JS 側で 4 件の保存系事故が連鎖した。 (1) 全 trkpt が course[0] の lat/lon で push されて GPX upload で 0km 認識される実害、 (2) 完走 (= rider.atGoal=true) 後に ride_state.end / sendRideEnd が呼ばれず ride が永遠に「進行中」 で保存されない、 (3) Rider と shim と viewer の 3 層がそれぞれ idx / dist / speed を持って整合性が崩れた、 (4) rider 単独 / shim 単独の unit は全て green だったが「rider.tick 直接 + shim.appendTrkpt 後付け」 の組合せ経路の test が抜けていて combinatorial bug が landing。

Ruby に移送するとき、 これら 4 件の事故 mode は別の形で再演する。 ActiveRecord (= Ride) と PORO (= Rider) の二重 SoT、 callback と service object と controller action の三層 finish 経路、 「JS との API surface 互換のため」 を口実にした shim、 model 単体 spec と controller spec だけ書いて完走 integration を抜く ── 全部、 JS で踏んだ穴の Ruby 版。

本 audit は脅威 4 種 (T1〜T4) を Ruby 側で再演する pattern と、 spec で物理 pin する test list を確定する。 r-20-rider-model.md (= Rider model brief) の test section の入力として、 必須 spec の名前と scenario 数をここで決め切る。 brief 側で「test 書け」 と書くだけだと NG-R5-6 (= coverage 量的 gate) や NG-R1-8 (= test 規律不在) の再演になるため、 ここで質的 gate を確定する。

## 脅威モデル T1〜T4

### T1: 二重 SoT (= JS 0km lat 固定の根因)

JS で起きたこと: ride_state.js shim 内に `_idx` が独立 field として残っていた (= 旧 advance 経路の curIdx 互換のため)。 viewer が brief 35 で `rideState.advance` から `rider.tick` 直接呼びに rewire された結果、 `_idx` を更新する経路が消えた。 shim._legacyAppendTrkpt は `course[_idx]` を SoT にしていたため `_idx=0` のまま全 trkpt が course 起点 lat/lon で push、 GPX upload で 0km。 commit de57ce1 で `course[_idx]` → `rider.position` に SoT を寄せて fix。

Ruby 側でどう起きうるか: Rider PORO が `position` を持ち、 Ride ActiveRecord が `last_lat` / `last_lon` / `last_distance_m` を持つ二重 SoT が容易にできる。 controller / channel が tick ごとに `ride.update!(last_lat: rider.position.lat)` 風に書き戻すと、 trkpt 保存経路と Ride サマリ経路が別タイミングで動いて乖離する。 さらに RideTrkpt が `before_validation` callback で `self.lat = ride.last_lat` のような pattern を取ると、 Rider 進行と AR 保存の間に遅延が入って同 bug の Ruby 版が landing する。

防御策: SoT は Rider PORO の `position` 1 個に絞る。 Ride AR には `last_*` 系の進行中 mutable field を持たせない (= 保存は ride 完走 / 中断時の 1 回 snapshot のみ)。 RideTrkpt は受け取った lat/lon/elevation をそのまま保存、 callback で他 model 参照禁止。 「Rider.position から lat/lon を取得する」 経路を Rider 内 1 method に集約、 controller / channel / service から `terrain.get_position_at_distance` を直接呼ばない。

必須 test (= 0km lat 固定 reg の Ruby 版): `spec/integration/ride_trkpt_continuity_spec.rb` の 1 scenario。 「Rider を生成 → 1m/s で 50 秒分 tick → 1 秒ごとに `RideTrkpt.create_from_rider(rider)` を呼ぶ → 取得した 50 件の lat unique 数 > 5 + 末尾 lat > 起点 lat」。 trkpt_lat_after_rider_tick.test.js (= 50 秒 loop) と意図が 1:1 対応。 「viewer が rider.tick 直接 + 別経路で trkpt 保存」 の組合せを Ruby 側で再現する。

### T2: 完走時の終端処理抜け

JS で起きたこと: rider.atGoal が true になっても、 viewer-map3d.js の tick 末尾で sendRideEnd / rideState.end を呼ぶ logic が無かった。 ride が永遠に active のまま totalDist でクランプされ続け、 ride 終了 event が発火しないので Strava upload / sync が trigger されない。 commit 00fa2d7 で `if (rider.atGoal && !_autoEnded)` 分岐 + `_autoEnded` gate を追加して fix。

Ruby 側でどう起きうるか: Rider.at_goal? が true になっても、 channel / controller / job が `Ride.finish!` を呼ばないと AR status が `active` のままで `finished_at` も nil。 さらに finish 経路が `RideController#finish` action と `RideChannel#unsubscribed` callback と `RideFinishJob` の 3 経路ある場合、 atGoal trigger だけ抜けて手動 finish と切断 finish しか動かない。 多重発火対策が無いと `_autoEnded` 相当の gate 無しで `Ride.finish!` が 2 回呼ばれて status transition error または duplicate trkpt 保存。

防御策: Ride status 遷移を `Ride#finish!` 1 method に集約 (= state_machine gem or `with_lock + status check` で物理排他)。 Rider.tick 後に `at_goal?` を毎回 check する経路を 1 箇所に置く (= 例えば RideTickService 内のみ)。 controller / channel / job からは `Ride#finish!` のみを呼び、 `Ride.update!(status: :finished)` 直書きを物理禁止。 二重発火は `Ride#finish!` 内で `return if finished?` early-out + DB unique index (= `index_rides_on_finished_at` 等) で多重 transition を排除。

必須 test: `spec/integration/ride_completion_spec.rb` の 4 scenarios。 (a) 「Rider 100m を 5 秒で完走 → tick service が at_goal? true 検出 → Ride.status が `finished` に遷移 + finished_at セット」、 (b) 「完走後の追加 tick は no-op (= distance 不変、 status 不変)」、 (c) 「finish! を 2 回連続で呼んでも 1 回しか transition せず callback 1 回のみ発火」、 (d) 「手動 finish (= controller action) と auto finish (= tick service) が race しても最終 status が `finished` で trkpt 重複なし」。 integration_ride_completion.test.js と意図が 1:1、 (c)(d) が「user指摘『完走時の終端処理とかテストケース書くだろ』」 の Ruby 拡張。

### T3: 後方互換 shim の毒

JS で起きたこと: brief 35 で Terrain + Rider 2 層モデルに refactor したとき、 既存 12+9+8 件の test (= ride_state.test.js / ride_state_trkpts.test.js / ride_state_advance.test.js) を壊さないため旧 createRideState を shim 化して残した。 shim は内部で Terrain + Rider を生成しつつ旧 API surface (= advance / appendTrkpt / snapshot.idx) を露出。 shim 自身が `_idx` を独自 field で持つことが二重 SoT の温床となり、 T1 の bug の物理的住所になった。 「test を壊さない」 を理由に旧 SoT を生かしたまま新 SoT を導入した = 新旧 2 SoT 並走の典型失敗。

Ruby 側でどう起きうるか: 「JS との API surface 互換のため」 「旧 IndexedDB schema との互換のため」 「過去 spec を壊さないため」 を口実に、 Rider の旧 API (= `advance(dt, speed)` 等) を Ruby 側に蘇生させる pattern。 例えば `RideState` AR or PORO に `advance` method を生やして内部で `rider.tick + ride.update_distance!` を呼ぶ shim を作ると、 まさに JS の ride_state.js と同型の構造になる。 同じく「viewer.js が data-distance を読むため Ride#last_distance_m を生やす」 系の retrofit も同型。

防御策: shim を一切作らない。 旧 JS API surface は JS 側 (= viewer-map3d.js の cutover commit) で deprecate、 Ruby 側は新 API surface (= Rider PORO + Terrain PORO + Ride AR の 3 役) のみ公開。 「Ruby 側で advance method を生やす」 「Ride に last_distance_m を持たせる」 「RideState という中間 layer を作る」 ── 3 つとも禁止。 r-23-indexeddb-backfill.md の export → import 経路で旧データを new schema に流し込む 1 方向経路に集約 (= shim ではなく 1 回切りの ETL)。

必須 test: なし。 shim を作らない物理 gate (= grep "class RideState" $RAILS_ROOT/app/** の 0 件確認、 r-05 baseline で実装規約として gate) で運用。 spec で防ぐのではなく実装規約で防ぐ ── shim は「test 維持のため」 という社会的圧力で生まれるので、 「shim 禁止」 を r-04 (= layered architecture) の規範に明記して PR レビューで止めるのが正攻法。

### T4: 偽 green (= unit pass で combinatorial fail)

JS で起きたこと: rider.test.js (= 35 件)、 ride_state.test.js (= 14 件)、 ride_state_trkpts.test.js (= 8 件) は brief 35 直後も全て green だった。 だが「rider.tick 直接 (= viewer rewire 後の経路) + shim.appendTrkpt 後付け」 という混在経路を test する file は無く、 unit 単独では発火しない T1 bug が landing。 commit de57ce1 で trkpt_lat_after_rider_tick.test.js を新規追加 (= 2 scenario)、 fix と並走で reg pin。 unit 全 green は「実装した範囲は壊れていない」 を保証するが「組合せ経路で壊れていない」 は保証しない、 という古典的失敗 mode の典型。

Ruby 側でどう起きうるか: Rider PORO spec (= tick / position / sensors の単体) と Ride AR spec (= valid / 集計 / association の単体) と RideTrkpt spec (= valid / 順序の単体) を別々に書いて全て green、 だが「ride 開始 → 60Hz で Rider.tick → 1Hz で RideTrkpt.create → 完走 → Ride.finish! → 集計値検証」 を通す integration spec を書かず landing。 「unit が全 green だから OK」 で push して user が実走で踏む、 という JS と完全同型の事故。

防御策: integration spec を 2 file 4 scenario 以上 mandate 化 (= r-05 baseline で明文化)。 完走 / 中断 / 再開 / 二重 ride 起動 (= 既存 active ride がある状態で新 ride を start) の 4 パスを必ず通す。 unit spec だけで PR 通る運用を禁止 (= CI gate で integration spec presence check、 absence で fail)。 「ride 開始から保存までを通す」 一貫経路の spec を「保存系の責任 boundary」 で必ず書く規律を r-05 と r-20 (= rider-model brief) 両方で encode。

必須 test: 下記 4 scenario を `spec/integration/` 配下に置く。 (a) **完走経路 spec**: 100m course → Rider を 60Hz で 5 秒 tick → 1Hz で trkpt 保存 → at_goal? 検出 → Ride.finish! → status=finished, finished_at セット, RideTrkpt 5 件保存。 (b) **中断経路 spec**: 60m まで進めて手動 finish → status=finished, atGoal=false, RideTrkpt 1-2 件で凍結。 (c) **再開不可性 spec**: finished ride に対する tick 呼びが ArgumentError or 状態遷移エラー (= 完走後 zombie tick の物理 deny)。 (d) **二重 ride 起動防止 spec**: active ride がある状態で `Ride.create!(status: :active)` が validation error。

## 必須 test list (= 統合)

下記 7 spec で 50-60 examples、 質的 gate (= happy / error / edge の 3 種を必須カバー、 misleading / tautological 禁止) で運用。 spec ファイル名は r-05-test-baseline.md の規範 (= `spec/<layer>/<name>_spec.rb`) に従う。

- **`spec/domain/bike_physics_spec.rb`** (= 11 examples、 bike_physics.test.js と 1:1 対応): applyPhysicsStep の各項 (= propulsion / gravity / rolling / drag) 単独効果 + dt<=0 / power=0 / 下り加速 / 上り減速 / max_v クランプ / v_min クランプ / 不正 input 安全性。
- **`spec/domain/rider_spec.rb`** (= 15-20 examples、 rider.test.js のうち Ruby PORO に移送可能な部分): tick 進行 / paused 中 no-op / speedMultiplier / atGoal クランプ / placeAtIdx / placeAtDistance / setSpeed / setSensors / spinAngle 進行 / seek_toward 前進 / seek_toward 後退 / seek_toward paused / reset / start clears trkpts / position immutability。 ※「trkpts を Rider 内部で持つ」 か「ActiveRecord RideTrkpt として外出しする」 かは r-20-rider-model.md 側の決定事項。 本 audit は SoT 集約 (= T1) を優先するため、 Rider PORO 内ではなく Ride AR 経由で trkpt 保存する設計を推奨 (= rider_spec から trkpts test は削減)。
- **`spec/domain/terrain_spec.rb`** (= 10 examples、 terrain.js を Ruby PORO に移送): get_position_at_distance の補間 / heading 北東南西 / 範囲外 clamp / 空 course の 0 fallback / bounds 計算 / idx_at_distance / distance_at_idx / get_point_at_idx / get_sections / immutability。
- **`spec/models/ride_spec.rb`** (= 8-10 examples): valid? / status enum / `has_many :ride_trkpts, dependent: :destroy` / `finish!` 一度限り / `finish!` race / 集計 method (= total_distance_m / duration_s / avg_speed_mps) / scope (= active / finished)。
- **`spec/models/ride_trkpt_spec.rb`** (= 5 examples): valid? / lat lon ele 範囲 validation / ride との関連 / `default_scope { order(:t) }` 順序 / `create_from_rider(rider)` factory method の lat/lon 取得元が rider.position である確認。
- **`spec/integration/ride_completion_spec.rb`** (= 4 scenarios、 = T2 + T4 防御): T4 (a)(b)(c)(d) を encode。 完走 / 中断 / 再開不可 / 二重 ride 防止。 integration_ride_completion.test.js の Ruby 拡張版。
- **`spec/integration/ride_trkpt_continuity_spec.rb`** (= 3 scenarios、 = T1 防御、 **必須**): (1) **0km lat 固定 reg**: Rider を 1m/s で 50 秒分 tick + 1Hz で trkpt 保存 → lat unique 数 > 5 + 末尾 lat > 起点 lat。 (2) **位置取得経路 SoT 確認**: RideTrkpt.create_from_rider が rider.position から lat/lon を取得していることを確認 (= rider.position.lat を mock で書き換えると RideTrkpt.lat も追従)。 (3) **二重 SoT 排除確認**: Ride model に `last_lat` / `last_lon` / `last_distance_m` 列が存在しないことを `Ride.column_names` で物理 verify (= schema 規律を spec で pin)。 trkpt_lat_after_rider_tick.test.js の Ruby 拡張版。

## 受け入れ条件

- 上記 7 spec が全 green (= `bundle exec rspec spec/domain spec/models spec/integration`)
- 0km lat 固定 reg test (= ride_trkpt_continuity_spec.rb scenario 1) が通る
- 完走 integration test (= ride_completion_spec.rb 4 scenarios) が通る
- shim 不在の物理 gate (= `grep -r "class RideState" app/` が 0 件)
- 二重 SoT 不在の物理 gate (= `Ride.column_names` に `last_lat` / `last_lon` / `last_distance_m` が含まれない)
- 質的 gate 適用 (= r-05 baseline の happy / error / edge + misleading 禁止) で各 spec を audit

## 参照

- 直前 commit 群: de57ce1 (= 0km lat 固定 fix)、 00fa2d7 (= 完走 auto-end 追加)、 f90c265 (= viewer rewire)
- `~/.agents/scratch/fujihc-trainer-project/briefs/rails-migration/r-05-test-baseline.md` (= 質的 gate と test framework baseline)
- `~/.agents/scratch/fujihc-trainer-project/briefs/rails-migration/r-03-aggregate-map.md` (= Terrain ⊃ Rider 階層、 Ride AR の責務範囲)
- `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` 共通 pattern 1 + 4 (= マジックナンバー無根拠 / test 規律の不在)
- `web/lib/rider.js` / `web/lib/terrain.js` / `web/lib/ride_state.js` (= 移植元)
- `web/tests/trkpt_lat_after_rider_tick.test.js` / `web/tests/integration_ride_completion.test.js` (= reg test 起源)
