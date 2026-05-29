# 完了報告: Rider 移動モデルの作り直し ── 位置を「速度×時間で動く実点」にする

## はじめに

富士ヒル viewer の走行記録が壊れていた ── 距離欄 52m に対し記録緯度経度の実道のりは 15.7m（3.3倍の食い違い）。原因は移動モデルの機序の取り違えで、距離を主、位置をその二次変換にしていたため、変換に挟まった壊れた距離目盛りが位置だけを嘘にしていた。本タスクで移動モデルを「位置が主・距離は位置から読み取る派生値」へ作り直し、距離と位置が構造的に食い違わない形にした。あわせて 3D ビューの自機が浮いて見える問題（追記スコープ）の原因を特定し直した。

7軸 audit → ブリーフ改訂 → 実装 → 検証（vitest / e2e / pytest 全緑、受け入れジャーニーテスト緑、ai-code-review 通過、test モード目視）→ ローカルコミット まで通した。push・PR・外部操作はしていない。

## コミット

- ハッシュ: `b47cc14714544069ba22cc9c1213927c3ce824cd`
- メッセージ: `feat: rider 移動モデルを「位置が主・距離は派生値」に作り直す`
- ブランチ: `b11-phase5-tile-cache`（ローカルのみ、push なし）
- 19 ファイル変更（1054 insertions / 426 deletions、`web/tests/_helpers/course_fixture.js` 新規）
- 本件と無関係な dirty file（`rails-app/*` / `web/inertia-sim.html` / `web/terrain3d.html` / `scripts/fix_gpx_lat.mjs` / `test-results/`）はコミットに含めていない。

## 各テストの passed / failed 数

| テスト | 結果 |
|---|---|
| `npm test`（vitest、web/tests/ 86 ファイル） | **1357 passed / 0 failed** |
| `npm run test:e2e`（Playwright、e2e/ 5 ファイル） | **10 passed / 0 failed** |
| `python -m pytest` | **176 passed / 0 failed / 1 xfailed** |

受け入れジャーニーテスト `e2e/user_journey.spec.js`「一定の力で漕ぐと記録速度はなめらか」── **緑**。
診断ログ: `saved.distM=42.3m` に対し記録緯度経度の総道のり `pathLen=42.3m`（修正前は 52m vs 15.7m）。距離と位置が一致。巡航スパイク `0/22`、巡航の秒間ステップ最大 0.125 m/s。

## loadCourse root-cause の追認結果

ブリーフの推定どおり、root-cause は `loadCourse()` が呼ぶ `smoothCourse`（`web/lib/gpx_smooth.js`）だった。実コードと実測で確認:

- `smoothCourse` は GPS ジッタ除去のため lat/lon を window=5 の移動平均で平滑化するが、**`distance_m` を再計算しない**（関数 doc に「distance_m は不変」と明記）。
- 結果、メモリ内の course は「平滑化された lat/lon」と「平滑化前由来の `distance_m`」が同居する。
- 実測（`web/course.json` 全 1968 点を読み `smoothCourse` 適用後 haversine 比較）:
  - 全長: 23988m → 23839m（0.6% 減でほぼ無害）
  - **先頭 62m: 18.63m に収縮（3.34倍、症状の「3.3倍」と一致）**
- なぜ先頭だけ激しく潰れるか: 移動平均は境界（course 先頭/末尾）で窓が非対称に縮み、端点が窓内側の点へ強く引かれる。course 先頭の数点が中央へ寄せ集まり、先頭区間のポリライン長が崩壊する。
- → 緯度経度自体はメモリ内でも綺麗（平滑化された有効な単調ポリライン、NaN なし）。汚れているのは「lat/lon と `distance_m` の対応」だけ。

新モデルは `distance_m` を一切読まず lat/lon から haversine で距離を作り直すので、この食い違いは構造的に消える。`smoothCourse` は変更していない（新モデルが `distance_m` に依存しなくなれば、再計算の有無は無関係になる）。

## 3D 自機の「浮き」── 原因と対処（追記スコープ）

ユーザー追記の (B) 垂直の浮き補正について、3D 描画経路（`web/lib/map3d/`）を実コードで追った。

**原因（特定したもの）**: 自機の 3D 配置 `updateRider` → `riderPlacementAtDistance` に **再サンプリング起因の index 食い違い**があった。
- 2026-05-19 の commit `056259c`「コース点を再サンプリングして自機の接地精度を上げる」が、`renderCourse` で course を `resampleCourse(course, 8)`（8m 超区間を分割）してからリボンを組むようにした。リボン頂点配列 `ribbonPositions` は**再サンプリング後**の点数で組まれる。
- ところが `updateRider` は viewer から渡る**非再サンプリングの course**（curIdx もそれに対応）でリボン頂点を引いていた。点数が違う 2 つの列を混ぜたため、自機が別地点のリボン頂点に配置され、位置がずれる（登坂区間では引き当てた頂点の標高も食い違うため、上下にずれて見える）。
- 対処: `updateRider` がリボンと同じ `savedCourse`（= `renderCourse` が `resampleCourse` した列）でリボン頂点を引くよう 1 行修正（`web/lib/map3d/index.js`）。`distanceAlongCourse` だけは curIdx と同じ非再サンプリング course を使う。

**「elevation_m を使っている」かの確認**: 自機の Y（高さ）は `elevation_m` 由来ではない。リボンは `course_ribbon3d.js` の `conformRibbonToMesh` が各頂点 Y を**描画地形メッシュ表面** `sampleMeshHeight`（間引き面サンプラ）の高さに再計算済で、自機はそのリボン中心に乗る。つまり自機 Y は既に「描画中の地形サーフェスの高さ」由来で、`elevation_m`（フル解像度 DEM）由来の高さバグは存在しなかった。観測されていた「ずれ」は上記 index 食い違いによる配置ずれ。

**目視検証**: test モード（`?test=1`）で走行させ、走行距離 25m 地点・58m 地点の 2 フレームをスクショ → Read で目視。両フレームとも自機が道路リボンに接地（前後輪が路面に接し、接地点から影が伸びる正常な接地影）。浮き・めり込みなし。`rider-shot-1.png` / `rider-shot-2.png` / 拡大 crop（`crop-a.png` / `crop-2.png`）に保存。

## 等速性の目視検証

test モードで走行させ、HUD `#dist` を 1 秒おきにサンプル:
- 18 秒走行: `0 1 2 3 4 5 6 8 9 11 13 15 16 18 20 22 23 25`（漕ぎ出しから滑らかに加速し巡航へ）
- 40 秒走行: `... 50 52 54 56 58`（巡航中の秒間ステップは概ね 1〜2m、ギザギザの「鈍く・速く」症状なし）

物理は一定パワーで巡航するとコース勾配に応じてゆるやかに動くだけ。e2e のジャーニーテストも巡航スパイク 0 を緑で固定済。

## 新モデルの構造（実装したもの）

守った一線: **移動量は速度×時間の実メートル、位置はそれを積分した実点、距離は位置から読み取る、コースは向きだけを供給**。

- **`web/lib/terrain.js`**: 構築時に course の lat/lon から haversine でセグメント長 `_segLen[]` と累積長 `_cumLen[]` を 1 度計算。`totalDistance` / `distanceAtIdx` / `idxAtDistance` / `getPositionAtDistance` をすべて累積長ベースに。位置 `(segmentIdx, fracInSegment)` ⇄ 距離 ⇄ lat/lon を相互変換する `getPositionAt` / `distanceAt` / `locate` / `segmentLength` を追加。`haversineMeters` を export。`distance_m` フィールドを読む経路を terrain から削除。
- **`web/lib/rider.js`**: 一次 state を位置 `(segIdx, segFrac)` に。`tick(dt)` はセンターラインを「速度×speedMult×dt の実メートル」ぶん歩く（セグメント長を消費しながらポリラインを walk、距離からの逆算ゼロ）。`distanceTraveled` は `terrain.distanceAt(segIdx, segFrac)` の getter（保持しない）。`placeAtDistance` / `placeAtIdx` / `seekToward` はジャンプ系として距離→位置の一発変換を許容。
- **`web/lib/ride_state.js`**: 後方互換 shim。legacy `_idx`（`distance_m` 比較で更新していた）機構を廃し、`snapshot().idx` / `getCurrentSlope` / `getHeading` を `rider.position`（rider の実 segmentIdx → terrain query）に委譲。
- **`web/viewer-map3d.js`**: `totalDist` を `course[last].distance_m` から `terrain.totalDistance` に切替（`__goalTest.seekToNearGoal` が正しいゴール手前を取れる）。minimap の標高プロファイル x 軸を `distance_m` から `terrain.distanceAtIdx(i)` / `terrain.totalDistance` に揃え、自機 dot と同一の haversine 距離スケールに統一。
- **`web/lib/map3d/index.js`**: 上記の自機 index 食い違い修正。

## ハマった所

- **既存テスト fixture が新モデルで全滅**: `buildNorthCourse` 等の fixture は `distance_m: i*111` のように幾何と無関係な値を持っていた。新モデルは `distance_m` を無視し lat/lon の haversine 実長（0.001° ≒ 111.2m）を距離にするため、`totalDistance===999` 等の exact assertion が軒並み壊れた。対処: `web/tests/_helpers/course_fixture.js` を新設（`withCumulativeDistance` で distance_m を haversine 累積で自己整合に埋める／`DEG_LAT_PER_M` で 1m スケール fixture を組む）。terrain / rider / ride_state×3 / viewer_motion_audit / restore_autosave_apply / trkpt_lat_after_rider_tick / integration×2 の 11 テストファイルを新モデルの正しい期待値（haversine 由来 / `toBeCloseTo`）に直した。「距離 = 位置の道のり」の不変条件は弱めていない。
- **1m スケール fixture の境界で float 揺れ**: `seekToward(7)` の idx を整数距離 7（セグメント境界）で assert すると、`35 + i*DEG_LAT_PER_M` の float 誤差で idx が 6/7 どちらにもなった。区間内部の値（7.5）で assert するよう直した。
- **ai-code-review round 1 NG 1 件（実欠陥、修正済）**: minimap の `totalD` を null チェックしつつループ内で `terrain.distanceAtIdx` を無防備に呼んでいた。`buildMinimapBottomBase` 冒頭で `!terrain || terrain.totalDistance === 0` を早期 return に追加して解消。
- **ai-code-review round 2 NG 1 件（誤検出、不修正）**: `loadCourse` の `totalDist = terrain.totalDistance` に存在チェックが無いと指摘されたが、`terrain` は同 14 行上で `terrain = createTerrain({course})` により同期的に代入済、間に `await` も early-return も無く必ず set される。reviewer は diff hunk しか見ず上の代入を見落とした誤検出（drift catalog の D3 誤検出と同類）。防御的 cruft を足さず誤検出として記録した。

## autosave 互換境界（実装対象外、handoff へ申し送り）

IndexedDB 保存済の autosave `distanceM` / ride 履歴 `summary.distance_m` は旧（壊れた）目盛り由来。新 `placeAtDistance` は haversine メートルとして解釈するため旧 record を読み戻すと位置がずれる。ただし autosave 復元は `SKIP_RESTORE = true` で停止中、ride 履歴は read-only 表示のみで `placeAtDistance` を通らないため本タスクで実害は出ない。復元機能を再有効化する将来セッションが旧 record の migration / 破棄を要する（handoff に記載）。本タスクで autosave / 履歴のスキーマ・保存経路は変更していない。

## 7軸 audit の verdict と改訂内容

`multi-axis-draft-audit` skill で 7 軸並列 audit（general-purpose subagent ×7）。drift catalog 必読。

| 軸 | verdict |
|---|---|
| 1 register/構造 | NG (LOAD-BEARING) ── `## 参照` 節欠落（NG-R5-11 が直近 6+ ブリーフ連続再演） |
| 2 語彙の規律 | NG (LOAD-BEARING) ── 距離系/位置系の語が qualifier なく散在、コード識別子への橋渡しなし |
| 3 抽象段差 | OK ── root-cause を「容疑/突き止めろ」と扱い NG-RG-8 の是正構造、閾値に実測根拠あり |
| 4 テスト網羅性 | NG (LOAD-BEARING) ── 既存テストの壊れ方を file 名で名指しせず「正しく直してよい」止まり、misleading test 罠の無言及 |
| 5 設計境界 | NG (LOAD-BEARING) ── totalDist / minimap / shim `_idx` の二経路不一致 |
| 6 マイグレ可逆性 | NG (LOAD-BEARING) ── 保存済 autosave `distanceM` の互換境界が無言及 |
| 7 セキュリティ境界 | NG (LOAD-BEARING) ── プライバシー境界節欠落（trkpt = 個人データ） |

判定: LOAD-BEARING 6 件 → REDRAFT 必須。ブリーフを改訂版に全面書き換え:
- `## 用語` 節を新設（距離系 3 語に確定、位置を `(segmentIdx, fracInSegment)` に固定、コード識別子へ写像）
- `## 参照` 節を新設（haversine 公式 / Vitest / Playwright の実 URL）
- `## プライバシー境界` 節を新設（本修正は trkpt の数値精度のみ直し、保存経路・consent には触れない旨を明示）
- 「やること」に totalDist / minimap / shim `_idx` の具体修正を追記
- 「影響範囲」に壊れる既存テストを file 名で列挙 + 修正方針 + misleading test 罠を明記
- autosave 互換境界の申し送りを追記
（実装中にユーザー追記で 3D 垂直の浮き補正がスコープに加わり、`## 位置の補正` 節と目視検証項目を追加。）

## skill firing log

- `superpowers:using-superpowers` ── session 開始時に SessionStart hook で投入。
- `multi-axis-draft-audit` ── ブリーフの 7軸 audit（task 1）。general-purpose subagent ×7 を並列起動。
- `ai-code-review` ── 実装後の self-review。`~/ai-code-review/target/release/review.exe --diff` で diff をレビュー。round 1 で実欠陥 1 件 → 修正 → round 2 再レビューは誤検出 1 件のみ（不修正、上記「ハマった所」参照）。

## まとめ

距離と位置が二度と食い違わない構造にした ── 移動量は速度×時間の実メートル、位置は `(segmentIdx, fracInSegment)` の実点、距離はそこから読み取る派生値、コースは haversine セグメント長と向きだけを供給。terrain・rider・shim・viewer・minimap が同じ haversine 距離スケールを共有する。受け入れジャーニーテストが緑（記録距離 ≒ 記録緯度経度の道のり）、vitest 1357 / e2e 10 / pytest 176+1xfail 全緑、ai-code-review 通過、test モード目視で等速移動・地形接地を確認。
