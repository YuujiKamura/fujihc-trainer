---
brief: 02-architecture
title: アーキテクチャ — component 関係とデータフロー
---

# Brief 02: 構成図

## process 分担

- **trainer-bridge** (Python) ── pycycling で BLE FTMS に接続、勾配 set、power/cadence/speed 受信、内部 stdout に line-delimited JSON で吐く
- **course-engine** (Node.js or Python) ── GPX を距離 → 標高 → 勾配 に変換、進行距離に応じて勾配コマンドを bridge に送る、距離増分を受け取って進行を更新
- **viewer** (web frontend, Cesium + 自前 UI) ── 3D 地形 + GPX line 描画、camera を進行距離に追従、HUD で速度/標高/勾配/残距離表示
- **logger** (engine 内モジュール) ── ride 中の (time, distance, speed, power, hr) を CSV に追記、完走時に .fit に変換

## データフロー

```
trainer (BLE FTMS)
   ↑勾配 set       ↓power/cadence
trainer-bridge (Python)
   ↑JSON          ↓JSON
course-engine
   ↑距離増分       ↓進行距離
viewer (Cesium frontend, WebSocket 経由)
```

## 言語選択

- bridge: Python (pycycling が決定版、Windows ネイティブ)
- engine: Node.js (frontend と同じ言語、WebSocket 自然) or Python
- viewer: JavaScript (Cesium が JS、選択肢なし)

Ruby 不採用。Ruby を入れると BLE と 3D 両方で sidecar が要る、layer 増えるだけ。

## 既存 OSS との接続

- QZ を採用するなら、bridge と engine は QZ が代替、viewer のみ自作
- QZ 不採用なら、bridge を pycycling 直書きで自作、engine + viewer 自作
