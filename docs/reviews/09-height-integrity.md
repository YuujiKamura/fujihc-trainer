# 09 height integrity

## はじめに

fujihc-trainer の viewer (`web/viewer.js?v=7`) で **Cesium Ion World Terrain (= 真の富士山 3D 地形) が読み込まれた後**、走者 cyan marker が画面から消え、赤い polyline がジグザグに見えるが地表との関係が不明、という症状を **標高の整合性** だけに絞って診断した。

結論を先に書くと:

**真犯人は「GPX `<ele>` (= 海抜 / EGM96 ジオイド基準, MSL) を Cesium に渡すと『WGS84 楕円体基準』として解釈される」という座標系の取り違え**。富士山周辺ではジオイドが楕円体より約 **+38 m 高い**ため、GPX が記録する標高をそのまま `Cesium.Cartesian3.fromDegrees(lon, lat, ele)` に渡すと、Cesium 内部では **本来の地表より 38 m 低い場所** に点が打たれる。World Terrain がロードされる前は地球が平面 (Ellipsoid only、標高 0 m 一様) だったので、楕円体高度 1075 m のものが地面より上に浮いて見えていた。World Terrain がロードされた瞬間、地形メッシュが楕円体高度 ~1113 m まで盛り上がり、**走者と polyline は地中 35〜38 m に埋まる**。

なぜ「polyline は見える、cyan rider は見えない」という非対称が起きるか:

- Cesium の **polyline** (`clampToGround:false`) は globe の `depthTestAgainstTerrain` (= scene 全体の depth test against terrain、default `false`) に従い、**地形に対する depth test を default では行わない**。地中の polyline でも常に terrain の上に上描きされる
- Cesium の **PointPrimitive** (= `point: {...}` で作る点) は独自の `disableDepthTestDistance` プロパティを持ち、default `0` (= 全距離で depth test 有効) で、地形に **occlude される**。地中の点は描画されない

つまり同じ「地中に埋もれた状態」でも、polyline は強制的に上描き、点は地面に隠される — これが **「cyan 消失 + polyline 視認可」非対称** の正体。

修正は GPX ele を MSL として扱い ellipsoid に変換する **(b) ジオイド補正 (+~38 m)** が最小工数、または **(a) `heightReference: CLAMP_TO_GROUND` + `clampToGround:true`** で標高を捨てて地形に貼り付ける方が最も robust。`disableDepthTestDistance: Infinity` は「rider を見えるようにする」だけで標高の取り違えは温存される、対症療法。

---

## 1. 標高ソースの関係図

座標系を 3 つ整理しないと混乱する:

| 名前                | 基準面                 | 富士周辺での実値                | 用途                                                  |
|---------------------|----------------------|--------------------------------|-------------------------------------------------------|
| **WGS84 ellipsoid 高度** | 数学的に定義された回転楕円体 | 地表 ≈ 1110〜1115 m (dist=0 付近) | Cesium 内部表現、`Cartesian3.fromDegrees(lon, lat, h)` の 3rd arg |
| **MSL / 海抜 / orthometric 高度** | EGM96 ジオイド (~平均海面)  | 地表 ≈ 1072〜1077 m (dist=0 付近) | GPX `<ele>` の de facto standard、ridewithgps はこれを書く  |
| **ジオイド undulation N**  | ellipsoid からのジオイド高さ | 富士周辺 N ≈ **+38 m** (geoid が ellipsoid より上) | 変換係数 (h = H + N)                                  |

関係式:

```
h (ellipsoid 高度) = H (MSL 高度) + N (ジオイド undulation)
```

富士周辺 (緯度 35.4°、経度 138.7°) では EGM96 N ≈ +37〜+40 m (geoid は ellipsoid より上)。本 24 km route は緯度 35.39〜35.45、経度 138.69〜138.76 の範囲で、N の変動は **+38 m を中心に ±1 m 程度**、ほぼ一定とみなしてよい。

データソース別の標高基準:

| ソース                                  | ele の意味                  |
|----------------------------------------|----------------------------|
| GPX (ridewithgps、route 45204897 起源)  | **MSL** (orthometric、海抜)。ridewithgps は SRTM ベース DEM サンプリング、SRTM は EGM96 reference |
| `web/course.json` (course.py が GPX を丸写し)   | MSL (= GPX のまま、変換なし)。`elevation_m` フィールドは MSL  |
| Cesium World Terrain (`createWorldTerrainAsync`) | **ellipsoid 高度**。Cesium 公式 doc 明記 "Terrain heights are above the WGS84 ellipsoid" |
| `Cesium.Cartesian3.fromDegrees(lon, lat, h)` | **ellipsoid 高度**。 3rd arg を ellipsoid 高度として ECEF に変換 |

→ **viewer.js は MSL 値を ellipsoid 高度として fromDegrees に渡しているため、~38 m の系統的ずれが発生する**。

---

## 2. 「走者が見えない」を生む高度不整合点

`web/viewer.js` の標高関連箇所:

```js
// line 129 (polyline)
const cart = course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + 3));

// line 216 (rider)
riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle);

// line 229 (camera target)
const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + 1.5);
// line 233 ENU offset で camera を target から 後方 12m + 上 4m
```

`p.elevation_m` と `rEle` は MSL のまま、Cesium は ellipsoid として解釈。

screenshot に出ていた HUD 値で実数を当てはめる (HUD: dist=209m, ele=1075m):

dist=209 m は course.json の idx=8 と idx=9 の間を線形補間した点:
- idx=8 (dist=175.31, ele=1072.30, lat=35.45069, lon=138.75794)
- idx=9 (dist=251.66, ele=1078.10, lat=35.45009, lon=138.75753)
- 補間後 (dist=209): lat=35.450425, lon=138.757759, ele=**1074.86 m** (= MSL)

この点での 3 つの高度:

```
                            ← rider 真上、ellipsoid 高度の世界
   ellipsoid h = 1113 m  ┄┄┄ Cesium World Terrain mesh top (= 実地表)
                          │
                          │ ← この空間に「実 GPS 走者」がいるべき
                          │   (= GPX の MSL 1075 = ellipsoid 1113)
                          │
   ellipsoid h = 1078 m  ─── viewer.js が polyline を描く層 (rEle+3)
                          │
   ellipsoid h = 1076.5 m ─── viewer.js が camera target を置く層 (rEle+1.5)
                          │
   ellipsoid h = 1075 m  ─── viewer.js が rider を置く層 (rEle そのまま)
                          │
                          │ ← この空間に「viewer 上の走者」がいる
                          │   = 地表より 38 m 低い (= 地中)
                          │
                          ↓ さらに下に楕円体表面 (高度 0 m) があるが省略
```

つまり viewer 上の走者 / polyline / camera target は **すべて地表より 35〜38 m 下** にいる。地形メッシュが上に被さっている。

camera position は target から ENU(back 12m, up 4m):
- camera ellipsoid 高度 = target ellipsoid (1076.5 m) + 4 m = **1080.5 m**
- camera 実位置 = 地表 (1113 m) より 32.5 m 下、つまり **camera 自身が地中**

走者が camera から見えるはずの空間 (camera と走者を結ぶ直線) は完全に地形メッシュの内部を通る。

### 描画結果の説明

- **PointPrimitive (rider, start, goal)**: Cesium の点プリミティブは `disableDepthTestDistance` プロパティで depth test を制御、default `0` (= depth test 常時 ON)。地形メッシュが手前にあるピクセルでは点が描画されない。**地中の rider は完全に occlude されて見えない**
- **Polyline (clampToGround:false)**: `scene.globe.depthTestAgainstTerrain` (scene 全体の terrain depth test、default `false`) に従う。viewer.js は明示的に true に設定していない (line 37 で `skyAtmosphere.show = true` だけ)。したがって polyline は地形 occlusion を無視して描画される、地中でも常に上描き
- **camera が地中**: ellipsoid に backface culling が掛かっているため、camera から外側を見る LOS のうち、地形メッシュの**裏面**を見る方向は素通り、**表面**を見る方向は地中側からは見えない (= 視界の手前は穴、奥は表に出てから表面が見える)。結果として地形が削れたような穴あきの絵になり、camera 視界の中で polyline が地形の穴から見え隠れする
- **polyline ジグザグ**: 1968 点を直線でつなぐ polyline は標高プロファイルそのまま (1061 → 2303 m) を持つ。camera (1080 m) と goal (2306 m, ellipsoid) の間で polyline が camera ellipsoid 高度を上下に蛇行することはないが、camera が地中にあって LOS が穴を貫通する地形の peephole で polyline の局所セグメントだけが見え、見えないセグメントとの繋ぎ目で **ジグザグ視認**になる

---

## 3. 補強観察: skyAtmosphere との干渉

`viewer.js:37` で `viewer.scene.skyAtmosphere.show = true`、これは地形上空の青色霞を描画する。camera が地中にいる場合、上空方向は地形メッシュの裏面 (culled) → skyAtmosphere レイヤーが透けて見える。**画面の大半が薄青く見える**現象も併発しているはず (screenshot を見れば確認可能だが、設定上そうなる)。

これは標高軸の bug ではなく描画軸の副作用、ただし「rider が背景に溶ける」要因として標高 bug を増幅している。

---

## 4. 修正案: heightReference 切替 vs ジオイド補正

### 案 (a): `CLAMP_TO_GROUND` で地形貼り付け

```js
// rider
riderEntity = viewer.entities.add({
  position: Cesium.Cartesian3.fromDegrees(rLon, rLat, 0),  // 高度は無視される
  point: {
    pixelSize: 18,
    color: Cesium.Color.CYAN,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,  // ← 変更
    disableDepthTestDistance: Number.POSITIVE_INFINITY,        // ← 追加 (terrain が下にあっても常に visible)
  },
  // ...
});

// polyline
viewer.entities.add({
  polyline: {
    positions: course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat)),  // 高度抜き
    width: 10,
    material: Cesium.Color.RED,
    clampToGround: true,                                        // ← 変更
    // arcType は clampToGround:true では使われない
  },
});
```

- **長所**: 標高ソースの絶対精度に依存しない。GPX ele が MSL でも ellipsoid でも 0 でも、地形に貼り付くので常に正しい位置
- **短所**: 走者の高度プロファイル (= 5合目に向かって 1200m 上昇する vertical 描画) が消える。trainer の slope% は course.json から計算済で HUD には出るが、3D 視覚的な「坂を登る」感じは弱まる
- **camera への影響**: camera target が rider + 1.5 m の絶対高度に依存している。CLAMP_TO_GROUND した rider の絶対 ellipsoid 高度は Cesium が runtime に計算するので、tick() 内で `viewer.scene.sampleHeight(cartographic)` または `viewer.scene.globe.getHeight(cartographic)` を呼んで地形高度を取得し、target.z = terrainHeight + 1.5 とする必要がある。これは非同期ではないが、terrain がまだ load 中の領域では `undefined` を返す可能性あり、fallback 必須

### 案 (b): ジオイド補正定数 +38 m

```js
const GEOID_OFFSET_M = 38.0;  // EGM96 N at Fuji area, constant approximation

// polyline
const cart = course.map(p =>
  Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + GEOID_OFFSET_M + 3)
);

// rider
riderEntity.position = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + GEOID_OFFSET_M);

// camera target
const target = Cesium.Cartesian3.fromDegrees(rLon, rLat, rEle + GEOID_OFFSET_M + 1.5);

// rider point: depth test も無効化しておく
riderEntity.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
```

- **長所**: GPX の標高プロファイルがそのまま 3D に保たれる。坂の vertical 視覚が残る、camera が地形上に正しく配置される
- **短所**: 定数 +38 m は近似 (N は 24 km の route 内で ±1 m 揺らぐ)。これは地形メッシュ精度より小さい誤差なので実害なし。ただし GPX の `<ele>` が ellipsoid 高度の場合は逆に +38 m 加えてはダメ — ソース毎に判定が要る
- **camera への影響**: 既存ロジックそのまま、座標値だけ +38 m

### 案 (c): `disableDepthTestDistance: Infinity` だけ (対症療法)

```js
riderEntity.point.disableDepthTestDistance = Number.POSITIVE_INFINITY;
// polyline は元々 depth test されてないので変更不要
```

- **長所**: 1 行で rider が見える
- **短所**: rider は地中 38 m の位置で「terrain を貫通して常に表示される点」になる。terrain メッシュが点を覆い隠す動作だけ無効化、点の **絶対位置は地中のまま**。camera も地中のまま (camera position の補正なし)、視界は破綻したまま。本質を温存

### どれが筋か

**目的別**:

- **走者・道・地形を正しく一致させたい (= 視覚的整合 first)**: 案 (a)。標高情報を捨てる代償はあるが、座標系の不一致を構造的に消す。trainer の slope% は course.json 由来で別経路、視覚と独立しているので影響なし
- **GPX の標高プロファイルを生かしたい (= 坂の vertical 表現 first)**: 案 (b)。+38 m offset を 1 箇所定数で持つだけ、課題は GPX ソースが本当に MSL かを確認しておくこと。**今回の ridewithgps 由来 GPX は MSL で確定** (route generator の SRTM サンプリングは EGM96 ベース)
- **「rider が見えれば一旦良い、座標系は後で」**: 案 (c)。ただし polyline 位置はずれたまま、camera も地中 → screenshot で確認するとずれが見える、最終形にはならない

**推奨**: **案 (b) を採用、案 (a) を後段でオプション化**。理由:

1. 工数最小 (定数 +38 を 3 箇所、point に disableDepthTest を 1 行)
2. GPX 標高プロファイル保存 → 後の機能 (= 坂の 3D vertical 描画、五合目への登り感) と互換
3. 既存 camera 計算ロジック (ENU offset、heading) との互換性
4. `course.py` 側でジオイド補正をするのも案だが、`course.json` を viewer 専用にすると trainer logic と乖離する。viewer.js 側で持つ方が責務が明確
5. 案 (a) は将来「GPX ele 精度を信用しない、地形に従う」ポリシーに切替えるとき導入

将来、GPX ソースが本当に MSL かを runtime に判定したい場合は、course[0].elevation_m と Cesium が報告する `scene.sampleHeight(course[0])` を比較して `+offset` を実測するのが頑健 (= 起動時に 1 回の terrain サンプリングで N を確定、constant 38 m よりも厳密)。

---

## 5. 修正前後の挙動予測

**修正前** (現状):
- 平面地球 (起動直後、Ellipsoid only): rider は 1075 m 楕円体高度に浮いて見える (実地表 = 楕円体 0 m なので 1075 m 上に浮く)。OSM tile が地表に貼られ、別軸 06 で指摘した「OSM タイルが視差で 2.7 km 南西の絵を映す」現象
- World Terrain 読込後: 地形メッシュが楕円体 +1100 m まで盛り上がり、**rider/polyline/camera target は地形メッシュの 35〜38 m 下に埋まる**。rider 消失、camera 地中で視界破綻、polyline は terrain depth test なしの抜け穴から見える

**修正後** (案 b 適用):
- 平面地球 (起動直後): rider は 1113 m 楕円体高度に浮いて見える (= 元の 1075 + 38)。OSM tile との視差はさらに広がる (camera も +38 m 上方移動、tile が映す地点はさらに遠方へ)。**起動直後の表示は今より悪化**するが、これは平面地球設定そのものが座標的に不整合な状態なので、World Terrain load 完了までの数秒間の見栄えに留まる
- World Terrain 読込後: rider が地表 (1113 m 楕円体) に乗る、camera もその +4 m 上、**走者 + polyline + 地形が一致**。「水色 marker が富士山スバルラインの 1075 m 地点を走る」が成立

**修正後** (案 a 適用):
- 平面地球 (起動直後): rider は楕円体表面 (高度 0 m) に貼り付き、OSM tile の同じ場所に表示される。**起動直後の見栄えが現状より改善**
- World Terrain 読込後: rider が terrain 表面に貼り付き、地表を走る。標高プロファイル無し (rider 高度は terrain mesh と同じ)
- 注意: camera tick() 内で `scene.sampleHeight()` を呼ぶ必要、初回 frame で terrain 未読込 area は undefined fallback 必要

---

## 6. 検証手順 (修正適用後)

1. browser console で次を打って rider の現在 ellipsoid 高度を確認:
   ```js
   const c = Cesium.Cartographic.fromCartesian(riderEntity.position.getValue(Cesium.JulianDate.now()));
   console.log('rider ele=', c.height, 'm (ellipsoid)');
   ```
2. 同地点の terrain 高度をサンプリング:
   ```js
   const cart = Cesium.Cartographic.fromDegrees(rLon, rLat);
   Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cart]).then(([s]) => {
     console.log('terrain ele=', s.height, 'm (ellipsoid)');
   });
   ```
3. 案 (b) を採った場合、両者の差が 0〜数 m に収まるべき (rider は地表 + 0 m、polyline は地表 + 3 m 程度)
4. 案 (a) を採った場合、`riderEntity.position.getValue(...).height` は 0 m 付近、terrain.height は terrain mesh の高度、Cesium 内部で clamp が行われる
5. 画面上で **cyan marker が見える**、polyline が **道路の上を蛇行する** (= 地形と整合した道) ことを screenshot で確認

---

## まとめ

- **真犯人**: GPX `<ele>` (= MSL 海抜) を Cesium が ellipsoid 高度として解釈、富士周辺で約 +38 m の系統的下方ずれ
- **症状**: World Terrain ロード後、rider / polyline / camera target / camera position すべて地形メッシュの 35〜38 m 下に埋まる
- **非対称 (rider 消失 + polyline 視認可) の理由**: PointPrimitive の `disableDepthTestDistance` default `0` (= 地形 occlusion ON) に対し、Polyline は `scene.globe.depthTestAgainstTerrain` default `false` (= 地形 occlusion OFF)。同じ地中位置でも片方だけ隠れる
- **camera 自身も地中**: camera は target + ENU(back 12, up 4) なので target が地中なら camera も地中、視界は backface culling と depth test の合成で破綻
- **推奨 fix**: 案 (b) ジオイド補正定数 +38 m (3 箇所の `+ GEOID_OFFSET_M`) + rider point に `disableDepthTestDistance: Infinity` (= 起動直後 / terrain load 中の transient で rider が必ず見えるよう保険)。工数最小、標高プロファイル保存、camera ロジック互換
- **後段オプション**: 案 (a) `CLAMP_TO_GROUND` で地形貼り付け (標高ソースの絶対精度に依存しない robust 設計、ただし trainer の vertical 視覚を犠牲)
- **case (c) は対症療法 NG**: rider を見えるようにするだけで、位置は地中のまま、polyline / camera のずれ温存

関連ファイル:
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:41` (`createWorldTerrainAsync` 読込)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:129` (polyline 各点の高度 = ele + 3)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:154-172` (riderEntity 定義、`heightReference: NONE` line 161)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:216` (rider position update、補間後 rEle そのまま)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:229` (camera target、rEle + 1.5)
- `C:/Users/yuuji/fujihc-trainer/web/viewer.js:233` (camera offset、target から ENU(-12*sinH, -12*cosH, 4))
- `C:/Users/yuuji/fujihc-trainer/src/fujihc/course.py:40-76` (GPX → CoursePoint、ele は GPX `<ele>` を保存変換なし)
- `C:/Users/yuuji/fujihc-trainer/web/course.json` (1968 点、ele 1061.3 → 2303.4、MSL)
