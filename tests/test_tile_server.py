"""brief 17a: src/fujihc/tile_server.py の unit test (全関数 mandate).

HTTP framework は import しない、 pure Python + sqlite3 + 一時 DB ファイルで完結。
"""
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'src'))
sys.path.insert(0, str(REPO_ROOT / 'scripts'))

import init_tile_db  # noqa: E402
from fujihc import tile_server  # noqa: E402


# ---------- fixtures ----------

@pytest.fixture
def empty_db(tmp_path):
    """brief 14 schema_v1 で空 DB を作成して path を返す."""
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    return db


@pytest.fixture
def populated_db(empty_db):
    """tile 1 件 (osm/pbf 200) + 404 行 1 件 + metadata 両 source 入りの DB."""
    conn = sqlite3.connect(str(empty_db))
    try:
        # osm pbf, status 200
        conn.execute(
            "INSERT INTO tiles (source, zoom_level, tile_column, tile_row, "
            "format, data, fetched_at, fetch_status) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ('osm', 16, 57983, 25750, 'pbf', b'\x1a\x0bOSM-PBF-OK', 200),
        )
        # gsi_dem png, status 200
        conn.execute(
            "INSERT INTO tiles (source, zoom_level, tile_column, tile_row, "
            "format, data, fetched_at, fetch_status) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ('gsi_dem', 14, 14495, 6437, 'png', b'\x89PNG-FAKE-DEM', 200),
        )
        # osm pbf, status 404 (= 行存在するが fetch_status=404)
        conn.execute(
            "INSERT INTO tiles (source, zoom_level, tile_column, tile_row, "
            "format, data, fetched_at, fetch_status) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ('osm', 16, 9999, 9999, 'pbf', None, 404),
        )
        # metadata: osm
        for name, value in (
            ('minzoom', '14'), ('maxzoom', '18'), ('attribution', '(c) OSM contributors'),
        ):
            conn.execute(
                "INSERT INTO metadata (source, name, value) VALUES (?, ?, ?)",
                ('osm', name, value),
            )
        # metadata: gsi_dem
        for name, value in (
            ('minzoom', '14'), ('maxzoom', '14'), ('attribution', '国土地理院'),
        ):
            conn.execute(
                "INSERT INTO metadata (source, name, value) VALUES (?, ?, ?)",
                ('gsi_dem', name, value),
            )
        conn.commit()
    finally:
        conn.close()
    return empty_db


@pytest.fixture(autouse=True)
def _reset_metrics():
    """各 test で metrics を 0 から start (= test 順序 dependency 防止)."""
    tile_server.reset_metrics()
    yield
    tile_server.reset_metrics()


# ---------- get_tile ----------

def test_get_tile_happy_returns_200_with_bytes(populated_db):
    status, ctype, data = tile_server.get_tile(populated_db, 'osm', 16, 57983, 25750)
    assert status == 200
    assert ctype == 'application/x-protobuf'
    assert data == b'\x1a\x0bOSM-PBF-OK'


def test_get_tile_happy_png_content_type(populated_db):
    status, ctype, data = tile_server.get_tile(populated_db, 'gsi_dem', 14, 14495, 6437)
    assert status == 200
    assert ctype == 'image/png'
    assert data == b'\x89PNG-FAKE-DEM'


def test_get_tile_missing_row_returns_404(populated_db):
    status, ctype, data = tile_server.get_tile(populated_db, 'osm', 18, 0, 0)
    assert status == 404
    assert ctype is None
    assert data is None


def test_get_tile_fetch_status_404_row_returns_404(populated_db):
    """DB 行は存在するが fetch_status=404 のとき 404 を返す."""
    status, ctype, data = tile_server.get_tile(populated_db, 'osm', 16, 9999, 9999)
    assert status == 404
    assert ctype is None
    assert data is None


def test_get_tile_invalid_source_returns_400(populated_db):
    status, ctype, data = tile_server.get_tile(populated_db, 'mapbox', 14, 0, 0)
    assert status == 400
    assert ctype is None
    assert data is None


def test_get_tile_db_missing_returns_503(tmp_path):
    db = tmp_path / 'does_not_exist.sqlite'
    status, ctype, data = tile_server.get_tile(db, 'osm', 14, 0, 0)
    assert status == 503
    assert ctype is None
    assert data is None


# ---------- get_metadata ----------

def test_get_metadata_happy(populated_db):
    status, meta = tile_server.get_metadata(populated_db, 'osm')
    assert status == 200
    assert meta == {
        'minzoom': '14',
        'maxzoom': '18',
        'attribution': '(c) OSM contributors',
    }


def test_get_metadata_empty_returns_404(empty_db):
    """metadata row 0 件で 404."""
    status, meta = tile_server.get_metadata(empty_db, 'osm')
    assert status == 404
    assert meta is None


def test_get_metadata_invalid_source_returns_400(populated_db):
    status, meta = tile_server.get_metadata(populated_db, 'invalid')
    assert status == 400
    assert meta is None


def test_get_metadata_db_missing_returns_503(tmp_path):
    db = tmp_path / 'missing.sqlite'
    status, meta = tile_server.get_metadata(db, 'osm')
    assert status == 503
    assert meta is None


# ---------- build_style_json ----------

def test_build_style_json_happy(populated_db):
    status, style = tile_server.build_style_json(populated_db)
    assert status == 200
    assert style['version'] == 8
    assert set(style['sources'].keys()) == {'osm', 'gsi_dem'}
    assert style['sources']['osm']['type'] == 'vector'
    assert style['sources']['osm']['tiles'] == ['/tiles/osm/{z}/{x}/{y}.pbf']
    assert style['sources']['osm']['minzoom'] == 14
    assert style['sources']['osm']['maxzoom'] == 18
    assert style['sources']['gsi_dem']['type'] == 'raster-dem'
    assert style['sources']['gsi_dem']['tiles'] == ['/tiles/gsi_dem/{z}/{x}/{y}.png']
    assert style['sources']['gsi_dem']['encoding'] == 'gsi-dem-png'
    assert isinstance(style['layers'], list) and len(style['layers']) >= 1


def test_build_style_json_custom_base_url(populated_db):
    status, style = tile_server.build_style_json(populated_db, base_url='/api/tiles')
    assert status == 200
    assert style['sources']['osm']['tiles'][0].startswith('/api/tiles/osm/')


def test_build_style_json_missing_metadata_returns_503(empty_db):
    """metadata 不在 (= setup 未完了) のとき 503."""
    status, style = tile_server.build_style_json(empty_db)
    assert status == 503
    assert style is None


def test_build_style_json_db_missing_returns_503(tmp_path):
    db = tmp_path / 'missing.sqlite'
    status, style = tile_server.build_style_json(db)
    assert status == 503
    assert style is None


# ---------- register_tile_routes ----------

def test_register_tile_routes_returns_handler_dict(populated_db):
    handlers = tile_server.register_tile_routes(populated_db)
    assert set(handlers.keys()) >= {'tile', 'metadata', 'style'}
    # 各 handler は callable
    for key in ('tile', 'metadata', 'style'):
        assert callable(handlers[key])
    # 実呼出も brief 通り
    assert handlers['tile']('osm', 16, 57983, 25750)[0] == 200
    assert handlers['metadata']('osm')[0] == 200
    assert handlers['style']()[0] == 200


# ---------- metrics (brief 20 連携) ----------

def test_metrics_count_up_on_get_tile(populated_db):
    """get_tile 呼出ごとに source 別 status 別 count up."""
    # 初期は 0
    assert tile_server.get_metrics() == {
        'osm': {'200': 0, '404': 0},
        'gsi_dem': {'200': 0, '404': 0},
    }
    # osm hit x2, miss x1
    tile_server.get_tile(populated_db, 'osm', 16, 57983, 25750)  # 200
    tile_server.get_tile(populated_db, 'osm', 16, 57983, 25750)  # 200
    tile_server.get_tile(populated_db, 'osm', 18, 0, 0)           # 404 (missing row)
    # gsi_dem hit x1, miss-by-status x0; row with fetch_status=404 counted as 404
    tile_server.get_tile(populated_db, 'gsi_dem', 14, 14495, 6437)  # 200
    tile_server.get_tile(populated_db, 'osm', 16, 9999, 9999)      # 404 (fetch_status=404)
    m = tile_server.get_metrics()
    assert m['osm'] == {'200': 2, '404': 2}
    assert m['gsi_dem'] == {'200': 1, '404': 0}


def test_metrics_400_503_not_counted(populated_db, tmp_path):
    """invalid source (400) / DB 不在 (503) は metric に含めない."""
    tile_server.get_tile(populated_db, 'mapbox', 14, 0, 0)             # 400
    tile_server.get_tile(tmp_path / 'nope.sqlite', 'osm', 14, 0, 0)    # 503
    m = tile_server.get_metrics()
    assert m == {
        'osm': {'200': 0, '404': 0},
        'gsi_dem': {'200': 0, '404': 0},
    }


def test_reset_metrics_zeros_all_counters(populated_db):
    tile_server.get_tile(populated_db, 'osm', 16, 57983, 25750)
    tile_server.get_tile(populated_db, 'osm', 18, 0, 0)
    assert tile_server.get_metrics()['osm'] != {'200': 0, '404': 0}
    tile_server.reset_metrics()
    assert tile_server.get_metrics() == {
        'osm': {'200': 0, '404': 0},
        'gsi_dem': {'200': 0, '404': 0},
    }


def test_get_metrics_returns_independent_copy(populated_db):
    """get_metrics の返り値を変更しても内部 state に影響しない."""
    snapshot = tile_server.get_metrics()
    snapshot['osm']['200'] = 999
    assert tile_server.get_metrics()['osm']['200'] == 0


def test_register_tile_routes_exposes_metrics(populated_db):
    handlers = tile_server.register_tile_routes(populated_db)
    assert 'metrics' in handlers and callable(handlers['metrics'])
    handlers['tile']('osm', 16, 57983, 25750)
    assert handlers['metrics']()['osm']['200'] == 1
