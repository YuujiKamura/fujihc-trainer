"""brief 26b: src/fujihill/dbinit.py の async 関数群 unit test.

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
from fujihill import dbinit  # noqa: E402


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

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1,
            rate_limit_sec=0.0, progress_cb=cb, bbox=None,
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
    from fujihill.tile_constants import DEFAULT_CORRIDOR_TILES, GSI_DEM_ZOOMS
    from fujihill.tile_coverage import enumerate_coverage_tiles
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

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=GSI_DEM_ZOOMS[0], corridor_tiles=1,
            rate_limit_sec=0.0, bbox=None,
        ))
    assert result['skipped'] >= 1
    assert result['skipped'] + result['fetched'] >= result['total']


def test_fetch_gsi_async_404_recorded_as_row(empty_db):
    """404 のタイルも fetch_status=404 で DB 行を残す (= 再 fetch 抑止)."""
    err = urllib.error.HTTPError(
        url='http://x', code=404, msg='Not Found', hdrs=None, fp=None,
    )
    with patch('fujihill.dbinit.urllib.request.urlopen', side_effect=err):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
            bbox=None,
        ))
    assert result['fetched'] == 0  # 200 は 0
    with sqlite3.connect(empty_db) as db:
        rows = db.execute(
            'SELECT fetch_status FROM tiles WHERE source=?', ('gsi_dem',),
        ).fetchall()
    assert all(r[0] == 404 for r in rows)
    assert len(rows) >= 1


def test_fetch_gsi_async_writes_metadata(empty_db):
    """完走後 metadata が attribution / format / minzoom 等で埋まる.

    b59: attribution は dem5a_png (= 5mメッシュ標高タイル) を明示する."""
    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG' + b'\x00' * 50)
        def __exit__(self, *a):
            return False

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()):
        _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=15, corridor_tiles=1, rate_limit_sec=0.0,
            bbox=None,
        ))
    with sqlite3.connect(empty_db) as db:
        rows = dict(db.execute(
            'SELECT name, value FROM metadata WHERE source=?', ('gsi_dem',),
        ).fetchall())
    assert 'attribution' in rows
    assert 'dem5a_png' in rows['attribution'], 'b59: attribution が dem5a_png を明示'
    assert 'minzoom' in rows and rows['minzoom'] == '15'
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

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()):
        _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=14, corridor_tiles=1, rate_limit_sec=0.0,
            progress_cb=acb, bbox=None,
        ))
    assert len(calls) >= 2  # initial + done


def test_fetch_gsi_async_default_bbox_covers_fuji_summit(empty_db):
    """default (bbox=FUJI_TERRAIN_BBOX) は course corridor を超え、
    富士山頂を含むタイルまで fetch する (= 地形メッシュに富士山本体が乗る).

    b59: DEM 範囲を course 外接に絞った (= dem5a z15 化) が、 FUJI_TERRAIN_BBOX には
    富士山頂を union 済なので山頂被覆は維持される。 zoom は中央定数 GSI_DEM_ZOOMS に
    追従させ literal を持たない (= b59 で z14→z15 した時に再破綻しないため)."""
    from fujihill.tile_constants import FUJI_TERRAIN_BBOX, GSI_DEM_ZOOMS
    from fujihill.tile_coverage import (
        enumerate_bbox_tiles,
        enumerate_coverage_tiles,
    )
    z = GSI_DEM_ZOOMS[0]

    class _CM:
        def __enter__(self):
            return io.BytesIO(b'\x89PNG' + b'\x00' * 50)

        def __exit__(self, *a):
            return False

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()):
        result = _run(dbinit.fetch_gsi_async(
            empty_db, COURSE, zoom=z, corridor_tiles=1, rate_limit_sec=0.0,
        ))

    # 富士山頂 (35.3606N, 138.7274E) を含むタイルを退化 bbox で 1 枚算出.
    summit_tiles = enumerate_bbox_tiles((138.7274, 35.3606, 138.7274, 35.3606), z)
    assert len(summit_tiles) == 1
    summit = next(iter(summit_tiles))

    # corridor 単独ではこの山頂タイルは取れない ── 本 test の前提.
    corridor = enumerate_coverage_tiles(COURSE, [z], 1)
    assert summit not in corridor, 'precondition: 山頂タイルは corridor 外のはず'

    # default fetch では DB に富士山頂タイルが入っている (= FUJI_TERRAIN_BBOX が山頂を union 済).
    with sqlite3.connect(empty_db) as db:
        rows = set(db.execute(
            'SELECT zoom_level, tile_column, tile_row FROM tiles WHERE source=?',
            ('gsi_dem',),
        ).fetchall())
    assert summit in rows, '富士山頂タイルが DB に無い (= 地形が富士山を覆っていない)'

    # total は bbox ∪ corridor と一致 (= fetch 範囲が和集合になっている).
    expected = enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, z) | corridor
    assert result['total'] == len(expected)


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
