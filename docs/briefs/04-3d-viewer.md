---
brief: 04-3d-viewer
title: 3D 地形 + GPX 描画の具体実装
---

# Brief 04: viewer (Cesium 前提)

## 地形

- terrain source: Cesium World Terrain (無料 tier、要 Ion access token) または OpenTopography SRTM 30m
- 富士周辺の地形精度: SRTM 30m で 1242m up コースは充分視認可能、より高解像が要れば Cesium Ion 課金 path

## GPX 描画

- GPX → Cesium Entity polyline、地表 clamp ON
- 勾配 by 区間で色変える (例: 0-5% 緑、5-10% 黄、10-15% 橙、15+% 赤)、yuuji が次の登りを視覚で予測可

## camera

- 進行距離に応じて GPX 上の現在地に camera を置く
- mode 2 つ: 一人称 (ride 視点、後方下向き) / 三人称 (上空後方)
- 切替えはキー or UI button

## HUD

- 速度 / 距離 / 残距離 / 現在勾配 / 標高 / 経過時間 / 心拍 (HR モニタ繋げば) / power / cadence
- HUD は最小 sizing で coursing 邪魔しない

## UI 構成

- ride 前: GPX 選択 + trainer 接続状態 + start ボタン
- ride 中: HUD only、map は 3D 一杯
- ride 後: log summary (距離/時間/avg power/合計上昇) + Strava / fit エクスポート

## 性能 / 描画

- 富士周辺 30m mesh で 1968 trkpt 描画、modern GPU で 60fps 想定
- low-end fallback: 地形を simple 縦断プロファイル (2D) に切替
