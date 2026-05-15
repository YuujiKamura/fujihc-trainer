"""brief 26b: setup_status / fetch_gsi / extract_osm endpoint の aiohttp 統合 test."""
from __future__ import annotations

import io
import json
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from fujihill.http_app import make_http_app
import init_tile_db


@pytest.fixture
def course_path(tmp_path):
    p = tmp_path / 'course.json'
    p.write_text(json.dumps([
        {"lat": 35.4, "lon": 138.7, "elevation_m": 1000, "distance_m": 0},
    ]), encoding='utf-8')
    return p


@pytest.fixture
def empty_db(tmp_path):
    db = tmp_path / 'tiles.sqlite'
    init_tile_db.init_db(db)
    return db


async def test_setup_status_empty_db_returns_empty_overall(
        aiohttp_client, empty_db, course_path):
    client = await aiohttp_client(make_http_app(empty_db, course_path=course_path))
    resp = await client.get('/tiles/_setup_status')
    assert resp.status == 200
    body = await resp.json()
    assert body['overall'] == 'empty'
    assert 'gsi_dem' in body['sources']
    assert 'osm' in body['sources']
    assert body['sources']['gsi_dem']['tiles_present'] == 0


async def test_setup_status_db_missing_still_returns_200(
        aiohttp_client, tmp_path, course_path):
    """DB file 不在でも setup_status は 200 + overall=empty (= viewer 遷移用)."""
    client = await aiohttp_client(make_http_app(
        tmp_path / 'missing.sqlite', course_path=course_path))
    resp = await client.get('/tiles/_setup_status')
    assert resp.status == 200
    body = await resp.json()
    assert body['overall'] == 'empty'


async def test_setup_status_course_missing_returns_503(
        aiohttp_client, empty_db, tmp_path):
    client = await aiohttp_client(make_http_app(
        empty_db, course_path=tmp_path / 'nope.json'))
    resp = await client.get('/tiles/_setup_status')
    assert resp.status == 503


async def test_fetch_gsi_returns_202_and_inserts_rows(
        aiohttp_client, empty_db, course_path):
    """POST /tiles/_fetch_gsi → 202 + 非同期で DB に row 追加."""
    fake_body = b'\x89PNG\r\n\x1a\n' + b'\x00' * 50

    class _CM:
        def __enter__(self):
            return io.BytesIO(fake_body)
        def __exit__(self, *a):
            return False

    # rate limit を 0 にするため tile_constants 経由で短縮 (= dbinit default 1.0s だと遅すぎる)
    from fujihill import dbinit
    orig = dbinit.fetch_gsi_async

    async def fast(*args, **kwargs):
        kwargs['rate_limit_sec'] = 0.0
        kwargs['corridor_tiles'] = 1
        return await orig(*args, **kwargs)

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()), \
         patch('fujihill.http_app.dbinit.fetch_gsi_async', side_effect=fast):
        client = await aiohttp_client(make_http_app(empty_db, course_path=course_path))
        resp = await client.post('/tiles/_fetch_gsi', json={})
        assert resp.status == 202
        body = await resp.json()
        assert body['state'] == 'started'
        # background task の完走を待つ (= 短時間 sleep)
        import asyncio
        for _ in range(20):
            await asyncio.sleep(0.05)
            with sqlite3.connect(empty_db) as db:
                n = db.execute(
                    "SELECT COUNT(*) FROM tiles WHERE source='gsi_dem'"
                ).fetchone()[0]
                if n >= 1:
                    break
        assert n >= 1


async def test_extract_osm_missing_pmtiles_path_returns_400(
        aiohttp_client, empty_db, course_path):
    client = await aiohttp_client(make_http_app(empty_db, course_path=course_path))
    resp = await client.post('/tiles/_extract_osm', json={})
    assert resp.status == 400


async def test_extract_osm_valid_call_returns_202(
        aiohttp_client, empty_db, course_path, tmp_path):
    pm = tmp_path / 'fake.pmtiles'
    pm.write_bytes(b'\x00' * 16)

    fake_reader = MagicMock()
    fake_reader.get.return_value = b'pbf-bytes'

    from fujihill import dbinit
    orig = dbinit.extract_osm_async

    async def patched(*args, **kwargs):
        kwargs['reader_factory'] = lambda _p: fake_reader
        kwargs['corridor_tiles'] = 1
        return await orig(*args, **kwargs)

    with patch('fujihill.http_app.dbinit.extract_osm_async', side_effect=patched):
        client = await aiohttp_client(make_http_app(empty_db, course_path=course_path))
        resp = await client.post('/tiles/_extract_osm',
                                 json={'pmtiles_path': str(pm)})
        assert resp.status == 202
        body = await resp.json()
        assert body['state'] == 'started'


async def test_progress_broadcaster_invoked(
        aiohttp_client, empty_db, course_path):
    """progress_broadcaster を渡すと fetch 中 dbinit_progress payload が流れる."""
    fake_body = b'\x89PNG' + b'\x00' * 50

    class _CM:
        def __enter__(self):
            return io.BytesIO(fake_body)
        def __exit__(self, *a):
            return False

    captured = []

    async def broadcaster(payload):
        captured.append(payload)

    from fujihill import dbinit
    orig = dbinit.fetch_gsi_async

    async def fast(*args, **kwargs):
        kwargs['rate_limit_sec'] = 0.0
        kwargs['corridor_tiles'] = 1
        return await orig(*args, **kwargs)

    with patch('fujihill.dbinit.urllib.request.urlopen', return_value=_CM()), \
         patch('fujihill.http_app.dbinit.fetch_gsi_async', side_effect=fast):
        client = await aiohttp_client(make_http_app(
            empty_db, course_path=course_path, progress_broadcaster=broadcaster))
        resp = await client.post('/tiles/_fetch_gsi', json={})
        assert resp.status == 202
        import asyncio
        for _ in range(40):
            await asyncio.sleep(0.05)
            if any(c.get('phase') == 'done' for c in captured):
                break
    assert captured  # 1 件以上 push された
    assert all(c['type'] == 'dbinit_progress' for c in captured)
    assert any(c['phase'] == 'done' for c in captured)
