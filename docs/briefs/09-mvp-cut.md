---
brief: 09-mvp-cut
title: MVP の更なる切り詰め — 「最小で価値出る切り方」
---

# Brief 09: MVP cut 案

「MVP 定義」(brief 01) すら大きい可能性、もっと切る案。

## Cut 案 A: viewer only (trainer 抜き)

- GPX を 3D で見るだけ、trainer 制御なし
- 完成 1-2 日、富士ヒルの 3D プレビューが手に入る
- 価値: ride 前に「次の登りどこ」を視覚予習、本番当日も使える
- 不足: trainer 連動なし、室内 training の実走再現は別途

## Cut 案 B: ERG only (3D 抜き)

- GPX → 勾配シーケンス → trainer に送信、画面は 2D 縦断プロファイル only
- 完成 2-3 日、室内 training 実走再現が動く
- 価値: 富士ヒル本番に向けた fitness build、最も実利
- 不足: 3D 体験なし、Zwift 的な没入なし

## Cut 案 C: 富士ヒル「絶対外せない」だけ

- viewer = 富士ヒル 1 コースのみ、3D + camera 追従、HUD 最小
- trainer = pycycling で勾配送信、receiver で速度受信
- ログ = CSV 出力のみ、Strava なし
- 過去比較 = なし
- avatar = なし
- 完成 3-5 日 (= 過去検索の試算と一致)

## 推し: Cut 案 C

理由:
- trainer + 3D 両方入って初めて「Zwift+GPX」の実感、片方欠けると意味薄い
- 「絶対外せない」だけに絞れば 3-5 日で着地
- 過去比較や Strava 連携は MVP 後の自然な拡張

## ただし B 単独もあり得る

- 「本番完走したい」が yuuji の本音なら fitness build が最優先 = B 単独で十分
- 3D は趣味、優先度判定は yuuji の好み次第
