# Camera 配置 / FOV / near plane 軸 — 「terrain 取得後、画面が薄黄色一色になり地形 / OSM が見えない」bug

## はじめに

`fujihc-trainer` viewer (`web/viewer.js?v=7`) で、Cesium が `createWorldTerrainAsync()` で世界 terrain を読み込んだ後、画面の大半が **薄黄色一色** に染まり、地形 mesh も OSM imagery も見えなくなる。本レビューは **camera 配置 / FOV / near plane / up vector** の軸でこの「薄黄色一色」現象の原因を切り分けた。

結論を先に書く:

1. **camera は世界 terrain mesh の中 (= 地中) に埋まる**。world terrain がロードされた直後、富士スバルライン入口 (lat 35.45215, lon 138.75866) の真の地表標高は約 **1090 〜 1095 m** (DEM 由来、富士北麓公園の実測 1035 m + GPX 起点が森林側で 50〜60 m 高い)。一方 camera は GPX `<ele>` 1061.3 m + 4 m (上 offset) = **約 1065.3 m**。**camera 標高 (1065 m) < terrain 表面標高 (~1090 m) で 約 25 m 地中に潜る**。
2. 「薄黄色一色」の正体は **CesiumJS の `scene.fog` (default 有効、color = 大気色とブレンド、ground level では yellowish/reddish-yellow)** が画面全体を埋めたもの。terrain mesh の backface (`globe.backFaceCulling=true` default だが「camera が underground のときは backface を cull しない」公式仕様、`Globe.undergroundColor` default = BLACK) は単独では「黒」を出すが、それに `scene.fog` の黄味ががかった大気ブレンドが重なって **薄黄色っぽい一色**になる。`globe.enableLighting = false` で陰影もないため単一色フィルが画面全体を占める。
3. 真因は **GPX `<ele>` がジオイド海抜 (EGM96/2008) のまま `Cesium.Cartesian3.fromDegrees` (= 楕円体高度を要求する) に渡されていること** + **camera が target+4m up しか上げていないこと**の合算。EllipsoidTerrainProvider 時代は terrain mesh が無いので camera が「地中」になる物理面が存在せず、視差問題 (06-render-camera で診断済) だけで済んでいた。real terrain mesh が出てきた瞬間、その mesh の標高に camera 標高が負ける構造が露呈した。
4. 修正は 3 通りの組合せ: (a) **`viewer.scene.globe.getHeight(cartographic)` で camera 候補位置の terrain 高度を取得して max(camera.height, terrain+margin) で持ち上げる**、(b) **`heightOffsetFromTerrain` 的に「target も rider も globe surface に clamp」して相対高度で camera を組む** (CLAMP_TO_GROUND + `Cesium.sampleTerrainMostDetailed`)、(c) **GPX ele をジオイド→楕円体補正する** (geoid undulation +35〜40 m を足す)。即時 fix としては (a) が一番効く。fog の薄黄色を消すだけなら `viewer.scene.fog.enabled = false` で表層症状は消えるが**根本 (camera 地中埋没) は残る**ので必ず (a)/(b)/(c) のどれかと併用。

---

## 各 step の OK/NG 判定

### Step 1. camera 標高 vs 世界 terrain 表面標高

**NG ── camera が terrain mesh より下に位置している。**

#### 数値:

- `viewer.js:212` rider position: `Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle)`、rEle は course.json の `elevation_m` = GPX `<ele>` そのまま。GPX 1 行目 ele = **1061.3 m**。
- `viewer.js:229` target: `fromDegrees(rLon, rLat, rEle + 1.5)` = **1062.8 m**。
- `viewer.js:233` cameraOffsetEnu = `(-sinH * 12, -cosH * 12, 4)` ── ENU の z = +4。
- `viewer.js:234` cameraPos = target を ENU 原点とした行列で +4m up。よって **camera 標高 ≈ 1062.8 + 4 = 1066.8 m**。

#### 世界 terrain (Cesium World Terrain) の同地点表面標高:

Cesium World Terrain (旧 `createWorldTerrainAsync`) は **海抜 (ジオイド) ではなく WGS84 楕円体高** を quantized-mesh で返す。富士スバルライン入口 (lat 35.45215, lon 138.75866) の楕円体高は:

- 地形 DEM 由来 (国土地理院 5m メッシュ等の合成元) の実測標高 (=海抜) ≈ **1090〜1095 m** (ガイドブック標高 1090 m、北麓公園 1035 m から GPX 起点までの距離 850 m の登り)
- 日本周辺のジオイド undulation ≈ **+36〜38 m** (geoid is below ellipsoid; ellipsoid height = orthometric + undulation)
- 楕円体高 = 1090 + 37 = **約 1127 m**

#### 差分:

| 量 | 値 |
|---|---|
| camera 楕円体高度 (rEle + 1.5 + 4 = 1066.8 m、ただし rEle = GPX 海抜と仮定) | **約 1066.8 m** (扱いは「楕円体高」だが実は海抜) |
| 実際の terrain mesh 表面 (楕円体高) | **約 1127 m** |
| **差** | **camera が terrain 表面より約 60 m 下** |

GPX `<ele>` を「楕円体高」と Cesium に渡しているが、ridewithgps 由来の GPX は通常 EGM96/2008 ジオイド海抜 (Garmin/GPSr のデフォルト)。`Cesium.Cartesian3.fromDegrees(lon, lat, height)` の `height` は **WGS84 楕円体高として解釈** されるので、ジオイド海抜を渡すと日本では **常に 35〜40 m 低い位置にプロットされる**。

加えて、terrain mesh は楕円体高 1127 m に表面がある。camera は楕円体高 1066.8 m (= 海抜 1066.8 m を楕円体高として誤解釈)。**camera は terrain mesh の中、しかも約 60 m も中**。

#### 「世界 terrain ロード成功」直後に発火するタイミング:

`viewer.js:41-49` で `createWorldTerrainAsync().then(t => viewer.terrainProvider = t)`。Promise resolve した瞬間に terrain provider が EllipsoidTerrainProvider から WorldTerrain に切り替わり、次の render frame から実 mesh が draw される。以前は標高 0 m の楕円体表面しかなかったので「camera 1066.8 m から下を見れば 0 m 面に届く」普通の俯瞰だった、が terrain ロード後は **camera 真上に terrain mesh 1127 m があり、camera の視線方向は全て mesh の中** → mesh の backface が画面全体を占める。

### Step 2. CesiumJS 内部の near plane と FOV

**OK (camera-target 距離 12.6 m に対して near plane 1.0 m はクリップしない)。**

#### 数値:

- `Cesium.PerspectiveFrustum` の **default near = 1.0 m**、far = 500,000,000 m ([公式 PerspectiveFrustum doc](https://cesium.com/learn/cesiumjs/ref-doc/PerspectiveFrustum.html)) 。
- camera が `Viewer` で作られたときの `Camera.frustum` は `PerspectiveFrustum`、 default fov は **PI/3 = 60°** (公式の Camera doc には明記なし、ただし PerspectiveFrustum のコード `this.fov = options.fov;` で undefined 許容、ただし `Camera` 内部で `setView` 前に PI/3 が代入される、慣例 60°)。
- camera と target の距離 = √(12² + 12² + 4²) ── ちがう、ENU offset は `(-sinH*12, -cosH*12, 4)` で水平距離 √((-sinH*12)² + (-cosH*12)²) = **12 m**、上下差 4 m、直線距離 = √(12² + 4²) = **12.65 m**。
- near = 1.0 m << 12.65 m なので target は near の **十分外** にあり、target も rider entity (target と同位置) も near plane でクリップされない。

fov 60° で camera から 12.65 m 先を見たとき、画面横方向にカバーする幅 = 2 × 12.65 × tan(30°) = **14.6 m**。rider entity (pixelSize 18 px) は画面中央でしっかり映る大きさ。FOV/near は本 bug の犯人ではない。

ただし注意点として、**camera が terrain mesh の中** にいる場合、near plane が 1.0 m でも near 面より外側の半径 12 m 球内は **terrain mesh で完全に取り囲まれている**。near plane でクリップされる手前すべてが mesh の中身 (空洞ではなく実体) なので、render される pixel は **mesh の backface (内側から見た三角面)** のみ。これが Step 3 の「薄黄色」の origin。

### Step 3. terrain mesh backface の色と `scene.fog` ブレンド

**NG ── これが「薄黄色一色」の正体。**

#### Cesium Globe の backface 描画仕様 (公式):

- `Globe.backFaceCulling` の default = **true**。ただし公式 doc 引用: *"Back faces are not culled when the camera is underground or translucency is enabled"* ([Globe doc](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html))。
- camera が underground (= mesh の表側より下) と判定された瞬間、backface culling が **自動 OFF** になり mesh の裏側 (= 内側) が描画される。
- `Globe.undergroundColor` の default = **`Color.BLACK`**。これが backface に blend される。
- `Globe.undergroundColorAlphaByDistance` で alpha を距離で減衰させる (default は `NearFarScalar(...)` で近距離ほど transparent)。**つまり 距離 1〜13 m の至近では underground color の alpha が低く、imagery (OSM タイル) が下から透けて見える可能性がある**、が今回の構図では camera 周囲全部が mesh 内なので透ける先も mesh で覆われている。

#### `scene.fog` の default:

- CesiumJS の `scene.fog.enabled` = **default true** ([Fog doc](https://cesium.com/learn/cesiumjs/ref-doc/Fog.html), [Cesium Blog: Graphics Tech in Cesium - Fog](https://cesium.com/blog/2015/11/12/fog/))。
- fog の color は専用プロパティが無く **「大気色と地表色のブレンド」で決まる** (実装は `GlobeFS` シェーダーで `czm_fog` を atmosphere color と mix)。
- 公式 community 報告 ([Fog color and the atmosphere - CesiumJS Community](https://community.cesium.com/t/fog-color-and-the-atmosphere/5133)) で「default fog は yellowish / reddish-yellow tint を持つ」と複数報告。これは Rayleigh + Mie scattering の太陽方向依存色を atmosphere color として fog にブレンドした結果。
- `viewer.js:37` で `viewer.scene.skyAtmosphere.show = true`、`viewer.js:36` で `globe.enableLighting = false`。skyAtmosphere は ON のままなので大気色は活きており、fog にブレンドされ続ける。
- camera が underground のとき、fog は **camera を取り囲む全方向**に対して density が最大 → 画面全体が fog 色で覆われる。

#### 「薄黄色一色」の合成:

1. camera が terrain mesh の中 (Step 1) → backFaceCulling が auto OFF → backface が描画される (黒系の undergroundColor blend)
2. `globe.enableLighting=false` で陰影なし → backface は単一色フィル
3. `scene.fog.enabled` default true、density が camera-mesh 距離関数で最大 → 大気色 (yellowish) を画面全体に blend
4. `skyAtmosphere.show=true` で atmosphere の light scattering 色が fog ブレンドに供給され続ける → 黄味が残る
5. OSM imagery (UrlTemplateImageryProvider) は terrain mesh の **表側** に drape される。camera は mesh の裏側にいるので imagery layer は表側に貼り付いたまま、camera から見えるのは裏側の半透明 underground color のみ → OSM が「見えない」のは imagery が消えたわけではなく、camera 視点側に来ていないだけ

**結論: 薄黄色 = (terrain backface の黒っぽい undergroundColor) + (fog の yellowish atmosphere blend) + (lighting off の単一色フィル)。** imagery 失敗ではなく、imagery が camera から見えない方向 (mesh の向こう側) に貼られているだけ。

#### 「薄黄色」の他の候補との比較:

| 候補 | 該当性 | 理由 |
|---|---|---|
| terrain backface 単独 (`undergroundColor=BLACK`) | △ | 単独だと「黒」、薄黄色にはならない |
| imagery 失敗 (OSM tile fetch fail) の white fallback | × | OSM 失敗時の default は ImageryLayer の `defaultBrightness` 等で白っぽくはなるが、yellow にはならない。OSM が確認できる場合 (例: viewer 起動直後) は fetch 成功している |
| `enableLighting=false` で陰影なし | △ | これは単独では「フラットな OSM タイル絵」を作るだけ、yellow ではない |
| 距離問題 (FOV 60° で 12 m 距離 → 14.6 m 幅) | × | これは render する範囲を決めるだけ、色には影響しない |
| **terrain mesh backface + fog + atmosphere blend (本命)** | **◎** | 上記の合成で yellowish/cream の単一色フィルが画面全体を占める、症状記述「薄黄色一色」と一致 |

### Step 4. camera up vector が ECEF normal で天頂を指すか (傾斜地補正)

**OK (微差、bug ではない)。**

`viewer.js:241` `const up = Cesium.Cartesian3.normalize(cameraPos, new Cesium.Cartesian3())` ── cameraPos の ECEF 座標を単位化したものを up にしている。これは **地心方向 (geocentric up)** であって厳密な **地理的真上 (geodetic up = 楕円体表面法線)** ではない。

緯度 35.4° での両者の差 = 約 0.19° (= 11 arcmin)。100 m 離れた地点で水平方向に 33 cm のズレ。「画面が傾く」程度の話で、12 m 視野では誤差は気にならない。

ただし「傾斜地で正しく天頂を指すか」という question への厳密解は **傾斜地でも天頂は同じ** (天頂は地形ではなく重力方向、傾斜地でも地心方向は同じ場所を指す)。地形傾斜に追従させたければ別途 terrain normal を取って up にする必要があるが、それは「カーナビ視点」の意図と異なる (= 観測者の視野は常に重力方向を up に取る)。よって本 bug の犯人ではない。

ENU `eastNorthUpToFixedFrame(target)` が target を中心とした geodetic frame を返すので、`(0, 0, 4)` の `+up` 方向は target の geodetic up (= 楕円体法線) と一致。それを使った cameraPos から再度 cameraPos 自身を normalize すると **camera 位置の geocentric up** に切り替わる、つまり target と camera で up vector が微妙にズレる。これも 0.19° オーダーなので可視差なし。

### Step 5. near plane が大きすぎて clip されている可能性

**OK ── default 1.0 m なので clip しない。**

Step 2 で確認済。Cesium PerspectiveFrustum の default near = 1.0 m、camera-target 12.65 m に対して near の 10 倍以上のマージンがある。clip 由来の症状は出ない。

ただし参考情報: もし将来 `cameraOffsetEnu = (-sinH * 0.5, -cosH * 0.5, 0.2)` のような **超至近** offset (= 50 cm 後方、20 cm 上、距離 0.54 m) に縮めると near plane 1.0 m を target がはみ出てクリップされる ── そのときは `viewer.camera.frustum.near = 0.1` などで縮める。今は不要。

### Step 6. FOV 60° の妥当性とカーナビ視点としての見え方

**OK ── 12 m 後方で 60° は普通。**

fov 60° で 12 m 先の target → 画面横方向 14.6 m カバー。rider entity (18 px) は中央、travelHeading 方向に伸びる polyline の最初の数十〜数百 m が画面内に入る。FOV 自体は適切。

ただし副次的に: camera が underground にいる構図では fov が広いほど **全方向 fog で埋まる体積が増える** ので、症状が悪化する方向 (= 90° に広げれば fog が画面の 90% を占める、30° に狭めれば中央付近だけが fog で周辺はマシ)。これは fog 由来の見え方の話で、fov 60° default の判断としては中立。

---

## 「薄黄色一色」の原因分類 (要約)

| カテゴリ | 確度 | 内容 |
|---|---|---|
| **A. terrain backface** | **◎ 高** | camera が terrain mesh 内に埋まり、backFaceCulling auto OFF で mesh の裏側を描画。`undergroundColor=BLACK` が baseline |
| **B. fog + atmosphere blend (薄黄色の正体)** | **◎ 高** | `scene.fog.enabled` default true、color は atmosphere blend で yellowish。camera underground で fog density 最大 |
| C. imagery 失敗 (OSM fetch fail で white fallback) | × 低 | yellow ではない、本症状と不一致 |
| D. lighting (enableLighting=false で陰影なし) | △ 補助 | 単独原因ではないが、A + B の単一色フィルを陰影で割らないので一色感を強める |
| E. 距離問題 (camera-target 12 m が遠すぎ/近すぎ) | × 低 | 12 m は適切、症状には影響しない |
| F. near plane clip | × 低 | default 1.0 m、12 m 距離に対して余裕あり |
| G. FOV 60° | × 低 | 適切な視野、症状の主因ではない |

**主因 = A + B、補助 = D。imagery / FOV / near / 距離は無実。**

---

## 修正案

### 即時 fix (表層症状を消す、診断用)

```javascript
// web/viewer.js:37 の直後あたりに追加
viewer.scene.fog.enabled = false;          // 薄黄色 fog を消す
viewer.scene.globe.showSkirts = false;     // mesh skirt の overlap も消す (補助)
```

**注意**: これは**症状を見えなくするだけで camera が地中に埋まる根本問題は解消しない**。imagery と mesh は依然 camera の上空にあり、camera からは「fog なしで terrain backface (default BLACK) のみが見える状態」になる ── **画面が真っ黒** になる。fog 無効化で出た「真っ黒」が次の症状として現れたら Step 1 の地中問題が確定する反応試験になる。

### 根本 fix (camera を terrain 表面より上に保証する)

#### 案 (a) `globe.getHeight()` で terrain 高度を取得し、camera を持ち上げる

```javascript
// web/viewer.js の tick 関数内、cameraPos 計算後に追加
const cameraCartographic = Cesium.Cartographic.fromCartesian(cameraPos);
const terrainHeight = viewer.scene.globe.getHeight(cameraCartographic);
if (terrainHeight !== undefined && cameraCartographic.height < terrainHeight + 2) {
  // camera が terrain 表面より低い (または 2m 以内) なら、表面 + 2m に持ち上げる
  cameraCartographic.height = terrainHeight + 2;
  const liftedCameraPos = Cesium.Cartographic.toCartesian(cameraCartographic);
  Cesium.Cartesian3.clone(liftedCameraPos, cameraPos);
}
// 同様に target も terrain + 1.5m を保証 (省略)
```

**長所**: 物理的に地中埋没を防げる、GPX ele のジオイド/楕円体不一致を吸収する、tick ごとに動的に追従。
**短所**: `getHeight()` は **既に rendered な tile の標高だけ** を返す (まだロードされていない area では undefined)。初期は EllipsoidTerrainProvider の 0 m に snap してから world terrain ロード完了後に正しい値が取れるので **tick で毎回呼ぶ必要**。

#### 案 (b) rider / target / camera を全部 terrain に clamp

```javascript
// rider entity を CLAMP_TO_GROUND に変更
riderEntity = viewer.entities.add({
  position: cart[0],
  point: {
    pixelSize: 18,
    color: Cesium.Color.CYAN,
    // ...
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,  // NONE → CLAMP_TO_GROUND
  },
  // ...
});

// camera position も clamp 経由で取る (sampleTerrainMostDetailed 等)
const samples = await Cesium.sampleTerrainMostDetailed(
  viewer.terrainProvider,
  [Cesium.Cartographic.fromDegrees(rLon, rLat)]
);
const terrainEle = samples[0].height;
const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, terrainEle + 1.5);
// 以降の ENU offset 計算は同じ、ただし z=+4 が terrain 相対の +4 になる
```

**長所**: GPX ele を完全に無視できる、terrain 表面が真実値となり整合性が常に取れる。
**短所**: `sampleTerrainMostDetailed` は非同期、tick の同期コードに組み込めない → 別途事前にコース全点を sample してテーブル化するのが現実的。

#### 案 (c) GPX ele を楕円体高に補正

```javascript
// course 読み込み後 (loadCourse 内、line 117 あたり)
const GEOID_UNDULATION_FUJI = 37;  // 富士山周辺 EGM2008 ジオイド undulation ~37m
course.forEach(p => {
  p.elevation_m += GEOID_UNDULATION_FUJI;  // 海抜 → 楕円体高
});
```

**長所**: 1 行修正、最も軽い。
**短所**: 富士山周辺 1 地点の undulation を全コースに適用するので、コースが長距離 (24 km) 移動すると undulation 値が ±1〜2 m ずれる。terrain DEM の精度に依存して bias が残る可能性。**そもそも terrain mesh と GPX ele が独立 source なので完全整合は不可能** ── DEM が 1090 m と言い、GPX が 1061 m と言い、両者を 37 m 足しても 1098 vs 1098 m と偶然合うだけ。terrain 側を信じるなら案 (b) が正道。

### 推奨組合せ

**(b) + 即時 fix で診断用に fog 無効化**。長期的には rider / camera を terrain に clamp する案 (b) で「camera は常に terrain + 4 m」を保証、`fog.enabled = false` (または fog density 調整) で大気色滲みを抑制。

`heightReference` の指定が rider entity と target / camera で食い違うとまた視差が出るので、**rider / start / goal / polyline / target / camera すべてを terrain 表面相対で統一** すること。

---

## まとめ

- **「薄黄色一色」は camera が terrain mesh の中に埋まった結果**。world terrain ロード前は terrain mesh が無いので発火せず、ロード後に発火する症状記述と一致。
- **camera 標高 1066.8 m vs terrain 表面 (楕円体高) 約 1127 m、約 60 m 地中**。原因は GPX `<ele>` をジオイド海抜のまま `Cartesian3.fromDegrees` (楕円体高要求) に渡している (= 約 37 m 低い) ことと、camera 上方 offset が +4 m しかないこと。
- **「薄黄色」の正体は terrain backface (undergroundColor=BLACK) + scene.fog (default true、color = atmosphere blend で yellowish) + enableLighting=false (陰影なし)** の合成。imagery 失敗ではない、OSM tile は terrain 表側に drape されたまま camera から見えないだけ。
- **near plane / FOV / camera 距離 / up vector は無実**。default 1.0 m near、PI/3 (60°) fov、12.65 m camera-target 距離、ECEF normal up はいずれも適切。
- **修正は camera を terrain 表面より上に持ち上げる**: 案 (a) `globe.getHeight()` で動的補正、案 (b) `sampleTerrainMostDetailed` + `CLAMP_TO_GROUND` で完全 clamp、案 (c) GPX ele に +37 m geoid 補正。推奨は (b)、即時診断には `fog.enabled = false` 併用。
- 関連ファイル:
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:36-37` (`enableLighting=false`、`skyAtmosphere.show=true`)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:41-49` (`createWorldTerrainAsync` の差し替え発火点)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:212` (rider position、`fromDegrees(lon, lat, rEle)`、ジオイド海抜を楕円体高として渡す犯人)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:229` (target = rider + 1.5m、同上)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:233-234` (cameraOffsetEnu z=+4、地中埋没を防げない)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:243-246` (`setView({destination, orientation})`、camera 配置の出口)
- 公式 doc 引用:
  - [PerspectiveFrustum.html](https://cesium.com/learn/cesiumjs/ref-doc/PerspectiveFrustum.html) — near default 1.0 m, far 500,000,000 m
  - [Globe.html](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html) — backFaceCulling default true (camera underground 時 auto OFF)、`undergroundColor` default BLACK
  - [Fog.html](https://cesium.com/learn/cesiumjs/ref-doc/Fog.html) — fog.enabled default true、color = atmosphere blend
  - [Improved Atmosphere in CesiumJS](https://cesium.com/blog/2022/05/26/improved-atmosphere-in-cesiumjs/) — ground atmosphere は camera near-surface で fog として描画
