# brief 25: road_polygon report

## サマリ

course 点列を「meter 単位幅の路面 Polygon」に変換する pure-JS substrate を実装。
MapLibre の `line` layer (= pixel 単位幅, zoom で見た目変動) ではなく
`fill` / `fill-extrusion` layer に渡せる GeoJSON Polygon FeatureCollection を出力する。

## 触ったファイル

- `web/lib/road_polygon.js` (新規, 132 行)
- `web/tests/road_polygon.test.js` (新規, 181 行)

scope 外 (= 触っていない):
- `web/viewer-map3d.js` (main が統合担当)
- `web/lib/route_styling.js` (brief 24, import で再利用のみ)
- `web/lib/gpx_smooth.js` (brief 23, peer F 担当)

## 公開 API

```js
import {
  offsetSegment,
  buildRoadPolygons,
  buildGradeColoredRoadPolygons,
} from './lib/road_polygon.js';
```

- `offsetSegment(a, b, widthM)` → 4 頂点 + 閉じる頂点 (length 5) の `[lon, lat]` ring
- `buildRoadPolygons(course, widthM = 5)` → GeoJSON FeatureCollection (Polygon geometry)
- `buildGradeColoredRoadPolygons(course, widthM = 5)` → 上記 + properties に
  brief 24 の `classifyGrade` 由来の `grade` / `color` を付与

## 設計要点

- **lat/lon → meter 換算**: 緯度 `cos` 補正、 segment midLat を使用。
  富士山緯度 (35.4°) では `cos ≈ 0.815`, 1 度経度 ≈ 90730 m。
- **進行方向の左 90°**: 進行方向 `(dxM, dyM)` を CCW 回転して `(-dyM, dxM)`、
  正規化 → `widthM/2` でスケール → degree 系に戻して endpoint に ± 加算。
- **退化 segment** (= A == B, len = 0): 5 点とも A に縮退した polygon を返す
  (= 落ちず、 segment 数を保ったまま安全に通す)。
- **drift 回避**: `classifyGrade` は `route_styling.js` から import 再利用、
  再実装していない (= drift catalog NG-R1-11 同型)。
- **次区間の勾配 semantics**: brief 24 と統一、 `course[i+1].slope_pct` を採用、
  fallback `course[i].slope_pct → 0`。

## テスト結果

`npm test -- road_polygon` → **14 passed / 14 total** (340 ms)。

テスト内訳:
1. offsetSegment 北向き線分 → offset が東西方向
2. offsetSegment 東向き線分 → offset が南北方向
3. offsetSegment widthM=10 で offset の絶対値が 5m 相当 (4e-5 < |off| < 7e-5 deg)
4. offsetSegment widthM 比例性 (20/5 = 4x)
5. offsetSegment ring = length 5, 末尾 == 先頭
6. offsetSegment 退化 segment (A==B) 安全
7. buildRoadPolygons segment 数 = course.length - 1
8. buildRoadPolygons geometry.type = Polygon, coordinates[0].length = 5
9. buildRoadPolygons properties (slope_pct / distance_m_start / distance_m_end)
10. buildRoadPolygons widthM スケール反映
11. buildRoadPolygons 空 / 1点 → 空 FC
12. buildGradeColoredRoadPolygons properties に grade / color
13. buildGradeColoredRoadPolygons slope_pct null 安全 → flat 緑
14. buildGradeColoredRoadPolygons widthM 引数透過

## 全テスト suite 影響

`npm test` (全 file) → 155 passed / 1 failed / 156 total。
唯一の failure は `web/tests/gpx_smooth.test.js` の cross-language equivalence 1 件
(`fx.course_smoothed_window5` undefined = fixture loading 由来), これは
peer F が触っている brief 23 領域。 私の touch 対象外、 私の追加で発生したものではない
(road_polygon は独立 module, gpx_smooth に依存無し)。

Rule 1 (= 既存 test を壊すな) 遵守: 私の追加分は 0 regression、 14 新規 pass。

## 次の統合 (= main の作業, 私の scope 外)

main は `viewer-map3d.js` の grade-color line layer source を
`buildGradeColoredRoadPolygons(course)` の出力に差し替える。 paint property は
`fill-color` で `['get', 'color']` を読むだけ。 layer type は `fill` (平面) または
`fill-extrusion` (立体) のどちらでも properties.color が効く。

DONE: brief 25
