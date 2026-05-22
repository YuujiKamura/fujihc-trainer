"""brief 17a + Round 4 refactor: HTTP tile server 統合 test.

aiohttp の test_utils で in-process に make_http_app() を起動、
tile / metadata / style / metrics endpoint と DB 不在時の 503 を確認.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from fujihill.http_app import make_http_app
from fujihill import tile_server
import init_tile_db


@pytest.fixture
def db_with_one_tile(tmp_path: Path) -> Path:
    """空 DB + 1 osm tile + osm/gsi_dem metadata を作る."""
    db_path = tmp_path / "tiles.sqlite"
    init_tile_db.init_db(db_path)
    payload = b"\x00\x01\x02fake-pbf"
    with sqlite3.connect(db_path) as db:
        db.execute(
            "INSERT INTO tiles (source, zoom_level, tile_column, tile_row, format, "
            "data, fetched_at, fetch_status) "
            "VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)",
            ("osm", 17, 116000, 51500, "pbf", payload, 200),
        )
        # metadata for both sources so style.json builds
        for src, name, value in [
            ("osm", "attribution", "© OpenStreetMap contributors (ODbL)"),
            ("osm", "minzoom", "17"),
            ("osm", "maxzoom", "17"),
            ("gsi_dem", "attribution", "国土地理院 標高タイル"),
            ("gsi_dem", "minzoom", "14"),
            ("gsi_dem", "maxzoom", "14"),
        ]:
            db.execute(
                "INSERT OR REPLACE INTO metadata (source, name, value) VALUES (?, ?, ?)",
                (src, name, value),
            )
        db.commit()
    return db_path


@pytest.fixture(autouse=True)
def _reset_metrics():
    tile_server.reset_metrics()
    yield
    tile_server.reset_metrics()


async def test_tile_endpoint_happy(aiohttp_client, db_with_one_tile):
    """既知 tile を request -> 200 + pbf Content-Type + bytes 一致."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    resp = await client.get("/tiles/osm/17/116000/51500.pbf")
    assert resp.status == 200
    assert resp.headers["Content-Type"].startswith("application/x-protobuf")
    body = await resp.read()
    assert body == b"\x00\x01\x02fake-pbf"


async def test_tile_endpoint_404(aiohttp_client, db_with_one_tile):
    """存在しない z/x/y -> 404."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    resp = await client.get("/tiles/osm/17/0/0.pbf")
    assert resp.status == 404


async def test_tile_endpoint_invalid_source(aiohttp_client, db_with_one_tile):
    """invalid source -> 400."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    resp = await client.get("/tiles/invalid/17/0/0.pbf")
    assert resp.status == 400


async def test_tile_endpoint_503_when_db_missing(aiohttp_client, tmp_path):
    """DB 不在 -> 503 (= setup 未完了の中間状態 signal)."""
    client = await aiohttp_client(make_http_app(tmp_path / "nonexistent.sqlite"))
    resp = await client.get("/tiles/osm/17/0/0.pbf")
    assert resp.status == 503


async def test_metadata_endpoint(aiohttp_client, db_with_one_tile):
    """metadata.json -> dict."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    resp = await client.get("/tiles/osm/metadata.json")
    assert resp.status == 200
    body = await resp.json()
    assert body["attribution"].startswith("©")
    assert body["minzoom"] == "17"


async def test_style_endpoint(aiohttp_client, db_with_one_tile):
    """style.json -> osm + gsi_dem source 含む MapLibre style."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    resp = await client.get("/tiles/_style.json")
    assert resp.status == 200
    body = await resp.json()
    assert body["version"] == 8
    assert "osm" in body["sources"]
    assert "gsi_dem" in body["sources"]
    assert body["sources"]["osm"]["type"] == "vector"
    assert body["sources"]["gsi_dem"]["type"] == "raster-dem"


async def test_metrics_endpoint(aiohttp_client, db_with_one_tile):
    """tile を 2 回叩いて metrics で count up を確認 (= brief 20)."""
    client = await aiohttp_client(make_http_app(db_with_one_tile))
    await client.get("/tiles/osm/17/116000/51500.pbf")  # hit
    await client.get("/tiles/osm/17/0/0.pbf")            # miss (404)
    resp = await client.get("/tiles/_metrics")
    assert resp.status == 200
    metrics = await resp.json()
    assert metrics["osm"]["200"] == 1
    assert metrics["osm"]["404"] == 1


async def test_debug_frame_endpoint(aiohttp_client, db_with_one_tile, tmp_path):
    """POST /debug/frame -> PNG body を debug_frame_path に保存する (= ?cap=1 画面送信)."""
    out = tmp_path / "debug-frame.png"
    client = await aiohttp_client(make_http_app(db_with_one_tile, debug_frame_path=out))
    png = b"\x89PNG\r\n\x1a\n" + b"fake-frame-bytes"
    resp = await client.post("/debug/frame", data=png)
    assert resp.status == 200
    body = await resp.json()
    assert body["bytes"] == len(png)
    assert out.read_bytes() == png


async def test_debug_frame_endpoint_empty_body(aiohttp_client, db_with_one_tile, tmp_path):
    """空 body は 400 で弾く (= 壊れた送信で保存済みフレームを潰さない)."""
    out = tmp_path / "debug-frame.png"
    client = await aiohttp_client(make_http_app(db_with_one_tile, debug_frame_path=out))
    resp = await client.post("/debug/frame", data=b"")
    assert resp.status == 400
    assert not out.exists()


def test_bind_is_127_0_0_1_in_source():
    """bridge.py の bind が 0.0.0.0 に化けたら fail (= LOAD-BEARING source-grep gate).

    HTTP TCPSite と WebSocket serve の両方が 127.0.0.1 でなければ別端末から
    アクセスできてしまう (LAN 内 ODbL 再配布事故 vector). 物理層で pin する.
    """
    src = Path(__file__).resolve().parent.parent / "src" / "fujihill" / "bridge.py"
    text = src.read_text(encoding="utf-8")
    # HTTP TCPSite
    assert 'TCPSite(http_runner, "127.0.0.1"' in text, (
        "HTTP TCPSite must bind to 127.0.0.1 (= LAN 露出禁止)"
    )
    # WebSocket serve
    assert 'websockets.serve(self._ws_handler, "127.0.0.1"' in text, (
        "WebSocket serve must bind to 127.0.0.1 (= LAN 露出禁止)"
    )
    # 危険な bind が無い
    assert '"0.0.0.0"' not in text, (
        "bridge.py must not contain 0.0.0.0 bind (= LAN 露出 / 第三者アクセス可能)"
    )
