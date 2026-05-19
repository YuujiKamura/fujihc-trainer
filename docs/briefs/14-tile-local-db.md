---
brief: 14-tile-local-db
title: ローカル tile DB の設計 (SQLite + 中央 const + 総量見積もり)
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2 audit 受け、 数字根拠 / schema_version / corridor 中央定数化)
depends_on: [12-cesium-freeze]
blocks: [15-gsi-dem-bulk-dl, 16-osm-pmtiles-fetch, 17a-tile-server-module, 17b-viewer-tile-endpoint]
---

# Brief 14: ローカル tile DB schema 設計

## はじめに

7 軸 audit の設計境界軸とセキュリティ軸で「viewer 内 inline prefetch + 第三者 ToS 違反」が flag された。 brief 13 で違反を停止した後、 中期解として **タイルを 1 回だけ計画的に DL してローカル DB に保管、 走行時は外部 fetch ゼロ** という構造に移行する。 本 brief は DB schema、 中央定数、 総量見積もりを確定する load-bearing な前提工程。

Round 2 audit を受けて Round 1 ドラフトから 3 点を確定:
1. **総量見積もり** を実計算 (= 何 MB DL になるか user が判断できる形)
2. **`schema_version`** を最初から持ち、 NG-R1-14 (silent drift) を防ぐ
3. **`corridor_m` を中央定数** で固定、 brief 15/16 はこれを参照 (= corridor 値 drift を防ぐ)
4. **MBTiles 互換主張を撤回**、 「MBTiles に似た schema だが拡張あり、 spec 厳密準拠ではない」を明示

## 総量見積もり (実計算)

富士ヒル course (`web/course.json` 1968 点、 外接矩形 lat 35.373-35.452 / lon 138.690-138.759、 6.2 km × 8.8 km、 + 余白 1 km) を **corridor 3x3** (= 各 course 点とその周辺 8 タイル) でカバーした場合のタイル数:

| zoom | bbox 矩形 | corridor 3x3 | 用途 |
|---|---|---|---|
| 14 | 35 | 36 | GSI dem 標高 |
| 15 | 96 | 70 | OSM 中域 |
| 16 | 368 | 148 | OSM 中-近域 |
| 17 | 1440 | 300 | OSM 近域 |
| 18 | 5632 | 631 | OSM 最近 |

**合計 (corridor 3x3 + zoom 17 単一化採用、 2026-05-15 確定)**: 300 OSM タイル + 36 GSI タイル = **336 タイル**

サイズ概算:
- OSM vector pbf 平均 50 KB/tile × 300 = **約 15 MB**
- GSI dem PNG 平均 30 KB/tile × 36 = **約 1 MB**
- 合計 SQLite DB サイズ: **約 16 MB** (= 旧案 5 zoom 段なら 60 MB、 1/4)

DL 時間:
- GSI: 1 req/s × 36 = **約 36 秒** (= zoom 14 のみ、 富士ヒル範囲全部取っても 1 分かからない)
- OSM: PMTiles から抽出 (= 外部 fetch ではなく PMTiles ファイル内 read)、 数秒で完了

判断根拠: 旧案は zoom 14-18 の 5 段 × corridor 3x3 で 1185 タイル / 59 MB。 ride 中の MapLibre は viewport 倍率に応じて zoom 切替で異なるタイル texture を VRAM upload する、 これが GPU fan の振動因子と推定。 **zoom 17 単一化** すれば texture set が固定 (= upload は初回のみ)、 ride 視点の zoom 23 は overzoom (= ベクトル拡大) で粗くならない。 brief 20 (計測 substrate) で nvidia-smi polling + FPS HUD を回し、 ride 中の温度 / fan / FPS を旧案と比較する。

## 中央定数 (`src/fujihc/tile_constants.py`)

brief 15/16/17 が参照する単一の真実源:

```python
# src/fujihc/tile_constants.py
"""ローカル tile DB の中央定数. brief 14 で確定, brief 15/16/17 が参照."""

# corridor: コース sample 点周辺の何タイル分を取るか
# 3 = 3x3 (= 中央 + 周辺 8 タイル), 1 = 中央のみ
DEFAULT_CORRIDOR_TILES = 3

# 余白 (corridor とは別、 外接矩形に対する余白)
DEFAULT_BUFFER_M = 1000  # 1 km

# zoom 範囲 (brief 15/16 で source 別に override 可)
GSI_DEM_ZOOMS = [14]                      # 標高は 14 で十分 (= MapLibre terrain 要求最大)
# OSM は zoom 17 1 段に固定 (2026-05-15 user 判断). MapLibre が ride 視点 zoom 23
# を表示する時は overzoom (= ベクトル拡大、 粗くならない) で対応.
# 効果: DB 1185 タイル/59 MB -> 300 タイル/15 MB、 ride 中 GPU texture upload 頻度激減.
OSM_VECTOR_ZOOMS = [17]

# レート制限 (GSI のみ、 OSM PMTiles 抽出は適用外)
GSI_RATE_LIMIT_SEC = 1.0  # 地理院規約「大量アクセス自粛」の安全側、 1 req/s

# DL 上限警告 (これを超えたら user 確認を求める)
TILE_FETCH_WARN_THRESHOLD = 1000

# DB schema version (migration 用、 PRAGMA user_version と同期)
SCHEMA_VERSION = 1
```

`brief 15/16` の script はこの定数を import、 `--corridor-tiles` 等の CLI 引数で override 可能だが default は中央定数。

## DB 構造

SQLite ファイル 1 個、 場所: `~/fujihc-trainer/data/tiles.sqlite`。 **MBTiles 完全互換ではない**: source 列拡張 + XYZ 座標系採用で spec 逸脱、 QGIS / tippecanoe で直接読めない可能性あり。 互換性が必要になった時に export スクリプトで MBTiles 純正形式に変換する別 brief を後で書く。

```sql
PRAGMA user_version = 1;  -- schema_version と同期

CREATE TABLE tiles (
  source TEXT NOT NULL,         -- 'osm' / 'gsi_dem' / 'gsi_std' (将来用)
  zoom_level INTEGER NOT NULL,
  tile_column INTEGER NOT NULL,
  tile_row INTEGER NOT NULL,    -- XYZ scheme (TMS 反転なし)
  format TEXT NOT NULL,         -- 'png' / 'jpg' / 'pbf'
  data BLOB,                    -- 404 / fetch 失敗時は NULL、 行は残す (= 再試行スキップ用)
  fetched_at TEXT NOT NULL,
  fetch_status INTEGER NOT NULL DEFAULT 200,  -- 200 / 404 / その他
  PRIMARY KEY (source, zoom_level, tile_column, tile_row)
);
CREATE INDEX idx_tiles_source_zxy ON tiles(source, zoom_level, tile_column, tile_row);

CREATE TABLE metadata (
  source TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (source, name)
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
INSERT INTO schema_migrations (version, applied_at, description)
VALUES (1, datetime('now'), 'initial schema, brief 14');
```

`fetch_status` 列の追加で 404 を「未取得」と区別できる (= NG-R1-14 防止)。 schema 変更時は `schema_migrations` に追記、 `PRAGMA user_version` を bump。

## 補助: course 沿いタイル列挙

`src/fujihc/tile_coverage.py` (新規) に pure function を実装。 brief 18 で JS 版を同 logic で作る:

```python
def enumerate_coverage_tiles(course, zoom_levels, corridor_tiles=DEFAULT_CORRIDOR_TILES):
    """course (list of dict with lat/lon) を corridor 込みで覆うタイル座標 set を返す.

    corridor_tiles: 各 course 点の周辺何タイルを含めるか.
                    3 なら 3x3 (= 中央 + 周辺 8), 1 なら中央のみ.
    return: set of (zoom, x, y) tuples (XYZ scheme).
    """

def compute_bounds(course, buffer_m=DEFAULT_BUFFER_M):
    """course から外接矩形 [west, south, east, north] を計算, 余白 buffer_m を加える.

    buffer_m: 矩形に対する余白 (m). 富士ヒル course だと 1km で十分余裕.
    return: tuple of 4 floats (W, S, E, N).
    """

def estimate_tile_count(course, zoom_levels, corridor_tiles=DEFAULT_CORRIDOR_TILES):
    """enumerate_coverage_tiles の結果から (zoom, count) リストを返す.

    DL 前の見積もり用. 上記表の数値と一致するかを test で担保.
    """
```

## やらないこと

- 実 DL (= brief 15/16)
- viewer から DB を読む経路 (= brief 17a/17b)
- MBTiles 純正形式での export (= 必要が出たら別 brief)
- DB を git commit (= `.gitignore` 済、 セットアップ script で各自 PC で生成)
- 走行中の DB write (= read-only 運用、 write は scripts 経由のみ)

## 完了条件

1. `~/fujihc-trainer/data/.gitkeep` を作成、 `.gitignore` に `data/*.sqlite` 追加
2. `src/fujihc/tile_constants.py` に上記の中央定数 6 個 + SCHEMA_VERSION
3. `src/fujihc/tile_coverage.py` に `enumerate_coverage_tiles`, `compute_bounds`, `estimate_tile_count` の 3 関数
4. `scripts/init_tile_db.py` で空 DB を schema_v1 で作成、 `PRAGMA user_version` 設定、 `schema_migrations` 初期 row 投入
5. `tests/test_tile_coverage.py` に **全関数 mandate** で 6-8 件:
   - `enumerate_coverage_tiles` happy: 富士ヒル course を corridor=3 で zoom 14 → 36 タイル (上記表と一致)
   - `enumerate_coverage_tiles` edge: corridor=1 と corridor=3 で差が出る
   - `enumerate_coverage_tiles` 決定性: 同 input で同 output
   - `compute_bounds` happy: 富士ヒル course → W=138.681 S=35.364 E=138.768 N=35.461 (buffer 1km 込み)
   - `compute_bounds` edge: 1 点だけの course でも返る
   - `estimate_tile_count` happy: 上記表の数値と一致
   - `estimate_tile_count` 単調性: zoom が上がるとタイル数が増える
6. `scripts/init_tile_db.py` の unit test: 空 DB が作られ schema_v1 + migration row が入っている
7. `pytest` で全 test green (既存 6 + 新規 7-9 = 13-15 件)
8. README に「初回セットアップ: `python scripts/init_tile_db.py`」「想定 DB サイズ約 60 MB」「DL 時間約 36 秒 (GSI) + 数秒 (OSM)」を追加

## ハマる罠

- SQLite の `PRAGMA user_version` は scope を超えると忘れがち、 `init_tile_db.py` で必ず設定
- `fetched_at` を `datetime('now')` で入れると UTC、 表示時にタイムゾーン変換が必要、 `datetime('now', 'localtime')` でも可だが migrate 時の比較で trap、 UTC 固定が安全
- `enumerate_coverage_tiles` の Web Mercator 計算で経度ラップアラウンド (= -180/+180 境界) を踏むのは日本の経度 (138 度) では無関係、 ただし test で境界値 confirmation はしない (= 過剰)
- corridor=3 で「3x3 タイル」 = 各 course 点周辺の 9 タイル、 命名が紛らわしいので docstring と関数名で明示。 `corridor_radius_tiles` の方が誤読しにくいが既存の命名習慣に合わせる、 ただし関数の docstring 必須

## まとめ

完了条件: data ディレクトリ / 中央定数 / 3 pure 関数 + 全関数 test / init script + test / DB schema_v1 / 全 pytest green / README に見積もり数値。

ship される: 後続 brief 15/16/17 が参照する中央真実源、 corridor / zoom / rate / threshold が単一定数で固定された状態、 60 MB / 36 秒 の総量見積もりを user が事前に判断できる。
ship されない: 実 DL、 viewer 経路、 MBTiles 純正 export。

次の atom: brief 15 と brief 16 は並列着手可能、 両方 brief 14 を import。
