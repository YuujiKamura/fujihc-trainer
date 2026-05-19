# b13-2: TerrainSurface で地形高さを一元化

- シリーズ: b13
- 依存: なし (独立して着手可)。b13-3 が本ブリーフの上に乗る。
- 状態: draft v2 (Round 1 7軸 audit 反映済)

## 目的

コースリボン・距離ラベル・起点終点マーカーの「地形からの高さ」がバラバラの定数で散らばっている。地表の標高を答える1クラス `TerrainSurface` に集約し、各オブジェクトを「地表からの相対オフセット」で配置する。

## なぜ

viewer 実画面でコースが地形から浮き、ラベルが地形に埋まる (user 指摘)。原因:
- コースリボン = 地形 + 持ち上げ量 **15m** (drapeOffset)
- 距離ラベル = 地形 + 持ち上げ量 **2m** (heightOffset)
13m の食い違いでラベルがリボンの板の下に潜る。「地形からの持ち上げ」が3ファイルに別定数で散らばっているのが根本原因。

## 現状

- terrain3d.js `buildCourseRibbon`: 頂点Y = `h*exaggeration + drapeOffset`、drapeOffset 既定15m (L334)。map3d/index.js renderCourse L388 が `drapeOffset:15` を渡す。
- terrain3d.js `buildTerrainGeometry`: 地形メッシュ頂点Y = `h*exaggeration` (L147)
- terrain3d.js `buildCoursePath`: drapeOffset 既定25m (L258)。**markers3d.js が import・使用** (起点終点マーカーの配置)。
- labels3d.js `labelWorldPositions` (L99-113): ラベルY = `demH + heightOffset`、heightOffset 既定 `LABEL_BASE_HEIGHT_M/2`=2m。**exaggeration を掛けていない** (= exaggeration≠1 でラベルだけズレる潜在バグ)。labels3d.js は独立モジュールで、配布元配慮の無改造規約の対象は terrain3d.js のみ。labels3d.js は変更してよい。
- ライダー: rider_mesh3d.js `updatePose` が `ribbonPositions` (リボン頂点配列) に乗る → リボンが正しければ自動で揃う。

## 変更

### 新規 `web/lib/map3d/terrain_surface.js`
**terrain3d.js は配布元配慮の無改造規約 → 1文字も触らない。** 新規クラスが terrain3d.js の export 純関数 (`sampleHeightBilinear` = L221 で export 確認済) を import して内部で使う。

- `class TerrainSurface`
  - `constructor({stitched, range, centerLat, centerLon, tileSize, exaggeration})`
  - `heightAt(lat, lon)` → `sampleHeightBilinear(stitched, range, lat, lon, tileSize) * exaggeration` (地表ワールドY)
  - `project(lat, lon)` → `{x, z}` (東+X / 北-Z、buildTerrainGeometry と同一投影。Yは含めない ── Y は heightAt が返す)
- `export const ROAD_OFFSET_M = 2;` を **この terrain_surface.js に置く** (= SoT 一箇所、b13-3/b13-4 はここから import)。
  - 根拠: 路面を地表に密着させつつ、同じ高さの2面が描画でチラつくのを防ぐための持ち上げ量。チラつき回避には数十cm〜数m あれば足り、15m は過大。2m はその範囲の初期値であって焼き込み定数ではない ── b13-4 でスライダー化し実画面で詰める。

### map3d/index.js renderCourse
- `createCourseRibbon` opts の `drapeOffset:15` を `drapeOffset: ROAD_OFFSET_M` に。buildCourseRibbon (terrain3d.js) は無改造、呼び出し側 opts を変えるだけ。

### labels3d.js (決め切り)
- `labelWorldPositions` を、地表標高に exaggeration を掛ける形に変える ── `geo.exaggeration` を受け取り `demH * exaggeration + heightOffset` を返す。これで exaggeration 抜けの潜在バグを潰す。TerrainSurface を labels3d に注入する案は採らない (依存が増えるだけ、labelWorldPositions は既に terrain3d.js の純関数を使う純関数なので geo に exaggeration を足すのが最小)。
- `createLabels3d` の呼び出し側 (map3d/index.js renderCourse L400-405) が渡す geo に `exaggeration` と、`heightOffset = ROAD_OFFSET_M + 看板高さ/2` を含める。ラベル下端を路面に合わせる。

### labels3d.test.js 改訂
- L166-170 の it「Y は DEM 標高 + heightOffset」の期待値 `1400 + LABEL_BASE_HEIGHT_M/2` を、新計算 `1400 * exaggeration + heightOffset` に合わせて改訂。fixture の geo に `exaggeration` を追加 (exaggeration=1 なら `1400 + heightOffset`)。heightOffset の既定が `ROAD_OFFSET_M + LABEL_BASE_HEIGHT_M/2` になるなら期待値もそれに揃える。

### markers3d.js
- buildCoursePath (drapeOffset 25m) を使う起点終点マーカーも、ROAD_OFFSET_M に統一する (`drapeOffset: ROAD_OFFSET_M` を渡す)。コースリボンと同じ地表基準に乗せる。

## 注意 (= 決め切った仕様)

- terrain3d.js は無改造 (terrain3d.test.js への影響ゼロ)。labels3d.js / markers3d.js / map3d/index.js は変更してよい。
- ROAD_OFFSET_M の置き場は terrain_surface.js の1箇所のみ (二重定義禁止、SoT)。

## 検証

- `npm test`: terrain3d.test.js が無改造で全通過 / 新規 terrain_surface.test.js / 改訂した labels3d.test.js / map3d_index.test.js / markers3d 系テスト。
- 新規 `web/tests/terrain_surface.test.js`: heightAt が `sampleHeightBilinear×exaggeration` を返すこと (exaggeration=1 と exaggeration≠1 の両方)、project の XZ 符号が terrain3d.js と一致すること。
- 画面 (deskpilot): コースリボンが地形に密着 / 距離ラベルが路面の脇に立って読める。

## Round 1 audit 反映

- labels3d.js の exaggeration 修正を「worker が設計」→「geo.exaggeration を受け取る」と決め切り (全 reviewer 指摘)。
- ROAD_OFFSET_M 置き場を「terrain_surface.js または専用小モジュール」→ terrain_surface.js 確定 (rev-boundary 指摘、NG-R3-3)。
- labels3d.test.js L169 の期待値改訂を明記 (rev-test 指摘)。
- markers3d.js の buildCoursePath (25m) も統一対象に追加 (rev-structure / 前回 reviewer 指摘)。
- ROAD_OFFSET_M 2m に根拠1行を追加 (NG-R1-1)。
