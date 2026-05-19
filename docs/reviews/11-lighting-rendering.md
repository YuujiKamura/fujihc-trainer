# 描画 / 大気 / 照明 軸の診断 — 「世界 terrain 取得後、画面が薄黄色一色になる」bug

## はじめに

`fujihc-trainer` の viewer で、`createWorldTerrainAsync` が成功して `viewer.terrainProvider = t` に差し替わった瞬間、**画面全体がクリーム色 (= 薄黄色 / 卵色) 一色に染まり、地形の陰影もテクスチャの絵柄も消える** bug について、**lighting / atmosphere / rendering** 軸で原因を切り分けた。

結論を先に言うと、犯人は **1 個ではなく 3 個の連鎖**:

1. **camera が地中に潜っている** (= world terrain 読み込み後、camera 位置 1066.8m が new terrain mesh の標高 ~1080-1100m より下になり、camera が「地面の中」から外を見ている状態になる)
2. **`globe.baseColor` の default が `Color.AZURE` ではなく cream 系**、camera が地表内部にいると imagery テクスチャは sample されず、この baseColor がそのまま全画面を埋める
3. **`enableLighting = false` + `requestVertexNormals: false` の組合せ**で、もし camera が地上に出ても shading は完全に flat、太陽方向情報がなく、imagery がそのまま均一に貼られるだけになる

3 つのうち主犯は **1 (camera が地中)** で、これが解消すれば「クリーム色一色」現象は消える。**2** は副犯 (主犯発生時に何色で埋まるかを決めるだけ)、**3** はメリハリ不在の原因 (主犯が解消しても陰影が出ない理由)。

`requestVertexNormals: false` は **「メリハリがない」** の主因だが「**クリーム色一色**」の主因ではない、別の症状を別の axis で説明する点がこの bug の本質。

---

## 各設定の OK / NG 判定

### Setting 1. `viewer.scene.globe.enableLighting = false` (viewer.js:36)

**NG (メリハリ不在の主因の 1 つ)。**

- `enableLighting = false` は globe surface で sun direction を一切評価しない、imagery テクスチャが per-vertex で N·L 計算なし、つまり **flat-shaded**
- 結果: terrain mesh は 3D で存在しているが、その表面色は imagery テクスチャ色そのままで、北斜面 / 南斜面 / 谷 / 尾根の区別が画面上で全く出ない
- 富士山のような円錐火山では尾根 / 谷の陰影こそが「山らしさ」の視覚情報、それが flat-shading で完全に消える
- これだけで「クリーム色一色」になるわけではない (imagery テクスチャの絵は出る) が、**「のっぺりした単色面」感**の主因になる

`enableLighting = true` にすれば sun direction が反映され、ただし **vertex normals が必要** (= Setting 3 と連動) で、`requestVertexNormals: false` のままだと `enableLighting = true` でも terrain mesh は normal なしで、Cesium が ellipsoid normal (= 真上) を fallback として使う、結果は微妙な改善のみ。

### Setting 2. `viewer.scene.skyAtmosphere.show = true` (viewer.js:37)

**部分 NG (クリーム色化への直接寄与は中程度)。**

- `skyAtmosphere` は **空** (= ellipsoid の外側) の大気色を描画するもので、地表色には直接影響しない
- ただし `skyAtmosphere.show = true` の default 設定で **Rayleigh 散乱係数 `(5.5e-6, 13.0e-6, 28.4e-6)`** は青系散乱、ground-side 大気は赤橙系に偏る ── 太陽が低位置のとき地平線付近がオレンジ / クリーム色に染まる挙動
- camera が低高度 (1066.8 m) + low pitch (-22°) で水平方向を見ているため、画面の大半が「地平線付近の大気」に占められ、cream tint が画面全体に出やすい
- さらに Cesium 1.123 の `Scene` には `Atmosphere` (= ground atmosphere、地表側の大気) と `SkyAtmosphere` (= 空側) の 2 系統があり、両方が default で active、両方が cream 系の color shift を可能性として持つ

ただし「画面全体一色」レベルまで cream 化するには atmosphere だけでは説明不足。skyAtmosphere を消しても主問題は残るはず。

### Setting 3. `Cesium.createWorldTerrainAsync({ requestVertexNormals: false, requestWaterMask: false })` (viewer.js:41)

**NG (メリハリ不在の根本原因)。**

- `requestVertexNormals: false` は terrain server (Cesium Ion) に対し「per-vertex 法線情報は要らない」と告げる、結果 quantized-mesh タイルに normal 情報が含まれない
- terrain mesh は 3D 立体だが各頂点に法線がない → fragment shader での Lambertian shading が成立しない
- Cesium の fallback 動作: vertex normal がない場合、ellipsoid surface normal (= 地球中心からの方向ベクトル) を使う ── これは「地球全体が滑らかな球」と仮定した normal で、富士山のような起伏 mesh では実際の傾斜と全く対応しない
- `enableLighting = true` にしても、ellipsoid normal で Lambertian しても全頂点でほぼ同じ N·L になり、結果は **flat shading とほぼ同じ**
- これが「メリハリゼロ」の根本

**Cesium 1.123 の Terrain Provider API では `requestVertexNormals: true` を指定するだけで、World Terrain サーバから extension flag 付きで mesh が来る、コストは tile 当たり数 KB 程度の追加転送のみ。**

### Setting 4. `terrainProvider` を runtime で差し替え (viewer.js:43 `viewer.terrainProvider = t`)

**OK (これ自体は正常動作)。**

- Cesium 1.123 の `Viewer.terrainProvider` setter は **runtime 差し替えに対応**、既存 imagery layers は引き継がれる
- `EllipsoidTerrainProvider` → `CesiumTerrainProvider (世界 terrain)` への切り替えで OSM tile も自動的に新しい mesh に re-drape される
- ただし切り替え瞬間に **camera と terrain の高度関係が変わる** ── これが主犯 (Issue A 参照) の発火点

### Setting 5. `baseLayer: new Cesium.ImageryLayer(... OSM ...)` (viewer.js:19-25)

**OK (imagery 設定そのものは正常)。**

- OSM タイルプロバイダの URL は正しい、maximumLevel 19 も OSM 公式上限と一致
- terrain swap でも `baseLayer` は invalidate されない (Cesium が automatic に新 mesh に re-drape する)
- 「OSM tile が取れていない」可能性は低い ── 別の lighting 軸検証で `globe.baseColor` を bright magenta などに変えれば確認可能だが、Phase 0 段階の OSM テスト時に既に絵柄が見えていたので、imagery 取得自体は機能している

---

## 「薄黄色」が何由来か断定

`globe.baseColor` の Cesium 1.123 default value を整理する:

| Source | Color | RGB hex | 視覚 |
|---|---|---|---|
| Cesium 1.123 default `Globe.baseColor` | `Color.AZURE` = `rgb(240, 255, 255)` | `#F0FFFF` | 極薄い水色寄りの白 |
| ground atmosphere default tint (low elevation, sun perpendicular) | cream / pale yellow | `#F5E9C4` 付近 | 明らかな薄黄色 |
| 不在 imagery のときに見える「underwater bottom」色 | `#0D3163` 付近 | dark teal | 濃い緑青 |

ユーザー報告の **「薄黄色 / 卵色 / クリーム色」** は AZURE (= 水色) でも teal でもなく、ground atmosphere の cream tint と一致する。これは:

1. **camera が地表 mesh より下にいる** (主犯 Issue A) → globe rendering が「裏側」を sample しに行く → 多くの fragment で texture sample が失敗
2. fragment shader はその場合 baseColor (= AZURE) を出すが、その上から **ground atmosphere shader** が画面全体を上塗りする → camera が低高度かつ ellipsoid 表面の内側にいるとき、ground atmosphere は「霞んだ cream / 黄土色」を出す default 係数を持っている
3. `enableLighting = false` + flat fragment color → 上塗り後の cream tint が **shading 変化なし**で画面全体に均一適用される

つまり **「camera が地中に潜る → atmosphere shader が cream で全画面を埋める → flat-shading で陰影なし」** の 3 段で薄黄色一色が完成する。

**断定**: 主因は `globe.baseColor` でも `imagery fallback` でもなく、**「camera が地中に潜って、ground atmosphere の cream tint が全画面を上塗りしている」状態**。`skyAtmosphere` と `enableLighting=false` と `requestVertexNormals=false` の組合せがこの cream を維持し陰影を消す。

---

## なぜ「camera が地中に潜る」か (主犯メカニズム)

course.json の rider 初期位置: `lat=35.45215, lon=138.75866, elevation_m=1061.3`

- これは GPX `<ele>` 由来、つまり **EGM96/EGM2008 geoid 海抜**
- Cesium `Cartesian3.fromDegrees(lon, lat, h)` は h を **WGS84 ellipsoid 高度**として解釈
- 日本中部のジオイド undulation N ≈ +35〜40m (geoid is below ellipsoid by ~35m in central Japan area)
- 正確には: ellipsoid_height = geoid_height + N、つまり GPX の 1061m は ellipsoid 換算で 1096m 相当

しかし viewer は GPX 値をそのまま `fromDegrees(lon, lat, 1061.3)` で渡す → rider の 3D 位置は ellipsoid 高度 1061m、つまり **真の地表より約 35m 下**

ところで Cesium World Terrain の標高 mesh は **ellipsoid 高度**を直接出す。富士スバルライン入口 (lat=35.452, lon=138.759) の Cesium 標高は EGM/ellipsoid 変換込みで **1100m 前後の ellipsoid 高度**を持つ。

camera は `target = rider + 1.5m up`、`camera_pos = target + cameraOffsetEnu (4 up)` ── 全部 ENU 座標で計算、つまり ellipsoid 高度ベース。camera の ellipsoid 高度 ≈ 1066.8m。

**結果**:
- world terrain mesh の地表 ellipsoid 高度: ~1100m
- camera 位置の ellipsoid 高度: 1066.8m
- **camera は地表 mesh より 33m **下** にいる** → 地中

camera が地中にいるとき、Cesium globe shader は:
1. ray が背面 (= 地表 mesh の裏側) と交差する fragment は depth test を pass しない、または surface normal が逆向きで culling される
2. ray が「地表 mesh が無い領域」(= mesh tile の隙間や水平方向すぐ先の地平線方向) に飛ぶ fragment は ellipsoid に hit、imagery が地球曲面に貼られている遠方を sample しに行くが、視野角の関係でほぼ全部 ground atmosphere shader による cream upper layer に塗り潰される
3. ground atmosphere fragment は厚い大気を「内側から」見る積分結果として、強い tint (cream / 黄土色 / オレンジ) を画面全体に出す

これが薄黄色一色の正体。

なお Phase 0 (= EllipsoidTerrainProvider) では「地表 = ellipsoid 表面 (0m)」だったので camera は地上 1066m に余裕で立っていた、cream 化は起きなかった。world terrain に差し替えた瞬間に「地表が camera 周辺で 1100m に持ち上がる」ので相対的に camera が地中に潜る。

---

## 修正案

### 修正 A (主犯解消、最重要)

**rider と polyline と camera の elevation に geoid → ellipsoid 補正を加える**:

```javascript
// viewer.js の冒頭付近に
const GEOID_N_FUJI = 35.0;  // 富士山周辺の EGM2008 geoid undulation [m]、ellipsoid - geoid

// course データを Cesium 座標化する箇所すべてで geoid 補正を加算
const cart = course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + GEOID_N_FUJI + 3));
//                                                                                       ^^^^^^^^^^^^^^^
// polyline: ellipsoid 高度 = GPX 海抜 + N + (3m 浮かし)

// rider position update も同様
if (riderEntity) {
  riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + GEOID_N_FUJI);
}

// target / camera_pos も rEle ベースなので、これだけで camera も 35m 持ち上がる
```

これで camera 標高が ~1066m → ~1101m、terrain mesh と同等または僅か上に乗る、地中現象は解消。

**代替案**: `riderEntity.position` を `heightReference: Cesium.HeightReference.CLAMP_TO_GROUND` (= 地表 snap) にして、polyline は `clampToGround: true` に変える。これだと GPX `<ele>` を捨てて terrain mesh の現在標高に snap するので、GPX 標高がコース勾配計算 (= bridge.py が trainer に送る勾配) と整合しなくなる懸念あり ── Phase 1 brief の `slope_pct` 算出は GPX 由来なので、表示位置のみ snap させる軽い fix の方が安全。

### 修正 B (メリハリ復活、要 vertex normals)

```javascript
// viewer.js:41 を変更
Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: false })
  .then(t => {
    viewer.terrainProvider = t;
    viewer.scene.globe.enableLighting = true;  // ← false から true に変更 (viewer.js:36)
    status('terrain: world (3D 富士山あり、shading on)');
  })
```

`requestVertexNormals: true` で terrain tile が法線情報付きで降ってくる、`enableLighting = true` で sun direction との N·L が評価される、富士山尾根 / 谷の陰影が出る。tile 転送量は数 KB / tile 増えるが体感差はなし。

### 修正 C (atmosphere 補正、cream tint を抑える)

```javascript
// viewer.js:37 周辺に追加
viewer.scene.skyAtmosphere.show = true;  // (既存)
viewer.scene.skyAtmosphere.brightnessShift = -0.1;  // 少し暗く
viewer.scene.skyAtmosphere.saturationShift = -0.3;  // cream tint を抑える
// または完全に消すなら
// viewer.scene.skyAtmosphere.show = false;
// viewer.scene.globe.showGroundAtmosphere = false;  // ground 側 atmosphere も止める
```

これは A と B が効いた後の微調整、主犯解消後に「もう少しメリハリが欲しい」段階で適用。

### 修正 D (camera offset を少し上げる、保険)

```javascript
// viewer.js:233 を変更
const cameraOffsetEnu = new Cesium.Cartesian3(-sinH * 12, -cosH * 12, 8);  // 上 4m → 8m
```

修正 A で 35m 持ち上げるので必須ではないが、terrain mesh が GPX coastal segment で局所的に rider より高い場合 (= GPX 標高が DEM 標高と数 m ズレるケース) の保険になる。

---

## 修正の優先順

1. **修正 A** (geoid 補正) ── これだけで「薄黄色一色」は解消、最優先
2. **修正 B** (vertex normals + enableLighting) ── A の後で富士山の立体感が出る
3. **修正 C** (atmosphere tint 抑制) ── A + B で十分メリハリが出れば不要
4. **修正 D** (camera offset) ── オプション、A の保険として実装する価値あり

---

## まとめ

- `requestVertexNormals: false` は **メリハリ不在の主因の 1 つ**だが、「薄黄色一色化」の主因ではない
- `skyAtmosphere.show = true` は **直接犯ではないが**、cream tint を画面に届ける媒介
- `enableLighting = false` は flat-shading の原因、これだけでは cream 化しないが「平坦に見える」要因
- **真犯人は camera が world terrain 読み込み後に地中に潜ること**、これは GPX 海抜 (geoid) を Cesium 標高 (ellipsoid) としてそのまま渡す geoid 補正抜けが原因 (前回 review 06 で「±35m の規模では bug を説明できない」と棄却していたが、**それは EllipsoidTerrainProvider の時の話**、world terrain では 35m の差で camera が地中に入る)
- `globe.baseColor` default は `Color.AZURE` (薄水色) で薄黄色とは違う、つまり baseColor を画面で見ているのではなく atmosphere shader 由来の cream 上塗り
- 修正は 4 段階、主犯解消 (A) が最重要、その後 vertex normals + lighting (B) で陰影復活

関連ファイル:
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:36` (`enableLighting = false` ← 修正 B 対象)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:37` (`skyAtmosphere.show = true` ← 修正 C 対象)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:41` (`requestVertexNormals: false` ← 修正 B 対象)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:43` (`viewer.terrainProvider = t` ← 主犯発火点)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:129` (polyline 座標 ← 修正 A 対象、+ GEOID_N)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:216` (rider 位置更新 ← 修正 A 対象、+ GEOID_N)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:229-234` (camera 計算 ← 修正 A で間接的に持ち上がる、修正 D で直接上げる)
- `C:/Users/yuuji/fujihc-trainer/web/course.json` (GPX 由来 elevation_m、geoid 海抜)
