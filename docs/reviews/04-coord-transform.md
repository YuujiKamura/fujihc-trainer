# 座標変換軸の診断 — 「水色の走者が想定外の場所を走る」bug

## はじめに

`fujihc-trainer` の viewer で、cyan の走者マーカーが画面上で「河口湖町大石〜山中湖手前あたりの住宅地」に見える、というユーザー報告について、**座標変換**の観点だけで GPX → course.json → Cesium 描画の経路を端から端まで照合した。

結論を先に言うと、**座標変換そのものは全 step OK**。GPX の lat/lon、course.py の haversine、Cartesian3.fromDegrees の引数順 (lon, lat, height) のいずれにも swap も unit ミスも無い。座標は富士スバルライン (タロゲート〜五合目) の実位置と完全一致している。

ただし、座標は OK でも **camera の向きを決める `travelHeading` の計算に bug がある** ── 進行方位を `atan2(dLon_deg, dLat_deg)` で計算しており、緯度補正 `cos(lat)` が抜けている。これは走者の位置 (= rider entity の lat/lon) を間違えるわけではないが、**走者を画面上どの向きから映すかが地理的真北からズレる**。富士山緯度 35.4° では cos(lat)≈0.815 なので heading が最大数度〜十数度ズレ、ユーザーが「あれ、今ここの右に見えてる住宅地、地図的にはここの裏のはず…」と感じる原因にはなり得る。

ただし座標軸では「水色走者そのものを別の場所にテレポートさせる」bug は今回見つからなかった。ユーザーの「想定外の場所を走る」が **rider 位置そのもの**なら座標軸は犯人ではなく terrain 軸 (EllipsoidTerrainProvider で平面地球扱い) や imagery 軸 (OSM タイル) が候補、**camera の見え方**なら heading bug が最有力。

---

## 各 step の OK/NG 判定

### Step 1. course.py の haversine + cumulative distance 計算

**OK。**

- `src/fujihc/course.py:29-37` `_haversine_m((lat, lon), (lat, lon))` は標準 haversine 式、`R=6371000`、`p1, p2` が radians、 `dp = p2 - p1`、 `dl = (lon_b - lon_a) * rad`、`h = sin(dp/2)^2 + cos(p1) cos(p2) sin(dl/2)^2`、`2 * R * asin(sqrt(h))`。式に誤りなし。
- `src/fujihc/course.py:51-60` で `prev = (p.latitude, p.longitude)`、 呼び出しも `_haversine_m((p.latitude, p.longitude), prev)`、両引数とも (lat, lon) 順で揃っている。
- 独立に PowerShell で同式を計算したところ、course.json の `distance_m[1] = 30.58 m` と完全一致 (30.579 m を round して 30.58)。
- cumulative 累積も `cum += haversine(curr, prev)` で正しい。
- 合計 24.0 km = 1968 trkpt の最終 distance_m と一致 (`23987.98 m`)。GPX 公式仕様 24km とも一致。

### Step 2. `Cartesian3.fromDegrees(lon, lat, height)` の引数順

**全 4 箇所 OK。**

CesiumJS 1.123 公式リファレンスで確認: `Cartesian3.fromDegrees(longitude, latitude, height)` ── 第 1 引数が longitude。

viewer.js 内の全コール:
- `web/viewer.js:112` polyline 用 `course.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + 3))` ✓
- `web/viewer.js:160` 初期 flyTo の `Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat)` ── これは `(west, south, east, north) = (minLon, minLat, maxLon, maxLat)` で公式仕様と一致 ✓
- `web/viewer.js:189` rider entity の `Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m)` ✓
- `web/viewer.js:200` camera target の `Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.elevation_m + 1.5)` ✓

start / goal marker は line 124-134 で `cart[0]` / `cart[cart.length-1]` を再利用しており、独立 swap 機会なし。

### Step 3. GPX → course.json export での lat/lon の swap

**OK、swap なし。**

`src/fujihc/course.py:98-111` の `export_json`:

```python
data = [
    {
        "distance_m": round(p.distance_m, 2),
        "elevation_m": round(p.elevation_m, 2),
        "slope_pct": round(p.slope_pct, 3),
        "lat": p.lat,
        "lon": p.lon,
    }
    for p in course
]
```

`CoursePoint.lat = p.latitude`、`CoursePoint.lon = p.longitude` が `load_course` line 60 で正しく代入されている。export 側で swap も name 取り違いも無い。

### Step 4. GPX trkpt 1 行目 と course.json 1 行目 cross-check

**OK、完全一致。**

GPX 1 行目 (`fujihc-course.gpx:13-15`):
```xml
<trkpt lat="35.45215" lon="138.75866">
  <ele>1061.3</ele>
</trkpt>
```

course.json 1 行目:
```json
{"distance_m": 0.0, "elevation_m": 1061.3, "slope_pct": 0.0, "lat": 35.45215, "lon": 138.75866}
```

最終 trkpt:
- GPX: `lat="35.39399" lon="138.73109"`, ele=2303.4
- course.json: `lat=35.39399, lon=138.73109, ele=2303.4, distance_m=23987.98`

一致。

### Step 5. GPX の lat/lon と富士スバルラインの地理的合致

**OK、一致する。**

ユーザーが言及した参照点「緯度 35.452 / 経度 138.758 = 富士スバルライン入口」と GPX 1 点目 `lat=35.45215, lon=138.75866` は小数 4 桁レベルで一致。

course 全体の bbox:
- lat: 35.37303 .. 35.45215 (南北約 8.8 km)
- lon: 138.69005 .. 138.75866 (東西約 6.2 km @ lat 35.4°)
- 中心: lat=35.41259, lon=138.72436

主要点の地理対応:
- 0% (距離 0): `35.4522, 138.7587, 1061m` — 富士スバルライン料金所付近
- 5% (距離 2.2km): `35.438, 138.744, 1204m` — 樹海ライン上方の森林
- 50% (距離 12.2km): `35.406, 138.696, 1767m` — 富士スバルライン中腹
- 100% (距離 24.0km): `35.394, 138.731, 2303m` — 五合目駐車場 (公称座標 35.394, 138.731 / 2305m と一致)

ユーザー報告の HUD 値 `dist=1255m / ele=1132m` に最も近い course 点は `index=61, dist=1296m, lat=35.44432, lon=138.74961, ele=1139.3m`。これは富士スバルラインの **下部森林**、河口湖町大石 (lat 35.519、湖の北岸) からは南に **約 8 km 離れた地点**。地理的に「大石」とは一致しない。

ただし ── ユーザーが画面で見ているのが「camera 視野に入る OSM タイル」なら、平面地球 (`EllipsoidTerrainProvider`) 上で標高 1132m に浮いた rider を直近 10m 後方から見ているので、視野には数百 m 〜数 km 四方の OSM 平面タイルが入る。OSM タイル上の道路や建物配置が河口湖周辺の地理を表示している可能性は十分あり、それを「住宅地」と誤認するのは無理ではない (← 座標 bug ではなく terrain/imagery 軸の問題)。

---

## 「水色走者が変な所」を生む可能性のあるバグ list

座標変換に直接関係する候補のみ。確度順:

### (A) 中確度 — heading 計算が緯度補正抜けで度を直接 atan2 してる

`web/viewer.js:194-196`:
```javascript
const dLon = course[nextIdx].lon - p.lon;
const dLat = course[nextIdx].lat - p.lat;
const travelHeading = Math.atan2(dLon, dLat);    // 進行方位 (radians, 北 = 0)
```

`dLon` と `dLat` は **度差**であって、地表上の距離差ではない。緯度 35° では `1° lon ≈ cos(35°) × 1° lat ≈ 0.819 × 1° lat`。`atan2(dLon, dLat)` は「進行ベクトルの東西成分」を東西実距離の **82%** に過小評価する。結果、heading が **真の方位より南北軸方向に最大数度〜十数度ズレる**。

- スタート区間 (5 点先) で実測: code は heading=-156.2°、正解=-160.2°、bias 約 4°
- 急な東西成分が大きい区間ではもっと大きくズレる

走者の **位置** (rider entity の lat/lon) は影響を受けない (line 189 の position 計算には heading が登場しない)。影響するのは **camera の置き場所** ── ENU 座標で `(-sinH*10, -cosH*10, 4)` のオフセット方向、つまり「rider から見てどの方角に camera を置くか」が傾く。

ユーザーが「想定外の場所」と言っているのが、走者 marker のスクリーン上の表示位置 (= camera が映している景色とのズレ感) であれば、これが寄与している。走者そのものが ECEF 座標でテレポートする話ではない。

### (B) 低確度 — `EllipsoidTerrainProvider` が標高を反映しない

`web/viewer.js:16` で `terrainProvider: new Cesium.EllipsoidTerrainProvider()` ── これは標準 WGS84 楕円体の表面だけ使う provider で、富士山の起伏は出ない。

rider は `fromDegrees(p.lon, p.lat, p.elevation_m)` で標高 1132m の **空中**に置かれる。下にあるはずの山が無いので、ユーザーは「空中を浮いてる走者」を見ることになる。これが「変な所」に見える原因にはなるが、座標変換 bug ではなく terrain 軸の問題。

座標変換軸で言える注意点は: rider の standard `point` entity は `heightReference: HeightReference.NONE` (line 144) なので、地表に snap せず指定座標の上空にそのまま現れる。Cesium の `EllipsoidTerrainProvider` と `HeightReference.NONE` の組み合わせで「平面の楕円体表面の上空 1132m に浮いた cyan 点」になる。

### (C) 低確度 — camera up vector が ECEF normal、地理的真上ではない

`web/viewer.js:212` `const up = Cesium.Cartesian3.normalize(cameraPos, ...)` ── これは ECEF 原点から camera を結ぶベクトルの単位化。WGS84 楕円体の場合、これは厳密には「楕円体表面の法線」ではなく「地心方向の逆」(geocentric up)。緯度 35° では geographic up (geodetic normal) と geocentric up の差は最大 0.2° 程度なので可視差はほぼ無い。許容範囲。

### (D) 否定済 — Cartesian3.fromDegrees の引数順 swap

全 4 箇所で `(lon, lat, height)` 順。Cesium 公式仕様と一致。NG なし。

### (E) 否定済 — GPX → course.json export で swap

`p.lat = p.latitude`, `p.lon = p.longitude`、export 側も `"lat": p.lat, "lon": p.lon`。NG なし。

### (F) 否定済 — haversine の (lat, lon) と (lon, lat) 取り違い

呼び出し側 `(p.latitude, p.longitude)`、 受け側 `a[0]=lat, a[1]=lon`。一致。NG なし。

---

## 最も犯人っぽい仮説 1 つ + その fix

### 仮説

ユーザーの「水色の走者が想定外の場所を走る」報告は、**座標変換軸単体では bug を引き起こしていない**。最有力候補は **terrain 軸の `EllipsoidTerrainProvider` で富士山が平面のままになっていること** + **OSM imagery タイルが富士山周辺の標高無視の平面画像であること**。座標は正しく富士スバルライン下部森林を指しているが、平面地球 + 平面 OSM タイル + 走者が標高 1132m に浮かんでいる構図のため、camera から見ると「現実の富士山の中腹森林」ではなく「平面に伸びた OSM タイル」が映る。ユーザーは tile 上の道路網や河口湖周辺の地名を見て「住宅地」と誤認している可能性が高い。

座標変換軸内で**唯一実害の出る bug** は heading 計算の緯度補正抜け (上記 A) だが、これは「camera が真後ろからずれる」程度の影響で、rider 位置そのものを移動させない。

### Fix

(座標変換軸内で fix できる範囲のみ。terrain/imagery 軸は別軸の担当)

`web/viewer.js:194-196` を以下に置き換え:

```javascript
const dLon = course[nextIdx].lon - p.lon;
const dLat = course[nextIdx].lat - p.lat;
const latRad = p.lat * Math.PI / 180;
const dLonM = dLon * Math.cos(latRad);  // 東西成分をメートル比に補正
const travelHeading = Math.atan2(dLonM, dLat);    // 進行方位 (radians, 北 = 0)
```

これで heading 計算が地表上の真の進行方位を出すようになり、camera が rider 真後ろに正しく付く。

ただし座標軸として user の主訴 (「走者が想定外の場所」) を解決するなら、terrain 軸で `Cesium.createWorldTerrainAsync()` (ION 必要) または `CesiumTerrainProvider` (自前 terrain tile) を入れて富士山の起伏を表示し、`heightReference: Cesium.HeightReference.CLAMP_TO_GROUND` で走者を地表に貼り付けるのが本質的な fix。これは座標変換軸の外。

## まとめ

- 座標変換は **5 step すべて OK**。haversine、`fromDegrees(lon, lat, height)` の引数順、 GPX export での swap なし、GPX と course.json の 1 行目完全一致、座標と実地理 (富士スバルライン) の一致を確認した。
- 座標軸内で唯一実害のある bug は `travelHeading = atan2(dLon, dLat)` の緯度補正抜け。camera の真後ろからのズレを生むが、rider 位置を変えない (確度: 中)。
- ユーザーの主訴 (「水色走者が想定外の場所」) を座標軸だけで説明する bug は見つからなかった。最有力は terrain/imagery 軸 (`EllipsoidTerrainProvider` で平面地球扱い + OSM タイル imagery で標高反映なし)。
- 関連ファイル:
  - `C:/Users/yuuji/fujihc-trainer/src/fujihc/course.py:29-76` (haversine, load_course)
  - `C:/Users/yuuji/fujihc-trainer/src/fujihc/course.py:98-111` (export_json)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:112` (polyline)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:160` (Rectangle.fromDegrees)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:189` (rider position)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:194-196` (heading bug、緯度補正抜け)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:200` (camera target)
  - `C:/Users/yuuji/fujihc-trainer/web/viewer.js:212` (up vector)
