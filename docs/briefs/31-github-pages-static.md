---
brief: 31-github-pages-static
title: GitHub Pages 配信 Phase 1: 静的サイト化 (= bridge.py 不要、 視覚デモ完結)
parent_project: ~/fujihc-trainer/
created: 2026-05-15
depends_on: [16-osm-pmtiles-fetch, 17a-tile-server-module, 26a-viewer-osm-vector-fix, 26b-first-run-setup-flow]
blocks: [32-web-bluetooth-trainer, 33-strava-upload-history]
---

# Brief 31: GitHub Pages 静的サイト化 (Phase 1)

## はじめに

user 訂正: 「GitHub Pages 上で動くのが普通だろ、 ローカル bridge 立てなきゃ見えないデモはデモじゃない」。 現状 viewer は `bridge.py` (= aiohttp + SQLite) を 127.0.0.1 で立てないと tile も course.json も `/tiles/_setup_status` も全部空、 試したい人に配れない。 本 brief は Phase 1 として **静的 file 配信 (= GitHub Pages) だけで viewer が地形 + 道路 + ride 視点を visual に再現できる状態** を ship する。 Web Bluetooth (= 実 trainer 接続) は phase 2 (brief 32)、 Strava upload / ride history は phase 3 (brief 33)。 本 brief の射程は `?map=1` / `?test=1` 系の trainer 不要モードを静的配信に乗せること、 実 BLE は触らない。

## モードの語彙統一 (= NG-R1-3 再演回避の事前合意)

本 brief で 4 modes が交錯するため、 関係を明示してから書き進める:

| mode | trigger | tile origin | ride 駆動 | この brief で触るか |
|---|---|---|---|---|
| **bridge** | `/tiles/_setup_status` が 200 を返した時 (= 既定 path) | `${origin}/tiles/...` (= aiohttp proxy) | WebSocket 経由 bridge.py | **detect logic のみ追加** |
| **static** | `/tiles/_setup_status` が 404/timeout/network error (= GitHub Pages、 bridge 未起動 localhost) | `${origin}${BASE_PATH}static/...` + `pmtiles://...` | fake client (= MAP_MODE の流用) | **新規** |
| **MAP_MODE** | `?map=1` query | bridge / static の検知結果に従う | fake client、 UI 操作ゼロ自動 ride | 既存、 変更なし |
| **TEST_MODE** | `?test=1` query | bridge / static の検知結果に従う | fake client、 UI 操作あり | 既存、 変更なし |

- **static mode と MAP_MODE は別概念**: static は「tile origin の選択」、 MAP_MODE は「ride 駆動と UI 表示の選択」。 GitHub Pages 配信下では「static + MAP_MODE」「static + TEST_MODE」「static + query 無し (= MAP_MODE 同等 fallback)」の 3 組合せが起き得る
- 既存 `checkSetupStatus()` (= viewer-map3d.js L260) が status probe を担っているので **本 brief で新規 `detectBridgeMode` を導入しない** (= NG-R1-11 双子関数回避)。 既存関数に AbortSignal.timeout を追加するだけ、 既存返値 `{overall:'empty'}` を「static mode 確定」と同義に再定義
- 用語: brief 内で「bridge available」「static fallback」のみ使う、 `pages_mode` / `nobridge` / `offline` 等の同義語は持ち込まない

## 何が今足りないか (= 現状)

- `web/viewer-map3d.js` L29: `const TILE_BASE_URL = ${location.origin}/tiles`、 GitHub Pages では `${location.origin}/fujihc-trainer/static/tiles` に当たる必要 (= path prefix 考慮ゼロ、 `location.pathname` 未使用)
- `web/viewer-map3d.js` L80, L89: tile URL を `${TILE_BASE_URL}/osm/{z}/{x}/{y}.pbf` で組み立てるが、 vector tile は **PMTiles 単一 file** から MapLibre `addProtocol('pmtiles', ...)` で読む形にできていない (= `pmtiles.js` 未統合、 vector source の type が `'vector'` + tiles 配列で個別 PBF 期待)
- `web/viewer-map3d.js` L260-270 `checkSetupStatus()`: catch で `{overall:'empty'}` を返す fallback はあるが **timeout が無い**、 GitHub Pages の 404 即時返答なら問題ないが、 network が遅い or proxy が握り続ける環境で初回表示が遅延する (= `AbortSignal.timeout` 未使用)
- `web/viewer-map3d.js` L593 `bootCheckSetupStatus()`: `overall='empty'` 時に `showDbinit()` を呼ぶ (= dbinit-overlay 表示) が、 static mode (= bridge 不在で MAP_MODE 相当に倒したい) では dbinit-overlay を出さず即 `initMapMode()` 相当に流す経路が無い
- `src/fujihc/tile_server.py`: SQLite からの tile 配信は実装済だが、 **静的 file ツリーへの export** (= `data/tiles.sqlite` の GSI PNG blob を `web/static/tiles/gsi_dem/{z}/{x}/{y}.png` に書き出す) script が存在しない
- `data/fuji.pmtiles` (= 3.9 MB、 zoom 11-15 を含む Protomaps planet build の Fuji 周辺切り出し) は repo に存在するが、 viewer から `pmtiles://` URL で直接 read する経路 (= pmtiles.js loader + `maplibregl.addProtocol`) が無い
- `data/tiles.sqlite` (= 18 MB) には現在 gsi_dem 179 タイル (z8-14、 17.3 MB) + osm 129 PBF (z13-15、 0.38 MB) が landed。 PMTiles を採用する static mode では osm PBF 129 件は **export 対象外** (= PMTiles 1 file で代替)、 gsi_dem 179 件のみ静的ツリー化
- `.github/workflows/` ディレクトリ自体存在しない (= GitHub Actions による Pages 配信 workflow 不在)

## あるべき構造

```
起動 (GitHub Pages or localhost)
  │
  ▼
checkSetupStatus()  (= 既存関数を short-timeout 化、 AbortSignal.timeout(500))
  │
  ├─ overall=ready / partial / empty (= 200/503 返答あり) ──▶ bridge mode
  │                                                            (= 従来 flow: checking → dbinit/pairing → riding)
  │
  └─ catch / timeout / 404 ─────────────────────────────────▶ static mode
                                                              │
                                                              ▼
                                            MAP_MODE が無ければ initMapMode() を強制呼出.
                                            tile origin を `${BASE_PATH}static/` に切替、
                                            osm = pmtiles://${BASE_PATH}static/map.pmtiles
                                            gsi-terrain = gsidem://${BASE_PATH}static/tiles/gsi_dem/{z}/{x}/{y}.png.
```

判定の単一化: 既存 `checkSetupStatus()` が catch で返す `{overall:'empty', sources:{}}` は今まで「DB が空、 dbinit-overlay へ」の意味だった。 本 brief で意味を「**bridge が応答した かつ DB 空**」に narrow し、 「bridge が応答しなかった」を新フィールド `{bridgeReachable: false}` で区別する。 これで dbinit-overlay は **bridge mode 内のみ**、 static mode は initMapMode 直行に分岐できる。

## 実装設計

### A. `web/static/` ディレクトリ構造 (新規)

```
web/static/
├── tiles/
│   └── gsi_dem/
│       └── {z}/{x}/{y}.png          (= 179 ファイル、 計 17.3 MB 相当を file ツリー化)
├── map.pmtiles                      (= data/fuji.pmtiles の copy、 3.9 MB)
└── course.json                      (= 既存 web/course.json の copy)
```

- bridge mode 用の `web/course.json` (= viewer が L681 で root 相対 fetch) は破壊しない。 static mode では viewer 側の course fetch URL を **`${BASE_PATH}static/course.json` に切替**、 `web/course.json` (= root) と `web/static/course.json` (= 静的) の 2 箇所に同内容、 mode で fetch 先を分岐 (= NG-R1-11 の懸念があるが file は 2 個 / fetch 経路は viewer 内 1 行分岐で済むため抽象化過剰を避ける、 同型は test 1 件で hash 一致を pin する)
- `web/static/` は `.gitignore` で除外 (= ビルド成果物、 GitHub Actions が毎回再生成)、 ただし `.gitkeep` を 1 個置いて parent ディレクトリは tracked
- 命名 `static` の根拠: `bridge_static` / `pages_assets` / `pages_dist` 等を検討したが、 既存 `data/` (= ソース) と `web/` (= ソース) に対して **「配信成果物」と即読める** 単語が要る、 `static` は HTTP / Pages の文脈で意味が一意 (= NG-R1-3 語彙混在を避けるため、 qualifier 不要の 1 語に絞る)

### B. `scripts/export_static.py` (新規、 80 行未満)

`data/tiles.sqlite` + `data/fuji.pmtiles` + `web/course.json` を読んで `web/static/` 配下に展開する CLI。 GitHub Actions と user ローカル両方から呼べる thin wrapper。

```python
# 主要 API
def export_gsi_dem_tree(db_path, out_dir):
    """SQLite から source='gsi_dem' AND fetch_status=200 AND data IS NOT NULL の row を全件 SELECT、
    out_dir / 'tiles' / 'gsi_dem' / str(z) / str(x) / f'{y}.png' に bytes write."""

def copy_pmtiles(src, dst):
    """data/fuji.pmtiles を web/static/map.pmtiles に shutil.copy2."""

def copy_course(src, dst):
    """web/course.json を web/static/course.json に shutil.copy2."""

def main():
    """argparse で --db / --pmtiles / --course / --out を受ける、 default は repo 相対 path。"""
```

- magic path 排除: `Path(__file__).resolve().parent.parent` で repo root を求めて default を組む、 ドライブレター / ユーザー名直書き禁止 (= CLAUDE.md「ハードコードパス禁止」遵守)
- 中央定数: `GSI_DEM_ZOOMS` 等の zoom 制約は使わない、 **DB に landed しているもの全部を export** (= zoom filter は export 時点では不要、 viewer 側の minzoom/maxzoom で制御)
- OSM PBF は **PMTiles 経由に統一**、 個別 PBF file ツリーは export しない (= ファイル数を 129 削減、 PMTiles 1 file で済む)
- **外部 fetch ゼロ規律**: `export_static.py` の source 内に `http://` / `https://` 文字列を一切含めない (= 後述 test 5 で物理 grep gate)

### C. `web/lib/pmtiles_loader.js` (新規、 20 行未満)

`pmtiles.js` (= protomaps/PMTiles 公式 lib、 BSD-3-Clause、 https://github.com/protomaps/PMTiles) を `<script>` で読んでから、 MapLibre に `pmtiles://` プロトコルを登録する helper。

```js
// 呼び出し例: registerPmtilesProtocol(maplibregl, window.pmtiles);
export function registerPmtilesProtocol(maplibregl, pmtiles) {
  if (!pmtiles) throw new Error('pmtiles global not loaded');
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  return protocol;
}
```

- `pmtiles.js` 配信: **CDN 経由は採用しない**、 `web/lib/vendor/pmtiles.js` に **vendored copy** を置いて `<script src="./lib/vendor/pmtiles.js">` で読む (= CDN は SRI 必要 / version 揺れ / 第三者 origin への runtime fetch、 NG-R1-15 と境界が曖昧になる。 vendored なら同一 origin 配信、 audit gate も clean)
- pin: `pmtiles.js v3.0.6` (= 2026-05 時点で MapLibre 4.x 対応 stable、 SemVer x.y.z の完全 pin、 NG-R3-7 「`>=` floating pin 禁止」遵守)
- 採用 OSS: `pmtiles.js` v3.0.6 / BSD-3-Clause。 `protomaps-leaflet` (= Leaflet 用)、 `protomaps/protomaps.js` (= 廃止) は採用しない
- vendoring 手順: `npm pack pmtiles@3.0.6 && tar -xzf pmtiles-3.0.6.tgz && cp package/dist/pmtiles.js web/lib/vendor/pmtiles.js` を README に記録、 `web/lib/vendor/LICENSE-pmtiles` (= BSD-3-Clause 全文) を同梱
- module 形式: viewer-map3d.js は ES module import 形式 (= L6-L17 既存)、 `pmtiles.js` は `<script>` で `window.pmtiles` global を作る IIFE、 `pmtiles_loader.js` 内で `window.pmtiles` を参照する 1 行 helper

### D. `web/viewer-map3d.js` L260 周辺: `checkSetupStatus` の short-timeout 化と `bridgeReachable` 返値追加

**既存 `checkSetupStatus()` を拡張** (= 新規関数追加しない、 NG-R1-11 回避):

```js
async function checkSetupStatus() {
  try {
    const resp = await fetch(`${HTTP_BASE_URL}/tiles/_setup_status`,
                             { signal: AbortSignal.timeout(500) });
    if (resp.status === 503) return { overall: 'empty', sources: {}, bridgeReachable: true };
    if (!resp.ok)            return { overall: 'empty', sources: {}, bridgeReachable: true };
    const body = await resp.json();
    return { ...body, bridgeReachable: true };
  } catch (err) {
    // timeout / 404 / network error: bridge 未到達 = static mode
    return { overall: 'empty', sources: {}, bridgeReachable: false };
  }
}
```

- 500 ms timeout の根拠: localhost に bridge.py が立っていれば LAN 内 fetch は < 50 ms で 200 を返す (= aiohttp は in-memory dict 引き、 余裕 10 倍)。 GitHub Pages 上では 404 が即座 (= < 30 ms) に返るので catch に流れて静的 mode 確定。 timeout が長すぎると初回表示が遅延、 500 ms は user 知覚の閾値以内
- `AbortSignal.timeout(500)`: Modern 全 browser (= Chrome 103+, Firefox 100+, Safari 16+) で対応、 fallback 不要 (= GitHub Pages 配信対象は modern browser のみと割り切り、 vitest 環境の Node 18+ も対応)
- `bridgeReachable` フィールド: 既存 `overall` の semantics を保ったまま「bridge 到達可否」を独立 flag に。 既存 caller (= `showDbinit` / `maybeAdvanceToPairing`) は `overall` のみ参照しているため後方互換、 新規 caller (= `bootCheckSetupStatus`) のみ `bridgeReachable` を見る

### E. `web/viewer-map3d.js` L593 `bootCheckSetupStatus`: static fallback 分岐の挿入

既存:
```js
if (MAP_MODE) initMapMode();
else if (TEST_MODE) initTestMode();
else bootCheckSetupStatus();
```

`bootCheckSetupStatus` (= 既存) の内部に分岐追加:

```js
async function bootCheckSetupStatus() {
  setAppState('checking');
  const s = await checkSetupStatus();
  if (!s.bridgeReachable) {
    // static mode: GitHub Pages 等、 bridge 不在で MAP_MODE 相当に倒す
    initMapMode();
    return;
  }
  if (s.overall === 'ready') { setAppState('pairing'); connectBridge(); }
  else                       { showDbinit(s); }
}
```

- MAP_MODE / TEST_MODE が明示された場合 (= `?map=1` / `?test=1`) は **既存通り query 優先**、 static mode の検知より上位 (= user 明示は env 検知より優先、 priority 順序を語彙統一表と整合)
- `initMapMode()` は既存関数 (= L595)、 tile origin の切替は次節 F が担う (= `initMapMode` 内では touch せず、 style 構築側で `bridgeReachable` を参照)
- dbinit-overlay は `showDbinit(s)` の中でのみ表示 (= bridge mode 内に閉じる、 static mode では dbinit-overlay 一切表示しない、 NG-R1-7 責務分離)

### F. `web/viewer-map3d.js` L29 + L73-149: TILE_BASE_URL と style の mode 別化

L29 を path-aware + mode-aware に変更:

```js
// GitHub Pages の path prefix (= /fujihc-trainer/) に追従、 localhost (= /) でも動く
const BASE_PATH = location.pathname.replace(/\/[^/]*$/, '/');
const BRIDGE_TILE_BASE_URL = `${location.origin}/tiles`;         // bridge mode (= 従来)
const STATIC_TILE_BASE_URL = `${location.origin}${BASE_PATH}static`;  // static mode
// 後方互換: TILE_BASE_URL は bridge 値を default (= 既存 viewer_url_audit.test.js が grep する)
const TILE_BASE_URL = BRIDGE_TILE_BASE_URL;
```

style 構築を関数化 (= NG-R1-11 双子コピペ回避、 sources のみ条件分岐、 layers は共通):

```js
function buildMapStyle({ bridgeReachable }) {
  const tileBase = bridgeReachable ? BRIDGE_TILE_BASE_URL : STATIC_TILE_BASE_URL;
  const sources = bridgeReachable
    ? {
        'osm': { type:'vector', tiles:[`${tileBase}/osm/{z}/{x}/{y}.pbf`], minzoom:13, maxzoom:15,
                  attribution:'© OpenStreetMap contributors' },
        'gsi-terrain': { type:'raster-dem', tiles:[`gsidem://${tileBase}/gsi_dem/{z}/{x}/{y}.png`],
                          tileSize:256, encoding:'terrarium', minzoom:8, maxzoom:14,
                          attribution:'国土地理院 標高タイル', volatile:false },
      }
    : {
        'osm': { type:'vector', url:`pmtiles://${tileBase}/map.pmtiles`,
                  attribution:'© OpenStreetMap contributors' },
        'gsi-terrain': { type:'raster-dem', tiles:[`gsidem://${tileBase}/tiles/gsi_dem/{z}/{x}/{y}.png`],
                          tileSize:256, encoding:'terrarium', minzoom:8, maxzoom:14,
                          attribution:'国土地理院 標高タイル', volatile:false },
      };
  return { version:8, sources, layers: COMMON_LAYERS, sky: COMMON_SKY };
}
```

- `COMMON_LAYERS` / `COMMON_SKY` は L100-133 の既存 layers/sky 配列を module top level const 化 (= 同一 layer 配列を 2 mode で共有、 NG-R1-11 物理化)
- map 初期化 (L73): `bridgeReachable` を `bootCheckSetupStatus` の判定後に確定する必要があるため、 **map 初期化を `bootCheckSetupStatus` 完了後に遅延**。 `MAP_MODE` / `TEST_MODE` も同様、 つまり「mode 判定 → style 構築 → `new maplibregl.Map`」の順に並び替え (= 既存の即時 map 構築は撤回、 brief 内で実装範囲明示)
- `addProtocol('gsidem', ...)` (= L34-67) は **無変更**、 GSI dem PNG → terrarium 変換は static / bridge 共通 (= viewer は fetch URL の origin が違うだけで decode は同 logic)
- `addProtocol('pmtiles', ...)` は `registerPmtilesProtocol(maplibregl, window.pmtiles)` 呼出を map 構築前に 1 回、 bridge mode でも static mode でも登録 (= 冪等、 bridge mode は addProtocol を使わないが unconditional 登録で害なし)

### G. `web/index.html` L5 周辺: pmtiles vendored script の追加

既存:
```html
<script src="https://unpkg.com/maplibre-gl@4.7.0/dist/maplibre-gl.js"></script>
```

直後に挿入:
```html
<script src="./lib/vendor/pmtiles.js"></script>
```

- maplibre-gl の CDN は既存運用 (= 本 brief で touch しない、 別 brief でも vendoring 候補だが射程外)
- 順序: maplibre-gl → pmtiles → viewer-map3d.js の固定順、 pmtiles は maplibregl 依存だが `addProtocol` は viewer 側で呼ぶため独立 load 可

### H. `.github/workflows/pages.yml` (新規、 50 行以内)

GitHub Pages 配信用の Actions ワークフロー。 trigger は `push to main` + `workflow_dispatch` (= 手動)。

```yaml
name: Deploy GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Install deps
        run: pip install -e .
      - name: Export static assets
        run: python scripts/export_static.py
      - name: Stage Pages payload
        run: |
          mkdir -p _site
          cp web/index.html _site/
          cp web/viewer-map3d.js _site/
          cp web/course.json _site/
          cp -r web/lib _site/lib
          cp -r web/static _site/static
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with: { path: _site }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- **配信対象を `web/` 直下から絞った `_site/` に切替**: `web/archived/` (= 凍結 Cesium 版、 NG-R1-2 物理化) / `web/tests/` (= vitest source) を Pages に上げると外部に Cesium 版 viewer.js が landed して NG-R1-2 物理化が崩れる、 `_site/` に staging して必要 file のみ copy
- pin: actions/checkout v4 / setup-python v5 / upload-pages-artifact v3 / deploy-pages v4 (= 2026-05 時点の latest major、 `>=` の floating pin は禁止 / NG-R3-7 再演回避)
- `pip install -e .`: 既存 `pyproject.toml` を前提 (= brief 17a で landed)、 不在なら本 brief 着手前に確認
- `data/tiles.sqlite` / `data/fuji.pmtiles` は repo に committed 前提 (= 既に landed)、 LFS 化は phase 2 検討

## test 戦略

frontend (vitest、 既存 192 件に +14-16 件):

1. `web/tests/static_mode.test.js` (新規、 7 件):
   - `checkSetupStatus()` が fetch 200 で `bridgeReachable:true, overall:body.overall` を返す
   - 503 で `bridgeReachable:true, overall:'empty'`
   - 404 で `bridgeReachable:true, overall:'empty'` (= ok=false の path)
   - timeout (= 500ms 超) で `bridgeReachable:false, overall:'empty'`
   - network error で `bridgeReachable:false`
   - `BASE_PATH` 計算: `/foo/index.html` → `/foo/`、 `/` → `/`、 `/fujihc-trainer/` → `/fujihc-trainer/`
   - `bootCheckSetupStatus` が `bridgeReachable:false` 時に `initMapMode` を呼ぶ (= mock で確認)
2. `web/tests/build_map_style.test.js` (新規、 4 件):
   - `buildMapStyle({bridgeReachable:true})` が sources.osm.tiles 配列形式 + `${BRIDGE_TILE_BASE_URL}` prefix
   - `buildMapStyle({bridgeReachable:false})` が sources.osm.url 形式 + `pmtiles://` scheme
   - 両 mode で sources.gsi-terrain.encoding === 'terrarium'
   - 両 mode で layers === COMMON_LAYERS (= same reference、 双子コピペ物理化)
3. `web/tests/pmtiles_loader.test.js` (新規、 3 件):
   - `registerPmtilesProtocol(mockMaplibre, mockPmtiles)` が `addProtocol('pmtiles', ...)` を呼ぶ
   - 既登録時の冪等性 (= 2 回呼んでも throw しない)
   - `pmtiles` global 不在 (= 第 2 引数 falsy) で明示 throw
4. `web/tests/viewer_url_audit.test.js` (既存、 +2 件):
   - viewer-map3d.js の source 内に `https://tile.openstreetmap.org` / `https://cyberjapandata.gsi.go.jp` / `https://unpkg.com/pmtiles` 等の外部 URL 文字列を含まない grep (= 既存 NG-R1-15 gate を pmtiles 文字列でも拡張)
   - `STATIC_TILE_BASE_URL` を含む URL は `${BASE_PATH}static` で組まれている grep gate

backend (pytest、 既存 149 件に +5 件):

5. `tests/test_export_static.py` (新規、 5 件):
   - 空 DB → 0 file export + 例外なし
   - 179 GSI PNG → file ツリー全件 landed + bytes 一致 (= SELECT data → write_bytes と SHA256 比較)
   - PMTiles copy 後 size 一致 (= shutil.copy2 + os.path.getsize)
   - course.json copy 後 内容一致
   - 出力 dir 既存時の overwrite 挙動 (= 古い file が新しい内容で上書き、 古い file が孤児として残らない)

物理 gate (= 既存 `web/tests/viewer_url_audit.test.js` 同型):

6. `scripts/export_static.py` 内に `http://` / `https://` 文字列を含まない grep (= export は **DB 読み出しのみ、 外部 fetch ゼロ**、 NG-R1-15 物理化、 audit gate に 1 件追加)
7. `web/lib/vendor/pmtiles.js` 存在確認 + `web/index.html` 内 `<script src="./lib/vendor/pmtiles.js">` 1 行 grep gate (= CDN 経由化 regression 防止)

合計 +14-16 件 + audit gate 2 件、 既存 192 vitest + 149 pytest 不変。

## やらないこと

- **Web Bluetooth (= 実 trainer 接続)**: phase 2 (= brief 32)、 GATT / FTMS / HRM の Web Bluetooth API 化は完全別レイヤー、 静的サイトでは BLE 不要
- **Strava upload / ride history**: phase 3 (= brief 33)、 IndexedDB 化 / OAuth / FIT export 等は static で完結する別 brief 群
- **bridge.py / tile_server.py / http_app.py の削除**: ローカル運用 (= 実 trainer + ride 記録) は bridge mode で継続、 GitHub Pages mode は **追加** であって置換ではない、 既存 entry point 全て無変更で共存
- **Cesium 版**: 既に brief 12 で凍結済、 touch 禁止 (= NG-R1-2 再演)。 本 brief は workflow staging で `_site/` から `web/archived/` を除外することで物理化を強化
- **PMTiles 経由でない OSM 直叩き fallback**: 起動時に `https://tile.openstreetmap.org` を fallback する設計は **絶対追加するな** (= NG-R1-15 LOAD-BEARING 再演、 OSM Tile Usage Policy 違反 class、 Rule 11 C1)
- **GSI 標高タイルの runtime DL**: static 配信は landed 済の 179 ファイルだけ、 不足 zoom の自動補完は禁止 (= NG-R1-16 同型、 GSI ToS の大量アクセス自粛)
- **`pmtiles.js` の CDN 配信**: 第三者 origin への runtime fetch を増やすと NG-R1-15 の境界が曖昧化、 vendored copy のみ採用
- **trainer ride 中の Pages 動作**: BLE / ride state / GPX 書き出しは phase 2 まで bridge mode 必須
- **`web/static/` の git track**: `.gitignore` で除外、 Actions workflow が毎回再生成 (= bloat 回避)
- **PMTiles の自動 update / 増量 DL**: data/fuji.pmtiles は repo committed の 3.9 MB 固定、 user が更新したい時のみ手動で `scripts/fetch_osm_pmtiles.py` を回す既存 flow
- **course.json 以外の ride データ配信**: ride 履歴 / GPX 結果 / 計測 log は phase 3
- **新規関数 `detectBridgeMode`**: 既存 `checkSetupStatus` の拡張で済ませる、 双子関数化禁止 (= NG-R1-11)
- **`web/` 全体を Pages に Upload**: `_site/` に staging、 `web/archived/` (= Cesium) / `web/tests/` は除外

## 数値見積もり

- 静的 file 合計サイズ: GSI dem PNG 179 × 平均 97 KB = **17.3 MB** + map.pmtiles **3.9 MB** + course.json (= 約 240 点 × 50 byte = 12 KB) + pmtiles.js vendored **約 80 KB** = **約 21.4 MB**
- GitHub Pages の 1 file 上限: 100 MB、 1 repo 上限 1 GB、 月間 帯域 100 GB → 余裕で 5 桁倍
- `export_static.py` 実行時間: SQLite から 179 row × LENGTH(data) avg 97 KB を write = local SSD で **< 2 秒** + PMTiles copy (= 3.9 MB shutil) **< 0.1 秒**
- GitHub Actions 1 回の build 時間: checkout + pip install + export + staging + upload artifact + deploy = **約 1-2 分**
- 初回 viewer load 時間 (= GitHub Pages 上、 cold cache): HTML 30 KB + viewer-map3d.js 約 60 KB + maplibre CDN 約 280 KB + pmtiles vendored 80 KB + PMTiles 3.9 MB + GSI 9 タイル × 97 KB = **約 5 MB / 約 2-3 秒** (= 100 Mbps 想定)
- bridge mode 自動判定の overhead: `fetch(/tiles/_setup_status, timeout=500ms)` = bridge あり **< 50 ms** で resolve / Pages の 404 即時 **< 30 ms** / network error も timeout 待たず即 catch、 500 ms は worst case 上限

## ハマる罠

- **pmtiles.js と MapLibre `addProtocol` の登録順序**: `maplibregl.addProtocol('pmtiles', ...)` を `new maplibregl.Map(...)` より前に呼ばないと、 初回 tile request が 'No protocol handler' で fail。 `index.html` で `<script src="maplibre">` → `<script src="./lib/vendor/pmtiles.js">` → `<script src="viewer-map3d.js">` の順、 viewer 側の module init で `registerPmtilesProtocol(...)` を `new maplibregl.Map` 構築前に同期的に 1 回呼ぶ
- **既存 `addProtocol('gsidem', ...)` との競合**: 別 scheme 名 (= `gsidem` vs `pmtiles`) なので競合しない、 ただし `registerPmtilesProtocol` の冪等性は test 3 で pin
- **map 初期化の遅延 (F 節)**: 既存 viewer は L73 で即 `new maplibregl.Map` を構築している、 本 brief で「mode 判定後に構築」に変える。 副作用: map 構築まで `setAppState('checking')` の `state-checking` body class で `#map` が `display:none` のままになるが、 既存 CSS が `state-checking #map { display: block }` を持つかを実装時に確認、 不在なら CSS 1 行追加
- **GSI dem PNG の SQLite 抽出時の encoding**: tiles 表の data 列は BLOB (= bytes そのまま)、 SQLite3 driver は Python bytes で返す。 `write_bytes(data)` を使う、 `write_text` 禁止 (= encoding 破壊で PNG header の magic 0x89 が壊れる)
- **GitHub Pages の path prefix**: `username.github.io/fujihc-trainer/` 形式 (= project page) では URL prefix が `/fujihc-trainer/` になる、 viewer は `location.pathname` から base を取って組み立て (= F 節)。 user の root domain (= `username.github.io/`) を使わない、 project ごとの subdirectory に landed
- **course.json の path 解決**: 既存 viewer は `fetch('course.json')` (= L681、 相対 path)。 GitHub Pages 上では `/fujihc-trainer/course.json` に解決される。 static mode では `${BASE_PATH}static/course.json` から読みたい、 つまり L681 の fetch URL を mode 別分岐に切替が必要 (= bridge mode は root、 static mode は `${BASE_PATH}static/course.json`)。 implementation で踏み忘れ注意、 test 1 に `course_fetch_url` mode 別 grep gate を追加検討
- **CORS**: 静的 file は同一 origin (= `username.github.io`) なので CORS 問題なし。 ただし OSM raster 直叩きを fallback で追加した瞬間 cross-origin + ToS 違反、 絶対やるな (= NG-R1-15)
- **MapLibre `volatile: false` の挙動**: gsi-terrain source に既存設定 (L97)、 PMTiles 経由 osm source は file 全体を一度 fetch するため `volatile` 不要 (= PMTiles 内部 cache 任せ)
- **`AbortSignal.timeout(500)` の Node test 環境**: vitest (= Node 18+) では `AbortSignal.timeout` 標準対応、 jsdom も support。 Safari 16 未満は非対応だが射程外 (= D 節)
- **bridge mode と static mode で WebSocket 経路が違う**: bridge mode は `ws://localhost:8000/ws` (= 既存)、 static mode は WebSocket 不要 (= ride state は MAP_MODE の fake client が担当)。 E 節の分岐で `initMapMode()` 内 `createTestModeClient` が走り `connectBridge()` は呼ばれない、 WS 接続試行ゼロ、 `Error: WebSocket connection failed` log 抑制

## 完了条件

1. `web/static/` directory + `.gitkeep` + `.gitignore` への entry (= `web/static/tiles/`, `web/static/map.pmtiles`, `web/static/course.json` 除外)
2. `scripts/export_static.py` 新規 (+80 行)、 `export_gsi_dem_tree` + `copy_pmtiles` + `copy_course` + `main` の 4 関数、 argparse CLI 動作、 source 内 `http://` / `https://` ゼロ
3. `web/lib/pmtiles_loader.js` 新規 (+20 行)、 `registerPmtilesProtocol` export
4. `web/lib/vendor/pmtiles.js` (= pmtiles@3.0.6 vendored、 BSD-3-Clause) + `web/lib/vendor/LICENSE-pmtiles` 配置
5. `web/index.html` に `<script src="./lib/vendor/pmtiles.js">` 1 行追加 (= maplibre-gl.js の直後)
6. `web/viewer-map3d.js` (= 約 1225 行 → 約 1280 行):
   - L29 を `BASE_PATH` + `BRIDGE_TILE_BASE_URL` + `STATIC_TILE_BASE_URL` + `TILE_BASE_URL` の 4 const に拡張 (+5 行)
   - L100-133 の layers / sky 配列を `COMMON_LAYERS` / `COMMON_SKY` const に切り出し (+移動のみ)
   - `buildMapStyle({bridgeReachable})` helper 追加 (+30 行、 sources のみ条件分岐、 layers は COMMON 共有)
   - L260 `checkSetupStatus` に AbortSignal.timeout(500) + `bridgeReachable` フィールド (+5 行)
   - L593 `bootCheckSetupStatus` に `!bridgeReachable → initMapMode()` 分岐 (+5 行)
   - map 初期化 (= L73 `new maplibregl.Map`) を `bootCheckSetupStatus` 完了後に遅延 + `buildMapStyle` 経由化 (+10 行 refactor)
   - L681 course.json fetch URL の mode 別分岐 (+3 行)
7. `.github/workflows/pages.yml` 新規 (+50 行)、 actions/checkout@v4 + setup-python@v5 + upload-pages-artifact@v3 + deploy-pages@v4 を明示 version pin、 `_site/` staging で `web/archived/` / `web/tests/` 除外
8. test +14-16 件 全 green (= vitest 192 → 206-208 件、 pytest 149 → 154 件)
9. 物理 grep gate (= `viewer_url_audit.test.js` に +2 件、 `export_static.py` の URL audit 1 件、 vendored pmtiles.js 配置 audit 1 件)
10. ローカル動作確認: (a) `python scripts/export_static.py` 実行 → `web/static/` に 179 PNG + map.pmtiles + course.json landed、 (b) `python -m http.server -d web/ 8000` で `http://localhost:8000/?map=1` を開いて 地形 + 道路 visual 動作確認 (= bridge.py を**起動しない**で動くことが確認できれば static mode が成立)
11. 既存 bridge mode (= `python -m fujihc.bridge` 起動 → `http://localhost:8000/`) も従来通り `state-checking → dbinit/pairing → riding` を辿る (= regression なし)
12. ローカル commit のみ、 push しない (= GitHub Pages 配信の活性化は user 明示 per-action 認可後、 Rule 3)

## まとめ

ship される: `?map=1` / `?test=1` および query 無指定の bridge 不在時に、 GitHub Pages 上で地形 + 道路 + ride 視点を visual に再現する静的サイト。 bridge.py / SQLite / aiohttp の起動ゼロで 21 MB の static 配信のみで viewer デモが完結する。 既存 bridge mode は破壊せず共存、 `checkSetupStatus` の `bridgeReachable` 1 フィールドで自動切替。 pmtiles.js は vendored、 Pages workflow は `_site/` staging で Cesium 版 / tests を除外し NG-R1-2 物理化を強化。

ship されない: Web Bluetooth (= phase 2)、 Strava upload / ride history (= phase 3)、 PMTiles 自動 DL、 OSM / GSI runtime 直叩き、 Cesium 改修、 `web/static/` の git track、 pmtiles.js の CDN 化、 `detectBridgeMode` 新規関数。

## 次の atom

- brief 32: Web Bluetooth Trainer 接続 (= Pages 配信下で FTMS / HRM を Web Bluetooth API で読む、 bridge.py 不要化の Phase 2、 BLE pairing 後の ride 状態管理は IndexedDB 化検討)
- brief 33: Strava upload + ride 履歴 (= Phase 3、 Strava API は本人 OAuth 限定で C2 class、 ride 完走時 FIT 書き出し → Strava upload、 ride history は IndexedDB 永続化 + viewer 内一覧 UI)
- brief 31b 候補 (= phase 1 polish): PMTiles の zoom 範囲拡張 (= 現状 z13-15 で z11 以下が 404、 minimap で粗 zoom 用に z9-12 追加 export)、 GSI dem の不足 zoom 補完 (= 現状 z14 が 120 タイル、 ride 視点で十分だが overview 視点 z8-10 で 6 タイル止まり)、 maplibre-gl の vendoring (= pmtiles と同型、 CDN 依存ゼロ化)
