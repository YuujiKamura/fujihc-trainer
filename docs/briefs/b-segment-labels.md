# brief: 道路勾配セグメントに距離・勾配のテキストラベルを載せる

## はじめに

fujihc-trainer の MapLibre viewer は、富士ヒルコースを勾配色 (連続グラデ) で塗った
道路 polygon (`route` source、約 1968 セグメント) として描いている。各 polygon feature
の properties には `distance_m_start` / `distance_m_end` / `slope_pct` / `grade` / `color`
が既に入っている。この brief は、その上に「距離と勾配の数字」をテキストで載せて、
コースのどこが何 % の坂かを画面で読めるようにする 1 機能を足す。

reader (= 実装する worker) はこの brief だけで独立に実装できるべき。最後の「まとめ」に
完了条件を置く。

## 背景の制約: glyphs が無い

MapLibre の `symbol` レイヤーで `text-field` を描くには style に `glyphs` URL が必須。
`buildMapStyle` が返す style に `glyphs` は無く、フォント PBF をローカル配信する infra も
プロジェクトに存在しない (`web/` 配下に font / glyph ディレクトリなし)。CDN 依存の glyphs
を足すと offline / static mode で text が無音で壊れる。

→ **symbol レイヤーは採用しない。** viewer が start/goal pin で既に使っている
`maplibregl.Marker` (DOM 要素) でラベルを描く。DOM なので glyphs 不要、CSS で可読性を
完全制御でき、offline でも壊れない。「既にある物 (Marker パターン) を使う」「簡単な方から」。

## 何を作るか

### 1. 新 lib `web/lib/segment_labels.js` (pure functions、単体テスト対象)

両関数とも `export` する (= route_styling.js / road_polygon.js と同じく単体テストから
import 可能にする。export を付け忘れると test 不能 = NG-R1-9 再演)。

- `export function formatSegmentLabel(distance_m, slope_pct)` → 表示文字列
  - 距離: `(distance_m / 1000).toFixed(1) + 'km'` (例 2400 → `"2.4km"`)
  - 勾配: `slope_pct.toFixed(1) + '%'` (負値も素直に、例 -1.2 → `"-1.2%"`)
  - 連結: `"2.4km / 6.7%"`
  - null/undefined/NaN の distance / slope は `0` 扱い (route_styling と同じ安全側)
- `export function buildSegmentLabels(polygonFC, intervalM = 500)` → ラベル配列
  - 入力は `buildGradeColoredRoadPolygons` が返す Polygon FeatureCollection
  - `distance_m_start` を見て、`intervalM` (m) ごとに 1 セグメントを 1 ラベルとして抽出
    (= 一定間隔の間引き)。アルゴリズムは決定的:
    - `threshold` を `intervalM` で初期化
    - features を順に走査、`distance_m_start >= threshold` のセグメントに当たったら
      そのセグメントを 1 ラベルとして emit
    - emit 後 `while (distance_m_start >= threshold) threshold += intervalM`
      (= セグメント間隔より intervalM が狭い / gap がある場合に閾値を複数段進めて
      二重 emit を防ぐ)
  - 各ラベルの座標 = その polygon の 4 角 (閉じ重複点を除く) の平均 (= セグメント中心線の中点)
  - 戻り値要素: `{ lon, lat, text, distance_m, slope_pct }`
    (`distance_m` は採用セグメントの `distance_m_start`、`text` は `formatSegmentLabel` の結果)
  - `distance_m_start` が null のセグメント、空 FC、`features` 不在は安全に skip / `[]`

#### load-bearing 数字の根拠

- **`intervalM = 500`**: 富士ヒルコースは約 24km / 約 1968 セグメント (= 1 セグメント
  ≈ 12m)。`24000m / 500m ≈ 48 ラベル`。250m なら 96 ラベル (= 走行視点で密)、1000m
  なら 24 ラベル (= 区間が粗くプロファイルが読めない)。500m ≈ 約 40 セグメントに 1 枚で、
  「コースのどこが何 % か」を読むのに過不足ない密度。default 引数なので後から調整可。
- **`LABEL_MIN_ZOOM = 16`**: ラベル div の幅は約 90px。緯度 35.4° での
  解像度は `156543 * cos(35.4°) / 2^zoom` m/px。
  - zoom 16 → 約 1.95 m/px → 500m 間隔 = 約 256px (ラベル幅 90px に対し充分離れる)
  - zoom 15 → 約 3.9 m/px → 500m = 約 128px (90px ラベルだと隙間 ≈ 38px、ぎりぎり)
  - zoom 14 → 約 7.8 m/px → 500m = 約 64px (重なって読めない)
  zoom 16 が「500m 間隔の 90px ラベルが余裕で分離する」最小 zoom。これ未満では全
  ラベルを隠す。default zoom は 21 なので通常走行中は常に表示される。

### 2. `viewer-maplibre.js`: ラベル Marker の生成

- `route-line` レイヤー追加の直後 (= `polygonData` が確定している箇所) で
  `buildSegmentLabels(polygonData, 500)` を呼ぶ
- 各ラベルにつき `maplibregl.Marker({ element })` を作って `setLngLat([lon, lat])` で
  地理座標に固定、`map` に add。生成した Marker は module 変数 `segmentLabelMarkers`
  (配列) に貯める
- Marker の element は `div.seg-label`、`textContent` にラベル文字列
- ラベルは route polygon の生成と同じ「1 回だけ」経路 (`if (!map.getSource('route'))`
  ブロック内) で作る。zoom ごとの再生成はしない (brief b2 の教訓: zoom 連動再生成は
  GPU stall を生む)

### 3. 密集対策: zoom 連動の表示/非表示

DOM Marker に MapLibre の自動デクラッタは無いため、低 zoom では 24km 分のラベルが
重なって読めない。`map.on('zoom')` で 1 つの閾値 (`LABEL_MIN_ZOOM = 16`) を境に
`segmentLabelMarkers` 各 element の CSS class (例 `.seg-label--hidden { display:none }`)
を toggle するだけ。**再生成はしない、表示属性の toggle のみ** (cheap、brief b2 安全)。
default zoom は 21 なので通常走行中はラベルが見える。

### 4. CSS (index.html か既存の style ブロック)

`.seg-label`: 等幅フォント、小さめ (11-12px)、半透明の暗い背景 (例 `rgba(20,20,28,.82)`)、
白文字、`padding` 2-4px、角丸、`pointer-events:none` (地図操作を邪魔しない)、
`white-space:nowrap`。勾配色 (緑〜紫) のどの帯の上でも読めるコントラストにする。

## どのレイヤー / どこに載るか (まとめると)

| 層 | 実体 | 役割 |
|---|---|---|
| route-fill | MapLibre `fill` | 勾配色の道路 polygon (既存) |
| route-line | MapLibre `line` | polygon の縁取り (既存) |
| **seg-label Markers** | **DOM `maplibregl.Marker` 群** | **新規: 距離+勾配のテキスト** |

## テスト

- `web/tests/segment_labels.test.js` を新設
  - `formatSegmentLabel`: 通常 / 端数丸め / 負勾配 / 0 / 1km 未満 / null・NaN 入力
  - `buildSegmentLabels`:
    - **閾値間引きの決定的 pin**: `distance_m_start` が既知の列 (例 0,200,400,…,2000) で
      作った FC を渡し、抽出されたラベルの `distance_m` 列が期待値と完全一致することを
      assert する (= gap で閾値を複数段進めるロジックを pin、misleading test を作らない)。
      例: interval 500 / starts 0,200,…,2000 → 抽出 distance = `[600,1000,1600,2000]`
    - 戻り値 properties (`lon/lat/text/distance_m/slope_pct`) の存在と型
    - 中点座標 = polygon 4 角平均であることの数値 assert
    - 空 FC / `features` 不在 / `distance_m_start` null セグメントの skip
- `web/tests/segment_labels_viewer.test.js` (= viewer-maplibre.js の source-grep pin、
  build_map_style.test.js と同じ方式): viewer-maplibre.js を読み、(a) `buildSegmentLabels`
  を import・呼出している、(b) `segmentLabelMarkers` へ Marker を貯めている、(c) zoom
  ハンドラで表示 toggle している、を正規表現で pin (= 純粋でない viewer 統合層を物理 verify)
- 既存テスト (route_styling / road_polygon / sw_cache_version 等) を壊さない
- `npm test` 全緑 (テストは repo root の vitest、`web/tests/**` を拾う)

## 実画面検証

viewer を TEST MODE (`?test=1&consent=dev`) で開き、道路の勾配帯の上に
`"X.Xkm / Y.Y%"` のラベルが読める形で点在しているかを desk_capture で実 Chrome 窓を目視。

## SW cache の bump (NG-R2-1 必須)

`viewer-maplibre.js` / `index.html` / `web/lib/*.js` の実体を変更するため、
`web/sw.js` の `CACHE_NAME` を bump し (`fujihill-v8` → `fujihill-v9`)、
`index.html` の `viewer-maplibre.js?v=36` と `sw.js` PRECACHE_URLS 内の
`viewer-maplibre.js?v=36` を同値で `?v=37` に揃える (= 半 bump 禁止、
`sw_cache_version.test.js` が CI で内部整合を検出する)。これを忘れると
cache-first の SW (重い静的資産経路) と相まって修正がブラウザに届かない。

## まとめ — 完了条件

1. `web/lib/segment_labels.js` に `export function formatSegmentLabel` /
   `export function buildSegmentLabels` を実装 (intervalM=500 / LABEL_MIN_ZOOM=16 の
   根拠コメントを地の文で添える)
2. `viewer-maplibre.js` が route polygon 生成経路でラベル Marker を 1 回だけ生成、
   zoom 連動で表示/非表示を toggle (再生成なし)
3. `.seg-label` CSS で勾配色帯の上でも可読
4. `sw.js` `CACHE_NAME` v8→v9、`index.html` と `sw.js` の `viewer-maplibre.js?v=` を
   揃えて 36→37 に bump
5. `segment_labels.test.js` + `segment_labels_viewer.test.js` 追加、`npm test` 全緑、
   既存テスト無破壊 (`sw_cache_version.test.js` 含む)
6. 実画面で距離・勾配ラベルが道路タイル上に読める形で乗っていることを目視確認
7. 専用 worktree に commit (push は厳禁)

非目標: symbol レイヤー / glyphs 配信 infra / ラベルのクリック操作 / per-frame 更新。
