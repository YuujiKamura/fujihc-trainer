"""brief 26b: tile_server.get_setup_status の pure function unit test.

course + DB の 2 input から source 別 status (= empty / partial / ready) と
overall を計算する純関数を pin する.
"""
import json
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'src'))
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

import init_tile_db  # noqa: E402
from fujihill import tile_server  # noqa: E402
from fujihill.tile_constants import (  # noqa: E402
    DEFAULT_CORRIDOR_TILES,
    GSI_DEM_ZOOMS,
    OSM_VECTOR_ZOOMS,
)
from fujihill.tile_coverage import enumerate_coverage_tiles  # noqa: E402


COURSE_FIXTURE = [
    {"lat": 35.4, "lon": 138.7, "elevation_m": 1000, "distance_m": 0},
    {"lat": 35.4001, "lon": 138.7001, "elevation_m": 1001, "distance_m": 10},
]


@pytest.fixture
def course_path(tmp_path):
    p = tmp_path / 'course.json'
    p.write_text(json.dumps(COURSE_FIXTURE), encoding='utf-8')
    return p


@pytest.fixture
def empty_db(tmp_path):
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    return db


def _insert_tile(db_path, source, z, x, y, status=200, data=b'\x00\x01'):
    with sqlite3.connect(db_path) as db:
        db.execute(
            'INSERT OR REPLACE INTO tiles '
            '(source, zoom_level, tile_column, tile_row, format, data, fetched_at, fetch_status) '
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            (source, z, x, y, 'png' if source == 'gsi_dem' else 'pbf',
             data, status),
        )
        db.commit()


def test_empty_db_returns_empty_overall(empty_db, course_path):
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert status == 200
    assert body['overall'] == 'empty'
    assert body['sources']['gsi_dem']['status'] == 'empty'
    assert body['sources']['gsi_dem']['tiles_present'] == 0
    assert body['sources']['osm']['status'] == 'empty'
    assert body['sources']['osm']['tiles_present'] == 0
    # expected は course / zoom / corridor 由来の決定値.
    # gsi_dem は地形メッシュ用に corridor ∪ FUJI_TERRAIN_BBOX で覆う.
    from fujihill.tile_constants import FUJI_TERRAIN_BBOX
    from fujihill.tile_coverage import enumerate_bbox_tiles
    expected_gsi_set = enumerate_coverage_tiles(
        COURSE_FIXTURE, GSI_DEM_ZOOMS, DEFAULT_CORRIDOR_TILES)
    for z in GSI_DEM_ZOOMS:
        expected_gsi_set |= enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, z)
    expected_gsi = len(expected_gsi_set)
    expected_osm = len(enumerate_coverage_tiles(
        COURSE_FIXTURE, OSM_VECTOR_ZOOMS, DEFAULT_CORRIDOR_TILES))
    assert body['sources']['gsi_dem']['tiles_expected'] == expected_gsi
    assert body['sources']['osm']['tiles_expected'] == expected_osm


def test_db_missing_returns_empty_for_all_sources(tmp_path, course_path):
    """DB ファイル不在 = 全 source empty (= viewer は dbinit に遷移)."""
    missing_db = tmp_path / 'no_such.sqlite'
    status, body = tile_server.get_setup_status(missing_db, course_path)
    assert status == 200
    assert body['overall'] == 'empty'
    assert body['sources']['gsi_dem']['tiles_present'] == 0
    assert body['sources']['osm']['tiles_present'] == 0


def test_partial_gsi_only_returns_partial(empty_db, course_path):
    """gsi_dem だけ 1 件 → gsi=partial, osm=empty, overall=partial."""
    tiles = sorted(enumerate_coverage_tiles(
        COURSE_FIXTURE, GSI_DEM_ZOOMS, DEFAULT_CORRIDOR_TILES))
    z, x, y = tiles[0]
    _insert_tile(empty_db, 'gsi_dem', z, x, y, status=200, data=b'png')
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert status == 200
    assert body['overall'] == 'partial'
    assert body['sources']['gsi_dem']['status'] == 'partial'
    assert body['sources']['gsi_dem']['tiles_present'] == 1
    assert body['sources']['osm']['status'] == 'empty'


def test_all_ready_returns_ready_overall(empty_db, course_path):
    """3 source の expected 数だけ insert すると overall=ready (= brief 30 で osm_raster 追加)."""
    from fujihill.tile_constants import (
        FUJI_TERRAIN_BBOX, MINIMAP_BBOX, MINIMAP_OSM_ZOOM,
    )
    from fujihill.tile_coverage import enumerate_bbox_tiles
    # gsi_dem は corridor ∪ FUJI_TERRAIN_BBOX、 osm は corridor のみ.
    gsi_set = enumerate_coverage_tiles(
        COURSE_FIXTURE, GSI_DEM_ZOOMS, DEFAULT_CORRIDOR_TILES)
    for z in GSI_DEM_ZOOMS:
        gsi_set |= enumerate_bbox_tiles(FUJI_TERRAIN_BBOX, z)
    osm_set = enumerate_coverage_tiles(
        COURSE_FIXTURE, OSM_VECTOR_ZOOMS, DEFAULT_CORRIDOR_TILES)
    for src, tile_set in (('gsi_dem', gsi_set), ('osm', osm_set)):
        for z, x, y in sorted(tile_set):
            _insert_tile(empty_db, src, z, x, y, status=200, data=b'\x01')
    # brief 30: osm_raster の expected 数だけ insert
    for z, x, y in sorted(enumerate_bbox_tiles(MINIMAP_BBOX, MINIMAP_OSM_ZOOM)):
        _insert_tile(empty_db, 'osm_raster', z, x, y, status=200, data=b'\x89PNG')
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert status == 200
    assert body['overall'] == 'ready'
    assert body['sources']['gsi_dem']['status'] == 'ready'
    assert body['sources']['osm']['status'] == 'ready'
    assert body['sources']['osm_raster']['status'] == 'ready'


def test_fetch_status_404_rows_not_counted(empty_db, course_path):
    """fetch_status=404 / data IS NULL の行は present に含めない."""
    tiles = sorted(enumerate_coverage_tiles(
        COURSE_FIXTURE, GSI_DEM_ZOOMS, DEFAULT_CORRIDOR_TILES))
    for (z, x, y) in tiles:
        _insert_tile(empty_db, 'gsi_dem', z, x, y, status=404, data=None)
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert status == 200
    assert body['sources']['gsi_dem']['status'] == 'empty'
    assert body['sources']['gsi_dem']['tiles_present'] == 0


def test_osm_raster_source_present_in_empty_db(empty_db, course_path):
    """brief 30: osm_raster source が empty で存在し、 expected が bbox 由来."""
    from fujihill.tile_constants import MINIMAP_BBOX, MINIMAP_OSM_ZOOM
    from fujihill.tile_coverage import enumerate_bbox_tiles
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert status == 200
    assert 'osm_raster' in body['sources']
    assert body['sources']['osm_raster']['status'] == 'empty'
    assert body['sources']['osm_raster']['tiles_present'] == 0
    expected = len(enumerate_bbox_tiles(MINIMAP_BBOX, MINIMAP_OSM_ZOOM))
    assert body['sources']['osm_raster']['tiles_expected'] == expected
    assert expected > 0  # 富士山 bbox + z=11 で必ず 1 タイル以上


def test_osm_raster_partial_then_ready(empty_db, course_path):
    """brief 30: osm_raster の expected 数だけ insert すると osm_raster=ready."""
    from fujihill.tile_constants import MINIMAP_BBOX, MINIMAP_OSM_ZOOM
    from fujihill.tile_coverage import enumerate_bbox_tiles
    tiles = sorted(enumerate_bbox_tiles(MINIMAP_BBOX, MINIMAP_OSM_ZOOM))
    # 1 件だけ insert → partial
    z, x, y = tiles[0]
    _insert_tile(empty_db, 'osm_raster', z, x, y, status=200, data=b'\x89PNG')
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert body['sources']['osm_raster']['status'] == 'partial'
    # 残り全部 → ready
    for z, x, y in tiles[1:]:
        _insert_tile(empty_db, 'osm_raster', z, x, y, status=200, data=b'\x89PNG')
    status, body = tile_server.get_setup_status(empty_db, course_path)
    assert body['sources']['osm_raster']['status'] == 'ready'


def test_course_path_missing_returns_503(empty_db, tmp_path):
    """course.json 不在 = 起動 substrate 不全 → 503."""
    missing = tmp_path / 'no_course.json'
    status, body = tile_server.get_setup_status(empty_db, missing)
    assert status == 503
    assert body is None


def test_course_path_invalid_json_returns_503(empty_db, tmp_path):
    bad = tmp_path / 'bad.json'
    bad.write_text('not-json{{', encoding='utf-8')
    status, body = tile_server.get_setup_status(empty_db, bad)
    assert status == 503
    assert body is None
