# brief 24 — Zwift Climb Portal 風勾配グレード別色分け (route_styling)

## 成果物

- `web/lib/route_styling.js` (新規) — pure functions、 viewer-maplibre.js touch せず
- `web/tests/route_styling.test.js` (新規) — 29 件、 全 pass

## API

```
GRADE_THRESHOLDS               // 6 段階の {name, min, max, color} 配列
classifyGrade(slope_pct)       // -> {name, color}, null/NaN/負値は flat
buildGradeColoredRoute(course) // -> GeoJSON FeatureCollection (segment 単位 LineString)
makeGradeColorExpression()     // -> MapLibre case expression (line-color 用)
```

## グレード定義 (富士ヒル特性、 平均 5.2% / 区間最大 ~9% に合わせる)

| name      | slope_pct      | color   |
|-----------|----------------|---------|
| flat      | (-inf, 1)      | #3aa055 |
| gentle    | [1, 4)         | #a3c853 |
| moderate  | [4, 7)         | #f4d03f |
| hard      | [7, 10)        | #e67e22 |
| very_hard | [10, 15)       | #e74c3c |
| extreme   | [15, +inf)     | #8e44ad |

min inclusive / max exclusive で半開区間。 富士ヒル平均 5.2% は moderate (黄)、 区間最大 8-9% は hard (橙) に落ちる設計。

## 設計判断

- **「次区間の勾配」semantics**: segment i (course[i] -> course[i+1]) の slope_pct は `course[i+1].slope_pct` を採用 (= viewer 側 altitude profile と整合)。 fallback chain: `course[i+1].slope_pct → course[i].slope_pct → 0`。
- **防御**: null / undefined / NaN / 負値はすべて flat (緑) にフォールバック。 落ちない設計。
- **paint expression は properties.grade で分岐**: properties.color を直接 `['get', 'color']` で参照する方が短いが、 case expression の方が schema 不整合や renderer の互換性で安全 (= 旧 MapLibre や moblie で `get` の戻り型が string 制約に当たる可能性)。
- **distance_m_start / distance_m_end** を properties に含めた (= 元 spec の例 list 通り、 brief 19 viewer 側で hover tooltip / interval boundary 表示に流用想定)。

## テスト内訳 (29 件)

- `GRADE_THRESHOLDS` 構造: 2 件
- `classifyGrade` happy: 6 件 (0/2/5/8/12/20 %)
- `classifyGrade` 境界値: 6 件 (1/0.999/4/7/10/15 %)
- `classifyGrade` 異常値: 4 件 (-2 / null / undefined / NaN)
- `buildGradeColoredRoute`: 8 件 (型 / segment 数 / geometry / properties / semantics / distance / 空 / slope 欠落)
- `makeGradeColorExpression`: 3 件 (case 形式 / 全分岐 / 各条件 shape)

## 検証

```
npm test -- --run
Test Files: 10 passed (10)
Tests:      125 passed (125)
```

route_styling 29 件 + 既存 96 件すべて pass、 regression なし。

## 統合ポイント (main session への hand-off)

main が viewer-maplibre.js で `polyline` source を `buildGradeColoredRoute(course)` の結果に差し替え、 line-color paint を `makeGradeColorExpression()` に置き換える。 例:

```js
import { buildGradeColoredRoute, makeGradeColorExpression } from './lib/route_styling.js';

map.addSource('route', { type: 'geojson', data: buildGradeColoredRoute(course) });
map.addLayer({
  id: 'route',
  type: 'line',
  source: 'route',
  paint: {
    'line-color': makeGradeColorExpression(),
    'line-width': 4,
  },
});
```

DONE: brief 24
