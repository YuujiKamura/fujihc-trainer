"""brief 30: fujihc.dbinit.fetch_minimap_raster_async の unit test.

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
from fujihc import dbinit  # noqa: E402
from fujihc.tile_constants import MINIMAP_BBOX, MINIMAP_OSM_ZOOM  # noqa: E402
from fujihc.tile_coverage import enumerate_bbox_tiles  # noqa: E402


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
    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_png_cm()):
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

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_png_cm()):
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
    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_png_cm()):
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
    with patch('fujihc.dbinit.urllib.request.urlopen', side_effect=err):
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
    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_png_cm()):
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

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_png_cm()):
        _run(dbinit.fetch_minimap_raster_async(
            empty_db, bbox=SMALL_BBOX, zoom=SMALL_ZOOM,
            rate_limit_sec=0.0, progress_cb=acb,
        ))
    assert len(calls) >= 2  # initial + done
