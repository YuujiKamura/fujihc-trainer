"""ローカル tile DB を HTTP で配信する read-only module (brief 17a).

bridge.py から register_tile_routes(db_path) で handler dict を取得し、
HTTP server (aiohttp 等) に mount する想定。 BLE / WebSocket / ride state 依存ゼロ。

brief 14 schema 前提:
    tiles(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status)
    metadata(source, name, value)

brief 20 連携:
    get_tile 呼出ごとに _metrics に count up、 get_metrics / reset_metrics で参照 / 初期化。
"""
import json
import sqlite3
from pathlib import Path

from fujihc.tile_constants import (
    DEFAULT_CORRIDOR_TILES,
    GSI_DEM_ZOOMS,
    MINIMAP_BBOX,
    MINIMAP_OSM_ZOOM,
    OSM_VECTOR_ZOOMS,
)
from fujihc.tile_coverage import enumerate_bbox_tiles, enumerate_coverage_tiles

CONTENT_TYPES = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'pbf': 'application/x-protobuf',
}
# brief 30: 'osm_raster' は minimap (= #minimap-top canvas) 用の raster PNG.
# 起動時 1-shot fetch → DB 保存、 以降は DB から hit. 既存 'osm' (vector pbf)
# / 'gsi_dem' (raster-dem PNG) と同格.
VALID_SOURCES = ('osm', 'gsi_dem', 'osm_raster')

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

    encoding 注記:
        gsi_dem source の encoding は MapLibre 標準 'terrarium' を宣言する.
        DB には GSI dem_png (PNG bytes) がそのまま格納されているが,
        viewer 側 (web/lib/terrarium.js) が addProtocol('gsidem', ...) で
        gsi_dem_png_to_terrarium 変換を行ってから MapLibre に渡す前提なので,
        server は変換せず, MapLibre が最終的に受け取る encoding 名を宣言する.

    minzoom / maxzoom default:
        metadata 不在時の fallback は magic number ではなく中央定数
        (OSM_VECTOR_ZOOMS / GSI_DEM_ZOOMS) の min/max から取る. 中央定数を
        拡張した瞬間 default も追従する.
    """
    if not Path(db_path).exists():
        return (503, None)
    osm_status, osm_meta = get_metadata(db_path, 'osm')
    gsi_status, gsi_meta = get_metadata(db_path, 'gsi_dem')
    if osm_status != 200 or gsi_status != 200:
        return (503, None)
    osm_min = int(osm_meta.get('minzoom', min(OSM_VECTOR_ZOOMS)))
    osm_max = int(osm_meta.get('maxzoom', max(OSM_VECTOR_ZOOMS)))
    gsi_min = int(gsi_meta.get('minzoom', min(GSI_DEM_ZOOMS)))
    gsi_max = int(gsi_meta.get('maxzoom', max(GSI_DEM_ZOOMS)))
    style = {
        'version': 8,
        'sources': {
            'osm': {
                'type': 'vector',
                'tiles': [f'{base_url}/osm/{{z}}/{{x}}/{{y}}.pbf'],
                'minzoom': osm_min,
                'maxzoom': osm_max,
                'attribution': osm_meta.get('attribution', ''),
            },
            'gsi_dem': {
                'type': 'raster-dem',
                'tiles': [f'{base_url}/gsi_dem/{{z}}/{{x}}/{{y}}.png'],
                'minzoom': gsi_min,
                'maxzoom': gsi_max,
                'encoding': 'terrarium',
                'attribution': gsi_meta.get('attribution', ''),
            },
        },
        'layers': [
            {'id': 'background', 'type': 'background', 'paint': {'background-color': '#f0f0f0'}},
        ],
    }
    return (200, style)


def get_setup_status(db_path, course_path):
    """source 別の DB 充足度 + overall 状態を返す pure function (brief 26b).

    各 source (gsi_dem / osm) について
        tiles_expected = len(enumerate_coverage_tiles(course, ZOOMS, DEFAULT_CORRIDOR_TILES))
        tiles_present  = COUNT(*) WHERE source=? AND fetch_status=200 AND data IS NOT NULL
    から status を決定 (= empty / partial / ready).
    overall は全 ready → ready, 全 empty → empty, それ以外 → partial.

    return: (status: int, dict | None)
        200: 計算成功 (DB 不在でも sources は空 dict ではなく source 別 status=empty で返す
              ── 「DB 不在 = 全 source empty」を viewer に正確に伝えるため)
        503: course_path 不在 (= 起動 substrate 不全、 viewer 側 fallback 不能)
    """
    course_p = Path(course_path)
    if not course_p.exists():
        return (503, None)
    try:
        course = json.loads(course_p.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return (503, None)
    if not isinstance(course, list) or not course:
        return (503, None)

    # source 別 expected 数の計算スキーム:
    # - gsi_dem / osm (vector): course 点列を corridor で覆う → enumerate_coverage_tiles.
    # - osm_raster (minimap): bbox 直接列挙 → enumerate_bbox_tiles. brief 30.
    sources_spec = (
        ('gsi_dem', ('coverage', GSI_DEM_ZOOMS)),
        ('osm', ('coverage', OSM_VECTOR_ZOOMS)),
        ('osm_raster', ('bbox', [MINIMAP_OSM_ZOOM])),
    )
    sources_out = {}
    db_exists = Path(db_path).exists()
    for source, (mode, zooms) in sources_spec:
        if mode == 'bbox':
            # minimap raster は bbox 直接列挙. zoom は 1 段だけだが同 helper を反復.
            expected_set: set = set()
            for z in zooms:
                expected_set |= enumerate_bbox_tiles(MINIMAP_BBOX, z)
            expected = len(expected_set)
        else:
            expected = len(enumerate_coverage_tiles(course, zooms, DEFAULT_CORRIDOR_TILES))
        if db_exists:
            with sqlite3.connect(db_path) as db:
                present = db.execute(
                    'SELECT COUNT(*) FROM tiles '
                    'WHERE source=? AND fetch_status=200 AND data IS NOT NULL',
                    (source,),
                ).fetchone()[0]
        else:
            present = 0
        if present == 0:
            status = 'empty'
        elif present < expected:
            status = 'partial'
        else:
            status = 'ready'
        sources_out[source] = {
            'status': status,
            'tiles_present': int(present),
            'tiles_expected': int(expected),
        }

    statuses = {s['status'] for s in sources_out.values()}
    if statuses == {'ready'}:
        overall = 'ready'
    elif statuses == {'empty'}:
        overall = 'empty'
    else:
        overall = 'partial'

    return (200, {'sources': sources_out, 'overall': overall})


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
