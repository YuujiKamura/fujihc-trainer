# ブリーフ: Rider 移動モデルの作り直し ── 位置を「速度×時間で動く実点」にする

## はじめに

富士ヒル viewer の走行記録が壊れている。保存記録の距離欄は 52m なのに、記録された緯度経度を端からつないだ実際の道のりは 15.7m しかない（3.3倍の食い違い）。test モードを目視しても、等速入力なのにライダーの動きが鈍く・速くなる。Strava は位置から地図と距離を作るので、上げると記録が縮む。

この食い違いは「移動モデルの機序が間違っている」ことの症状。本ブリーフはその中核モデルを作り直す**単一タスク**。担当 worker はこれ1件を「読む → 7軸レビュー → ブリーフ改訂 → 実装 → 検証 → ローカルコミット」まで通す。push・PR・外部操作は一切しない。

（本ブリーフは 7軸 audit 後の改訂版。audit で 6 軸 LOAD-BEARING NG が出た ── 用語定義の欠落・`## 参照`欠落・既存テストの壊れ方の未記述・viewer 側の二経路不一致・autosave 互換境界の未記述・プライバシー境界節の欠落。下記はそれらを反映済。）

## 用語

距離・位置の語が滑ると「一次/二次の取り違え」が再発するので、本ブリーフは下記の語だけを使う。

- **移動量** ── 1 tick で進む量。`速度 × speedMult × dt`、単位は実メートル。
- **センターライン** ── course の緯度経度ポリライン。N 点なら N-1 本の**セグメント**を持つ。
- **位置** ── センターライン上の一点。実装表現は `(segmentIdx, fracInSegment)`（セグメント番号 0..N-2、セグメント内進捗 0..1）。緯度経度はここから導出する一次情報。
- **セグメント長** ── 隣接 2 点の haversine 実距離（実メートル）。`distance_m` フィールドからは取らない。
- **`distanceTraveled`** ── 位置から導出した haversine 累積長。`累積セグメント長[segmentIdx] + fracInSegment × セグメント長[segmentIdx]`。保持する state ではなく、位置の getter。
- **旧 `distance_m`** ── course.json の `distance_m` フィールド。**移動計算では一切信用しない・使わない**。`smoothCourse` を通ると lat/lon とずれる壊れた距離目盛り（後述）。

コード識別子との対応（実装時はこの名前を使い、新規造語をするな）:

| ブリーフ用語 | コード識別子 |
|---|---|
| 位置のセグメント番号 / 進捗 | `segmentIdx` / `fracInSegment`（既存 `terrain.getPositionAtDistance` 戻り値の field 名） |
| haversine 累積長を idx で引く | `terrain.distanceAtIdx(idx)` |
| 距離から idx を引く | `terrain.idxAtDistance(d)` |
| 距離 / idx へのジャンプ配置 | `rider.placeAtDistance(d)` / `rider.placeAtIdx(idx)` |
| course の距離フィールド | `distance_m`（course.json、snake_case のまま） |

## 参照

- `web/lib/gpx_smooth.js` ── `smoothCourse` の実装。root-cause の現場（後述）。
- `web/lib/terrain.js` / `web/lib/rider.js` / `web/lib/ride_state.js` ── 変更対象。現行 SoT。
- `web/lib/heading.js` ── `computeTravelHeading`。進行方位の委譲先、二重実装するな。
- `e2e/user_journey.spec.js` ── 受け入れジャーニーテスト「一定の力で漕ぐと記録速度はなめらか」。
- Haversine 公式（緯度経度間の距離・方位の標準リファレンス）: https://www.movable-type.co.uk/scripts/latlong.html
- Vitest `toBeCloseTo`（haversine 由来の非整数期待値に使う）: https://vitest.dev/api/expect.html
- Playwright assertions: https://playwright.dev/docs/test-assertions

## 背景: なぜ壊れるか

今の rider:
- 「コースをどれだけ進んだか」を表す数値 `distanceTraveled` を1本持ち、毎フレーム `速度 × dt` で足す。
- 画面・記録に出す位置は `terrain.getPositionAtDistance(distanceTraveled)` ── その数値を「コースの距離目盛り `course[i].distance_m`」に引き当てて緯度経度へ変換した二次的な値。

一次情報は数値、位置は導出物。`distanceTraveled`（速度×時間の積分）は正しく 52m。だが位置への変換が距離目盛りを経由していて、その目盛りが本物のメートルとずれていれば、変換後の位置だけが嘘になる。一次と二次が食い違える ── これがバグの構造。

**root-cause は確認済（実コードと実測で特定）**:
- ディスク上の `web/course.json` は綺麗。`distance_m` が緯度経度の haversine と完全一致（全 1968 点、全長 23988m）。
- `loadCourse()`（viewer-maplibre.js:1676）が `course = smoothCourse(course)` を呼ぶ。`smoothCourse`（gpx_smooth.js）は lat/lon を window=5 の移動平均で平滑化するが、**`distance_m` を再計算しない**（関数 doc に「distance_m は不変」と明記）。
- 結果、メモリ内の course は「平滑化された lat/lon」と「平滑化前由来の `distance_m`」が同居する。実測: 全長は 23988m→23839m（0.6%減）で済むが、**先頭 62m が 18.63m に収縮（3.34倍、症状の「3.3倍」と一致）**。境界では移動平均窓が非対称に縮み、端点が内側へ強く引かれるため、コース先頭が激しく潰れる。
- `terrain.js` の `getPositionAtDistance` / `idxAtDistance` は綺麗（壊れた `distance_m` を距離目盛りとして忠実に使っているだけ）。`terrain_loader.js` はコースを変換しない（存在確認の fetch のみ）。
- → **緯度経度自体はメモリ内でも綺麗**（平滑化された有効なポリライン、NaN なし、単調）。汚れているのは「lat/lon と `distance_m` の対応」だけ。新モデルは `distance_m` を読まず lat/lon から haversine で距離を作り直すので、この食い違いは構造的に消える。

（root-cause を実装で潰す必要はない ── 新モデルが `distance_m` を読まなくなれば smoothCourse が再計算しようがしまいが無関係になる。worker は上記を report に追認するだけでよい。`smoothCourse` 自体は変更しない。）

## 直す機序（ユーザー指示 ── これが設計の核）

> 物体は座標空間の実点。毎フレーム速度×時間ぶんの実メートルだけ動く。コースは「次にどっちを向くか」だけを教える。位置の計算にコース内距離（距離目盛り）を含めるな。

依存の向きを反転させる。今は「距離 → 位置」。新モデルは「位置 → 距離」。`distanceTraveled` を保持 state にすると「距離 ⇄ 位置」の変換が 2 つの表現の間に挟まり、その変換が壊れうる（今がそれ）。位置 `(segmentIdx, fracInSegment)` を唯一の保持 state にし、`distanceTraveled` をその純関数の読み出しにすれば、距離は位置の別名にすぎず構造的に食い違えない。

## 新モデルの仕様

1. **一次情報は rider の位置**。センターライン上の一点として `(segmentIdx, fracInSegment)` で持つ（緯度経度はそこから導出）。

2. **tick(dt) は「センターラインに沿って 移動量 ぶん前進」**。移動量 = `速度 × speedMult × dt`。前進量を現セグメントの残り長（`セグメント長 × (1 - fracInSegment)`）から消費しながらポリラインを歩く。セグメントをまたぐ場合は残量を次セグメントへ繰り越す。末尾セグメント末端で停止（`segmentIdx = N-2`, `fracInSegment = 1`）。`speedMult`（速度倍率スライダー）は維持する。

3. **セグメント長は course の緯度経度から haversine で計算し直す**（本物のメートル）。terrain は構築時に `セグメント長[]`（N-1 要素）と `累積セグメント長[]`（N 要素、`累積[0]=0`）を一度だけ計算して保持する。`distance_m` フィールドは移動計算で信用しない・使わない。

4. **distanceTraveled は位置から導出する**。`累積セグメント長[segmentIdx] + fracInSegment × セグメント長[segmentIdx]`。位置から読み取る getter であって、位置を作る入力ではない。これで距離と位置は同一物の2つの言い方になり、構造的に食い違えない。

5. **コースの役割は「形（向き）」だけ**。進行方位 = 現在セグメントの接線（`computeTravelHeading` に委譲、二重実装しない）。距離目盛りは移動に使わない。

6. **placeAtDistance / placeAtIdx**（区間ジャンプ。観るモードの区間選択・ゴールテストの seekToNearGoal が使う）と **seekToward**（区間ジャンプのスムーズ移動）は残す。距離→位置の一発変換はしてよい ── ただし新しい haversine 累積長を使う（壊れた `distance_m` ではなく）。**per-tick の移動（tick の中）だけは絶対に距離から逆算しない**、ポリラインを歩く。

7. **terrain の距離スケールは haversine 累積長に一本化する**。`totalDistance` / `distanceAtIdx` / `idxAtDistance` / `getPositionAtDistance` をすべて `累積セグメント長[]` ベースで再実装する。`distance_m` フィールドを読む経路を terrain から消す。これにより viewer・rider・shim・minimap が同じ距離スケールを共有する（下記「やること」で各消費側を揃える）。

## 位置の補正 ── コースと地形に貼り付ける（ユーザー追記）

rider は水平にも垂直にもコース／地形に貼り付いていなければならない。

8. **水平 ── 位置は定義上コース上に固定**。位置は `(segmentIdx, fracInSegment)` で持ち、センターライン上の一点として定義上コースに乗る。自由な 2D 点（lat/lon を独立に積分する実点）として持つことは**禁止**、`(segmentIdx, fracInSegment)` 表現を必須とする ── これにより rider がコースから横にずれることが構造的に起きえない。仕様 1-2 がこれを満たす（再確認の項）。

9. **垂直 ── rider を地形サーフェスに乗せる**。現状 rider は空中に浮いている（実バグ）。rider の高さ（描画の Y）に course 保存の `elevation_m` を直接使うな ── **描画中の地形サーフェスの高さ**に rider を乗せる。まず「なぜ浮いているか」の原因を実コードで特定して report に書け（候補: course の `elevation_m`（フル解像度 DEM）と描画地形メッシュ（間引き面）の解像度不一致 ── catalog の `task-course-terrain-conform` でリボンの「埋まり」を直したのと同型 / 配置時の固定 offset / 別経路）。原因特定後、rider の Y を描画地形サーフェス（または既に地形に conform 済のコースリボン）の高さに合わせる。

## プライバシー境界

trkpt（ride 中の `{t, lat, lon, ele, power, cad, hr}` 時系列）は緯度経度・パワー・心拍を含む個人データ（Rule 11 class C2）。本修正は **trkpt の lat/lon の数値精度を直すだけ** ── 保存経路（IndexedDB 履歴 / GPX / Strava upload）・consent 判定・データクラス境界には一切手を入れない。trkpt が「どこへ・誰に」出るかは不変、変わるのは「記録される位置が実位置と一致するか」だけ。新たな外部 fetch も追加しない（course.json は既取得済データ、移動モデルはそれを読むのみ）。

## やること

1. **本ブリーフを 7軸レビュー（`multi-axis-draft-audit` skill）にかける**（済）。LOAD-BEARING 指摘を反映して本改訂版にした。drift catalog `~/.agents/state/fujihc-trainer/audit-drift-catalog.md` は audit subagent が必読済。
2. root-cause（`smoothCourse` が `distance_m` を再計算しない）は確認済（上記「背景」）。worker は実コードを読んで追認し report に書く。`smoothCourse` は変更しない。
3. **terrain.js** を haversine 実長でパラメータ化する。構築時に `セグメント長[]` / `累積セグメント長[]` を計算。`totalDistance` = `累積セグメント長[N-1]`。`(segmentIdx, fracInSegment)` → 位置を返す query を追加。`getPositionAtDistance` / `idxAtDistance` / `distanceAtIdx` を累積長ベースに再実装。
4. **rider.js** を `(segmentIdx, fracInSegment)` 保持モデルに作り直す。`tick` はポリラインを歩く（仕様 2）。`distanceTraveled` は getter（仕様 4）。`position` / `snapshot` / `placeAtDistance` / `placeAtIdx` / `seekToward` / `start` / `reset` / `atGoal` を新表現に合わせる。snapshot の field 構成（`distance` / `position` 等）は既存と同形に保ち、viewer の描画経路を壊さない。
5. **ride_state.js**（後方互換 shim）を新モデルに合わせる。shim の legacy `_idx` は `course[i].distance_m` 比較で更新していたが、新モデルでは haversine と不整合になる。`_idx` 機構は廃し、`snapshot().idx` / `getCurrentSlope` / `getHeading` は `rider.position`（= rider の実 `segmentIdx` から terrain query）に委譲する。`advance` / `seekToward` / `appendTrkpt` / `getTrkpts` の表面 API は維持。
6. **viewer-maplibre.js** を新モデルに合わせる:
   - `tick` の rider 呼び出し・`snap.distance`（`curDist`）はそのままで動くはず（snapshot 同形を保てば）。確認する。
   - **`totalDist` グローバル**（行 1694）を `course[course.length-1].distance_m` から `terrain.totalDistance` に切り替える。`distance_m` は smoothCourse 後も 23988m のまま、terrain の haversine 総長（約 23839m）と食い違う。`__goalTest.seekToNearGoal()`（行 2225）が `rider.placeAtDistance(totalDist - 15)` を使うので、`totalDist` が terrain 総長より大きいと placeAtDistance のクランプで rider がゴール手前 15m でなくゴール直上に置かれ、e2e ゴールテストの「最後の区間を実走させて到達」意図が崩れる。
   - **minimap**（`buildMinimapBottomBase` / `updateMinimap` 等、行 1900-2028 周辺）が `course[i].distance_m` を x 軸目盛りに、rider dot を `curDist / totalD` で配置している。x 軸を haversine 累積長（`terrain.distanceAtIdx(i)` / `terrain.totalDistance`）に揃え、`curDist`（haversine）と同じスケールにする。0.6% のズレだが「距離=位置の道のり」を minimap でも破らない。
7. このセッションの未コミット変更（下記）を取り込んだ上で、全テスト緑にしてローカルコミット。

**autosave / 既存保存データの互換境界**（report に明記、本タスクの実装対象外）: IndexedDB に保存済の autosave `distanceM` / ride 履歴 `summary.distance_m` は旧（壊れた）目盛り由来の値。新 `placeAtDistance` は haversine メートルとして解釈するため、旧 record を読み戻すと位置がずれる。ただし autosave 復元は `SKIP_RESTORE = true` で現状停止中（viewer-maplibre.js:1439、ユーザー指示「復元機能は未完成」）、ride 履歴は read-only 表示のみで `placeAtDistance` を通らない。よって本タスクで実害は出ない。復元機能を再有効化する将来セッションが、旧 autosave record の migration / 破棄を要する ── この互換境界を report の handoff に書け。本タスクで autosave/履歴のスキーマや保存経路は変更しない。

## このセッションの未コミット変更（取り込め、捨てるな）

作業ツリーに本件と同じ調査由来の未コミット変更がある。すべて意図的で本件の一部:
- `web/lib/ws_client.js`: fake trainer が trainer メッセージと心拍メッセージを交互に分けて送るよう変更（実機の複数デバイス構成を模す）。
- `web/tests/ws_client.test.js`: 上記の交互送信を固定するテスト追加。
- `e2e/user_journey.spec.js`: ジャーニーテスト「一定の力で漕ぐと記録速度はなめらか」追加。**現在は赤** ── 「位置の道のり ≒ 距離」を assert していて、これが本件の受け入れ判定そのもの。新モデルが正しく入れば緑になる。ジャーニーテストの閾値（`SPIKE_STEP_MPS` 等）は 0W 修正後の実測（巡航の秒間ステップ最大 0.11 m/s）で妥当。必要なら再較正してよいが **`pathLen ≒ distM` の判定は弱めるな**。

（注: 元ブリーフは「viewer-maplibre.js の sticky `currentPower` 修正」も未コミットと書いていたが、実際は既にコミット済 ── viewer-maplibre.js は git status で dirty ではない。report にそう書く。作業ツリーには本件と無関係な dirty file（`rails-app/*`・`web/inertia-sim.html`・`web/terrain3d.html`・`scripts/fix_gpx_lat.mjs`）もあるが、これらは本ブリーフのコミットに含めない ── 触るな。）

## 影響範囲 + 既存テストの壊れ方

変更ファイル: `web/lib/rider.js` / `web/lib/terrain.js` / `web/lib/ride_state.js` / `web/viewer-maplibre.js`。

**既存テスト fixture は新モデルで壊れる**。`buildNorthCourse` 等の fixture は `distance_m: i*111` のように geometry と無関係な値を書いているが、新モデルは `distance_m` を無視し lat/lon の haversine 実長を距離にする。lat ステップ 0.001° の haversine 実長は 111.19m（111 ではない）。よって `distance_m` ベースの exact assertion が軒並み壊れる。**壊れる既存テスト（名指し）**:
- `web/tests/terrain.test.js` ── `totalDistance === 9*111 === 999` の `toBe`、`distanceAtIdx` の exact 値、`idxAtDistance` の境界、経度 fixture の `i*91`。
- `web/tests/rider.test.js` ── `placeAtIdx`/`placeAtDistance` 後の `distanceTraveled` exact 値（333 / 250 / 555 等）、`tick` 後の距離・`segmentIdx`。
- `web/tests/ride_state.test.js` / `ride_state_seek_toward.test.js` / `ride_state_trkpts.test.js` ── `snapshot().distance` / `.idx` の exact 値。
- `web/tests/viewer_motion_audit.test.js` / `trkpt_lat_after_rider_tick.test.js` ── `distance_m` を geometry と別値で書いた fixture を持つ。
- integration 系（`integration_ride_completion` / `integration_ride_start_drives_rider` / `viewer_physics_drive` 等）── 壊れたら同様に直す。

**修正方針**: fixture を self-consistent にする（= `distance_m` を lat/lon の haversine 累積から計算するヘルパを 1 つ書き、全 fixture をそれで組む）か、exact assertion を haversine 由来の期待値 / `toBeCloseTo` に移す。どちらでもよいが **「距離 = 位置の道のり」の不変条件を弱める直し方は禁止**（assertion を消す・`toBeGreaterThan(0)` だけにする等は不可）。「正しく直してよい」で済ませず、壊れた assertion を 1 件ずつ新モデルの正しい期待値に置き換える。

**misleading test の罠（避けよ）**: trkpt の観測は `rideState.getTrkpts()` を読め、`rider.getTrkpts()` ではない。shim（ride_state.js:41）は Rider 内部とは別の独自 trkpts buffer を持ち、viewer の tick は `rideState.appendTrkpt` 経由でそちらに貯める。観測フックや test が `rider.getTrkpts()` を読むと実走しても 0 のまま緑になる。`viewer-maplibre.js` の module-scoped 関数（`loadCourse` / `tick` / `curDist`）は unit test 不能 ── 振る舞いは e2e/user_journey.spec.js（既存ジャーニーテスト）で behavioral に pin される、新たな e2e は受け入れジャーニーテストが緑になれば足りる。

## 検証（受け入れ条件 ── Rule 1）

触ったモジュールの全種類のテストを実走し、passed/failed 数を report に明記する:
- `npm test`（vitest、web/tests/）── 全緑。
- `npm run test:e2e`（Playwright）── 全緑。**特に `e2e/user_journey.spec.js` の「一定の力で漕ぐと記録速度はなめらか」が緑**（今は赤、これが本丸）。
- `python -m pytest` ── 全緑。
- `ai-code-review` を回し、NG なら自力修正（最大3回ループ）。
- 目視: test モード（`?test=1`）で実際に走らせ、(a) 等速入力でライダーの動きが等速に見えること（「鈍く・速く」の症状が消えたことを画面で確認）、(b) **rider が地形に乗っていること（浮かず・めり込まず）**。スクショを撮り Read で開いて目で見る。期待 state（走行中の 3D ビュー + HUD に距離が滑らかに増える + rider が路面に接地）を先に言語化し、画面との食い違いを批評する。

## 全関数テスト義務

変更した module の全 public / private 関数に test 必須。未 test 関数を残して commit するな。rider.js / terrain.js の移動計算は特に happy / edge（セグメント境界・ゴール到達・dt=0・速度0・空 course・単一点 course）/ error path を揃えること。

## 完了報告先

`~/.agents/scratch/fujihc-trainer-project/report-rider-position-model.md` に書け: コミットハッシュ / 各テストの passed-failed 数 / `loadCourse` root-cause の追認結果 / autosave 互換境界 / ハマった所 / 7軸 audit の verdict と改訂内容 / skill firing log。

## handoff

中断・完了どちらでも `~/.agents/scratch/fujihc-trainer-project/handoff-rider-position-model.md` を書け。次に拾うセッションが本ブリーフを読まずに再開できる粒度で: 何が done / 未着手か、再開の起点（直近コミットハッシュ・起動コマンド）、既知の罠（autosave 互換境界を含む）、main セッションが知るべき決定・仮定。

## まとめ

完了 = ジャーニーテスト「一定の力で漕ぐと記録速度はなめらか」が緑 + vitest / e2e / pytest 全緑 + ai-code-review 通過 + 目視で等速。守る一線は1つ ── **移動量は速度×時間の実メートル、位置はそれを積分した実点、距離は位置から読み取る、コースは向きだけを供給**。距離と位置が二度と食い違わない構造にする。terrain・rider・shim・viewer・minimap が同じ haversine 距離スケールを共有する。

- ship する: 上記の未コミット変更（ws_client.js / ws_client.test.js / user_journey.spec.js）+ 新モデル（rider.js / terrain.js / ride_state.js / viewer-maplibre.js + テスト）を、論理的なまとまりでローカルコミット。
- ship しない: push / PR / 外部操作（一切禁止、user の明示指示が無い限り）。本件と無関係な dirty file（rails-app 等）もコミットに含めない。
