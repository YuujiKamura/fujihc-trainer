---
brief: 17b-viewer-tile-endpoint
title: viewer の tile 経路を 17a の endpoint に切替 + prefetch 完全削除
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: 17 を分割した後半、 127.0.0.1 bind 明示、 中間状態 fallback)
depends_on: [17a-tile-server-module, 18-js-test-infra]
blocks: []
---

# Brief 17b: viewer 経路書き換え

## はじめに

brief 17a で tile endpoint 3 種 + 503 fallback + module 分離が landed。 本 brief は viewer 側を「外部 tile server → localhost endpoint」に切り替え、 prefetch 関連 dead code を完全削除する。

Round 2 audit の追加指摘 (= viewer 側) を反映:
1. **`TILE_BASE_URL` config 化**: hardcode 撤回、 1 点切替可能に (= migration 可逆性軸)
2. **bridge.py の bind を 127.0.0.1 明示**: LAN 内他端末からの ODbL 再配布事故防止 (= セキュリティ軸)
3. **503 受信時の viewer 動作**: DB setup 未完了を user に明示、 真っ白にしない (= 中間状態の運用)
4. **JS test 1 件追加**: 外部 fetch ゼロを assertion (= brief 13 と統合)

brief 18 (JS test 基盤) を **dependency に昇格**。 viewer の大規模書き換えを test 無しで行うのは NG-R1-8 再演。

## 何を変えるか

### 1. bridge.py の bind 限定

`bridge.py` で HTTP server / WebSocket server を **`127.0.0.1`** に bind を明示 (現状の "localhost" が `0.0.0.0` 含む実装に化けないよう、 数字で固定):

```python
HTTP_BIND = '127.0.0.1'  # LAN からの ODbL 再配布事故防止
WS_BIND = '127.0.0.1'
```

### 2. viewer-maplibre.js (近 `web/viewer.js` rename 後) の改変

#### 2a. `TILE_BASE_URL` const 追加

```js
// 既存の magic URL を 1 か所に集約、 外部経路に戻したい時はこの 1 行を変える
const TILE_BASE_URL = `${location.origin}/tiles`;
```

#### 2b. tile source URL を endpoint に向ける

```js
sources: {
  'osm': {
    type: 'vector',
    tiles: [`${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf`],
    // minzoom / maxzoom / attribution は style.json から動的に
  },
  'gsi-terrain': {
    type: 'raster-dem',
    tiles: [`${TILE_BASE_URL}/gsi_dem/{z}/{x}/{y}.png`],
    encoding: 'custom',  // brief 18 の terrarium.js で変換
  },
}
```

#### 2c. style.json の動的取得 + 503 fallback

viewer 初期化時に `fetch(${TILE_BASE_URL}/style.json)` を最初に呼ぶ:
- 200: その style を MapLibre に渡す、 viewer 起動
- 503: 「DB が未整備です。 セットアップ手順を README に従って実行してください」を画面に表示、 viewer は起動しない (= 真っ白回避)
- その他: error を画面表示

#### 2d. prefetch 関連の完全削除

brief 13 で comment out 済の呼出に加え、 関数定義 (`prefetchTilesAlongCourse`) + 関連変数 (`lastJumpToT`, `seenOsm`) + status メッセージ「ペアリング中 (タイルは表示時に取得)」を **削除** または「ローカル DB から read」に文言変更。

`addProtocol('gsidem', ...)` (GSI dem → terrarium 変換) は brief 18 の `web/lib/terrarium.js` 経由に移植。 関数本体は 17b で削除。

### 3. namespace 分離の明示

brief 14 の DB `source` 列 (`gsi_dem`) と MapLibre style の source key (`gsi-terrain`) が別 namespace である件 (= Round 2 語彙軸の指摘) を `viewer-maplibre.js` 冒頭コメントで pin:

```js
// 命名規約:
//   DB の source 列 (brief 14)         = 'osm', 'gsi_dem'  (snake_case)
//   MapLibre style の source key (本 file) = 'osm', 'gsi-terrain'  (kebab-case)
//   両者は別 namespace、 endpoint URL は DB 側 (= /tiles/gsi_dem/...) を使う
```

## やらないこと

- viewer の WebSocket / camera tick / HUD / ride state のリファクタ (= brief 19)
- raster OSM タイル対応 (= vector pbf 固定、 必要が出たら別 brief)
- prefetch ロジックの再導入 (= ローカル DB なので不要、 lazy load で速い)
- bridge.py の HTTP server frameworks 入れ替え (= 既存実装を維持)

## 完了条件

1. `bridge.py` の bind が `127.0.0.1` 明示
2. `web/viewer-maplibre.js` (= brief 12 完了後の `web/viewer.js`) の tile source が `TILE_BASE_URL` 経由
3. style.json 動的取得 + 503 fallback DOM 表示が実装
4. prefetch 関連の関数定義 / 変数 / status / addProtocol 旧 GSI 変換 が完全削除、 brief 18 の `terrarium.js` import に置換
5. 実走: `python -m fujihc.bridge` → browser で開く → DevTools Network panel で **外部ドメインへの request 0 件** (= localhost のみ)
6. **DB 不在 smoke**: `data/tiles.sqlite` を rename → reload → 「DB 未整備」エラー表示、 viewer 真っ白にならない
7. **DB 復帰 smoke**: rename を戻す → reload → 正常起動
8. ride 1 周走行 + DevTools で fetch 全件を localhost と確認
9. JS test 追加 (`web/tests/`):
   - `no_external_fetch_on_load.test.js`: viewer load 時に外部 host への fetch が 0 件 (brief 13 と同 test、 brief 13 でスタブ → 17b で本実装)
   - `style_503_fallback.test.js`: style.json 503 時に error DOM が表示される
   - `tile_url_central.test.js`: `TILE_BASE_URL` を変えると全 source URL が追従する
10. `npm test` 全 green (brief 18 までの test + 本 brief 3 件)
11. `pytest` で backend 既存 + brief 14-17a 全 green
12. README に「DB 未整備時の挙動」「TILE_BASE_URL 切替方法」を追加
13. ローカル commit、 push しない

## ハマる罠

- MapLibre vector source は style.json の `layers` 定義が必須、 17a の最小 skeleton では地物が描画されない、 viewer 側で標準的 layer 定義 (background / water / landuse / roads / boundary / place 等) を override 必要
- `${location.origin}` は `file://` で開いた時に `null`、 必ず bridge.py 経由 (`http://127.0.0.1:8000/`) で開く
- 503 fallback の DOM は viewer 起動前に表示する必要、 MapLibre 初期化を try/catch で囲む
- `bind='127.0.0.1'` は `localhost` と挙動が違う環境がある (= IPv4/IPv6)、 IPv6 必要なら別途 `::1` 追加
- `TILE_BASE_URL` を `web/viewer.js` 冒頭に置くだけでなく、 切替方法を README に書く (= 1 行修正 + reload)
- vitest で `fetch` mock を使う、 `vi.spyOn(window, 'fetch')` で外部 host への request を assertion

## まとめ

完了条件: bind 127.0.0.1 明示 / TILE_BASE_URL 経由 / style.json fallback / prefetch 完全削除 / DB 不在 smoke pass / 復帰 smoke pass / 3 件 JS test 追加 / 全 test green / README 更新。

ship される: viewer がローカル DB だけで完結、 外部 fetch ゼロ、 LAN 隔離、 DB 中間状態でも viewer が落ちない、 prefetch 概念完全削除、 7 軸 audit の LOAD-BEARING NG (NG-R1-15/16) が根本解として閉じる。
ship されない: WebSocket / camera tick / ride state のリファクタ (= brief 19)、 OSS 公開準備、 Strava .fit export (= 別 phase)。

次の atom: brief 19 (viewer 統合層切り出し) で残る viewer 580 行を分離、 もしくは Phase 2 (Strava integration) に進む。
