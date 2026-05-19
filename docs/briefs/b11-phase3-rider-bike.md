# ブリーフ b11-Phase3 ── 3D 自転車 mesh を道路の始点に置く

## はじめに

Path B 移行 (b11) の Phase 3。terrain3d.html / lib/terrain3d.js には地形追従の
コース道路リボン (b10) と、その路面に焼いた距離・勾配テクスチャ (b11-Phase2、
このワークツリーに landed 済) が乗っている。Phase 3 は、その道路の始点に rider
の 3D 自転車 mesh を 1 つ置く ── Three.js の primitive (車輪 = トーラス、フレーム
= 円柱) で組んだ、自転車と分かる単純なモデル。MapLibre 版の rider は角柱 (豆腐)
だったが、Three.js では本物の 3D メッシュにできる (= Path B に移行する理由その
もの)。本 Phase は始点に静止で置くまで。物理で走らせるのは Phase 4。

## 現状 (読んだ結果)

- terrain3d.html はリボンを `buildCourseRibbon` で組み、`ribbon.positions`
  (Float32Array、頂点 2i=左/2i+1=右、course 点ごとに 2 頂点) を持つ。
- 始点 / 終点に球マーカー (`SphereGeometry`、半径 `span*0.008`) を置いている。
  リボン幅 `widthM = span*0.0055`、span = 地形の東西/南北の大きい方 (約 12km)。
- lib/heading.js に `computeTravelHeading` があるが、これは lat/lon course から
  方位を**度** (0=北) で返す。terrain3d は投影済み XYZ 空間で全部を扱うので、
  度を投影し直すより、リボン頂点 XYZ から進行方向を直接出す方が座標系が 1 つで
  済む ── 本 Phase は後者を採る。
- lib/rider.js = rider という主体の mutable state (距離/速度/sensor)。本 Phase は
  描画位置だけなので rider.js には触らない (Phase 4 で物理とつなぐ)。

## 用語 (この brief 内で固定)

- **rider** ── コースを走る主体 (既存 lib/rider.js の概念)。
- **自転車 mesh** ── rider の見た目。Three.js primitive で組む 3D モデル。
  関数名は `buildBikeMesh`。MapLibre 版 rider_styles.js (豆腐) の置き換え相当
  だが、rider_styles.js 自体は触らない (MapLibre 版は凍結)。
- **配置 (placement)** ── 自転車 mesh を道路のどこに・どの向きで置くか。
  位置 (position) と進行方向 (forward) の組。

## やること

### 1. 純モジュール `web/lib/rider_placement.js` (新規、DOM/Three.js/fetch 非依存)

リボン頂点から自転車 mesh の配置を出す純ロジック。terrain3d.js / road_texture.js
と同じ規律 (node test 可)。

- `ribbonCenterAt(positions, i)` → course 点 i のリボン中心 `[x,y,z]` = 左頂点
  (2i) と右頂点 (2i+1) の中点。i が範囲外は RangeError。
- `riderStartPlacement(positions, vertexCount)` →
  `{position:[x,y,z], forward:[fx,0,fz]}`。position = `ribbonCenterAt(0)`
  (始点のリボン中心)。forward = `ribbonCenterAt(1) - ribbonCenterAt(0)` の XZ
  成分を正規化 (Y は 0 ── 自転車を路面に対し水平に置くため。地形勾配への
  ピッチ追従は Phase 4/5 の領域)。始点と次点が XZ で同一 (退化) なら forward は
  `[0,0,-1]` (北向き) に fallback。vertexCount < 4 (course 2 点未満) は RangeError。

### 2. 描画 (terrain3d.html 内、Three.js 描画層なのでここに置く)

- `buildBikeMesh()` ── Three.js primitive を組み合わせた `THREE.Group` を返す。
  - 車輪 2 枚: `TorusGeometry`。前輪 (−Z 側) / 後輪 (+Z 側)。トーラスは既定で
    XY 平面のリング (法線 Z) なので、`rotation.y = π/2` で車軸を X 方向にし、
    車輪の円盤が進行方向 (Z) を含む面に立つ。
  - フレーム: `CylinderGeometry` 数本 (前後ハブを繋ぐダウンチューブ、シート
    ポスト、ハンドルポスト)。サドル/ハンドルに小さな箱を足し「自転車」と読める形に。
  - モデルは前方 = −Z、車輪の接地点が group の y=0 になる単位サイズで組む
    (= 配置側が position に置けば路面に接地)。色は路面の上で目立つ明色。
- 自転車 mesh のサイズ (load-bearing な数字、span 比例で導出):
  - 既存の基準: 道路幅 `span*0.0055` ≒ 65m、球マーカー直径 `span*0.016` ≒ 190m。
  - **長さ = `span*0.011`** ≒ 130m ── 道路幅の約 2 倍。路面上に明瞭に乗り、かつ
    マーカー直径 `span*0.016` より一回り小さく rider が主役になり過ぎない。
  - **幅 (車軸方向) = 長さ × 0.34** ── 実自転車の length:width ≒ 2.9:1 を踏襲、
    道路幅 65m に収まる (130×0.34 ≒ 44m)。
  - **高さ = 長さ × 0.62** ── 実自転車の length:height ≒ 1.6:1 を踏襲。
  - 単位モデル (長さ 1.0、幅 0.34、高さ 0.62、−Z 前方、車輪接地点 y=0) で組み、
    `bike.scale.setScalar(span*0.011)` で世界サイズへ。
- 配置: リボン構築後、`riderStartPlacement(ribbon.positions, ribbon.vertexCount)`
  で position と forward を得る。スケール済み `buildBikeMesh()` を position に置き、
  `lookAt(position + forward)` で進行方向へ向ける (mesh は −Z 前方なので lookAt
  がそのまま効く)。forward.Y=0 なので自転車は路面に対し水平。

### 3. テスト `web/tests/rider_placement.test.js`

§1 純モジュールを「落ちたら何のバグか」を 1 行で言える形で網羅。happy/edge/error:

- `ribbonCenterAt`: 左右頂点の中点を返す (happy) / i 範囲外は RangeError (error)。
- `riderStartPlacement`: position = 始点リボン中心 (happy) / forward が単位ベクトル
  (長さ 1) (happy) / forward.Y === 0 (= 水平、edge) / forward が始点→次点の向き
  (符号、happy) / 始点・次点 XZ 同一で forward = [0,0,-1] fallback (edge) /
  vertexCount < 4 は RangeError (error)。

描画 `buildBikeMesh` は Three.js primitive の組み合わせで新しい数値ロジックを
持たないため node test 対象外、実画面目視で検証する。

## 検証

- `npm test` (リポジトリ root の vitest) 全緑。新規 rider_placement テストも緑。
  既存 terrain3d / viewer 系テストが緑のまま (buildCourseRibbon・rider.js 等は無改変)。
- terrain3d.html を新規プロファイルの実 Chrome で開き desk_capture で目視 ──
  道路の始点に自転車型の rider mesh が乗っていること。raw headless 厳禁。
  期待 state: 地形 + 勾配色の道路の始点 (緑マーカー付近) に、車輪 2 枚 + フレーム
  が自転車と分かる 3D mesh が、進行方向を向いて路面に乗っている。
- MapLibre 版 (index.html 系) は触らない。
- Service Worker: 新規 `lib/rider_placement.js` は `.js`、sw.js が network-first
  で配る (`isAppShell`)。CACHE_NAME bump 不要 ── NG-R2-1 は構造的に発生しない。

## 参照

- Three.js TorusGeometry: https://threejs.org/docs/#api/en/geometries/TorusGeometry
- Three.js CylinderGeometry: https://threejs.org/docs/#api/en/geometries/CylinderGeometry
- Three.js Group: https://threejs.org/docs/#api/en/objects/Group
- Three.js Object3D.lookAt: https://threejs.org/docs/#api/en/core/Object3D.lookAt
- 既存資産: web/lib/terrain3d.js (buildCourseRibbon)、web/lib/heading.js、
  web/lib/rider.js

## リスク

- **スケール**: 道路幅は `span*0.0055` ≒ 65m と地形スケールで誇張済み。実寸
  1.7m の自転車では見えないので §やること 2 の導出値 (長さ `span*0.011`) で置く。
  導出は span 比例の初期値 ── 第一実装後に desk_capture で見て大き過ぎ/小さ過ぎ
  なら乗数を調整して再目視する。
- **接地**: リボンは地形表面の少し上に drape 済。自転車を `ribbonCenterAt(0)`
  (リボン中心の Y) に置き、mesh の y=0 = 車輪接地点にしておけば路面に乗る。
- **向き**: 自転車を −Z 前方で組み、forward も terrain3d の投影 XZ 空間で出す
  ので、lookAt 一発で向く。度↔投影の変換を挟まないため符号ミスの余地が小さい。

## 制約

- push 禁止、commit (worktree) は OK。MapLibre 版を壊さない・消さない。
- 調査メモ・本ブリーフは repo 外 (~/.agents/scratch/)。

## まとめ

Phase 3 = リボンの始点に rider の 3D 自転車 mesh を静止で置く。配置の純ロジック
(リボン中心・進行方向) を `rider_placement.js` に出して node test で pin、
自転車 mesh は Three.js primitive (トーラス車輪 + 円柱フレーム) を `buildBikeMesh`
で組み terrain3d.html に置く。向きは投影 XZ 空間の forward を lookAt に渡すだけ。
物理駆動は Phase 4。検証は npm test 全緑 + 実 Chrome 目視。
