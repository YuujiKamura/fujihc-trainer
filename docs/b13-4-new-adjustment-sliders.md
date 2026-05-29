# b13-4: 新規調整スライダー4種を control_panel 定義に追加

- シリーズ: b13
- 依存: b13-1 (control_panel 統合・CONTROL_DEFS) と b13-3 (map3d 差し替え口) の両方が完了していること。
- 状態: draft v2 (Round 1 7軸 audit 反映済)

## 目的

ライダー寸法・コース幅・路面高さ・ラベル高さの4スライダーを `CONTROL_DEFS` に足し、b13-3 の差し替え口に繋ぐ。ユーザーが画面を見ながら「コースが浮く」「ラベルが埋まる」を回して直せるようにする。

## なぜ

b13-2 で高さの仕組み (TerrainSurface / ROAD_OFFSET_M) を整え、b13-3 で実行時に変える口を作った。最後にそれをスライダーに出す。AI が暫定値を決め打ちで終わらせず、ユーザーが現物で詰める。

## 現状

- b13-1 完了後: viewer-map3d.js に `CONTROL_DEFS` (9項目) と `mountControlPanel` 呼び出し。
- b13-3 完了後: map3d ファサードに setRiderScale / setCourseWidth / setRoadHeight / setLabelHeight。
- 現行の固定値: ライダー scale 3.6 / コース幅 10m / 路面高さ ROAD_OFFSET_M=2m / ラベル高さ 4m。
- control_panel.js は input イベントで apply を呼ぶ (確定資産、変更しない)。

## 変更 — CONTROL_DEFS に4定義を追加

| key | min | max | step | value | unit | format | apply |
|---|---|---|---|---|---|---|---|
| riderScale | 10 | 80 | 5 | 36 | x | `(raw/10).toFixed(1)` | `mapRenderer.setRiderScale(raw/10)` |
| courseWidth | 4 | 40 | 2 | 10 | m | Math.round | `mapRenderer.setCourseWidth(raw)` |
| roadHeight | 0 | 30 | 1 | 2 | m | Math.round | `mapRenderer.setRoadHeight(raw)` |
| labelHeight | 1 | 20 | 1 | 4 | m | Math.round | `mapRenderer.setLabelHeight(raw)` |

- riderScale: ÷10 で 1.0〜8.0 倍。既定 36 = 現行 3.6 倍。
- roadHeight: 既定 2 = b13-2 の ROAD_OFFSET_M。スライダー 0〜30m でコース浮きを直す。
- courseWidth / labelHeight の既定は現行固定値と一致 (変更前後で見た目不変)。

## 注意 (= 決め切った仕様)

- **courseWidth は input イベントのまま** ── control_panel.js は変更しない。courseWidth の apply は b13-3 の setCourseWidth (buildCourseRibbon 再生成) を呼ぶが、course 1968点の再生成は O(n) で数 ms、スライダーをドラッグ中に毎フレーム再生成しても実用上問題ない。「change イベントにするため control_panel.js を拡張」案は採らない (確定資産を触らない)。
- 旧 viewer に riderScale/courseWidth/roadHeight/labelHeight の localStorage キーは存在しない → b13-1 の removeItem 対象外、新規に `fujihill.<key>` で保存される。

## 検証

- `npm test`: control_panel.test.js / map3d_index.test.js / 全件。
- 画面 (deskpilot): 機器設定パネルに13スライダー (既存9 + 新4) / roadHeight を下げるとコースが地形に密着する / labelHeight でラベルが路面脇の見える高さに来る / riderScale でライダーの大きさが変わる / courseWidth でコース幅が変わる。スライダー数の存在チェックで終わらせず、各スライダーを実際に動かして描画が変わることを目視する。

## Round 1 audit 反映

- courseWidth の change/input 問題を「reviewer 判断 (a)/(b)」→「input のまま確定 (control_panel.js を触らない)」と決め切り (全 reviewer 指摘、b13-1 の確定資産方針との矛盾を解消)。
- 検証を「13スライダーが出る」存在チェック→「各スライダーを動かして描画変化を目視」に修正 (NG-R5-14、rev-structure 指摘)。
