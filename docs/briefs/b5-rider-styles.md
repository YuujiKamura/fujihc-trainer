# ブリーフ b5 ── ライダー表示スタイルを複数から選べるようにする

## はじめに

fujihc-trainer viewer の rider マーカー (= 走行中に地図上を動く自分の表示) は今
1 種類だけ ── 暗色の車体 + cyan の rider を立体で表した「自転車シルエット」。
これを複数スタイルから選んで差し替えられるようにする。実装より先に構造を決める作業。

## 背景・現状

- `web/viewer-map3d.js` の `buildRiderFeatures(lat, lon, heading, spin)` が rider の
  GeoJSON (FeatureCollection) を作る。各 feature は `{color, base, height}` を property に
  持ち、`rider` source → `rider-body` レイヤー (`fill-extrusion`) が押し出し描画する。
- tick (rAF ループ) は b2 の per-frame 最適化で、`riderFrameChanged` が真の時だけ
  `ridSrc.setData(buildRiderFeatures(...))` を呼ぶ (= 位置/向き/spin が動いた時だけ再構築)。
- 機器設定パネル (`index.html` の `#controls`、質量/慣性/転がり抵抗/空気抵抗の slider 群) が
  rider 関連の調整 UI の置き場。slider 値は localStorage に永続 (`bindSlider`/`bindBikeSlider`、
  キー `fujihill.*`)。

## やること

1. **スタイル別ビルダーへの分割**: rider GeoJSON 生成を新 module `web/lib/rider_styles.js` に
   切り出す。`buildRiderFeatures(style, lat, lon, heading, spin)` が選択スタイルで dispatch、
   スタイル別の純粋関数 (bike / gits / arrow) を呼ぶ。viewer は新 module を import して使う。
   純粋関数化でスタイルビルダーが単体テスト可能になる (現状 viewer 内関数で import 不可)。

2. **スタイル 3 種** (全て `fill-extrusion` polygon、既存 `rider-body` レイヤーで描く ──
   新レイヤーは足さない):
   - `bike` (default): 現行の自転車シルエット。挙動を 1bit も変えずそのまま移植。
   - `gits`: 上から見た平面マーカー ── リング (円の輪郭 = 外円 + 内円の穴を持つ annulus
     polygon) の中に進行方向 (heading) を向いた三角形。height は小さく (ほぼ平面)。
   - `arrow`: 進行方向を向いた単純な矢印 polygon。bike/gits と一目で区別できる色。

3. **ピッカー**: 機器設定パネルに「ライダー表示」行を追加。`<select>` で 3 スタイルを選ぶ。
   選択肢は `rider_styles.js` の `RIDER_STYLES` を単一の出所として JS で populate (HTML に
   ベタ書きして drift させない)。選択は localStorage (`fujihill.riderStyle`) に永続、
   起動時に復元。不正値は default にフォールバック。

4. **b2 最適化を壊さない**: `buildRiderFeatures` は変化検出付きで tick から呼ばれる。
   スタイル切替時は `_lastRiderFrame` を null にして次フレームで 1 回だけ再構築させる。
   毎フレーム無条件再構築には絶対戻さない。

## 検証

- `cd web && npm test` 全緑 (現 958 件を 1 件も壊さない)。`rider_styles.js` の
  スタイルビルダー単体テストを追加 ── feature 構造 / ring 閉合 / 三角形が heading 方向を
  向くこと / 不正スタイルの fallback を pin。
- 実画面: TEST MODE (`?test=1&consent=dev`) で viewer 起動、3 スタイルを順に切替えて
  各々が正しく描画されること、特に gits が「リング + 進行方向の三角」に見えることを
  `headless-shot.ps1` か deskpilot `desk_capture` で目視。raw `chrome --headless` 直叩き厳禁。
- カメラは pitch 85° の傾き視点なので平面図形は foreshorten する ── それで正しい。

## 制約

- push 禁止 (commit のみ)。物理計算には触らない。silent execution。
- 既存テストを 1 件も壊さない。新レイヤーを足さず既存 `rider-body` で描く。

## まとめ

ゴール = rider の見た目を bike / gits / arrow の 3 種から選んで差し替えられること、
選択が永続すること、実画面で 3 種とも正しく描画されること。rider GeoJSON 生成を
`rider_styles.js` の純粋関数群に切り出してスタイル dispatch + 単体テスト可能にし、
機器設定パネルにピッカーを足す。b2 の per-frame 最適化は壊さず、切替時 1 回再構築に留める。
