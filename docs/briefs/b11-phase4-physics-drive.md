# ブリーフ b11-Phase4 ── 物理駆動: rider をコースに沿って走らせる

## はじめに

Path B 移行 (b11) の Phase 4。terrain3d.html の rider の 3D 自転車 mesh は
Phase 3 でコース始点に静止配置済み。Phase 4 は、これを物理で前進させ、距離に
応じてコース道路に沿って走らせる。物理積分は検証済の純モジュール
`bike_physics.js` の `integratePhysics` をそのまま呼ぶ ── 物理を新規実装しない
(b3 で substep 積分が SoT 集約済)。ride モデルも b3/b35 で確立した
`terrain.js` / `rider.js` をそのまま使う。BLE 配線は Phase 7、ここはダミーの
固定パワーで前進を実証するまで。

## 現状 (読んだ結果)

- `bike_physics.js` の `integratePhysics(v, dt, power_w, slope_pct, opts)` →
  新速度。1/120 秒 substep で積分する物理の SoT。dt クランプは呼び出し側責務。
- `terrain.js` の `createTerrain({course})` → `getPositionAtDistance(d)` で
  距離 d の `slope_pct` 等を返す read-only query 層。
- `rider.js` の `createRider({terrain})` → `distanceTraveled` / `speed` を保持、
  `setSpeed(mps)` で速度入力、`tick(dt)` で `distanceTraveled += speed*dt`、
  `start()` で distance=0・active 化。生成直後は paused。
- viewer-maplibre.js の確立した配線:
  `physicsSpeedMps = integratePhysics(physicsSpeedMps, dt, power, slope);
   rider.setSpeed(physicsSpeedMps); rider.tick(dt);` ── これを踏襲する。
- terrain3d.html: Phase 3 で `riderStartPlacement(ribbon.positions, vertexCount)`
  で自転車を始点に静止配置。リボン頂点は course 点ごとに 2 頂点。
- `rider_placement.js`: `ribbonCenterAt` / `riderStartPlacement` (始点専用)。

## 用語 (この brief 内で固定)

- **physics 速度** ── `integratePhysics` が積分する rider の速度 (m/s)。実装上の
  変数名は `physicsSpeedMps` (= viewer-maplibre.js の既存変数名に揃える)。これを
  `rider.setSpeed()` に渡し、rider.js 内部の `speed` プロパティになる ── 「physics
  速度 → physicsSpeedMps → rider.setSpeed → rider.speed」は 1 本の経路で、語の
  揺れではなく層をまたぐ受け渡しの各段の名前。
- **走行距離 (distanceTraveled)** ── rider がコース始点から進んだ距離 (m)。
  rider.js の既存プロパティ名に揃える。
- **配置 (placement)** ── 自転車 mesh の位置 (position) と進行方向 (forward)。
  Phase 3 と同語。
- **勾配の参照先** ── ride 物理が使う勾配は `terrain.js`
  `getPositionAtDistance().slope_pct` (区間ステップ値) を SoT とする。Phase 2 で
  道路テクスチャに使った `road_texture.js slopeAtDistance` (線形補間) は別レイヤ
  (= 路面描画用) で、物理経路では使わない。後述 §1 で両者の役割を comment 上も
  分離する。

## やること

### 1. 純モジュール `web/lib/rider_placement.js` ── 始点専用を距離一般に拡張

Phase 3 の `riderStartPlacement` (始点 = 距離 0 専用) を、任意距離で配置を返す
`riderPlacementAtDistance` に一般化する (= 既にある物の拡張、新規モジュールを
増やさない)。`ribbonCenterAt` はそのまま。

- `riderPlacementAtDistance(positions, course, distanceM)` →
  `{position:[x,y,z], forward:[fx,0,fz]}`。
  - `distanceM` を `[0, course 総距離]` に clamp。
  - course の `distance_m` で `distanceM` を挟む 2 course 点 i / i+1 を線形 scan
    で特定 (= terrain.js idxAtDistance と同じ「distance_m ≤ d の最大 idx」)。
  - 区間内比 t で `ribbonCenterAt(positions, i)` と `ribbonCenterAt(positions,
    i+1)` を線形補間して position。
  - forward = `ribbonCenterAt(i+1) - ribbonCenterAt(i)` の XZ 正規化、Y=0
    (= 路面に水平)。区間が XZ で退化なら `[0,0,-1]` fallback。
  - course が 2 点未満は RangeError。
- `riderStartPlacement` は削除する。distance 0 は `riderPlacementAtDistance(...,
  0)` で表せ、Phase 3 の専用関数は一般版に吸収される (= 重複を残さない)。
  terrain3d.html の呼び出しと test を新関数に差し替える。
- course と positions の点数不整合 (= ribbon 点数 < course 点数) は
  `ribbonCenterAt` の RangeError で弾かれる (= 既存ガードを流用、新ガード不要)。

### 1b. `road_texture.js` のヘッダコメントを SoT スコープ修正

`road_texture.js` の `slopeAtDistance` はヘッダで「勾配値の唯一の SoT」と書いて
あるが、これは Phase 2 (道路テクスチャ) の文脈での話。Phase 4 で ride 物理は
`terrain.js` の勾配を使うため、この文言は全体では過剰主張になる。コメントを
「**道路テクスチャ描画用の**勾配 source (線形補間)。ride 物理が使う勾配は
terrain.js の getPositionAtDistance ── 別レイヤ」とスコープを明示する形に直す
(= コメントのみ、関数挙動は無改変)。これで 2 つの slope-at-distance 関数が
「テクスチャ描画用 (線形補間) / ride 物理用 (区間ステップ)」と役割分離され、
SoT の矛盾が解消する。

### 2. 描画・駆動 (terrain3d.html 内)

- `createTerrain({course})` と `createRider({terrain})` を生成 (course は既に
  fetch 済)。`rider.start()` で active 化 (= 始点 distance 0 から走行開始)。
- 固定パワー定数 `RIDE_POWER_W = 250` ── bike_physics の定常式
  (propulsion `P/v` = gravity + rolling + drag) を default 質量 88kg で解くと、
  250W は勾配 5% で定常 ≈4.8 m/s、7% で ≈3.7 m/s、10% で ≈2.8 m/s。富士ヒルの
  代表勾配域 (平均 5.2%、区間 5〜10%) で 10〜17 km/h ── 富士ヒル登坂の現実的
  速度かつ前進が実画面で明瞭に分かる踏力。BLE 実パワーは Phase 7 で
  `integratePhysics` の引数に差し替わる (= ループの形は不変)。
- アニメーションループ (既存 `loop()` を拡張):
  - `dt = (now - lastT)/1000` を `Math.min(dt, 0.1)` で cap (= animation frame
    駆動、inertia-sim.html と同じクランプ方針。bike_physics のコメント準拠)。
  - `slope = terrain.getPositionAtDistance(rider.distanceTraveled).slope_pct`。
  - `physicsSpeedMps = integratePhysics(physicsSpeedMps, dt, RIDE_POWER_W,
    slope)`、`rider.setSpeed(physicsSpeedMps)`、`rider.tick(dt)`。
  - `riderPlacementAtDistance(ribbon.positions, course, rider.distanceTraveled)`
    で自転車 mesh を再配置 (position + `lookAt(position+forward)`)。
- Phase 3 の静止配置コード (riderStartPlacement 呼び出し + position/lookAt) は
  ループ内の毎フレーム再配置に置き換える。自転車 mesh の組み立て (`buildBikeMesh`)
  とスケールは Phase 3 のまま。

### 3. テスト `web/tests/rider_placement.test.js`

`riderStartPlacement` 専用 test を `riderPlacementAtDistance` の test に書き換え、
happy/edge/error を「落ちたら何のバグか」を 1 行で言える形で網羅:

- `ribbonCenterAt`: 既存 test を維持。
- `riderPlacementAtDistance`: distance 0 → 始点リボン中心・始点→次点 forward
  (happy) / course 点ちょうどの距離 → その点のリボン中心 (happy) / 区間途中 →
  線形補間位置 (happy) / forward が単位ベクトル・Y=0 (edge) / distance 負 →
  始点へ clamp (edge) / distance 総距離超 → 終点へ clamp・最終区間 forward
  (edge) / 退化区間 → forward `[0,0,-1]` (edge) / course 2 点未満 → RangeError。

物理ループ (terrain3d.html) は `integratePhysics` (検証済) と `createRider` /
`createTerrain` (既存 test 済) の合成で新しい物理ロジックを持たないため、
node test 対象外 ── 前進挙動は実画面目視で検証する。

## 検証

- `npm test` (リポジトリ root の vitest) 全緑。`rider_placement` test 緑、
  既存 `bike_physics` / `terrain` / `rider` test を壊さない (= これらは無改変)。
- terrain3d.html を新規プロファイルの実 Chrome で開き desk_capture で目視 ──
  時間を空けて 2 回撮り、自転車が始点から距離に応じてコース道路に沿って前進し、
  進行方向を向き続けていることを批評 (verify-fujihc-screen の規律)。raw headless
  厳禁。
- MapLibre 版 (index.html 系) は触らない。
- Service Worker: terrain3d.html / lib/*.js は `.js`/`.html` で sw.js が
  network-first 配信 (`isAppShell`)、CACHE_NAME bump 不要 ── NG-R2-1 不発。

## 参照

- bike_physics.js (integratePhysics ── 物理 SoT、無改変で呼ぶ)
- terrain.js (createTerrain ── 距離→勾配 query)
- rider.js (createRider ── distanceTraveled / setSpeed / tick / start)
- Three.js Object3D.lookAt: https://threejs.org/docs/#api/en/core/Object3D.lookAt
- viewer-maplibre.js (integratePhysics → rider.setSpeed → rider.tick の確立配線)

## リスク

- **dt クランプ**: animation frame の dt はタブ非アクティブ等で大きく飛ぶ。
  `min(dt,0.1)` cap で 1 フレームの過大前進を防ぐ (bike_physics は floor を
  呼び出し側責務とし、frame 駆動側は cap のみ ── inertia-sim と同方針)。
- **固定パワー**: 250W は Phase 4 の前進実証用ダミー。実 trainer パワーは
  Phase 7 で `integratePhysics` の引数に差し替わる ── ループの形は変えずに済む。
- **終点到達**: rider.tick は `distanceTraveled` を総距離で clamp。終点で自転車は
  停止する (= 想定挙動、Phase 4 ではそれで良い)。

## 制約

- push 禁止、commit (worktree) は OK。MapLibre 版を壊さない・消さない。
- 物理を新規実装しない ── integratePhysics をそのまま呼ぶ。
- 調査メモ・本ブリーフは repo 外 (~/.agents/scratch/)。

## dispatch session への義務 (deck 経由実行用)

- **完了報告先**: 完了/中断したら `~/.agents/scratch/fujihc-trainer-project/b11-phase4-report.md`
  に書け ── 着手前 HEAD hash / 最終 commit hash / `npm test` の passed-failed-
  skipped 数 + exit code / desk_capture 2 回撮りで観た自転車の挙動の批評 (期待 =
  始点から距離に応じて前進し進行方向を向き続ける、と実画面の食い違いを具体的に) /
  ハマった所 / 発火した skill。
- **handoff**: 中断時は同ディレクトリに `b11-phase4-handoff.md` ── 次の session が
  本ブリーフを読まずに再開できる粒度で、done/未着手・再開起点 (commit hash・
  worktree path・terrain3d.html を実 Chrome で開く手順)・既知の罠を書け。
  dispatcher (main session) には idle 通知しか届かないので context は handoff
  ファイルに残すこと。
- **全関数テスト義務**: §3 の通り `riderPlacementAtDistance` は happy/edge/error
  全 path の node test 必須。物理ループ (terrain3d.html) のみ §3 記載の根拠で
  node test 免除 ── その代わり §検証 の実 Chrome 2 回撮り目視を必ず実施し、撮った
  だけで終わらせず Read tool で画像を開いて批評するところまでやれ。

## まとめ

Phase 4 = Phase 3 で始点に静止していた自転車を物理で走らせる。物理は
`integratePhysics` (検証済 SoT) をそのまま呼び、ride モデルは `createTerrain` /
`createRider` を再利用、配線は viewer-maplibre.js の確立パターンを踏襲する。
新規コードは (a) `riderStartPlacement` を距離一般の `riderPlacementAtDistance`
に拡張、(b) terrain3d.html のループに物理 step + 自転車再配置を足す、の 2 点のみ。
固定パワー 250W で前進を実証、BLE は Phase 7。検証は npm test 全緑 + 実 Chrome
2 回撮りで前進と向きを目視。
