# 描画 / camera 軸の診断 — 「水色の走者が想定外の場所を走る」bug

## はじめに

`fujihc-trainer` の viewer で、ユーザー報告 「画面中央 cyan 点が住宅地の中、route polyline (赤線) は見えない、camera 視点は地平線まで見える低角」 について **描画と camera** の観点だけで原因を切り分けた。

結論を先に言うと、**cyan の lat/lon は完全に正しい (= 富士スバルライン入口、標高 1061 m)**。「住宅地に立っている」ように見えるのは marker bug ではなく **平面地球 (EllipsoidTerrainProvider) と標高 1061 m の rider との視差** が生む幾何学的な錯視。OSM 画像は楕円体表面 (標高 0 m) に貼られるのに対し rider と polyline は標高 1061 m に置かれているため、camera から rider 越しに見える OSM の絵は地理的に **約 2.7 km 南西の別の場所** から来ている。

route polyline (赤線) が見えないのは、`skyAtmosphere.show = true` で polyline が伸びた先 (= 富士山五合目方向の遠景、地平線付近) が大気霞に溶けるのと、画面下部の cyan に近い数十 m の区間は cyan dot (18 px) の真後ろに隠れる、の合算。

最有力犯人は **EllipsoidTerrainProvider** (= 平面地球) で、`createWorldTerrainAsync` 等の real terrain provider に切り替えれば OSM 画像が富士山表面に drape され、視差が消えて cyan の真下に正しい場所 (= スバルライン下部森林) が映る。

---

## 各 step の OK/NG 判定

### Step 1. camera 視点が target から離れすぎる / 近すぎる

**OK (距離は適切)、ただし pitch がやや急。**

`web/viewer.js:200-205`:
- target = rider 位置 + 1.5 m (= 標高 1062.8 m)
- camera offset (ENU) = (4.03 east, 9.15 north, 4 up) ── travel heading -156° (= SSW)、後方 10 m + 上 4 m
- camera 高度 ≈ 1066.8 m、rider との水平距離 ≈ 9.85 m、垂直差 ≈ 5.5 m
- camera-to-target pitch = `atan2(-4, 10) ≈ -21.8°` (= 約 22° 下向き)
- 直線距離 = √(10² + 4²) ≈ 10.77 m

cyan marker は画面のほぼ中央に映る。距離 10.77 m はカーナビ風視点として妥当 (もう少し離した方が前方視界を稼げるが) で、「target と camera が中心にしてる場所がずれている」ような bug はない ── target は rider + 1.5 m を直接見ている。

ただし pitch -22° はカーナビとしては **やや見下ろし過ぎ**。実車の運転席視点は -5 〜 -10° 程度。これは bug ではないが UX チューニング項目。

### Step 2. polyline (RED, width 10, GEODESIC) が描画されない、または別の場所に描画されている可能性

**部分 NG ── polyline は world 座標的には正しく描画されているが画面では大半が見えない。**

検証内容:
- polyline は `course.map(p => fromDegrees(p.lon, p.lat, p.elevation_m + 3))` で 1968 点を標高 +3 m に置く (`viewer.js:112`)。座標は正しい。
- material は `Color.RED`、width 10 (= ピクセル単位)、`clampToGround:false`、`arcType.GEODESIC`。
- start から先 (= 富士スバルライン上り) の各点は course の進行方向 SW + 標高上昇 1061→2303 m。camera 視点 (1066.8 m) から見ると:
  - 距離 0 m: polyline 標高 1064 m、camera LOS 高度 1066.8 m → polyline は LOS より 2.8 m **下**、cyan 真下に微かに見える可能性
  - 距離 31 m: polyline 1067 m、LOS 1054 m → polyline 13 m **上**、画面上方へ伸びる
  - 距離 100 m: polyline 1072 m、LOS 1022 m → polyline 50 m 上
  - 距離 2.2 km: polyline 1208 m、LOS 168 m → polyline 1040 m 上、画面上端付近
  - 距離 6.9 km (= 直線距離 goal まで): polyline 2306 m、LOS -1700 m → 画面上端を越えて FOV 外

`arcType.GEODESIC` は隣接 2 点を WGS84 楕円体上の great-circle 弧で結ぶが、隣接点間距離は平均 12 m (= 24 km / 1968) なので artifact になるほどの曲率はなし。NG はここではない。

**実害**: polyline は画面上、cyan のほぼ後ろから始まり、上方へ伸びて画面上半分まで到達する形になる。cyan dot (pixelSize 18) が真下数 m を覆い、最初の数本のセグメントは隠れる。遠景の polyline は `skyAtmosphere.show = true` (= 線 34) で水色の大気霞に重なる → RED width 10 px でも遠距離だと細く見えて霞に溶ける。

加えて Cesium の polyline は default で **depth test ON** + **depthFailMaterial 未指定**なので、楕円体表面 (= OSM タイルが draped されている見えない 0 m 面) と交わったり過ぎたりする区間で隠される可能性がある (今回は polyline 全て高度 1061+ で 0 m 面より上なので発生しないはず)。

### Step 3. riderEntity の heightReference.NONE と Ellipsoid vs Geoid のオフセット

**OK ── 描画は仕様通り。ただし「地表に貼り付く」期待とは違う。**

`viewer.js:144` `heightReference: Cesium.HeightReference.NONE` ── 指定座標 (= `fromDegrees(p.lon, p.lat, p.elevation_m)` で標高 1061.3 m に直接プロット) の **空中** に point を置く。地表に snap しない。

Ellipsoid (WGS84 楕円体) と Geoid (海抜ジオイド) のオフセットは日本周辺で +30 〜 +40 m (geoid は ellipsoid より下、つまり geoid 海抜 0 m は ellipsoid 高度 +35 m 程度に相当)。GPX `<ele>` 値が標準 EGM96/EGM2008 geoid 海抜だとすると、Cesium の `fromDegrees(lon, lat, height)` は height を **ellipsoid 高度** として解釈するので、本来 ~35 m 補正したい場面。

ただし今回の bug は ±35 m オーダーでは説明できない (cyan の見え方は 2.7 km スケールでズレている)。ジオイド補正抜けは bug としては **微小 (35 m / 1061 m = 3.3%)**、画面上の cyan 表示位置にはほぼ影響しない。

### Step 4. terrain provider が EllipsoidTerrainProvider で OSM タイル投影と干渉

**NG ── これが本命。**

`viewer.js:16` `terrainProvider: new Cesium.EllipsoidTerrainProvider()` ── これは標高 0 m のスムーズな WGS84 楕円体表面だけ与える provider で、富士山の起伏は反映しない。OSM タイル imagery は楕円体表面 (= 標高 0 m) に貼られる。

一方 rider と polyline は `fromDegrees(lon, lat, elevation_m)` で **空中** に置かれている (rider は標高 1061 m、polyline は +3 m、goal は標高 2303 m)。

**干渉の構造**:
1. camera 標高 ≈ 1066.8 m、pitch -21.8° で下を見る
2. cyan marker は camera から 10.77 m 先、ほぼ画面中央
3. cyan 越しに見える OSM タイルは、camera の視線 (LOS) が **標高 0 m 面 (= ellipsoid)** に当たる場所
4. LOS が 0 m 面に当たる水平距離 = 1066.8 / tan(21.8°) ≈ **2670 m**
5. 視線方向は heading -156°、すなわち SSW
6. 結果として cyan の真後ろに映る OSM タイルは、cyan の lat/lon から **南南西に約 2.7 km 離れた地点** の地図

具体的に計算すると:
- cyan lat/lon: (35.45215, 138.75866)
- LOS が OSM 0 m 面に当たる位置: lat ≈ 35.430, lon ≈ 138.747 (= 鳴沢村 / 河口湖町南部の道路網が映る位置)

これがユーザーが「住宅地の中にいる」と感じる正体。**cyan の世界座標は正しく富士山下部 (スバルライン入口) にある** が、その下に映る画像は標高 0 m の OSM タイルなので 2.7 km 離れた場所の地図を見ていることになる。

### Step 5. OSM タイルの zoom level、画面が映してる先 と cyan 真下のずれ

**確認: 視覚的に映っている場所 ≠ cyan 真下、上記 Step 4 と同じ現象。**

OSM タイル zoom 19 (= `maximumLevel: 19`) で 1 タイル = 256 px は緯度 35.45° で約 76 m 四方。camera から 2.7 km 先を映すとタイル数枚分の風景が画面に入る。「住宅地」と見えるのは標高 0 m のタイルが鳴沢〜河口湖南岸の住宅 / 道路を含むため。

camera が中心としてる場所、cyan marker の真下、OSM タイルが描いてる場所 の **3 つの空間** の対応:

| 空間 | 緯度 / 経度 / 高度 |
|---|---|
| camera が見ている 3D 点 (= target) | lat 35.45215, lon 138.75866, **高度 1062.8 m** ← rider+1.5m |
| cyan marker 真下 (world 座標の地表) | lat 35.45215, lon 138.75866, **高度 0 m (= OSM タイル面)** ← 真下に降ろした点 |
| 画面で cyan 後方に映る OSM タイル | lat 35.430, lon 138.747, **高度 0 m** ← LOS が 0 m 面と交わる点 |

3 つは一致しない。target と cyan は (lat, lon) 一致 (高度差 1.5 m)、cyan 真下と OSM タイル映像は同じ平面だが lat/lon が違う (= 2.7 km 南南西ズレ)。

### Step 6. start (LIME) / goal (RED) marker の位置整合

**OK ── これらは静止しており、course の両端と一致。**

- start marker (LIME, line 124-128): `cart[0]` = `fromDegrees(course[0].lon, course[0].lat, course[0].elevation_m + 3)` = (35.45215, 138.75866, 1064.3 m)
- goal marker (RED, line 130-134): `cart[last]` = (35.39399, 138.73109, 2306.4 m)
- cyan rider 初期位置: line 138 で `position: cart[0]` ── start marker と同じ点

start marker は cyan の +3 m 上 (高度差 3 m)、screen 上は cyan のほぼ真上に重なる。goal は遠景の SW 方向 (camera 高度から見上げ角度 +10°、画面上半分の左寄り) にあるはず。これらの marker 自体に bug は無い。

### Step 7. heading 計算と camera 方位

**(座標変換軸レビューと重複、descriptive のみ。)**

`viewer.js:194-196` の `travelHeading = atan2(dLon, dLat)` は緯度補正 `cos(lat)` 抜けで heading が真方位から約 4° 北南軸方向にズレている (緯度 35.4° では `cos = 0.815`)。これは camera が rider の **真後ろではなく数度横にズレた位置** に置かれることを意味する。

描画/camera 軸では:
- rider 位置は影響なし (`riderEntity.position` 計算に heading 不在)
- polyline 位置も影響なし (各点の lat/lon は course.json から読むだけ)
- camera offset 方向だけが 4° 傾く ── 視野に入る polyline 区間と地形が微妙にズレる

4° のズレで「住宅地の中にいる」と感じるのは無理がある (= 2.7 km の視差の方が支配的)。heading bug は二次要因。

---

## 3 つの空間が一致しているかの検証

「camera が中心としてる場所」「cyan marker の真下」「OSM タイルが描いてる場所」を改めて整理:

```
                         camera (1066.8 m)
                              \
                               \  pitch -22°
                                \
                                 \
                                  \
                          cyan ____\______ target (1062.8 m)
                          (1061.3 m)\
                                    \
                                     \
                                      \  (空中で見えない LOS)
                                       \
   ___________________ground (0 m)______\______________________
   ← 北東                                X                  → 南西
                                       (OSM tile, 2.7 km SW
                                        of cyan's lat/lon)
```

数値:
- camera と cyan の水平距離 = √(4.03² + 9.15²) = 10 m
- cyan と OSM 当たり点の水平距離 = √((2670-10)² + 0²) ≈ **2660 m**
- (camera の真下と cyan の真下は水平 10 m、ほぼ同じ場所、OK)
- (camera の真下と OSM 描画地点は水平 2670 m、**ここが解離点**)

**結論: 3 つの空間は一致していない。** cyan が映っている画面ピクセルの「真後ろの OSM 絵」は 2.7 km 離れた別の場所のタイル。これが「水色走者が想定外の場所を走る」の本質。

cyan の lat/lon そのものは正しく富士スバルライン入口を指している ── ユーザーが見ている錯視は **「cyan の真下に標高 0 m のタイル絵が貼ってあるから、cyan を含む 1061 m 高度の世界と、画面に映る 0 m 高度の世界が同じ画面ピクセルに混在している」** という幾何的問題。

---

## terrain なし (Ellipsoid) で 標高 1132 m を持つ point が地表 OSM 平面とどう干渉するか

EllipsoidTerrainProvider は **「楕円体表面 = 標高 0 m 一様」** を出すだけで、富士山も琵琶湖も Cesium にとっては同じ滑らかな球面。OSM imagery (UrlTemplateImageryProvider) はこの楕円体表面に **DRAP** される (テクスチャマッピング)。

rider が `fromDegrees(lon, lat, 1132)` で空中に置かれた場合:
1. rider の 3D 位置は ECEF 座標で標高 1132 m に正しく算出される
2. OSM タイルは標高 0 m の楕円体表面に貼られている (= rider の **真下に 1132 m の空気層** がある状態)
3. camera が rider を見下ろしながら描画すると、rider の point billboard と OSM タイルの両方が同じ画面に映る
4. OSM タイル上の道路・建物は **rider の標高 1132 m を全く無視した平面投影** で描かれている
5. 視差効果で、「rider のピクセル位置の真下」に映る OSM タイル絵は、rider の真の地表 lat/lon ではなく、camera から rider を貫いて 0 m 面まで延長した先の lat/lon

**つまり OSM 画像と rider の高度世界は別レイヤーで、camera 視野の中で「同じ画素」に共存しているのに「異なる空間情報」を表示している状態。** これが描画/camera 軸での主犯。

副次的影響:
- polyline (標高 1061 〜 2303 m に浮かぶ赤線) は OSM タイル (標高 0 m) との視差で **「OSM 地図上の道路と異なる線形」に映る**。ユーザーが見ている赤線と OSM の県道の道路 (= スバルライン) が画面上で並走しないので「赤線が見えない / 妙な場所を通る」感覚を強化
- start / goal marker も同様の視差を持つが、これらは静止しているのでユーザーは見慣れる

real terrain provider (`createWorldTerrainAsync` or 国土地理院 DEM タイル) を入れれば、富士山の起伏が 3D mesh で生成され、OSM タイルがその起伏面に drape され、rider の標高 1061 m はちょうどスバルライン入口の地表に snap する。視差は消える。

---

## 最も犯人っぽい 1 個 + fix

### 犯人

**EllipsoidTerrainProvider と非ゼロ標高の rider との視差**。

`web/viewer.js:16` で `new Cesium.EllipsoidTerrainProvider()` を使っている限り、OSM imagery は標高 0 m 球面に貼られる。rider は標高 1061+ m に正しく置かれているが、camera 視野の中で「rider の画面ピクセル真下に映る OSM 絵」は別の場所のタイル (LOS が 0 m 面と交わる地点) ── 富士山下部森林の位置にいる rider の **画面ピクセル背後** に、約 2.7 km 南西の **0 m 面のタイル絵** (鳴沢〜河口湖南岸) が描かれる。これが「住宅地に立っている」錯視。

### Fix (2 段階)

**段階 1. (即時、ION token なし)**

`EllipsoidTerrainProvider` のままで運用するなら、camera 距離をぐっと近くして視差を最小化:

```javascript
// web/viewer.js:204 を変更
// const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 10, -cosH * 10, 4);
const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 3, -cosH * 3, 1.6);  // 後方 3m + 上 1.6m
```

camera 距離を 10m → 3m に縮め、上 4m → 1.6 m (= 大人の目線高さ) に下げると pitch ≈ atan2(-1.6, 3) ≈ -28° は少し急だが、LOS が OSM 0 m 面に当たる水平距離 = 1066/tan(28°) ≈ 2000 m → 1066/tan(28°) ≈ 2000 m。視差は減らないが **画面に映る OSM 範囲が狭くなり、ユーザーの錯視は緩和** される。

加えて`viewer.scene.skyAtmosphere.show = false` で大気霞を消すと polyline が画面端でも溶けず識別可能になる。

**段階 2. (本質、real terrain provider 導入)**

```javascript
// web/viewer.js:15-23 を変更
const viewer = new Cesium.Viewer('cesiumContainer', {
  terrainProvider: await Cesium.createWorldTerrainAsync(),  // ION token 必要
  baseLayer: new Cesium.ImageryLayer(
    new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: 'OpenStreetMap contributors',
      maximumLevel: 19,
    })
  ),
  // ...
});
```

`createWorldTerrainAsync()` は ION token (Cesium 公式の無料 token で OK) を要求するが、これで富士山の起伏が 3D で再現され、OSM タイルが地表面に drape され、視差が消える。

ION token を使わない代替: 国土地理院 DEM タイルから自前 CesiumTerrainProvider を組む (CSV → quantized-mesh 変換が必要、工数大)。

加えて rider の `heightReference: Cesium.HeightReference.CLAMP_TO_GROUND` (= 地表に snap) を併用すれば、rider が常に terrain 上を走る挙動になる。ただし polyline も clampToGround:true にして coherent な扱いにすること。

---

## まとめ

- camera 視点設定そのものは座標的に OK (target 真ん中、rider との距離 10.77 m、pitch -22°)。pitch がやや急だが bug ではない。
- polyline は world 座標で正しく描画されているが、画面上は cyan dot の真下 (= 数十 m 区間) は隠れ、遠景は大気霞に溶けて見えにくい。`skyAtmosphere.show = false` で改善可能。
- riderEntity の `HeightReference.NONE` は仕様通り、Ellipsoid と Geoid のオフセット (~35 m) は今回の bug を説明する規模ではない。
- **真犯人は `EllipsoidTerrainProvider` (= 平面地球) と OSM imagery (= 標高 0 m に drape) の組合せで、標高 1061 m の rider に対して 2.7 km の視差が発生していること**。cyan の lat/lon は正しいが、画面ピクセル背後に映る OSM タイル絵は 2.7 km 南西の別の場所 → ユーザーは「住宅地にいる」と錯覚する。
- 段階 1 fix: camera 距離を 3 m に縮める + `skyAtmosphere.show = false`、即時実施可、視差は減らないが錯視は緩和。
- 段階 2 fix (本質): `createWorldTerrainAsync()` で real terrain provider を入れる、ION token 1 個で OK、視差完全解消。
- 関連ファイル:
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:16` (EllipsoidTerrainProvider ← 真犯人)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:35` (skyAtmosphere.show 補助)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:112` (polyline 描画設定)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:137-155` (riderEntity、heightReference.NONE)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:192-217` (camera tick、offset、direction/up)
