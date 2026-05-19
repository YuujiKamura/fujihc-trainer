---
brief: 03-oss-evaluation
title: 依存 OSS の評価 — license / maintenance / 統合難易度
---

# Brief 03: 既存 OSS をどう使うか

## QZ (qdomyos-zwift)

- license: GPL v3 (= 派生物も GPL、商用配布は要注意、個人利用は問題なし)
- maintenance: active 2025
- 機能: GPX route following + FTMS 制御 (= MVP の 50% を覆う)
- 統合方法: そのまま使う / fork して 3D viewer 連携を追加 / API 経由で外部 viewer に状態を吐く path 探る
- リスク: C++/Qt、yuuji の Rust/Python/Ruby stack と乖離、fork 改造の learning cost 高い
- 採用判定: 「使う」より「読む / 真似る」、bridge 部分の参考実装として

## pycycling

- license: MIT
- maintenance: active
- 機能: BLE trainer/HRM/power 操作の Python library
- 採用判定: trainer-bridge の core、ここに乗る

## gymnasticon

- license: MIT
- 機能: 古い bike を BT bridge、Pi 前提
- 採用判定: 不採用 (用途が逆方向)

## Cesium

- license: Apache 2.0
- 機能: 3D 地球儀 + 地形 + GPX オーバーレイ
- 採用判定: viewer の core

## Golden Cheetah

- license: GPL v3
- 機能: training analytics + trainer 接続
- 採用判定: 不採用 (重い、scope オーバー)、ただし training log フォーマット (.fit / .pwx) の reference には参照

## Three.js / Mapbox GL JS

- license: MIT / commercial mix
- 採用判定: Cesium で足りるので保留、Cesium が重ければ代替候補
