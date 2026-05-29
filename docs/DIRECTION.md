# fujihc-trainer ── プロジェクト方針 (2026-05-17 確定)

## Path B: MapLibre から Three.js への移行

現行の MapLibre GL JS viewer から脱却し、**Three.js のメッシュ地形 viewer に本番を移行する**
方針が確定している。これは確定方針であり、実験ではない。

- 現 viewer (`web/index.html` / `web/viewer-map3d.js`) = MapLibre ベース。本物の3D
  オブジェクトが置けず (rider が角柱「豆腐」、球が描けない)、汎用地図エンジンの
  overhead を抱える。アプリは富士ヒル24km1本の固定コースしか使わない。
- 目標 = `web/terrain3d.html` (Three.js メッシュ地形、DEM から構築済) を土台に、
  本番 viewer を Three.js で組み直す。
- 移行方針 = 描画層だけ差し替え、ロジック (物理 / BLE ペアリング / autosave / HUD /
  course データ) は再利用。多くは MapLibre 非依存。
- 石の順: 地形(済) → コース道路 → 3D rider (本物の自転車) → 物理駆動 → 追従カメラ
  → HUD → ペアリング/モード → index.html を Three.js 版に切替。
- MapLibre 版は Three.js 版が機能完成するまで残す (動いてる物を壊さない)。

## 各セッションへの含意

- **MapLibre viewer への新規作業 = 暫定版**。good-enough で止め、symbol レイヤー等の
  作り込みに消耗しない。
- **Three.js / terrain3d 側の作業 = 本線・最優先**。
- 「地面に焼き込んだ数字 (テクスチャータイル)」「本物の3D自転車 rider」など、MapLibre で
  難しく Three.js で素直なものは、Three.js 側で正しくやる。
