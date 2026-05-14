"""ローカル tile DB を HTTP で配信する read-only module (brief 17a).

bridge.py から register_tile_routes(db_path) で handler dict を取得し、
HTTP server (aiohttp 等) に mount する想定。 BLE / WebSocket / ride state 依存ゼロ。

brief 14 schema 前提:
    tiles(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status)
    metadata(source, name, value)

brief 20 連携:
    get_tile 呼出ごとに _metrics に count up、 get_metrics / reset_metrics で参照 / 初期化。
"""
import sqlite3
from pathlib import Path

CONTENT_TYPES = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'pbf': 'application/x-protobuf',
}
VALID_SOURCES = ('osm', 'gsi_dem')

# brief 20 section 4: source 別 status 別 hit count。
# get_tile の戻り status を str 化して累積。
_metrics = {src: {'200': 0, '404': 0} for src in VALID_SOURCES}


def get_tile(db_path, source, z, x, y):
    """1 タイルを DB から read.

    return: (status: int, content_type: str | None, data: bytes | None)
        status 200: tile 存在 + fetch_status=200
        status 404: tile 存在せず or fetch_status != 200
        status 400: source 不正
        status 503: DB 不在 (= setup 未完了)

    _metrics は status 200 / 404 のときのみ count up (= 400 / 503 は除外、
    これは「DB に対する hit/miss」の指標であって入力 / 環境 error は含めない)。
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
        result = (404, None, None)
    else:
        fmt, data, status = row
        if status != 200 or data is None:
            result = (404, None, None)
        else:
            result = (200, CONTENT_TYPES.get(fmt, 'application/octet-stream'), data)

    # metric 更新 (200 / 404 のみ)
    status_key = str(result[0])
    if source in _metrics and status_key in _metrics[source]:
        _metrics[source][status_key] += 1
    return result


def get_metadata(db_path, source):
    """metadata table から source の全 row を dict で返す.

    return: (status: int, dict | None)
        200: row 1+ 件 → dict(name → value)
        404: row 0 件
        400: source 不正
        503: DB 不在
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
        200: osm + gsi_dem 両 metadata 揃い → style dict
        503: DB 不在 or いずれかの metadata 不在
    """
    if not Path(db_path).exists():
        return (503, None)
    osm_status, osm_meta = get_metadata(db_path, 'osm')
    gsi_status, gsi_meta = get_metadata(db_path, 'gsi_dem')
    if osm_status != 200 or gsi_status != 200:
        return (503, None)
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
                'encoding': 'gsi-dem-png',
                'attribution': gsi_meta.get('attribution', ''),
            },
        },
        'layers': [
            {'id': 'background', 'type': 'background', 'paint': {'background-color': '#f0f0f0'}},
        ],
    }
    return (200, style)


def register_tile_routes(db_path):
    """tile-related handler 関数群を dict で返す.

    bridge.py 側 (= main session が aiohttp 統合で書く) で受け取って HTTP server に mount する。
    本 module は HTTP framework 依存ゼロ。

    return: {
        'tile':     callable(source, z, x, y) → (status, content_type, data),
        'metadata': callable(source)          → (status, dict | None),
        'style':    callable()                → (status, dict | None),
        'metrics':  callable()                → dict,
    }
    """
    return {
        'tile': lambda src, z, x, y: get_tile(db_path, src, z, x, y),
        'metadata': lambda src: get_metadata(db_path, src),
        'style': lambda: build_style_json(db_path),
        'metrics': lambda: get_metrics(),
    }


def get_metrics():
    """現在の _metrics の浅い copy を返す (= 外部からの mutation 防止)."""
    return {src: dict(counters) for src, counters in _metrics.items()}


def reset_metrics():
    """_metrics を初期状態に戻す (= 各 source 200/404 を 0)."""
    for src in _metrics:
        _metrics[src] = {'200': 0, '404': 0}
