---
brief: b11-phase5-tile-cache
title: terrain3d.html タイルキャッシュ設計 (IndexedDB + 出典表示)
parent_project: ~/fujihc-trainer/
created: 2026-05-18
revised: 2026-05-18 (7軸 audit REDRAFT 対応)
depends_on: [b11-phase4-physics-drive]
blocks: []
branch: b11-phase5-tile-cache
---

# Brief b11-phase5-tile-cache: terrain3d.html タイルキャッシュ設計

## はじめに

user 指摘 (2026-05-18):

> タイル一枚あたりのコスト感覚がない。タダで取得できると勘違いしてないか？
> このあたり設計をきっちり作り込め。ブリーフ書け。
> そもそも取得したデータを利用して良い範囲はどこまでなのか？ちゃんと調べろ

外部調査結果を踏まえた設計ブリーフ。

---

## 用語定義 (軸2: 語彙の規律)

本 brief で "cache" が複数の意味に使われるため、使用前に分離する:

| 語 | 指すもの | 出現箇所 |
|---|---|---|
| **TileCache** | 本 brief で実装する IndexedDB 上のタイルキャッシュ層 | lib/tile_cache.js 全域 |
| **ブラウザ HTTP キャッシュ** | `fetch()` が自動的に使う HTTP レイヤーの cache (Cache-Control ヘッダ依存) | 現状の問題点の説明 |
| **SW キャッシュ** | service worker (sw.js) が管理する Cache Storage | sw.js skip pattern の箇所 |
| **Promise dedup cache** | `openTileCache()` 内でリピート呼び出しに対し同一 IDBDatabase を返す Promise の memoization | D1 実装制約 |
| **ローカル DB タイル** | bridge の SQLite DB (`/tiles/gsi_dem`) から取得する DEM タイル | DEM 取得フローの既存ロジック |

本 brief で単に「キャッシュ」と書く場合は TileCache を指す。他の意味の場合は上記の qualifier を必ず付ける。

キャッシュミス時の操作: 「TileCache miss → GSI fetch → TileCache set」と記述する。"prefetch"/"preload"/"先読み" はこの brief では使わない。

---

## 問題の正確な把握

### 現実装の GSI アクセス実態

```
FUJI_TERRAIN_BBOX → tileRangeForBounds(bbox, z=14) → 16×15 ≈ 240 tileCoords

DEM 取得 (resolveDemBase):
  probe LOCAL_DEM_BASE (/tiles/gsi_dem, = bridge の SQLite DB)
  ├─ bridge 起動中 → ローカル DB タイル使用、GSI リクエスト 0
  └─ bridge 停止中 → GSI online 240 リクエスト

テクスチャ取得 (fetchLayerCanvas):
  常に GSI 直叩き (ブラウザ HTTP キャッシュが効かないリロードで再取得)
  photo      → seamlessphoto  240 リクエスト
  std        → std             240 リクエスト
  relief     → relief          240 リクエスト
  hybrid     → 2 層合計        480 リクエスト
```

ブラウザ HTTP キャッシュはリロード・シークレットモード・VPN 切替で無効化される。
TileCache (IndexedDB) が存在しないため、毎回 GSI に最大 480 リクエストが飛ぶ。

### 数値でのコスト感覚

CDN 換算 (AWS CloudFront HTTPS 2026):
- リクエスト費: $0.000001/req × 480 = **$0.00048/ページロード**
- データ転送費: 30KB × 480 × $0.085/GB = **$0.0012/ページロード**
- 合計: **≒ $0.0016/ページロード** を GSI (= 日本の公共インフラ) が吸収
- 開発中リロード 100 回 → 48,000 GSI リクエスト/日

### 既存の利用規約違反

出典表示なし: 政府標準利用規約 第2.0版 (CC BY 4.0 互換) で「出典：国土地理院タイル」+ URL 明示が必須。現状は条件を満たしていない。

---

## データ利用の法的範囲 (調査結果)

| 項目 | 結論 | 根拠 |
|---|---|---|
| **ライセンス** | CC BY 4.0 互換 | 政府標準利用規約 第2.0版 |
| **TileCache (IndexedDB 保存)** | **OK** | CC BY の「複製・刊行」はリアルタイム表示目的のブラウザサイドキャッシュを含まない。GSI は「ウェブサイト・ソフト・アプリへの組み込み」を明示許可 |
| **出典表示** | **必須** | 「国土地理院タイル」+ `https://maps.gsi.go.jp/development/ichiran.html` |
| **測量法申請** | 不要 | リアルタイム表示目的の取得は「複製・刊行」に非該当 |
| **大量アクセス** | 数値基準なし。bbox 全域一括取得は「正常インタラクティブ利用」の範疇外に相当 | GSI 利用規約、OSM policy の同類型 |
| **seamlessphoto TTL** | 短めに設定すること | 航空写真の更新頻度は高い (→ TTL 根拠を参照) |

---

## TTL 根拠 (軸3: 抽象段差)

TileCache の TTL はタイルの陳腐化リスクと fetch コストのトレードオフで決める。

| layer | TTL | 根拠 |
|---|---|---|
| dem_png | **90日** | GSI DEM は基盤測量成果で更新サイクルは数年単位 (国土基盤情報の標準的な更新周期 = 5年)。90日は「90日間の間に地形が変わることはまずない」と言える最短スパン。CDN コスト 1 req/90日 vs 1 req/ページロード の差は明確 |
| std | **30日** | GSI 標準地図の更新は月次〜四半期。30日は「最悪でも 1 ヶ月で最新に戻る」ライン |
| relief | **30日** | 色別標高図は DEM から算出される (= DEM が変わらない限り relief も変わらない)。DEM の更新サイクルは 5年、std は月次 (30日)。relief の更新頻度は DEM に律速されるため std 以下。よって std の 30日は安全側 (過剰に短い) であり同値で十分 |
| seamlessphoto | **7日** | 航空写真は測量・災害対応時に数日〜週単位で更新される事例あり。長期保持は景観変化の誤認を招く。1 週間で「古い写真を 7 日以上見せ続けない」ラインとする |

---

## あるべき構造

```
terrain3d.html 起動
  │
  ├─ 1. TileCache.open()         IDB version:1 で open、onupgradeneeded で Object Store 作成
  │      + 古エントリ evict        TTL 超えエントリを一括削除、削除件数をコンソール出力
  │
  ├─ 2. DEM 取得 (既存 resolveDemBase を拡張)
  │      LOCAL_DEM_BASE probe (ローカル DB タイル)
  │        hit  → 0 外部リクエスト (既存動作維持)
  │        miss → TileCache.get() → hit → 0 GSI リクエスト
  │                               → miss → GSI fetch (User-Agent 付与) + TileCache.set()
  │
  ├─ 3. テクスチャ取得 (fetchLayerCanvas を拡張)
  │      per-tile: TileCache.get() → hit → 0 GSI リクエスト
  │                               → miss → GSI fetch (User-Agent 付与) + TileCache.set()
  │
  └─ 4. 出典表示 UI
         「© 国土地理院タイル」を静的 HTML literal で常時表示
         innerHTML 不使用。textContent または static HTML literal のみ
```

### openTileCache の singleton 保証 (軸5: 設計境界)

`openTileCache()` は Promise dedup cache を lib 内部に持ち、**何回 await しても同一 IDBDatabase インスタンスを返す**。呼び出し側 (`terrain3d.html`) は毎回 `await openTileCache()` してよく、インスタンスの保持・渡し回しは不要。並列呼び出し時に IDB open が race することなく 1 回の open で収束する。

これは lib の責務。terrain3d.html 側は singleton 管理を意識しなくてよい。

### キャッシュ設計

DB 名: `fujihc-tile-cache`
IDB version: `1` (将来の schema 変更は `onupgradeneeded` で migration)
Object Store: `tiles`

```
key:   `${layer}/${z}/${x}/${y}`     // 例: "dem_png/14/14445/6441"
value: {
  blob:      Blob,                   // 画像バイナリのみ (GPS・個人データは含まない)
  fetchedAt: number,                 // Date.now() ms
  layer:     string,                 // "dem_png" | "seamlessphoto" | "std" | "relief"
}
```

---

## Deliverables

### D1: `web/lib/tile_cache.js` (新規)

```js
// IndexedDB-backed tile cache with per-layer TTL.
export const TILE_TTL_MS = {
  dem_png:       90 * 24 * 3600 * 1000,
  std:           30 * 24 * 3600 * 1000,
  relief:        30 * 24 * 3600 * 1000,
  seamlessphoto:  7 * 24 * 3600 * 1000,
};

// IDB をオープン。内部で Promise dedup cache (= 同一 IDBDatabase を返す memoization)
// を持つ。複数回 await しても IDB open は 1 回のみ実行される。
export async function openTileCache() → TileCache
// TileCache:
//   async get(layer, z, x, y) → Blob | null  (null = cache miss または TTL 超え)
//   async set(layer, z, x, y, blob) → void
//   async evict() → number                   (削除件数、0 も正常)
//   async stats() → { total: number, layers: Record<string, number> }
```

実装制約:
- `openTileCache` が複数回呼ばれても安全 (Promise dedup cache、IDB open は 1 回)
- `get` は TTL 超えを miss 扱いとして null を返す (DB から削除はしない、evict に委ねる)
- `set` はネットワーク fail 時の呼び出しをしない (呼び出し側の責務)
- DOM / Three.js には依存しない (= node test 容易)
- IndexedDB `version: 1` で open、Object Store は `onupgradeneeded` で作成

### D2: `web/tests/tile_cache.test.js` (新規)

`fake-indexeddb` (= 既存 devDependency) を使用。

```
describe('openTileCache')
  it('複数回 open しても同一 IDBDatabase instance を返す (Promise dedup)')

describe('TileCache get/set')
  it('set した tile を get で取得できる')
  it('TTL 内は miss にならない')
  it('TTL 超えは get が null を返す')
  it('fetchedAt + TTL_MS === now の瞬間は miss 扱い (境界値)')   ← edge
  it('layer が違うと別 entry として扱われる')
  it('存在しない key への get は null を返す')                   ← edge

describe('TileCache evict')
  it('TTL 超えのエントリだけ削除し、TTL 内は残す')
  it('返値は削除件数 (number)')
  it('空 DB で evict を呼んでも 0 を返す')                      ← edge
  it('TTL が layer 別に異なる (dem_png=90d, seamlessphoto=7d)')

describe('TileCache stats')
  it('total は全 entry 数')
  it('layers は layer 別カウント')
  it('空 DB の stats は total=0 / layers={}')                   ← edge

describe('openTileCache error path')
  it('IDB open 失敗 (fake で simulate) → 呼び出し側に reject が伝わる') ← error
```

### D3: `terrain3d.html` 変更 3 点

**変更 A: キャッシュ統合 (fetchLayerCanvas, loadDemGrid)**

```js
// fetchLayerCanvas の拡張:
// 関数先頭で 1 回だけ TileCache を取得 (per-tile ループの外)
// ループ内: TileCache.get() → hit → Blob URL を img.src にセット
//                           → miss → GSI fetch + TileCache.set() + Blob URL にセット
// GSI fetch 時は必ず User-Agent ヘッダを付ける:
//   headers: { 'User-Agent': 'fujihc-trainer/0.x tile-cache' }
// ※ fetch() の User-Agent ヘッダはブラウザ環境では無視されることがある。
//   その場合は Referer または X-App-Name など代替ヘッダを検討するが、
//   GSI 側のブロック根拠は "過度の負荷" であり UA ブロックではないため
//   キャッシュによる負荷削減が本質的対策。

// loadDemGrid の拡張:
// ローカル DB タイル優先ロジックは既存ロジックを維持したまま、
// ローカル DB miss → TileCache.get() → miss → GSI fetch + TileCache.set()
```

**変更 B: 起動時 evict**

```js
// init() 冒頭に追加:
const cache = await openTileCache();  // Promise dedup cache が lib 内で保持
const evicted = await cache.evict();
if (evicted > 0) console.info(`[tile-cache] evicted ${evicted} stale entries`);
```

**変更 C: 出典表示 UI (必須、利用規約対応)**

```html
<!-- HTML に追加 -->
<div class="attribution">
  © <a href="https://maps.gsi.go.jp/development/ichiran.html"
      target="_blank" rel="noopener">国土地理院タイル</a>
</div>
```

```css
.attribution { color: rgba(255,255,255,.7); font-size: 10px; margin-top: 4px; }
.attribution a { color: inherit; }
```

セキュリティ制約: attribution の HTML は静的 literal のみ。JavaScript から動的に attribution 文字列を DOM に書く場合は `textContent` のみ使用、`innerHTML` 禁止。

### D4: sw.js cache skip 確認 (既存設定の維持確認)

b8 Round 1 で確立済みのパターン: 「terrain3d.html は SW キャッシュ対象外 (= fetch handler の早期 return で skip)」。

D3 で terrain3d.html を変更するため、sw.js に terrain3d.html / lib/tile_cache.js を SW キャッシュから除外する設定が存在することを実装開始前に確認する。存在しなければ追加する。SW キャッシュが変更後の terrain3d.html を古いバージョンで返し続けると、TileCache 統合が一部のユーザーに届かない。

### キャッシュ全消去手順 (軸6: reset 経路)

TileCache にバグが発生した場合や DB を fresh start したい場合の手順:

```
DevTools > Application > Storage > IndexedDB > fujihc-tile-cache > Delete database
```

または `openTileCache()` の実装が壊れている場合は `indexedDB.deleteDatabase('fujihc-tile-cache')` をコンソールで実行。

将来 schema を変更する場合は `IDB version` を 2 以上に bump し、`onupgradeneeded` で migration ロジックを書く。version 変更なしの schema 変更は silent drift になるため禁止 (NG-R1-14 再演防止)。

---

## 検証 (Rule 1 全種類)

### ユニットテスト

```
cd C:/Users/yuuji/fujihc-trainer
npx vitest run --reporter=verbose tests/tile_cache.test.js
```

全 pass 必須。

### 統合確認 (手動)

1. **TileCache hit 確認**
   - terrain3d.html を初回ロード → DevTools Network タブで GSI リクエスト数を記録
   - リロード → GSI リクエストが 0 (または大幅減) になること
   - DevTools > Application > IndexedDB > fujihc-tile-cache で entry が存在すること

2. **TTL 動作確認**
   - entry の `fetchedAt` が現在時刻付近であること

3. **出典表示確認**
   - 画面に「© 国土地理院タイル」リンクが表示されること (必須)

4. **evict 確認**
   - Console に `[tile-cache] evicted N stale entries` が出ること

5. **目視 (Rule 完了宣言前 self-check)**
   - `deskpilot desk_capture` or `PrintWindow` でスクリーンショットを撮り、
     Read tool で画像を開いて出典表示・地形表示・自転車走行を批評する
   - 地形・自転車・出典テキストが同時に確認できるまで完了と呼ばない

---

## まとめ

| 変更 | ファイル | LOC 概算 |
|---|---|---|
| tile_cache.js 新規 | web/lib/tile_cache.js | ~130 |
| tile_cache.test.js 新規 | web/tests/tile_cache.test.js | ~110 |
| fetchLayerCanvas/loadDemGrid 拡張 | terrain3d.html | +40 / -5 |
| 起動時 evict | terrain3d.html | +5 |
| 出典表示 UI | terrain3d.html | +10 |
| sw.js cache skip 確認/追加 | sw.js | 0〜+5 |

---

## 参照

- [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
- [地理院地図｜利用規約](https://maps.gsi.go.jp/help/termsofuse.html)
- [地理院タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)
- [標高タイル (dem_png) 仕様](https://maps.gsi.go.jp/development/demtile.html)
- [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/)
- [AWS CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [IDBFactory.open() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/open)
- [fake-indexeddb (npm)](https://www.npmjs.com/package/fake-indexeddb)
