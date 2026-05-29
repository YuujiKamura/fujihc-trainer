# ブリーフ b11 ── MapLibre から Three.js への viewer 移行計画

## はじめに

fujihc-trainer の本番 viewer を、現行の MapLibre GL JS から Three.js のメッシュ
地形 viewer に移行する。本ブリーフは「どう移行するか」の計画そのもの ── 個別の
実装ブリーフではなく、移行全体の段取り・順序・二重メンテ方針・切替・検証を定める。

初版を 7 軸監査にかけた結果、現状アーキテクチャの見立てが b10 の結合度調査の
事実とズレていた・切替と二重メンテの段取りが空欄だった、という指摘が出た。本版は
それを全部埋めた改訂版。さらに「TypeScript を採るべきか」という論点に節を 1 つ
割いた。

## なぜ移行するか (確定方針)

- MapLibre は地図エンジンであって 3D エンジンではない。本物の 3D オブジェクトが
  置けず、rider は角柱 (豆腐) にしかならない、球も描けない。
- 「世界中どこでもパンできる」汎用地図エンジンの負荷を毎フレーム抱えるが、本アプリ
  は富士ヒル 24km 1 本の固定コースしか使わない。
- 地形メッシュは DEM から既に Three.js で構築できている (terrain3d.html /
  lib/terrain3d.js、b7)。土台は立っている。

## 現状アーキテクチャ (b10 結合度調査の確定版)

viewer-map3d.js (2946 行) は配線役 ── lib/ の約 40 モジュールを import して
MapLibre につないでいる。b10 で全モジュールを grep 調査した結果、**lib/ には
MapLibre API の実呼び出しが 1 つも無い** (ヒットはコメントのみ)。ロジックの本体は
既にクリーンに分離済みで、これは移行に大きく有利。

MapLibre への結合は viewer-map3d.js 本体の 4 箇所に局所化している:
地図初期化と style/source/protocol、route と rider の addLayer/addSource/setData、
カメラ適用の map.jumpTo、hillshade の setPaintProperty。

モジュールを 3 つに分類する (ラベルは名詞で統一):

- **再利用** ── lib/ の純ロジックモジュール。Three.js 版でそのまま import する。
  bike_physics (integratePhysics)、ride_state / rider / heading / terrain
  (Terrain と Rider の 2 層モデル ── b10 で MapLibre 非依存・DOM 非依存と確定、
  初版が「要調査」に置いていたのは誤り、再利用で確定)、course_sections、
  route_styling の勾配色 (gradeColorContinuous)、terrain3d / terrain_mesh /
  terrarium / terrain_loader / tile_math、ws_client、ble_client、ftms_parse、
  ride_autosave、ride_db、consent、clear_local_data、preflight_check、
  check_setup_status、save_summary、postride_buttons、history_row、
  strava_oauth / strava_upload、gpx_builder / gpx_smooth。
  camera_controller もここ ── computeCameraParams は中心座標・ズーム・ピッチ・
  ベアリングを返す純関数で MapLibre オブジェクトに触らない。モジュール自体は
  再利用し、その出力を Three.js カメラへ変換するアダプタを別途書く (Phase 5)。
- **置換** ── MapLibre 描画に結合、または MapLibre 専用で Three.js 版では作り直す。
  road_polygon (道路描画 ── b10 でリボン mesh として buildCourseRibbon を実装済、
  着手済)、rider_styles (rider 描画 ── 3D 自転車 mesh に置換)、pmtiles_loader と
  frame_diff (どちらも MapLibre 専用、Three.js 版では不要)。
- **抽出** ── viewer-map3d.js 本体に inline で、独立モジュールが存在しない。
  Three.js 版で使うには先にモジュールへ括り出す。HUD ── 時間/距離/標高/勾配/速度/
  パワー/ケイデンス/心拍 の表示更新が viewer 本体のフレーム処理内に setText で
  80 箇所以上べた書き、専用モジュール無し。BLE ペアリングの overlay 表示更新も
  本体 inline。これらは MapLibre 非依存なので抽出リスクは無いが、手間はかかる。

## TypeScript 採用の是非

移行を機に TypeScript を採るか、という論点。

- **利点** ── 約 40 の lib モジュールを Three.js 版へ配線し直す大規模移行で、型が
  インターフェースの不整合 (引数の数違い・戻り値の形違い) をコンパイル時に捕まえる。
  リファクタが安全になる。モジュールの契約 (何を受け何を返すか) がコードに明示される。
- **コスト** ── 現状は no-build の静的サイト。importmap と vendored Three.js で
  ビルド無しに動いている。TypeScript は tsc のビルド段を足す ── 開発と CI に
  build ステップが増え、今の手軽さが減る。
- **推奨形** ── 全面移行はしない。新規に書く Three.js viewer のコードだけ
  TypeScript で書く。引退させる MapLibre 側の JS は触らない。再利用する lib は
  当面 JS のまま (型が欲しくなったら後で JSDoc か .d.ts を足せる)。
- **結論** ── 「新規 Three.js コードのみ TypeScript、既存 JS はそのまま」。これなら
  大規模移行で一番効く所 (新規配線コードの型) に型を入れつつ、ビルド段の影響を
  新コードに閉じ込められる。全面 TS 化を移行のついでにやるのは scope を膨らませる
  だけなので採らない。

## やること (移行の段取り)

新しい配線役 (viewer-three.html / viewer-three.js) を作り、再利用群を import、
置換群を Three.js 実装に差し替える。石を 1 つずつ、各石を実画面で確認してから次へ。

- **Phase 0 ── 下ごしらえ (HUD 抽出)**: viewer-map3d.js 本体に inline な HUD を
  hud.js モジュールへ括り出す。MapLibre 非依存なので抽出リスクは無い。既存の
  MapLibre viewer をその hud.js を使う形に変え、テスト緑を確認。これで Three.js
  版も同じ hud.js を import できる。初版の「Phase 0 = 結合度調査」は b10 で完了
  済みなので、Phase 0 の中身を実際に残っている下ごしらえ (HUD 抽出) に置き換えた。
- **Phase 1 ── 地形 + コース道路**: terrain3d にコースを地形追従のリボン mesh で
  載せる。b10 で実装済。
- **Phase 2 ── 道路の数字**: 距離・勾配を道路テクスチャに焼き込む。リボンには既に
  uv を仕込んである。
- **Phase 3 ── rider**: 本物の 3D 自転車 mesh を道路に置く。
- **Phase 4 ── 物理駆動**: integratePhysics で rider をコースに沿って走らせる。
  物理も rider モデルも再利用群の純モジュール、そのまま使う。
- **Phase 5 ── 追従カメラ**: computeCameraParams (再利用) の出力を Three.js
  カメラへ変換するアダプタを書き、rider 追従ループをつなぐ。
- **Phase 6 ── HUD / ミニマップ配線**: Phase 0 で抽出した hud.js を viewer-three
  に配線する。
- **Phase 7 ── ペアリング / モード / autosave 配線**: ws_client / ble_client /
  ride_autosave / preflight / consent を viewer-three につなぐ。TEST MODE も。
- **Phase 8 ── 切替**: 下記「切替の段取り」の通り index.html を切り替える。

Phase 0 → 1 → … → 8 の番号はそのまま実装順。各 Phase は前の Phase の成果に
依存する (例: Phase 5 のカメラは Phase 4 で動く rider を必要とする)。

## 二重メンテの方針

MapLibre 版は Three.js 版が Phase 8 まで機能完成するまで残す。並走期間中の
バグ修正の入れ先を決めておく:

- 再利用群の lib/ モジュールのバグは lib/ に 1 回直せば両版に効く ── そこに入れる。
- 描画・配線のバグは、MapLibre 版にはユーザーが実際に困るものだけ修正を入れる。
- 新機能は Three.js 版だけに入れる。MapLibre 版は機能凍結。
- Three.js 版が本線、MapLibre 版は繋ぎ ── 迷ったら Three.js 版を優先。

## 切替の段取り (Phase 8 の中身)

- 移行中、Three.js 版は viewer-three.html という別パスで開発・並走させる。
  index.html (= MapLibre 版) はこの間ずっと触らない。
- Phase 8 の切替は 1 コミットで行う: index.html が読み込む viewer を
  viewer-three に向け替え、sw.js の PRECACHE_URLS を viewer-three 系に差し替える。
- 戻し方: この切替コミット 1 つを revert すれば MapLibre 版に戻る。切替を 1
  コミットに閉じ込めるのはこの revert 経路を 1 手にするため。
- Service Worker: sw.js は html/js を network-first で配るので (master の現行仕様)、
  viewer-three.html も viewer-three.js も常に最新が出る。古い版がキャッシュに
  詰まる事故は起きない。念のため切替コミットで CACHE_NAME を 1 つ bump し、旧
  キャッシュを一掃する。
- 切替前に viewer-three が Phase 7 まで機能完成していることを実画面で確認する。

## リスク

- **物理駆動の接続**: 物理は MapLibre 版で rider の走行距離を動かしていた。
  Three.js 版でも同じ rider モデルを使うが、位置の適用先 (MapLibre の Marker
  ではなく Three.js の mesh) が変わる。rider の位置をどう mesh に渡すかは Phase
  3-4 で詰める。
- **カメラ**: MapLibre のカメラ (ピッチ/ベアリング/ズーム) と Three.js の自由
  カメラは別物。computeCameraParams の出力をどう Three.js カメラに写すかの
  アダプタが Phase 5 の山。
- **性能**: Three.js 版が低 VRAM GPU (RX 6400) で軽く動くか。b2 で MapLibre 版の
  毎フレームコストを削ったのと同じ規律を Three.js 側にも適用する。
- **二重メンテ期間**: 上記「二重メンテの方針」で入れ先を固定済。

## 検証

- 各 Phase のコミット前に `npm test` 全緑を gate にする ── 再利用群の lib/
  モジュールの単体テストが移行を通して緑であることを、各石ごとに機械的に確認する。
- 移行中に MapLibre 版を壊していないことは、既存の viewer 系テスト
  (viewer_*.test.js など) が緑のままであることで担保する。
- Three.js 版の描画モジュール (リボン、rider mesh など) には、データ経路
  (頂点・index・uv・色・座標範囲) の単体テストを足す。canvas タグの存在だけを見る
  ような中身を確かめないテストは書かない。
- 描画そのものは各 Phase で実画面 (desk_capture で実 Chrome) を目視確認してから
  次の石へ進む。

## セキュリティ

- terrain3d は DEM タイルを bridge のローカル DB 優先で取得し、無ければ GSI
  online にフォールバックする (b10 で実装済)。移行で GSI / OSM への新規の大量
  アクセスを増やさない ── 取得は 1 画面 1 回、同時接続を絞る既存方針を維持。
- 地形・地図画像の出典「国土地理院」を viewer 画面に明記し続ける (terrain3d は
  実装済、viewer-three にも引き継ぐ)。
- Strava の token は OAuth で取得した本人分のみ、ローカル保存と本人画面表示に
  限る ── git に入れない。移行で strava_oauth / strava_upload を再利用する際も
  この扱いを変えない。

## 制約

- push 禁止 (commit は OK)。
- MapLibre 版を Three.js 版の完成前に壊さない・消さない。
- 調査メモは repo 外 (~/.agents/scratch/fujihc-trainer-project/)。

## 参照

- Three.js BufferGeometry: https://threejs.org/docs/#api/en/core/BufferGeometry
- Three.js PerspectiveCamera: https://threejs.org/docs/#api/en/cameras/PerspectiveCamera
- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/intro.html
- GSI 標高タイル仕様: https://maps.gsi.go.jp/development/demtile.html
- 既存資産: web/lib/terrain3d.js (b7/b8)、web/viewer-map3d.js、b10 結合度調査

## まとめ

ゴール = 本番 viewer を Three.js に移す。ロジックは既に lib/ に層化されていて
MapLibre 非依存と確定済みなので、移行は「配線役を書き換え、描画モジュールだけ
Three.js 版に作り直し、ロジックは再利用」。段取りは Phase 0 (HUD 抽出) → 地形+
道路 → 数字 → rider → 物理 → カメラ → HUD 配線 → 全配線 → 切替。新規コードは
TypeScript、既存 JS は据え置き。MapLibre 版は機能凍結で繋ぎとして残し、切替は
1 コミットで revert 可能にする。各石を実画面で確認しながら進める。
