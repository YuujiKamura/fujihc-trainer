---
brief: 17-tile-server-endpoint
title: bridge.py に tile server endpoint を生やして viewer をローカル DB に向ける
parent_project: ~/fujihc-trainer/
created: 2026-05-14
depends_on: [12-cesium-freeze, 14-tile-local-db, 15-gsi-dem-bulk-dl, 16-osm-pmtiles-fetch]
blocks: []
---

# Brief 17: ローカル tile server endpoint

## はじめに

brief 14-16 で `data/tiles.sqlite` に GSI 標高 + OSM ベクタタイルがローカルに揃った状態を作る。 本 brief はその DB を **HTTP endpoint** として viewer に提供する。 既存の `bridge.py` (WebSocket + 静的ファイル配信) に tile 用 GET ハンドラを追加し、 viewer-maplibre.js の source URL をローカル endpoint に書き換える。

これで viewer は外部 tile server に一切アクセスしなくなる。 prefetch 概念自体が不要になり (= 全部既に手元にある)、 7 軸 audit のセキュリティ境界軸 / 設計境界軸の問題が根本解として閉じる。

## endpoint 設計

`bridge.py` の HTTP server に下記 route を追加:

```
GET /tiles/{source}/{z}/{x}/{y}.{ext}
  source: 'osm' | 'gsi_dem'
  z, x, y: タイル座標 (XYZ scheme)
  ext: 'png' (gsi_dem) | 'pbf' (osm)
  response: SQLite から BLOB を取り出して bytes 返す
           Content-Type: image/png or application/x-protobuf
           Cache-Control: public, max-age=31536000 (= ローカルなので 1 年 cache 可)
  404 if not found in DB

GET /tiles/{source}/metadata.json
  response: metadata table の source 行を JSON で返す
  例: {"bounds": "138.65,35.30,138.85,35.45", "minzoom": "14", ...}

GET /tiles/{source}/style.json (OSM のみ)
  response: MapLibre style 形式の JSON、 source URL を /tiles/osm/{z}/{x}/{y}.pbf に向ける
```

## viewer 側 (`web/viewer-maplibre.js`) の変更

現状 (L60 付近):
```js
'osm': {
  type: 'raster',
  tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  ...
},
'gsi-terrain': {
  type: 'raster-dem',
  tiles: ['gsidem://...'],  // addProtocol 経由
  ...
}
```

変更後:
```js
'osm': {
  type: 'vector',  // PMTiles 由来は vector
  tiles: [`${location.origin}/tiles/osm/{z}/{x}/{y}.pbf`],
  minzoom: <metadata から>,
  maxzoom: <metadata から>,
  attribution: <metadata から>,
},
'gsi-terrain': {
  type: 'raster-dem',
  tiles: [`${location.origin}/tiles/gsi_dem/{z}/{x}/{y}.png`],
  encoding: 'terrarium',  // GSI dem_png は addProtocol 側で変換、 ただし新方式は DB に既に変換済 PNG を入れる場合直接、 未変換なら addProtocol 維持
  ...
}
```

style.json を bridge.py 側で吐かせて MapLibre に渡せば、 attribution / minzoom / maxzoom も metadata table から動的に取れる (= ハードコード排除)。

prefetch 関連の旧 code は brief 13 で comment out 済、 本 brief で完全削除する。

## 性能要件

- 1 タイル read は SQLite から数 ms、 viewport 表示で数十枚並列でも問題なし
- bridge.py は asyncio HTTP server、 タイル read は同期 SQLite で十分速いがブロック避けるなら `asyncio.to_thread` で wrap
- ride 90 分で総 tile request は数千件、 SQLite で問題なし

## やらないこと

- prefetch ロジックの再導入 (= ローカル DB なので不要、 lazy load で十分速い)
- 走行中の cache miss 時に外部 fetch にフォールバック (= policy 違反復活リスク、 miss は 404 で素直に返す)
- raster OSM タイル対応 (= brief 16 で vector pbf に確定、 別 brief で raster 経路を追加するなら別途)
- DB の自動再生成 (= user が明示的に scripts を再実行)

## 完了条件

1. `bridge.py` に `/tiles/{source}/{z}/{x}/{y}.{ext}` の GET ハンドラ実装、 unit test (`tests/test_tile_endpoint.py`) で:
   - 既知タイルを request → 200 + 正しい Content-Type + bytes 一致
   - 存在しないタイル → 404
   - 不正な source → 400
2. `bridge.py` に `/tiles/{source}/metadata.json` 実装、 unit test で metadata の JSON が返る
3. `bridge.py` に `/tiles/osm/style.json` 実装、 unit test で style 構造が valid (= layers[] が空でない)
4. `web/viewer-maplibre.js` の tile source URL を `/tiles/osm/...` `/tiles/gsi_dem/...` に書き換え
5. prefetch 関連 dead code (brief 13 で comment out した行 + `lastJumpToT` 等の未使用変数) を削除
6. 実走: bridge.py 起動 → browser で開く → DevTools Network panel で 外部ドメインへの request が 0 件 (= localhost のみ)
7. ride を 1 周走らせて、 タイル表示 / terrain / camera が壊れていない
8. ローカル commit、 push しない

## ハマる罠

- MapLibre は vector source の場合 `style.json` の layers 定義が必須、 Protomaps style (basemap, basemap-en 等) を参考に最低限の layer 定義が要る
- vector tile は zoom 14 から最大 zoom までで描画される、 zoom 19+ では maxzoom タイルを拡大表示 (= overzoom)、 これは MapLibre が自動でやる
- terrain 用 GSI dem_png は raster-dem type、 vector ではない、 source を混ぜないこと
- style.json の attribution は MapLibre が viewer 右下に自動表示、 metadata と整合
- Content-Type を `application/x-protobuf` で返さないと MapLibre が pbf として解釈してくれない
- bridge.py の既存 static file serving と route conflict しないこと (= 既存は `/` 起点で `web/` 配下、 `/tiles/` は別 prefix なので OK)

## テスト

- `pytest tests/test_tile_endpoint.py` (新規、 3-4 件)
- `pytest tests/test_ws_smoke.py` (既存、 WebSocket 通信が壊れていないこと)
- JS 側は test 基盤無し (brief 18 scope)、 本 brief は実走 + DevTools 目視で代替
- Rule 1 順守: 触った全 module の test を実走、 passed/failed 数を report に書く

## まとめ

完了条件: tile endpoint 3 種 + viewer 経路書き換え + 外部 fetch ゼロ確認 + 全 test green + ローカル commit。

ship される: viewer がローカル DB だけで完結、 policy 違反根絶、 prefetch 概念削除、 高度プリロード system の前提が整う (= 整える必要が消えた)。
ship されない: JS test 基盤 (= brief 18)、 OSS 公開準備、 ride log の Strava .fit 出力 (= 別 phase)。

次の atom: brief 18 (JS test 基盤) を並行か後追い、 もしくは Strava integration の Phase 2 に進む。
