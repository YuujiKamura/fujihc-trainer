---
brief: 05-trainer-bridge
title: smart trainer との BLE 接続と制御
---

# Brief 05: trainer-bridge (Python + pycycling)

## 接続フロー

1. BLE スキャンで FTMS Service (UUID 0x1826) 持つ device を列挙
2. yuuji がリストから選択 (PC GUI もしくは CLI prompt)
3. 接続後、FTMS の Indoor Bike Data / Fitness Machine Status notification を subscribe
4. Indoor Bike Simulation Parameters write で勾配 / wind / Crr 等を送信

## 送る側 (勾配制御)

- engine から受け取った勾配 (%) を FTMS Simulation Parameter として trainer に書き込む
- 周波数: 1Hz で充分、勾配は 5-10m 間隔で変わる
- 0.1% 単位で送る (FTMS は -32.0 ~ 32.0% 0.01% 解像度)

## 受ける側 (踏力 / 速度)

- Indoor Bike Data notification から instantaneous power、instantaneous speed、cadence、resistance level、距離 (累積) を抽出
- 周波数: trainer により 1-4Hz、bridge は受信した瞬間に engine へ転送

## yuuji の trainer 機種特定が必要

- 確認すべき: ブランド (Wahoo / Tacx / Elite / Saris / Magnus 等)、モデル、対応プロトコル (FTMS / FE-C ANT+ / 独自 BT)
- ない場合 = trainer 購入 or 既存 trainer なしの demo mode (= 勾配は engine が internal 進行、視覚 only)

## エラー処理

- BLE 切断 → 自動再接続 (5 sec interval)
- FTMS write 失敗 → log warning、勾配は engine 内で last-known を維持
- trainer なし demo mode: engine が勾配を自走、視覚 only
