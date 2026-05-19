---
brief: 01-mvp-definition
title: MVP 機能定義 — 最小動く形
---

# Brief 01: MVP の最小機能セット

## 何が「動く」と言える状態か

1. 富士ヒル GPX を選択
2. 3D 地形 + ルートが画面に出る (camera は ride 進行に追従)
3. smart trainer (FTMS) に勾配が送られる、勾配が変わる
4. trainer からの踏力 / 速度を受信、ride 進行が距離単位で進む
5. 完走時にログ保存 (距離 / 時間 / power / HR)

これ全部入って 1 ride 完走したら MVP 達成。

## 外す機能 (MVP 外)

- 他コース (= 富士ヒル 1 個固定)
- multi-user / オンライン対戦
- avatar 表示 (= yuuji 自身を 3D character で描く)
- 動画オーバーレイ (= 実写ライド映像、Rouvy 風)
- Strava 自動 upload (= 後で手で .fit ファイル投入)
- ERG mode / workout planner

## 完了基準

trainer + PC を実際に接続して、富士ヒル GPX で 24km / 5 分 (= 4.8 km/h 想定の早送り test ride) を完走、ログが書き出される。yuuji 自身が 1 回試走できる状態。

## 主リスク

- trainer の機種特定 (= yuuji が持ってる smart trainer は何か?)、対応 FTMS バージョンによっては勾配コマンド受け付け不可
- 3D 表示が重くて低 FPS、視点酔いで使い物にならない
