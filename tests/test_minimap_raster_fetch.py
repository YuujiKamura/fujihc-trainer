"""brief 30: fujihill.dbinit.fetch_minimap_raster_async の unit test.

実 OSM タイルサーバには絶対叩かない (= urlopen を mock 駆動). 起動時 1-shot
fetch + DB cache + dedup + 404 残し + metadata 書き込みを pin する.
"""
from __future__ import annotations

import asyncio
import io
import sqlite3
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'src'))
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

import init_tile_db  # noqa: E402
from fujihill import dbinit  # noqa: E402
from fujihill.tile_constants import MINIMAP_BBOX, MINIMAP_OSM_ZOOM  # noqa: E402
from fujihill.tile_coverage import enumerate_bbox_tiles  # noqa: E402


# 小さい bbox (= 1-2 タイルに収まる) で test を高速化. 実 default は MINIMAP_BBOX.
SMALL_BBOX = (138.70, 35.40, 138.71, 35.41)
SMALL_ZOOM = 11


@pytest.fixture
def empty_db(tmp_path):
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    return db


def _run(coro):
    return asyncio.run(coro)


def _png_cm():
    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100)

        def __exit__(self, *a):
            return False
    return _CM()


def test_fetch_minimap_raster_async_happy_inserts_rows(empty_db):
    """mock urlopen で bbox 内全タイルが source='osm_raster' fetch_status=200 で入る."""
    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        result = _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0,
        ))
    expected = len(enumerate_bbox_tiles(SMALL_BBOX, SMALL_ZOOM))
    assert result['total'] == expected
    assert result['fetched'] == expected
    assert result['skipped'] == 0
    with sqlite3.connect(empty_db) as db:
        n = db.execute(
            "SELECT COUNT(*) FROM tiles "
            "WHERE source='osm_raster' AND fetch_status=200"
        ).fetchone()[0]
    assert n == expected


def test_fetch_minimap_raster_async_progress_cb(empty_db):
    """progress_cb が n=0..total まで呼ばれる、 phase は fetching → done、 source='osm_raster'."""
    calls = []

    def cb(payload):
        calls.append(dict(payload))

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0, progress_cb=cb,
        ))
    assert all(c['source'] == 'osm_raster' for c in calls)
    assert calls[0]['phase'] == 'fetching'
    assert calls[0]['n'] == 0
    assert calls[-1]['phase'] == 'done'
    assert calls[-1]['n'] == calls[-1]['total']


def test_fetch_minimap_raster_async_dedup_existing(empty_db):
    """既存 row は skip され fetched に含まれない (= 再起動でも重複 fetch しない)."""
    tiles = sorted(enumerate_bbox_tiles(SMALL_BBOX, SMALL_ZOOM))
    z, x, y = tiles[0]
    with sqlite3.connect(empty_db) as db:
        db.execute(
            'INSERT INTO tiles (source, zoom_level, tile_column, tile_row, '
            'format, data, fetched_at, fetch_status) '
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ('osm_raster', z, x, y, 'png', b'preexisting', 200),
        )
        db.commit()
    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        result = _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0,
        ))
    assert result['skipped'] >= 1
    assert result['skipped'] + result['fetched'] >= result['total']


def test_fetch_minimap_raster_async_404_keeps_row(empty_db):
    """404 でも fetch_status=404 で row 残し、 再 fetch を抑止."""
    err = urllib.error.HTTPError(
        url='http://x', code=404, msg='Not Found', hdrs=None, fp=None,
    )
    with patch('fujihill.dbinit.urllib.request.urlopen', side_effect=err):
        result = _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0,
        ))
    assert result['fetched'] == 0
    with sqlite3.connect(empty_db) as db:
        rows = db.execute(
            'SELECT fetch_status FROM tiles WHERE source=?', ('osm_raster',),
        ).fetchall()
    assert all(r[0] == 404 for r in rows)
    assert len(rows) >= 1


def test_fetch_minimap_raster_async_writes_metadata(empty_db):
    """metadata に attribution / license=ODbL-1.0 / format=png / minzoom=11 / maxzoom=11 が入る."""
    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0,
        ))
    with sqlite3.connect(empty_db) as db:
        rows = dict(db.execute(
            'SELECT name, value FROM metadata WHERE source=?', ('osm_raster',),
        ).fetchall())
    assert 'attribution' in rows
    assert 'OpenStreetMap' in rows['attribution']
    assert rows['license'] == 'ODbL-1.0'
    assert rows['format'] == 'png'
    assert rows['minzoom'] == str(SMALL_ZOOM)
    assert rows['maxzoom'] == str(SMALL_ZOOM)
    assert 'fetched_by' in rows


def test_fetch_minimap_raster_async_accepts_async_cb(empty_db):
    """progress_cb が coroutine を返しても await される (= bridge から coroutine 渡せる)."""
    calls = []

    async def acb(payload):
        calls.append(dict(payload))

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0, progress_cb=acb,
        ))
    assert len(calls) >= 2  # initial + done


def test_minimap_bbox_covers_viewer_request_set():
    """2026-05-15 regression: MINIMAP_BBOX が viewer (= buildMinimapTopBase) の
    要求 16 タイル全てを含むこと.

    過去事故: 旧 MINIMAP_BBOX = (138.65, 35.30, 138.85, 35.50) は z=11 で
    x=[1812..1813] y=[807..809] = 6 タイルしかカバーしていなかった。 viewer 側は
    course bbox + 20% margin + buffer=1 で x=[1811..1814] y=[806..809] = 16 タイル
    を要求するため、 10 タイル分が DB に存在せず 404 を量産していた。

    本 test は viewer JS (buildMinimapTopBase in web/viewer-maplibre.js) と同一の
    tile-index 算出を Python で再現し、 MINIMAP_BBOX で覆われる set が viewer の
    要求 set を superset 包含することを assert する。 MINIMAP_BBOX を再度
    narrowing したらここで fail し、 console 404 の再演を物理的に止める。
    """
    import json
    import math

    from fujihill.tile_constants import MINIMAP_BBOX, MINIMAP_OSM_ZOOM
    from fujihill.tile_coverage import enumerate_bbox_tiles

    course_p = REPO_ROOT / 'web' / 'course.json'
    course = json.loads(course_p.read_text(encoding='utf-8'))
    assert len(course) > 0

    # === viewer JS と同一ロジックで 16 タイル set を構築 (=
    # buildMinimapTopBase in viewer-maplibre.js の bbox+20%margin+buffer=1) ===
    min_lat = min(p['lat'] for p in course)
    max_lat = max(p['lat'] for p in course)
    min_lon = min(p['lon'] for p in course)
    max_lon = max(p['lon'] for p in course)
    lat_m = (max_lat - min_lat) * 0.20
    lon_m = (max_lon - min_lon) * 0.20
    min_lat -= lat_m
    max_lat += lat_m
    min_lon -= lon_m
    max_lon += lon_m

    def lon_to_tile_x(lon, z):
        return (lon + 180.0) / 360.0 * (1 << z)

    def lat_to_tile_y(lat, z):
        rad = math.radians(lat)
        return (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * (1 << z)

    z = MINIMAP_OSM_ZOOM
    buffer = 1
    min_tx = math.floor(lon_to_tile_x(min_lon, z)) - buffer
    max_tx = math.floor(lon_to_tile_x(max_lon, z)) + buffer
    min_ty = math.floor(lat_to_tile_y(max_lat, z)) - buffer
    max_ty = math.floor(lat_to_tile_y(min_lat, z)) + buffer
    viewer_requests = {
        (z, tx, ty)
        for tx in range(min_tx, max_tx + 1)
        for ty in range(min_ty, max_ty + 1)
    }
    assert len(viewer_requests) == 16, (
        f'viewer JS は富士スバルライン course で 16 タイルを要求する前提 '
        f'(= {len(viewer_requests)} だと test 自身の前提崩壊)'
    )

    bbox_covers = enumerate_bbox_tiles(MINIMAP_BBOX, MINIMAP_OSM_ZOOM)
    missing = viewer_requests - bbox_covers
    assert not missing, (
        f'MINIMAP_BBOX が viewer 要求の {len(missing)} タイルを覆えていない: '
        f'{sorted(missing)}. MINIMAP_BBOX={MINIMAP_BBOX}, '
        f'bbox 内 enum タイル数={len(bbox_covers)}, viewer 要求={len(viewer_requests)}. '
        f'2026-05-15 console 404 量産事故の再演 — bbox を広げ直す必要あり.'
    )
