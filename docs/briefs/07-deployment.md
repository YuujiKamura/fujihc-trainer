---
brief: 07-deployment
title: deploy 形態 — Windows ネイティブ / Web / Pi sidecar
---

# Brief 07: 動かす場所

## 選択肢

### A. Windows full local
- viewer = Electron or Tauri (Cesium frontend を wrapper)、bridge = Python.exe、engine = Node.exe
- pros: yuuji 環境に直接 install、外部ネットワーク不要
- cons: 3 process 管理、Windows 専用、yuuji の Windows なら OK

### B. Local web app
- viewer = Chromium で localhost を開く、bridge = Python daemon、engine = Node daemon
- pros: install 軽い、自分以外も使える (= 公開 path)
- cons: ブラウザ separate window、BLE は Web Bluetooth で叩く path もあるが Chrome 限定

### C. Pi + 別 PC
- Pi に bridge + engine、PC で viewer
- pros: bridge 機能を別 hw に分離
- cons: 複雑、yuuji は Pi 持ってる? 不明

### D. WSL2 経由
- Windows native だが Linux 互換、BLE は限定的
- 採用判定: 不採用

## 推し: B (Local web app)

- yuuji が既存 web 開発 stack (Cesium / JS) に親しんでる
- frontend / backend / bridge を 3 process だが docker-compose / pm2 等で一発起動可
- 後で公開 (Cloudflare deploy 等) する場合 frontend は再利用可、bridge だけ別配布
- 富士ヒル限定で freeze する場合は B のまま、Pi sidecar 化は将来オプション

## 公開する場合の制約

- BLE は client-side (= ユーザーの PC に Python bridge install) 必須
- frontend / engine は WebAssembly 化も可、cloud では BLE 動かないので bridge 不可避

## yuuji の現実

- 業務外趣味、scope は yuuji 自身が使う範囲
- 公開は MVP 後、まず自分が走る form 完成
