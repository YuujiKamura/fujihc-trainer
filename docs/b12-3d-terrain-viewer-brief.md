# brief b12: fujihc-trainer を「任意ヒルクライム trainer」に一般化する設計
（Three.js 改訂版 — 描画エンジンの判断を初版から反転）

## これは何をしたいのか

今の fujihc-trainer は富士ヒルクライム専用。コースの座標、地形タイルの範囲、
中心座標、表示名が viewer-maplibre.js のあちこちにハードコードされている。

やりたいのは「富士ヒル以外のヒルクライムコースも走れるようにする」。
そのために コース・地形 を差し替え可能にし、HUD / minimap / BLE /
物理シミュ など作り込んだ UI 部品は どのコースでもそのまま使い回す。

---

## 改訂の経緯（なぜ初版を書き直したか）

初版は「描画エンジンを MapLibre 1 本にする、Three.js は捨てる」と設計した。
これは誤りだった。

- MapLibre の `setTerrain` は 3D 地形メッシュを描画エンジン側 (GPU) で生成する。
  アプリ側から地形メッシュ・カメラ・ライダーの 3D 配置を自由に制御できない。
- 「地点標高を取る API があるから MapLibre で足りる」と初版は判断したが、
  標高が取れるかではなく **3D 描画の自由度** が問題の本質だった。
- 正しい設計: 描画エンジンは **Three.js**。viewer-maplibre.js を base に保ち、
  その中の「地図を描く部分」だけを Three.js 実装に差し替える。

---

## 調査で分かったこと（実コードを 2 体の調査エージェントで精読、初版から引き継ぎ）

### viewer-maplibre.js (3129 行) の現状
- 3000 行超のうち、**地図ライブラリ (MapLibre) に直接触る行は約 100 行**:
  1. `gsidem://` カスタムプロトコル (L104-167) — GSI PNG → Terrarium 変換の登録
  2. `loadCourse` (L1910-2111) 内の addSource / addLayer 群
  3. `tick` (L2427-2638) 内の setData / jumpTo / project
- 残りの大半 — HUD / BLE / 物理シミュ / ライダー・地形モデル /
  intro・dbinit overlay / ride 記録 / autosave / Strava 連携 / minimap —
  は地図ライブラリ非依存。**そのまま動く**。
- 富士ヒル固有のハードコード値: `FUJIHILL_DB_BOUNDS`, `FUJIHILL_DB_CENTER`,
  course URL, tile URL。

### terrain3d.html (779 行) の現状
- Three.js で地形メッシュ・コースリボン・カメラ・ライダー 3D 描画を既に持つ。
- ただし HTML 内に直書きで、HUD・物理・カメラを Three.js 用に **二重実装** して
  しまっている。これが「間違ったアーキテクチャ」と叱られた中身。
- terrain3d.js (web/lib/) の純関数 — `buildTerrainGeometry`,
  `sampleHeightBilinear` 等 — は node test 済の資産。

---

## 設計判断（この brief で決め切る、判断理由を明示）

### 判断 1: 描画エンジンは Three.js。viewer-maplibre.js を base に「地図を描く部分」だけ差し替える

- MapLibre は 3D 描画の自由度が足りない (地形メッシュ・カメラ・3D 配置を
  描画エンジン任せにする)。富士ヒルの 3D 体験には Three.js の自由な描画が要る。
- viewer-maplibre.js の UX 資産 (約 3000 行、大半が地図ライブラリ非依存) は
  base としてそのまま残す。捨てるのは地図描画の約 100 行だけ。
- terrain3d.html は「捨てる」のではなく **Phase 3 の下敷き**。その Three.js
  描画コードを、二重実装をやめてモジュールに整え直す。

### 判断 2: 複数レンダラ対応の汎用抽象レイヤーは作らない

- viewer 本体と「地図を描く部分」の間に差し替え口 (= 関数の境界) は作る。
  だがそれは Three.js 1 実装のための境界であって、「MapLibre でも Three.js でも
  動く汎用抽象」ではない。MapLibre 描画は捨てるので両対応の抽象は不要 (YAGNI)。

### 判断 3: 富士ヒル固有値を「コース定義」1 ファイルに集約（初版から不変）

- 富士ヒル固有値 (コース URL / 地形タイル範囲 / 中心座標 / 表示名) を
  `web/courses/fujihill.js` 1 ファイルに集約。別コースは定義ファイルを 1 つ
  足すだけ。「差し替え可能」の正体は抽象化ではなく固有値の注入点を 1 箇所に
  決めること。

---

## Phase 分割（「簡単なことから」「作ったら使え」）

### Phase 1: 固有値の集約（実装中）
- `web/courses/fujihill.js` に富士ヒル固有値を集約
- viewer-maplibre.js / terrain_loader.js の `FUJIHILL_*` 参照を定義経由に置換
- `courseName: 'fujihill'` のべた書き 3 件 (viewer-maplibre.js L970 / L2621 /
  L2973、autosave・ride DB 等で使用) も `fujihill.id` 参照に置換する
- **Three.js ベースでも必要な作業**なので、ワーカー34528 が実装中の成果は活きる
- 動作不変。テスト同時改修が必須 (下記「テスト破壊」参照)

#### Phase 1 のテスト破壊と同時改修（必読）
- `web/tests/zoom_bounds.test.js` は viewer-maplibre.js のソーステキストを
  `readFileSync` で読み、正規表現で `export const FUJIHILL_DB_BOUNDS` の存在を
  pin している。定数を courses/fujihill.js に移すと describe 5 グループが即死。
  → Phase 1 で同時改修。assertion を「courses/fujihill.js に dbBounds/dbCenter が
  宣言され viewer が参照している」を見る形に書き換える。
- `segment_labels_viewer` / `integration_overlay_z_order` /
  `integration_preflight_overlay` / `integration_gpx_download` /
  `clear_local_data` も source-grep 型。bounds 参照パターンへの影響を grep 確認。
- 完了条件: 改修後 `npm test` 全パス。テストを消して数を減らすのは禁止。

### Phase 2: 地図を描く部分の「差し替え口」を作る

#### Phase 2 で集約する MapLibre 依存（レビュー指摘で範囲を拡大）
初版は「addSource/addLayer/setData/jumpTo/project の 5 種類・約100行」と
見積もったが甘かった。viewer-maplibre.js の MapLibre 直接呼び出しは下記の
箇所に分布しており、そのすべてが地図描画モジュールに集約する対象:
- `loadCourse` (L1910-2111) の addSource / addLayer 群
- `tick` (L2427-2638) の setData / jumpTo / project
- `tick` の `map.project` によるライダー追随 HUD の画面座標計算 (L2508)
  — Three.js では camera 投影に対応。差し替え口の契約に必ず含める
  (省略すると ride 中の rider-hud が画面左上に固まる)
- `setupWheelZoom` / `setupPitchDrag` のカメラ操作 (L478, L484, L497, L508)
  — Three.js では別のカメラ操作機構が担う
- `maplibregl.Marker` による起点・終点ピン (L2067-2068)
- `hillshade` の paint property をいじるスライダー (L2816-2825)
- `buildMapStyle` / `COMMON_LAYERS` / `COMMON_SKY` (L178-208)
  — **削除ではなく地図描画モジュールの内側に移動**する
  (`build_map_style.test.js` が pin しているため削除すると即死)
- `maplibregl.addProtocol('gsidem', ...)` ブロック (L104-167) — GSI PNG →
  Terrarium 変換を MapLibre のプロトコル機構に登録。Three.js は
  `decodeGsiHeightGrid` を直接呼ぶのでこの登録は MapLibre 描画モジュール専用
- `bootMap` 関数全体 (L307 付近) — `maplibregl.Map` コンストラクタ (L314) と
  `registerPmtilesProtocol(maplibregl, ...)` (L311) を含む。地図インスタンスの
  生成はまるごと MapLibre 描画モジュールに入る

#### 手順
- 上記を「地図描画モジュール」1 つに集約。viewer 本体は描画モジュールに
  頼む形にする (= 差し替え口)
- **着手の最初のステップ**: viewer-maplibre.js を `readFileSync` で読む
  テストはレビューで約 36 ファイルと判明。Phase 2 着手時にこの全件を洗い出し、
  MapLibre 固有記述 (buildMapStyle / COMMON_LAYERS / map.on 等) を pin して
  いるものを特定し、Phase 2 完了条件のテストリストに組み込む

#### Phase 2 完了定義
- 上記すべての MapLibre 依存が地図描画モジュールに集約され、viewer 本体側に
  MapLibre 直接呼び出しが **ゼロ残存** であること
  (= 数えた件数ではなく「残っていない」ことをゲートにする。実装時に
  grep で残存ゼロを機械確認する)
- 洗い出した source-grep テスト全件を含め `npm test` 全パス
- 動作不変。この時点ではまだ中身は MapLibre 実装のまま

### Phase 2.5: 差し替え口を「意味ベースの粒度」に切り直す
（Phase 3 設計レビューで判明 — 40324 が b12-phase3-design.md をレビューした結果）

Phase 2 で作った map_renderer.js の差し替え口は MapLibre API 寄りの粒度
(addSource / setData 的) になっている。このままだと Three.js 実装が同じ口を
満たせず、Phase 4 が「差し替え」ではなく viewer の書き直しになる。

- viewer の loadCourse / tick に残る MapLibre 形のロジック (GeoJSON 組み立て、
  レイヤー定義、カメラオブジェクト生成) を、レンダラ側の**意味メソッド**に
  持ち上げる: `loadCourse(course, terrainData)` / `updateRider(...)` /
  `updateCamera(...)` / `render()` 等
- 今の MapLibre 実装でこの意味契約を実装し直す。Phase 3 の Three.js 実装は
  同じ意味契約を満たすだけでよくなる
- **完了定義**: 差し替え口がレンダラ非依存の意味メソッドになっている。
  動作不変、npm test 全パス
- 担当: Phase 2 を実装した 40324 (差し替え口の現状を最も把握している)

### Phase 3: Three.js 描画モジュールを作る
- Phase 2 で決めた差し替え口の契約を満たす Three.js 実装を作る。
- terrain3d.html の地形メッシュ・コースリボン・カメラ・ライダー描画を下敷きに、
  モジュールとして整える。
- **HUD / 物理 / BLE はここで再実装しない** — viewer 本体側の既存モジュールを
  そのまま使う (二重実装の禁止 = terrain3d.html の失敗を繰り返さない)。
- **地図背景 = 航空写真テクスチャ方式に決定** (ユーザー判断、未解決2 参照)。
  地形メッシュに seamlessphoto を貼る。MapLibre が描いていた道路・水域・
  土地利用のベクター地図は出さない。コースの走路はコースリボンを 3D で描く
  ので見える。
- カメラ操作は Three.js 側の機構で作り直す (Phase 2 で集約した
  setupWheelZoom / setupPitchDrag の MapLibre カメラ操作の置き換え先)。
- **Phase 3 着手前の確認 (レビュー Axis 4)**: terrain3d.html の
  `fetchLayerCanvas` は地理院タイルを外部 (cyberjapandata.gsi.go.jp) から
  直接取るフォールバック経路を持つ。Three.js 描画モジュールにこの外部
  フォールバックを持ち込まない。viewer-maplibre.js と同じ「bridge 経由の
  ローカル DB 一本」経路に統一する (CLAUDE.md の GSI 配慮・外部 fetch ゼロ原則)。

### Phase 4: 差し替えて富士ヒルで動作確認
- viewer の地図描画を MapLibre 実装から Three.js 実装に差し替える。
- 富士ヒルで ride し、画面確認 (`verify-fujihc-screen` skill, state=riding)。
- HUD / minimap / BLE / overlay が差し替え前と同じく動くことを確認。

### Phase 5: 2 本目のコースで地形データ差し替えを実証
- 2 本目に何のヒルクライムを入れるかは**未定** — Phase 5 着手時にユーザーが
  指定する (乗鞍 / ヤビツ / 富士あざみライン 等)。AI が勝手に決めない。
- 別コースの GPX (→ course.json) と地形タイル範囲をコース定義として足す。
- 2 コース両方を切り替えて走り、画面確認する。

---

## terrain3d.html の扱い
- 「捨てる」ではなく Phase 3 の素材 (Three.js 描画モジュールの下敷き)。
- `web/lib/` の純関数モジュール (terrain3d.js / road_polygon.js 等) と
  `terrain3d.test.js` は資産として残す。
- Phase 3 完了後、terrain3d.html 本体 (HTML 直書きの実験ページ) は役目を終える。
  その時点で sandbox 退避または削除。

---

## テスト方針

1. Phase ごとに `npm test` (vitest) と `python -m pytest` を実走、
   passed/failed 数を発話に含めてから次 Phase へ (CLAUDE.md Rule 1)。
2. Phase 4 完了時: viewer 画面確認 (`verify-fujihc-screen` skill, state=riding)。
3. Phase 5 完了時: 2 コース両方で画面確認。

---

## GSI / OSM タイル配慮（CLAUDE.md 最重要制約 — 変更しない）

- `GSI_FETCH_LIMIT = 6` / `MAX_TILES = 200` — 変更禁止。
- seamlessphoto 固定、std/relief/hybrid 追加禁止。
- IndexedDB タイルキャッシュ (`openTileCache`) を外さない。
- `© 国土地理院タイル` クレジット維持。
- `bridge.py` `127.0.0.1` bind 固定。
- Three.js 描画モジュールも DEM タイル取得は既存の取得経路・上限を守る。

---

## 未解決 / 要調査（確証がないものは確証あるように書かない）

1. **drape (コースを地形の起伏に沿わせる)**: Three.js ベースでは
   terrain3d.js の `sampleHeightBilinear` で CPU 上の標高グリッドから任意点の
   標高が引ける。terrain3d.html が既にこの手法でリボンを地形に貼っている。
   → Three.js ベースでは drape は未解決ではなく「手法が既にある」。Phase 3 で
   そのまま使う。

2. **OSM 地図背景の扱い → 決定済み (航空写真テクスチャ方式)**:
   MapLibre 版は OSM ベクタータイルで道路・水域・土地利用を描いていた。
   Three.js では地形メッシュに航空写真 (seamlessphoto) を貼る方式に決定
   (ユーザー判断)。道路・水域のベクター線は出さない。コースの走路は
   コースリボンを 3D で描くので見える。Phase 3 で実装。
   → これにより MapLibre style 定義 (buildMapStyle / COMMON_LAYERS) の
   vector layer 群は Three.js 移行後は不要になる。terrain3d.html の
   seamlessphoto テクスチャ取得経路が下敷き。

3. **minimap**: Canvas 2D 直描画で MapLibre 非依存。Three.js 化の影響を
   受けないはず。Phase 4 で実際に動くことを確認。

---

## 7 軸レビュー依頼

以下の軸それぞれに PASS / WARN / FAIL + 具体的根拠 (行番号付きが望ましい):
1. 目的の明確さ（何を達成したいか、なぜ今か）
2. スコープの適切さ（やりすぎ / 足りなさ、Phase 1-5 の分割は妥当か）
3. 既存コードへの影響（breaking change リスク、test への影響）
4. GSI / OSM タイル配慮（CLAUDE.md 制約を破っていないか）
5. UX 整合性（viewer の既存 state machine と噛み合うか）
6. 実装可能性（未解決の技術的問題、特に未解決 2 = OSM 地図背景の扱い）
7. 省略できるもの（YAGNI、この設計で過剰なもの）

各軸に「ここを直せば Phase 2 に進んでよい」という条件も書くこと
(Phase 1 は実装中のため、レビューの GO 判定対象は Phase 2 以降)。
