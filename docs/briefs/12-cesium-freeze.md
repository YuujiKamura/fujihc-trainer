---
brief: 12-cesium-freeze
title: Cesium 版 viewer を凍結、MapLibre 版を本流に確定
parent_project: ~/fujihc-trainer/
created: 2026-05-14
depends_on: []
blocks: [14-tile-local-db, 17-tile-server-endpoint]
---

# Brief 12: Cesium 版 viewer 凍結

## はじめに

fujihc-trainer の地図表示は現状 Cesium 版 (`web/viewer.js` 831 行 + `web/index.html`) と MapLibre 版 (`web/viewer-map3d.js` 733 行 + `web/index-maplibre.html`) の 2 系統並走。yuuji の判断で **Cesium 版は OSS にできない** ため凍結する。本 brief は「凍結」を物理処理と責務確定 (= MapLibre 版が単一本流) に落とす。

7 軸 audit で「2 系統並走の本流宣言なし」が複数軸で NG 指摘されており、これを解消する load-bearing な前提作業。後続の brief 14 (ローカル tile DB)、brief 17 (tile server endpoint) は MapLibre 版だけを前提に書ける。

## 凍結の定義

「凍結」は削除ではなく**触らない宣言** + 物理的に build 経路から外す:

1. `web/viewer.js` と `web/index.html` を `web/archived/cesium/` に移動 (削除はしない、ride log 用 GPX 出力等の Cesium 固有実装を後で参照する可能性あり)
2. `web/index.html` から `web/index-maplibre.html` へ entry を変えるため、`web/index.html` のシンボリックリンクまたは copy として `web/index-maplibre.html` の内容を置く
3. README に 1 行「viewer は MapLibre 版が本流、Cesium 版は `archived/cesium/` 配下に凍結保管」を追加
4. `bridge.py` 側の static file serving が `web/` ルートを向いている確認、`index.html` 経由でアクセスして MapLibre が起動するか smoke test
5. archived 配下のファイルに「FROZEN 2026-05-14 ─ do not edit, see brief 12」コメントを冒頭に追加

## やらないこと

- Cesium 版の機能を MapLibre 版に migrate する作業 (= brief 12 scope 外、別 brief)
- `viewer.js` の関数を MapLibre 版にコピーする作業 (= 必要なものは brief 17 等で個別判断)
- `archived/` 配下のファイル削除 (= 復活可能な状態で保管)

## 完了条件

1. `web/archived/cesium/viewer.js` と `web/archived/cesium/index.html` が存在、冒頭に FROZEN コメントあり
2. `web/index.html` が MapLibre 版 entry になっている (元 `index-maplibre.html` の内容)
3. `bridge.py` を起動 → browser で `http://localhost:8000/` を開く → MapLibre 版が表示される (smoke test)
4. README に凍結宣言の 1 行
5. ローカル commit、push しない

## ハマる罠

- `index.html` を copy して `index-maplibre.html` を消すと git diff が「rename + delete」じゃなく「2 file 変更」に見える。`git mv index-maplibre.html index.html` で rename を明示しろ
- Cesium 版を export している script や CI が無いか先に grep で確認 (`grep -rn "viewer.js\|index.html" --include="*.py" --include="*.sh"`)
- `tests/test_ws_smoke.py` 等が Cesium 版の挙動を前提にしていないか確認、していたら brief 12 scope に test 修正も含める

## まとめ

完了条件: archived 移動 + `index.html` 差し替え + smoke test pass + README 更新。

ship される: 1 系統 (MapLibre) 確定の物理構造、後続 brief が前提にできる状態。
ship されない: Cesium 版の機能 migrate、archive 配下の削除、OSS 公開準備 (= 別 brief)。

次の atom: brief 13 (prefetch 即時 fix) が独立して着手可能、brief 14 (ローカル tile DB) はこの brief 完了後に。
