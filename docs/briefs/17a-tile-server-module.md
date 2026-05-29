---
brief: 17a-tile-server-module
title: tile_server.py 独立 module (bridge.py から分離)
parent_project: ~/fujihc-trainer/
created: 2026-05-14
revised: 2026-05-14 (Round 2: bridge.py 肥大回避のため brief 17 を 17a / 17b に分割)
depends_on: [14-tile-local-db, 15-gsi-dem-bulk-dl, 16-osm-pmtiles-fetch]
blocks: [17b-viewer-tile-endpoint]
---

# Brief 17a: tile_server module 分離

## はじめに

Round 2 audit の設計境界軸で「bridge.py 肥大 (= 既に 877 行、 BLE + WebSocket + 静的 file 配信 + ride state を持つ、 そこに tile endpoint 3 種を追加で responsibility 6 種になる)」が DRIFT-RISK で flag された。 viewer 内 inline 問題 (= NG-R1-7) を backend にコピーする構造。

本 brief は **brief 17 を 2 つに分割した前半**。 tile server を `src/fujihc/tile_server.py` に独立 module として実装し、 bridge.py からは `register_tile_routes(http_server, db_path)` で mount するだけ。 bridge.py 本体には新規ロジックを書かない。

## 何を作るか

`src/fujihc/tile_server.py` (新規)。 SQLite から読み出して HTTP response を組み立てる pure に近い module。 BLE / WebSocket / ride state 依存ゼロ:

```python
# src/fujihc/tile_server.py
"""ローカル tile DB を HTTP で配信する read-only module.

bridge.py から register_tile_routes(http_server, db_path) で mount.
BLE / WebSocket / ride state 依存ゼロ.
"""
import json, sqlite3, asyncio
from pathlib import Path

CONTENT_TYPES = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'pbf': 'application/x-protobuf',
}
VALID_SOURCES = ('osm', 'gsi_dem')

def get_tile(db_path, source, z, x, y):
    """1 タイルを DB から read. brief 14 schema 前提.

    return: (status: int, content_type: str | None, data: bytes | None)
        status 200: tile 存在 + fetch_status=200
        status 404: tile 存在せず or fetch_status != 200
        status 400: source 不正
        status 503: DB 不在 (= setup 未完了)
    """
    if source not in VALID_SOURCES:
        return (400, None, None)
    if not Path(db_path).exists():
        return (503, None, None)
    with sqlite3.connect(db_path) as db:
        row = db.execute(
            'SELECT format, data, fetch_status FROM tiles '
            'WHERE source=? AND zoom_level=? AND tile_column=? AND tile_row=?',
            (source, z, x, y),
        ).fetchone()
    if row is None:
        return (404, None, None)
    fmt, data, status = row
    if status != 200 or data is None:
        return (404, None, None)
    return (200, CONTENT_TYPES.get(fmt, 'application/octet-stream'), data)

def get_metadata(db_path, source):
    """metadata table から source の全 row を dict で返す.

    return: (status: int, dict | None)
    """
    if source not in VALID_SOURCES:
        return (400, None)
    if not Path(db_path).exists():
        return (503, None)
    with sqlite3.connect(db_path) as db:
        rows = db.execute(
            'SELECT name, value FROM metadata WHERE source=?', (source,)
        ).fetchall()
    if not rows:
        return (404, None)
    return (200, dict(rows))

def build_style_json(db_path, base_url='/tiles'):
    """MapLibre style 形式の JSON を返す. OSM (vector) と GSI dem (raster-dem) を統合.

    base_url: viewer から見た tile endpoint の base, default '/tiles'.
    return: (status: int, dict | None)
    """
    if not Path(db_path).exists():
        return (503, None)
    osm_status, osm_meta = get_metadata(db_path, 'osm')
    gsi_status, gsi_meta = get_metadata(db_path, 'gsi_dem')
    if osm_status != 200 or gsi_status != 200:
        return (503, None)  # どちらか setup 未完了
    style = {
        'version': 8,
        'sources': {
            'osm': {
                'type': 'vector',
                'tiles': [f'{base_url}/osm/{{z}}/{{x}}/{{y}}.pbf'],
                'minzoom': int(osm_meta.get('minzoom', 14)),
                'maxzoom': int(osm_meta.get('maxzoom', 18)),
                'attribution': osm_meta.get('attribution', ''),
            },
            'gsi_dem': {
                'type': 'raster-dem',
                'tiles': [f'{base_url}/gsi_dem/{{z}}/{{x}}/{{y}}.png'],
                'minzoom': int(gsi_meta.get('minzoom', 14)),
                'maxzoom': int(gsi_meta.get('maxzoom', 14)),
                'encoding': 'gsi-dem-png',  # viewer 側で terrarium 変換、 brief 18 lib
                'attribution': gsi_meta.get('attribution', ''),
            },
        },
        'layers': [
            # 最小 layer 定義、 完全な style は brief 17b で viewer から override 可
            {'id': 'background', 'type': 'background', 'paint': {'background-color': '#f0f0f0'}},
        ],
    }
    return (200, style)

def register_tile_routes(http_server, db_path):
    """bridge.py の HTTP server に tile route を mount.

    実装は http_server の API による (= bridge.py 側の選択肢に合わせる).
    本 brief は handler 関数の提供まで、 mount は bridge.py で 5 行追加.
    """
    # 具体的な mount コードは bridge.py 側で書く、 ここでは handler 関数群を export するだけ
    return {
        'tile': lambda src, z, x, y: get_tile(db_path, src, z, x, y),
        'metadata': lambda src: get_metadata(db_path, src),
        'style': lambda: build_style_json(db_path),
    }
```

bridge.py 側の変更は **5-10 行のみ**: `from fujihc.tile_server import register_tile_routes` + HTTP server への route 登録だけ。 ロジックは tile_server.py 内。

## やらないこと

- viewer-map3d.js の tile source URL 書き換え (= brief 17b)
- prefetch dead code の削除 (= brief 17b)
- MapLibre style.json の完全 layer 定義 (= brief 17b で viewer 側 override、 17a は最小の skeleton のみ)
- 走行中の DB write (= read-only、 write は scripts 経由のみ)
- tile cache header の chunked / streaming 対応 (= 1 タイル数十-数百 KB、 一括 response で十分)

## 完了条件

1. `src/fujihc/tile_server.py` landed
2. `bridge.py` で `register_tile_routes` を import、 HTTP server に mount (5-10 行追加)
3. `bridge.py` 起動 → curl で endpoint 確認:
   - `curl http://localhost:8000/tiles/gsi_dem/14/14495/6437.png -o /tmp/t.png` → 200 + PNG bytes
   - `curl http://localhost:8000/tiles/osm/16/57983/25750.pbf -o /tmp/t.pbf` → 200 + pbf bytes
   - `curl http://localhost:8000/tiles/osm/99/0/0.pbf` → 404
   - `curl http://localhost:8000/tiles/invalid/14/0/0.png` → 400
   - DB を rename して `curl ... gsi_dem/14/14495/6437.png` → 503
4. `tests/test_tile_server.py` に **全関数 mandate** で 8-12 件:
   - `get_tile` happy: 既知 tile → 200 + correct Content-Type + bytes 一致
   - `get_tile` 404: 存在しない z/x/y → 404
   - `get_tile` fetch_status=404: DB 行存在するが status=404 → 404
   - `get_tile` 400: invalid source → 400
   - `get_tile` 503: DB 不在 → 503
   - `get_metadata` happy: 既知 source → 200 + dict
   - `get_metadata` 404: metadata 空 → 404
   - `get_metadata` 400/503: 同様
   - `build_style_json` happy: osm/gsi_dem 両方の metadata 揃い → 200 + valid style dict (= sources / layers キー有)
   - `build_style_json` 503: どちらか metadata 不在 → 503
   - `register_tile_routes`: dict of 3 handler を返す
5. `pytest` で 全 test green (brief 14-16 + 本 brief = 32-42 件)
6. bridge.py の **既存 test (`test_ws_smoke.py` 等)** が壊れていない (= 5-10 行追加で WebSocket 経路に影響なし)
7. ローカル commit、 push しない

## ハマる罠

- sqlite3 は thread-safe だが connection 単位、 async server なら `asyncio.to_thread(get_tile, ...)` で wrap 推奨
- DB 不在時に 503 を返すのは brief 17b の中間状態保証 (= setup 未完了で viewer が真っ白にならず error 表示)
- Content-Type を `application/x-protobuf` で返さないと MapLibre が pbf として解釈しない
- bridge.py の HTTP server (aiohttp / starlette / 自作?) を確認、 route 登録 API はそれに合わせる
- `build_style_json` の `layers` は最小、 brief 17b で viewer 側 layer 定義を override 可能にする

## まとめ

完了条件: tile_server.py landed / bridge.py に 5-10 行追加 / curl 5 種で動作確認 / 8-12 件 unit test / pytest 全 green / 既存 backend test 不変。

ship される: tile 配信が独立 module、 bridge.py の責務肥大回避、 503 fallback で中間状態 (DB 不在) を viewer に明示伝達可能。
ship されない: viewer 経路書き換え (= 17b)、 完全 layer 定義 (= 17b)。

次の atom: brief 17b (viewer 側書き換え)、 endpoint が動く状態で viewer を切り替える。
