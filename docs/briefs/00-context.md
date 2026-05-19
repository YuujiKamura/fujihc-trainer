---
project: fujihc-trainer (working name)
created: 2026-05-14
yuuji_goal: 富士ヒル本番に向けた室内ローラー training で、実コース GPX を 3D 表示しつつ smart trainer に勾配を送って実走再現する。Zwift では GPX 取り込み不可なので空白市場。
---

# 全 brief 共通の前提

## 由来

yuuji が 2026-05-14 に富士ヒル公式ページの QR から GPX (Mt.fujihillClimb, 24km, 1242m up) を取得。Zwift では GPX 走れないと判明 → 外部検索で OSS 部品揃ってると判明 → 「チームで brief 書き出してレビュー」着手。

## 既存 OSS 部品 (外部検索 2026-05-14 持ち帰り)

- **QZ (qdomyos-zwift)** — GPL、cross-platform、GPX route following + FTMS resistance 制御 + 仮想 Wahoo KICKR 偽装。「GPX で trainer 動かす」は既に landed
- **pycycling** (Python, bleak 経由) — BLE trainer 操作 library、Windows OK
- **gymnasticon** (Node.js) — 古い bike → BT bridge、Pi 前提
- **Cesium** (JS) — 3D 地球儀 OSS、GPX 3D 表示の標準、Strava ride デモ存在
- **Golden Cheetah** — OSS、trainer 接続 + ERG/sim + training analytics
- **Three.js / MapLibre / Mapbox** — 3D の代替パス
- **OpenTopography** — SRTM DEM 30m 無料、富士周辺充分

## 制約

- yuuji の環境: Windows native + Git Bash、Rust/Python/Go/JS が動く
- 業務外趣味、生計優先、scope は 2-4 週末でモノになる範囲が現実的
- 「過去未来繋ぐ」class 寄り (= ride データが蓄積される)、ただしまずは富士ヒル本番 1 個に絞って動く形優先
- 自作よりも既存 OSS の合成で達成 (Lakoff Step 「既にある物を直す」)
