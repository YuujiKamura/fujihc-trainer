"""brief 26b: src/fujihc/dbinit.py の async 関数群 unit test.

実 GSI server や実 PMTiles file には絶対叩かない. urlopen / Reader は mock 駆動.
"""
from __future__ import annotations

import asyncio
import io
import sqlite3
import sys
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'src'))
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

import init_tile_db  # noqa: E402
from fujihc import dbinit  # noqa: E402


COURSE = [
    {"lat": 35.4, "lon": 138.7, "elevation_m": 1000, "distance_m": 0},
]


@pytest.fixture
def empty_db(tmp_path):
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    return db


def _run(coro):
    return asyncio.run(coro)


# ---------- fetch_gsi_async ----------

def test_fetch_gsi_async_progress_cb_called_n_zero_to_total(empty_db):
    """progress_cb が n=0..total まで呼ばれる, phase は fetching → done."""
    fake_body = b'\x89PNG\r\n\x1a\n' + b'\x00' * 100

    class _CM:
        def __enter__(self):
            return io.BytesIO(fake_body)
        def __exit__(self, *a):
            return False

    calls = []
    def cb(payload):
        calls.append(dict(payload))

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_CM()):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1,
            rate_limit_sec=0.0, progress_cb=cb,
        ))

    assert result['fetched'] >= 1
    assert result['total'] >= 1
    # 最初は fetching、 最後は done
    assert calls[0]['phase'] == 'fetching'
    assert calls[0]['n'] == 0
    assert calls[-1]['phase'] == 'done'
    assert calls[-1]['n'] == calls[-1]['total']
    # source 一致
    assert all(c['source'] == 'gsi_dem' for c in calls)


def test_fetch_gsi_async_skips_existing_rows(empty_db):
    """既に DB にある (z,x,y) は skip され、 fetched に含まれない."""
    # 1 件先に入れておく
    from fujihc.tile_constants import DEFAULT_CORRIDOR_TILES, GSI_DEM_ZOOMS
    from fujihc.tile_coverage import enumerate_coverage_tiles
    tiles = sorted(enumerate_coverage_tiles(COURSE, GSI_DEM_ZOOMS, 1))
    z, x, y = tiles[0]
    with sqlite3.connect(empty_db) as db:
        db.execute(
            'INSERT INTO tiles (source, zoom_level, tile_column, tile_row, '
            'format, data, fetched_at, fetch_status) '
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ('gsi_dem', z, x, y, 'png', b'preexisting', 200),
        )
        db.commit()

    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG' + b'\x00' * 50)
        def __exit__(self, *a):
            return False

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_CM()):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
        ))
    assert result['skipped'] >= 1
    assert result['skipped'] + result['fetched'] >= result['total']


def test_fetch_gsi_async_404_recorded_as_row(empty_db):
    """404 のタイルも fetch_status=404 で DB 行を残す (= 再 fetch 抑止)."""
    err = urllib.error.HTTPError(
        url='http://x', code=404, msg='Not Found', hdrs=None, fp=None,
    )
    with patch('fujihc.dbinit.urllib.request.urlopen', side_effect=err):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
        ))
    assert result['fetched'] == 0  # 200 は 0
    with sqlite3.connect(empty_db) as db:
        rows = db.execute(
            'SELECT fetch_status FROM tiles WHERE source=?', ('gsi_dem',),
        ).fetchall()
    assert all(r[0] == 404 for r in rows)
    assert len(rows) >= 1


def test_fetch_gsi_async_writes_metadata(empty_db):
    """完走後 metadata が attribution / format / minzoom 等で埋まる."""
    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG' + b'\x00' * 50)
        def __exit__(self, *a):
            return False

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_CM()):
        _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
        ))
    with sqlite3.connect(empty_db) as db:
        rows = dict(db.execute(
            'SELECT name, value FROM metadata WHERE source=?', ('gsi_dem',),
        ).fetchall())
    assert 'attribution' in rows
    assert 'minzoom' in rows and rows['minzoom'] == '14'
    assert 'fetched_by' in rows


def test_fetch_gsi_async_accepts_async_progress_cb(empty_db):
    """progress_cb が coroutine を返しても await される."""
    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG' + b'\x00' * 50)
        def __exit__(self, *a):
            return False

    calls = []
    async def acb(payload):
        calls.append(dict(payload))

    with patch('fujihc.dbinit.urllib.request.urlopen', return_value=_CM()):
        _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
            progress_cb=acb,
        ))
    assert len(calls) >= 2  # initial + done


# ---------- extract_osm_async ----------

def test_extract_osm_async_happy_extracts_to_db(empty_db, tmp_path):
    """Reader.get が bytes を返す mock で、 DB に osm row が入る."""
    pm = tmp_path / 'fake.pmtiles'
    pm.write_bytes(b'\x00' * 16)

    fake_reader = MagicMock()
    fake_reader.get.return_value = b'\x1f\x8b\x08pbf-bytes'

    def factory(_p):
        return fake_reader

    calls = []
    def cb(p):
        calls.append(dict(p))

    result = _run(dbinit.extract_osm_async(
        empty_db, pm, COURSE, corridor_tiles=1,
        progress_cb=cb, reader_factory=factory,
    ))
    assert result['extracted'] >= 1
    assert calls[-1]['phase'] == 'done'
    assert all(c['source'] == 'osm' for c in calls)
    with sqlite3.connect(empty_db) as db:
        n = db.execute(
            "SELECT COUNT(*) FROM tiles WHERE source='osm' AND fetch_status=200"
        ).fetchone()[0]
    assert n >= 1


def test_extract_osm_async_out_of_range_recorded_as_404(empty_db, tmp_path):
    """Reader.get が None を返したら fetch_status=404 で行残す."""
    pm = tmp_path / 'fake.pmtiles'
    pm.write_bytes(b'\x00' * 16)

    fake_reader = MagicMock()
    fake_reader.get.return_value = None
    result = _run(dbinit.extract_osm_async(
        empty_db, pm, COURSE, corridor_tiles=1,
        reader_factory=lambda _p: fake_reader,
    ))
    assert result['out_of_range'] >= 1
    assert result['extracted'] == 0


def test_extract_osm_async_missing_pmtiles_raises(empty_db, tmp_path):
    """pmtiles file 不在 → FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        _run(dbinit.extract_osm_async(
            empty_db, tmp_path / 'nope.pmtiles', COURSE, corridor_tiles=1,
            reader_factory=lambda _p: MagicMock(),
        ))


def test_extract_osm_async_writes_metadata(empty_db, tmp_path):
    """完走後 metadata が attribution / license / minzoom 等で埋まる."""
    pm = tmp_path / 'fake.pmtiles'
    pm.write_bytes(b'\x00' * 16)
    fake_reader = MagicMock()
    fake_reader.get.return_value = b'pbf'
    _run(dbinit.extract_osm_async(
        empty_db, pm, COURSE, corridor_tiles=1,
        reader_factory=lambda _p: fake_reader,
    ))
    with sqlite3.connect(empty_db) as db:
        rows = dict(db.execute(
            'SELECT name, value FROM metadata WHERE source=?', ('osm',),
        ).fetchall())
    assert rows['license'] == 'ODbL-1.0'
    assert 'attribution' in rows
    assert 'minzoom' in rows
    assert 'source_pmtiles_basename' in rows


# ---------- shared / smoke ----------

def test_load_course_json_helper(tmp_path):
    p = tmp_path / 'c.json'
    p.write_text('[{"lat":1.0,"lon":2.0}]', encoding='utf-8')
    assert dbinit.load_course_json(p) == [{"lat": 1.0, "lon": 2.0}]
