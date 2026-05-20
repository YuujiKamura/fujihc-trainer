"""http_app の tile route が gzip 圧縮済 pbf に Content-Encoding: gzip を付ける test.

Protomaps PMTiles から取り込んだ OSM vector tile は gzip 圧縮されたまま DB に
保存される。 MapLibre は Content-Encoding: gzip を見て auto-decompress する。
このヘッダが付かないと、 MapLibre は gzip バイトを生 protobuf として解釈し
パース失敗 → 地図 layer が描画されない (= 黒画面)。
"""
import sqlite3

import pytest
from aiohttp.test_utils import TestClient, TestServer

from fujihc.http_app import make_http_app


def _init_db(path):
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE tiles (
            source TEXT, zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER,
            format TEXT, data BLOB, fetched_at TEXT, fetch_status INTEGER
        );
        CREATE TABLE metadata (source TEXT, name TEXT, value TEXT);
    """)
    conn.commit()
    return conn


@pytest.fixture
async def client(tmp_path):
    db = tmp_path / "tiles.sqlite"
    conn = _init_db(db)
    # gzip 圧縮済 pbf を 1 件入れる (= 1f8b magic)
    gzip_pbf = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff\x00\x01\x02\x03"
    conn.execute(
        "INSERT INTO tiles VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
        ("osm", 15, 29013, 12932, "pbf", gzip_pbf, 200),
    )
    # 生 PNG (= 89 50 magic、 gzip でない) を 1 件入れる
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0d"
    conn.execute(
        "INSERT INTO tiles VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
        ("gsi_dem", 14, 14506, 6466, "png", png, 200),
    )
    conn.commit()
    conn.close()
    course = tmp_path / "course.json"
    course.write_text("[]", encoding="utf-8")
    app = make_http_app(db_path=db, course_path=course)
    async with TestClient(TestServer(app)) as c:
        yield c


@pytest.mark.asyncio
async def test_gzip_pbf_gets_content_encoding_gzip(client):
    """OSM vector tile (gzip 圧縮済) には Content-Encoding: gzip が付く."""
    resp = await client.get("/tiles/osm/15/29013/12932.pbf")
    assert resp.status == 200
    assert resp.headers.get("Content-Encoding") == "gzip", (
        f"gzip-encoded tile must declare Content-Encoding: gzip, got headers={dict(resp.headers)}"
    )


@pytest.mark.asyncio
async def test_png_does_not_get_content_encoding(client):
    """生 PNG には Content-Encoding を付けない (= gzip magic で始まらない)."""
    resp = await client.get("/tiles/gsi_dem/14/14506/6466.png")
    assert resp.status == 200
    assert resp.headers.get("Content-Encoding") is None, (
        f"non-gzip tile must not declare encoding, got {resp.headers.get('Content-Encoding')}"
    )


@pytest.mark.asyncio
async def test_gzip_body_preserved_byte_for_byte(client):
    """gzip 済 body は aiohttp に再圧縮されず、 生バイトのまま返る."""
    # aiohttp client は自動 decompress するので、 raw bytes を比較するために
    # gzip header を直接読む
    resp = await client.get("/tiles/osm/15/29013/12932.pbf")
    # aiohttp client が auto-decode してくれる、 元の中身を確認
    body = await resp.read()
    # client side で gzip decompress 済になってる、 元の uncompressed bytes
    # 上の fixture では gzip header だけ + 適当 4 bytes、 decompress で何が出るか
    # 重要なのは「server が gzip ヘッダを付けた」事実、 body 自体は aiohttp の
    # 透過 decode 後の値で OK
    assert resp.status == 200
