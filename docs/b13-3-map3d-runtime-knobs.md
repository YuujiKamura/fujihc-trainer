# b13-3: map3d の実行時調整 差し替え口

- シリーズ: b13
- 依存: b13-2 (TerrainSurface / ROAD_OFFSET_M)。b13-4 が本ブリーフに依存。
- 状態: draft v2 (Round 1 7軸 audit 反映済)

## 目的

ライダー寸法・コース幅・路面高さ・ラベル高さを viewer 起動後に変えられるよう、map3d ファサード (`web/lib/map3d/index.js`) に差し替え口メソッドを足す。

## なぜ

これらの数値を AI が決め打ちして実画面で外してきた。スライダー化してユーザーが画面を見ながら詰める (b13-4)。差し替え口が無いとスライダーの繋ぎ先が無い。

## 現状

- map3d/index.js は差し替え口 setLabelScale / setSunlightDirection / setSunlightStrength ほか **15メソッド**を持つ。
- map3d_index.test.js L12-20 が `CONTRACT_METHODS` 15個を定義、L30-34 の it が `expect(fnKeys.sort()).toEqual([...CONTRACT_METHODS].sort())` で「15個ちょうど」を exact match で pin。
- ライダー寸法: `rider3d.group.scale.setScalar(3.6)` (L409、固定)
- コース幅: `createCourseRibbon(..., {widthM:10, ...})` (L388、ジオメトリ生成時の固定値)
- 路面高さ: `drapeOffset` (L388。b13-2 で ROAD_OFFSET_M に置換)
- ラベル高さ: labels3d.js `LABEL_BASE_HEIGHT_M = 4` (固定)
- `ribbonPositions` = `ribbon3d.mesh.geometry.getAttribute('position').array` (L390)。ライダーは `rider3d.updatePose(ribbonPositions, ...)` でこの配列を直読みして位置を決める (L413, L434)。
- pending (L132): `{ camZoom, camPitch, sunDir, sunStrength, labelScale }` ── boot/renderCourse 前に呼ばれた set 値を保留し部品生成時に流し込む。
- viewer-map3d.js は `map3d/index.js` の `createMapRenderer` のみ import (L7)。**map_renderer.js は現行 viewer から import されておらず未使用。**

## 変更 — map3d/index.js に差し替え口を追加

### setRiderScale(scale)
`rider3d.group.scale.setScalar(scale)`。実行時に即反映。

### setRoadHeight(offsetM) — ライダー追従する設計 (決め切り)
**mesh.position.y シフトは不可** ── ライダーは `ribbonPositions` 配列を直読みするので、mesh の position を動かしても配列は変わらずライダーが取り残される。代わりに:
1. `ribbonPositions` 配列の全頂点 Y (`ribbonPositions[i*3+1]`) に `offsetM - 現在のオフセット` の差分を一律加算。
2. `ribbon3d.mesh.geometry.attributes.position.needsUpdate = true`。
3. ライダーは次フレームの updatePose で更新後の配列を読むので自動追従。
4. ラベル (labels3d) とマーカー (markers3d) も同じ差分だけ Y シフトする ── labels3d / markers3d に Y シフト用メソッドを足す。
現在の路面オフセットを map3d 内に状態として保持し、差分計算に使う。

### setCourseWidth(widthM)
コース幅は頂点の左右振り幅そのもの → `buildCourseRibbon` を新しい widthM で再実行し、リボン geometry を作り直す。course 1968点で O(n)、数 ms。`ribbonPositions` 参照も張り替える。再生成後にライダー位置も updatePose で更新。

### setLabelHeight(heightM)
labels3d.js に `setLabelHeight(heightM)` を足し、全 sprite の scale と position を更新する。

### pending 機構
pending (L132) に `riderScale, courseWidth, roadHeight, labelHeight` を追加。地形未準備時に呼ばれた値を保留し、renderCourse の部品生成後に適用する (既存の sunDir/labelScale と同じ経路)。

### map3d_index.test.js
- `CONTRACT_METHODS` (L12-20) に新4メソッド名を追加 → 19個。
- map3d_index.test.js の「15」表記を3箇所すべて「19」に揃える: L22 describe「差し替え口15メソッド」/ L23 it「15個のメソッドが揃い」/ L30 it「(15個ちょうど)」。exact match テスト (L30-34) は CONTRACT_METHODS を19個にすれば assertion が通り、タイトル文言3箇所も実態と一致させる (放置すると misleading test 化)。
- 新4メソッドが boot 前に呼ばれても例外を投げないこと (pending 経路) を確認する it を1件追加。

## 注意 (= 決め切った仕様)

- terrain3d.js は無改造。
- **map_renderer.js は対象外** ── 現行 viewer (viewer-map3d.js L7) が import するのは map3d/index.js のみで、map_renderer.js は未使用。no-op スタブ追加は不要。
- setRoadHeight の初期オフセットは ROAD_OFFSET_M (b13-2、terrain_surface.js から import)。

## 検証

- `npm test`: map3d_index.test.js (19メソッド) / course_ribbon3d / rider_mesh3d / labels3d / markers3d のテスト。
- 新4メソッドの boot 前呼び出しが例外にならない回帰テストを map3d_index.test.js に追加。
- 画面検証は b13-4 (スライダー接続後) と合流。b13-3 単体では npm test を green にしてから b13-4 に渡す。

## Round 1 audit 反映

- setRoadHeight を「mesh.position.y シフト」→「ribbonPositions 配列の Y を一括加算」に修正、ライダー追従を担保 (rev-boundary / rev-migsec / 前回 reviewer、最重大指摘)。
- map3d_index.test.js の「15個ちょうど」exact match テスト (L30-34) の更新を明記、15→19 (rev-test / rev-boundary 指摘)。
- map_renderer.js を「reviewer 判断」→「対象外で確定」(実コードで viewer が import しないことを確認)。
- pending 機構への4項目追加を明記 (rev-boundary 指摘)。
