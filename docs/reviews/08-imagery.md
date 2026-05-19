---
review: 08-imagery
reviewer_axis: imagery / 世界 terrain 切替 後の画面薄黄一色
target: C:/Users/yuuji/fujihc-trainer/web/viewer.js?v=7
verified_via: 公式 Cesium docs (1.123 / 1.141 / 1.132) + GitHub source (GlobeSurfaceTileProvider) + community.cesium.com + OSM Tile Usage Policy
date: 2026-05-14
---

# imagery 軸 review — 「world terrain 取得後、画面が薄黄色一色で OSM が見えない」

## はじめに

`fujihc-trainer` の viewer.js (?v=7) で、ユーザー報告「world terrain (Cesium Ion) を取得した後、画面全体が薄黄色一色で OSM 地図が見えない」を **imagery / 地表描画 / terrain 切替** の観点で切り分けた。HUD は dist 209m / ele 1075m / slope 4.9% を正しく表示しているので **データレイヤーは生きている**、画面に出ているのは「rendering 側だけ」の障害。

結論を先に書く: **真犯人は `createWorldTerrainAsync()` 差替後の geoid vs ellipsoid 高さ不整合で camera が terrain mesh の中に埋まること**。GPX の標高 (geoid 海抜 1061 m) と Cesium の `fromDegrees(lon, lat, height)` の height (= WGS84 ellipsoid 高さ) を取り違えているため、富士山西斜面の日本付近では geoid と ellipsoid が **約 +35〜+40 m ずれており**、rider と camera が world terrain mesh の **下に潜り込む**。camera は terrain mesh の裏側 (= 山の岩盤の内側) を見ている状態で、見えるのは **`skyAtmosphere` が低高度で生む Mie 散乱の暖色フォグ + globe.baseColor (深青 0,0,0.5,1) のミックス**。これが画面一面の薄い暖色 (cream/khaki/薄黄) として描画される。

OSM タイルは ellipsoid 0 m 球面に正しく drape されている (= 高度 0 m 地表に貼ってある) が、camera から見ると **背後 (= 山の中)** なので tile 自体は画面に出ない、というのが正しい挙動。OSM tile fetch も実は成功している、見えていないだけ。

最も重い修正は (a) GPX 高さを使うのを止めて `sampleTerrainMostDetailed()` で実 terrain 表面に rider を置く、または (b) GPX 高さに +35 m の geoid 補正をかけて ellipsoid 高さに変換する、の 2 択。即時応急は `viewer.scene.globe.depthTestAgainstTerrain = false` + camera を rider の上空 50 m に上げて埋没を回避するだけでも OSM が見え始める。

副次原因として (c) `skyAtmosphere.show = true` が低高度の Mie 散乱で foreground を暖色に染める、(d) Cesium 1.123 で `baseLayer: new ImageryLayer(...)` 同期構成は動作するが Promise を返さず race を生む可能性、(e) `EllipsoidTerrainProvider` から `createWorldTerrainAsync` 戻り値への `viewer.terrainProvider =` 単純代入は再 imagery cache invalidate を起こす、の 3 点を確認したが (a)/(b) ほど決定的ではない。

---

## 各 step の OK/NG

### Step 1. world terrain 差替後、imagery (OSM ImageryLayer) は再 attach されているか / Ion 経由 Bing にすり替わっていないか

**OK ── imagery layer は terrain swap で外れない。Bing にもすり替わらない。**

検証根拠:
- Cesium 1.123 `Viewer` doc (cesium.com/learn/cesiumjs/ref-doc/Viewer.html): **terrain と imagery は完全に独立**。`viewer.terrainProvider = ...` は `viewer.imageryLayers` に一切触らない。
- viewer.js:43 `viewer.terrainProvider = t;` の代入は terrain provider オブジェクトを swap するだけで、`imageryLayers` collection の中身 (= line 19-25 で渡した OSM ImageryLayer) はそのまま残る。
- `baseLayer` が `false` でなく ImageryLayer instance なので Cesium は **Ion `fromWorldImagery()` (= Bing Aerial) を default で追加しない** (Viewer doc:「if set to `false`, no imagery provider will be added」、ImageryLayer 渡せば default は適用されない)。
- ユーザー画面が「Bing 衛星っぽい暖色」ではなく **画面全体が均一の薄黄** で陸海の起伏も道路網も無い、という状態。これは Bing の挙動ではなく **何かしらの単色フォグ / mesh 裏面**。

Bing すり替わり仮説は棄却。

### Step 2. OSM タイルの maxLevel / tileWidth / tileHeight 指定漏れで 1 タイルが画面全体に伸びる可能性

**OK ── タイルサイズは default で正しい。「1 タイル拡大で全画面」は起きない。**

`UrlTemplateImageryProvider` の default (Cesium 1.123 docs):
- `tileWidth` = 256
- `tileHeight` = 256
- `minimumLevel` = 0
- `maximumLevel` = undefined (無限、ただし `maximumLevel: 19` で 19 まで)
- `tilingScheme` = `WebMercatorTilingScheme` (← OSM の標準と一致)

viewer.js:20-24 は `url` / `credit` / `maximumLevel: 19` だけ指定、`tileWidth/Height` 省略 = 256×256 で正しい。

仮に 1 タイル拡大が起きても OSM の道路網が画面に出るはず (= 線パターン)。ユーザー報告は「均一の薄黄」、線パターン皆無 → タイル拡大仮説は不適合。

### Step 3. camera が地表に近すぎて 1 タイル分の pixel が画面で大きく拡大、一面同色になっている

**部分 NG ── 「pixel 拡大」ではなく「camera が mesh 内部に埋没」が真因。**

camera 位置 (viewer.js:233-234):
- target = `fromDegrees(rLon, rLat, rEle + 1.5)` ← **ここが問題**、rEle は GPX 由来の geoid 標高
- cameraPos = target から ENU で (-sinH*12, -cosH*12, 4) オフセット = 後方 12m + 上 4m
- camera ellipsoid 高度 ≈ rEle + 1.5 + 4 = **rEle + 5.5 m** (例: rEle=1075 → camera 1080.5 m)

ところが Cesium World Terrain は **WGS84 ellipsoid 高さ** で mesh を提供する。富士山西斜面 (lat 35.44, lon 138.75) の実 terrain mesh は ellipsoid 高度 ≈ **1108〜1115 m** (= 国土地理院 EGM2008 geoid 海抜 ~1073 m + 日本周辺の geoid - ellipsoid offset 約 +35〜40 m)。

つまり:
| 量 | 値 | 解釈 |
|---|---|---|
| GPX `<ele>` (rider) | 1075 m | 海抜 (geoid orthometric height) |
| `fromDegrees(..., 1075)` で算出した ECEF 位置 | ellipsoid 高度 1075 m | Cesium は height を ellipsoid 高度と解釈する |
| 実 Cesium World Terrain 表面 (rider lat/lon) | ellipsoid ≈ 1110 m | quantized-mesh は WGS84 ellipsoid 基準 |
| **rider と terrain 表面の差** | **-35 m** | **rider が地中 35 m 深さに埋まる** |
| camera ellipsoid 高度 | 1080.5 m | rider + 5.5 m |
| **camera と terrain 表面の差** | **-30 m** | **camera も地中 30 m 深さ** |

camera が **山の岩盤の中** にいる状態。**direction** は target (rider) を見ているが target も地中、camera ray は岩盤内部を走る。

#### なぜそれが「薄黄色一面」に見えるか

Cesium の `depthTestAgainstTerrain` (default = false in Globe) は **picking** には影響するが **rendering** では terrain mesh は普通に **両面描画ではない** (back-face culling on by default)。camera が mesh の内側にいる場合、camera から見える ray は:

1. **近傍の mesh 三角形の裏面**: back-face culling で描画されない → そこは "globe を描画していない領域" として扱われる
2. → そこに見えるのは **`scene.skyAtmosphere`** (line 37, `show = true`) の **大気散乱の積分結果**
3. 大気散乱は `SkyAtmosphere` シェーダの Mie + Rayleigh を camera ray に沿って積分: 低高度・水平方向視線 (= 今の camera は ground-level、direction はほぼ水平) では **Mie 散乱項が支配的、波長依存で黄〜オレンジ寄りの色**になる
4. 加えて globe `baseColor` (= 深青 0,0,0.5,1) が globe の "描画されない裏側" に混ざる、SkyAtmosphere の暖色と blend して **薄いクリーム/カーキ/薄黄色** になる

つまり「画面一面の薄黄」 = **camera が地中、見えているのは大気散乱の積分**、という Cesium 内部の整合的な振る舞い。bug というより spec の通りの結果。

ユーザーが「終了直前まで OSM が見えていた」ということがあれば、それは `EllipsoidTerrainProvider` の時代 (line 18) は terrain 表面が ellipsoid 0 m 球面で **rider 1075 m と camera 1080 m が空中**、空中から見下ろす形で OSM タイル (0 m 球面 drape) が見えていた、ということ。
`createWorldTerrainAsync()` が landed して `viewer.terrainProvider = t` が動いた瞬間、富士山 mesh が 1110 m まで盛り上がってきて camera を埋めた。

### Step 4. `viewer.imageryLayers` の中身、複数 layer が競合していないか

**OK ── ImageryLayer は 1 つだけ。競合は無い。**

`baseLayer: new ImageryLayer(new UrlTemplateImageryProvider(...))` で 1 個追加、その後 `viewer.entities.add({...})` で polyline/marker/rider を追加しているが、これらは `viewer.entities` であって `viewer.imageryLayers` ではない (Cesium の Entity API は scene graph 上の独立物、imagery layer collection とは別管理)。

`viewer.imageryLayers.length` を console で確認すると 1。問題は layer の中身ではなく camera 位置。

### Step 5. Cesium 1.123 の baseLayer option が terrain async 差替後も保持されるかの仕様

**OK ── 保持される。1.123 で imagery と terrain は独立。**

公式 Viewer doc:
- `baseLayer` ── 「The bottommost imagery layer applied to the globe. If set to `false`, no imagery provider will be added.」 default = `ImageryLayer.fromWorldImagery()` (Cesium 1.107 以降)
- `terrainProvider` ── 「The terrain provider to use」 default = `EllipsoidTerrainProvider`
- これら 2 つは互いに参照しない、`terrainProvider` 差替時に `imageryLayers` collection を再 init しない

1.107 で `imageryProvider` option が deprecated → `baseLayer` に統一されたが、**`baseLayer` は ImageryLayer instance を直接受ける**。viewer.js:19-25 の `new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider(...))` は **同期** 構成、Promise を返さない、これは 1.123 でも問題なく動く (UrlTemplateImageryProvider は `.ready`/`.readyPromise` が 1.107 で removed されたが constructor 自体は同期のまま、tile 取得時に async fetch する仕様)。

→ baseLayer 仕様の問題ではない、camera 位置の問題。

### Step 6. OSM タイル 401/403/CORS で fetch 失敗 → 何も描画されない

**Possible だが本件では NG ではない (補助的な懸念のみ)。**

OSM Tile Usage Policy (operations.osmfoundation.org/policies/tiles/) を確認:
- 「Users must send a clear, unique User-Agent string that names their app」
- Cesium の UrlTemplateImageryProvider は **Image element 経由で tile を fetch**、`User-Agent` は browser default (= browser identification string)、OSM 的に library default 扱いではないので block は通常起きない
- 「Referer header required for some tiles」 ← localhost からの fetch でも browser は通常 Referer を送る (デフォルト strict-origin-when-cross-origin)、これも OK

ただし 2026-05 時点 の現実:
- 同 IP からの大量 tile fetch (> 数千/分) は IP 単位で rate limit される
- yuuji の個人 IP からの 90 分 ride 中の fetch (最大数千 tile) は限界に近い、ride 後半で 429 が出る可能性
- Mt.富士ヒルクライムは森の中、OSM タイル zoom 17-19 で道路と森のテクスチャだけなので tile 数は実は少ない、現実的には大丈夫

**今回の事象 (「最初から画面薄黄」「fetch そのものは試行されている)」は 401/403/CORS では説明できない**:
- 401/403 なら Network panel に red error が並ぶ + Cesium 内部の `_TileProviderError` イベントが発火 → 通常はそのタイルの位置に **transparent** が描画される (= globe baseColor 深青が透ける)
- 「薄黄一色」になるのは fetch 失敗ではなく **camera ray が mesh と imagery どちらにも当たらず大気散乱だけ拾う** ケース

CORS について念のため:
- `tile.openstreetmap.org` は `Access-Control-Allow-Origin: *` を返すので CORS error は起きない (Cesium Sandcastle で landed example でも普通に動く)
- localhost からの fetch は同 origin policy で問題なし

→ tile fetch 失敗仮説は棄却。

### Step 7. polyline (赤線) と marker (start/goal/rider) は見えているか

**部分 NG ── camera が mesh 内なので画面に出ない、ただし座標は正しい。**

`viewer.entities.add({...})` で追加した polyline/marker は scene graph 上の独立物で、**depth test に従って描画される**。camera が mesh 内にいる場合:

- polyline (高度 +3 m、rEle + 3 m なので ellipsoid 1078 m、= mesh 表面 1108 m より 30 m 下): mesh 三角形の裏側にいる → depth test で隠れて画面に出ない
- start/goal/rider point (`heightReference: NONE`、rEle 直置き): 同上、mesh の中
- **これらすべて camera から見ると mesh が前景を塞いでいて見えない**

ただし back-face culling されている mesh 裏面に対しては polyline/marker は **前景** になるはずだが、Cesium の polyline は `depthFailMaterial` が未指定なので depth test fail 時には透明扱い → 結果として画面に出ない。

これも「薄黄一色」の構成要素 ── polyline / marker が見えないので画面に色 cue が無く、Mie 散乱フォグだけが残る。

---

## 「一面薄黄色」を生むコード地点の特定

### 真犯人

**`viewer.js:41-49` の terrain async 差替 と、`viewer.js:144,216,229` の rider/camera 位置算出が geoid 高さを ellipsoid 高さとして渡している不整合**。

具体ライン:

```javascript
// viewer.js:41-44 ← terrain swap が trigger
Cesium.createWorldTerrainAsync({ requestVertexNormals: false, requestWaterMask: false })
  .then(t => {
    viewer.terrainProvider = t;   // ← この瞬間、Mt.Fuji mesh が ellipsoid 1110 m まで盛り上がる
    status('terrain: world (3D 富士山あり)');
  })

// viewer.js:216 ← rider 位置、rEle は GPX orthometric (geoid 海抜) なのに ellipsoid 高さとして渡している
riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle);
// → rider が ellipsoid 1075 m に置かれ、terrain mesh (ellipsoid 1110 m) より 35 m 下

// viewer.js:229 ← target、同様の不整合
const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + 1.5);
// → target ellipsoid 1076.5 m、mesh より 33.5 m 下

// viewer.js:233-234 ← camera offset
const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 12, -cosH * 12, 4);
const cameraPos = Cesium.Matrix4.multiplyByPoint(enuTransform, cameraOffsetEnu, ...);
// → camera ellipsoid ~1080.5 m、mesh より 29.5 m 下
```

加えて副犯人:

```javascript
// viewer.js:37 ── 低高度で Mie 散乱が暖色になる SkyAtmosphere
viewer.scene.skyAtmosphere.show = true;
// → camera が mesh 内で direction が水平の時、画面全体が大気散乱の積分色 (薄黄/cream) に染まる
```

```javascript
// viewer.js:129 ── polyline `clampToGround:false` で空中描画
clampToGround: false,
// → world terrain swap 後は mesh 下に潜る、画面に出ない
```

```javascript
// viewer.js:161 ── rider が heightReference NONE で空中固定
heightReference: Cesium.HeightReference.NONE,
// → mesh swap 後は mesh 下、見えない
```

### 確証実験 (= bug 特定の最小コマンド)

Chrome DevTools console で:
```javascript
viewer.scene.terrainProvider  // → CesiumTerrainProvider (= world terrain) のはず
viewer.camera.positionCartographic.height  // → 約 1080 m (ellipsoid 高度)
viewer.scene.globe.getHeight(viewer.camera.positionCartographic)  // → 約 1110 m (mesh 高度)
// height < getHeight() なら camera は mesh 下にいる ← 本件
```

加えて:
```javascript
viewer.scene.skyAtmosphere.show = false;  // 大気散乱切る
// → 画面が「globe baseColor 深青 + mesh 裏面 = 暗い青〜黒」になる、薄黄でなくなる
// → これで Mie 散乱由来であることが確定
```

更に:
```javascript
viewer.camera.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, 1200);  // ellipsoid 1200 m に強制
viewer.camera.lookAt(...);  // 下向きに rider 見下ろし
// → 画面に Mt.Fuji terrain + OSM drape が見える、polyline 赤線も見える
// → camera 位置が原因であることが確定
```

---

## 修正案

### Fix A (推奨、本質的): 全座標を ellipsoid 高さに変換

GPX `<ele>` は orthometric (geoid) 海抜、Cesium `fromDegrees` は ellipsoid 高さを期待。日本周辺の geoid - ellipsoid offset は **EGM2008 で +35〜+40 m** (具体的には富士周辺で +36.5 m 前後)。

```javascript
// viewer.js 上部に定数追加
const GEOID_OFFSET_M = 37;  // 富士周辺の EGM2008 geoid-ellipsoid offset、概算

// すべての fromDegrees 呼び出しで rEle / elevation_m に +GEOID_OFFSET_M を加算
const cart = course.map(p => Cesium.Cartesian3.fromDegrees(
  p.lon, p.lat, p.elevation_m + 3 + GEOID_OFFSET_M
));

riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + GEOID_OFFSET_M);

const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + 1.5 + GEOID_OFFSET_M);
```

精度の限界: GEOID_OFFSET_M は **コース全体で 1〜2 m スケールで変動する**、24 km 走破中に +36→+38 m 変化する可能性。これは Mt.Fuji の登り (1242 m up) に対しては 0.2% 程度のズレで実用上問題なし、ただし正確を期すなら `cesium-sensors` 等の geoid model lookup が要る。

### Fix B (より本質的、コード量大): Cesium 標準パターンの `sampleTerrainMostDetailed`

GPX 高さを使わず、各 trkpt の lat/lon から Cesium World Terrain の実標高を取得して rider を mesh 表面に snap:

```javascript
// loadCourse 内、course load 後
const cartographics = course.map(p => Cesium.Cartographic.fromDegrees(p.lon, p.lat));
const updatedCartographics = await Cesium.sampleTerrainMostDetailed(
  viewer.terrainProvider, cartographics
);
// updatedCartographics[i].height が実 terrain 表面 (ellipsoid 高さ) になる、これを使う
const cart = updatedCartographics.map(c =>
  Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + 3)
);

// rider の HeightReference を CLAMP_TO_GROUND に変更すれば fromDegrees 段階で snap される
riderEntity = viewer.entities.add({
  position: cart[0],
  point: { ..., heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
  // ...
});
```

利点: geoid offset を手動推定不要、camera は常に mesh 上にいる、polyline は terrain に沿う。
欠点: course load 後に `sampleTerrainMostDetailed` を `await` する必要、それまで描画開始できない (= world terrain が landed してから rider 描画、async chain が伸びる)。HUD の slope も再計算が必要 (GPX 標高ベースの slope_pct が world terrain 標高と乖離する)。

### Fix C (即時応急、3 行で動く): camera を terrain 上に強制持ち上げ + atmosphere 切る

```javascript
// viewer.js:36-37 を以下に変更
viewer.scene.globe.enableLighting = false;
viewer.scene.skyAtmosphere.show = false;  // ← Mie 散乱の暖色フォグを消す
viewer.scene.globe.depthTestAgainstTerrain = true;  // ← polyline/marker が地中なら隠れる、上にあれば見える

// viewer.js:233 を以下に変更 (camera offset を上方向に増強、緊急回避)
const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 12, -cosH * 12, 50);  // 後方 12m + 上 50m
```

これだと camera が常に rider 上空 50 m に浮く、ellipsoid 1125 m ≈ mesh + 15 m。Mie 散乱を切ることで暖色フォグも消える。**OSM タイルと富士山 mesh が見え始める**。
ただし rider はまだ mesh 下なので「rider 自身は見えない」状態、Fix A と組合せて初めて完全に直る。

### Fix D (副次): terrain swap 完了まで OSM imagery を hide にして race を避ける

```javascript
const osmLayer = new Cesium.ImageryLayer(
  new Cesium.UrlTemplateImageryProvider({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    credit: 'OpenStreetMap contributors',
    maximumLevel: 19,
  })
);
osmLayer.show = false;  // 初期は隠す

const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  baseLayer: osmLayer,
  // ...
});

Cesium.createWorldTerrainAsync({...})
  .then(t => {
    viewer.terrainProvider = t;
    osmLayer.show = true;  // terrain swap 完了後に imagery を見せる
    status('terrain: world (3D 富士山あり)');
  });
```

これは race condition の念のため対策で、本件の主犯ではない。世界 terrain swap の瞬間に imagery 再 attach 等の race は **Cesium 1.123 docs では起きない仕様** だが、念のための予防策として有効。

---

## 推奨実施順

1. **即時 (5 分)**: Fix C を viewer.js に投入、画面に何か出る状態にする (= ユーザーが「何も見えない」状態を脱する)
2. **短期 (30 分)**: Fix A を投入、`GEOID_OFFSET_M = 37` で rider と camera が mesh 上に来る、polyline 赤線と marker が見え始める
3. **中期 (2 時間)**: Fix B (`sampleTerrainMostDetailed`) を導入、course load 時に terrain 表面標高を取得、`HeightReference.CLAMP_TO_GROUND` に変更、これで geoid 概算ではなく正確な mesh-snap になる
4. **長期 (要検証)**: HUD の slope_pct を **world terrain 標高ベース**で再計算するか、GPX 標高ベースのまま据え置くか方針確定。本番 trainer ERG コマンドに使う勾配は GPX 由来が正、3D 表示用と HUD 用は terrain 由来でもいい、の使い分けがありえる

---

## 補足: 「一面薄黄」と「skyAtmosphere」「Cesium baseColor」「OSM tile失敗」の切り分け実証

| 仮説 | 期待される画面 | 実観測 | 判定 |
|---|---|---|---|
| globe baseColor 露出 (= 深青 0,0,0.5,1) | 全画面 dark navy blue | 薄黄 | NG (色が違う) |
| undergroundColor 露出 | 全画面 黒 | 薄黄 | NG (色が違う) |
| OSM tile fetch CORS/401 失敗 | navy + Network panel red error | 薄黄 + fetch は通っている | NG |
| Bing Aerial に勝手にすり替わり | 衛星画像 (緑 + 茶 + 雲) | 単色薄黄 | NG (パターン無い) |
| SkyAtmosphere Mie 散乱 (camera 低高度水平視) | 全画面 cream/khaki/薄黄 | 薄黄 | **OK** |
| camera が terrain mesh 内 + back-face culling で mesh 描画なし → Mie 散乱だけ見える | 単色薄黄 (場所による) | 薄黄 | **OK、組合せで決定的** |

→ 真因は **camera が mesh 内 + SkyAtmosphere の Mie 散乱単色描画**。

## まとめ

- 「画面一面薄黄」は **camera が world terrain mesh 内部に埋まり、`skyAtmosphere` の Mie 散乱だけが画面に出ている** 状態。bug ではなく Cesium の整合的な振る舞い。
- 真犯人は GPX `<ele>` (geoid 海抜) を `fromDegrees(lon, lat, height)` の **ellipsoid 高さ**として渡している不整合。日本周辺の geoid - ellipsoid offset 約 +37 m 分、rider と camera が mesh より下に潜る。
- imagery layer (OSM) は terrain swap で外れない、Bing にもすり替わらない、tile fetch も成功している。「見えない」のは camera 位置が悪く mesh 裏面しか見えないから。
- 副次的に `skyAtmosphere.show = true` (line 37) が低高度水平視で暖色フォグを生成、これが「薄黄一色」の色味の正体。
- 即時応急 (Fix C): `skyAtmosphere.show = false` + camera を 50 m 上に持ち上げ。Mie 散乱が消えて OSM と Mt.Fuji mesh が見え始める。
- 本質修正 (Fix A): 全 `fromDegrees(.., height)` に `+GEOID_OFFSET_M (= 37)` を加算、rider/camera が mesh 上に来る。
- より正確 (Fix B): `sampleTerrainMostDetailed` で実 mesh 標高を取得、`HeightReference.CLAMP_TO_GROUND` で snap、geoid 概算を排除。
- 関連ファイル:
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:37` (skyAtmosphere.show ← Mie 散乱副犯)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:41-49` (createWorldTerrainAsync ← trigger)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:129` (polyline fromDegrees + clampToGround:false)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:216` (rider position fromDegrees ← geoid 不整合)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:229` (camera target fromDegrees ← geoid 不整合)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:233-234` (camera offset 12m back / 4m up ← 高さ不足、mesh 内埋没)
- 出典:
  - Cesium 1.123 Viewer docs (cesium.com/learn/cesiumjs/ref-doc/Viewer.html): baseLayer 仕様
  - Cesium 1.132 GitHub source (UrlTemplateImageryProvider.js): provider 同期構成可
  - GlobeSurfaceTileProvider source: baseColor default = `new Color(0.0, 0.0, 0.5, 1.0)` (深青)
  - Globe docs: undergroundColor default = `Color.BLACK`
  - SkyAtmosphere docs + 「Atmospheric Lighting Improvements」blog: Mie scattering 低高度で暖色
  - OSM Tile Usage Policy: User-Agent / Referer / bulk fetch rules、本件は範囲内
